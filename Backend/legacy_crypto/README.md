# legacy_crypto/

This directory holds the original from-scratch crypto implementations that
predated SEC-1 Phase 1. They are **kept as an academic artifact** — built for
a university crypto course — and are **not used by the FinAssist request
path** as of `feat(crypto): replace python subprocess with node:crypto +
argon2id` (sprint SEC-1).

## What is here

- `pyCrypto.js` — Node-side bridge that spawned `python` as a one-shot
  subprocess per crypto call. Replaced by `Backend/utils/nativeCrypto.js`.
- `scratch_python/` — Python implementations of SHA-256, HMAC-SHA256,
  AES-256-GCM, PBKDF2-SHA256, RSA-2048 (+ OAEP), ECDSA P-256, JWT HS256,
  TOTP (RFC 6238). All written from primitive operations; no third-party
  crypto library calls beyond OS randomness.
- `scratch_python/crypto_cli.py` — JSON-over-stdio dispatcher used by
  `pyCrypto.js`.
- `scratch/` — parallel Node/JS implementations of the same algorithms,
  one file per primitive, plus `__test_*.js` test harnesses.

## Why kept (not deleted)

1. **Provenance**: the math is auditable and was the basis of the project's
   crypto exam. Useful for future students or reviewers asking "how does
   AES-GCM actually work."
2. **Migration material**: a future one-shot script that walks legacy
   hex-JSON RSA/ECC key bundles in the user collection and converts them to
   PEM may want the Python parsers as a reference (Node's `crypto` API does
   not accept hex-JSON RSA components directly).
3. **No-delete rule** from the SEC-1 brief.

## What is NOT here

The request-path crypto. That lives in `Backend/utils/nativeCrypto.js` and
the high-level wrappers `Backend/utils/encryption.js`,
`Backend/utils/keyManagement.js`, `Backend/utils/signing.js`. All of those
use Node's built-in `crypto` module plus three vetted npm packages:

| Package        | Used for                                  |
|----------------|-------------------------------------------|
| `argon2`       | password hashing (argon2id, OWASP 2023)   |
| `otplib`       | TOTP RFC 6238 (SHA-256 to match legacy)   |
| `jsonwebtoken` | HS256 JWTs                                |

## Do not import from here

Importing `legacy_crypto/*` from anywhere outside this directory is a bug.
A pre-commit grep guard would be a fine follow-up.
