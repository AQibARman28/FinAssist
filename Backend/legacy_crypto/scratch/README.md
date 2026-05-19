# Scratch Cryptography Implementations

This folder contains FinAssist's from-scratch implementations of the cryptographic primitives required by the CSE447 project specification. None of these files use Node's `crypto` module for the algorithm itself — only for entropy (`crypto.randomBytes`) where randomness is needed.

| File | Algorithm | Status |
|---|---|---|
| sha256.js | SHA-256 hash | ✓ |
| hmacSha256.js | HMAC-SHA256 | ✓ |
| aes256gcm.js | AES-256-GCM | ✓ |
| rsa.js | RSA-2048 + OAEP | ✓ |
| ecdsaP256.js | ECC P-256 + ECDSA | ✓ |
| pbkdf2.js | PBKDF2-SHA256 password hashing | ✓ |
| jwtScratch.js | JWT (HS256) | ✓ |
| totp.js | TOTP (RFC 6238) | ✓ |

Each file is self-contained and round-trip tested against Node's `crypto` module to prove correctness.
