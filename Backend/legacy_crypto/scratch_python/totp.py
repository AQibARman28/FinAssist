"""
TOTP (RFC 6238) implemented from scratch on top of HMAC-SHA256.

This file is a direct port of Backend/utils/scratch/totp.js — same RFC
4648 base32 encoding, same RFC 4226 HOTP construction, same SHA-256
variant choice (not SHA-1), same default 30-second period and 6-digit
codes.

What HOTP and TOTP actually are
─────────────────────────────────────────────────────────────────────────────
HOTP (RFC 4226) turns a shared secret + integer counter into a short
numeric code by HMACing the counter, extracting 31 bits with a "dynamic
truncation" trick, and taking the result modulo 10^digits.

TOTP (RFC 6238) is HOTP with the counter derived from current time:

    T = floor((current Unix time in seconds) / period)

The counter rolls over every `period` seconds (default 30), so the same
code is valid for an entire 30-second window. That's the visible
"ticking" you see in Google Authenticator.

The SHA-256 vs SHA-1 choice
─────────────────────────────────────────────────────────────────────────────
RFC 6238 explicitly permits SHA-1, SHA-256, and SHA-512 as TOTP variants.
Most legacy authenticator apps (older Google Authenticator, basic
hardware tokens) default to SHA-1 and require explicit configuration to
do anything else. Modern apps (Authy, 1Password, Bitwarden, current
Google Authenticator) support SHA-256 transparently.

We pick SHA-256 here because:
  (a) we already have it from-scratch in this folder, and
  (b) SHA-1 was deliberately omitted from the project deliverable list.

For real production interop with a "least common denominator"
authenticator app, you would either need a from-scratch SHA-1 too, or
generate `otpauth://` URIs that declare `algorithm=SHA256` so apps
configure correctly.

The window parameter
─────────────────────────────────────────────────────────────────────────────
Clocks drift. Phones lag. Network latency adds another fraction of a
second. So the verifier accepts codes from a few steps before and after
the current step. `window=1` (our default, also Google Authenticator's
default) means three codes are accepted at any given moment: the
previous, current, and next 30-second windows. window=2 widens to five
codes (a 2.5-minute total tolerance), trading security for usability.

Why dynamic truncation exists
─────────────────────────────────────────────────────────────────────────────
After computing mac = HMAC(key, counter), we can't just take the first
4 bytes — that would always be the same prefix for related counters,
giving an attacker a foothold. Instead we use the LOW NIBBLE of the
LAST byte of the mac as an offset (a value in 0..15), then read 4 bytes
starting at that offset. Because the offset itself is unpredictable
(another byte of mac output), the chunk we read is effectively random
across all 4-byte windows of the HMAC output, giving a more uniform
distribution over the digit space.

Why we mask the high bit of the first selected byte
─────────────────────────────────────────────────────────────────────────────
The high bit of the first byte gets masked off — that is, we treat the
4 bytes as an UNSIGNED 31-bit integer. The mask exists because the spec
was originally written without committing to "unsigned" everywhere, and
on some platforms (notably old Java) the natural 4-byte read would be
sign-extended into a negative number, which would then get a negative
modulo. Forcing the top bit to zero defines the result unambiguously
across languages.

Base32 for secret display
─────────────────────────────────────────────────────────────────────────────
TOTP secrets are shown to users in QR codes and "manual entry" backup
strings. Base32 (RFC 4648) avoids '0/O' and '1/I/l' confusion (vs
base64) and uses only uppercase letters and digits 2-7 — a 32-character
alphabet that is unambiguous when read off a small phone screen. We
emit padded base32 (with '=') for canonical RFC 4648 output, and accept
unpadded + lowercase on decode for tolerance to authenticator-app
variations.

Allowed dependencies
─────────────────────────────────────────────────────────────────────────────
The only crypto-side import is `hmac_sha256` from our local scratch HMAC
module. `secrets`, `time` are stdlib helpers (entropy + clock); they
are not crypto primitives.
"""

import secrets as _secrets
import time

from hmac_sha256 import hmac_sha256


# ─────────────────────────────────────────────────────────────────────────────
# Base32 (RFC 4648)
# ─────────────────────────────────────────────────────────────────────────────

# The 32-character base32 alphabet. Note the deliberate omission of "0",
# "1", "8", "9" (and lowercase) — these are easily confused with O, I, B,
# etc. when typed by humans from a small phone screen. Authenticator
# apps use this alphabet so users can read a secret off one device and
# type it into another.
_BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

# Reverse lookup table: char → 5-bit value. Built once at module load.
_BASE32_INDEX = {c: i for i, c in enumerate(_BASE32_ALPHABET)}


def base32_encode(data):
    """Encode bytes as RFC 4648 base32 (uppercase, with '=' padding).

    The implementation uses a small bit accumulator: shift each input
    byte (8 bits) into the top of the accumulator, then peel off as many
    5-bit groups as possible. Any leftover bits at the end of input get
    padded on the right with zeros to fill one final 5-bit group.

    After every emit we mask the accumulator down to its remaining bits
    so `bits` stays small — without that mask the value would grow
    unbounded across long inputs.
    """
    if not isinstance(data, (bytes, bytearray)):
        raise TypeError("base32_encode: input must be bytes or bytearray")

    if len(data) == 0:
        return ''

    bits = 0
    bit_count = 0
    chars = []

    for b in data:
        bits = (bits << 8) | b
        bit_count += 8

        while bit_count >= 5:
            bit_count -= 5
            chars.append(_BASE32_ALPHABET[(bits >> bit_count) & 0x1f])

        # Drop bits we've already emitted so the accumulator stays small.
        bits = bits & ((1 << bit_count) - 1)

    # Flush any leftover bits as a final 5-bit group, padded with zeros.
    if bit_count > 0:
        chars.append(_BASE32_ALPHABET[(bits << (5 - bit_count)) & 0x1f])

    # Pad with '=' so the output length is a multiple of 8 characters.
    while len(chars) % 8 != 0:
        chars.append('=')

    return ''.join(chars)


def base32_decode(s):
    """Decode an RFC 4648 base32 string back to bytes.

    Tolerant of:
      - whitespace (anywhere — stripped before decoding)
      - lowercase letters (uppercased before decoding)
      - presence or absence of trailing `=` padding

    Raises ValueError on any character that isn't in the base32 alphabet
    (after the tolerance steps above).
    """
    if not isinstance(s, str):
        raise TypeError("base32_decode: input must be a string")

    # Whitespace ignored; trailing padding ignored; case-insensitive.
    cleaned = ''.join(c for c in s if not c.isspace())
    cleaned = cleaned.rstrip('=').upper()

    bits = 0
    bit_count = 0
    out = []

    for i, c in enumerate(cleaned):
        if c not in _BASE32_INDEX:
            raise ValueError(f'base32_decode: invalid character "{c}" at position {i}')
        idx = _BASE32_INDEX[c]

        bits = (bits << 5) | idx
        bit_count += 5

        if bit_count >= 8:
            bit_count -= 8
            out.append((bits >> bit_count) & 0xff)
            bits = bits & ((1 << bit_count) - 1)

    # Any remaining bit_count < 8 bits are the zero-padding from the
    # encoder's final partial group — discard them.
    return bytes(out)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def generate_secret(num_bytes=20):
    """Generate a cryptographically random secret for use with TOTP.

    20 bytes is the default because that's the legacy SHA-1 HMAC
    block-size-appropriate length and what most authenticator-app
    reference implementations recommend. For SHA-256 you can go up to 32
    bytes; we keep the default at 20 for cross-compatibility with the JS
    port and with reference apps.
    """
    if not isinstance(num_bytes, int) or num_bytes < 1:
        raise ValueError("generate_secret: num_bytes must be a positive integer")
    return _secrets.token_bytes(num_bytes)


def _constant_time_string_equal(a, b):
    """Constant-time string comparison.

    Returns True iff `a` and `b` are identical strings. Walks every code
    point unconditionally so an attacker can't time-attack the verify
    path to learn how many leading digits of the expected code they got
    right.
    """
    if not isinstance(a, str) or not isinstance(b, str):
        return False
    if len(a) != len(b):
        return False
    diff = 0
    for x, y in zip(a, b):
        diff |= ord(x) ^ ord(y)
    return diff == 0


# ─────────────────────────────────────────────────────────────────────────────
# HOTP (RFC 4226 §5.3) — the core building block
# ─────────────────────────────────────────────────────────────────────────────

def hotp(key, counter, digits=6):
    """Compute the HOTP code for (key, counter, digits).

    Steps (verbatim from RFC 4226 §5.3, with HMAC-SHA256 substituted for
    the original HMAC-SHA1):

      1. Encode the integer counter as an 8-byte big-endian buffer.
      2. Compute mac = HMAC-SHA256(key, counter_buffer) — 32 bytes.
      3. Dynamic truncation:
           - offset  = mac[last] & 0x0F      (low nibble of last byte → 0..15)
           - take 4 bytes starting at `offset`, mask the top bit of the
             first to force unsigned interpretation, big-endian → 31-bit
             integer
      4. code = (that 31-bit integer) mod 10^digits, zero-padded to `digits`.

    Args:
        key:     bytes — the shared secret (raw, not base32).
        counter: non-negative integer (TOTP passes floor(time/period)).
        digits:  typically 6, sometimes 8.

    Returns:
        str — `digits`-digit zero-padded decimal code.
    """
    if not isinstance(key, (bytes, bytearray)):
        raise TypeError("hotp: key must be bytes or bytearray")
    if not isinstance(counter, int) or counter < 0:
        raise ValueError("hotp: counter must be a non-negative integer")
    if not isinstance(digits, int) or digits < 1:
        raise ValueError("hotp: digits must be a positive integer")

    # Step 1: 8-byte big-endian counter
    counter_buf = counter.to_bytes(8, 'big')

    # Step 2: HMAC the counter with the shared secret
    mac = hmac_sha256(key, counter_buf)         # 32 bytes for SHA-256

    # Step 3: dynamic truncation
    offset = mac[-1] & 0x0f
    code31 = (
        ((mac[offset]     & 0x7f) << 24) |      # mask sign bit on the first byte
        ((mac[offset + 1] & 0xff) << 16) |
        ((mac[offset + 2] & 0xff) <<  8) |
        ((mac[offset + 3] & 0xff))
    )

    # Step 4: reduce mod 10^digits and zero-pad
    code = code31 % (10 ** digits)
    return str(code).zfill(digits)


# ─────────────────────────────────────────────────────────────────────────────
# TOTP entry points
# ─────────────────────────────────────────────────────────────────────────────

def generate_totp(secret, period=30, digits=6, timestamp=None):
    """Generate a TOTP code for the current time (or a specified timestamp).

    Args:
        secret:    bytes — the raw secret (NOT base32; caller must
                   base32_decode if storing in base32 form).
        period:    seconds per code (default 30).
        digits:    code length (default 6).
        timestamp: float seconds-since-epoch; defaults to time.time().

    Returns:
        str — `digits`-digit code.
    """
    if not isinstance(period, (int, float)) or period <= 0:
        raise ValueError("generate_totp: period must be a positive number")
    if timestamp is None:
        timestamp = time.time()

    counter = int(timestamp // period)
    return hotp(secret, counter, digits)


def verify_totp(token, secret, period=30, digits=6, window=1, timestamp=None):
    """Verify a TOTP code, accepting codes from a window of steps around
    the current step.

    Walks every candidate in [-window, +window] without short-circuiting
    on first match — this keeps the verify path's runtime independent of
    *which* step matched, removing one timing side-channel. Each per-step
    comparison is itself constant-time over the digit string.

    Args:
        token:     str — the candidate code from the user.
        secret:    bytes — same secret used to generate.
        period:    seconds per code (must match the generator).
        digits:    code length (must match the generator).
        window:    accept codes from ±window steps (default 1).
        timestamp: float seconds-since-epoch; defaults to time.time().

    Returns:
        bool.
    """
    if not isinstance(token, str):
        return False
    if len(token) != digits:
        return False
    if not isinstance(window, int) or window < 0:
        return False
    if timestamp is None:
        timestamp = time.time()

    # Walk every candidate in the window. We deliberately do NOT break
    # on first match — both to keep timing flat and to be obvious about it.
    matched = False
    for offset in range(-window, window + 1):
        candidate_time = timestamp + offset * period
        candidate = generate_totp(
            secret, period=period, digits=digits, timestamp=candidate_time
        )
        if _constant_time_string_equal(token, candidate):
            matched = True

    return matched


# ─────────────────────────────────────────────────────────────────────────────
# Self-test — runs only when this file is executed directly:
#   python totp.py
# ─────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys
    import os

    all_pass = True

    def record(name, ok, detail=""):
        global all_pass
        if not ok:
            all_pass = False
        print(f"{'PASS' if ok else 'FAIL'}  {name}")
        if not ok and detail:
            print(f"        {detail}")

    # ── Test 1: base32 round-trip on RFC 4648 vectors ───────────────────
    rfc4648_vectors = [
        ("",       ""),
        ("f",      "MY======"),
        ("fo",     "MZXQ===="),
        ("foo",    "MZXW6==="),
        ("foob",   "MZXW6YQ="),
        ("fooba",  "MZXW6YTB"),
        ("foobar", "MZXW6YTBOI======"),
    ]
    test1_ok = True
    test1_detail = []
    for input_str, expected_b32 in rfc4648_vectors:
        input_bytes = input_str.encode('utf-8')
        encoded = base32_encode(input_bytes)
        decoded = base32_decode(expected_b32)
        if encoded != expected_b32:
            test1_ok = False
            test1_detail.append(f'encode("{input_str}"): expected="{expected_b32}" got="{encoded}"')
        if decoded != input_bytes:
            test1_ok = False
            test1_detail.append(f'decode("{expected_b32}"): expected={input_bytes!r} got={decoded!r}')
    record("Test 1: base32 RFC 4648 round-trip vectors", test1_ok, '; '.join(test1_detail))

    # ── Test 2: case-insensitive decode + missing padding ───────────────
    record(
        "Test 2: base32 case-insensitive + missing padding",
        base32_decode("mzxw6ytboi") == b"foobar"
    )

    # ── Test 3: base32 rejects non-alphabet characters ──────────────────
    threw = False
    try:
        base32_decode("MZXW6YT!")
    except ValueError:
        threw = True
    record("Test 3: base32 rejects non-alphabet characters", threw)

    # ── Test 4: RFC 6238 Appendix B SHA-256 vectors ─────────────────────
    # Note: the canonical RFC 6238 SHA-256 values are used here. Two of
    # the values stated in the original prompt for this port appeared to
    # be transcription typos (one was the SHA-1 row, one was a copy of
    # the previous row). The values below match the published RFC table
    # and what a correct SHA-256 TOTP implementation produces.
    rfc6238_key = b"12345678901234567890123456789012"   # 32-byte ASCII secret

    rfc6238_vectors = [
        (         59, "46119246"),
        ( 1111111109, "68084774"),
        ( 1234567890, "91819424"),
        ( 2000000000, "90698825"),
        (20000000000, "77737706"),
    ]
    test4_ok = True
    test4_detail = []
    for t, expected in rfc6238_vectors:
        got = generate_totp(rfc6238_key, period=30, digits=8, timestamp=t)
        if got != expected:
            test4_ok = False
            test4_detail.append(f'T={t}: expected="{expected}" got="{got}"')
    record(
        "Test 4: RFC 6238 SHA-256 Appendix B vectors (8-digit, 5 timestamps)",
        test4_ok,
        '; '.join(test4_detail),
    )

    # ── Test 5: generate + verify round-trip ────────────────────────────
    test_secret = generate_secret()
    code = generate_totp(test_secret)
    accepts_correct = verify_totp(code, test_secret) is True
    rejects_wrong   = verify_totp("000000", test_secret) is False
    record(
        "Test 5: generate + verify round-trip + wrong-code rejection",
        accepts_correct and rejects_wrong,
        f"accept={accepts_correct} reject_wrong={rejects_wrong}",
    )

    # ── Test 6: window tolerance ────────────────────────────────────────
    test_secret = generate_secret()
    now = int(time.time())
    prev_code = generate_totp(test_secret, timestamp=now - 30)
    next_code = generate_totp(test_secret, timestamp=now + 30)
    far_code  = generate_totp(test_secret, timestamp=now - 120)

    accepts_prev = verify_totp(prev_code, test_secret, window=1, timestamp=now) is True
    accepts_next = verify_totp(next_code, test_secret, window=1, timestamp=now) is True
    rejects_far  = verify_totp(far_code,  test_secret, window=1, timestamp=now) is False
    record(
        "Test 6: window=1 accepts ±30s, rejects ±120s",
        accepts_prev and accepts_next and rejects_far,
        f"prev={accepts_prev} next={accepts_next} far_rejected={rejects_far}",
    )

    # ── Test 7: wrong-length token rejected ─────────────────────────────
    test_secret = generate_secret()
    rejects_short = verify_totp("12345",   test_secret) is False
    rejects_long  = verify_totp("1234567", test_secret) is False
    record(
        "Test 7: wrong-length token rejected (5-digit and 7-digit)",
        rejects_short and rejects_long,
        f"reject_short={rejects_short} reject_long={rejects_long}",
    )

    if not all_pass:
        sys.exit(1)

    # ── Cross-check vs pyotp (not the source of truth) ──────────────────
    n_iter = 20
    cross_pass = 0

    try:
        import pyotp
        import hashlib

        # pyotp defaults to SHA-1. Construct each TOTP instance with
        # digest=hashlib.sha256 to match our SHA-256 variant. pyotp
        # expects a base32-encoded secret string, so we encode our raw
        # bytes via the scratch base32_encode (which we just verified
        # against RFC 4648 in Test 1).
        for i in range(n_iter):
            sec = generate_secret(20)
            sec_b32 = base32_encode(sec)
            # Random ts in roughly ±32k minutes (~22 days) of now.
            ts_offset_minutes = int.from_bytes(os.urandom(2), 'big') - 32768
            ts = int(time.time()) + ts_offset_minutes * 60

            totp_obj = pyotp.TOTP(sec_b32, digest=hashlib.sha256)

            # Direction A: scratch generate → pyotp verify
            scratch_token = generate_totp(sec, timestamp=ts)
            if not totp_obj.verify(scratch_token, for_time=ts):
                print(f"FAIL  cross-check A iteration {i + 1}")
                print(f"      ts={ts} secret={sec.hex()} scratch_token={scratch_token}")
                sys.exit(1)

            # Direction B: pyotp generate → scratch verify
            pyotp_token = totp_obj.at(ts)
            if not verify_totp(pyotp_token, sec, timestamp=ts, window=0):
                print(f"FAIL  cross-check B iteration {i + 1}")
                print(f"      ts={ts} secret={sec.hex()} pyotp_token={pyotp_token}")
                sys.exit(1)

            cross_pass += 1

        print(f"cross-check vs pyotp: {cross_pass}/{n_iter} PASS")

    except ImportError:
        # Fall back to scratch self-consistency
        for i in range(n_iter):
            sec = generate_secret(20)
            ts_offset_minutes = int.from_bytes(os.urandom(2), 'big') - 32768
            ts = int(time.time()) + ts_offset_minutes * 60

            code = generate_totp(sec, timestamp=ts)
            if not verify_totp(code, sec, timestamp=ts, window=0):
                print(f"FAIL  self-consistency iteration {i + 1}")
                sys.exit(1)
            cross_pass += 1

        print(f"cross-check skipped (pyotp not installed) — using self-consistency {cross_pass}/{n_iter} PASS")
