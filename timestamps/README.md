# Bitcoin timestamps for Alice releases

Each released version is anchored in the Bitcoin blockchain with
[OpenTimestamps](https://opentimestamps.org). Anyone can then prove that the
source of a given version existed at a given date, without trusting Alice,
GitHub, or any third party.

## What is stamped

OpenTimestamps anchors the hash of a **file**, so each release has a small
text file naming exactly what it points to:

| File | Content | SHA-256 |
| --- | --- | --- |
| `v0.0.1.txt` | repository, tag `v0.0.1`, full commit `2b9f3e85f51da85a120669443819ccd58f36e5c2` | `50eb3067a50adf6dabc29c99054e92861e5d30946c95cc9b0d7f150546cc14a8` |

The proof lives beside it as `v0.0.1.txt.ots`.

Stamping the file rather than the commit object is deliberate: the file binds
the tag name to the full commit hash in one place, stays readable, and does
not depend on how Git stores objects.

## Verifying a timestamp

Install the client (Node, no account, no key):

```bash
npx --yes opentimestamps verify timestamps/v0.0.1.txt.ots
```

The client re-reads `timestamps/v0.0.1.txt`, recomputes its SHA-256, follows
the proof to a Bitcoin block, and prints the block time. To check that the
timestamped commit is the one you have:

```bash
git rev-parse v0.0.1^{commit}
```

The hash it prints must match the `commit:` line inside `v0.0.1.txt`.

## Completing a fresh proof

A new stamp is not anchored immediately. Calendar servers batch pending
hashes and publish them in a Bitcoin transaction, so for a few hours the
proof reads `Pending confirmation in Bitcoin blockchain`. Once a block has
included it, complete the proof and commit the upgraded file:

```bash
npx --yes opentimestamps upgrade timestamps/v0.0.1.txt.ots
```

Only the hash ever leaves the machine, never the file or the source.

## Status

- `v0.0.1` submitted 2026-08-10 to four calendars
  (opentimestamps.org a/b, eternitywall, catallaxy), awaiting its block.
  Run the upgrade command above, then commit the completed proof.
