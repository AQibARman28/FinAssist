# SEC-1 — ECDSA on records: kept, renamed, scoped

**Status:** accepted
**Phase:** SEC-1 Phase 2
**Field name:** `signature` → **`serverAttestation`** (Expense, Budget, Goal)

## Context

Phase 0 audit found that every record type (Expense, Budget, Goal) carries an
ECDSA-P256 signature stored alongside the data. The signing key is the user's
**per-user** ECC private key — but that private key is stored encrypted in
the User document under the user's data key, which is itself encrypted with
the system master key. **The server can decrypt and use any user's private
key at will.**

The original schema comment described the field as a "signature." That name
implies **non-repudiation** — i.e., the holder of the verifying public key
can convince a third party that **the user**, and only the user, signed the
record. That property does **not** hold here. The signer is the server,
which can mint a valid signature for any user, any value, any time.

## Decision

1. **Keep the field**, generated on create, verified on read.
2. **Rename it `serverAttestation`** to make the trust boundary honest. No
   future contributor should see "signature" and conclude that a record's
   provenance can be proven to a third party.
3. **Do not regenerate on update.** A signature over `{amount, category}`
   (Expense) or `{category, limit, month, year}` (Budget) or
   `{title, targetAmount, goalType}` (Goal) is set at create time only. If
   a user later updates one of those fields, `verifyRecord` will return
   false, and we log a `console.warn` from the read controllers. This is
   intentional — see "What this protects against" below.

## What this protects against (and what it does not)

`serverAttestation` is **server-attestation of the original create-time
values**. It detects:

- **Direct DB tampering.** Someone with write access to the MongoDB
  collection (escaped backup, leaked Atlas key, ops mistake) cannot mint a
  matching ECDSA signature for forged values without also having the user's
  encrypted ECC private key + the user's data key + the master encryption
  key. So a row-level edit shows up as a verification failure.
- **Silent data-at-rest corruption.** Disk corruption that flips a byte in
  `amount` or `category` produces a failed signature verification rather
  than a silently-wrong number.

It does **not** protect against:

- **A malicious server.** The server holds every key in the chain.
  Operator compromise lets the attacker forge `serverAttestation` for any
  value. Defending against a hostile operator requires client-side keys,
  which is out of scope for FinAssist (the threat model is a single-tenant
  personal-finance app).
- **Update-path tampering.** If an attacker rewrites a row's `amount` and
  the row was *already updated through the normal API* (so its
  serverAttestation was already stale and the warning was already
  expected), the verification miss is indistinguishable from a legitimate
  update. The warning carries no actionable signal in that case.

## Why not re-sign on update?

Three options were considered:

1. **Re-sign on every update.** Pro: the signature stays meaningful.
   Con: it dilutes the "create-time attestation" semantic. The new
   signature would attest to whatever the most recent server-side write
   said, which is essentially what AES-GCM auth tags already do for
   encrypted fields. Adds work without adding a property.
2. **Drop the field entirely.** Pro: simpler. Con: loses the
   create-time-tampering signal, which the original design did provide.
3. **Keep create-only, accept staleness, log on miss.** What we picked.
   The miss is a *signal* — somebody updated the record. For a finance
   app where most user-visible records (an expense entry) are typically
   write-once, a verification miss is rare and worth flagging.

## Migration

- DB field on **new** records: `serverAttestation` (PEM-keyed ECDSA-DER,
  base64).
- DB field on **old** records: `signature` (legacy). Old `signature` data
  is silently ignored by the new schema (Mongoose doesn't surface unknown
  fields). Verification of old records returns false → warn → continue.
  No active migration; old data just stops attesting. Acceptable because
  the *primary* integrity guarantee (AES-GCM tag on encrypted fields)
  still holds, and the signing-key migration at login from hex-JSON to
  PEM (SEC-1 Phase 1) would have invalidated old signatures regardless.

## Open follow-ups (out of scope this sprint)

- A monitoring rule that pages on a high rate of attestation failures
  across users (≠ stale-after-update; suggests systemic tampering).
- If a future sprint adds client-side keys, the field can either be
  promoted to a real `signature` (renaming again is fine) or kept as
  `serverAttestation` and a separate `userSignature` added.
