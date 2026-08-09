# Private Cloud — end-to-end encryption

This document describes how Alice's **Private** mode protects a message, exactly
what each party can see, and — importantly — the parts that are **not yet
fully verified**. It is deliberate about wording: read the
[Status matrix](#status-matrix) before describing Private as "E2EE" anywhere.

Alice has three AI modes:

- **Local** — nothing leaves the device.
- **Private** — the cloud mode described here.
- **Custom AI** — a user-configured server, unchanged by this document.

## What "Private" means, simply

Your message is encrypted **on your device** before it leaves. It travels as
ciphertext through Alice's proxy and Venice's infrastructure, and is only
decrypted **inside a hardware enclave (Intel TDX) that Alice tries to verify**.
The reply comes back encrypted and is decrypted **on your device**.

> Wording rule: only say *"Messages are encrypted on the user's device and can
> only be decrypted by a successfully attested enclave matching Alice's approved
> policy"* once the code actually enforces the full policy for that model —
> i.e. the [assurance level](#assurance-levels) is `full`. Today it is not (see
> the matrix), so the UI says **Private**, never "E2EE verified".

## The flow

```
  Alice (device)                Alice Worker              Venice / Phala TEE
  ─────────────                 ────────────              ──────────────────
  generate 32-byte nonce
  GET /tee/attestation ───────▶ attach VENICE_API_KEY ──▶ enclave returns
                                (never decrypts)           quote + signing key
  verify nonce
  parse + DCAP-verify quote ◀── /pccs/* collateral relay ─▶ PCCS (Phala/Intel)
    (collateral only; public)   (fixed upstream, no logs)
  check non-debug
  bind key ↔ report_data
  bind nonce ↔ report_data
  pin measurements (policy)
  ── all checks pass ──
  encrypt user/system msgs
  POST /chat/completions ─────▶ attach key, pass through ─▶ enclave decrypts,
    (ciphertext + TEE headers)  (never decrypts, no logs)   runs model
  decrypt each SSE chunk    ◀── stream passthrough ───────  encrypts to session
```

## Cryptography vs attestation — the layers

These are distinct, and Private only becomes real E2EE when they all hold:

| Layer | What it proves | How |
| --- | --- | --- |
| **Encryption** | Content is unreadable in transit | secp256k1 ECDH → HKDF-SHA256 (`ecdsa_encryption`) → AES-256-GCM; envelope `hex[pubkey65][nonce12][ct+tag]` |
| **Hardware attestation** | A genuine, TCB-current, non-debug Intel TDX enclave | DCAP quote verification (`@phala/dcap-qvl`) against Intel's trust chain |
| **Key binding** | The encryption key belongs to that enclave | `report_data[0:20] == keccak256(signing_public_key[1:])[-20:]` |
| **Freshness binding** | The verified quote was created for this request | `report_data[32:64] == fresh_nonce` |
| **Measurements** | The enclave runs the code Alice approves | pin MRTD/RTMR0-2 (OS image) + RTMR3 (app compose-hash) to governed references |
| **Governance** | The approved references are authoritative | dstack `DstackKms.allowedOsImages` + `DstackApp` compose-hash whitelist |
| **GPU attestation** | The GPU is a genuine confidential GPU | NVIDIA attestation of `nvidia_payload` (**not implemented**, see matrix) |

Venice runs its `e2ee-*` models inside **Phala**'s dstack confidential compute;
`tee_provider: phala` and `Dstack-TEE/private-ai-gateway` appear in the real
attestation. So Alice's verification ultimately checks **Phala's TEE**, a party
distinct from Venice.

The key and nonce layout is implemented by the open-source
[`Dstack-TEE/vllm-proxy`](https://github.com/Dstack-TEE/vllm-proxy):
its ECDSA signing address is the Ethereum address of the same secp256k1 key
used for E2EE, and its v1 report layout is
`address[20] || zero-padding[12] || nonce[32]`. Alice also validates this
against a production vector. Venice still needs to confirm that this component
and version are the authoritative deployment behind its current endpoints.

## What each party can see

- **Leaves the device:** the requested model id, ordinary network metadata (IP,
  timing, sizes), and prompts/responses **only as ciphertext**.
- **Cloudflare (Alice Worker):** ciphertext, the model id, request/response
  sizes and timing, the Venice API key it attaches. It **cannot** decrypt (it
  holds no client key) and logs only `route, status, duration, model,
  approxBytes` — never bodies.
- **Venice, outside the enclave:** ciphertext and metadata. Not the plaintext.
- **Phala / PCCS:** the **public** DCAP collateral (certificates, TCB info). No
  prompt, no response. With the collateral relay enabled, Phala sees the
  Worker's IP, not the user's.
- **The enclave (Intel TDX):** the plaintext prompt and response — that is the
  one place decryption happens, and attestation is our evidence about what runs
  there.

## The Worker's exact role

- **Protects the API key** — held as a Wrangler secret, attached server-side.
- **Relays already-encrypted data** — passes the request/response stream through
  untouched; refuses any chat request missing the `X-Venice-TEE-*` headers, so
  it can never be a plaintext relay.
- **Never holds the decryption key** — the client session secret is generated on
  the device and wiped after each request; it is never sent.
- **Relays DCAP collateral** (`/pccs/*`) from a **fixed** upstream, GET-only,
  path-allowlisted, no body logging — it cannot be turned into an open proxy,
  and the client still verifies the quote itself.

## Cryptographic checks Alice performs (the chain)

In order, **fail-closed at every step** — nothing is sent until all required
steps pass:

1. generate a 32-byte random nonce;
2. fetch the attestation for the exact model;
3. verify the nonce matches both the response and bytes 32–63 of the
   DCAP-verified `report_data` (freshness / anti-replay);
4. parse the Intel TDX quote;
5. DCAP-verify the quote against Intel's trust chain;
6. enforce the TCB policy (**beta: `UpToDate` only**);
7. reject a debug-mode enclave;
8. bind the E2EE key to `report_data`;
9. pin MRTD/RTMR0-2 and RTMR3 to an approved reference (when a policy is
   configured);
10. verify NVIDIA attestation when required (not yet implemented);
11. only then create the session key and send.

Implemented in `packages/alice-ai/src/venice-attestation-chain.ts`, composed
from `venice-dcap.ts`, `venice-attestation-verify.ts`, and
`venice-measurement-policy.ts`.

## Fail-closed policy

For **Private**, every one of these is a refusal — **no fallback to a non-E2EE
model, no silent fallback to standard Venice**:

missing attestation · DCAP unavailable · PCCS unavailable · refused TCB status ·
wrong/replayed nonce · key not bound · debug enabled · unknown measurement ·
NVIDIA required but unverified · AES-GCM decryption/auth failure · unexpected
plaintext response chunk.

Local and Custom AI are unaffected and keep working. The user sees a clear
message such as **"Private Cloud verification failed. No message was sent."**
Technical detail stays in developer logs and contains no secret, prompt,
response, or key.

## Assurance levels

`verifyAttestationChain` returns an explicit level:

- **`attested-unpinned`** — DCAP + non-debug + key binding verified, but
  measurements are **not** pinned. Proves *a genuine TDX enclave that committed
  to this key*, **not** *Venice's specific approved code*. **UI must not claim
  E2EE at this level.**
- **`pinned`** — the above plus measurements matched an approved reference.
- **`full`** — the above plus GPU attestation where required.

Today, with no published reference values, the reachable level is
`attested-unpinned`.

Alice fetches a new attestation and generates a new 32-byte nonce for every
encrypted send. It never caches an attestation or encryption key. Only public
PCCS collateral is cached, keyed by FMSPC + CA + TEE type, with a TTL capped by
Alice and by the signed TCB/QE `nextUpdate` values.

## Measurement rotation policy

`venice-measurement-policy.ts` holds a versioned list of approved references.
Each has an `id`, optional `label`/`source`, a validity window
(`notBefore`/`notAfter`), and a `revoked` flag. Rotation = add the new reference,
later revoke the old; both are valid during the cut-over. An **unknown**
measurement never passes (refuse, never "present so trust it"). The list ships
**empty** — values are not invented; they must come from governance (below).

## Dependencies and roots of trust

- **Intel** — DCAP trust chain (quote signature, TCB).
- **NVIDIA** — GPU attestation (where applicable; not yet wired).
- **Phala PCCS** (or a chosen PCCS) — public collateral only.
- **dstack governance** — `DstackKms.allowedOsImages`, `DstackApp` compose-hash
  whitelist; the authority for approved measurements.
- **Alice's distributed code** — the client that performs these checks; users
  trust the build they run.
- **`@phala/dcap-qvl`** `^0.6.1`, Apache-2.0, pure JS (no WASM), ~156 KB +
  transitive deps (all MIT/Apache). Past CVE-2026-22696 was fixed in 0.3.9.

## Limits and remaining assumptions

- Measurement **reference values** are not yet available, so pinning is not
  active; assurance is `attested-unpinned`.
- **NVIDIA** GPU attestation is not verified.
- Venice has not yet confirmed that the inspected `Dstack-TEE/vllm-proxy`
  report-data layout is the exact deployed version. Alice nevertheless treats
  the observed binding as mandatory and fails closed if it differs.
- DCAP verification and the collateral relay reduce, but do not remove, trust in
  Phala's PCCS availability and Intel's/NVIDIA's roots.
- Assistant history is **dropped** in Private (Venice does not encrypt assistant
  turns); Private turns are single-shot and auto-continuation is disabled.
- Mobile (Android/iOS) DCAP execution is **not yet runtime-tested**.

## Reproducing the checks (developers)

```bash
npm test          # unit tests, incl. the fail-closed matrix
npx tsc --noEmit -p packages/alice-ai/tsconfig.json
npx tsc --noEmit --incremental false -p apps/app-web/tsconfig.json
npx tsc --noEmit --incremental false -p apps/wallet-mobile/tsconfig.json
npm --workspace @alice-wallet/app-web run build
```

To obtain and pin real measurements, run Phala **trust-center** / dstack-verifier
against Venice's dstack app-id, read the approved OS image and compose-hash from
`DstackKms`/`DstackApp`, and add them to the measurement policy. Do not copy
values from a single production response.

## Status matrix

| Item | State |
| --- | --- |
| AES-256-GCM / ECDH / HKDF encryption | **implemented + verified** (round-trips against production) |
| Streaming decrypt, fail-closed, no plaintext shown | **implemented + verified** (unit tests) |
| Nonce freshness / anti-replay | **implemented + verified** in DCAP-signed `report_data`; fresh attestation per send |
| DCAP quote verification (signature + TCB) | **implemented**; live production attestation returned `UpToDate`; unit-tested with injected verifier |
| Strict TCB policy (`UpToDate`) | **implemented + verified** |
| Debug-mode rejection | **implemented + verified** |
| Key ↔ report_data binding | **implemented + verified** (real vector + dstack source); deployed version awaits Venice confirmation |
| Measurement pinning mechanism (rotation/revocation) | **implemented + verified** |
| Measurement reference **values** | **externally blocked** — needs Venice/dstack governance data |
| NVIDIA GPU attestation | **pending** — not implemented; fail-closed when required |
| Collateral relay Worker | **implemented + unit-tested + deployed**; public PCCS routes and issuer-chain headers live-tested |
| Client wiring into the live send path | **implemented + live-tested**; encrypted prompt returned and decrypted as `OK`; `verified: true` is ignored |
| Assurance metadata | **implemented** through `AIResponse.privacyAssurance`; no full-E2EE UI claim |
| Web DCAP execution | **production build passes**; DCAP lazy-loaded to avoid initial-bundle cost |
| Tauri DCAP execution | **not runtime-tested** |
| Android / iOS DCAP execution | **Metro/Hermes export passes**; real device runs still required |

**Not ready to display "E2EE verified".** Reason: measurement pinning is not
active (no reference values) and NVIDIA attestation is unimplemented, so the
reachable assurance is `attested-unpinned`.

## Incidents and revocation

- Revoke a compromised or superseded measurement reference by setting `revoked:
  true` (or removing it) in the policy and shipping an update; unknown values
  already fail closed.
- On a suspected key compromise, rotate the Venice API key (Worker secret) and
  review Worker access logs. Public collateral is unrelated to that secret;
  attestations and encryption keys are never cached.
- Report suspected issues via `SECURITY.md`.

## What to ask Venice / Phala

1. The **dstack app-id** (and `DstackApp` / `DstackKms` addresses) for
   `e2ee-gpt-oss-120b-p` and `e2ee-glm-5-2-p`, to derive approved measurements.
2. The **approved OS image** measurements (MRTD/RTMR0-2) and **compose-hash**
   (RTMR3), plus the **governance owner** and any **multisig/timelock** and
   **rotation procedure**.
3. Whether these models **require NVIDIA** GPU attestation, and the official
   verifier/endpoint to check `nvidia_payload`.
4. Whether a **non-`UpToDate`** TCB status is ever expected, and if so which.
