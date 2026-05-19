"""
HMAC-SHA256 implemented from scratch (RFC 2104, with our scratch SHA-256
as the inner hash).

This file is a direct port of Backend/utils/scratch/hmacSha256.js — same
B = 64 block size, same 0x36/0x5C pad bytes, same nested-hash structure.

Why HMAC exists at all
─────────────────────────────────────────────────────────────────────────────
The naïve way to authenticate a message with a shared secret would be to
compute `sha256(secret || message)` and ship the digest along with the
message. That is broken. SHA-256 (and every other Merkle-Damgård hash) is
vulnerable to a *length-extension attack*: given the digest of an unknown
input, an attacker can compute the digest of that input concatenated with
arbitrary trailing bytes, *without ever learning the secret*. So if a
server accepts `sha256(secret || message)` as proof that `message` came
from someone holding `secret`, an attacker who saw one valid (message,
tag) pair can forge tags for `message || extra` for any `extra` they
like.

The HMAC construction
─────────────────────────────────────────────────────────────────────────────
HMAC defeats this by wrapping the hash twice with two different padded
versions of the key:

    HMAC(K, m) = H( (K' XOR opad) || H( (K' XOR ipad) || m ) )

The inner H still has the length-extension weakness, but its output is
fed straight into the outer H — and an attacker who only sees the outer
digest gets no foothold to extend it, because the outer hash's input
(K' XOR opad || inner digest) is fixed-length and unknown to them.

Key preparation (the K' step)
─────────────────────────────────────────────────────────────────────────────
Both XOR steps need a key that is exactly one block of the hash function
(B = 64 bytes for SHA-256). So we normalize:
  - If the key is longer than B, replace it with sha256(key) — 32 bytes —
    and zero-pad to 64. (A long key is "summarized" by hashing.)
  - If the key is shorter than B, right-pad with zeros to 64 bytes.
  - If the key is already exactly B, use it unchanged.

Why ipad = 0x36 and opad = 0x5C specifically
─────────────────────────────────────────────────────────────────────────────
The two pad bytes are 0x36 = 0011_0110 and 0x5C = 0101_1100. Their
bitwise XOR is 0110_1010 — exactly 4 of 8 bits differ, the maximum
possible "spread" between two byte values. That means K' XOR ipad and
K' XOR opad differ in *half* of all bit positions of the prepared key,
so the inner and outer hash inputs are well separated even when the
underlying key is the same. This is what gives HMAC its security proof
and what makes it resistant to related-key attacks even when the
underlying hash function isn't.

Allowed dependencies
─────────────────────────────────────────────────────────────────────────────
The only import for the algorithm is `sha256` from our local scratch
SHA-256 module. No `hmac` stdlib, no `cryptography`, no PyCA. The
optional cross-check at the bottom imports Python's `hmac` purely as a
reference to verify our output — clearly marked.
"""

from sha256 import sha256


# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

# BLOCK_SIZE is the underlying hash function's block size, not its output
# size. SHA-256 processes data in chunks of 64 bytes (512 bits) — that
# is the value we need here, regardless of the fact that SHA-256's
# *digest* is 32 bytes. Mixing these two up is one of the classic HMAC
# implementation bugs.
BLOCK_SIZE = 64

# IPAD_BYTE — the byte value the prepared key gets XORed with for the
# inner hash. 0x36 = 0011_0110.
IPAD_BYTE = 0x36

# OPAD_BYTE — the byte value the prepared key gets XORed with for the
# outer hash. 0x5C = 0101_1100. As noted above, ipad and opad were
# chosen to differ in 4 of 8 bit positions for maximum separation.
OPAD_BYTE = 0x5C


# ─────────────────────────────────────────────────────────────────────────────
# Helper functions
# ─────────────────────────────────────────────────────────────────────────────

def _to_bytes(value, label):
    """Coerce `value` to bytes.

    Strings are UTF-8 encoded; bytes/bytearray are returned as immutable
    bytes. The `label` argument is used purely for the error message so
    that a wrong-typed `key` complains about the key (not the message)
    and vice versa.
    """
    if isinstance(value, (bytes, bytearray)):
        return bytes(value)
    if isinstance(value, str):
        return value.encode('utf-8')
    raise TypeError(f"hmac_sha256: {label} must be str, bytes, or bytearray")


def _prepare_key(key):
    """Normalize the user-supplied key to exactly BLOCK_SIZE bytes.

    Per RFC 2104:
      1. If the key is longer than the block size, replace it with the
         hash of the original key. This produces a 32-byte buffer for
         SHA-256, which is then zero-padded up to 64 bytes by step 2.
      2. If the (possibly hashed) key is shorter than the block size,
         pad it with zero bytes on the right until it is exactly
         BLOCK_SIZE bytes.
    """
    k = _to_bytes(key, 'key')

    # Step 1: hash long keys down to 32 bytes.
    if len(k) > BLOCK_SIZE:
        k = sha256(k)

    # Step 2: right-pad short keys with zero bytes up to BLOCK_SIZE.
    if len(k) < BLOCK_SIZE:
        k = k + b'\x00' * (BLOCK_SIZE - len(k))

    return k  # exactly BLOCK_SIZE bytes


def _xor_with_byte(buf, byte_value):
    """Return a new bytes object where every byte of `buf` has been XORed
    with the scalar byte value `byte_value`.

    This is the core operation used to produce K_ipad and K_opad from
    the prepared key.
    """
    return bytes(b ^ byte_value for b in buf)


# ─────────────────────────────────────────────────────────────────────────────
# Main HMAC routine
# ─────────────────────────────────────────────────────────────────────────────

def hmac_sha256(key, message):
    """Compute HMAC-SHA256 of `message` under shared secret `key`.

      HMAC(K, m) = sha256( (K' XOR opad) || sha256( (K' XOR ipad) || m ) )

    Args:
        key:     str, bytes, or bytearray — the shared secret.
        message: str, bytes, or bytearray — the message to authenticate.

    Returns:
        bytes of length 32 — the authentication tag.
    """
    msg_buf = _to_bytes(message, 'message')

    # Bring the key to exactly one hash block (64 bytes).
    k = _prepare_key(key)

    # Build the two padded keys by XORing the prepared key with the
    # constants.
    k_ipad = _xor_with_byte(k, IPAD_BYTE)
    k_opad = _xor_with_byte(k, OPAD_BYTE)

    # Inner hash: takes the message itself, prefixed with the ipad-key.
    # Length-extension attacks against this inner output are possible,
    # but that's fine — only the outer hash is ever published.
    inner_input = k_ipad + msg_buf
    inner_hash = sha256(inner_input)

    # Outer hash: a fixed 64+32 = 96 byte input — opad-key concatenated
    # with the inner digest. This is what we return as the HMAC.
    outer_input = k_opad + inner_hash
    return sha256(outer_input)


def hmac_sha256_hex(key, message):
    """Convenience wrapper — returns the HMAC as a 64-character hex string."""
    return hmac_sha256(key, message).hex()


# ─────────────────────────────────────────────────────────────────────────────
# Self-test — runs only when this file is executed directly:
#   python hmac_sha256.py
# Three RFC 4231 known-answer test vectors. All three should print PASS.
# After those, a 50-iteration cross-check vs Python's hmac stdlib (NOT
# the source of truth — just a sanity check that we agree with the
# reference).
# ─────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys

    vectors = [
        {
            "name": 'Test 1 (key=0x0b×20, msg="Hi There")',
            "key": bytes([0x0b]) * 20,
            "message": b"Hi There",
            "expected": "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
        },
        {
            "name": 'Test 2 (key="Jefe", msg="what do ya want for nothing?")',
            "key": b"Jefe",
            "message": b"what do ya want for nothing?",
            "expected": "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
        },
        {
            "name": 'Test 3 (key=0xaa×20, msg=0xdd×50)',
            "key": bytes([0xaa]) * 20,
            "message": bytes([0xdd]) * 50,
            "expected": "773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe",
        },
    ]

    all_pass = True
    for v in vectors:
        got = hmac_sha256_hex(v["key"], v["message"])
        if got == v["expected"]:
            print(f'PASS  {v["name"]}')
        else:
            all_pass = False
            print(f'FAIL  {v["name"]}')
            print(f'      got      = {got}')
            print(f'      expected = {v["expected"]}')

    if not all_pass:
        sys.exit(1)

    # cross-check vs hmac stdlib (not the source of truth)
    import hmac as _hmac_stdlib
    import hashlib
    import os

    n_iter = 50
    cross_pass = 0
    for i in range(n_iter):
        # Random key length in [1, 100], random message length in [0, 1000].
        # The key range deliberately straddles BLOCK_SIZE = 64 so we
        # exercise both _prepare_key branches (short → zero-pad,
        # long → hash-down).
        key_len = 1 + (int.from_bytes(os.urandom(2), 'big') % 100)
        msg_len = int.from_bytes(os.urandom(2), 'big') % 1001
        k = os.urandom(key_len)
        m = os.urandom(msg_len)

        ours = hmac_sha256(k, m)
        ref = _hmac_stdlib.new(k, m, hashlib.sha256).digest()

        if ours == ref:
            cross_pass += 1
        else:
            print(f"FAIL  cross-check failed at iteration {i + 1}")
            print(f"      key length:     {key_len}")
            print(f"      message length: {msg_len}")
            print(f"      key (hex):      {k.hex()}")
            print(f"      message (hex):  {m.hex()}")
            print(f"      ours:           {ours.hex()}")
            print(f"      stdlib:         {ref.hex()}")
            sys.exit(1)

    print(f"cross-check vs hmac stdlib: {cross_pass}/{n_iter} PASS")
