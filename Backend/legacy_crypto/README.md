# legacy_crypto/

This directory holds the original from-scratch crypto implementations that
predated SEC-1 Phase 1. They are **kept as an academic artifact** — built for
a university crypto course — and are **not used by the FinAssist request
path** as of `feat(crypto): replace python subprocess with node:crypto +
argon2id` (sprint SEC-1).

> **Not constant-time. Never use this code with real keys or real user
> data.** See [Known limitations — not constant-time](#known-limitations--not-constant-time).

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
- `check-no-imports.js` — CI guard that fails if anything outside this
  directory uses it (see [Do not import from here](#do-not-import-from-here)).

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

| Package        | Used for                                            |
|----------------|-----------------------------------------------------|
| `argon2`       | password hashing (argon2id, OWASP 2023)             |
| `speakeasy`    | TOTP RFC 6238 (SHA-256 by default, to match legacy) |
| `jsonwebtoken` | HS256 JWTs                                          |

## Do not import from here

Importing `legacy_crypto/*` from anywhere outside this directory is a bug.
`check-no-imports.js` enforces it: it walks `Backend/` (skipping
`node_modules/`, `legacy_crypto/` and `.git/`) and exits non-zero if any
JS/TS or Python file requires/imports `legacy_crypto`, `pyCrypto` or
`crypto_cli`, or loads `child_process` and names a Python interpreter or
`.py` script. Comments are ignored, so documentation may still mention
these names.

```bash
cd Backend
node legacy_crypto/check-no-imports.js              # 0 = clean, 1 = violation, 2 = error
node legacy_crypto/check-no-imports.js --self-test  # built-in positive/negative fixtures
```

`Backend/package.json` exposes it as `npm run check:legacy-crypto`; it should
run in CI on every push.

## Running the tests

```bash
cd Backend/legacy_crypto/scratch
node sha256.js          # …and each other primitive: embedded self-tests
node __test_rsa.js      # …and each __test_*.js: differential harnesses
                        #    (vs node:crypto, jsonwebtoken, speakeasy)
```

The Python files have the same embedded self-tests (`python rsa.py` from
`scratch_python/`; `crypto_cli.py --selftest` for the dispatcher). The
`pbkdf2.py` self-test runs 100,000+ pure-Python HMAC iterations and takes
several minutes.

### Known-answer vectors and their sources

| Primitive | Vectors | Source |
|---|---|---|
| ECDSA P-256 / SHA-256 | key pair x / U, signatures for "sample" and "test" (verify + x·G == U) | RFC 6979 Appendix A.2.5 — https://www.rfc-editor.org/rfc/rfc6979.txt |
| JWT HS256 | JWK key, JWS signing input, expected signature | RFC 7515 Appendix A.1 — https://www.rfc-editor.org/rfc/rfc7515.txt |
| RSA-OAEP-2048 SHA-256 / MGF1-SHA-256 | 6 valid + 11 invalid decrypt cases (label-free) | Project Wycheproof — https://raw.githubusercontent.com/C2SP/wycheproof/main/testvectors_v1/rsa_oaep_2048_sha256_mgf1sha256_test.json |
| PBKDF2-HMAC-SHA256 | c=1 and c=80,000 vectors | RFC 7914 §11 |
| HMAC-SHA256 | test cases 1–3 | RFC 4231 |
| AES-256-GCM | 3 vectors (empty PT; 16-byte zero PT; 60-byte PT + 20-byte AAD) | labelled "NIST SP 800-38D" in the self-tests (pre-existing) |
| TOTP SHA-256 | Appendix B vectors | RFC 6238 |

## Known limitations — not constant-time

This code is written to be read, not to resist side channels. The
primitives below have secret-dependent timing (and, for table lookups,
secret-dependent memory access). This is inherent to the teaching design
and is deliberately **not** patched with half-measures: doing it properly
means bitsliced or hardware AES, carry-less-multiply GHASH, a constant-time
field implementation with a fixed-window or ladder scalar multiplication,
and blinded fixed-window RSA — a rewrite, not a fix. Each affected file
starts with a one-line `WARNING: NOT CONSTANT-TIME` header.

| Location | Secret exposed | Mechanism |
|---|---|---|
| `scratch/aes256gcm.js:98` (`S_BOX`), `:188-190` (`subBytes`), `:320`, `:331` (`keyExpansion` SubWord) · `scratch_python/aes256gcm.py:113`, `:169-177`, `:297`, `:308` | AES key and state bytes | 256-entry S-box table indexed by secret bytes → cache-timing attacks (Bernstein 2005; Osvik–Shamir–Tromer 2006). |
| `scratch/aes256gcm.js:170-176` (`gmul`, used by MixColumns) · `scratch_python/aes256gcm.py:146-163` (`_gmul`) | AES state bytes | Branches on data bits (`if (b & 1)`, `if (hi)`). |
| `scratch/aes256gcm.js:410-433` (`ghashMultiply`) · `scratch_python/aes256gcm.py:365-403` (`_ghash_multiply`) | GHASH key H = AES_K(0¹²⁸), hence forgery ability | One branch per bit of the operand (`if ((X[xByte] >> xBit) & 1)`) and per reduction (`if (lsb)`). |
| `scratch/ecdsaP256.js:440-449` (`scalarMultiply`) · `scratch_python/ecdsa_p256.py:343-360` (`scalar_multiply`) | Nonce k (signing), private key d (key generation) | Double-and-add: one conditional add per secret bit, and the loop length equals the bit length of the scalar — the nonce-length leak that Minerva and TPM-Fail (2019) turned into key recovery with lattice attacks. |
| `scratch/ecdsaP256.js:382`, `:410` (`pointDouble`, `pointAdd`) · `scratch_python/ecdsa_p256.py:287`, `:312` | Intermediate points of k·G | Special-case branches and per-operation modular inversion. |
| `scratch/ecdsaP256.js:193-203` (`modPow`), `:218` (`modInverse`), `:545-546` (k⁻¹ and s) · `scratch_python/ecdsa_p256.py:163-181` (`mod_pow`), `:188-203` (`extended_gcd`, `mod_inverse` — iteration count depends on k), `:435-436` | k, d | JS BigInt and Python int arithmetic run in time that depends on operand values. |
| `scratch/rsa.js:183-193` (`modPow`), `:480-485` (`rsaDecryptRaw`, c^d mod n) · `scratch_python/rsa.py:124-154` (`mod_pow`), `:420-432` (`rsa_decrypt_raw`) | Private exponent d | Square-and-multiply branches on every bit of d (Kocher 1996); no base blinding, no CRT, variable-time big-integer arithmetic. |
| `scratch/rsa.js:601-637` (`oaepDecode` separator scan) · `scratch_python/rsa.py:525-575` (`oaep_decode`) | OAEP padding validity (a Manger oracle) | All failures raise the same error, but the JS scan branches on decoded bytes, and the Python version's flag arithmetic runs on an interpreter that gives no timing guarantee. |
| Every "constant-time" compare (GCM tag, JWT signature, PBKDF2 hash, TOTP code) in both languages | MAC / hash bytes | Loop-and-OR with no early exit; that is best effort under a JIT or the CPython interpreter, not a guarantee. |
