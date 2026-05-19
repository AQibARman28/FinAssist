# Key management

**Status:** current — env-var-only.
**Phase that wrote this:** SEC-1 Phase 5.
**Not blocking rollout.** KMS migration is a documented follow-up.

This doc covers every long-lived secret the request path needs, where it
lives today, and what we want it to look like once we move off
`process.env` to a managed key service.

## Inventory

| Secret | Purpose | Bytes | Where it is now |
|---|---|---|---|
| `JWT_SECRET` | HS256 signs access tokens (15-min TTL) | ≥32 | `Backend/.env` |
| `MASTER_ENCRYPTION_KEY` | AES-256-GCM wraps every user's per-user dataKey | 32 | `Backend/.env` |
| `EMAIL_HASH_SECRET` | HMAC-SHA256 keys the `User.emailHash` lookup | ≥32 | `Backend/.env` |
| `SMTP_PASS` | SMTP auth for the verification mailer | — | `Backend/.env` (optional) |
| `MONGO_URI` | DB connection (contains the cluster password) | — | `Backend/.env` |

Refresh tokens are NOT signed — they are 32 random bytes per session, the
plaintext lives only in the `fa_refresh` cookie, and the DB stores
sha256(plaintext) in `RefreshToken.tokenHash`. There is no
`REFRESH_TOKEN_SECRET`.

Per-user RSA-2048 and ECC P-256 private keys are AES-encrypted by the
user's dataKey and stored inside the User document. They derive their
secrecy from `MASTER_ENCRYPTION_KEY` — there is no separate per-user
KEK in env.

## What env-only buys us

- Simple. No external dependency.
- Reproducible local dev (each developer has their own `.env`).
- Boot-time validation (added in Phase 5): the server refuses to start
  if `JWT_SECRET`, `MASTER_ENCRYPTION_KEY`, or `EMAIL_HASH_SECRET` is
  missing or shorter than 32 bytes (`Backend/index.js`).

## What env-only does NOT buy us

- **Rotation without a redeploy.** Changing `JWT_SECRET` invalidates
  every live access cookie immediately (refresh tokens survive because
  they aren't signed). Changing `MASTER_ENCRYPTION_KEY` is far harder
  — see [rotation procedure](#rotation-procedure-master_encryption_key)
  below.
- **Audit of who-read-what.** `.env` is a file; anyone with shell or
  filesystem access to the server can read every secret. No audit trail.
- **Separation of duties.** The same process that does encrypted
  business logic also holds the master key in its memory. A future
  KMS-backed design keeps the master key in the KMS and only ever
  exchanges per-user dataKeys with the API.

## Target: AWS KMS or HashiCorp Vault

The migration target is a managed key service. Recommended shape:

- `MASTER_ENCRYPTION_KEY` becomes a **CMK in KMS**. The Node process holds
  only an IAM/role credential that authorizes `Encrypt`/`Decrypt` on
  that CMK. On boot, the process does NOT pull the raw key into memory.
- Per-user `encryptedDataKey` blobs become KMS-wrapped: every call to
  decrypt a user's dataKey is a `kms.Decrypt(encryptedDataKey)` API call
  rather than a local `aes-256-gcm` decrypt under the env var.
- `JWT_SECRET` and `EMAIL_HASH_SECRET` move to Vault / AWS Secrets
  Manager with short-lived dynamic creds. Rotation becomes
  configuration, not redeploy.
- KMS request volume cost: 1 KMS call per `protect` middleware run is
  expensive. Mitigation: the existing per-user-dataKey design already
  caches the decrypted dataKey on `req.dataKey` for the duration of one
  HTTP request, so the only extra cost is one KMS call per request.
  Acceptable at our scale (≤O(100) RPS); revisit at higher volume with
  a short-TTL in-process cache of the unwrapped dataKey.

## Rotation procedure (MASTER_ENCRYPTION_KEY)

Already scaffolded — `utils/keyManagement.rotateUserDataKey(user, oldMasterDecrypt, newMasterEncrypt)`.

Procedure (offline window of ~minutes for a small user base; for a large
user base, the loop is incremental and online):

1. Generate the new master key: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
2. Stand up the new key alongside the old one. Two env vars:
   `MASTER_ENCRYPTION_KEY` (new) and `MASTER_ENCRYPTION_KEY_OLD` (old).
3. Add a one-shot script `Backend/scripts/rotate-master-key.js` (NOT
   yet written — separate ticket) that:
   - Reads every user.
   - For each, calls `rotateUserDataKey(user, oldDecrypt, newEncrypt)`.
   - Sets `encryptedDataKey` and bumps `keyVersion`.
4. Once the script finishes, drop `MASTER_ENCRYPTION_KEY_OLD` from env
   and redeploy.

Note: rotation re-wraps the dataKey only; it does NOT re-encrypt every
ciphertext (descriptions, notes, 2FA secrets) — those are still under
the same dataKey, which hasn't changed.

## Rotation procedure (EMAIL_HASH_SECRET)

`Backend/scripts/migrate-email-hash.js` already exists from Phase 2.
Same playbook as a key rotation: deploy with the new secret, run the
script, deploy. The migration is idempotent.

## Rotation procedure (JWT_SECRET)

Disruptive — every fa_access cookie becomes invalid immediately. Users
re-authenticate via the refresh-token path (which doesn't sign with
JWT_SECRET); if the access fails 401, the axios refresh interceptor on
the frontend kicks in and a new fa_access is minted with the new
secret. Net effect: a transparent re-auth blip for active users.

For a smoother rotation: support BOTH old and new secret on
`verifyJwt` for one access-token TTL (15 min), then drop the old.
Not implemented today; a small change in `nativeCrypto.verifyJwt` would
suffice.

## Operational checks

- `npm run security:audit` — fails the build on `--audit-level=high`
  npm advisories.
- Boot-time secret presence + length validation — see
  `Backend/index.js` `_checkSecrets()`.
- The dev `.env.example` enumerates every required secret.

## Out of scope here

- mTLS between API and Mongo (Atlas handles this).
- Code signing / supply-chain integrity (`npm audit` is what we have;
  consider Sigstore, npm-provenance for v2).
- HSM-backed CMK (overkill at our threat model; KMS-backed CMK is
  enough).
