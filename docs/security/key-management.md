# Key management

**Status:** current — env-var secrets with key ids and zero-downtime rotation.
**Last revised:** 2026-10-20 (data-at-rest hardening; see `HARDENING-2026-10.md`).
**Follow-up:** a managed key service (KMS / Vault) — see the end of this doc.

## Inventory

| Secret | Purpose | Format | Rotation |
|---|---|---|---|
| `MASTER_ENCRYPTION_KEY` | AES-256-GCM wraps every user's data key | exactly 64 hex | `_PREVIOUS` + `rotate:master-key` |
| `MASTER_ENCRYPTION_KEY_PREVIOUS` | still unwraps keys during a rotation | exactly 64 hex | removed after the job |
| `JWT_SECRET` | HS256 signs access and 2FA-gate tokens | ≥ 32 bytes | `_PREVIOUS` for one access TTL |
| `JWT_SECRET_PREVIOUS` | still verifies tokens during a rotation | ≥ 32 bytes | removed after 15 min |
| `EMAIL_HASH_SECRET` | keyed HMAC-SHA256 blind index on email | exactly 64 hex | `migrate:email-hash` |
| `PROXY_SHARED_SECRET` | proves an API call came through the Next proxy | any long random | change on both hosts together |
| `RESEND_API_KEY` / `SMTP_PASS` | outbound email | provider format | at the provider |
| `MONGO_URI` | database connection (contains the DB password) | URI | at Atlas |

`utils/config.js` checks every one of these at boot and the API refuses to start on a
missing or malformed value — the format rules match what the crypto layer actually
needs, so a key that passes the check can't fail on the first request.

Refresh tokens are not signed: they are 32 random bytes per session, the plaintext
lives only in the `fa_refresh` cookie and the database stores its SHA-256.

## Ciphertext formats

| Prefix | What | Key | AAD |
|---|---|---|---|
| `mk2:<kid>:` | a user's data key, wrapped | master key with id `<kid>` (first 8 hex of its SHA-256) | `finassist/mk2/<kid>` |
| *(none)* | legacy wrapped data key | current, then previous master key | — |
| `v2:` | a field value (name, email, 2FA secret, private keys, descriptions, titles, notes) | the user's data key | `finassist/v2/<field>/<userId>` |
| *(none)* | v1 field value written before 2026-10 | the user's data key | — |

The AAD binds each field ciphertext to its owner and its field, so a blob copied onto
another user or into another field fails authentication. Decryption failure is never
papered over: the old `safeDecrypt` returned the stored value when decryption failed,
which let anyone with database write access plant text that displayed as real data.
Now a failed value reads as empty and is logged. `npm run migrate:field-encryption`
upgrades v1 values (and RSA-OAEP notes) to v2.

Per-user RSA-2048 and P-256 private keys are sealed under the user's data key in the
same way. P-256 signs record attestations; RSA only decrypts notes written before
notes moved to AES (RSA-OAEP-SHA256 holds at most 190 bytes).

## Rotation procedures

### MASTER_ENCRYPTION_KEY (no downtime)
1. Set `MASTER_ENCRYPTION_KEY_PREVIOUS` to the current key and `MASTER_ENCRYPTION_KEY`
   to a new one. Deploy. Both keys now unwrap; new wraps use the new key.
2. `npm run rotate:master-key` (dry run) then `npm run rotate:master-key -- --apply`:
   every data key is re-wrapped under the new master key. Field ciphertexts don't
   change — they're under the per-user data keys, which stay the same.
3. When the dry run reports 0 left, remove `MASTER_ENCRYPTION_KEY_PREVIOUS` and deploy.

### JWT_SECRET (nobody is signed out)
1. Set `JWT_SECRET_PREVIOUS` to the current secret and `JWT_SECRET` to a new one. Deploy.
   New tokens use the new secret; tokens signed with either verify.
2. After one access-token lifetime (15 minutes), remove `JWT_SECRET_PREVIOUS`.

### EMAIL_HASH_SECRET
Deploy with the new secret, run `node scripts/migrate-email-hash.js` (idempotent).

### PROXY_SHARED_SECRET
Change it on Vercel and Render in the same window; requests in flight during the switch
get a 403 and the client retries.

## What env-only still doesn't buy us

- **Audit of who read what.** Anyone with shell access to the server can read the env.
- **Separation of duties.** The API process holds the master key in memory.

## Target: AWS KMS or HashiCorp Vault

- `MASTER_ENCRYPTION_KEY` becomes a CMK in KMS. The API holds only a role credential
  allowed to `Encrypt`/`Decrypt` with it and never sees the raw key.
- `encryptedDataKey` becomes a KMS-wrapped blob; the `mk2:<kid>:` prefix already gives
  each wrapped key a key id, so KMS-wrapped keys can coexist with env-wrapped ones and
  migrate lazily.
- Every unwrap becomes an auditable KMS call.

## Operational checks

- CI runs `npm audit --omit=dev --audit-level=high` in both workspaces on every push.
- CI runs `node legacy_crypto/check-no-imports.js`: the from-scratch crypto lab must
  never be imported by the request path.
- The startup check (`utils/config.js`) covers every secret above.
