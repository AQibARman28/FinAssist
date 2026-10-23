# WARNING: NOT CONSTANT-TIME — double-and-add scalar multiplication and big-int arithmetic leak the nonce k / key d through timing; teaching code only, never use with real secrets (see legacy_crypto/README.md "Known limitations").
"""
ECDSA on the NIST P-256 curve (also called secp256r1 / prime256v1),
implemented from scratch using only Python int arithmetic.

This file is a direct port of Backend/utils/scratch/ecdsaP256.js — same
P-256 parameters, same affine point arithmetic, same DER-encoded
(r, s) signature wire format, same Miller-Rabin / OAEP / etc.-style
heavy-comment style.

The elliptic curve discrete log problem (ECDLP)
─────────────────────────────────────────────────────────────────────────────
Given a base point G on the curve and another point Q = k*G (where k is
a secret integer scalar), recovering k from G and Q is conjectured to be
computationally infeasible for 256-bit curves over a prime field. The
best classical attack — Pollard's rho — runs in O(sqrt(n)) where n is
the group order. For n ~ 2^256 that's 2^128 operations, comfortably out
of reach.

That's the security foundation of every ECDSA construction: anyone can
compute Q from k (one scalar multiplication), but no one can run the
inverse without knowing k.

Why ECDSA over RSA for signatures
─────────────────────────────────────────────────────────────────────────────
Smaller keys at equivalent security:

    RSA bits   ECC bits   security
    ────────   ────────   ────────
    1024       160        ~80 bits
    2048       224        ~112 bits
    3072       256        ~128 bits   <-- P-256, our choice
    7680       384        ~192 bits

P-256 (256-bit ECC) gives roughly the same security as 3072-bit RSA,
with ~64-byte signatures (vs ~256 bytes for RSA-2048) and ~10x faster
signing operations. The bytes-on-the-wire savings compound for any
system that signs many records.

The k-reuse catastrophe (Sony PS3 lesson)
─────────────────────────────────────────────────────────────────────────────
ECDSA's per-signature ephemeral scalar k is the single most important
secret. It must be unpredictable AND fresh for every signature. If two
signatures (r, s1) and (r, s2) under the same private key share the
same k, then both have the same r (since r = (k*G).x mod n is determined
by k alone), and the private key falls out:

    k = (z1 - z2) * (s1 - s2)^(-1) mod n
    d = (s1*k - z1) * r^(-1) mod n

— two short modular operations and a hash-difference. Sony famously
hardcoded k in the PS3's firmware-signing code in 2010, and the entire
console signing key was extracted by failOverflow within hours of
public disclosure. Multiple Bitcoin wallets have lost funds to the same
mistake when their signing libraries had buggy RNGs.

We take k from secrets.randbelow on every sign() call. Never seeded,
never reused, no "deterministic k" path even if it would be convenient.

Affine vs Jacobian coordinates
─────────────────────────────────────────────────────────────────────────────
Affine (x, y): the geometrically natural representation, where each
point on the curve has exactly two coordinates plus the point at
infinity. Every point addition / doubling needs one modular inverse
(via Fermat's little theorem with our hand-rolled mod_pow), which
dominates the cost.

Jacobian (X, Y, Z) where (x, y) = (X/Z^2, Y/Z^3): defers all the
inversions until a single batch step at the end, giving roughly 5x
speedup. Production libraries (cryptography, OpenSSL) use Jacobian or
extended-coordinate variants almost universally.

We use AFFINE for clarity at the cost of speed. The `point_double` and
`point_add` formulas read directly off the chord-and-tangent diagrams
you'd see in a textbook. For a correctness-focused academic project
this is the right tradeoff.

The invalid-curve attack
─────────────────────────────────────────────────────────────────────────────
If verify() doesn't check that the public point lies on P-256, an
attacker can substitute a "public key" lying on a different curve where
the discrete log problem is feasible (a curve with small subgroup
structure). They then compute the discrete log on the weak curve to
recover what looks like a valid private key for verification, and use
it to forge signatures.

Defense: every verify() call starts with point_is_on_curve(public_Q)
before any signature math runs. If Q isn't on P-256 we reject the
signature outright. Same defense applied to range checks on r and s
(both must be in [1, n-1]).

Signature malleability and the low-S rule
─────────────────────────────────────────────────────────────────────────────
(r, s) and (r, n - s) are both valid signatures for the same message and
key, so a third party can "re-sign" without the private key. sign()
always emits s <= n/2 and verify() rejects s > n/2 unless the caller
passes allow_high_s=True (needed only for signers that do not normalize,
e.g. OpenSSL and the RFC 6979 test vectors). The DER decoder is strict
for the same reason: one signature, one byte encoding.

Allowed dependencies
─────────────────────────────────────────────────────────────────────────────
  `sha256` from our local scratch SHA-256 — used to hash the message
    before signing/verifying.
  `secrets` — entropy source for the private scalar d and the
    ephemeral k. Python's stdlib equivalent of Node's crypto.randomBytes.

Math primitives (mod_pow, extended_gcd, mod_inverse) are inlined here
rather than imported from rsa.py so the file is independently runnable
and the dependency graph stays a tree, not a web.
"""

import secrets as _secrets

from sha256 import sha256


# ═════════════════════════════════════════════════════════════════════════════
#  PART A — Curve constants and field arithmetic
# ═════════════════════════════════════════════════════════════════════════════

# NIST P-256 parameters from FIPS 186-4 Appendix D.1.2.3.
#
#   p   field prime, equal to 2^256 - 2^224 + 2^192 + 2^96 - 1
#   a   curve coefficient, equal to -3 mod p
#   b   curve coefficient, a fixed verifiably-random NIST constant
#   Gx  x-coordinate of the standard base point
#   Gy  y-coordinate of the standard base point
#   n   order of G (the smallest positive integer such that n*G = infinity)
#   h   cofactor; equals 1 for P-256 (the curve group has prime order, so
#       no small-subgroup confusion).
p  = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff
a  = 0xffffffff00000001000000000000000000000000fffffffffffffffffffffffc  # = -3 mod p
b  = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b
Gx = 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296
Gy = 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5
n  = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551
h  = 1

# The standard base point as a tuple (x, y).
G = (Gx, Gy)

# HALF_N = n // 2. The "low-S" rule (BIP-62 / BIP-146 style, also what
# libsecp256k1 enforces) says a canonical signature has s <= n/2.
#
# Why it exists: if (r, s) is a valid ECDSA signature then so is
# (r, n - s) -- negating k flips the sign of s but gives a point with the
# same x, so the same r. Without a canonical form, anyone can turn one
# valid signature into a second, byte-different valid signature without
# the private key ("signature malleability"). That breaks any system that
# uses signature bytes as an identifier or replay-protection key. We
# normalize on sign and, by default, reject s > n/2 on verify.
#
# Because n is odd, "s > n/2" is exactly "s > HALF_N".
HALF_N = n >> 1


# ─────────────────────────────────────────────────────────────────────────────
# Hand-rolled mod_pow + mod_inverse (Python's pow(a, b, m) builtin is forbidden
# by the from-scratch rule).
# ─────────────────────────────────────────────────────────────────────────────

def mod_pow(base, exp, modulus):
    """Modular exponentiation via square-and-multiply. base^exp mod modulus.

    Identical algorithm to rsa.py's mod_pow — duplicated here rather than
    imported so this file is a self-contained unit. Python's builtin
    pow(a, b, m) does the same thing in C and is dramatically faster, but
    the from-scratch rule rules it out.
    """
    if modulus == 1:
        return 0
    if exp < 0:
        raise ValueError("mod_pow: exponent must be non-negative")
    result = 1
    b_ = base % modulus
    if b_ < 0:
        b_ += modulus
    e = exp
    while e > 0:
        if e & 1:
            result = (result * b_) % modulus
        e >>= 1
        b_ = (b_ * b_) % modulus
    return result


def extended_gcd(x, y):
    """Returns (g, s) such that x*s = g (mod y), where g = gcd(x, y).

    Iterative version, returning only the (g, s) pair we actually need
    for mod_inverse — the full Bezout (g, s, t) triple is unused here.
    """
    old_r, r = x, y
    old_s, s = 1, 0
    while r != 0:
        q = old_r // r
        old_r, r = r, old_r - q * r
        old_s, s = s, old_s - q * s
    return old_r, old_s


def mod_inverse(value, modulus):
    """Modular inverse: returns x such that (value * x) mod modulus == 1.

    Raises ValueError if gcd(value, modulus) != 1.
    """
    g, x = extended_gcd(value % modulus, modulus)
    if g != 1:
        raise ValueError(f"mod_inverse: no inverse exists (gcd = {g})")
    return x % modulus


# ─────────────────────────────────────────────────────────────────────────────
# Field arithmetic in GF(p)
# ─────────────────────────────────────────────────────────────────────────────

def f_add(x, y):
    """Field addition mod p."""
    return (x + y) % p


def f_sub(x, y):
    """Field subtraction mod p. Python's % always returns non-negative for
    positive p, so no extra normalization is needed."""
    return (x - y) % p


def f_mul(x, y):
    """Field multiplication mod p."""
    return (x * y) % p


def f_square(x):
    """Field squaring mod p — sugar for f_mul(x, x), kept distinct because
    the curve formulas have many x^2 terms and f_square reads more
    clearly than f_mul(x, x)."""
    return (x * x) % p


def f_inverse(x):
    """Multiplicative inverse in GF(p) via Fermat's little theorem:
    x^(p-2) mod p. Costs one mod_pow with a 256-bit exponent.

    Raises ValueError if x == 0 (no inverse).
    """
    if x % p == 0:
        raise ValueError("f_inverse: zero has no inverse in GF(p)")
    return mod_pow(x, p - 2, p)


# ═════════════════════════════════════════════════════════════════════════════
#  PART B — Point arithmetic in affine coordinates
# ═════════════════════════════════════════════════════════════════════════════

# A point is either:
#   - the JavaScript value `null` (in JS) / `None` (in Python) — the
#     point at infinity, which is the identity element of the group
#   - a tuple (x, y) of two ints in [0, p)
#
# We never represent points as dicts or as objects — tuples are immutable
# and equality-comparable out of the box, which the JS file gets via
# === on plain objects.

def point_is_on_curve(P):
    """Return True if P is None (point at infinity, by convention) OR
    if P is a tuple (x, y) satisfying y^2 == x^3 + a*x + b (mod p) with
    both coordinates in [0, p).

    Used by verify() to validate untrusted public keys before any
    signature math runs — the invalid-curve-attack defense.
    """
    if P is None:
        return True                      # convention: infinity is on every curve
    if not isinstance(P, tuple) or len(P) != 2:
        return False
    x, y = P
    if not isinstance(x, int) or not isinstance(y, int):
        return False
    if not (0 <= x < p) or not (0 <= y < p):
        return False
    lhs = f_square(y)
    rhs = f_add(f_add(f_mul(f_square(x), x), f_mul(a, x)), b)
    return lhs == rhs


def point_double(P):
    """Compute 2*P using the elliptic-curve tangent-line rule:

      slope = (3*x^2 + a) / (2*y)   mod p
      xR    = slope^2 - 2*x         mod p
      yR    = slope * (x - xR) - y  mod p

    If y == 0 the tangent is vertical and 2*P = infinity.
    Doubling the point at infinity returns the point at infinity.
    """
    if P is None:
        return None
    x, y = P
    if y == 0:
        return None                      # vertical tangent → infinity

    slope = f_mul(
        f_add(f_mul(3, f_square(x)), a),
        f_inverse(f_mul(2, y))
    )
    xR = f_sub(f_square(slope), f_mul(2, x))
    yR = f_sub(f_mul(slope, f_sub(x, xR)), y)
    return (xR, yR)


def point_add(P, Q):
    """Compute P + Q using the elliptic-curve chord-line rule.

    Cases:
      - If either operand is infinity, return the other one (infinity is
        the group identity).
      - If P and Q have the same x but different y, they are inverses
        (P + (-P) = infinity), return None.
      - If P == Q, delegate to point_double (the chord becomes a tangent).
      - Otherwise:
          slope = (Qy - Py) / (Qx - Px)  mod p
          xR    = slope^2 - Px - Qx      mod p
          yR    = slope * (Px - xR) - Py mod p
    """
    if P is None: return Q
    if Q is None: return P

    if P[0] == Q[0]:
        if P[1] == Q[1]:
            return point_double(P)
        return None                      # P + (-P) = infinity

    slope = f_mul(
        f_sub(Q[1], P[1]),
        f_inverse(f_sub(Q[0], P[0]))
    )
    xR = f_sub(f_sub(f_square(slope), P[0]), Q[0])
    yR = f_sub(f_mul(slope, f_sub(P[0], xR)), P[1])
    return (xR, yR)


def scalar_multiply(k, P):
    """Compute k*P via right-to-left double-and-add.

    Walk the bits of k from least-significant to most-significant. The
    `addend` variable tracks 2^i * P; whenever the i-th bit of k is set,
    we accumulate addend into the result.

    Returns None (point at infinity) if k == 0 or P is None.
    """
    if k < 0:
        raise ValueError("scalar_multiply: k must be non-negative")
    if k == 0 or P is None:
        return None

    result = None                        # start at infinity
    addend = P
    while k > 0:
        if k & 1:
            result = point_add(result, addend)
        addend = point_double(addend)
        k >>= 1
    return result


# ═════════════════════════════════════════════════════════════════════════════
#  PART C — ECDSA core (FIPS 186-4 §6.4)
# ═════════════════════════════════════════════════════════════════════════════

def generate_keypair():
    """Generate a fresh ECDSA P-256 keypair.

    Returns a flat dict with int values:
        {"d": <private scalar in [1, n-1]>,
         "x": <public point x coordinate>,
         "y": <public point y coordinate>}

    The flat shape (rather than nesting Q under a sub-dict) is a
    Python-only convenience; the JSON serialization that hits MongoDB
    is still flat {x, y} for public and {d} for private — see
    serialize_public_key / serialize_private_key.
    """
    # d in [1, n-1] inclusive: secrets.randbelow(n-1) gives [0, n-2], +1
    # shifts to [1, n-1].
    d = 1 + _secrets.randbelow(n - 1)
    Q = scalar_multiply(d, G)
    return {"d": d, "x": Q[0], "y": Q[1]}


def sign(message, private_d):
    """Compute the ECDSA signature (r, s) for message bytes under
    private scalar d.

    The loop retries on the (vanishingly rare) cases r == 0 or s == 0,
    which the FIPS 186-4 spec requires us to handle even though either
    occurs with probability ~2^-256.

    A FRESH RANDOM k is drawn for every signature. See the file header
    on the Sony PS3 incident for why k-reuse is catastrophic.

    Args:
        message:   bytes (or str — UTF-8 encoded internally).
        private_d: int in [1, n-1].

    Returns:
        tuple (r, s) of two ints, r in [1, n-1] and s in [1, n/2]. The
        returned s is always LOW-S (see HALF_N): if the computed s is in
        the upper half we return n - s, the other valid signature for r.
    """
    if not isinstance(private_d, int):
        raise TypeError("sign: private_d must be int")
    if private_d < 1 or private_d >= n:
        raise ValueError("sign: private_d out of range [1, n-1]")
    if isinstance(message, str):
        message = message.encode('utf-8')
    if not isinstance(message, (bytes, bytearray)):
        raise TypeError("sign: message must be bytes, bytearray, or str")
    message = bytes(message)

    # z = leftmost 256 bits of SHA-256 hash, reduced mod n. For
    # SHA-256 + P-256 the hash output (256 bits) is exactly the same
    # length as n, so we just take the integer mod n.
    z = int.from_bytes(sha256(message), 'big') % n

    while True:
        # k in [1, n-1]
        k = 1 + _secrets.randbelow(n - 1)
        kG = scalar_multiply(k, G)
        if kG is None:
            continue                                 # astronomically unlikely
        r = kG[0] % n
        if r == 0:
            continue
        k_inv = mod_inverse(k, n)
        s_val = (k_inv * (z + r * private_d)) % n
        if s_val == 0:
            continue
        # Low-S normalization: (r, s) and (r, n - s) both verify; emit the
        # canonical one.
        if s_val > HALF_N:
            s_val = n - s_val
        return (r, s_val)


def verify(message, signature, public_Q, allow_high_s=False):
    """Verify an ECDSA signature (r, s) on message bytes under public point Q.

    Returns boolean. Performs all the standard mandatory checks:
      - r and s are integers in [1, n-1]
      - s <= n/2 (low-S rule; see HALF_N) unless allow_high_s is True
      - public_Q is well-formed, has coordinates in [0, p), and lies on
        the P-256 curve
      - public_Q is not the point at infinity
    BEFORE doing any signature math. This is the invalid-curve-attack
    defense referenced in the file header.

    Args:
        message:   bytes (or str — UTF-8 encoded internally).
        signature: tuple (r, s) of two ints.
        public_Q:  tuple (x, y) of two ints, OR None.
        allow_high_s: accept s > n/2. Only for checking signatures from
                   signers that do not normalize S (OpenSSL /
                   `cryptography`, the RFC 6979 test vectors). Leave it
                   off anywhere signature bytes must be unique.

    Returns:
        bool.
    """
    # Argument shape — fail closed on any malformed input.
    if not isinstance(signature, tuple) or len(signature) != 2:
        return False
    r, s = signature
    if not isinstance(r, int) or not isinstance(s, int):
        return False

    # Range checks: r, s in [1, n-1]
    if r < 1 or r >= n: return False
    if s < 1 or s >= n: return False

    # Low-S rule: reject the malleable upper-half twin unless the caller
    # explicitly opted in.
    if s > HALF_N and allow_high_s is not True:
        return False

    # Public key validity
    if public_Q is None: return False
    if not point_is_on_curve(public_Q): return False
    # P-256 has cofactor 1, so any non-infinity on-curve point is in the
    # prime-order subgroup automatically.

    if isinstance(message, str):
        message = message.encode('utf-8')
    if not isinstance(message, (bytes, bytearray)):
        return False

    z  = int.from_bytes(sha256(bytes(message)), 'big') % n
    w  = mod_inverse(s, n)
    u1 = (z * w) % n
    u2 = (r * w) % n

    point = point_add(scalar_multiply(u1, G), scalar_multiply(u2, public_Q))
    if point is None:
        return False

    return (point[0] % n) == r


# ═════════════════════════════════════════════════════════════════════════════
#  PART D — DER encoding (matching the JS file's wire format exactly)
# ═════════════════════════════════════════════════════════════════════════════
#
# ECDSA signatures are wire-encoded as ASN.1 DER per RFC 5480 / X9.62:
#
#     SEQUENCE {
#         INTEGER r
#         INTEGER s
#     }
#
# In DER:
#   - SEQUENCE is tag 0x30
#   - INTEGER  is tag 0x02
#   - Each value is preceded by a length byte (short-form, < 128, since
#     r and s are at most 33 bytes each → max inner length ~70 bytes)
#   - INTEGER values are minimum-length two's-complement, big-endian:
#       * Strip leading zero bytes,
#       * BUT if the high bit of the resulting first byte is set, prepend
#         one 0x00 byte to keep the value unambiguously non-negative.

def _encode_der_integer(value):
    """Encode a non-negative int as a DER INTEGER (tag + length + value)."""
    if value < 0:
        raise ValueError("_encode_der_integer: value must be non-negative")

    # Convert to minimum-length big-endian bytes.
    if value == 0:
        body = b'\x00'
    else:
        byte_len = (value.bit_length() + 7) // 8
        body = value.to_bytes(byte_len, 'big')

    # If the high bit of the first byte is set, prepend 0x00 so DER
    # interprets the value as non-negative.
    if body[0] & 0x80:
        body = b'\x00' + body

    return bytes([0x02, len(body)]) + body


def _decode_der_integer(buf, offset):
    """Read a DER INTEGER starting at `offset`.

    Returns (value, total_bytes_consumed).

    STRICT: DER has exactly one valid encoding per value, and we accept
    only that one. Anything else is a different byte string for the
    "same" signature (malleability) or a parser-differential hazard, so
    we raise ValueError on:
      - a long-form length byte (0x8X). Every length in a P-256 signature
        is < 128, and DER requires short form for those, so long form is
        always non-minimal here;
      - a zero-length INTEGER;
      - a length that runs past the end of the buffer (= the SEQUENCE);
      - a negative INTEGER (first content byte has its high bit set);
      - a non-minimal INTEGER (leading 0x00 that is not needed to keep
        the next byte's high bit clear).
    """
    if offset + 2 > len(buf):
        raise ValueError("DER: truncated INTEGER")
    if buf[offset] != 0x02:
        raise ValueError("DER: expected INTEGER tag (0x02)")
    length = buf[offset + 1]
    if length & 0x80:
        raise ValueError("DER: long-form length is non-minimal here")
    if length == 0:
        raise ValueError("DER: zero-length INTEGER")
    if offset + 2 + length > len(buf):
        raise ValueError("DER: INTEGER length exceeds buffer")
    value_bytes = buf[offset + 2 : offset + 2 + length]
    if value_bytes[0] & 0x80:
        raise ValueError("DER: negative INTEGER")
    if length > 1 and value_bytes[0] == 0x00 and (value_bytes[1] & 0x80) == 0:
        raise ValueError("DER: non-minimal INTEGER encoding")
    value = int.from_bytes(value_bytes, 'big')
    return value, 2 + length


def der_encode_signature(r, s):
    """Encode an ECDSA signature as ASN.1 DER:
        SEQUENCE { INTEGER r, INTEGER s }
    """
    r_der = _encode_der_integer(r)
    s_der = _encode_der_integer(s)
    inner = r_der + s_der

    if len(inner) >= 0x80:
        # For P-256 this can't happen (max inner ~70 bytes).
        raise ValueError("DER: inner length exceeds short-form limit")

    return bytes([0x30, len(inner)]) + inner


def der_decode_signature(sig_bytes):
    """Decode an ASN.1 DER ECDSA signature into (r, s).

    Strict DER only (see _decode_der_integer): SEQUENCE tag, short-form
    length that matches the total bytes exactly, exactly two minimal
    non-negative INTEGERs, no trailing bytes after s.
    """
    if not isinstance(sig_bytes, (bytes, bytearray)):
        raise TypeError("der_decode_signature: input must be bytes or bytearray")
    sig_bytes = bytes(sig_bytes)

    if len(sig_bytes) < 8:
        raise ValueError("DER: signature too short")
    if sig_bytes[0] != 0x30:
        raise ValueError("DER: expected SEQUENCE tag (0x30)")
    seq_len = sig_bytes[1]
    if seq_len & 0x80:
        raise ValueError("DER: long-form length is non-minimal here")
    if seq_len + 2 != len(sig_bytes):
        raise ValueError("DER: SEQUENCE length mismatch")

    i = 2
    r, consumed = _decode_der_integer(sig_bytes, i); i += consumed
    s, consumed = _decode_der_integer(sig_bytes, i); i += consumed

    if i != len(sig_bytes):
        raise ValueError("DER: trailing bytes after s")

    return r, s


# ═════════════════════════════════════════════════════════════════════════════
#  PART E — Public exports + serialization
# ═════════════════════════════════════════════════════════════════════════════

def sign_record(message_bytes, private_d):
    """High-level sign: produces DER-encoded signature bytes.

    Pipeline: sign() returns (r, s) ints, then der_encode_signature
    wraps them in SEQUENCE { INTEGER r, INTEGER s }.
    """
    r, s = sign(message_bytes, private_d)
    return der_encode_signature(r, s)


def verify_record(message_bytes, signature_bytes, public_Q, allow_high_s=False):
    """High-level verify: takes DER-encoded signature bytes.

    Returns False on any DER parse failure (rather than raising), since
    a malformed signature is just an invalid signature from the API
    contract's point of view. `allow_high_s` is passed through to verify().
    """
    try:
        r, s = der_decode_signature(signature_bytes)
    except (ValueError, TypeError):
        return False
    return verify(message_bytes, (r, s), public_Q, allow_high_s=allow_high_s)


# ─────────────────────────────────────────────────────────────────────────────
# Serialization (matching the JS keyManagement.js wire format exactly)
# ─────────────────────────────────────────────────────────────────────────────

def _to_hex(value):
    """Encode a non-negative int as an even-length lowercase hex string,
    no '0x' prefix. Even length matches the invariant that bytes.fromhex
    requires."""
    if value < 0:
        raise ValueError("_to_hex: value must be non-negative")
    h = format(value, 'x')
    if len(h) % 2 == 1:
        h = '0' + h
    return h


def _from_hex(s):
    """Decode a hex string (with or without '0x' prefix) into an int.
    Empty string decodes to 0."""
    if not isinstance(s, str):
        raise TypeError("_from_hex: input must be a string")
    if s.startswith('0x') or s.startswith('0X'):
        s = s[2:]
    if len(s) == 0:
        return 0
    return int(s, 16)


def serialize_public_key(keypair):
    """Convert a flat keypair dict to the JSON public-key shape.

    Output: {"x": "<hex>", "y": "<hex>"}.
    """
    return {"x": _to_hex(keypair["x"]), "y": _to_hex(keypair["y"])}


def serialize_private_key(keypair):
    """Convert a flat keypair dict to the JSON private-key shape.

    Output: {"d": "<hex>"} — the private scalar only. The public
    coordinates can be recovered as Q = d * G if needed; storing them
    redundantly would just be wasted bytes.
    """
    return {"d": _to_hex(keypair["d"])}


def _coerce_field(value):
    """int → int (passthrough), str → int (hex-decode). Mirrors the
    polymorphic normalizeKey helper in the JS keyManagement.js layer."""
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        return _from_hex(value)
    raise TypeError("field must be int or hex string")


def parse_public_key(obj):
    """Inverse of serialize_public_key: hex-string dict → int dict."""
    return {"x": _coerce_field(obj["x"]), "y": _coerce_field(obj["y"])}


def parse_private_key(obj):
    """Inverse of serialize_private_key: hex-string dict → int dict."""
    return {"d": _coerce_field(obj["d"])}


# ─────────────────────────────────────────────────────────────────────────────
# Self-test — runs only when this file is executed directly:
#   python ecdsa_p256.py
# ─────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys

    all_pass = True

    def record(name, ok, detail=""):
        global all_pass
        if not ok:
            all_pass = False
        print(f"{'PASS' if ok else 'FAIL'}  {name}")
        if not ok and detail:
            print(f"        {detail}")

    # ── Test 1: base point on curve, off-curve rejection, infinity ──────
    g_on    = point_is_on_curve((Gx, Gy))
    bad_off = not point_is_on_curve((1, 1))
    inf_on  = point_is_on_curve(None)
    record(
        "Test 1: G on curve, (1,1) off curve, infinity on curve by convention",
        g_on and bad_off and inf_on,
        f"G_on={g_on} bad_off={bad_off} inf_on={inf_on}",
    )

    # ── Test 2: n*G is the point at infinity ────────────────────────────
    # The deepest single check — exercises every branch of point_double
    # and point_add across all 256 bits of the group order.
    nG = scalar_multiply(n, G)
    record("Test 2: n*G is the point at infinity", nG is None)

    # ── Test 3: doubling and same-point addition agree ──────────────────
    G2_double = point_double(G)
    G2_add    = point_add(G, G)
    record(
        "Test 3: point_double(G) equals point_add(G, G)",
        G2_double == G2_add and point_is_on_curve(G2_double),
    )

    # ── Test 4: sign + verify round-trip with random keypair + messages ─
    keypair = generate_keypair()
    private = keypair["d"]
    public  = (keypair["x"], keypair["y"])

    test4_ok = True
    for i in range(5):
        msg = _secrets.token_bytes(64)
        sig = sign_record(msg, private)
        if not verify_record(msg, sig, public):
            test4_ok = False
            print(f"        round-trip iteration {i + 1} failed")
    record("Test 4: sign + verify round-trip (5 random 64-byte messages)", test4_ok)

    # ── Test 5: wrong message rejected ──────────────────────────────────
    sig = sign_record(b"original", private)
    record(
        "Test 5: wrong message rejected (different msg, same sig + key)",
        verify_record(b"tampered", sig, public) is False,
    )

    # ── Test 6: wrong public key rejected ───────────────────────────────
    other = generate_keypair()
    sig = sign_record(b"hello", private)
    record(
        "Test 6: wrong public key rejected (sig from key A, verify with key B)",
        verify_record(b"hello", sig, (other["x"], other["y"])) is False,
    )

    # ── Test 7: tampered signature rejected ─────────────────────────────
    sig = sign_record(b"hello", private)
    tampered = bytearray(sig)
    tampered[10] ^= 0x01
    record(
        "Test 7: tampered signature rejected (1-bit flip at offset 10)",
        verify_record(b"hello", bytes(tampered), public) is False,
    )

    # ── Test 8: DER encode/decode round-trip ────────────────────────────
    sig = sign_record(b"data", private)
    r_dec, s_dec = der_decode_signature(sig)
    reencoded = der_encode_signature(r_dec, s_dec)
    record(
        "Test 8: DER decode -> re-encode produces byte-identical bytes",
        reencoded == sig,
        f"original={sig.hex()} reencoded={reencoded.hex()}",
    )

    # ── Test 9: JSON serialization round-trip + field shape ─────────────
    serialized_priv = serialize_private_key(keypair)
    serialized_pub  = serialize_public_key(keypair)
    restored_priv   = parse_private_key(serialized_priv)
    restored_pub    = parse_public_key(serialized_pub)

    # Sign with restored private, verify with restored public
    sig = sign_record(b"check", restored_priv["d"])
    rt_ok = verify_record(b"check", sig, (restored_pub["x"], restored_pub["y"]))

    # Field shape: {"d"} for private, {"x", "y"} for public
    priv_keys_ok = set(serialized_priv.keys()) == {"d"}
    pub_keys_ok  = set(serialized_pub.keys())  == {"x", "y"}
    all_hex = (
        all(isinstance(v, str) and len(v) % 2 == 0 for v in serialized_priv.values()) and
        all(isinstance(v, str) and len(v) % 2 == 0 for v in serialized_pub.values())
    )

    record(
        'Test 9: serialize -> parse -> sign+verify + field shape {"d"} / {"x","y"} hex',
        rt_ok and priv_keys_ok and pub_keys_ok and all_hex,
        f"rt_ok={rt_ok} priv_keys={priv_keys_ok} pub_keys={pub_keys_ok} all_hex={all_hex}",
    )

    # ── RFC 6979 Appendix A.2.5 known-answer vectors (P-256 + SHA-256) ──
    # Source: https://www.rfc-editor.org/rfc/rfc6979.txt — Appendix A.2.5
    # "ECDSA, 256 Bits (Prime Field)": private key x, public key U = xG,
    # and the "With SHA-256" signatures for messages "sample" and "test".
    # RFC 6979 derives k deterministically; this lab signs with a random
    # k, so these are used as VERIFY vectors plus a key-derivation check.
    RFC6979_X  = 0xC9AFA9D845BA75166B5C215767B1D6934E50C3DB36E89B127B8A622B120F6721
    RFC6979_UX = 0x60FED4BA255A9D31C961EB74C6356D68C049B8923B61FA6CE669622E60F29FB6
    RFC6979_UY = 0x7903FE1008B8BC99A41AE9E95628BC64F2F1B20C2D7E9F5177A3C294D4462299
    # SHA-256, message = "sample" (note: s > n/2, i.e. a HIGH-S signature)
    RFC6979_SAMPLE = (0xEFD48B2AACB6A8FD1140DD9CD45E81D69D2C877B56AAF991C34D0EA84EAF3716,
                      0xF7CB1C942D657C41D436C7A1B6E29F65F3E900DBB9AFF4064DC4AB2F843ACDA8)
    # SHA-256, message = "test" (s < n/2, already low-S)
    RFC6979_TEST   = (0xF1ABB023518351CD71D881567B1EA663ED3EFCF6C5132B354F28D3B0B7D38367,
                      0x019F4113742A2B14BD25926B49C649155F267E60D3814B4C0CC84250E46F0083)
    rfc_U  = (RFC6979_UX, RFC6979_UY)
    half_n = n >> 1          # n is odd, so "s > n/2" <=> "s > n // 2"

    def run(name, fn):
        """Run one test body; an exception counts as FAIL (with the reason)."""
        try:
            ok, detail = fn()
        except Exception as exc:                     # noqa: BLE001
            ok, detail = False, f"raised {type(exc).__name__}: {exc}"
        record(name, ok, detail)

    # ── Test 10: RFC 6979 public-key derivation x*G == U ───────────────
    def t10():
        derived = scalar_multiply(RFC6979_X, G)
        return derived == rfc_U and point_is_on_curve(rfc_U), f"derived={derived}"
    run("Test 10: RFC 6979 A.2.5 public key derivation x*G == (Ux, Uy)", t10)

    # ── Test 11: RFC 6979 "test" signature verifies (raw and DER) ───────
    def t11():
        low_s      = RFC6979_TEST[1] <= half_n
        accept     = verify(b"test", RFC6979_TEST, rfc_U)
        accept_der = verify_record(b"test", der_encode_signature(*RFC6979_TEST), rfc_U)
        reject_msg = not verify(b"sample", RFC6979_TEST, rfc_U)
        return (low_s and accept and accept_der and reject_msg,
                f"low_s={low_s} accept={accept} accept_der={accept_der} reject_msg={reject_msg}")
    run('Test 11: RFC 6979 A.2.5 SHA-256 "test" signature verifies (raw + DER), wrong msg rejected', t11)

    # ── Test 12: RFC 6979 "sample" signature is high-S -> low-S policy ──
    def t12():
        r_, s_ = RFC6979_SAMPLE
        high_s       = s_ > half_n
        valid_math   = verify(b"sample", RFC6979_SAMPLE, rfc_U, allow_high_s=True)
        rejected     = not verify(b"sample", RFC6979_SAMPLE, rfc_U)
        rejected_der = not verify_record(b"sample", der_encode_signature(r_, s_), rfc_U)
        low_twin_ok  = verify(b"sample", (r_, n - s_), rfc_U)
        return (high_s and valid_math and rejected and rejected_der and low_twin_ok,
                f"high_s={high_s} valid_math={valid_math} rejected={rejected} "
                f"rejected_der={rejected_der} low_twin={low_twin_ok}")
    run('Test 12: RFC 6979 "sample" sig (high-S): valid with allow_high_s, rejected by default, (r, n-s) accepted', t12)

    # ── Test 13: sign() always emits low-S; the high-S twin is rejected ─
    def t13():
        all_low = all_verify = twin_rejected = True
        for i in range(16):
            m = f"low-s {i}".encode()
            r_, s_ = sign(m, private)
            all_low       &= s_ <= half_n
            all_verify    &= verify(m, (r_, s_), public)
            twin_rejected &= not verify(m, (r_, n - s_), public)
        return (all_low and all_verify and twin_rejected,
                f"all_low={all_low} all_verify={all_verify} twin_rejected={twin_rejected}")
    run("Test 13: 16 fresh signatures are all low-S and verify; each high-S twin (r, n-s) rejected", t13)

    # ── Test 14: strict DER — reject non-canonical encodings ────────────
    def t14():
        r_, s_ = RFC6979_TEST                      # r has high bit set, s does not
        r_raw = r_.to_bytes(32, 'big')             # first byte 0xF1
        s_raw = s_.to_bytes(32, 'big')             # first byte 0x01
        def der_int(body): return bytes([0x02, len(body)]) + body
        def der_seq(inner): return bytes([0x30, len(inner)]) + inner
        r_min = der_int(b'\x00' + r_raw)           # canonical r: 0x00 pad needed
        s_min = der_int(s_raw)                     # canonical s: no pad needed
        canonical = der_seq(r_min + s_min)
        canonical_ok = (canonical == der_encode_signature(r_, s_) and
                        verify_record(b"test", canonical, rfc_U))
        inner = r_min + s_min
        bad = {
            "non-minimal INTEGER (extra leading 0x00 on s)": der_seq(r_min + der_int(b'\x00' + s_raw)),
            "negative INTEGER (r high bit set, no 0x00 pad)": der_seq(der_int(r_raw) + s_min),
            "non-minimal SEQUENCE length (long form 0x81)":   bytes([0x30, 0x81, len(inner)]) + inner,
            "non-minimal INTEGER length (long form 0x81)":    der_seq(bytes([0x02, 0x81, 0x21]) + b'\x00' + r_raw + s_min),
            "extra byte after SEQUENCE":                      canonical + b'\x00',
            "extra byte inside SEQUENCE after s":             der_seq(r_min + s_min + b'\x00'),
            "zero-length INTEGER":                            der_seq(bytes([0x02, 0x00]) + r_min + s_min),
            "INTEGER length overruns SEQUENCE":               der_seq(r_min + bytes([0x02, 0x40]) + s_raw),
        }
        failures = []
        for label, der in bad.items():
            try:
                der_decode_signature(der)
                raised = False
            except ValueError:
                raised = True
            verify_rejects = not verify_record(b"test", der, rfc_U)
            if not raised or not verify_rejects:
                failures.append(f"{label}: raised={raised} verify_rejects={verify_rejects}")
        return canonical_ok and not failures, f"canonical_ok={canonical_ok}; " + "; ".join(failures)
    run("Test 14: strict DER - canonical accepted, 8 non-canonical encodings rejected", t14)

    # ── Test 15: on-curve range check 0 <= x, y < p ─────────────────────
    def t15():
        # (x + p, y) satisfies the curve equation mod p but is not a
        # canonical field element; it must be rejected as a public key.
        shifted_x = (RFC6979_UX + p, RFC6979_UY)
        shifted_y = (RFC6979_UX, RFC6979_UY + p)
        rejects_x   = not point_is_on_curve(shifted_x) and not verify(b"test", RFC6979_TEST, shifted_x)
        rejects_y   = not point_is_on_curve(shifted_y) and not verify(b"test", RFC6979_TEST, shifted_y)
        rejects_neg = not point_is_on_curve((-1, RFC6979_UY))
        return (rejects_x and rejects_y and rejects_neg and point_is_on_curve(rfc_U),
                f"rejects_x={rejects_x} rejects_y={rejects_y} rejects_neg={rejects_neg}")
    run("Test 15: point_is_on_curve rejects (x+p, y), (x, y+p), negative coords; verify rejects them", t15)

    if not all_pass:
        sys.exit(1)

    # ── Cross-check vs cryptography (not the source of truth) ───────────
    n_iter = 5
    cross_pass = 0

    try:
        from cryptography.hazmat.primitives.asymmetric import ec
        from cryptography.hazmat.primitives import hashes

        # Reconstruct cryptography ECDSA key objects from our scratch d.
        ca_private = ec.derive_private_key(keypair["d"], ec.SECP256R1())
        ca_public  = ca_private.public_key()

        for i in range(n_iter):
            msg = _secrets.token_bytes(64)

            # Direction A: scratch sign -> cryptography verify
            scratch_sig = sign_record(msg, keypair["d"])
            try:
                ca_public.verify(scratch_sig, msg, ec.ECDSA(hashes.SHA256()))
            except Exception as e:
                print(f"FAIL  cross-check A iteration {i + 1}: cryptography rejected scratch sig - {e}")
                sys.exit(1)

            if der_decode_signature(scratch_sig)[1] > HALF_N:
                print(f"FAIL  cross-check A iteration {i + 1}: scratch emitted a high-S signature")
                sys.exit(1)

            # Direction B: cryptography sign -> scratch verify.
            # OpenSSL (behind `cryptography`) does NOT normalize S, so about
            # half of these are high-S: they must be rejected by default,
            # accepted with allow_high_s=True, and their (r, n - s) twin
            # must be accepted.
            ca_sig = ca_private.sign(msg, ec.ECDSA(hashes.SHA256()))
            pub = (keypair["x"], keypair["y"])
            ca_r, ca_s = der_decode_signature(ca_sig)
            if ca_s <= HALF_N:
                ok_b = verify_record(msg, ca_sig, pub)
            else:
                ok_b = (not verify_record(msg, ca_sig, pub)
                        and verify_record(msg, ca_sig, pub, allow_high_s=True)
                        and verify_record(msg, der_encode_signature(ca_r, n - ca_s), pub))
            if not ok_b:
                print(f"FAIL  cross-check B iteration {i + 1}: scratch mishandled cryptography sig (high_s={ca_s > HALF_N})")
                sys.exit(1)

            cross_pass += 1

        print(f"cross-check vs cryptography: {cross_pass}/{n_iter} PASS")

    except ImportError:
        # Fall back to scratch self-consistency
        for i in range(n_iter):
            msg = _secrets.token_bytes(64)
            sig = sign_record(msg, keypair["d"])
            if not verify_record(msg, sig, (keypair["x"], keypair["y"])):
                print(f"FAIL  self-consistency iteration {i + 1}")
                sys.exit(1)
            cross_pass += 1
        print(f"cross-check skipped (cryptography not installed) - using self-consistency {cross_pass}/{n_iter} PASS")
