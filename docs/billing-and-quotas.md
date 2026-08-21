# Alice billing and quotas

Alice sells Private Cloud access. She does not sell the wallet, the local AI,
the RAG, backup, recovery or anything a user needs to keep their bitcoin safe.
Those stay free, and stay free deliberately.

## Deep Research, and why it is not for sale

Cloud+ sold 5 Deep Research runs a month for twice the price of Cloud. It was
withdrawn on 19 August 2026, after the first run in production proved it could
not do the one thing its name promised.

The machinery worked. The plan gate, the credit accounting, the model routing,
the 500 000 token context: all of it ran correctly the first time it was
exercised. What came back was a bigger model answering from memory, in 1.5
seconds, with no sources. Research is not a longer answer.

**The cause is structural, and it is worth writing down so nobody spends a week
rediscovering it.** Venice does offer web search, and the catalogue advertises
`supportsWebSearch: true` on `e2ee-glm-5-2-p`. Alice set
`enable_web_search: 'on'` server-side, on the Deep Research path only, never
forwarded from the client. It was delivered: the request grew by exactly the 75
bytes of the added fragment. It changed nothing.

It cannot work. The search subsystem has to read the question in order to
search for it, and under E2EE the question is ciphertext addressed to the
enclave. Venice accepts the switch and ignores it, because there is nothing it
can read.

And this is not a Venice limitation. **Searching the web means telling someone
what you are looking for.** No provider can look something up on a user's
behalf without learning what they wanted. End-to-end encryption and server-side
research exclude each other by nature, not by implementation.

Two ways forward exist, whenever this is picked up again:

- **run the research unencrypted, and say so.** Deep Research alone would use a
  plaintext model with search and citations, with a plain sentence next to the
  button saying that this one request leaves the private cloud. Honest, and
  about an hour of work.
- **search from the client.** The app finds and fetches the pages itself, then
  encrypts them with the question. The model still sees only ciphertext. In a
  browser, CORS forbids fetching arbitrary pages, so this needs a relay, and
  the relay would see the queries: the problem moves rather than disappears.
  On desktop and mobile it is clean.

Nothing of it remains in the code. `PaidPlan` is `'cloud'` alone, the Deep
Research model is unreachable, the toggle is gone from both apps, and migration
0020 removes the plan from the schema as well: the two columns that metered the
runs, the single entitlement and the single invoice, all of them from the
operator's own test purchase against their own store.

Keeping the plumbing dormant was the tempting option and the wrong one. A
column no code writes is a question every future reader answers twice, once to
find what fills it and once to find that nothing does. The design is written
down here instead, which is where it belongs, and git holds the code.

The costing below is kept as it was written. It is still correct arithmetic,
and it is the reason the feature would be worth building properly rather than
quietly dropping.

### Why five, and why a context limit

The Deep Research model costs roughly thirteen times the standard one on input
and nine times on output. At the full 500 000 token context, a single run is
about 0.80 EUR of inference. The arithmetic decides the grid:

| runs per month | context per run | worst case | margin on 10 EUR |
|---|---|---|---|
| 21 | unlimited | 13.98 EUR | **-3.98 EUR** |
| 5 | 500 000 tokens | 5.70 EUR | 4.30 EUR (43%) |

Twenty-one runs at that size cost more than the plan sells for. Five leave a
margin that survives VAT, and a calibration ratio wrong by a quarter, without
turning a paying customer into a loss.

Two limits enforce it, and both matter. The count is the entitlement's
allowance. The size is `DEEP_RESEARCH_MAX_TOKENS`, converted to bytes with the
same calibration ratio the rest of the meter uses, because tokens cannot be
counted through the encryption. Without the second, a run costs whatever the
sender decides to put in it.

There is no free trial run. One would cost about 0.80 EUR per account created,
with nothing collected against it and nothing preventing repeat signups: it
would be the most expensive line in the product.


## Prices are satoshis

Nothing quotes a euro figure to a buyer. The plans stay anchored to 5 and 10
EUR server-side, because Venice bills in fiat and a plan denominated in
satoshis would make revenue swing with the exchange rate while the costs
underneath did not. That anchor is internal. What a buyer sees, and what the
BTCPay invoice asks for, is a satoshi amount.

The quote has to hold still to be a price at all:

- one exchange rate is pinned in `sat_price_pin` and everything quotes from it,
  so the figure cannot tick while somebody is reading it;
- the hourly cron replaces the pin only when it is more than 24 hours old or
  the live rate has moved by 5 percent or more (`SAT_PRICE_MAX_DRIFT`);
- quotes round to the nearest `SAT_PRICE_STEP` satoshis, 100 by default, to the
  nearest rather than upward: rounding up on every sale would be a surcharge
  small enough that nobody would notice, and wrong for that reason;
- the invoice is created in BTC for exactly the quoted amount, so the payment
  page never shows a different number than the app did.

A missing rate produces no price rather than a fallback in the wrong unit, and
the buy button goes dead until the cron restores one. Rate source is Coinbase
spot, the same feed the wallet uses for balance conversion.

The anchor is printed under the satoshi figure as a landmark, with a "roughly"
sign in front of it: `5,600 SATS / month`, then `~ 5 EUR`. It is the same price
read a second way for people who still think in fiat, never a second price, and
never the amount charged. Rounding and a pinned rate mean the two agree closely
and not exactly, which is what the sign is there to say. The day fiat payment
exists, the anchor stops being a landmark and becomes a price a buyer can
choose to pay in.


## Plans

| Plan | Price | Chat allowance |
| --- | --- | --- |
| Free | 0 | 21 Private Cloud requests in total |
| Cloud | 5 EUR / month | 8M input + 2M output tokens per month |

One paid plan, on purpose. Cloud buys the larger model in the private cloud for
someone who cannot or would rather not run one on their own machine, and that
is the whole offer. Cloud+ was withdrawn; the section above says why, and what
it would take to bring Deep Research back properly.

Prices and allowances are Worker variables, never constants in code. See
`PLAN_CLOUD_PRICE_CENTS`, `PLAN_INPUT_TOKENS` and `PLAN_OUTPUT_TOKENS` in
[wrangler.toml](../apps/venice-proxy-worker/wrangler.toml).

Local AI is unlimited on every plan, including Free. It runs on the device and
costs Alice nothing, so metering it would be a pure product tax.

## Payment

Payment is Bitcoin only, through BTCPay Server. There is no card on file, no
saved payment method and no direct debit, which has one consequence worth
stating plainly: **a plan cannot renew itself.** It runs out, and the user
decides whether to buy another month.

Everything in the billing code is built around that fact:

- A plan can be prepaid for up to 24 months in a single invoice.
- Paid time is **added** to whatever remains, never substituted for it. Buying
  three months with ten days left leaves three months and ten days. Losing
  prepaid time for renewing early would be the worst possible reward for
  paying ahead.
- Only a signed BTCPay webhook can grant a plan. A client that closes the
  payment page, replays a response or forges a success reaches nothing.
- The allowance period rolls every 30 days from the first purchase, so
  prepaying six months yields six renewals with no scheduled job.

Alice puts nothing on the invoice except her own internal reference: no email,
no username, no account identifier that the payment processor could use to
build a picture of who buys what.

## How the quota is measured

This is the part worth understanding, because Alice measures something
slightly different from what she advertises, and says so.

### Why tokens cannot be counted

The Worker is a blind relay. Requests and responses are end-to-end encrypted
between the client and Venice's TEE, and the response stream is passed straight
through without ever being buffered or read. The Worker therefore **cannot see
`usage.prompt_tokens` or `usage.completion_tokens`**. Only the client can, after
decryption.

Removing that limitation would mean decrypting user traffic, which is precisely
what Alice is built not to do. So the limitation stays.

### What is counted instead

Alice counts **the bytes of encrypted payload that pass through her**. Input
size is known exactly when the request arrives. Output bytes are added up as
the stream flows past, by a counter that sums chunk lengths and never reads,
copies or holds a chunk.

Ciphertext length tracks plaintext length, so bytes are a faithful proxy for
tokens once multiplied by a calibration constant, `BYTES_PER_TOKEN`, which
defaults to 3.7 for French and English prose.

Bytes are the unit of record. Tokens are a presentation unit derived from them.

### How accurate this is

Accurate enough to bill fairly, not accurate enough to display as an exact
figure. The ratio between bytes and tokens moves with the content:

- code and JSON produce more tokens per byte than prose;
- accented characters cost two bytes in UTF-8 and often split into several
  tokens;
- emoji are the worst case on both counts;
- if Venice ever bills a cached context at a lower rate, bytes will not see it.

Expect the measured total to sit within roughly 10 to 25 percent of what Venice
actually bills, depending on what people write.

Crucially, the error is close to a constant scale factor rather than noise. Two
users who write the same amount are charged the same amount. What shifts is how
generous the plan really is compared to the advertised 8M tokens, and that is
what calibration corrects.

### Calibration

Once a month, compare the Worker's total metered bytes with Venice's invoice
for the same period, and adjust `BYTES_PER_TOKEN`. Both figures are global
totals. **No per-user measurement is involved, or needed.**

Note that Venice itself cannot attribute usage to an Alice account: the Worker
talks to Venice with a single API key on behalf of everyone. That is a privacy
property, not an obstacle to work around.

Free requests are measured too, and charged nothing for it. They are metered in
requests, so no quota depends on their weight, but their byte figures are
written to the ledger row they already create. Without that, the ratio could
only be checked after plans had been sold, which means selling an allowance
whose real size nobody has verified. With it, the first month of ordinary free
traffic is enough to calibrate.

The query is the same on both sides of the plan line:

```sql
SELECT SUM(input_bytes) AS input_bytes, SUM(output_bytes) AS output_bytes
FROM cloud_request_ledger
WHERE status = 'confirmed' AND created_at >= ? AND created_at < ?;
```

Against Venice's export, whose `promptTokens` and `completionTokens` columns
give the other half. One ratio for input, one for output: they are not the same,
because a prompt carries JSON structure and history that an answer does not.

### What the user sees

- The site advertises the plan in millions of tokens, which is the unit
  customers compare across products.
- The account screen shows **a percentage**, with the note that the figure is
  estimated from the volume of encrypted data, because the messages themselves
  are end-to-end encrypted and Alice cannot read them.
- Alice never displays a precise token count. "7,843,219 tokens remaining"
  would be a wrong number wearing the costume of an exact one.
- Deep Research runs are counted individually, not in bytes. 21 runs means 21
  runs, with no approximation anywhere.

### Reservation and settlement

A response's size is only known once it has finished streaming, so each paid
request is charged in two steps:

1. **Reserve.** The exact input size, plus the worst-case output implied by the
   request's `max_tokens` ceiling, is charged up front. Reserving high means
   many requests started at once can never overshoot an allowance.
2. **Settle.** Once the stream ends, the reservation is replaced by the real
   figure. In practice this is nearly always a refund, since few answers reach
   the token ceiling.

A request that fails before Venice answers is refunded in full. A request that
dies mid-stream keeps its reservation, which errs conservatively.

Every charge is keyed on the client's request id, so a retry is never billed
twice.

## Renewal reminders

Alice's sign-in stores only `hmac(email)` and a masked label whose local part is
destroyed. She is therefore structurally unable to email a user who has not just
asked her to. That property is worth keeping, so renewal reminders are opt-in
rather than automatic.

A user on a paid plan may add a **billing address**, used for renewal reminders
and nothing else. It is:

- encrypted with AES-GCM under `BILLING_EMAIL_KEY`, a Wrangler secret that
  never touches the database;
- decrypted only by the reminder cron, never displayed in the admin console,
  never logged;
- removable in one call, and deleted automatically 30 days after the plan ends.

Encryption here protects the address against a database leak or a stray backup.
It does not, and cannot, hide it from Alice's own infrastructure, since the
Worker must decrypt it to send the mail. The interface says exactly that rather
than promising more. An alias is a perfectly good address to give, and the
interface says that too.

Two reminders are sent, and only two: **three days before expiry, and on the
day itself.** Each send is recorded before it is attempted, keyed on the expiry
it refers to, so an hourly cron that runs twice cannot mail anyone twice.

The message says what is true: nothing will be charged, nothing will happen by
itself, and the wallet, the local AI and the user's data are unaffected either
way.

## Endpoints

| Route | Method | Purpose |
| --- | --- | --- |
| `/billing` | GET | Plan, expiry, usage percentage, billing address |
| `/billing/checkout` | POST | Create a BTCPay invoice for a plan and month count |
| `/billing/contact` | PUT | Add or replace the renewal-reminder address |
| `/billing/contact` | DELETE | Forget the address immediately |
| `/billing/webhook/btcpay` | POST | BTCPay callback, signature-gated |

## Configuration

Secrets:

```
npx wrangler secret put BTCPAY_API_KEY
npx wrangler secret put BTCPAY_WEBHOOK_SECRET
openssl rand -base64 48 | npx wrangler secret put BILLING_EMAIL_KEY
```

Leaving `BTCPAY_*` unset makes checkout answer 503 and changes nothing else,
which is the state the Worker ships in until the store is live. Leaving
`BILLING_EMAIL_KEY` unset disables reminder storage and sending; the rest of
billing still works.

Rotating `BILLING_EMAIL_KEY` makes stored addresses undecryptable, so reminders
stop rather than going to the wrong person.
