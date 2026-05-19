"""
SHA-256 implemented from scratch (FIPS PUB 180-4, section 6.2).

This file is a direct port of Backend/utils/scratch/sha256.js — same
constants, same round structure, same helper-function names (snake_cased
to follow Python convention).

The algorithm at a glance:

  1. Pad the message so its length in bits is congruent to 448 mod 512,
     then append the original bit-length as a 64-bit big-endian integer.
     (This guarantees the padded message is a whole number of 512-bit
     blocks.)

  2. Set up an 8-word "hash state" H, initialized from a fixed constant.

  3. For each 512-bit block:
       - Expand the 16 input words into a 64-word "message schedule".
       - Run 64 rounds of mixing — each round shuffles 8 working
         variables (a..h) using a few bit operations and adds in one
         schedule word plus one round constant.
       - Add the final working variables back into H.

  4. Concatenate H[0..7] into a 32-byte output.

A small but important Python quirk: int is arbitrary-precision, so every
arithmetic result must be masked to 32 bits with `& 0xFFFFFFFF` to mirror
the JS `>>> 0` coercions. Without the mask, the running totals would
silently grow into 33+ bits and the next iteration would carry that
junk into rounds 2, 3, 4, ...
"""


# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

# INITIAL_HASH (H0..H7).
#
# These are the first 32 bits of the fractional parts of the square roots
# of the first eight primes (2, 3, 5, 7, 11, 13, 17, 19). They are
# arbitrary "nothing-up-my-sleeve" numbers chosen by NIST so the algorithm
# cannot be accused of having a back door hidden inside the seed.
#
# Example for prime 2: sqrt(2) = 1.41421356...; the fractional part is
# 0.41421356...; multiplying by 2^32 and truncating gives 0x6a09e667.
INITIAL_HASH = (
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
)

# ROUND_CONSTANTS (K0..K63).
#
# These are the first 32 bits of the fractional parts of the *cube* roots
# of the first 64 primes. Same "nothing-up-my-sleeve" idea as the initial
# hash values. There is one constant per round of the compression function;
# round t uses ROUND_CONSTANTS[t].
ROUND_CONSTANTS = (
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
)


# ─────────────────────────────────────────────────────────────────────────────
# Bit-level helper functions
# ─────────────────────────────────────────────────────────────────────────────

def rotr(n, x):
    """Rotate the 32-bit word `x` to the right by `n` bits.

    Bits that fall off the right edge wrap around to the left.
    Mathematically: ROTR(n, x) = (x >> n) OR (x << (32 - n)), modulo 2^32.

    The final mask is essential in Python: `x << (32 - n)` can produce a
    value with more than 32 bits, and we need to discard the overflow.
    """
    return ((x >> n) | (x << (32 - n))) & 0xFFFFFFFF


def ch(x, y, z):
    """Ch — the "choose" function.

    For each bit position: if the bit in x is 1, use the corresponding bit
    from y; otherwise use the bit from z. Like a bitwise multiplexer.

      Ch(x, y, z) = (x AND y) XOR (NOT x AND z)

    Python's `~x` flips ALL bits including the conceptual sign — so for
    a 32-bit input we explicitly mask the bitwise-NOT back to 32 bits
    with `& 0xFFFFFFFF` before AND'ing with z.
    """
    return (x & y) ^ ((~x & 0xFFFFFFFF) & z)


def maj(x, y, z):
    """Maj — the "majority" function.

    For each bit position: returns whichever bit value (0 or 1) appears
    in the majority of x, y, z. Equivalent to a bitwise majority vote
    across three inputs.

      Maj(x, y, z) = (x AND y) XOR (x AND z) XOR (y AND z)
    """
    return (x & y) ^ (x & z) ^ (y & z)


def big_sigma_0(x):
    """Big sigma 0 — diffusion function applied to working variable `a`.

      Σ0(x) = ROTR(2, x) XOR ROTR(13, x) XOR ROTR(22, x)

    Mixing three differently-rotated copies of x with XOR ensures every
    input bit influences many output bit positions — key to the
    avalanche property of the hash.
    """
    return rotr(2, x) ^ rotr(13, x) ^ rotr(22, x)


def big_sigma_1(x):
    """Big sigma 1 — diffusion function applied to working variable `e`.

      Σ1(x) = ROTR(6, x) XOR ROTR(11, x) XOR ROTR(25, x)
    """
    return rotr(6, x) ^ rotr(11, x) ^ rotr(25, x)


def small_sigma_0(x):
    """Small sigma 0 — diffusion used when expanding the message schedule.

      σ0(x) = ROTR(7, x) XOR ROTR(18, x) XOR (x >> 3)

    Note the non-circular right shift in the third term — that bit
    pattern is what distinguishes the small sigmas from the big ones.
    """
    return rotr(7, x) ^ rotr(18, x) ^ (x >> 3)


def small_sigma_1(x):
    """Small sigma 1 — diffusion used when expanding the message schedule.

      σ1(x) = ROTR(17, x) XOR ROTR(19, x) XOR (x >> 10)
    """
    return rotr(17, x) ^ rotr(19, x) ^ (x >> 10)


# ─────────────────────────────────────────────────────────────────────────────
# Input handling and padding
# ─────────────────────────────────────────────────────────────────────────────

def _to_bytes(message):
    """Coerce the input message to bytes.

    Strings are encoded as UTF-8 (the standard convention for hashing
    text). bytes / bytearray are returned as immutable bytes. Anything
    else is rejected.
    """
    if isinstance(message, (bytes, bytearray)):
        return bytes(message)
    if isinstance(message, str):
        return message.encode('utf-8')
    raise TypeError("sha256: message must be str, bytes, or bytearray")


def _pad(data):
    """Apply FIPS 180-4 padding to bring the message to a whole number of
    512-bit (64-byte) blocks.

    The padding rule:
      1. Append a single `1` bit to the message.
      2. Append `0` bits until the bit-length ≡ 448 (mod 512).
      3. Append the *original* message bit-length as a 64-bit big-endian
         integer.

    Because messages are already byte-aligned, step 1 is just appending
    the byte 0x80 (binary 1000_0000 — one `1` followed by seven `0`s,
    accounting for the first 7 zero bits of step 2 in the same byte).
    """
    original_byte_len = len(data)
    original_bit_len = original_byte_len * 8

    # After padding, total length must be a multiple of 64 bytes.
    # Layout: [original bytes] [0x80] [zero bytes] [8-byte length]
    # We need (original_byte_len + 1 + zero_bytes + 8) % 64 == 0.
    # Solving: zero_bytes = (55 - original_byte_len) mod 64.
    # Python's % is always non-negative for non-negative dividends and
    # positive divisors, so this computes correctly even at the edges.
    zero_bytes = (55 - original_byte_len) % 64

    padded = bytearray(data)
    padded.append(0x80)
    padded.extend(b'\x00' * zero_bytes)

    # 8-byte big-endian length in BITS in the trailing 8 bytes.
    padded.extend(original_bit_len.to_bytes(8, 'big'))

    return bytes(padded)


# ─────────────────────────────────────────────────────────────────────────────
# Main hash routine
# ─────────────────────────────────────────────────────────────────────────────

def sha256(message):
    """Compute the SHA-256 digest of `message`.

    Args:
        message: str, bytes, or bytearray. Strings are UTF-8 encoded.

    Returns:
        bytes of length 32 — the 256-bit digest.
    """
    data = _to_bytes(message)
    padded = _pad(data)

    # Working copy of the hash state. We mutate this through every block.
    h_state = list(INITIAL_HASH)

    # Reusable scratch space for the 64-word message schedule.
    w = [0] * 64

    num_blocks = len(padded) // 64

    for block_idx in range(num_blocks):
        block_offset = block_idx * 64

        # ── Step 1: build the 64-word message schedule W[0..63] ─────────
        # The first 16 words come straight from the block, read as
        # big-endian 32-bit unsigned integers.
        for t in range(16):
            start = block_offset + t * 4
            w[t] = int.from_bytes(padded[start:start + 4], 'big')

        # The remaining 48 words are computed from earlier ones via the
        # small-sigma diffusion functions. This is the "message expansion"
        # step — it scrambles the original 64 input bytes into 256 bytes
        # of well-mixed schedule data.
        for t in range(16, 64):
            w[t] = (
                small_sigma_1(w[t - 2])
                + w[t - 7]
                + small_sigma_0(w[t - 15])
                + w[t - 16]
            ) & 0xFFFFFFFF

        # ── Step 2: initialize working variables a..h from hash state ──
        a, b, c, d, e, f, g, h = h_state

        # ── Step 3: 64 rounds of compression ────────────────────────────
        # Each round computes two temporaries and shifts everyone down
        # the register chain by one. Conceptually a..h is a sliding
        # pipeline:
        #   new a = T1 + T2
        #   new b = old a
        #   new c = old b
        #   ...
        #   new e = old d + T1   (the second injection point of T1)
        for t in range(64):
            t1 = (h + big_sigma_1(e) + ch(e, f, g) + ROUND_CONSTANTS[t] + w[t]) & 0xFFFFFFFF
            t2 = (big_sigma_0(a) + maj(a, b, c)) & 0xFFFFFFFF

            h = g
            g = f
            f = e
            e = (d + t1) & 0xFFFFFFFF
            d = c
            c = b
            b = a
            a = (t1 + t2) & 0xFFFFFFFF

        # ── Step 4: fold the compressed working variables into hash ────
        # Adding (mod 2^32) — not assigning — is what makes the function
        # one-way: the previous state is mixed in, so you cannot run the
        # compression backwards.
        h_state[0] = (h_state[0] + a) & 0xFFFFFFFF
        h_state[1] = (h_state[1] + b) & 0xFFFFFFFF
        h_state[2] = (h_state[2] + c) & 0xFFFFFFFF
        h_state[3] = (h_state[3] + d) & 0xFFFFFFFF
        h_state[4] = (h_state[4] + e) & 0xFFFFFFFF
        h_state[5] = (h_state[5] + f) & 0xFFFFFFFF
        h_state[6] = (h_state[6] + g) & 0xFFFFFFFF
        h_state[7] = (h_state[7] + h) & 0xFFFFFFFF

    # ── Step 5: serialize H[0..7] as big-endian into a 32-byte buffer ──
    out = bytearray(32)
    for i in range(8):
        out[i * 4 : i * 4 + 4] = h_state[i].to_bytes(4, 'big')
    return bytes(out)


def sha256_hex(message):
    """Convenience wrapper — returns the digest as a 64-character hex string."""
    return sha256(message).hex()


# Alias for sha256 with an explicit name. Useful when a reader skimming
# an import list wants it spelled out that the return type is bytes.
sha256_bytes = sha256


# ─────────────────────────────────────────────────────────────────────────────
# Self-test — runs only when this file is executed directly:
#   python sha256.py
# Three FIPS 180-4 known-answer test vectors. All three should print PASS.
# After those, a 50-iteration cross-check vs hashlib (NOT the source of
# truth — just a sanity check that we agree with the reference).
# ─────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys

    vectors = [
        ("",
         "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"),
        ("abc",
         "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"),
        ("The quick brown fox jumps over the lazy dog",
         "d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592"),
    ]

    all_pass = True
    for input_str, expected in vectors:
        got = sha256_hex(input_str)
        shown = input_str if len(input_str) <= 30 else input_str[:27] + "..."
        if got == expected:
            print(f'PASS  sha256("{shown}")')
        else:
            all_pass = False
            print(f'FAIL  sha256({input_str!r})')
            print(f'      got      = {got}')
            print(f'      expected = {expected}')

    if not all_pass:
        sys.exit(1)

    # cross-check vs hashlib (not the source of truth)
    import hashlib
    import os

    n_iter = 50
    cross_pass = 0
    for _ in range(n_iter):
        # Random length in [0, 500] inclusive.
        length = int.from_bytes(os.urandom(2), 'big') % 501
        sample = os.urandom(length)
        if sha256_bytes(sample) == hashlib.sha256(sample).digest():
            cross_pass += 1
        else:
            print(f"FAIL  cross-check failed at length={length}")
            print(f"      input (hex): {sample.hex()}")
            print(f"      ours:        {sha256_hex(sample)}")
            print(f"      hashlib:     {hashlib.sha256(sample).hexdigest()}")
            sys.exit(1)

    print(f"cross-check vs hashlib: {cross_pass}/{n_iter} PASS")
