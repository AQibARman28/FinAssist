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


_BASE64URL_RE = re.compile(r'\A[A-Za-z0-9_-]*\Z')


def base64url_decode(s):
    """Decode a base64url string back to bytes — STRICTLY.

    Python's base64.b64decode() is *lenient* by default (validate=False):
    it silently discards characters outside the alphabet, and even with
    validate=True it accepts '=' padding and ignores non-zero "spare"
    bits in the last character. So many different strings decode to the
    same bytes — e.g. a JWT whose signature ends in "...Xk" would also
    "verify" with "...Xl". A token must have exactly one valid spelling,
    so we raise ValueError on:
      - any character outside [A-Za-z0-9_-] (this includes '=', '+',
        '/', whitespace);
      - a length = 1 (mod 4), which no byte string encodes to;
      - non-canonical trailing bits, detected by re-encoding the decoded
        bytes and requiring the result to equal the input exactly.
    jwt_verify catches the ValueError and raises JWTError.
    """
    if isinstance(s, bytes):
        s = s.decode('ascii')
    if not isinstance(s, str):
        raise TypeError("base64url_decode: input must be a string")
    if not _BASE64URL_RE.match(s):
        raise ValueError(
            "base64url_decode: invalid base64url "
            "(only A-Z a-z 0-9 - _ allowed, no padding)"
        )
    if len(s) % 4 == 1:
        raise ValueError("base64url_decode: invalid base64url length")

    # Restore standard alphabet and pad to a multiple of 4.
    standard = s.replace('-', '+').replace('_', '/')
    padding = '=' * ((4 - len(standard) % 4) % 4)
    decoded = base64.b64decode(standard + padding, validate=True)

    # Canonical form: the only accepted spelling is the one we would emit.
    if base64url_encode(decoded) != s:
        raise ValueError("base64url_decode: non-canonical base64url (non-zero trailing bits)")
    return decoded


def _require_secret(secret, fn_name):
    """Reject an empty or missing HMAC secret.

    HMAC with an empty key is still "valid" HMAC, so without this check a
    misconfigured deployment (unset JWT_SECRET -> '') would happily sign
    and verify tokens that anyone can forge.
    """
    ok = isinstance(secret, (str, bytes, bytearray)) and len(secret) > 0
    if not ok:
        raise TypeError(f"{fn_name}: secret must be a non-empty str or bytes")


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
    _require_secret(secret, "jwt_sign")

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


def jwt_verify(token, secret, options=None):
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
      6. Require an `exp` claim (unless options["allowMissingExp"]) and
         reject if we're past it. A present-but-non-numeric `exp` is
         always an error.

    All three segments go through the strict base64url decoder, so a
    token has exactly one accepted spelling.

    Args:
        token:   str — JWT string.
        secret:  non-empty str or bytes — same secret used at signing.
        options: dict, optional. Supports:
            "allowMissingExp": bool (default False) — accept tokens with
                no `exp` claim (non-expiring). Off by default: a token
                that never expires is a permanent credential if it leaks.
            "clockTimestamp": int/float — "now" in seconds since the
                epoch (default: time.time()). Useful for tests and for
                checking historical vectors such as RFC 7515 A.1.

    Returns:
        dict — decoded payload.

    Raises:
        JWTError on any malformed input, signature mismatch, missing or
        invalid exp, or expired token. TypeError for an empty/missing
        secret (a caller bug, not a token problem).
    """
    _require_secret(secret, "jwt_verify")
    options = options or {}
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
    # The attacker-controlled alg value is deliberately NOT echoed in the
    # message (it may end up in logs or an HTTP response).
    if header.get('alg') != 'HS256':
        raise JWTError('jwt_verify: unsupported algorithm (only HS256 is accepted)')

    # ── Step 2: verify the signature ────────────────────────────────────
    signing_input = f"{header_b64}.{payload_b64}"
    expected_sig  = hmac_sha256(secret, signing_input)
    try:
        provided_sig = base64url_decode(signature_b64)
    except Exception:
        raise JWTError("jwt_verify: signature is not valid base64url")

    if not constant_time_equal(expected_sig, provided_sig):
        raise JWTError("jwt_verify: signature mismatch")

    # ── Step 3: only now decode the payload (signature confirmed) ───────
    try:
        payload = json.loads(base64url_decode(payload_b64).decode('utf-8'))
    except Exception:
        raise JWTError("jwt_verify: payload is not valid base64url-encoded JSON")
    if not isinstance(payload, dict):
        raise JWTError("jwt_verify: payload must be a JSON object")

    # ── Step 4: enforce `exp` ───────────────────────────────────────────
    if 'exp' in payload:
        exp = payload['exp']
        if (not isinstance(exp, (int, float)) or isinstance(exp, bool)
                or exp != exp or exp in (float('inf'), float('-inf'))):
            raise JWTError("jwt_verify: exp claim must be a number")
        now = options.get("clockTimestamp")
        if now is None:
            now = int(time.time())
        elif not isinstance(now, (int, float)) or isinstance(now, bool):
            raise TypeError("jwt_verify: clockTimestamp must be a number")
        if now >= exp:
            raise JWTError("jwt_verify: token expired")
    elif options.get("allowMissingExp") is not True:
        raise JWTError(
            "jwt_verify: token has no exp claim "
            '(pass {"allowMissingExp": True} to accept non-expiring tokens)'
        )

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
    # No expiresIn -> no `exp` claim, so verification needs the explicit
    # opt-in (exp is required by default; see Test 10).
    token = jwt_sign({"userId": "abc123", "role": "user"}, SECRET)
    decoded = jwt_verify(token, SECRET, {"allowMissingExp": True})
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

    def attempt(fn):
        """Run fn(); return (raised, message). Any exception counts."""
        try:
            fn()
            return False, ""
        except Exception as exc:                      # noqa: BLE001
            return True, str(exc)

    # ── RFC 7515 Appendix A.1 — "Example JWS Using HMAC SHA-256" ────────
    # Source: https://www.rfc-editor.org/rfc/rfc7515.txt — Appendix A.1.1.
    # The JWK "k" value (the HMAC key, base64url), the JWS Signing Input
    # (BASE64URL(header) || '.' || BASE64URL(payload)), and the expected
    # BASE64URL(JWS Signature). The protected header and payload JSON
    # contain CRLF line breaks; the base64url strings below encode them.
    RFC7515_K = ("AyM1SysPpbyDfgZld3umj1qzKObwVMkoqQ-EstJQLr_T-1qS0gZH75"
                 "aKtMN3Yj0iPS4hcgUuTwjAzZr1Z9CAow")
    RFC7515_SIGNING_INPUT = (
        "eyJ0eXAiOiJKV1QiLA0KICJhbGciOiJIUzI1NiJ9"
        "."
        "eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFt"
        "cGxlLmNvbS9pc19yb290Ijp0cnVlfQ"
    )
    RFC7515_SIGNATURE = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    RFC7515_EXP = 1300819380          # the payload's exp claim (March 2011)

    rfc_key   = base64url_decode(RFC7515_K)
    rfc_token = f"{RFC7515_SIGNING_INPUT}.{RFC7515_SIGNATURE}"
    rfc_clock = {"clockTimestamp": RFC7515_EXP - 1}   # 1 s before expiry

    # ── Test 7: RFC 7515 A.1 known answer ───────────────────────────────
    sig_b64 = base64url_encode(hmac_sha256(rfc_key, RFC7515_SIGNING_INPUT))
    kat = sig_b64 == RFC7515_SIGNATURE and len(rfc_key) == 64
    try:
        rfc_payload = jwt_verify(rfc_token, rfc_key, rfc_clock)
    except Exception as exc:                          # noqa: BLE001
        rfc_payload = {"error": str(exc)}
    verifies = (rfc_payload.get("iss") == "joe"
                and rfc_payload.get("exp") == RFC7515_EXP
                and rfc_payload.get("http://example.com/is_root") is True)
    expired_now = attempt(lambda: jwt_verify(rfc_token, rfc_key))
    record(
        "Test 7: RFC 7515 A.1 HS256 vector (signature KAT, verify at exp-1, expired now)",
        kat and verifies and expired_now[0] and "expired" in expired_now[1],
        f"sig={sig_b64} kat={kat} payload={rfc_payload} expired_now={expired_now}",
    )

    # ── Test 8: strict base64url — altered signature strings rejected ───
    # Every variant decodes to the SAME 32 signature bytes under a lenient
    # decoder, so only a strict decoder can reject them.
    h_, p_, s_ = rfc_token.split(".")
    variants = {
        "non-canonical trailing bits (k->l)": f"{h_}.{p_}.{s_[:-1]}l",
        "'=' padding appended":               f"{h_}.{p_}.{s_}=",
        "standard-alphabet '+' for '-'":      f"{h_}.{p_}.{s_.replace('-', '+', 1)}",
        "standard-alphabet '/' for '_'":      f"{h_}.{p_}.{s_.replace('_', '/', 1)}",
        "embedded space":                     f"{h_}.{p_}.{s_[:10]} {s_[10:]}",
    }
    t8_failures = []
    for label, tok in variants.items():
        raised, msg = attempt(lambda tok=tok: jwt_verify(tok, rfc_key, rfc_clock))
        if not raised or "base64url" not in msg:
            t8_failures.append(f"{label}: raised={raised} msg={msg!r}")
    if not attempt(lambda: jwt_verify(f"{h_}=.{p_}.{s_}", rfc_key, rfc_clock))[0]:
        t8_failures.append("header with = padding accepted")
    still_ok = not attempt(lambda: jwt_verify(rfc_token, rfc_key, rfc_clock))[0]
    record(
        f"Test 8: strict base64url - {len(variants)} altered signature encodings rejected",
        not t8_failures and still_ok,
        "; ".join(t8_failures) + f" still_ok={still_ok}",
    )

    # ── Test 9: empty or missing secret rejected (sign and verify) ──────
    good = jwt_sign({"userId": "abc"}, SECRET, {"expiresIn": "1h"})
    t9_cases = {
        "sign, empty str":    lambda: jwt_sign({"a": 1}, ""),
        "sign, empty bytes":  lambda: jwt_sign({"a": 1}, b""),
        "sign, None":         lambda: jwt_sign({"a": 1}, None),
        "verify, empty str":  lambda: jwt_verify(good, ""),
        "verify, empty bytes": lambda: jwt_verify(good, b""),
        "verify, None":       lambda: jwt_verify(good, None),
    }
    t9_failures = []
    for label, fn in t9_cases.items():
        raised, msg = attempt(fn)
        if not raised or "secret" not in msg:
            t9_failures.append(f"{label}: raised={raised} msg={msg!r}")
    record("Test 9: empty or missing secret rejected by jwt_sign and jwt_verify",
           not t9_failures, "; ".join(t9_failures))

    # ── Test 10: exp required unless explicitly allowed ─────────────────
    no_exp = jwt_sign({"userId": "abc"}, SECRET)
    default_rej = attempt(lambda: jwt_verify(no_exp, SECRET))
    allowed     = attempt(lambda: jwt_verify(no_exp, SECRET, {"allowMissingExp": True}))
    str_exp     = jwt_sign({"userId": "abc", "exp": "9999999999"}, SECRET)
    str_exp_rej = attempt(lambda: jwt_verify(str_exp, SECRET, {"allowMissingExp": True}))
    bool_exp    = jwt_sign({"userId": "abc", "exp": True}, SECRET)
    bool_exp_rej = attempt(lambda: jwt_verify(bool_exp, SECRET, {"allowMissingExp": True}))
    record(
        "Test 10: token without exp rejected by default, accepted with allowMissingExp; str/bool exp rejected",
        default_rej[0] and "exp" in default_rej[1] and not allowed[0]
        and str_exp_rej[0] and bool_exp_rej[0],
        f"default={default_rej} allowed={not allowed[0]} str_exp={str_exp_rej} bool_exp={bool_exp_rej}",
    )

    # ── Test 11: attacker-supplied alg is not echoed in the error ───────
    evil_alg = 'HS256"><script>alert(1)</script>'
    evil_token = f"{base64url_encode(_dumps({'alg': evil_alg, 'typ': 'JWT'}))}.{base64url_encode('{}')}."
    raised, msg = attempt(lambda: jwt_verify(evil_token, SECRET))
    record(
        "Test 11: unsupported alg rejected without echoing the attacker-supplied value",
        raised and "unsupported algorithm" in msg and "script" not in msg,
        f"msg={msg!r}",
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
                scratch_decoded = jwt_verify(pyjwt_token, secret,
                                             {"allowMissingExp": not choice})
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
            scratch_decoded = jwt_verify(scratch_token, secret, {"allowMissingExp": True})
            if not payload_matches(payload, scratch_decoded):
                print(f"FAIL  self-consistency iteration {i + 1}")
                sys.exit(1)
            cross_pass += 1

        print(f"cross-check skipped (PyJWT not installed) — using self-consistency {cross_pass}/{n_iter} PASS")
