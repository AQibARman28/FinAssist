"""
JWT (JSON Web Token) signing and verification with HS256, from scratch.

This file is a direct port of Backend/utils/scratch/jwtScratch.js — same
three-part wire format, same HS256-only enforcement, same alg=none
defense, same parse_expires_in semantics.

The three-part anatomy of a JWT
─────────────────────────────────────────────────────────────────────────────
A JWT is just a string with two dots in it:

    <base64url(header_json)>.<base64url(payload_json)>.<base64url(signature)>

Header and payload are NOT encrypted. They are base64url-encoded JSON,
plainly readable by anyone who can copy-paste the token into jwt.io. The
signature is what proves the token was issued by someone who held the
secret; without it, the token is a free-form claim that anyone could
have manufactured. Do not put secrets inside a JWT payload.

HS256 mechanics
─────────────────────────────────────────────────────────────────────────────
"HS256" means HMAC-SHA256 over the *ASCII bytes* of the string

    "<base64url(header)>.<base64url(payload)>"

— the literal first two parts of the token, joined by a dot, read as
text. The signature is NOT computed over the raw JSON bytes or over the
raw header/payload buffers; it's over the dotted base64url string.
Getting that detail wrong is the easiest way to produce a JWT
implementation that round-trips with itself but fails to verify
library-issued tokens.

The alg=none attack — and what we do about it
─────────────────────────────────────────────────────────────────────────────
The original JWT spec optionally allowed an "alg":"none" header, meaning
"no signature, the token is unsigned". Several early libraries
implemented verify() by reading the alg field from the header and
dispatching to the matching verifier — including the "none" verifier,
which simply returned True.

The exploit: an attacker took any token they had captured, swapped the
header for {"alg":"none","typ":"JWT"}, dropped the signature segment to
an empty string, and submitted it. Naïve verifiers accepted it. The
stolen token now had whatever payload the attacker wanted — privilege
escalation in one HTTP request.

The fix is structural: jwt_verify never trusts the header's `alg` field
as a signal of which algorithm to use. We hard-require alg == "HS256";
any other value (including "none") is rejected outright before signature
work begins. This single check defeats both the alg=none attack and the
related "algorithm confusion" attack (where an attacker swaps an
RS256-issued token's header to HS256 and uses the public key as the
HMAC secret).

Constant-time signature comparison
─────────────────────────────────────────────────────────────────────────────
Identical reasoning to the GCM tag check and the PBKDF2 stored-hash
compare: if signature comparison short-circuits on the first byte
mismatch, an attacker can use response timing to learn how many leading
bytes of their forged signature were correct, and reconstruct the real
signature one byte at a time. We walk every byte unconditionally and
combine the differences with bitwise OR.

Allowed dependencies
─────────────────────────────────────────────────────────────────────────────
The only require for the algorithm is `hmac_sha256` from our local
scratch HMAC module. `json` / `base64` / `re` / `time` are stdlib
encoding/serialization helpers, not crypto primitives. The optional
cross-check at the bottom imports PyJWT purely as a reference; clearly
marked.
"""

import base64
import json
import re
import time

from hmac_sha256 import hmac_sha256


# ─────────────────────────────────────────────────────────────────────────────
# Custom exception — clearer than ValueError when callers catch
# ─────────────────────────────────────────────────────────────────────────────

class JWTError(Exception):
    """Raised by jwt_verify on any structural failure: malformed token,
    bad base64url, JSON parse error, unsupported algorithm, signature
    mismatch, or expired token. All failures use the same exception type
    so error-handling code does not need to discriminate (and so we
    don't accidentally leak which check tripped via the exception class)."""
    pass


# ─────────────────────────────────────────────────────────────────────────────
# base64url helpers
# ─────────────────────────────────────────────────────────────────────────────

def base64url_encode(input_value):
    """Encode bytes (or a UTF-8 string) as base64url.

    base64url is just standard base64 with three changes that make the
    result URL- and form-safe (no characters that need percent-encoding):
      '+'  →  '-'
      '/'  →  '_'
      trailing '=' padding stripped

    The padding stripping is allowed because the original byte length
    can always be recovered from the base64url length mod 4.
    """
    if isinstance(input_value, str):
        buf = input_value.encode('utf-8')
    elif isinstance(input_value, (bytes, bytearray)):
        buf = bytes(input_value)
    else:
        raise TypeError("base64url_encode: input must be str, bytes, or bytearray")

    return base64.b64encode(buf).decode('ascii') \
                                .replace('+', '-').replace('/', '_') \
                                .rstrip('=')


def base64url_decode(s):
    """Decode a base64url string back to bytes.

    Reverse of base64url_encode: restore the standard '+' and '/'
    alphabet, pad the length back to a multiple of 4 with '=', then run
    a normal base64 decode.

    Note: Python's base64 decoder is *strict* about non-alphabet
    characters and will raise binascii.Error. Our caller (jwt_verify)
    catches that and translates to JWTError.
    """
    if isinstance(s, bytes):
        s = s.decode('ascii')
    if not isinstance(s, str):
        raise TypeError("base64url_decode: input must be a string")

    # Restore standard alphabet
    standard = s.replace('-', '+').replace('_', '/')
    # Pad to a multiple of 4
    padding = '=' * ((4 - len(standard) % 4) % 4)
    return base64.b64decode(standard + padding)


# ─────────────────────────────────────────────────────────────────────────────
# expiresIn parsing
# ─────────────────────────────────────────────────────────────────────────────

_EXPIRES_IN_RE = re.compile(r'^(-?\d+)([smhd])$')

def parse_expires_in(value):
    """Convert an `expiresIn` option value into seconds.

    Accepted shapes:
      - int                  — taken as a literal seconds count (negative
                               allowed, useful for tests that need an
                               already-expired token)
      - string "<n>s"        — n seconds
      - string "<n>m"        — n minutes
      - string "<n>h"        — n hours
      - string "<n>d"        — n days

    Anything else raises ValueError or TypeError. Fractional values
    like "1.5h" are NOT supported — keeps the parser simple.
    """
    # Reject bool BEFORE the int branch (bool is a subclass of int in Python).
    if isinstance(value, bool):
        raise TypeError("expiresIn: bool is not a valid expiresIn value")

    if isinstance(value, int):
        return value

    if not isinstance(value, str):
        raise TypeError("expiresIn: must be int or string with s/m/h/d suffix")

    match = _EXPIRES_IN_RE.match(value)
    if not match:
        raise ValueError(
            f'expiresIn: invalid format "{value}" '
            '(expected e.g. "60s", "15m", "1h", "30d")'
        )
    n = int(match.group(1))
    unit = match.group(2)
    multipliers = {'s': 1, 'm': 60, 'h': 3600, 'd': 86400}
    return n * multipliers[unit]


# ─────────────────────────────────────────────────────────────────────────────
# Constant-time byte comparison
# ─────────────────────────────────────────────────────────────────────────────

def constant_time_equal(a, b):
    """Constant-time byte comparison.

    Returns True iff `a` and `b` are byte-identical. Walks every byte of
    the inputs unconditionally so the comparison time depends only on
    length, not on contents — defeats timing-based byte-by-byte
    signature recovery.
    """
    if isinstance(a, str):
        a = a.encode('utf-8')
    if isinstance(b, str):
        b = b.encode('utf-8')
    if len(a) != len(b):
        return False
    diff = 0
    for x, y in zip(a, b):
        diff |= x ^ y
    return diff == 0


# ─────────────────────────────────────────────────────────────────────────────
# Sign and verify
# ─────────────────────────────────────────────────────────────────────────────

def _dumps(obj):
    """JSON-serialize without whitespace.

    The default json.dumps inserts ", " and ": " separators with spaces.
    Some JWT verifiers re-encode the payload during verification and
    compare bytes; whitespace mismatches break round-trips. We use the
    no-space separators to produce canonical compact JSON. The
    `sort_keys=False` flag preserves insertion order — Python dicts have
    been insertion-ordered since 3.7.
    """
    return json.dumps(obj, separators=(",", ":"), sort_keys=False)


def jwt_sign(payload, secret, options=None):
    """Sign a JWT with HS256.

    Args:
        payload: dict — claims object; will be JSON-encoded.
        secret:  str or bytes — shared HMAC secret.
        options: dict, optional. Supports:
            "expiresIn": int seconds OR str like "30d" / "1h" / "15m" /
                         "60s". When set, adds `iat` (now) and `exp` to
                         the payload before signing.

    Returns:
        str — compact-form JWT.
    """
    if not isinstance(payload, dict):
        raise TypeError("jwt_sign: payload must be a dict")

    options = options or {}

    # Copy the payload so we don't mutate the caller's dict when we
    # splice in iat/exp below.
    claims = dict(payload)

    if 'expiresIn' in options:
        expires_in_sec = parse_expires_in(options['expiresIn'])
        now = int(time.time())
        claims['iat'] = now
        claims['exp'] = now + expires_in_sec

    header = {"alg": "HS256", "typ": "JWT"}

    header_b64  = base64url_encode(_dumps(header))
    payload_b64 = base64url_encode(_dumps(claims))

    # The thing we sign is the *string* "<header_b64>.<payload_b64>" interpreted
    # as ASCII bytes — not the raw JSON, not the decoded buffers.
    signing_input = f"{header_b64}.{payload_b64}"
    signature     = hmac_sha256(secret, signing_input)
    signature_b64 = base64url_encode(signature)

    return f"{signing_input}.{signature_b64}"


def jwt_verify(token, secret):
    """Verify a JWT and return its decoded payload.

    Verification order is deliberate:
      1. Split into three parts.
      2. Decode the header and check `alg == "HS256"`. (Reject alg=none
         and other algorithms here, BEFORE doing any signature work.)
      3. Recompute the signature over <header_b64>.<payload_b64> with
         our secret.
      4. Constant-time compare against the supplied signature; if
         mismatch, raise — never look at the payload contents.
      5. Only now decode the payload (we know the issuer authorized
         exactly this byte sequence).
      6. If the payload has an `exp` claim, reject if we're past it.

    Args:
        token:  str — JWT string.
        secret: str or bytes — same secret used at signing.

    Returns:
        dict — decoded payload.

    Raises:
        JWTError on any malformed input, signature mismatch, or
        expired token.
    """
    if not isinstance(token, str):
        raise JWTError("jwt_verify: token must be a string")

    parts = token.split('.')
    if len(parts) != 3:
        raise JWTError("jwt_verify: malformed token (expected 3 dot-separated parts)")
    header_b64, payload_b64, signature_b64 = parts

    # ── Step 1: decode and validate the header ──────────────────────────
    try:
        header = json.loads(base64url_decode(header_b64).decode('utf-8'))
    except Exception:
        raise JWTError("jwt_verify: header is not valid base64url-encoded JSON")
    if not isinstance(header, dict):
        raise JWTError("jwt_verify: header must be a JSON object")
    # Hard reject anything other than HS256. This is the alg=none defense.
    if header.get('alg') != 'HS256':
        raise JWTError(
            f'jwt_verify: unsupported algorithm "{header.get("alg")}" '
            '(only HS256 is accepted)'
        )

    # ── Step 2: verify the signature ────────────────────────────────────
    signing_input = f"{header_b64}.{payload_b64}"
    expected_sig  = hmac_sha256(secret, signing_input)
    try:
        provided_sig = base64url_decode(signature_b64)
    except Exception:
        raise JWTError("jwt_verify: invalid base64url in signature")

    if not constant_time_equal(expected_sig, provided_sig):
        raise JWTError("jwt_verify: signature mismatch")

    # ── Step 3: only now decode the payload (signature confirmed) ───────
    try:
        payload = json.loads(base64url_decode(payload_b64).decode('utf-8'))
    except Exception:
        raise JWTError("jwt_verify: payload is not valid base64url-encoded JSON")
    if not isinstance(payload, dict):
        raise JWTError("jwt_verify: payload must be a JSON object")

    # ── Step 4: enforce `exp` if present ────────────────────────────────
    exp = payload.get('exp')
    if isinstance(exp, (int, float)) and not isinstance(exp, bool):
        now = int(time.time())
        if now >= exp:
            raise JWTError("jwt_verify: token expired")

    return payload


# ─────────────────────────────────────────────────────────────────────────────
# Self-test — runs only when this file is executed directly:
#   python jwt_hs256.py
# ─────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys

    SECRET = "my-test-secret-key"
    all_pass = True

    def record(name, ok, detail=""):
        global all_pass
        if not ok:
            all_pass = False
        print(f"{'PASS' if ok else 'FAIL'}  {name}")
        if not ok and detail:
            print(f"        {detail}")

    # ── Test 1: sign + verify round-trip ────────────────────────────────
    token = jwt_sign({"userId": "abc123", "role": "user"}, SECRET)
    decoded = jwt_verify(token, SECRET)
    record(
        "Test 1: sign + verify round-trip",
        decoded.get("userId") == "abc123" and decoded.get("role") == "user",
        f'decoded: {decoded}'
    )

    # ── Test 2: sign + verify with expiresIn = "1h" ─────────────────────
    before = int(time.time())
    token = jwt_sign({"userId": "abc"}, SECRET, {"expiresIn": "1h"})
    after = int(time.time())
    decoded = jwt_verify(token, SECRET)

    iat_in_window = before <= decoded.get("iat", -1) <= after
    exp_is_iat_plus_1h = decoded.get("exp") == decoded.get("iat", -1) + 3600
    record(
        'Test 2: expiresIn "1h" sets iat + exp correctly',
        decoded.get("userId") == "abc" and iat_in_window and exp_is_iat_plus_1h,
        f'iat={decoded.get("iat")} exp={decoded.get("exp")} window=[{before},{after}]'
    )

    # ── Test 3: wrong secret rejected ───────────────────────────────────
    token = jwt_sign({"userId": "abc"}, "secret-A")
    threw = False
    msg = ""
    try:
        jwt_verify(token, "secret-B")
    except JWTError as e:
        threw = True
        msg = str(e)
    record(
        "Test 3: wrong secret rejected",
        threw and "signature mismatch" in msg.lower(),
        f'error: "{msg}"'
    )

    # ── Test 4: tampered payload rejected ───────────────────────────────
    token = jwt_sign({"userId": "user"}, SECRET)
    parts = token.split(".")
    tampered_payload = base64url_encode(_dumps({"userId": "admin"}))
    tampered = f"{parts[0]}.{tampered_payload}.{parts[2]}"
    threw = False
    msg = ""
    try:
        jwt_verify(tampered, SECRET)
    except JWTError as e:
        threw = True
        msg = str(e)
    record(
        "Test 4: tampered payload rejected",
        threw and "signature mismatch" in msg.lower(),
        f'error: "{msg}"'
    )

    # ── Test 5: alg=none attack rejected ────────────────────────────────
    fake_header  = base64url_encode(_dumps({"alg": "none", "typ": "JWT"}))
    fake_payload = base64url_encode(_dumps({"userId": "admin"}))
    fake_token   = f"{fake_header}.{fake_payload}."
    threw = False
    msg = ""
    try:
        jwt_verify(fake_token, SECRET)
    except JWTError as e:
        threw = True
        msg = str(e)
    record(
        "Test 5: alg=none attack rejected",
        threw and "unsupported algorithm" in msg.lower(),
        f'error: "{msg}"'
    )

    # ── Test 6: expired token rejected ──────────────────────────────────
    token = jwt_sign({"userId": "abc"}, SECRET, {"expiresIn": -10})
    threw = False
    msg = ""
    try:
        jwt_verify(token, SECRET)
    except JWTError as e:
        threw = True
        msg = str(e)
    record(
        "Test 6: expired token rejected",
        threw and "expired" in msg.lower(),
        f'error: "{msg}"'
    )

    if not all_pass:
        sys.exit(1)

    # ── Cross-check vs PyJWT (not the source of truth) ──────────────────
    import os
    import string

    SAFE_KEYS = ['userId', 'role', 'org', 'team', 'level', 'city', 'lang', 'tier', 'plan', 'group']
    ALPHANUM = string.ascii_letters + string.digits

    def random_string(min_len, max_len):
        rb = os.urandom(2)
        n = min_len + (int.from_bytes(rb, 'big') % (max_len - min_len + 1))
        return ''.join(ALPHANUM[b % len(ALPHANUM)] for b in os.urandom(n))

    def random_value():
        r = int.from_bytes(os.urandom(1), 'big') % 100
        if r < 40:  return random_string(1, 16)
        if r < 70:  return int.from_bytes(os.urandom(2), 'big') % 10000
        if r < 90:  return os.urandom(1)[0] > 127
        return None

    def random_payload():
        n_keys = 1 + (os.urandom(1)[0] % 5)
        keys = set()
        while len(keys) < n_keys:
            keys.add(SAFE_KEYS[os.urandom(1)[0] % len(SAFE_KEYS)])
        return {k: random_value() for k in keys}

    def payload_matches(expected, actual):
        for k, v in expected.items():
            if k in ('iat', 'exp'):
                continue
            if actual.get(k) != v:
                return False
        return True

    n_iter = 20
    cross_pass = 0
    cross_label = ""

    try:
        import jwt as pyjwt

        for i in range(n_iter):
            payload = random_payload()
            secret  = random_string(8, 32)
            choice  = ['1m', '1h', '30d', None][os.urandom(1)[0] % 4]

            # Direction A: scratch sign → PyJWT verify
            options = {"expiresIn": choice} if choice else None
            scratch_token = jwt_sign(payload, secret, options)
            try:
                lib_decoded = pyjwt.decode(scratch_token, secret, algorithms=['HS256'])
            except Exception as e:
                print(f"FAIL  cross-check A iteration {i + 1}: PyJWT rejected scratch token — {e}")
                sys.exit(1)
            if not payload_matches(payload, lib_decoded):
                print(f"FAIL  cross-check A iteration {i + 1}: payload mismatch")
                print(f"      expected: {payload}")
                print(f"      got:      {lib_decoded}")
                sys.exit(1)

            # Direction B: PyJWT sign → scratch verify
            if choice:
                seconds = parse_expires_in(choice)
                pyjwt_payload = {**payload, "exp": int(time.time()) + seconds}
            else:
                pyjwt_payload = payload
            pyjwt_token = pyjwt.encode(pyjwt_payload, secret, algorithm='HS256')
            try:
                scratch_decoded = jwt_verify(pyjwt_token, secret)
            except JWTError as e:
                print(f"FAIL  cross-check B iteration {i + 1}: scratch rejected PyJWT token — {e}")
                sys.exit(1)
            if not payload_matches(payload, scratch_decoded):
                print(f"FAIL  cross-check B iteration {i + 1}: payload mismatch")
                print(f"      expected: {payload}")
                print(f"      got:      {scratch_decoded}")
                sys.exit(1)

            cross_pass += 1

        print(f"cross-check vs PyJWT: {cross_pass}/{n_iter} PASS")

    except ImportError:
        # Fall back to scratch self-consistency
        for i in range(n_iter):
            payload = random_payload()
            secret  = random_string(8, 32)
            scratch_token = jwt_sign(payload, secret)
            scratch_decoded = jwt_verify(scratch_token, secret)
            if not payload_matches(payload, scratch_decoded):
                print(f"FAIL  self-consistency iteration {i + 1}")
                sys.exit(1)
            cross_pass += 1

        print(f"cross-check skipped (PyJWT not installed) — using self-consistency {cross_pass}/{n_iter} PASS")
