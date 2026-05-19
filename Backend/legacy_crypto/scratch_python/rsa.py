"""
RSA-2048 with OAEP-SHA256 padding, implemented from scratch.

This file is a direct port of Backend/utils/scratch/rsa.js — same
square-and-multiply mod-pow, same Miller-Rabin with k=40 witnesses, same
Carmichael-totient-based key generation, same OAEP encode/decode with
single-sentinel uniform-error decode for Manger defense.

The textbook RSA construction
─────────────────────────────────────────────────────────────────────────────
  - Pick two large random primes p, q (1024 bits each for RSA-2048).
  - n = p * q is the public modulus (2048 bits).
  - e = 65537 is the public exponent.
  - λ(n) = lcm(p-1, q-1) is Carmichael's totient.
  - d = e^(-1) mod λ(n) is the private exponent.
  - Public key:  (n, e). Private key: (n, d), or sometimes (n, d, p, q).
  - Encrypt: c = m^e mod n. Decrypt: m = c^d mod n.

The security rests on the difficulty of factoring n. Anyone who could
factor n could compute d from e and recover the private key. With current
algorithms (general number field sieve), 2048-bit n is infeasible to
factor on classical hardware.

Why we use Carmichael's λ(n) instead of Euler's φ(n)
─────────────────────────────────────────────────────────────────────────────
φ(n) = (p-1)(q-1) is what the original RSA paper used. Carmichael's
λ(n) = lcm(p-1, q-1) divides φ(n), so any d valid for one is valid for
the other. Using λ produces the SMALLEST valid private exponent, which
is marginally faster to use and is what NIST FIPS 186-4 prescribes.
Both are correct; we follow modern practice.

Why textbook RSA is unsafe — and why OAEP fixes it
─────────────────────────────────────────────────────────────────────────────
Raw `m^e mod n` is INSECURE on its own, in three ways:
  1. Deterministic — same plaintext always encrypts to the same
     ciphertext, leaking equality.
  2. Malleable — encrypt(m1) * encrypt(m2) mod n decrypts to m1 * m2
     mod n, so an attacker can craft a related ciphertext without
     knowing the private key.
  3. Small-message exposure — if m^e < n (which happens whenever m is
     small enough), the ciphertext is just m^e and the attacker can
     recover m by integer e-th-rooting.

OAEP padding (RFC 8017 §7.1) fixes all three. It pads the plaintext
with random bytes plus a fixed lHash, masks both halves of the padded
block via two MGF1 invocations, and only then runs the raw RSA
transform. The result is non-deterministic (each encryption uses a
fresh random seed), non-malleable (any tampering breaks the padding
check), and non-leaky for small messages (the padding fills the full
modulus bit-width).

The Manger attack and why uniform error messages matter
─────────────────────────────────────────────────────────────────────────────
In 2001 James Manger published an attack on PKCS#1 v1.5 (the
predecessor to OAEP) that works against any RSA implementation that
distinguishes different padding-validation failures. By submitting
carefully chosen ciphertexts and watching which error message comes
back, the attacker can recover the entire plaintext one bit at a time,
in roughly k log(k) decryption queries where k is the bit length of n.

OAEP itself is provably IND-CCA2 secure, but only under the assumption
that the implementation never reveals which step of decoding failed.
Verbose error messages like "lHash mismatch" or "missing 0x01
separator" undo the proof. Our `oaep_decode` accumulates every
structural failure into a single boolean and raises ONE generic
ValueError("OAEP decoding error") at the end of decoding, regardless
of which check tripped.

Why e = 65537 specifically
─────────────────────────────────────────────────────────────────────────────
65537 = 2^16 + 1 is the F4 Fermat prime. Universally chosen for RSA's
public exponent because:
  - It's prime, so it can't share factors with λ(n) for any reasonable
    prime pair.
  - In binary it is 10000000000000001 — only TWO bits set. That makes
    m^e fast: m^65537 = (m^65536) * m = (((((((m^2)^2)^2)^2)^2)^2)^2)^2 * m
    — 16 squarings plus one multiplication.
  - It's larger than 3, avoiding the Håstad small-exponent broadcast
    attack.

Allowed dependencies
─────────────────────────────────────────────────────────────────────────────
  `sha256` from our local scratch SHA-256 — used by OAEP's MGF1 mask
  generation and by lHash. `secrets` for entropy. `json` is permitted
  by the spec but the parse/serialize helpers in this file return
  dicts, not JSON strings; callers can json.dumps if they want.

Performance note
─────────────────────────────────────────────────────────────────────────────
Pure-Python RSA is dramatically slower than Node.js BigInt RSA which
is itself dramatically slower than `cryptography`'s C-backed
implementation. Our self-rolled mod_pow runs every iteration of the
square-and-multiply loop in pure Python (Python's built-in `pow(a, b,
m)` would be 10-100× faster, but the spec requires we hand-roll it).
Expect:
  - generate_rsa_keypair(2048): 30 seconds to 3 minutes (Miller-Rabin
    on candidate primes is the bottleneck).
  - rsa_encrypt_oaep: ~50ms (e=65537 has only 17 mul-steps).
  - rsa_decrypt_oaep: ~1-3 seconds (d is ~2048 bits, so ~2048 mul-steps).
"""

import secrets as _secrets

from sha256 import sha256


# ═════════════════════════════════════════════════════════════════════════════
#  PART A — Number-theoretic helpers
# ═════════════════════════════════════════════════════════════════════════════

def mod_pow(base, exp, modulus):
    """Modular exponentiation: returns base^exp mod modulus.

    Square-and-multiply (binary exponentiation): walk the bits of `exp`
    from low to high. At each step:
      - If the current bit is 1, multiply the running result by the
        current squared base.
      - Square the base for the next iteration.

    This is THE workhorse of every RSA operation: encrypt, decrypt, key
    generation, primality test — all reduce to one or more mod_pow
    calls.

    Python's built-in `pow(base, exp, modulus)` does exactly this in C
    and is dramatically faster, but the from-scratch requirement of
    this folder rules it out. We call our hand-rolled version
    everywhere instead.
    """
    if modulus == 1:
        return 0
    if exp < 0:
        raise ValueError("mod_pow: exponent must be non-negative")

    result = 1
    b = base % modulus
    if b < 0:
        b += modulus
    e = exp

    while e > 0:
        if e & 1:
            result = (result * b) % modulus
        e >>= 1
        b = (b * b) % modulus

    return result


def gcd(a, b):
    """Greatest common divisor by Euclidean algorithm."""
    while b != 0:
        a, b = b, a % b
    return a


def lcm(a, b):
    """Least common multiple, derived from gcd.

    Used to compute Carmichael's totient λ(n) = lcm(p-1, q-1) during
    key generation.
    """
    return (a // gcd(a, b)) * b


def extended_gcd(a, b):
    """Returns (g, x, y) such that a*x + b*y = g = gcd(a, b).

    Iterative formulation: maintain pairs (old_r, r), (old_s, s),
    (old_t, t) where the invariant `a * s + b * t == r` holds at every
    step. When r reaches 0, old_r is the gcd and (old_s, old_t) are the
    Bezout coefficients.
    """
    old_r, r = a, b
    old_s, s = 1, 0
    old_t, t = 0, 1

    while r != 0:
        q = old_r // r
        old_r, r = r, old_r - q * r
        old_s, s = s, old_s - q * s
        old_t, t = t, old_t - q * t

    return old_r, old_s, old_t


def mod_inverse(a, m):
    """Modular inverse: returns x such that (a * x) mod m == 1.

    Raises ValueError if gcd(a, m) != 1 — in which case no inverse exists.
    Used during key generation to compute d from e and λ(n):
      d = e^(-1) mod λ(n).
    """
    g, x, _ = extended_gcd(a % m, m)
    if g != 1:
        raise ValueError(f"mod_inverse: no inverse exists (gcd = {g})")
    return x % m


# ═════════════════════════════════════════════════════════════════════════════
#  PART B — Primality testing and prime generation
# ═════════════════════════════════════════════════════════════════════════════

# All primes < 1000, excluding 2 (since we only test odd candidates).
# Trial-dividing a prime candidate by these BEFORE running Miller-Rabin
# is a massive speedup: most random odd numbers are divisible by some
# small prime, so trial division eliminates the vast majority of
# candidates cheaply. The JS file uses 54 primes up to 257; expanding
# the list to 167 primes up to 1000 is a performance optimization
# (more candidates eliminated early) without any algorithmic change.
_SMALL_PRIMES = (
      3,   5,   7,  11,  13,  17,  19,  23,  29,  31,  37,  41,
     43,  47,  53,  59,  61,  67,  71,  73,  79,  83,  89,  97,
    101, 103, 107, 109, 113, 127, 131, 137, 139, 149, 151, 157,
    163, 167, 173, 179, 181, 191, 193, 197, 199, 211, 223, 227,
    229, 233, 239, 241, 251, 257, 263, 269, 271, 277, 281, 283,
    293, 307, 311, 313, 317, 331, 337, 347, 349, 353, 359, 367,
    373, 379, 383, 389, 397, 401, 409, 419, 421, 431, 433, 439,
    443, 449, 457, 461, 463, 467, 479, 487, 491, 499, 503, 509,
    521, 523, 541, 547, 557, 563, 569, 571, 577, 587, 593, 599,
    601, 607, 613, 617, 619, 631, 641, 643, 647, 653, 659, 661,
    673, 677, 683, 691, 701, 709, 719, 727, 733, 739, 743, 751,
    757, 761, 769, 773, 787, 797, 809, 811, 821, 823, 827, 829,
    839, 853, 857, 859, 863, 877, 881, 883, 887, 907, 911, 919,
    929, 937, 941, 947, 953, 967, 971, 977, 983, 991, 997,
)


def _passes_small_prime_filter(n):
    """Return False if `n` is divisible by any small prime (and is
    therefore composite), unless n IS that prime."""
    for p in _SMALL_PRIMES:
        if n == p:
            return True
        if n % p == 0:
            return False
    return True


def _random_in_range(low, high):
    """Uniform random int in [low, high). Uses secrets.randbelow."""
    if high <= low:
        raise ValueError("_random_in_range: high must be > low")
    return low + _secrets.randbelow(high - low)


def _random_bigint_bits(bits):
    """Generate a random int with EXACTLY `bits` bits — high bit forced on.

    This is the starting candidate for prime generation. Forcing the
    high bit ensures the prime has the requested length.
    """
    if bits < 1:
        raise ValueError("_random_bigint_bits: bits must be positive")
    n = _secrets.randbits(bits)
    n |= (1 << (bits - 1))
    return n


def miller_rabin(n, k=40):
    """Miller-Rabin probabilistic primality test.

    Returns True if `n` is "probably prime" with false-positive
    probability at most 4^(-k). For k = 40 (our default, matching the
    JS file) the failure probability is about 10^(-24) — astronomically
    smaller than the chance of a hardware RAM bit flip during the test.

    Algorithm:
      1. Quick rejection of even numbers and small composites via
         trial division by primes < 1000.
      2. Write n - 1 = 2^s * d with d odd.
      3. For k random witnesses a in [2, n-2]:
           - x = a^d mod n
           - If x is 1 or n-1, this witness "passes" — try the next one.
           - Otherwise, square x up to s-1 times. If x ever reaches
             n-1, the witness passes. If we reach the end without
             seeing n-1, n is definitely composite.
      4. If all k witnesses pass, n is "probably prime".
    """
    if n < 2:
        return False
    if n == 2 or n == 3:
        return True
    if n % 2 == 0:
        return False

    # Trial-division filter — catches the overwhelming majority of
    # composites without invoking the expensive MR loop.
    if not _passes_small_prime_filter(n):
        return False

    # Decompose n - 1 = 2^s * d with d odd.
    s = 0
    d = n - 1
    while (d & 1) == 0:
        d >>= 1
        s += 1

    n_minus_1 = n - 1

    for _ in range(k):
        # Random witness a in [2, n-2]
        a = _random_in_range(2, n - 1)

        x = mod_pow(a, d, n)
        if x == 1 or x == n_minus_1:
            continue                             # witness passes

        composite = True
        for _ in range(s - 1):
            x = (x * x) % n
            if x == n_minus_1:
                composite = False
                break
        if composite:
            return False

    return True


def generate_prime(bits):
    """Generate a random prime of exactly `bits` bits.

    Three bits are forced on in every candidate:
      - top bit (bit `bits - 1`)  — ensures full bit-length
      - second bit (bit `bits - 2`) — ensures p * q has full 2*bits
        bit-length (otherwise the product could land at 2*bits - 1 bits)
      - low bit (bit 0)            — forces the candidate to be odd

    No deterministic time bound — the loop draws random candidates
    until one passes Miller-Rabin. Most candidates fail the cheap
    small-prime filter; only a small fraction reach Miller-Rabin.
    Expected attempts ≈ bits / ln(2) ≈ bits / 0.7.
    """
    if bits < 16:
        raise ValueError("generate_prime: bits must be at least 16")

    while True:
        candidate = _random_bigint_bits(bits)
        candidate |= 1                                      # force odd
        candidate |= (1 << (bits - 2))                      # force second-highest bit

        if not _passes_small_prime_filter(candidate):
            continue
        if not miller_rabin(candidate, 40):
            continue

        return candidate


# ═════════════════════════════════════════════════════════════════════════════
#  PART C — RSA core
# ═════════════════════════════════════════════════════════════════════════════

def generate_rsa_keypair(bits=2048):
    """Generate a fresh RSA keypair.

    Returns a dict with int values matching the JS file's
    `{n, e, d, p, q}` shape exactly:
        {"n": int, "e": int, "d": int, "p": int, "q": int}

    The serialization to the JSON storage shape is a separate step —
    see serialize_public_key / serialize_private_key.
    """
    if not isinstance(bits, int) or bits < 512 or bits % 2 != 0:
        raise ValueError("generate_rsa_keypair: bits must be an even integer >= 512")

    half_bits = bits // 2
    e = 65537

    while True:
        p = generate_prime(half_bits)
        # Ensure q is distinct from p (extremely unlikely they collide,
        # but the JS file checks too — match it).
        while True:
            q = generate_prime(half_bits)
            if q != p:
                break

        n = p * q
        # Belt-and-braces: even with both top two bits forced on, double-check
        # n really is `bits` bits long.
        if n.bit_length() != bits:
            continue

        lam = lcm(p - 1, q - 1)
        if gcd(e, lam) != 1:
            continue                                         # extremely rare; reroll

        d = mod_inverse(e, lam)
        return {"n": n, "e": e, "d": d, "p": p, "q": q}


def rsa_encrypt_raw(m_int, public_key):
    """Raw RSA encryption: returns m^e mod n.

    `m_int` must be in [0, n-1]. `public_key` is a dict with int 'n'
    and 'e'. No padding — callers should always go through
    rsa_encrypt_oaep.
    """
    n = public_key["n"]
    e = public_key["e"]
    if not (0 <= m_int < n):
        raise ValueError("rsa_encrypt_raw: message out of range [0, n)")
    return mod_pow(m_int, e, n)


def rsa_decrypt_raw(c_int, private_key):
    """Raw RSA decryption: returns c^d mod n.

    `c_int` must be in [0, n-1]. `private_key` is a dict with int 'n'
    and 'd'. We use the simple m = c^d mod n form rather than the
    Chinese Remainder Theorem (CRT) optimization — match the JS file
    for clarity.
    """
    n = private_key["n"]
    d = private_key["d"]
    if not (0 <= c_int < n):
        raise ValueError("rsa_decrypt_raw: ciphertext out of range [0, n)")
    return mod_pow(c_int, d, n)


# ═════════════════════════════════════════════════════════════════════════════
#  PART D — OAEP padding (RFC 8017 §7.1)
# ═════════════════════════════════════════════════════════════════════════════

# SHA-256 digest length in bytes. Used everywhere OAEP needs hLen.
_HLEN = 32


def mgf1_sha256(seed, length):
    """MGF1 mask generation function with SHA-256 (RFC 8017 §B.2.1).

    Conceptually MGF1 is a stream cipher built out of a hash:

        mask = sha256(seed || 0) || sha256(seed || 1) || sha256(seed || 2) || ...

    where each counter is a 4-byte big-endian integer. Concatenate
    enough blocks to cover `length` bytes, then truncate.

    OAEP uses MGF1 twice per encrypt and twice per decrypt: once to
    mask the data block (using the random seed as key) and once to
    mask the seed itself (using the masked data block as key). The
    double-mask scheme is what makes OAEP indistinguishable.
    """
    if length < 0:
        raise ValueError("mgf1_sha256: length must be non-negative")

    num_blocks = (length + _HLEN - 1) // _HLEN
    blocks = []
    for i in range(num_blocks):
        counter = i.to_bytes(4, 'big')
        blocks.append(sha256(seed + counter))
    return b''.join(blocks)[:length]


def oaep_encode(message, k):
    """OAEP encoding (RFC 8017 §7.1.1).

    Produces a `k`-byte encoded message ready to be interpreted as an
    integer and fed to raw RSA encryption.

    Output structure:
        EM = 0x00 || maskedSeed || maskedDB
             (1)     (hLen)        (k - hLen - 1)

    where the data block DB before masking is:
        DB = lHash || PS || 0x01 || message
             (hLen)   (k - mLen - 2*hLen - 2)

    lHash is sha256(empty label) — fixed 32 bytes. PS is zero padding.
    The 0x01 separator marks the boundary between PS and the message.

    The seed is 32 fresh random bytes — one OAEP encryption per call
    has a different seed, so the same plaintext + same key produces
    different ciphertext every time. Non-determinism is a feature.
    """
    if not isinstance(message, (bytes, bytearray)):
        raise TypeError("oaep_encode: message must be bytes or bytearray")
    message = bytes(message)
    m_len = len(message)
    max_m_len = k - 2 * _HLEN - 2
    if m_len > max_m_len:
        raise ValueError(
            f"OAEP: message too long ({m_len} bytes; max is {max_m_len} for k={k})"
        )

    # lHash = sha256(empty label)
    l_hash = sha256(b'')

    # Pad string PS — enough zero bytes to fill the data block
    ps_len = k - m_len - 2 * _HLEN - 2
    ps = b'\x00' * ps_len

    # Data block: lHash || PS || 0x01 || message  (length k - hLen - 1)
    db = l_hash + ps + b'\x01' + message

    # Random seed for this encryption.
    seed = _secrets.token_bytes(_HLEN)

    # Mask the data block with MGF1(seed, len(db))
    db_mask = mgf1_sha256(seed, len(db))
    masked_db = bytes(a ^ b for a, b in zip(db, db_mask))

    # Mask the seed with MGF1(masked_db, hLen)
    seed_mask = mgf1_sha256(masked_db, _HLEN)
    masked_seed = bytes(a ^ b for a, b in zip(seed, seed_mask))

    # EM = 0x00 || masked_seed || masked_db
    return b'\x00' + masked_seed + masked_db


def oaep_decode(em, k):
    """OAEP decoding (RFC 8017 §7.1.2). Reverses oaep_encode.

    SECURITY: every structural check accumulates into a single boolean.
    A single uniform ValueError("OAEP decoding error") is raised at the
    end if any check failed. Verbose error messages would enable
    Manger's attack — see the file header for context.

    Returns the recovered message bytes on success.
    """
    if not isinstance(em, (bytes, bytearray)):
        raise ValueError("OAEP decoding error")
    if len(em) != k:
        raise ValueError("OAEP decoding error")
    if k < 2 * _HLEN + 2:
        raise ValueError("OAEP decoding error")

    em = bytes(em)

    # Single-flag accumulator — never short-circuit out on a failure
    valid = True

    # Step 1: split EM
    y = em[0]
    masked_seed = em[1:1 + _HLEN]
    masked_db = em[1 + _HLEN:]

    # Step 2: recover the seed
    seed_mask = mgf1_sha256(masked_db, _HLEN)
    seed = bytes(a ^ b for a, b in zip(masked_seed, seed_mask))

    # Step 3: recover DB
    db_mask = mgf1_sha256(seed, len(masked_db))
    db = bytes(a ^ b for a, b in zip(masked_db, db_mask))

    # Step 4: lHash check (no early exit)
    expected_l_hash = sha256(b'')
    if y != 0x00:
        valid = False
    if db[:_HLEN] != expected_l_hash:
        valid = False

    # Step 5: find the 0x01 separator after lHash + PS region
    separator_index = -1
    found_non_zero = False
    for i in range(_HLEN, len(db)):
        if separator_index < 0:
            if db[i] == 0x01:
                separator_index = i
            elif db[i] != 0x00:
                # A non-zero, non-0x01 byte before the separator means the
                # padding is invalid. Mark structure invalid but keep
                # scanning to avoid timing variability.
                found_non_zero = True

    if separator_index < 0 or found_non_zero:
        valid = False

    if not valid:
        raise ValueError("OAEP decoding error")

    return db[separator_index + 1:]


# ═════════════════════════════════════════════════════════════════════════════
#  PART E — Public exports (high-level + serialization)
# ═════════════════════════════════════════════════════════════════════════════

def _byte_length(n):
    """Bytes needed to hold the unsigned integer n."""
    return (n.bit_length() + 7) // 8


def rsa_encrypt_oaep(message, public_key):
    """Encrypt `message` (bytes) under (n, e) with OAEP-SHA256 padding.

    Returns ciphertext bytes of length `k` (== byte length of n; 256 for
    RSA-2048).
    """
    k = _byte_length(public_key["n"])
    em = oaep_encode(message, k)
    m_int = int.from_bytes(em, 'big')
    c_int = rsa_encrypt_raw(m_int, public_key)
    return c_int.to_bytes(k, 'big')


def rsa_decrypt_oaep(ciphertext, private_key):
    """Decrypt an OAEP-SHA256 ciphertext under (n, d).

    Raises a uniform ValueError("OAEP decoding error") on any structural
    failure.
    """
    k = _byte_length(private_key["n"])
    if not isinstance(ciphertext, (bytes, bytearray)):
        raise TypeError("rsa_decrypt_oaep: ciphertext must be bytes or bytearray")
    if len(ciphertext) != k:
        raise ValueError("OAEP decoding error")

    c_int = int.from_bytes(bytes(ciphertext), 'big')
    m_int = rsa_decrypt_raw(c_int, private_key)
    em = m_int.to_bytes(k, 'big')
    return oaep_decode(em, k)


# ─────────────────────────────────────────────────────────────────────────────
# Serialization (matching the JS keyManagement.js wire format exactly)
# ─────────────────────────────────────────────────────────────────────────────

def _to_hex(n):
    """Encode a non-negative int as an even-length lowercase hex string,
    no '0x' prefix. Even length matters because the inverse step
    (bytes.fromhex) silently drops a trailing odd digit; matching that
    convention here keeps the round-trip clean.
    """
    if n < 0:
        raise ValueError("_to_hex: value must be non-negative")
    h = format(n, 'x')
    if len(h) % 2 == 1:
        h = '0' + h
    return h


def _from_hex(s):
    """Decode a hex string (with or without '0x' prefix) into an int.
    Empty string decodes to 0.
    """
    if not isinstance(s, str):
        raise TypeError("_from_hex: input must be a string")
    if s.startswith('0x') or s.startswith('0X'):
        s = s[2:]
    if len(s) == 0:
        return 0
    return int(s, 16)


def serialize_public_key(keypair):
    """Convert a keypair dict (int values) to the JSON storage shape.

    Output:
        {"n": "<hex>", "e": "<hex>"}
    """
    return {"n": _to_hex(keypair["n"]), "e": _to_hex(keypair["e"])}


def serialize_private_key(keypair):
    """Convert a keypair dict (int values) to the JSON storage shape.

    Output:
        {"n": "<hex>", "e": "<hex>", "d": "<hex>", "p": "<hex>", "q": "<hex>"}

    No CRT precomputed fields — matches the JS file. If a downstream
    consumer needs CRT (dmp1, dmq1, iqmp) it can compute them on the
    fly from p, q, d.
    """
    return {
        "n": _to_hex(keypair["n"]),
        "e": _to_hex(keypair["e"]),
        "d": _to_hex(keypair["d"]),
        "p": _to_hex(keypair["p"]),
        "q": _to_hex(keypair["q"]),
    }


def parse_public_key(obj):
    """Inverse of serialize_public_key: hex-string dict → int dict.

    Tolerant: if a field is already an int, it is used as-is. This
    mirrors the JS normalizeKey polymorphism.
    """
    def _coerce(v):
        if isinstance(v, int):
            return v
        if isinstance(v, str):
            return _from_hex(v)
        raise TypeError("parse_public_key: field must be int or hex string")
    return {"n": _coerce(obj["n"]), "e": _coerce(obj["e"])}


def parse_private_key(obj):
    """Inverse of serialize_private_key: hex-string dict → int dict."""
    def _coerce(v):
        if isinstance(v, int):
            return v
        if isinstance(v, str):
            return _from_hex(v)
        raise TypeError("parse_private_key: field must be int or hex string")
    out = {}
    for k in ("n", "e", "d", "p", "q"):
        out[k] = _coerce(obj[k])
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Self-test — runs only when this file is executed directly:
#   python rsa.py
# ─────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys
    import os
    import time

    all_pass = True

    def record(name, ok, detail=""):
        global all_pass
        if not ok:
            all_pass = False
        print(f"{'PASS' if ok else 'FAIL'}  {name}")
        if not ok and detail:
            print(f"        {detail}")

    # ── Test 1: number-theoretic primitives ─────────────────────────────
    test1_ok = (
        mod_pow(2, 10, 1000) == 24 and
        mod_pow(3, 200, 17) == 16 and
        mod_inverse(3, 11) == 4 and
        mod_inverse(7, 26) == 15
    )
    threw = False
    try:
        mod_inverse(2, 4)
    except ValueError:
        threw = True
    record(
        "Test 1: number-theoretic primitives (mod_pow, mod_inverse, gcd != 1 raises)",
        test1_ok and threw,
        f"basic_ok={test1_ok} raises_on_no_inverse={threw}",
    )

    # ── Test 2: Miller-Rabin small cases ────────────────────────────────
    mr_cases = [
        (2,    True),
        (7919, True),  # 1000th prime
        (15,   False),
        (1,    False),
        (561,  False), # Carmichael number — fools naive Fermat
    ]
    test2_detail = []
    test2_ok = True
    for n, expected in mr_cases:
        got = miller_rabin(n, 40)
        if got != expected:
            test2_ok = False
            test2_detail.append(f"miller_rabin({n}) = {got}, expected {expected}")
    record("Test 2: Miller-Rabin on 5 known primes/composites incl. Carmichael 561",
           test2_ok, '; '.join(test2_detail))

    # ── Test 3: textbook RSA worked example ─────────────────────────────
    p, q = 61, 53
    n = p * q                   # 3233
    lam = lcm(p - 1, q - 1)     # 780
    e = 17
    d = mod_inverse(e, lam)     # should be 413
    pubkey  = {"n": n, "e": e}
    privkey = {"n": n, "e": e, "d": d, "p": p, "q": q}

    enc = rsa_encrypt_raw(65, pubkey)
    dec = rsa_decrypt_raw(2790, privkey)
    record(
        "Test 3: textbook RSA (p=61, q=53, e=17, lambda-based d=413) round-trip",
        d == 413 and enc == 2790 and dec == 65,
        f"d={d} (expect 413), encrypt(65)={enc} (expect 2790), decrypt(2790)={dec} (expect 65)",
    )

    if not all_pass:
        sys.exit(1)

    # ── Test 4: RSA-2048 OAEP round-trip (slow — keygen 30s+) ───────────
    print("  generating RSA-2048 keypair (this takes 30s-3min)... ", end='', flush=True)
    t0 = time.time()
    keypair = generate_rsa_keypair(2048)
    keygen_secs = time.time() - t0
    print(f"done in {keygen_secs:.1f}s")

    test4_ok = True
    test4_detail = []
    # Round-trip 5 messages of varying lengths
    rt_lengths = [0, 11, 50, 100, 190]   # last one == max for RSA-2048 OAEP-SHA256
    for L in rt_lengths:
        msg = os.urandom(L)
        ct = rsa_encrypt_oaep(msg, keypair)
        if len(ct) != 256:
            test4_ok = False
            test4_detail.append(f"len={L}: ciphertext length {len(ct)}, expected 256")
            continue
        pt = rsa_decrypt_oaep(ct, keypair)
        if pt != msg:
            test4_ok = False
            test4_detail.append(f"len={L}: round-trip failed")
    record(
        f"Test 4: RSA-2048 OAEP round-trip (5 random messages, lengths {rt_lengths})",
        test4_ok,
        '; '.join(test4_detail),
    )

    # ── Test 5: tampered ciphertext rejection ───────────────────────────
    ct = rsa_encrypt_oaep(b"secret", keypair)
    tampered = bytearray(ct)
    tampered[0] ^= 0x01      # flip a bit anywhere
    threw = False
    try:
        rsa_decrypt_oaep(bytes(tampered), keypair)
    except ValueError:
        threw = True
    record("Test 5: OAEP rejects tampered ciphertext", threw)

    # ── Test 6: oversized message rejected ──────────────────────────────
    too_long = b"\x00" * 200   # > k - 2*hLen - 2 = 256 - 64 - 2 = 190
    threw = False
    try:
        rsa_encrypt_oaep(too_long, keypair)
    except ValueError:
        threw = True
    record("Test 6: OAEP rejects oversized message (200 bytes > 190 byte max)", threw)

    # ── Test 7: JSON serialization round-trip ───────────────────────────
    serialized = serialize_private_key(keypair)
    expected_keys = {"n", "e", "d", "p", "q"}
    keys_ok = set(serialized.keys()) == expected_keys
    all_hex = all(
        isinstance(v, str) and len(v) % 2 == 0 and all(c in '0123456789abcdef' for c in v)
        for v in serialized.values()
    )
    restored = parse_private_key(serialized)
    ct = rsa_encrypt_oaep(b"check", restored)
    pt = rsa_decrypt_oaep(ct, restored)
    record(
        'Test 7: serialize -> parse -> round-trip + field shape {"n","e","d","p","q"} hex',
        keys_ok and all_hex and pt == b"check",
        f"keys_ok={keys_ok} all_hex={all_hex} round_trip={(pt == b'check')}",
    )

    if not all_pass:
        sys.exit(1)

    # ── Cross-check vs cryptography (not the source of truth) ──────────
    n_iter = 5
    cross_pass = 0
    try:
        from cryptography.hazmat.primitives.asymmetric import padding
        from cryptography.hazmat.primitives.asymmetric.rsa import (
            RSAPublicNumbers, RSAPrivateNumbers,
            rsa_crt_dmp1, rsa_crt_dmq1, rsa_crt_iqmp,
        )
        from cryptography.hazmat.primitives import hashes

        # Reconstruct cryptography key objects from our scratch keypair.
        # cryptography requires CRT precomputed fields; compute them on
        # the fly from p, q, d.
        public_numbers = RSAPublicNumbers(e=keypair["e"], n=keypair["n"])
        private_numbers = RSAPrivateNumbers(
            p=keypair["p"],
            q=keypair["q"],
            d=keypair["d"],
            dmp1=rsa_crt_dmp1(keypair["d"], keypair["p"]),
            dmq1=rsa_crt_dmq1(keypair["d"], keypair["q"]),
            iqmp=rsa_crt_iqmp(keypair["p"], keypair["q"]),
            public_numbers=public_numbers,
        )
        ca_private = private_numbers.private_key()
        ca_public  = public_numbers.public_key()

        oaep_padding = padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None,
        )

        for i in range(n_iter):
            msg_len = int.from_bytes(os.urandom(2), 'big') % 100 + 1
            msg = os.urandom(msg_len)

            # Direction A: scratch encrypt → cryptography decrypt
            scratch_ct = rsa_encrypt_oaep(msg, keypair)
            ca_pt = ca_private.decrypt(scratch_ct, oaep_padding)
            if ca_pt != msg:
                print(f"FAIL  cross-check A iteration {i + 1}: cryptography rejected scratch CT")
                sys.exit(1)

            # Direction B: cryptography encrypt → scratch decrypt
            ca_ct = ca_public.encrypt(msg, oaep_padding)
            scratch_pt = rsa_decrypt_oaep(ca_ct, keypair)
            if scratch_pt != msg:
                print(f"FAIL  cross-check B iteration {i + 1}: scratch rejected cryptography CT")
                sys.exit(1)

            cross_pass += 1

        print(f"cross-check vs cryptography: {cross_pass}/{n_iter} PASS")

    except ImportError:
        # Fall back to scratch self-consistency
        for i in range(n_iter):
            msg_len = int.from_bytes(os.urandom(2), 'big') % 100 + 1
            msg = os.urandom(msg_len)
            ct = rsa_encrypt_oaep(msg, keypair)
            pt = rsa_decrypt_oaep(ct, keypair)
            if pt != msg:
                print(f"FAIL  self-consistency iteration {i + 1}")
                sys.exit(1)
            cross_pass += 1
        print(f"cross-check skipped (cryptography not installed) - using self-consistency {cross_pass}/{n_iter} PASS")
