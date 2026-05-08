"""
PBKDF2-SHA256 implemented from scratch (RFC 8018 §5.2).

This file is a direct port of Backend/utils/scratch/pbkdf2.js — same
chained-HMAC construction, same storage format, same default work factor.

Why PBKDF2 exists at all
─────────────────────────────────────────────────────────────────────────────
Naïvely storing a password as `sha256(password || salt)` is broken not
because the math is wrong, but because the math is *too fast*. SHA-256 is
designed to hash gigabytes per second. An attacker with a stolen database
row can try billions of password guesses per second per GPU, so any
human-memorable password gets cracked in minutes.

PBKDF2's whole job is to make the hash function deliberately slow. It
runs the underlying primitive (HMAC-SHA256 in our case) `iterations`
times in a tight chain — 100,000 iterations means each guess costs the
attacker 100,000 HMAC calls instead of one. That drags brute-forcing
from billions/sec down to thousands/sec on the same hardware. The user
sees the same single verification at login time (still well under a
second on JS / a couple of seconds in pure Python), but the attacker
sees a five-orders-of-magnitude tax on every guess.

The cost factor is configurable, which is the whole point: as hardware
gets faster, you bump `iterations` up to keep the verification time
roughly constant (the OWASP recommendation has crept from 1,000 in the
2000s to 600,000+ today for SHA-256). Older stored hashes stay valid
because the iteration count travels with each record.

Why we replaced bcrypt
─────────────────────────────────────────────────────────────────────────────
Real bcrypt is built on the Eksblowfish key derivation, which abuses the
Blowfish block cipher's key schedule as a deliberate-slow-mixing
function. Implementing bcrypt from scratch means writing a full Blowfish,
then writing the modified key schedule on top of it — a substantial
detour that wouldn't reuse anything else in this folder.

PBKDF2-SHA256 is not bcrypt, but it satisfies the same role: a slow,
salted, parameterized password hash. And crucially, it is built entirely
on HMAC-SHA256, which we already have.

Constant-time comparison in verify_password
─────────────────────────────────────────────────────────────────────────────
The same reasoning as the GCM tag check: a byte-by-byte equality
function that exits on first mismatch leaks information about *which*
byte differed via response timing. An attacker can use that signal to
recover the stored hash one byte at a time. We walk every byte
unconditionally and combine the results with bitwise OR so the loop
body cost is independent of where the strings start to differ.

Allowed dependencies
─────────────────────────────────────────────────────────────────────────────
`hmac_sha256` from our local scratch HMAC module (the only require for
the actual PBKDF2 work). `secrets.token_bytes` for entropy when
generating the salt in hash_password — that is the Python equivalent of
crypto.randomBytes, OS-CSPRNG-backed and explicitly permitted.
"""

# ─────────────────────────────────────────────────────────────────────────────
# Note for FinAssist integration: when this module is invoked via
# subprocess from the Node.js backend, each PBKDF2 call carries a
# ~100ms Python interpreter cold-start overhead. To keep login latency
# tolerable in development we may use 10000 iterations instead of the
# OWASP-recommended 100000. This is a DEVELOPMENT-ONLY configuration;
# production deployments must restore the iteration count to at least
# 100000 (and ideally migrate to a long-running Python sidecar so the
# interpreter cost is amortized away). The algorithm itself is the
# same — only the work-factor parameter is reduced.
#
# The function signature default below stays at 100000. Anyone calling
# hash_password(password, iterations=10000) explicitly is making a
# deliberate choice and accepting that tradeoff.
# ─────────────────────────────────────────────────────────────────────────────

import secrets

from hmac_sha256 import hmac_sha256


# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

# The output size of SHA-256 in bytes. RFC 8018 calls this `hLen`. PBKDF2
# generates the requested key in chunks of this size and concatenates them.
HASH_OUTPUT_BYTES = 32

# Defaults for hash_password. The iteration count and 16-byte salt match
# common PBKDF2-SHA256 deployments; 32 bytes of derived key gives a
# sufficient-for-anything output size.
HASH_PASSWORD_ITERATIONS  = 100000
HASH_PASSWORD_KEY_LENGTH  = 32
HASH_PASSWORD_SALT_LENGTH = 16


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _to_bytes(value, label):
    """Coerce `value` to bytes. Strings become UTF-8; bytes/bytearray pass through.

    The `label` argument only flavours the error message.
    """
    if isinstance(value, (bytes, bytearray)):
        return bytes(value)
    if isinstance(value, str):
        return value.encode('utf-8')
    raise TypeError(f"pbkdf2: {label} must be str, bytes, or bytearray")


def _int32_be(n):
    """Encode a non-negative integer `n` as a 4-byte big-endian bytes object.

    RFC 8018 calls this `INT(i)`. PBKDF2 appends INT(block_index) to the
    salt for the first HMAC call of each block, so different output
    blocks are derived from different inputs — they aren't just copies of
    the same hash.
    """
    if n < 0 or n > 0xFFFFFFFF:
        raise ValueError("_int32_be: input out of 32-bit unsigned range")
    return n.to_bytes(4, 'big')


def _constant_time_equal(a, b):
    """Constant-time byte comparison.

    Returns True iff `a` and `b` are byte-identical. The runtime depends
    on the *length* of the inputs but not on their contents, so an
    attacker cannot use response timing to learn which byte first
    differed.

    (Length mismatch returns False immediately — there is no way to make
    the comparison time independent of length without picking a fixed
    length to pad to, and the length of a stored derived key is not
    itself secret.)
    """
    if len(a) != len(b):
        return False
    diff = 0
    for x, y in zip(a, b):
        diff |= x ^ y
    return diff == 0


# ─────────────────────────────────────────────────────────────────────────────
# Core derivation
# ─────────────────────────────────────────────────────────────────────────────

def _derive_block(password, salt, iterations, block_index):
    """Compute one 32-byte output block T_i of PBKDF2 — RFC 8018 §5.2 step 3.

      U_1     = HMAC(password, salt || INT32_BE(block_index))
      U_j     = HMAC(password, U_{j-1})    for j = 2..iterations
      T_i     = U_1 XOR U_2 XOR ... XOR U_iterations

    Note that the chain is sequential — U_j depends on U_{j-1} — so all
    `iterations` HMACs must run in order. This is what makes PBKDF2 slow:
    an attacker cannot parallelize within a single guess, only across guesses.
    """
    # Seed for U_1: salt with the 4-byte block counter appended.
    seed = salt + _int32_be(block_index)

    # U_1 = HMAC(password, seed)
    u = hmac_sha256(password, seed)

    # Initialize the running XOR accumulator with U_1.
    # bytearray gives us in-place XOR; the source bytes from `u` stay
    # immutable.
    t = bytearray(u)

    # Iterations 2..n: chain HMACs and XOR each into T.
    for _ in range(2, iterations + 1):
        u = hmac_sha256(password, u)
        for k in range(HASH_OUTPUT_BYTES):
            t[k] ^= u[k]

    return bytes(t)


def pbkdf2(password, salt, iterations, key_length):
    """PBKDF2-SHA256 — derive `key_length` bytes from (password, salt) using
    `iterations` rounds.

    Args:
        password:    str, bytes, or bytearray.
        salt:        str, bytes, or bytearray.
        iterations:  positive integer; how slow is "slow".
        key_length:  desired output length in bytes (positive integer).

    Returns:
        bytes of length `key_length`.
    """
    if not isinstance(iterations, int) or iterations < 1:
        raise ValueError("pbkdf2: iterations must be a positive integer")
    if not isinstance(key_length, int) or key_length < 1:
        raise ValueError("pbkdf2: key_length must be a positive integer")

    password_buf = _to_bytes(password, 'password')
    salt_buf     = _to_bytes(salt,     'salt')

    # Number of 32-byte chunks needed; we'll truncate the last one if the
    # requested key_length is not a multiple of HASH_OUTPUT_BYTES.
    # ceil(a/b) for non-negative integers = (a + b - 1) // b.
    num_blocks = (key_length + HASH_OUTPUT_BYTES - 1) // HASH_OUTPUT_BYTES
    output     = bytearray(num_blocks * HASH_OUTPUT_BYTES)

    # T_1, T_2, ..., T_l — each block independent of the others (they
    # differ only in the INT32_BE(i) appended to the salt for U_1).
    for i in range(1, num_blocks + 1):
        t = _derive_block(password_buf, salt_buf, iterations, i)
        output[(i - 1) * HASH_OUTPUT_BYTES : i * HASH_OUTPUT_BYTES] = t

    # Truncate to the requested length.
    return bytes(output[:key_length])


# ─────────────────────────────────────────────────────────────────────────────
# Storage-format wrappers
# ─────────────────────────────────────────────────────────────────────────────

# Stored password format:
#
#   pbkdf2-sha256$<iterations>$<salt_hex>$<derived_key_hex>
#
# A single dollar-separated string per record:
#   - "pbkdf2-sha256"   — algorithm tag, makes future migrations possible
#   - <iterations>      — decimal integer, lets us bump cost over time
#                         without invalidating older stored hashes
#   - <salt_hex>        — the random per-record salt, hex-encoded
#   - <derived_key_hex> — the PBKDF2 output, hex-encoded
#
# Every column needed to verify the password is in this one string, so
# the database column can be a simple TEXT/VARCHAR. Mirrors the
# established "passlib" convention used by Django, Werkzeug, etc.

def hash_password(password, iterations=HASH_PASSWORD_ITERATIONS):
    """Hash a password for storage.

    Generates a fresh 16-byte random salt, runs PBKDF2 with the given
    iteration count (default 100,000) and a 32-byte output, and returns
    the dollar-separated storage string.

    The salt comes from `secrets.token_bytes`, which is OS-CSPRNG-backed
    on every supported platform. Without a fresh salt per password, two
    users picking the same password would have identical stored hashes,
    which lets an attacker target many users' rows with a single
    brute-force run.
    """
    salt = secrets.token_bytes(HASH_PASSWORD_SALT_LENGTH)
    dk   = pbkdf2(password, salt, iterations, HASH_PASSWORD_KEY_LENGTH)
    return f"pbkdf2-sha256${iterations}${salt.hex()}${dk.hex()}"


def verify_password(password, stored):
    """Verify a password against a previously-stored hash string.

    Parses the dollar-separated format, re-derives the key with the same
    salt and iteration count, and constant-time-compares against the
    stored derived key. Returns False on any parse failure or mismatch —
    never raises, so caller code can treat the boolean as the only signal.
    """
    if not isinstance(stored, str):
        return False

    parts = stored.split('$')
    if len(parts) != 4:
        return False
    if parts[0] != 'pbkdf2-sha256':
        return False

    # Parse iteration count strictly: only decimal digits, at least one.
    if not parts[1].isdigit():
        return False
    iterations = int(parts[1])
    if iterations < 1:
        return False

    # Decode the hex salt and stored derived key. bytes.fromhex raises on
    # invalid input; we catch and treat as parse failure.
    try:
        salt        = bytes.fromhex(parts[2])
        expected_dk = bytes.fromhex(parts[3])
    except ValueError:
        return False

    if len(salt) == 0 or len(expected_dk) == 0:
        return False

    actual_dk = pbkdf2(password, salt, iterations, len(expected_dk))
    return _constant_time_equal(actual_dk, expected_dk)


# ─────────────────────────────────────────────────────────────────────────────
# Self-test — runs only when this file is executed directly:
#   python pbkdf2.py
# Two RFC vectors + hash_password/verify_password round-trip + 20-iteration
# cross-check vs hashlib.pbkdf2_hmac. Test 2 runs 80,000 iterations and is
# intentionally slow (a couple of seconds in pure Python).
# ─────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys
    import time

    all_pass = True

    # ── Test 1 — RFC 6070-style small-iteration vector ──────────────────
    {
        # (Python doesn't have block-scoped statements; using a dict-or-comment
        # marker to indicate the test groupings is just visual aid.)
    }
    print("  running Test 1 (1 iteration, 64 bytes)... ", end='', flush=True)
    t0 = time.time()
    got = pbkdf2("passwd", "salt", 1, 64).hex()
    expected_t1 = (
        "55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc"
        "49ca9cccf179b645991664b39d77ef317c71b845b1e30bd509112041d3a19783"
    )
    if got == expected_t1:
        print(f"PASS ({(time.time() - t0):.2f}s)")
    else:
        all_pass = False
        print("FAIL")
        print(f"      expected: {expected_t1}")
        print(f"      got:      {got}")

    # ── Test 2 — RFC 7914 large-iteration vector (slow) ─────────────────
    print("  running Test 2 (80,000 iterations, 64 bytes — slow)... ", end='', flush=True)
    t0 = time.time()
    got = pbkdf2("Password", "NaCl", 80000, 64).hex()
    elapsed = time.time() - t0
    expected_t2 = (
        "4ddcd8f60b98be21830cee5ef22701f9641a4418d04c0414aeff08876b34ab56"
        "a1d425a1225833549adb841b51c9b3176a272bdebba1d078478f62b397f33c8d"
    )
    if got == expected_t2:
        print(f"PASS ({elapsed:.1f}s)")
    else:
        all_pass = False
        print("FAIL")
        print(f"      expected: {expected_t2}")
        print(f"      got:      {got}")

    # ── Test 3 — hash_password / verify_password round-trip ─────────────
    print("  running Test 3 (hash_password + verify_password)... ", end='', flush=True)
    t0 = time.time()
    stored = hash_password("hunter2")
    accept_correct = verify_password("hunter2", stored)
    reject_wrong   = verify_password("wrong",   stored) is False
    starts_right   = stored.startswith("pbkdf2-sha256$100000$")
    elapsed = time.time() - t0
    if accept_correct and reject_wrong and starts_right:
        print(f"PASS ({elapsed:.1f}s)")
    else:
        all_pass = False
        print("FAIL")
        print(f"      stored:        {stored}")
        print(f"      accept right:  {accept_correct}")
        print(f"      reject wrong:  {reject_wrong}")
        print(f"      format prefix: {starts_right}")

    if not all_pass:
        sys.exit(1)

    # cross-check vs hashlib.pbkdf2_hmac (not the source of truth)
    import hashlib
    import os

    n_iter = 20
    cross_pass = 0

    print(f"  running cross-check ({n_iter} iterations vs hashlib.pbkdf2_hmac)... ", end='', flush=True)
    t0 = time.time()

    # Random params: password length [4, 20], salt length [8, 32], iterations
    # in {1000, 5000}, key_length in {16, 32, 48}. Each iteration is genuinely
    # slow because PBKDF2 has to actually run that many HMACs.
    iter_choices = [1000, 5000]
    keylen_choices = [16, 32, 48]

    for i in range(n_iter):
        password_len = 4 + (int.from_bytes(os.urandom(2), 'big') % 17)   # [4, 20]
        salt_len     = 8 + (int.from_bytes(os.urandom(2), 'big') % 25)   # [8, 32]
        iterations   = iter_choices[int.from_bytes(os.urandom(1), 'big') % 2]
        key_length   = keylen_choices[int.from_bytes(os.urandom(1), 'big') % 3]

        pw   = os.urandom(password_len)
        salt = os.urandom(salt_len)

        ours = pbkdf2(pw, salt, iterations, key_length)
        ref  = hashlib.pbkdf2_hmac('sha256', pw, salt, iterations, key_length)

        if ours == ref:
            cross_pass += 1
        else:
            print()
            print(f"FAIL  cross-check iteration {i + 1}")
            print(f"      password length: {password_len}")
            print(f"      salt length:     {salt_len}")
            print(f"      iterations:      {iterations}")
            print(f"      key_length:      {key_length}")
            print(f"      pw (hex):        {pw.hex()}")
            print(f"      salt (hex):      {salt.hex()}")
            print(f"      ours:            {ours.hex()}")
            print(f"      hashlib:         {ref.hex()}")
            sys.exit(1)

    elapsed = time.time() - t0
    print(f"\ncross-check vs hashlib.pbkdf2_hmac: {cross_pass}/{n_iter} PASS ({elapsed:.1f}s)")
