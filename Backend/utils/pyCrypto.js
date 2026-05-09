/**
 * pyCrypto.js — Node side of the Python crypto subprocess bridge.
 *
 * Public API: callPython(op, args) -> Promise<resultObject>
 *
 *   await callPython('aes_encrypt', {
 *     key_b64: '...', iv_b64: '...', plaintext_b64: '...'
 *   });
 *   // -> { ciphertext_b64, tag_b64 }
 *
 * Each call spawns a fresh `python` interpreter, pipes a single JSON
 * request through stdin, and parses a single JSON envelope from stdout.
 * On Windows we fall back to `py` if `python` is not on PATH (Windows
 * Store Python typically registers `py` only).
 *
 * On any structural failure — timeout, empty stdout, unparseable JSON,
 * envelope.ok===false — the Promise REJECTS with an Error whose message
 * includes the first 500 chars of stderr for context. On success the
 * Promise resolves with envelope.result (already parsed).
 *
 * Timeout: 30s per call. RSA keypair generation is the slowest op in
 * the suite at ~1.5s, so 30s gives ample headroom and still surfaces a
 * hung subprocess quickly.
 */

const { spawn } = require('child_process');
const path = require('path');

const SCRIPT_PATH = path.join(__dirname, 'scratch_python', 'crypto_cli.py');
const TIMEOUT_MS = 30_000;

function _runOnce(executable, op, args) {
    return new Promise((resolve, reject) => {
        let child;
        try {
            child = spawn(executable, [SCRIPT_PATH], {
                stdio: ['pipe', 'pipe', 'pipe'],
            });
        } catch (err) {
            reject(err);
            return;
        }

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');

        let stdout = '';
        let stderr = '';
        let settled = false;
        let timedOut = false;

        const timer = setTimeout(() => {
            timedOut = true;
            try { child.kill('SIGKILL'); } catch (_) { /* already dead */ }
        }, TIMEOUT_MS);

        const settle = (fn) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            fn();
        };

        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', (chunk) => { stderr += chunk; });

        // Spawn-level failure (ENOENT, EACCES). The fallback path in
        // callPython() inspects err.code on this rejection.
        child.on('error', (err) => {
            settle(() => reject(err));
        });

        child.on('close', () => {
            settle(() => {
                if (timedOut) {
                    return reject(new Error(
                        `pyCrypto: op '${op}' timed out after ${TIMEOUT_MS}ms ` +
                        `(stderr: ${stderr.slice(0, 500)})`
                    ));
                }

                if (!stdout || !stdout.trim()) {
                    return reject(new Error(
                        `pyCrypto: op '${op}' produced empty stdout ` +
                        `(stderr: ${stderr.slice(0, 500)})`
                    ));
                }

                // The dispatcher writes exactly one JSON line to stdout.
                // Take the last non-empty line to be tolerant of any
                // upstream warning that lands on stdout (shouldn't, but
                // makes this robust).
                const lastLine = stdout.trim().split(/\r?\n/).pop();

                let envelope;
                try {
                    envelope = JSON.parse(lastLine);
                } catch (err) {
                    return reject(new Error(
                        `pyCrypto: op '${op}' returned unparseable stdout ` +
                        `(stderr: ${stderr.slice(0, 500)})`
                    ));
                }

                if (envelope && envelope.ok === true) {
                    return resolve(envelope.result);
                }
                return reject(new Error(
                    (envelope && envelope.error) || `pyCrypto: op '${op}' failed`
                ));
            });
        });

        // Send the request. If the child died before stdin was writable
        // we'll get an EPIPE here; swallow it and let the 'close'/'error'
        // handlers do the rejection — they have richer context.
        try {
            child.stdin.write(JSON.stringify({ op, args: args || {} }));
            child.stdin.end();
        } catch (_) { /* see comment above */ }
    });
}

async function callPython(op, args) {
    try {
        return await _runOnce('python', op, args);
    } catch (err) {
        if (process.platform === 'win32' && err && err.code === 'ENOENT') {
            return _runOnce('py', op, args);
        }
        throw err;
    }
}

module.exports = { callPython };
