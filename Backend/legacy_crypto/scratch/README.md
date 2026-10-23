# Scratch Cryptography Implementations

This folder contains FinAssist's from-scratch implementations of the cryptographic primitives required by the CSE447 project specification. None of these files use Node's `crypto` module for the algorithm itself — only for entropy (`crypto.randomBytes`) where randomness is needed.

> **Teaching code — not constant-time.** Do not use it with real keys. It is not used by the live app (see `../README.md` and `../check-no-imports.js`).

| File | Algorithm | Status |
|---|---|---|
| sha256.js | SHA-256 hash | ✓ |
| hmacSha256.js | HMAC-SHA256 | ✓ |
| aes256gcm.js | AES-256-GCM | ✓ (not constant-time) |
| rsa.js | RSA-2048 + OAEP | ✓ (not constant-time) |
| ecdsaP256.js | ECC P-256 + ECDSA | ✓ (not constant-time) |
| pbkdf2.js | PBKDF2-SHA256 password hashing | ✓ |
| jwtScratch.js | JWT (HS256) | ✓ |
| totp.js | TOTP (RFC 6238) | ✓ |

Each file is self-contained. `node <file>.js` runs its embedded self-test (including official known-answer vectors: RFC 4231, RFC 6238, RFC 6979 A.2.5, RFC 7515 A.1, RFC 7914 §11 and a Project Wycheproof RSA-OAEP subset — sources in `../README.md`). Each `__test_<file>.js` harness cross-checks the scratch code against a reference implementation: Node's `crypto` module, `jsonwebtoken` (JWT) or `speakeasy` (TOTP, the library production uses).

## Known limitations — not constant-time

The table below covers this folder; the Python ports in `../scratch_python/` have the same issues (line numbers in `../README.md`). These are inherent to the readable, teaching-oriented design and are intentionally not "fixed" with partial measures. The affected files start with a one-line `WARNING: NOT CONSTANT-TIME` header.

| Location | Secret exposed | Mechanism |
|---|---|---|
| `aes256gcm.js:98` (`S_BOX`), `:188-190` (`subBytes`), `:320`, `:331` (`keyExpansion` SubWord) | AES key and state bytes | S-box table indexed by secret bytes → cache-timing attacks. |
| `aes256gcm.js:170-176` (`gmul`, used by MixColumns) | AES state bytes | Branches on data bits. |
| `aes256gcm.js:410-433` (`ghashMultiply`) | GHASH key H (enables forgeries) | One branch per operand bit and per reduction step. |
| `ecdsaP256.js:440-449` (`scalarMultiply`) | Nonce k, private key d | Double-and-add branches per secret bit; loop length = bit length of the scalar (the Minerva / TPM-Fail nonce-length leak). |
| `ecdsaP256.js:382`, `:410` (`pointDouble`, `pointAdd`) | Intermediate points of k·G | Special-case branches, per-operation inversion. |
| `ecdsaP256.js:193-203` (`modPow`), `:218` (`modInverse`), `:545-546` (k⁻¹, s) | k, d | BigInt arithmetic time depends on operand values. |
| `rsa.js:183-193` (`modPow`), `:480-485` (`rsaDecryptRaw`) | Private exponent d | Square-and-multiply branches on each bit of d; no blinding, no CRT. |
| `rsa.js:601-637` (`oaepDecode` separator scan) | OAEP padding validity (Manger oracle) | Uniform error, but the scan branches on decoded bytes. |
| Byte-compare helpers in `aes256gcm.js`, `jwtScratch.js`, `pbkdf2.js`, `totp.js` | Tag / signature / hash bytes | Loop-and-OR without early exit — best effort under a JIT, not a guarantee. |
