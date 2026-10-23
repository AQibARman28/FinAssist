# WARNING: NOT CONSTANT-TIME — square-and-multiply mod_pow over Python ints (no blinding) leaks the private exponent through timing; teaching code only, never use with real secrets (see legacy_crypto/README.md "Known limitations").
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
Two classic padding-oracle attacks, one per RSA padding scheme:
  - Bleichenbacher (CRYPTO 1998) attacks PKCS#1 v1.5 encryption
    padding: a server that reveals whether a ciphertext decrypts to
    something starting 0x00 0x02 lets an attacker decrypt any
    ciphertext with on the order of a million adaptive queries.
  - Manger (CRYPTO 2001) attacks OAEP itself (PKCS#1 v2): if an
    implementation lets an attacker tell "the leading byte Y was not
    0x00" apart from the other decoding failures (lHash mismatch,
    missing 0x01 separator) — via different error messages or timing —
    the attacker can recover the plaintext of a target ciphertext in a
    little over log2(n) oracle queries, i.e. about as many queries as n
    has bits. (It recovers the plaintext, not the private key.)

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
  generation and by lHash. `secrets` for entropy. `hmac.compare_digest`
  only, for the lHash comparison (a stdlib constant-time byte compare,
  not an algorithm). `json` is permitted
  by the spec but the parse/serialize helpers in this file return
  dicts, not JSON strings; callers can json.dumps if they want.

Performance note
─────────────────────────────────────────────────────────────────────────────
Pure-Python RSA is slower than the Node.js BigInt port, which is itself
far slower than `cryptography`'s C-backed implementation. Our
self-rolled mod_pow runs every iteration of the square-and-multiply
loop in Python bytecode (the big-int multiply itself is still CPython's
C code; Python's built-in `pow(a, b, m)` would be faster, but the spec
requires we hand-roll it). Measured figures (Intel i9-11900H, CPython
3.12.10, Windows 11, 2026-10-20; your machine will differ):
  - generate_rsa_keypair(2048): 0.40-1.22 s, median 0.70 s over 25
    runs (Miller-Rabin on candidate primes is the bottleneck; the spread
    comes from how many candidates are rejected).
  - rsa_encrypt_oaep: ~1.8 ms (e=65537 has only 17 mul-steps).
  - rsa_decrypt_oaep: ~26 ms (d is ~2048 bits, so ~2048 squarings plus
    ~1024 multiplications, no CRT).
"""

import hmac as _hmac            # compare_digest only (constant-time compare)
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

    SECURITY: every structural check is computed — none of them returns
    or raises early — and folded into ONE validity flag. A single uniform
    ValueError("OAEP decoding error") is raised at the very end if any
    check failed, so the caller cannot tell "Y != 0" from "lHash
    mismatch" from "bad padding string". Distinguishable failures enable
    Manger's attack — see the file header.

    The lHash comparison uses hmac.compare_digest (no early exit on the
    first differing byte), and the separator scan walks the whole data
    block with flag arithmetic instead of breaking out. This is pure
    Python, so it is still NOT constant-time at the machine level (see
    legacy_crypto/README.md "Known limitations"); it removes the
    data-dependent early exits, which are the obvious timing signal.

    Returns the recovered message bytes on success.
    """
    # Length checks depend only on public sizes (k, len(em)), not on the
    # decrypted content, so failing here leaks nothing new. Same error.
    if not isinstance(em, (bytes, bytearray)) or len(em) != k or k < 2 * _HLEN + 2:
        raise ValueError("OAEP decoding error")

    em = bytes(em)

    # Step 1: split EM = Y || maskedSeed || maskedDB
    y = em[0]
    masked_seed = em[1:1 + _HLEN]
    masked_db = em[1 + _HLEN:]

    # Step 2: recover the seed
    seed_mask = mgf1_sha256(masked_db, _HLEN)
    seed = bytes(a ^ b for a, b in zip(masked_seed, seed_mask))

    # Step 3: recover DB = lHash' || PS || 0x01 || M
    db_mask = mgf1_sha256(seed, len(masked_db))
    db = bytes(a ^ b for a, b in zip(masked_db, db_mask))

    # Step 4: lHash check — constant-time compare, result kept as a flag.
    l_hash_ok = int(_hmac.compare_digest(db[:_HLEN], sha256(b'')))
    y_ok = int(y == 0x00)

    # Step 5: locate the 0x01 separator without stopping early.
    #   looking   — 1 while every byte so far after lHash has been 0x00
    #   sep_index — index of the first non-zero byte, if it is 0x01
    #   bad_ps    — 1 if the first non-zero byte is anything but 0x01
    looking = 1
    sep_index = 0
    bad_ps = 0
    for i in range(_HLEN, len(db)):
        byte = db[i]
        is_zero = int(byte == 0x00)
        is_one = int(byte == 0x01)
        sep_index |= (looking & is_one) * i
        bad_ps |= looking & (1 - is_zero) & (1 - is_one)
        looking &= is_zero
    sep_ok = 1 - looking            # a separator (or bad byte) was found

    valid = y_ok & l_hash_ok & sep_ok & (1 - bad_ps)
    if not valid:
        raise ValueError("OAEP decoding error")

    return db[sep_index + 1:]


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
    # RFC 8017 §7.1.2 step 2b: a ciphertext representative outside [0, n)
    # is reported as the same "decryption error" as every other failure,
    # not as rsa_decrypt_raw's distinguishable message.
    if c_int >= private_key["n"]:
        raise ValueError("OAEP decoding error")
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

    # ── Test 4: RSA-2048 OAEP round-trip (keygen is the slowest step) ────
    print("  generating RSA-2048 keypair (typically about 1 second)... ", end='', flush=True)
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

    # ── Project Wycheproof RSA-OAEP vectors ─────────────────────────────
    # Source: https://raw.githubusercontent.com/C2SP/wycheproof/main/testvectors_v1/rsa_oaep_2048_sha256_mgf1sha256_test.json
    # (Project Wycheproof, C2SP; file SHA-256 83dce701e3d8640ac56e6d7bf37a5a8f9bd6a336e1e932a1e9bfe4ba9c5ea3a9;
    #  "algorithm": "RSAES-OAEP", "numberOfTests": 37; testGroups[0]: keySize 2048,
    #  sha SHA-256, mgf MGF1, mgfSha SHA-256).
    # Subset: valid tcIds [1, 3, 7, 11, 21, 22], invalid tcIds [12, 13, 17, 19, 23, 24, 26, 27, 28, 29, 32] — all with an empty
    # label, since this lab's OAEP has no label parameter. Generated by script from
    # the downloaded JSON: privateKey.modulus / publicExponent / privateExponent and
    # tests[].{tcId, result, flags, comment, msg, ct} are copied verbatim.
    WYCHEPROOF_OAEP = {
        "n": (
            "00a2b451a07d0aa5f96e455671513550514a8a5b462ebef717094fa1fee82224"
            "e637f9746d3f7cafd31878d80325b6ef5a1700f65903b469429e89d6eac88450"
            "97b5ab393189db92512ed8a7711a1253facd20f79c15e8247f3d3e42e46e48c9"
            "8e254a2fe9765313a03eff8f17e1a029397a1fa26a8dce26f490ed81299615d9"
            "814c22da610428e09c7d9658594266f5c021d0fceca08d945a12be82de4d1ece"
            "6b4c03145b5d3495d4ed5411eb878daf05fd7afc3e09ada0f1126422f590975a"
            "1969816f48698bcbba1b4d9cae79d460d8f9f85e7975005d9bc22c4e5ac0f7c1"
            "a45d12569a62807d3b9a02e5a530e773066f453d1f5b4c2e9cf7820283f742b9"
            "d5"
        ),
        "e": "010001",
        "d": (
            "24cdc62317f5d72a6f6ba6cc9632899b01d1ff28867d72f61688995bc855a4e4"
            "20a8405250089bdb13cf8e09543827b748b9d27fbb2b4d9e20af8c5a6a862796"
            "d1a4cc18ad16ea678bc1bd4a83bbbe9c5e57453b5ce7388e41a3ba4ce2b77b44"
            "38a229e954f720dae0353dc088ac8a76b26dc276f8e1b7851ddd6398ad16ff2e"
            "78195123b9b036e945c38c9d12434f6df76fe22359eb3e1ac9c011678fc926fa"
            "d3ae475a4fffff55feb2d147e9c894f4c0e29a599e762462482d968bf4278094"
            "5fc0d2c31c573c4431b8f4fe8b8c67bec815abd44f7a86edca1c2308737358d2"
            "c2ae5e2e0e2dadf730980262377e58b13b7d9992060a0bc870ccfdb4a9319ee1"
        ),
        "tests": [
            {
                "tcId": 1, "result": "valid", "flags": ["Normal"],
                "comment": "",
                "msg": "",
                "ct": (
                    "6e62bf24d95aff6868afec2a92a445b6458f16f688c19fe1212f66a631378316"
                    "53cedd359d8cff4dd485d77dfd55812c181373201f54aafd65730d2a304e6234"
                    "55d51125d891e65d97fce52341cae45fb64c38a384a1c621e2713ee6794633f0"
                    "29a9fd4d774f56551eac2176162e162640f25eab873a3451c475570f19228bce"
                    "de4c67c370a75ed7fabccd538c9819eff182481b10d42f1a9f6a05373b8cf9b7"
                    "1818d467bd3b8ebacb619e8ad42916e600c043effceb3855bc48a629e60ae886"
                    "f51b2a7876b0e623fb2ce68af4b039242f963adb0e4240aed0ed07f65f1ee7c0"
                    "cc77d210d0c2d1dc10c81b881aa0c9c9e9499665cf2970d2ccfeeb3191531765"
                ),
            },
            {
                "tcId": 3, "result": "valid", "flags": ["Normal"],
                "comment": "",
                "msg": "54657374",
                "ct": (
                    "5eab3f0741e63986ed647d53e1cd71df041986900803d0f99c68355d249a15a4"
                    "7dc5b4f70a191477654299e5a2731f3b4eec76dea18262fc696ac794e5f66cbf"
                    "cddac4472c578e246c26707598055584540b839836b1404c5611ae558a984cee"
                    "8fd036cea924e0be2474a940f61e0acc14fcae95ebdc59942a9ce9af9a9c8199"
                    "9f7f6815f057ffdc2533cb15d6391d1e2d95f16f9c04209c889a4c359c7d2926"
                    "d28a66e2b030a416b928d2825627998e5191fb4983a6e65024262d94fc09187a"
                    "2d78162122433251d1bfcc8e507d06eba2d229c10031261da32ab8ccd15f1c5f"
                    "9fbf07ed158483d736a110af4b44d6a4da60d6cb519b4454213cf9f0dc560f2b"
                ),
            },
            {
                "tcId": 7, "result": "valid", "flags": ["Normal"],
                "comment": "",
                "msg": "e0e1e2e3e4e5e6e7e8e9eaebecedeeeff0f1f2f3f4f5f6f7f8f9fafbfcfdfeff",
                "ct": (
                    "096958786ee7972050d67a9e4b69d6c6af7db7cc674386df725770dd29129b82"
                    "6e39552330104c8d71e6cc3a3014dd2f61b54153af51b0438d447ee939f9e3c1"
                    "3bb8b00a37dea6a068f6c9d27e848b1be7a1eeeb3ee50b78036fba95ae46948c"
                    "a5b13f356ea24db10f60dc09e4b8bad8f766b668ef72524432080a0ce00ed676"
                    "d6d5e354984b1078520412525848156d06f0652469f95791baa3d9a798ae5370"
                    "94f76f976faecd5c9ce0c930a75910c63dacf63485cb4b5e7bdbcf4d80e74037"
                    "eaa1a8fe4b52930bec6be99cf6ac88cf5878dbf6859d456a95dbc34654eec425"
                    "de84ca2a535d517403a9aada827e7d0093ecfc97ed056a7652825e9a45cb2dcb"
                ),
            },
            {
                "tcId": 11, "result": "valid", "flags": ["Normal"],
                "comment": "Longest valid message size",
                "msg": "78787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878",
                "ct": (
                    "7efb69f1137d6a6e813b7ab75bf0400b3d07a442b88ab048675dc06b0215fc1a"
                    "2e033263ec31a6c1d2eac56cb0470d69022a48131d1f000bbed70586b80cf635"
                    "6465c8834daced7ea2a5ff8ef9c44d5ab828ffbf0556a6394752a4a28a70cae2"
                    "0084e1236f042f6c29de5cb34ef73acba5abcc7ccb3a26342701df3b9daa945d"
                    "9fa5bf0b9b10306655e56370183f50fb8321f8f0cd1c72114791fca5df216629"
                    "6b509b01a0b291c46110787cebe69d41b3b1e89590bc2f5e5d49ea24ae0f1207"
                    "eef1aee54b9760553e80c5506a8a8a75732e92875025f0bfd5ead71e4340c8a9"
                    "fa16dcd5a7dc96d8c4a7dc4e91f47a69366445c4695c8bad578ffe52bb672f65"
                ),
            },
            {
                "tcId": 21, "result": "valid", "flags": [],
                "comment": "seed is all 0",
                "msg": "313233343030",
                "ct": (
                    "8e5f01ff0c1775870715fd0366a8748531f8b00803df35e0e2308db63bbec4ec"
                    "a4e093351876b794213b904e5dde284a82d74abfcbfff94bc9a8300bea99edd0"
                    "7fe97d6e0b11219f85ac15acc404d37d3da16819a14a438f3f72f8178b312526"
                    "232386e918a8a7e11fc38f4668c499a00480cf9d2d75aabc0198d3ba9ba345fb"
                    "a9105c6564df5f6ce796f14100d186abffe4d83d57969c1caddc7c7aa340b4d1"
                    "bab23d9b3982278328ddebe648f5c52588738f3c56a88b3f34c890c03fafc27f"
                    "485a17677a53e974dc1dd86f463a927f4328ac51bbc61705ae8abd7f45628957"
                    "489e2defd8e043b955b118fb2a1c407d45893004aae0f945f06add1e45b41a03"
                ),
            },
            {
                "tcId": 22, "result": "valid", "flags": [],
                "comment": "seed is all 1",
                "msg": "313233343030",
                "ct": (
                    "50c23e2ad6e3f3b10a5716cbf60efcc9f66d2c6f17bf050ba0153b877ba2755e"
                    "8a0d54060034562266155744ef80547b8af777b0ff764fbb12baae49d02b4f6d"
                    "65b6cd8f0a397839101d32ae163ff2e6072748d6b8017e5e73e332d53f4e91fe"
                    "6233a82dbf54f3146b489803575c5ea37ab55a9ea7eae47ad4f1727d45822b56"
                    "9cd6e5d4b6ab759850948186616b5da2a9a316f57d899f91934bbb27edcdfa19"
                    "532ba1c01f3724738daffdd88c9a18562ebcbc49185b0a817407903476d442c4"
                    "24c81b63aeb8f9d1b184756e0cc0a381eaba45a85c8bbc6770fd047ff1a6404a"
                    "384599fbbd6a40b212a066e23f6a15cf13e42c0ea88c710e4d70c612074968e5"
                ),
            },
            {
                "tcId": 12, "result": "invalid", "flags": ["InvalidOaepPadding"],
                "comment": "first byte of l_hash modified",
                "msg": "313233343030",
                "ct": (
                    "287d7108a1c6e7a18acb0045b20c57cdf2ac03456b44942764a7a9e9fdf3db48"
                    "1d7e202e4c8d733b56b9c1e93d71e791af8325c9363df789b252a5ed0eddc79e"
                    "76fa41c2cb0a35618398217a390a5e6d99eed905d5554d19c1cf4e30bdf1c2fc"
                    "c5148b641d71b3f1977b63d232648ddd935ec9499a53ac2fbcac55f462e91065"
                    "adaa018a39c453ba759bd68b454074153421e2ce75cf149f748b5b84758df8a4"
                    "23d1c50c880af863f2a6df3cd465ca36aa2152b5771f3d507f4a4dd9f8006d80"
                    "eca23537092287976f218a90df1e16d889fe31e79f7309f3224f613e9b52479f"
                    "e73b7aad915319a3b62a5936649f7d015d7b09f7fa9f454f78a7c3dd4bf791e0"
                ),
            },
            {
                "tcId": 13, "result": "invalid", "flags": ["InvalidOaepPadding"],
                "comment": "last byte of l_hash modified",
                "msg": "313233343030",
                "ct": (
                    "8b65065af82770625d24917d13fd97ae13247cad97910a2651f95800165b76cc"
                    "34bfe06cbf8c31a7d7ab4f41e05c45a25b90c606378c8e49c95a15ca11ae37e7"
                    "97a00f1b2680a6958c54396be4e1ceedcabc58d9f136b36867a2fefe648a9758"
                    "f49634bfbcaa48717a116cba58c27539be10c56911aabe013e0329645e830842"
                    "3c3aa42e0c9b1f4b5f546ddd9f90bf4d007dab52ac3879db755e4f2b96db5cf0"
                    "1950f39076f261f50b1bae137be500b03ceff6ea1bbd80b33424f7faba5cc6b8"
                    "6670fcb7db1a9b3c58bdfd7b75ba9f3ebd34ae32d320c757020a7324df7d3985"
                    "bccfe0e81bb7f61bd98cb37219312299b4f274b2c90c52a8e1790f52e8fdd768"
                ),
            },
            {
                "tcId": 17, "result": "invalid", "flags": ["InvalidOaepPadding"],
                "comment": "all bits in ps flipped",
                "msg": "313233343030",
                "ct": (
                    "4b4546460b54697beb899b54f474079169b4f7e79d0299586d821bd9091e9c5d"
                    "2603b96c1aeb2924e887b15b211b07a657a85629932f97f18acd5a9f15684c99"
                    "59fa41a6d1c10eeca68b7b95179492e80927860b7fadce3eb4e1e8610adc709e"
                    "25580d8c7ad95af1de3a94b4a09e3078b86e88ae9630388711d20e28c801131c"
                    "d1f924dfeddd85a9d404ef5db9e6a887845b5aa4763fbb72f259985ccf7ee6fc"
                    "8329bf1ded74e5112f8c16df81e8038443df4bacb2eae1b06a48f178cdf22579"
                    "41ca5887db4dc5135f0a2d050f56ac94ad9ffd4a13925c85501976937e723979"
                    "cc31fd48c4d68d06e4c9cee53517dcb18da61fe4347658df495508d6ea9d7282"
                ),
            },
            {
                "tcId": 19, "result": "invalid", "flags": ["InvalidOaepPadding"],
                "comment": "ps is all zero",
                "msg": "313233343030",
                "ct": (
                    "a166bf7b5c2cf1896c0b924a69233a0a585bd47ed7f2330654aa68806deb0ff6"
                    "8c6475050ab45c691bbbcc58dbc2f5c817729e8e195ebd39d48bd5e14977abae"
                    "0829636831655917fb5a758fb43a8e505d6ce595f625970685f7ec81cb559221"
                    "0f5d68c6e2e1ef26b4ef8c92bf44f077e1d5099f379cb8120ad185bf07877979"
                    "ca81f251fb81be0ad3c14f4d7885fcec496f80033fd4279b6830a20cbdead27c"
                    "0967e28d1e06ef4bd7ba89210ec0d696274a187dc2f13212f5adf06e9450eca3"
                    "98325cfda73431036ac21b087d373c9f575c941f8cb078961176e31859a61c49"
                    "baf8ff4f817a11010448d6a0e40dcede1a5ac3befa4c6e9d9d67d8e8fd8b6de3"
                ),
            },
            {
                "tcId": 23, "result": "invalid", "flags": ["InvalidOaepPadding"],
                "comment": "First byte is 1",
                "msg": "313233343030",
                "ct": (
                    "3f92a694661cae336cac7a3c5a6f67e0655d10218a64459739ab9664f2cec589"
                    "78939512df621e6b92fe3429bb22c08b5103da648a7719e7e95a04e6b6160154"
                    "6955825d60f4c517619f851780ad17f1b8a955cf8c7f1a5e26ca4a0cc19cca75"
                    "1d0790d56e1140a4705e19274f638b7c16d9d3e423a7f787d02699235e3e9e4d"
                    "543a954f9b1bce5411c8ebdcae86a4bb86c66818a0bab51a2b00383b318e53d9"
                    "5508bab1b19e388cd5a03cdceba0f7176c1782e19ef62cff69352d444b1ce0e1"
                    "f339e96d8a65c07aa37f5f2cf33867f6c496e0da6cd79b3e2183b57064ce21a1"
                    "b92072702e555a82cad75107fdfd8bd5e7ea5f119cfbbc1770e962fd0b781aff"
                ),
            },
            {
                "tcId": 24, "result": "invalid", "flags": ["InvalidOaepPadding"],
                "comment": "m is 0",
                "msg": "313233343030",
                "ct": (
                    "0000000000000000000000000000000000000000000000000000000000000000"
                    "0000000000000000000000000000000000000000000000000000000000000000"
                    "0000000000000000000000000000000000000000000000000000000000000000"
                    "0000000000000000000000000000000000000000000000000000000000000000"
                    "0000000000000000000000000000000000000000000000000000000000000000"
                    "0000000000000000000000000000000000000000000000000000000000000000"
                    "0000000000000000000000000000000000000000000000000000000000000000"
                    "0000000000000000000000000000000000000000000000000000000000000000"
                ),
            },
            {
                "tcId": 26, "result": "invalid", "flags": ["InvalidOaepPadding"],
                "comment": "m is n-1",
                "msg": "313233343030",
                "ct": (
                    "a2b451a07d0aa5f96e455671513550514a8a5b462ebef717094fa1fee82224e6"
                    "37f9746d3f7cafd31878d80325b6ef5a1700f65903b469429e89d6eac8845097"
                    "b5ab393189db92512ed8a7711a1253facd20f79c15e8247f3d3e42e46e48c98e"
                    "254a2fe9765313a03eff8f17e1a029397a1fa26a8dce26f490ed81299615d981"
                    "4c22da610428e09c7d9658594266f5c021d0fceca08d945a12be82de4d1ece6b"
                    "4c03145b5d3495d4ed5411eb878daf05fd7afc3e09ada0f1126422f590975a19"
                    "69816f48698bcbba1b4d9cae79d460d8f9f85e7975005d9bc22c4e5ac0f7c1a4"
                    "5d12569a62807d3b9a02e5a530e773066f453d1f5b4c2e9cf7820283f742b9d4"
                ),
            },
            {
                "tcId": 27, "result": "invalid", "flags": ["InvalidCiphertext"],
                "comment": "added n to c",
                "msg": "313233343030",
                "ct": (
                    "b056e2513c7c470d897032d406e97b5946dcad52df1c1650d61a1d7b0af59e8c"
                    "faec4d9e834d06d819b92a7d440d277e5039ab8aeff25043e98b281ae6ce0a91"
                    "f8dfbbd1b4998fe5481671381b6a3952448b617ae606f06a0143561a040edaf3"
                    "c972e611bd7cb814aa4761d38e4a007ca65af8fde6eb25d919d8bd9273cca762"
                    "2984aa27994d049612424547775c5df75483962143522d075b8c55ea61b04583"
                    "eb4c0358f9fbb902dedff30b7d8592b57094df4f6345668af53d1aea86fb36dd"
                    "69b4434bacf8fc12c13802f5b03551ba8f207d4060a9f56e6b7e18c766eb82b6"
                    "ce6ee0747fbe785c3c1c25fe7fb87de50032b172129fa41a69c3ce0e777ef10f"
                ),
            },
            {
                "tcId": 28, "result": "invalid", "flags": ["InvalidCiphertext"],
                "comment": "ciphertext not reduced",
                "msg": "313233343030",
                "ct": (
                    "6ea4320bc5bcae709d0e4b9d67e7f0c248a65c5bc0762910e220ea96bdea088e"
                    "20ce7ffb726a8fd87fa363249dc0ace75fdbe025b270dd72490cb164c4683881"
                    "17bd95624bddfb70c1f07f98a6b9ccf9cee3d2b5f5b3e79a6664568a788b3f10"
                    "02fc9546d6b3a0fb5f3cfb14f70785dc542dbbbaffbb3b791f0a5906ace090a3"
                    "c29d123db768ecce56f0dbf99956f070ce2ebe8209c2ff6de6064ac6247f81c4"
                    "064960c516f684f9e740b00f361844d9c1bcb1553bed9b297462e8badd3d431a"
                    "09b62c773b0071a8d734aae4de04bac45b7bf8555471e937b0a36f0c1bce595e"
                    "c9b3d366c9109319a3501156a08c21393e31fcffa2c51b242dac9f813c8f9686"
                    "00"
                ),
            },
            {
                "tcId": 29, "result": "invalid", "flags": ["InvalidCiphertext"],
                "comment": "ciphertext is empty",
                "msg": "313233343030",
                "ct": "",
            },
            {
                "tcId": 32, "result": "invalid", "flags": ["InvalidCiphertext"],
                "comment": "truncated ciphertext",
                "msg": "313233343030",
                "ct": (
                    "a290b0bf71a1141b2adc62b5b42b07fc52520cb05d1f39ccca7b7c22d379a6c2"
                    "f2d93143d057050140527a1e5638243938b531ec3de7014b0151301e49b9fa43"
                    "3482a02abdfd94193dc9c70157e557776a69ded01ecbeac405133595c61165a4"
                    "28b6284729a4746b47d2bbaca9d7432c3b5693591cfee488eb3c68ddb6cde0dd"
                    "61cfc6952423f994abecee34f5683732b29934a2c498ad48cdd30c149177189f"
                    "48eefd9cc7232df18be11ff5f7e3af7319e3115997c599e2d8f7f4f663dcc400"
                    "32d403436d3058a5ea66473660f0e195281ec6eba997d2a951ca6ca5f3c11271"
                    "5c89da1d3dfb20a21940594ed10ade90ed7452b753757d7241cb8a803c373a"
                ),
            },
        ],
    }
    wp_key = {
        "n": int(WYCHEPROOF_OAEP["n"], 16),
        "e": int(WYCHEPROOF_OAEP["e"], 16),
        "d": int(WYCHEPROOF_OAEP["d"], 16),
    }

    # ── Test 8: Wycheproof "valid" ciphertexts decrypt to the expected msg
    wp_valid = [t for t in WYCHEPROOF_OAEP["tests"] if t["result"] == "valid"]
    wp_fail = []
    for t in wp_valid:
        try:
            pt = rsa_decrypt_oaep(bytes.fromhex(t["ct"]), wp_key)
            if pt.hex() != t["msg"]:
                wp_fail.append(f"tcId {t['tcId']}: wrong plaintext")
        except Exception as exc:                      # noqa: BLE001
            wp_fail.append(f"tcId {t['tcId']}: raised {type(exc).__name__}: {exc}")
    record(f"Test 8: Wycheproof RSA-OAEP-2048-SHA256 - {len(wp_valid)} valid ciphertexts decrypt to the expected msg",
           bool(wp_valid) and not wp_fail, "; ".join(wp_fail))

    # ── Test 9: Wycheproof "invalid" ciphertexts rejected, uniform error
    wp_invalid = [t for t in WYCHEPROOF_OAEP["tests"] if t["result"] == "invalid"]
    wp_fail = []
    for t in wp_invalid:
        outcome = "ACCEPTED"
        try:
            rsa_decrypt_oaep(bytes.fromhex(t["ct"]), wp_key)
        except Exception as exc:                      # noqa: BLE001
            outcome = f"{type(exc).__name__}: {exc}"
        # Every failure must look identical to the caller — padding errors
        # (Manger) and malformed ciphertexts alike.
        if outcome != "ValueError: OAEP decoding error":
            wp_fail.append(f"tcId {t['tcId']} ({t['comment']}): {outcome}")
    record(f"Test 9: Wycheproof RSA-OAEP-2048-SHA256 - {len(wp_invalid)} invalid ciphertexts rejected with the uniform error",
           bool(wp_invalid) and not wp_fail, "; ".join(wp_fail))

    # ── Test 10: oaep_decode — one failure mode; lHash via compare_digest
    # Hand-build encoded messages (EM) with each structural fault, alone
    # and combined, and require the exact same exception for all of them.
    # A spy on hmac.compare_digest confirms the lHash check uses it.
    import types as _types

    def craft_em(k, y=0, lhash_ok=True, ps_bad=False, sep=True, msg=b"hi"):
        lh = sha256(b"") if lhash_ok else b"\xff" * _HLEN
        ps = bytearray(k - len(msg) - 2 * _HLEN - 2)
        if ps_bad:
            ps[len(ps) // 2] = 0x02
        db = lh + bytes(ps) + (b"\x01" if sep else b"\x00") + msg
        seed = b"\x5a" * _HLEN
        masked_db = bytes(a ^ b for a, b in zip(db, mgf1_sha256(seed, len(db))))
        masked_seed = bytes(a ^ b for a, b in zip(seed, mgf1_sha256(masked_db, _HLEN)))
        return bytes([y]) + masked_seed + masked_db

    spy_calls = []
    real_hmac = _hmac

    def _spy(a, b):
        spy_calls.append((len(a), len(b)))
        return real_hmac.compare_digest(a, b)

    _hmac = _types.SimpleNamespace(compare_digest=_spy)
    try:
        k_test = 256
        good_ok = oaep_decode(craft_em(k_test), k_test) == b"hi"
        faults = {
            "Y != 0":                 dict(y=1),
            "lHash mismatch":         dict(lhash_ok=False),
            "non-zero PS byte":       dict(ps_bad=True),
            "no 0x01 separator":      dict(sep=False, msg=b""),
            "Y != 0 + lHash":         dict(y=1, lhash_ok=False),
            "lHash + PS + no sep":    dict(lhash_ok=False, ps_bad=True, sep=False, msg=b""),
        }
        outcomes = {}
        for label, kw in faults.items():
            try:
                oaep_decode(craft_em(k_test, **kw), k_test)
                outcomes[label] = "ACCEPTED"
            except Exception as exc:                  # noqa: BLE001
                outcomes[label] = f"{type(exc).__name__}: {exc}"
    finally:
        _hmac = real_hmac
    uniform = all(v == "ValueError: OAEP decoding error" for v in outcomes.values())
    used_compare_digest = len(spy_calls) == 1 + len(faults) and all(c == (_HLEN, _HLEN) for c in spy_calls)
    record(
        "Test 10: oaep_decode - 6 fault combinations raise the identical error; lHash checked with hmac.compare_digest",
        good_ok and uniform and used_compare_digest,
        f"good_ok={good_ok} outcomes={outcomes} compare_digest_calls={spy_calls}",
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
