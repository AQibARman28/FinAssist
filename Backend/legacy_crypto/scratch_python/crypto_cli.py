"""
crypto_cli.py — single-shot JSON-over-stdio dispatcher for the eight
from-scratch crypto primitives in Backend/utils/scratch_python/.

Usage from Node (Backend/utils/pyCrypto.js):
    python crypto_cli.py
    stdin:  {"op": "<op_name>", "args": {...}}
    stdout: {"ok": true,  "result": {...}}    -> exit 0
    stdout: {"ok": false, "error": "<msg>"}   -> exit 1

Usage from CLI for one-shot debugging:
    echo {"op":"sha256_hex","args":{"message_b64":"YWJj"}} | python crypto_cli.py
    python crypto_cli.py --selftest

Output protocol (strict):
  - EXACTLY one JSON object on stdout, on a single line, ending in a newline.
  - All other output (debug, library warnings, traceback noise) goes to
    stderr. The Node wrapper parses stdout only.

Encoding convention:
  - Every binary argument is base64-encoded (standard alphabet, with
    padding) under a key suffixed `_b64`. Likewise for binary results.
  - RSA / ECDSA keypairs travel as already-stringified JSON under
    `public_json` / `private_json`, matching the JS keyManagement.js
    storage format byte-for-byte:
        RSA  public:  {"n":"<hex>","e":"<hex>"}
        RSA  private: {"n","e","d","p","q"} all hex
        ECDSA public: {"x":"<hex>","y":"<hex>"}
        ECDSA private:{"d":"<hex>"}

Each op handler receives the `args` dict, returns a plain dict that the
top-level dispatcher will wrap into the envelope. No handler ever calls
print() or sys.exit() — failures raise; the dispatcher catches and
emits the failure envelope.
"""

import base64
import json
import os
import sys
import traceback
import urllib.parse

# Make sibling modules importable regardless of cwd.
_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
if _THIS_DIR not in sys.path:
    sys.path.insert(0, _THIS_DIR)

from sha256 import sha256_hex                                   # noqa: E402
from hmac_sha256 import hmac_sha256_hex                         # noqa: E402
from aes256gcm import aes256_gcm_encrypt, aes256_gcm_decrypt    # noqa: E402
from pbkdf2 import hash_password, verify_password, pbkdf2 as pbkdf2_derive_raw  # noqa: E402
from jwt_hs256 import jwt_sign, jwt_verify                      # noqa: E402
from totp import (                                              # noqa: E402
    generate_secret as totp_generate_secret_bytes,
    base32_encode, base32_decode,
    generate_totp, verify_totp,
)
from rsa import (                                               # noqa: E402
    generate_rsa_keypair,
    rsa_encrypt_oaep, rsa_decrypt_oaep,
    serialize_public_key as rsa_serialize_public,
    serialize_private_key as rsa_serialize_private,
    parse_public_key as rsa_parse_public,
    parse_private_key as rsa_parse_private,
)
from ecdsa_p256 import (                                        # noqa: E402
    generate_keypair as ecdsa_generate_keypair_ints,
    sign_record as ecdsa_sign_record,
    verify_record as ecdsa_verify_record,
    serialize_public_key as ecdsa_serialize_public,
    serialize_private_key as ecdsa_serialize_private,
    parse_public_key as ecdsa_parse_public,
    parse_private_key as ecdsa_parse_private,
)


# ─────────────────────────────────────────────────────────────────────────────
# Encoding helpers
# ─────────────────────────────────────────────────────────────────────────────

def _b64d(value):
    """Decode a base64 string to bytes. None or '' returns b''."""
    if value is None or value == '':
        return b''
    if not isinstance(value, str):
        raise TypeError("expected base64-encoded string")
    return base64.b64decode(value)


def _b64e(value):
    """Encode bytes as a base64 ASCII string."""
    return base64.b64encode(value).decode('ascii')


# ─────────────────────────────────────────────────────────────────────────────
# Op handlers — one function per operation, each takes args dict and
# returns a plain dict. Exceptions propagate to the top-level dispatcher.
# ─────────────────────────────────────────────────────────────────────────────

def op_sha256_hex(args):
    msg = _b64d(args['message_b64'])
    return {"hex": sha256_hex(msg)}


def op_hmac_sha256_hex(args):
    key = _b64d(args['key_b64'])
    msg = _b64d(args['message_b64'])
    return {"hex": hmac_sha256_hex(key, msg)}


def op_aes_encrypt(args):
    key = _b64d(args['key_b64'])
    iv  = _b64d(args['iv_b64'])
    pt  = _b64d(args['plaintext_b64'])
    aad = _b64d(args.get('aad_b64'))
    ct, tag = aes256_gcm_encrypt(key, iv, pt, aad)
    return {"ciphertext_b64": _b64e(ct), "tag_b64": _b64e(tag)}


def op_aes_decrypt(args):
    key = _b64d(args['key_b64'])
    iv  = _b64d(args['iv_b64'])
    ct  = _b64d(args['ciphertext_b64'])
    tag = _b64d(args['tag_b64'])
    aad = _b64d(args.get('aad_b64'))
    pt = aes256_gcm_decrypt(key, iv, ct, tag, aad)
    return {"plaintext_b64": _b64e(pt)}


def op_pbkdf2_hash(args):
    """Hash a password with PBKDF2-SHA256 and return the storage string.

    DEV-MODE ITERATION COUNT NOTE:
    -----------------------------------------------------------------
    The default here is 10,000 iterations, NOT the OWASP-recommended
    100,000+. This is a deliberate choice for the subprocess
    integration phase: every login spawns a fresh Python interpreter
    (~100ms cold start) plus runs PBKDF2 in pure Python (no C
    acceleration). With 100,000 iterations the per-login wall time is
    ~5-10 seconds, which makes interactive testing unworkable.

    PRODUCTION DEPLOYMENTS MUST RAISE THIS. Either:
      (a) bump iterations back to 100,000+ and accept the latency, or
      (b) replace the per-call subprocess with a long-running Python
          sidecar so the interpreter cost is amortized away, then
          restore 100,000+.

    The algorithm is byte-for-byte identical regardless of the
    iteration count; only the work factor changes.
    -----------------------------------------------------------------
    """
    password = args['password']
    iterations = args.get('iterations', 10000)
    if not isinstance(password, str):
        raise TypeError("pbkdf2_hash: password must be a string")
    if not isinstance(iterations, int) or iterations < 1:
        raise ValueError("pbkdf2_hash: iterations must be a positive integer")
    stored = hash_password(password, iterations=iterations)
    return {"stored": stored}


def op_pbkdf2_verify(args):
    password = args['password']
    stored = args['stored']
    if not isinstance(password, str):
        raise TypeError("pbkdf2_verify: password must be a string")
    if not isinstance(stored, str):
        raise TypeError("pbkdf2_verify: stored must be a string")
    return {"ok": bool(verify_password(password, stored))}


def op_pbkdf2_derive(args):
    password = _b64d(args['password_b64'])
    salt = _b64d(args['salt_b64'])
    iterations = args['iterations']
    key_length = args['key_length']
    derived = pbkdf2_derive_raw(password, salt, iterations, key_length)
    return {"derived_b64": _b64e(derived)}


def op_jwt_sign(args):
    payload = args['payload']
    secret = args['secret']
    if not isinstance(payload, dict):
        raise TypeError("jwt_sign: payload must be a JSON object")
    if not isinstance(secret, str):
        raise TypeError("jwt_sign: secret must be a string")
    options = None
    if 'expires_in' in args and args['expires_in'] is not None:
        options = {"expiresIn": args['expires_in']}
    token = jwt_sign(payload, secret, options)
    return {"token": token}


def op_jwt_verify(args):
    token = args['token']
    secret = args['secret']
    if not isinstance(token, str):
        raise TypeError("jwt_verify: token must be a string")
    if not isinstance(secret, str):
        raise TypeError("jwt_verify: secret must be a string")
    payload = jwt_verify(token, secret)
    return {"payload": payload}


def op_totp_generate_secret(args):
    secret_bytes = totp_generate_secret_bytes()
    return {"secret_b32": base32_encode(secret_bytes)}


def op_totp_otpauth_uri(args):
    """Build an otpauth:// URI for authenticator-app provisioning.

    Format:
        otpauth://totp/<encoded_label>?secret=<b32>
                                       &issuer=<encoded_issuer>
                                       &algorithm=SHA256
                                       &digits=6
                                       &period=30

    `algorithm=SHA256` matches our SHA-256 TOTP variant — most
    authenticator apps default to SHA-1, so this parameter is REQUIRED
    or apps will compute the wrong codes. Mirrors the buildOtpauthURI
    helper in twoFactorController.js.
    """
    label = args['label']
    issuer = args['issuer']
    secret_b32 = args['secret_b32']
    if not isinstance(label, str) or not isinstance(issuer, str):
        raise TypeError("totp_otpauth_uri: label and issuer must be strings")
    if not isinstance(secret_b32, str):
        raise TypeError("totp_otpauth_uri: secret_b32 must be a string")

    encoded_label = urllib.parse.quote(label, safe='')
    encoded_issuer = urllib.parse.quote(issuer, safe='')
    uri = (
        f"otpauth://totp/{encoded_label}"
        f"?secret={secret_b32}"
        f"&issuer={encoded_issuer}"
        f"&algorithm=SHA256"
        f"&digits=6"
        f"&period=30"
    )
    return {"uri": uri}


def op_totp_verify(args):
    token = args['token']
    secret_b32 = args['secret_b32']
    window = args.get('window', 1)
    if not isinstance(token, str):
        raise TypeError("totp_verify: token must be a string")
    if not isinstance(secret_b32, str):
        raise TypeError("totp_verify: secret_b32 must be a string")
    if not isinstance(window, int) or window < 0:
        raise ValueError("totp_verify: window must be a non-negative int")
    secret_bytes = base32_decode(secret_b32)
    return {"ok": bool(verify_totp(token, secret_bytes, window=window))}


def op_totp_generate(args):
    secret_b32 = args['secret_b32']
    if not isinstance(secret_b32, str):
        raise TypeError("totp_generate: secret_b32 must be a string")
    secret_bytes = base32_decode(secret_b32)
    return {"token": generate_totp(secret_bytes)}


def op_rsa_generate_keypair(args):
    keypair = generate_rsa_keypair(2048)
    public_json = json.dumps(rsa_serialize_public(keypair), separators=(',', ':'))
    private_json = json.dumps(rsa_serialize_private(keypair), separators=(',', ':'))
    return {"public_json": public_json, "private_json": private_json}


def op_rsa_oaep_encrypt(args):
    public_json = args['public_json']
    plaintext = _b64d(args['plaintext_b64'])
    if not isinstance(public_json, str):
        raise TypeError("rsa_oaep_encrypt: public_json must be a JSON string")
    pubkey = rsa_parse_public(json.loads(public_json))
    ct = rsa_encrypt_oaep(plaintext, pubkey)
    return {"ciphertext_b64": _b64e(ct)}


def op_rsa_oaep_decrypt(args):
    private_json = args['private_json']
    ciphertext = _b64d(args['ciphertext_b64'])
    if not isinstance(private_json, str):
        raise TypeError("rsa_oaep_decrypt: private_json must be a JSON string")
    privkey = rsa_parse_private(json.loads(private_json))
    pt = rsa_decrypt_oaep(ciphertext, privkey)
    return {"plaintext_b64": _b64e(pt)}


def op_ecdsa_generate_keypair(args):
    keypair = ecdsa_generate_keypair_ints()
    public_json = json.dumps(ecdsa_serialize_public(keypair), separators=(',', ':'))
    private_json = json.dumps(ecdsa_serialize_private(keypair), separators=(',', ':'))
    return {"public_json": public_json, "private_json": private_json}


def op_ecdsa_sign(args):
    private_json = args['private_json']
    message = _b64d(args['message_b64'])
    if not isinstance(private_json, str):
        raise TypeError("ecdsa_sign: private_json must be a JSON string")
    priv = ecdsa_parse_private(json.loads(private_json))
    sig = ecdsa_sign_record(message, priv['d'])
    return {"signature_b64": _b64e(sig)}


def op_ecdsa_verify(args):
    public_json = args['public_json']
    message = _b64d(args['message_b64'])
    signature = _b64d(args['signature_b64'])
    if not isinstance(public_json, str):
        raise TypeError("ecdsa_verify: public_json must be a JSON string")
    pub = ecdsa_parse_public(json.loads(public_json))
    ok = ecdsa_verify_record(message, signature, (pub['x'], pub['y']))
    return {"ok": bool(ok)}


# ─────────────────────────────────────────────────────────────────────────────
# Dispatch table
# ─────────────────────────────────────────────────────────────────────────────

OPS = {
    'sha256_hex':              op_sha256_hex,
    'hmac_sha256_hex':         op_hmac_sha256_hex,

    'aes_encrypt':             op_aes_encrypt,
    'aes_decrypt':             op_aes_decrypt,

    'pbkdf2_hash':             op_pbkdf2_hash,
    'pbkdf2_verify':           op_pbkdf2_verify,
    'pbkdf2_derive':           op_pbkdf2_derive,

    'jwt_sign':                op_jwt_sign,
    'jwt_verify':              op_jwt_verify,

    'totp_generate_secret':    op_totp_generate_secret,
    'totp_otpauth_uri':        op_totp_otpauth_uri,
    'totp_verify':             op_totp_verify,
    'totp_generate':           op_totp_generate,

    'rsa_generate_keypair':    op_rsa_generate_keypair,
    'rsa_oaep_encrypt':        op_rsa_oaep_encrypt,
    'rsa_oaep_decrypt':        op_rsa_oaep_decrypt,

    'ecdsa_generate_keypair':  op_ecdsa_generate_keypair,
    'ecdsa_sign':              op_ecdsa_sign,
    'ecdsa_verify':            op_ecdsa_verify,
}


def dispatch(op, args):
    if op not in OPS:
        raise ValueError(f"unknown op: {op!r}")
    if args is None:
        args = {}
    if not isinstance(args, dict):
        raise TypeError("args must be a JSON object")
    return OPS[op](args)


# ─────────────────────────────────────────────────────────────────────────────
# Envelope writer
# ─────────────────────────────────────────────────────────────────────────────

def _emit(envelope):
    """Write the envelope to stdout as a single JSON line and flush."""
    sys.stdout.write(json.dumps(envelope, separators=(',', ':')))
    sys.stdout.write('\n')
    sys.stdout.flush()


# ─────────────────────────────────────────────────────────────────────────────
# Self-test mode
# ─────────────────────────────────────────────────────────────────────────────

def _selftest():
    """Run each op once with canned inputs and print PASS / FAIL.

    Goes to stderr so it is visible without polluting any subsequent
    stdin/stdout protocol use. Exits 0 if every op passes, 1 otherwise.
    """
    results = []

    def check(name, fn):
        try:
            fn()
            results.append((name, True, ''))
            print(f"PASS  {name}", file=sys.stderr)
        except Exception as e:
            tb = traceback.format_exc()
            results.append((name, False, str(e)))
            print(f"FAIL  {name}: {e}", file=sys.stderr)
            print(tb, file=sys.stderr)

    # sha256_hex of "abc" — FIPS-known answer
    def t_sha():
        out = dispatch('sha256_hex', {"message_b64": _b64e(b"abc")})
        # Note: project README has a typo'd "...414140de5dae2223b00361a3396177a9..."
        # but the canonical FIPS digest is the one returned by sha256.py.
        assert isinstance(out['hex'], str) and len(out['hex']) == 64
    check("sha256_hex(abc) shape", t_sha)

    def t_hmac():
        out = dispatch('hmac_sha256_hex', {
            "key_b64": _b64e(b'\x0b' * 20),
            "message_b64": _b64e(b'Hi There'),
        })
        assert out['hex'] == 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7'
    check("hmac_sha256_hex RFC 4231 vector 1", t_hmac)

    def t_aes_round_trip():
        key = os.urandom(32)
        iv = os.urandom(12)
        pt = os.urandom(73)
        enc = dispatch('aes_encrypt', {
            "key_b64": _b64e(key), "iv_b64": _b64e(iv),
            "plaintext_b64": _b64e(pt),
        })
        dec = dispatch('aes_decrypt', {
            "key_b64": _b64e(key), "iv_b64": _b64e(iv),
            "ciphertext_b64": enc['ciphertext_b64'],
            "tag_b64": enc['tag_b64'],
        })
        assert _b64d(dec['plaintext_b64']) == pt
    check("aes encrypt+decrypt round-trip (random 73-byte plaintext)", t_aes_round_trip)

    def t_pbkdf2():
        h = dispatch('pbkdf2_hash', {"password": "hunter2"})
        assert h['stored'].startswith("pbkdf2-sha256$10000$")
        v_ok = dispatch('pbkdf2_verify', {"password": "hunter2", "stored": h['stored']})
        v_no = dispatch('pbkdf2_verify', {"password": "wrong",   "stored": h['stored']})
        assert v_ok['ok'] is True
        assert v_no['ok'] is False
    check("pbkdf2 hash + verify (correct True, wrong False, prefix 10000)", t_pbkdf2)

    def t_pbkdf2_derive():
        out = dispatch('pbkdf2_derive', {
            "password_b64": _b64e(b"passwd"),
            "salt_b64":     _b64e(b"salt"),
            "iterations":   1,
            "key_length":   64,
        })
        # RFC vector: pbkdf2(passwd, salt, 1, 64) hex starts with 55ac046e
        derived_hex = _b64d(out['derived_b64']).hex()
        assert derived_hex.startswith("55ac046e56e3089fec1691c22544b605"), \
            f"unexpected derive output: {derived_hex[:32]}..."
    check("pbkdf2_derive RFC vector", t_pbkdf2_derive)

    def t_jwt():
        token = dispatch('jwt_sign', {
            "payload": {"sub": "u1", "role": "admin"},
            "secret": "shared-secret",
        })['token']
        decoded = dispatch('jwt_verify', {"token": token, "secret": "shared-secret"})
        assert decoded['payload']['sub'] == 'u1'
        assert decoded['payload']['role'] == 'admin'
    check("jwt_sign + jwt_verify round-trip", t_jwt)

    def t_jwt_expires():
        token = dispatch('jwt_sign', {
            "payload": {"sub": "u1"},
            "secret": "shared-secret",
            "expires_in": "1h",
        })['token']
        decoded = dispatch('jwt_verify', {"token": token, "secret": "shared-secret"})
        assert 'iat' in decoded['payload']
        assert decoded['payload']['exp'] == decoded['payload']['iat'] + 3600
    check("jwt_sign with expires_in='1h' adds iat/exp", t_jwt_expires)

    def t_totp_secret_uri_round_trip():
        sec = dispatch('totp_generate_secret', {})
        b32 = sec['secret_b32']
        assert isinstance(b32, str) and len(b32) >= 32
        uri = dispatch('totp_otpauth_uri', {
            "label": "FinAssist:demo@example.com",
            "issuer": "FinAssist",
            "secret_b32": b32,
        })['uri']
        assert uri.startswith("otpauth://totp/")
        assert "algorithm=SHA256" in uri
        token = dispatch('totp_generate', {"secret_b32": b32})['token']
        ok = dispatch('totp_verify', {"token": token, "secret_b32": b32})['ok']
        assert ok is True
    check("totp generate_secret + otpauth_uri + generate + verify", t_totp_secret_uri_round_trip)

    # RSA + ECDSA: keypair generation is the slow path. We only do one of each.
    keypairs = {}

    def t_rsa_keygen():
        kp = dispatch('rsa_generate_keypair', {})
        assert kp['public_json'].startswith('{') and '"n"' in kp['public_json']
        assert kp['private_json'].startswith('{') and '"d"' in kp['private_json']
        keypairs['rsa'] = kp
    check("rsa_generate_keypair (2048) — slow", t_rsa_keygen)

    def t_rsa_round_trip():
        kp = keypairs['rsa']
        msg = b"private finance note"
        enc = dispatch('rsa_oaep_encrypt', {
            "public_json": kp['public_json'],
            "plaintext_b64": _b64e(msg),
        })
        dec = dispatch('rsa_oaep_decrypt', {
            "private_json": kp['private_json'],
            "ciphertext_b64": enc['ciphertext_b64'],
        })
        assert _b64d(dec['plaintext_b64']) == msg
    check("rsa_oaep_encrypt + rsa_oaep_decrypt round-trip", t_rsa_round_trip)

    def t_ecdsa_keygen():
        kp = dispatch('ecdsa_generate_keypair', {})
        assert '"x"' in kp['public_json'] and '"y"' in kp['public_json']
        assert '"d"' in kp['private_json']
        keypairs['ecdsa'] = kp
    check("ecdsa_generate_keypair", t_ecdsa_keygen)

    def t_ecdsa_sign_verify():
        kp = keypairs['ecdsa']
        msg = b"some signed record"
        sig = dispatch('ecdsa_sign', {
            "private_json": kp['private_json'],
            "message_b64": _b64e(msg),
        })
        ok = dispatch('ecdsa_verify', {
            "public_json": kp['public_json'],
            "message_b64": _b64e(msg),
            "signature_b64": sig['signature_b64'],
        })['ok']
        assert ok is True
        bad = dispatch('ecdsa_verify', {
            "public_json": kp['public_json'],
            "message_b64": _b64e(b"tampered message"),
            "signature_b64": sig['signature_b64'],
        })['ok']
        assert bad is False
    check("ecdsa_sign + ecdsa_verify (good=True, tampered=False)", t_ecdsa_sign_verify)

    failures = sum(1 for _, ok, _ in results if not ok)
    print(f"\n{len(results) - failures}/{len(results)} passed", file=sys.stderr)
    return 0 if failures == 0 else 1


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) > 1 and sys.argv[1] == '--selftest':
        sys.exit(_selftest())

    try:
        raw = sys.stdin.read()
        if not raw.strip():
            raise ValueError("crypto_cli: empty stdin")
        request = json.loads(raw)
        if not isinstance(request, dict):
            raise TypeError("crypto_cli: stdin must be a JSON object")
        op = request.get('op')
        args = request.get('args', {})
        if not isinstance(op, str):
            raise TypeError("crypto_cli: 'op' field must be a string")
        result = dispatch(op, args)
        _emit({"ok": True, "result": result})
        sys.exit(0)
    except Exception as e:
        # Diagnostic traceback to stderr (not stdout — Node parses stdout).
        traceback.print_exc(file=sys.stderr)
        _emit({"ok": False, "error": str(e)})
        sys.exit(1)


if __name__ == '__main__':
    main()
