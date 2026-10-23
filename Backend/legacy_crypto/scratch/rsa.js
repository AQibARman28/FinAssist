// WARNING: NOT CONSTANT-TIME — square-and-multiply modPow over BigInt (no blinding) leaks the private exponent through timing; teaching code only, never use with real secrets (see legacy_crypto/README.md "Known limitations").
'use strict';

/*
 * RSA-2048 with OAEP-SHA256 padding, implemented from scratch.
 *
 * The big picture
 * ─────────────────────────────────────────────────────────────────────────────
 * RSA is built in two layers, and it is essential to understand both:
 *
 *   1. RAW RSA is a number-theoretic primitive. Given a modulus n and a
 *      pair of integer exponents (e, d) chosen so that e*d ≡ 1 modulo a
 *      certain "totient" function of n, the operations
 *           encrypt(m) = m^e mod n
 *           decrypt(c) = c^d mod n
 *      are inverses of each other. That's it. It's just modular
 *      exponentiation.
 *
 *   2. Raw RSA is INSECURE on its own. It's deterministic (the same
 *      message always encrypts to the same ciphertext, leaking equality),
 *      malleable (encrypt(m1) * encrypt(m2) = encrypt(m1*m2)), and leaks
 *      huge amounts of information about small messages (encrypt(0) = 0,
 *      encrypt(1) = 1, etc.). Any RSA system you'd actually deploy wraps
 *      raw RSA in a padding scheme. The modern standard is OAEP (Optimal
 *      Asymmetric Encryption Padding), specified in PKCS#1 v2 / RFC 8017.
 *
 * The math at a glance
 * ─────────────────────────────────────────────────────────────────────────────
 *   - Pick two large random primes p, q (1024 bits each for RSA-2048).
 *   - n = p * q is the public modulus (2048 bits).
 *   - e = 65537 is the public exponent.
 *   - λ(n) = lcm(p-1, q-1) is Carmichael's totient. d = e^(-1) mod λ(n).
 *   - Public key:  (n, e). Private key: (n, d), or sometimes (n, d, p, q).
 *
 * The security rests on the difficulty of factoring n. Anyone who could
 * factor n could compute d from e and recover the private key. With current
 * algorithms (general number field sieve), 2048-bit n is infeasible to
 * factor on classical hardware.
 *
 * Why 65537 specifically
 * ─────────────────────────────────────────────────────────────────────────────
 * 65537 = 2^16 + 1 is the F4 Fermat prime. It is universally chosen for
 * RSA's public exponent because:
 *   - It's prime, so it can't share factors with λ(n) for any reasonable
 *     prime pair (we still verify this and re-roll if it ever happens).
 *   - In binary it is 10000000000000001 — only TWO bits set. That makes
 *     m^e fast: m^65537 = ((((((((m^2)^2)^2)^2)^2)^2)^2)^2)^...^2 * m
 *     = 16 squarings plus one multiplication.
 *   - It's larger than 3, avoiding the Håstad small-exponent broadcast
 *     attack. e=3 has historical issues; e=65537 is comfortably large
 *     while still being a fast public-key operation.
 *
 * Why we use Carmichael's λ(n) instead of Euler's φ(n)
 * ─────────────────────────────────────────────────────────────────────────────
 * φ(n) = (p-1)(q-1) is what the original RSA paper used. Carmichael's
 * λ(n) = lcm(p-1, q-1) divides φ(n), so any d valid for one is valid for
 * the other. Using λ produces the SMALLEST valid private exponent, which
 * is marginally faster to use and is what NIST FIPS 186-4 prescribes.
 * Both are correct; we follow modern practice.
 *
 * Manger's attack: why uniform OAEP errors are mandatory
 * ─────────────────────────────────────────────────────────────────────────────
 * Two classic padding-oracle attacks, one per RSA padding scheme:
 *   - Bleichenbacher (CRYPTO 1998) attacks PKCS#1 v1.5 encryption padding:
 *     a server that reveals whether a ciphertext decrypts to something
 *     starting 0x00 0x02 lets an attacker decrypt any ciphertext with on
 *     the order of a million adaptive queries.
 *   - Manger (CRYPTO 2001) attacks OAEP itself (PKCS#1 v2): if an
 *     implementation lets an attacker tell "the leading byte Y was not
 *     0x00" apart from the other decoding failures (lHash mismatch,
 *     missing 0x01 separator) — via different error messages or timing —
 *     the attacker can recover the plaintext of a target ciphertext in a
 *     little over log2(n) oracle queries, i.e. about as many queries as n
 *     has bits. (It recovers the plaintext, not the private key.)
 *
 * OAEP itself is provably IND-CCA2 secure, but only under the assumption
 * that the implementation never reveals which step of decoding failed.
 * Verbose error messages like "lHash mismatch" or "missing 0x01 separator"
 * undo the proof. Our `oaepDecode` accumulates every structural failure
 * into a single boolean and throws ONE generic 'OAEP decoding error' at
 * the end of decoding, regardless of which check tripped.
 *
 * (Going one step further to constant-time decoding is non-trivial in
 * pure JavaScript and outside the scope of this amateur-readable
 * implementation. The uniform error message is the load-bearing defense
 * against the original Manger attack.)
 *
 * Performance note
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure-BigInt RSA in JavaScript is slow compared with OpenSSL. Measured
 * figures (Intel i9-11900H, Node 24.16, Windows 11, 2026-10-20; your
 * machine will differ):
 *   - Key generation (2048-bit): 0.13–0.82 s, median 0.30 s over 50 runs.
 *     The spread comes from how many random candidates are rejected
 *     before two primes pass Miller-Rabin.
 *   - OAEP encryption: ~0.2 ms (e=65537 needs only 17 multiplications).
 *   - OAEP decryption: ~10 ms (d is ~2048 bits: ~2048 squarings plus
 *     ~1024 multiplications, and no CRT).
 *
 * That's fine for a per-request workload but unacceptable for a
 * high-throughput server. Production systems use Node's `crypto` module,
 * which calls into OpenSSL's C/assembly RSA — orders of magnitude faster.
 * (We'd also typically use the Chinese Remainder Theorem to speed up
 * private-key operations 3–4× by working modulo p and q separately. We
 * skip CRT here for amateur readability.)
 *
 * Allowed dependencies
 * ─────────────────────────────────────────────────────────────────────────────
 *   ./sha256          — used only by OAEP's MGF1 mask generation
 *   crypto.randomBytes — entropy for prime generation, OAEP seed,
 *                        Miller-Rabin witnesses
 */

const { sha256 } = require('./sha256');
const crypto     = require('crypto');   // randomBytes only

// SHA-256 digest length in bytes. Used everywhere OAEP needs hLen.
const HLEN = 32;


// ═════════════════════════════════════════════════════════════════════════════
//  PART A — BigInt math helpers
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Interpret a big-endian Buffer as an unsigned BigInt.
 *
 *   bigIntFromBuffer(Buffer.from([0x01, 0x02])) === 0x0102n
 *
 * This is the bridge from the byte-level world (where RSA messages live)
 * into the math world (where modular exponentiation operates).
 */
function bigIntFromBuffer(buf) {
    if (!Buffer.isBuffer(buf)) {
        throw new TypeError('bigIntFromBuffer: input must be a Buffer');
    }
    let n = 0n;
    for (let i = 0; i < buf.length; i++) {
        n = (n << 8n) | BigInt(buf[i]);
    }
    return n;
}

/**
 * Encode an unsigned BigInt as a fixed-size big-endian Buffer.
 *
 * Pads with leading zeros to reach `byteLength`. Throws if the value is
 * too large to fit in that many bytes — RSA needs the ciphertext to be
 * exactly k bytes (k = byte length of n) so this fixed-width encoding
 * matters; a short Buffer would be misinterpreted by callers.
 */
function bigIntToBuffer(n, byteLength) {
    if (typeof n !== 'bigint') throw new TypeError('bigIntToBuffer: n must be a BigInt');
    if (n < 0n) throw new RangeError('bigIntToBuffer: n must be non-negative');

    const out = Buffer.alloc(byteLength);
    let temp = n;
    for (let i = byteLength - 1; i >= 0; i--) {
        out[i] = Number(temp & 0xffn);
        temp >>= 8n;
    }
    if (temp !== 0n) {
        throw new RangeError(`bigIntToBuffer: BigInt does not fit in ${byteLength} bytes`);
    }
    return out;
}

/**
 * Modular exponentiation: returns base^exponent mod modulus.
 *
 * Implementation: square-and-multiply (also called "binary exponentiation").
 * We walk the bits of the exponent from low to high. At each step:
 *   - If the current bit is 1, multiply the running result by the current
 *     squared base.
 *   - Square the base for the next iteration.
 *
 * This is THE workhorse routine of every RSA operation: encrypt, decrypt,
 * key generation, primality test — all are one or more modPow calls.
 *
 * Cost: O(log₂(exponent)) modular multiplications. For RSA-2048 decrypt
 * that's about 2048 multiplications of 2048-bit numbers.
 */
function modPow(base, exponent, modulus) {
    if (modulus === 1n) return 0n;
    if (exponent < 0n) throw new RangeError('modPow: negative exponent');

    let result = 1n;
    let b = base % modulus;
    if (b < 0n) b += modulus;            // normalize negative inputs
    let e = exponent;

    while (e > 0n) {
        if (e & 1n) result = (result * b) % modulus;
        e >>= 1n;
        b = (b * b) % modulus;
    }
    return result;
}

/**
 * Greatest common divisor by Euclidean algorithm. Used as a sanity check
 * during key generation: gcd(e, λ(n)) must be 1 for d to exist.
 */
function gcd(a, b) {
    while (b !== 0n) {
        [a, b] = [b, a % b];
    }
    return a;
}

/**
 * Least common multiple, derived from gcd.
 *
 * lcm is used to compute Carmichael's totient λ(n) = lcm(p-1, q-1) during
 * key generation.
 */
function lcm(a, b) {
    return (a * b) / gcd(a, b);
}

/**
 * Modular inverse: returns x such that (a * x) mod m === 1, or throws if
 * no inverse exists (which means gcd(a, m) !== 1).
 *
 * Implementation: extended Euclidean algorithm. We track the gcd as a
 * linear combination of the original inputs, and read off the
 * multiplicative inverse from the coefficients at the end.
 *
 * Used during key generation to compute d from e and λ(n):
 *   d = e^(-1) mod λ(n).
 */
function modInverse(a, m) {
    let [oldR, r] = [a % m, m];
    if (oldR < 0n) oldR += m;

    let [oldS, s] = [1n, 0n];

    while (r !== 0n) {
        const q = oldR / r;
        [oldR, r] = [r, oldR - q * r];
        [oldS, s] = [s, oldS - q * s];
    }

    if (oldR !== 1n) {
        throw new Error('modInverse: no inverse exists (inputs are not coprime)');
    }

    // oldS may be negative; bring it into [0, m).
    return ((oldS % m) + m) % m;
}

/**
 * Generate a random BigInt with EXACTLY `bits` bits — i.e., the high bit
 * is forced on, so the result is in [2^(bits-1), 2^bits - 1].
 *
 * Used as the starting candidate for prime generation. Forcing the high
 * bit ensures the prime has the requested length (and therefore that the
 * RSA modulus n = p*q has the requested length once we also force the
 * second-highest bit — see generatePrime).
 */
function randomBigIntBits(bits) {
    const byteLength = Math.ceil(bits / 8);
    const buf        = crypto.randomBytes(byteLength);
    const topZeros   = byteLength * 8 - bits;       // unused high bits in buf[0]

    // Mask off any bits above position (bits - 1) and force-set the bit at
    // position (bits - 1). For bits = 1024 (multiple of 8), topZeros is 0
    // and this reduces to `buf[0] |= 0x80`.
    buf[0] &= (0xff >>> topZeros);
    buf[0] |= (1 << (7 - topZeros));

    return bigIntFromBuffer(buf);
}

/**
 * Generate a uniformly random BigInt in [0, max).
 *
 * Used to pick Miller-Rabin witnesses. Implementation: rejection sampling
 * — draw a random number with the same bit-length as `max - 1`, retry if
 * it lands above `max`. Expected number of attempts is ~2.
 */
function randomBigIntInRange(max) {
    if (max <= 0n) throw new RangeError('randomBigIntInRange: max must be positive');

    const bits = max.toString(2).length;       // bit-length of max - 1 fits inside this
    while (true) {
        const byteLength = Math.ceil(bits / 8);
        const buf        = crypto.randomBytes(byteLength);
        const topZeros   = byteLength * 8 - bits;
        buf[0] &= (0xff >>> topZeros);
        const candidate = bigIntFromBuffer(buf);
        if (candidate < max) return candidate;
    }
}


// ═════════════════════════════════════════════════════════════════════════════
//  PART B — Primality testing and prime generation
// ═════════════════════════════════════════════════════════════════════════════

/*
 * SMALL_PRIMES is a precomputed list of primes up to 257. Trial-dividing a
 * candidate by these BEFORE running Miller-Rabin is a huge speedup: most
 * random odd numbers are divisible by some small prime, so the trial
 * filter eliminates the vast majority of candidates cheaply.
 */
const SMALL_PRIMES = [
      3n,   5n,   7n,  11n,  13n,  17n,  19n,  23n,  29n,  31n,  37n,  41n,
     43n,  47n,  53n,  59n,  61n,  67n,  71n,  73n,  79n,  83n,  89n,  97n,
    101n, 103n, 107n, 109n, 113n, 127n, 131n, 137n, 139n, 149n, 151n, 157n,
    163n, 167n, 173n, 179n, 181n, 191n, 193n, 197n, 199n, 211n, 223n, 227n,
    229n, 233n, 239n, 241n, 251n, 257n
];

/**
 * Trial-division filter. Returns false if `n` is divisible by any small
 * prime (and is therefore composite, unless n is itself that prime).
 */
function passesSmallPrimeFilter(n) {
    for (const p of SMALL_PRIMES) {
        if (n === p) return true;
        if (n % p === 0n) return false;
    }
    return true;
}

/**
 * Miller-Rabin probabilistic primality test.
 *
 * Returns true if `n` is "probably prime" with false-positive probability
 * at most 4^(-k). For k = 40 (our default) the failure probability is
 * about 10^(-24) — astronomically smaller than the chance of a hardware
 * RAM bit flip during the test itself.
 *
 * Algorithm:
 *   1. Write n - 1 = 2^s * d  with d odd.
 *   2. For k random witnesses a in [2, n-2]:
 *        - x = a^d mod n
 *        - If x is 1 or n-1, this witness "passes" — try the next one.
 *        - Otherwise, square x up to s-1 times. If x ever reaches n-1,
 *          the witness passes. If we reach the end without seeing n-1,
 *          n is definitely composite.
 *   3. If all k witnesses pass, n is "probably prime".
 */
function millerRabinTest(n, k = 40) {
    if (n < 2n)          return false;
    if (n === 2n)        return true;
    if (n === 3n)        return true;
    if (n % 2n === 0n)   return false;

    // Decompose n - 1 = 2^s * d  with d odd.
    let s = 0n;
    let d = n - 1n;
    while ((d & 1n) === 0n) {
        d >>= 1n;
        s++;
    }

    const nMinus1 = n - 1n;
    const range   = n - 3n;            // for picking a random witness in [2, n-2]

    for (let i = 0; i < k; i++) {
        // Random witness a in [2, n-2] = [0, n-3) + 2
        const a = 2n + randomBigIntInRange(range);

        let x = modPow(a, d, n);
        if (x === 1n || x === nMinus1) continue;     // witness passes

        let composite = true;
        for (let r = 1n; r < s; r++) {
            x = (x * x) % n;
            if (x === nMinus1) {
                composite = false;
                break;
            }
        }
        if (composite) return false;
    }
    return true;
}

/**
 * Generate a random prime of exactly `bits` bits.
 *
 * The two top bits of every candidate are forced on:
 *   - top bit (bit `bits-1`)  — guarantees the prime has full bit length
 *   - second bit (bit `bits-2`) — guarantees that p * q has full 2*bits
 *     bit length (otherwise the product could have 2*bits - 1 bits)
 *
 * The low bit is also forced on (every prime above 2 is odd).
 *
 * No deterministic time bound — the loop randomly picks candidates until
 * one passes Miller-Rabin. Expected number of attempts is roughly
 * `bits` / ln(2) ≈ `bits` / 0.7. Most attempts fail the cheap small-prime
 * filter; only a few percent reach Miller-Rabin.
 */
function generatePrime(bits) {
    if (!Number.isInteger(bits) || bits < 16) {
        throw new RangeError('generatePrime: bits must be an integer ≥ 16');
    }
    while (true) {
        let candidate = randomBigIntBits(bits);
        candidate |= 1n;                              // force odd
        candidate |= (1n << BigInt(bits - 2));        // force second-highest bit on

        if (!passesSmallPrimeFilter(candidate)) continue;
        if (!millerRabinTest(candidate, 40))    continue;

        return candidate;
    }
}


// ═════════════════════════════════════════════════════════════════════════════
//  PART C — RSA key generation, raw encrypt, raw decrypt
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Generate a fresh RSA keypair.
 *
 * Steps:
 *   1. Generate two distinct primes p, q of `bits/2` bits each.
 *   2. n = p * q.
 *   3. e = 65537 (the standard public exponent).
 *   4. λ(n) = lcm(p-1, q-1).
 *   5. d = e^(-1) mod λ(n).
 *   6. If gcd(e, λ(n)) ≠ 1 (rare — would mean (p-1) or (q-1) is divisible
 *      by 65537), reroll.
 *
 * Returns { n, e, d, p, q }. Note that p and q are part of the *private*
 * key — do not export them with the public key.
 */
function generateRSAKeyPair(bits = 2048) {
    if (!Number.isInteger(bits) || bits % 2 !== 0 || bits < 512) {
        throw new RangeError('generateRSAKeyPair: bits must be an even integer ≥ 512');
    }
    const halfBits = bits / 2;
    const e        = 65537n;

    while (true) {
        const p = generatePrime(halfBits);
        let q;
        do {
            q = generatePrime(halfBits);
        } while (q === p);

        const n = p * q;
        // Belt-and-braces: even with both top two bits forced on, double-check
        // n really is `bits` bits long.
        if (n.toString(2).length !== bits) continue;

        const lambda = lcm(p - 1n, q - 1n);
        if (gcd(e, lambda) !== 1n) continue;          // extremely rare; reroll

        const d = modInverse(e, lambda);
        return { n, e, d, p, q };
    }
}

/**
 * Raw RSA encryption: returns m^e mod n.
 *
 * @param {bigint}  message    — must be in [0, n)
 * @param {object}  publicKey  — { n, e }
 */
function rsaEncryptRaw(message, publicKey) {
    if (typeof message !== 'bigint') throw new TypeError('rsaEncryptRaw: message must be BigInt');
    if (message < 0n || message >= publicKey.n) {
        throw new RangeError('rsaEncryptRaw: message out of range [0, n)');
    }
    return modPow(message, publicKey.e, publicKey.n);
}

/**
 * Raw RSA decryption: returns c^d mod n.
 *
 * @param {bigint}  ciphertext — must be in [0, n)
 * @param {object}  privateKey — { n, d }
 */
function rsaDecryptRaw(ciphertext, privateKey) {
    if (typeof ciphertext !== 'bigint') throw new TypeError('rsaDecryptRaw: ciphertext must be BigInt');
    if (ciphertext < 0n || ciphertext >= privateKey.n) {
        throw new RangeError('rsaDecryptRaw: ciphertext out of range [0, n)');
    }
    return modPow(ciphertext, privateKey.d, privateKey.n);
}


// ═════════════════════════════════════════════════════════════════════════════
//  PART D — OAEP padding (RFC 8017 §7.1)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * MGF1 — Mask Generation Function 1, the "extend a seed into a longer
 * pseudo-random stream" function used by OAEP.
 *
 * Conceptually MGF1 is a stream cipher built out of a hash:
 *
 *     mask = sha256(seed || 0) || sha256(seed || 1) || sha256(seed || 2) || ...
 *
 * where each counter is a 4-byte big-endian integer. Concatenate enough
 * blocks to cover `length` bytes, then truncate.
 *
 * OAEP uses MGF1 twice per encrypt and twice per decrypt: once to mask
 * the data block (using the random seed as the key), and once to mask the
 * seed itself (using the masked data block as the key). The double-mask
 * scheme is what makes OAEP indistinguishable.
 */
function mgf1(seed, length) {
    const numBlocks = Math.ceil(length / HLEN);
    const blocks    = [];

    for (let i = 0; i < numBlocks; i++) {
        const counter = Buffer.alloc(4);
        counter.writeUInt32BE(i, 0);
        blocks.push(sha256(Buffer.concat([seed, counter])));
    }

    return Buffer.concat(blocks).subarray(0, length);
}

/**
 * OAEP encoding (RFC 8017 §7.1.1).
 *
 * Produces a `k`-byte encoded message ready to be interpreted as a BigInt
 * and fed to raw RSA encryption. The structure of the output is:
 *
 *     EM = 0x00 || maskedSeed || maskedDB
 *          (1)     (hLen)        (k - hLen - 1)
 *
 * where the data block DB before masking is:
 *
 *     DB = lHash || PS || 0x01 || message
 *          (hLen)  (k - mLen - 2*hLen - 2)
 *
 * lHash is sha256(label) — we don't use labels, so it's sha256("") (a
 * fixed 32-byte constant). PS is a stretch of zero bytes; the 0x01
 * separator marks the boundary between PS and the actual message.
 *
 * The seed is 32 fresh random bytes (one OAEP encryption per call has a
 * different seed, so the same plaintext + same key produces different
 * ciphertext every time — non-determinism is a feature, not a bug).
 *
 * @param {Buffer|string} message — at most k - 2*hLen - 2 bytes
 * @param {number}        k       — byte length of the modulus (256 for RSA-2048)
 */
function oaepEncode(message, k) {
    const messageBuf = Buffer.isBuffer(message) ? message : Buffer.from(message, 'utf8');
    const mLen       = messageBuf.length;
    const maxMLen    = k - 2 * HLEN - 2;

    if (mLen > maxMLen) {
        throw new Error(`OAEP: message too long (${mLen} bytes; max is ${maxMLen} for k=${k})`);
    }

    // lHash = sha256(empty label) — fixed 32 bytes
    const lHash = sha256(Buffer.alloc(0));

    // Pad string PS: enough zero bytes to fill out the data block
    const psLen = k - mLen - 2 * HLEN - 2;
    const ps    = Buffer.alloc(psLen);                 // zero-filled

    // Data block: lHash || PS || 0x01 || message
    const db = Buffer.concat([lHash, ps, Buffer.from([0x01]), messageBuf]);
    // db.length is exactly k - hLen - 1

    // Random seed for this encryption.
    const seed = crypto.randomBytes(HLEN);

    // Mask the data block with MGF1(seed, k - hLen - 1)
    const dbMask   = mgf1(seed, k - HLEN - 1);
    const maskedDB = Buffer.alloc(db.length);
    for (let i = 0; i < db.length; i++) maskedDB[i] = db[i] ^ dbMask[i];

    // Mask the seed with MGF1(maskedDB, hLen)
    const seedMask   = mgf1(maskedDB, HLEN);
    const maskedSeed = Buffer.alloc(HLEN);
    for (let i = 0; i < HLEN; i++) maskedSeed[i] = seed[i] ^ seedMask[i];

    // EM = 0x00 || maskedSeed || maskedDB
    return Buffer.concat([Buffer.from([0x00]), maskedSeed, maskedDB]);
}

/**
 * OAEP decoding (RFC 8017 §7.1.2). Reverses oaepEncode.
 *
 * Steps (and the corresponding structural checks):
 *   1. Split EM into Y || maskedSeed || maskedDB.
 *      Y must be 0x00.
 *   2. seed = maskedSeed XOR MGF1(maskedDB, hLen)
 *   3. DB   = maskedDB   XOR MGF1(seed,     k - hLen - 1)
 *   4. Verify the lHash prefix matches sha256("").
 *   5. Skip the zero PS bytes; the next byte must be 0x01.
 *   6. Everything after that 0x01 is the original message.
 *
 * SECURITY: every structural check accumulates into a single boolean. A
 * single uniform 'OAEP decoding error' is thrown at the end if any check
 * failed. Verbose error messages enable Manger's attack — see the file
 * header for context.
 */
function oaepDecode(em, k) {
    // We can't bail out specifically here either (length leaks), but a
    // wrong-length input is a programmer error, not a ciphertext attack
    // vector — those tests live above this function.
    if (em.length !== k) throw new Error('OAEP decoding error');
    if (k < 2 * HLEN + 2) throw new Error('OAEP decoding error');

    // 1. Split.
    const Y          = em[0];
    const maskedSeed = em.subarray(1, 1 + HLEN);
    const maskedDB   = em.subarray(1 + HLEN);

    // 2. Recover the seed.
    const seedMask = mgf1(maskedDB, HLEN);
    const seed     = Buffer.alloc(HLEN);
    for (let i = 0; i < HLEN; i++) seed[i] = maskedSeed[i] ^ seedMask[i];

    // 3. Recover DB.
    const dbMask = mgf1(seed, k - HLEN - 1);
    const db     = Buffer.alloc(maskedDB.length);
    for (let i = 0; i < maskedDB.length; i++) db[i] = maskedDB[i] ^ dbMask[i];

    // 4. Walk DB and accumulate validity flags. We deliberately do NOT
    //    early-exit on a failure: doing so would let an attacker time the
    //    response to learn which check failed.
    const expectedLHash = sha256(Buffer.alloc(0));

    let valid = (Y === 0x00);
    for (let i = 0; i < HLEN; i++) {
        if (db[i] !== expectedLHash[i]) valid = false;
    }

    // 5. Find the 0x01 separator after the lHash + PS region.
    let separatorIndex = -1;
    let foundNonZero   = false;
    for (let i = HLEN; i < db.length; i++) {
        if (separatorIndex < 0) {
            if (db[i] === 0x01) {
                separatorIndex = i;
            } else if (db[i] !== 0x00) {
                // A non-zero, non-0x01 byte before the separator means the
                // padding is invalid. We mark the structure invalid but
                // keep scanning to avoid timing variability.
                foundNonZero = true;
            }
        }
    }
    if (separatorIndex < 0 || foundNonZero) valid = false;

    if (!valid) throw new Error('OAEP decoding error');

    // 6. Return everything after the separator byte.
    return Buffer.from(db.subarray(separatorIndex + 1));
}


/**
 * Helper: byte length of a BigInt's modulus.
 */
function bigIntByteLength(n) {
    return Math.ceil(n.toString(2).length / 8);
}


/**
 * Encrypt a message under (n, e) with OAEP-SHA256 padding.
 *
 * @param {Buffer|string} message
 * @param {object}        publicKey  — { n, e }
 * @returns {Buffer} ciphertext, exactly k bytes (256 for RSA-2048)
 */
function rsaEncryptOAEP(message, publicKey) {
    const k  = bigIntByteLength(publicKey.n);
    const em = oaepEncode(message, k);
    const m  = bigIntFromBuffer(em);
    const c  = rsaEncryptRaw(m, publicKey);
    return bigIntToBuffer(c, k);
}

/**
 * Decrypt an OAEP-SHA256 ciphertext under (n, d). Throws a uniform
 * 'OAEP decoding error' on any structural failure.
 *
 * @param {Buffer} ciphertext
 * @param {object} privateKey — { n, d }
 * @returns {Buffer} plaintext
 */
function rsaDecryptOAEP(ciphertext, privateKey) {
    if (!Buffer.isBuffer(ciphertext)) {
        throw new TypeError('rsaDecryptOAEP: ciphertext must be a Buffer');
    }
    const k = bigIntByteLength(privateKey.n);
    if (ciphertext.length !== k) throw new Error('OAEP decoding error');

    const c  = bigIntFromBuffer(ciphertext);
    // RFC 8017 §7.1.2 step 2b: a ciphertext representative outside [0, n)
    // is reported as the same "decryption error" as every other failure,
    // not as rsaDecryptRaw's distinguishable RangeError.
    if (c >= privateKey.n) throw new Error('OAEP decoding error');
    const m  = rsaDecryptRaw(c, privateKey);
    const em = bigIntToBuffer(m, k);
    return oaepDecode(em, k);
}


module.exports = {
    bigIntFromBuffer,
    bigIntToBuffer,
    modPow,
    modInverse,
    gcd,
    millerRabinTest,
    generatePrime,
    generateRSAKeyPair,
    rsaEncryptRaw,
    rsaDecryptRaw,
    rsaEncryptOAEP,
    rsaDecryptOAEP
};


// ─────────────────────────────────────────────────────────────────────────────
// Self-test — runs only when this file is executed directly:
//   node rsa.js
//
// Tests 1–4 are fast (small numbers, no key generation). Test 5 generates
// a real 2048-bit keypair and runs an OAEP round-trip — the slowest part,
// typically well under a second (0.13–0.82 s measured; see the
// performance note in the file header). Tests 6–7 reuse the keypair from
// Test 5. Tests 8–9 decrypt Project Wycheproof vectors with Wycheproof's
// own fixed key.
// ─────────────────────────────────────────────────────────────────────────────
if (require.main === module) {
    let allPass = true;

    function record(name, pass, detail) {
        if (!pass) allPass = false;
        console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
        if (!pass && detail) console.log(`        ${detail}`);
    }

    // ── Test 1: modPow correctness ──────────────────────────────────────
    {
        const got      = modPow(7n, 13n, 19n);
        const expected = (7n ** 13n) % 19n;
        record('Test 1: modPow(7, 13, 19)', got === expected,
            `got=${got} expected=${expected}`);
    }

    // ── Test 2: modInverse correctness ──────────────────────────────────
    {
        const inv  = modInverse(3n, 11n);
        const back = (3n * inv) % 11n;
        record('Test 2: modInverse(3, 11) = 4 and (3*4) mod 11 = 1',
            inv === 4n && back === 1n,
            `inv=${inv} back=${back}`);
    }

    // ── Test 3: Miller-Rabin sanity ─────────────────────────────────────
    {
        const cases = [
            { n:       2n, expected: true,  label: '2'       },
            { n:       3n, expected: true,  label: '3'       },
            { n:    7919n, expected: true,  label: '7919'    },
            { n: 1000003n, expected: true,  label: '1000003' },
            { n:      15n, expected: false, label: '15'      },
            { n:    7920n, expected: false, label: '7920'    },
        ];

        let allOk = true;
        const detail = [];
        for (const { n, expected, label } of cases) {
            const got = millerRabinTest(n, 40);
            if (got !== expected) {
                allOk = false;
                detail.push(`${label}: expected ${expected}, got ${got}`);
            }
        }
        record('Test 3: Miller-Rabin on 6 known primes/composites', allOk, detail.join('; '));
    }

    // ── Test 4: textbook RSA round-trip with small (n, e, d) ────────────
    {
        // Classical textbook RSA: p=61, q=53, n=3233, φ(n)=3120, e=17, d=2753
        const pubKey  = { n: 3233n, e: 17n   };
        const privKey = { n: 3233n, d: 2753n };
        const m       = 65n;

        const c       = rsaEncryptRaw(m, pubKey);
        const decrypt = rsaDecryptRaw(c, privKey);

        record('Test 4: textbook RSA round-trip (m=65, n=3233, e=17, d=2753)',
            c === 2790n && decrypt === 65n,
            `ciphertext=${c} (expect 2790), decrypt=${decrypt} (expect 65)`);
    }

    // ── Test 5: full RSA-2048 OAEP round-trip (SLOW) ────────────────────
    let keys = null;
    {
        process.stdout.write('  generating RSA-2048 keypair (typically under 1 second)... ');
        const t0 = Date.now();
        keys     = generateRSAKeyPair(2048);
        const ms = Date.now() - t0;
        console.log(`done in ${(ms / 1000).toFixed(1)}s`);

        const pubKey  = { n: keys.n, e: keys.e };
        const privKey = { n: keys.n, d: keys.d };

        const message = 'hello world';
        const ct1     = rsaEncryptOAEP(message, pubKey);
        const ct2     = rsaEncryptOAEP(message, pubKey);
        const pt      = rsaDecryptOAEP(ct1, privKey);

        const lengthOk        = ct1.length === 256;
        const decryptOk       = pt.toString('utf8') === message;
        const nonDeterministic = Buffer.compare(ct1, ct2) !== 0;

        record('Test 5: RSA-2048 OAEP round-trip (length, content, non-determinism)',
            lengthOk && decryptOk && nonDeterministic,
            `ctLen=${ct1.length} decrypted="${pt.toString('utf8')}" nonDet=${nonDeterministic}`);
    }

    // ── Test 6: OAEP rejects a tampered ciphertext ──────────────────────
    {
        const pubKey  = { n: keys.n, e: keys.e };
        const privKey = { n: keys.n, d: keys.d };

        const ct = rsaEncryptOAEP('hello world', pubKey);

        // Flip a single bit in the middle of the ciphertext.
        const tampered = Buffer.from(ct);
        tampered[128] ^= 0x01;

        let threw = false, msg = '';
        try { rsaDecryptOAEP(tampered, privKey); }
        catch (e) { threw = true; msg = e.message; }

        record('Test 6: tampered OAEP ciphertext rejected with uniform error',
            threw && msg === 'OAEP decoding error',
            `threw=${threw} msg="${msg}"`);
    }

    // ── Test 7: OAEP rejects an oversized message ───────────────────────
    {
        const pubKey = { n: keys.n, e: keys.e };

        // Max for RSA-2048 OAEP-SHA256: 256 - 2*32 - 2 = 190 bytes.
        // Pass 200 bytes — must throw.
        let threw = false, msg = '';
        try { rsaEncryptOAEP(Buffer.alloc(200), pubKey); }
        catch (e) { threw = true; msg = e.message; }

        record('Test 7: oversized message (200 bytes) rejected by OAEP',
            threw && /too long/i.test(msg),
            `threw=${threw} msg="${msg}"`);
    }

    // ── Project Wycheproof RSA-OAEP vectors ─────────────────────────────
    // Source: https://raw.githubusercontent.com/C2SP/wycheproof/main/testvectors_v1/rsa_oaep_2048_sha256_mgf1sha256_test.json
    // (Project Wycheproof, C2SP; file SHA-256 83dce701e3d8640ac56e6d7bf37a5a8f9bd6a336e1e932a1e9bfe4ba9c5ea3a9;
    //  "algorithm": "RSAES-OAEP", "numberOfTests": 37; testGroups[0]: keySize 2048,
    //  sha SHA-256, mgf MGF1, mgfSha SHA-256).
    // Subset: valid tcIds [1, 3, 7, 11, 21, 22], invalid tcIds [12, 13, 17, 19, 23, 24, 26, 27, 28, 29, 32] — all with an empty
    // label, since this lab's OAEP has no label parameter. Generated by script from
    // the downloaded JSON: privateKey.modulus / publicExponent / privateExponent and
    // tests[].{tcId, result, flags, comment, msg, ct} are copied verbatim.
    const WYCHEPROOF_OAEP = {
        n: '00a2b451a07d0aa5f96e455671513550514a8a5b462ebef717094fa1fee82224' +
           'e637f9746d3f7cafd31878d80325b6ef5a1700f65903b469429e89d6eac88450' +
           '97b5ab393189db92512ed8a7711a1253facd20f79c15e8247f3d3e42e46e48c9' +
           '8e254a2fe9765313a03eff8f17e1a029397a1fa26a8dce26f490ed81299615d9' +
           '814c22da610428e09c7d9658594266f5c021d0fceca08d945a12be82de4d1ece' +
           '6b4c03145b5d3495d4ed5411eb878daf05fd7afc3e09ada0f1126422f590975a' +
           '1969816f48698bcbba1b4d9cae79d460d8f9f85e7975005d9bc22c4e5ac0f7c1' +
           'a45d12569a62807d3b9a02e5a530e773066f453d1f5b4c2e9cf7820283f742b9' +
           'd5',
        e: '010001',
        d: '24cdc62317f5d72a6f6ba6cc9632899b01d1ff28867d72f61688995bc855a4e4' +
           '20a8405250089bdb13cf8e09543827b748b9d27fbb2b4d9e20af8c5a6a862796' +
           'd1a4cc18ad16ea678bc1bd4a83bbbe9c5e57453b5ce7388e41a3ba4ce2b77b44' +
           '38a229e954f720dae0353dc088ac8a76b26dc276f8e1b7851ddd6398ad16ff2e' +
           '78195123b9b036e945c38c9d12434f6df76fe22359eb3e1ac9c011678fc926fa' +
           'd3ae475a4fffff55feb2d147e9c894f4c0e29a599e762462482d968bf4278094' +
           '5fc0d2c31c573c4431b8f4fe8b8c67bec815abd44f7a86edca1c2308737358d2' +
           'c2ae5e2e0e2dadf730980262377e58b13b7d9992060a0bc870ccfdb4a9319ee1',
        tests: [
            {
                tcId: 1, result: 'valid', flags: ["Normal"],
                comment: "",
                msg: '',
                ct: '6e62bf24d95aff6868afec2a92a445b6458f16f688c19fe1212f66a631378316' +
                    '53cedd359d8cff4dd485d77dfd55812c181373201f54aafd65730d2a304e6234' +
                    '55d51125d891e65d97fce52341cae45fb64c38a384a1c621e2713ee6794633f0' +
                    '29a9fd4d774f56551eac2176162e162640f25eab873a3451c475570f19228bce' +
                    'de4c67c370a75ed7fabccd538c9819eff182481b10d42f1a9f6a05373b8cf9b7' +
                    '1818d467bd3b8ebacb619e8ad42916e600c043effceb3855bc48a629e60ae886' +
                    'f51b2a7876b0e623fb2ce68af4b039242f963adb0e4240aed0ed07f65f1ee7c0' +
                    'cc77d210d0c2d1dc10c81b881aa0c9c9e9499665cf2970d2ccfeeb3191531765'
            },
            {
                tcId: 3, result: 'valid', flags: ["Normal"],
                comment: "",
                msg: '54657374',
                ct: '5eab3f0741e63986ed647d53e1cd71df041986900803d0f99c68355d249a15a4' +
                    '7dc5b4f70a191477654299e5a2731f3b4eec76dea18262fc696ac794e5f66cbf' +
                    'cddac4472c578e246c26707598055584540b839836b1404c5611ae558a984cee' +
                    '8fd036cea924e0be2474a940f61e0acc14fcae95ebdc59942a9ce9af9a9c8199' +
                    '9f7f6815f057ffdc2533cb15d6391d1e2d95f16f9c04209c889a4c359c7d2926' +
                    'd28a66e2b030a416b928d2825627998e5191fb4983a6e65024262d94fc09187a' +
                    '2d78162122433251d1bfcc8e507d06eba2d229c10031261da32ab8ccd15f1c5f' +
                    '9fbf07ed158483d736a110af4b44d6a4da60d6cb519b4454213cf9f0dc560f2b'
            },
            {
                tcId: 7, result: 'valid', flags: ["Normal"],
                comment: "",
                msg: 'e0e1e2e3e4e5e6e7e8e9eaebecedeeeff0f1f2f3f4f5f6f7f8f9fafbfcfdfeff',
                ct: '096958786ee7972050d67a9e4b69d6c6af7db7cc674386df725770dd29129b82' +
                    '6e39552330104c8d71e6cc3a3014dd2f61b54153af51b0438d447ee939f9e3c1' +
                    '3bb8b00a37dea6a068f6c9d27e848b1be7a1eeeb3ee50b78036fba95ae46948c' +
                    'a5b13f356ea24db10f60dc09e4b8bad8f766b668ef72524432080a0ce00ed676' +
                    'd6d5e354984b1078520412525848156d06f0652469f95791baa3d9a798ae5370' +
                    '94f76f976faecd5c9ce0c930a75910c63dacf63485cb4b5e7bdbcf4d80e74037' +
                    'eaa1a8fe4b52930bec6be99cf6ac88cf5878dbf6859d456a95dbc34654eec425' +
                    'de84ca2a535d517403a9aada827e7d0093ecfc97ed056a7652825e9a45cb2dcb'
            },
            {
                tcId: 11, result: 'valid', flags: ["Normal"],
                comment: "Longest valid message size",
                msg: '78787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878787878',
                ct: '7efb69f1137d6a6e813b7ab75bf0400b3d07a442b88ab048675dc06b0215fc1a' +
                    '2e033263ec31a6c1d2eac56cb0470d69022a48131d1f000bbed70586b80cf635' +
                    '6465c8834daced7ea2a5ff8ef9c44d5ab828ffbf0556a6394752a4a28a70cae2' +
                    '0084e1236f042f6c29de5cb34ef73acba5abcc7ccb3a26342701df3b9daa945d' +
                    '9fa5bf0b9b10306655e56370183f50fb8321f8f0cd1c72114791fca5df216629' +
                    '6b509b01a0b291c46110787cebe69d41b3b1e89590bc2f5e5d49ea24ae0f1207' +
                    'eef1aee54b9760553e80c5506a8a8a75732e92875025f0bfd5ead71e4340c8a9' +
                    'fa16dcd5a7dc96d8c4a7dc4e91f47a69366445c4695c8bad578ffe52bb672f65'
            },
            {
                tcId: 21, result: 'valid', flags: [],
                comment: "seed is all 0",
                msg: '313233343030',
                ct: '8e5f01ff0c1775870715fd0366a8748531f8b00803df35e0e2308db63bbec4ec' +
                    'a4e093351876b794213b904e5dde284a82d74abfcbfff94bc9a8300bea99edd0' +
                    '7fe97d6e0b11219f85ac15acc404d37d3da16819a14a438f3f72f8178b312526' +
                    '232386e918a8a7e11fc38f4668c499a00480cf9d2d75aabc0198d3ba9ba345fb' +
                    'a9105c6564df5f6ce796f14100d186abffe4d83d57969c1caddc7c7aa340b4d1' +
                    'bab23d9b3982278328ddebe648f5c52588738f3c56a88b3f34c890c03fafc27f' +
                    '485a17677a53e974dc1dd86f463a927f4328ac51bbc61705ae8abd7f45628957' +
                    '489e2defd8e043b955b118fb2a1c407d45893004aae0f945f06add1e45b41a03'
            },
            {
                tcId: 22, result: 'valid', flags: [],
                comment: "seed is all 1",
                msg: '313233343030',
                ct: '50c23e2ad6e3f3b10a5716cbf60efcc9f66d2c6f17bf050ba0153b877ba2755e' +
                    '8a0d54060034562266155744ef80547b8af777b0ff764fbb12baae49d02b4f6d' +
                    '65b6cd8f0a397839101d32ae163ff2e6072748d6b8017e5e73e332d53f4e91fe' +
                    '6233a82dbf54f3146b489803575c5ea37ab55a9ea7eae47ad4f1727d45822b56' +
                    '9cd6e5d4b6ab759850948186616b5da2a9a316f57d899f91934bbb27edcdfa19' +
                    '532ba1c01f3724738daffdd88c9a18562ebcbc49185b0a817407903476d442c4' +
                    '24c81b63aeb8f9d1b184756e0cc0a381eaba45a85c8bbc6770fd047ff1a6404a' +
                    '384599fbbd6a40b212a066e23f6a15cf13e42c0ea88c710e4d70c612074968e5'
            },
            {
                tcId: 12, result: 'invalid', flags: ["InvalidOaepPadding"],
                comment: "first byte of l_hash modified",
                msg: '313233343030',
                ct: '287d7108a1c6e7a18acb0045b20c57cdf2ac03456b44942764a7a9e9fdf3db48' +
                    '1d7e202e4c8d733b56b9c1e93d71e791af8325c9363df789b252a5ed0eddc79e' +
                    '76fa41c2cb0a35618398217a390a5e6d99eed905d5554d19c1cf4e30bdf1c2fc' +
                    'c5148b641d71b3f1977b63d232648ddd935ec9499a53ac2fbcac55f462e91065' +
                    'adaa018a39c453ba759bd68b454074153421e2ce75cf149f748b5b84758df8a4' +
                    '23d1c50c880af863f2a6df3cd465ca36aa2152b5771f3d507f4a4dd9f8006d80' +
                    'eca23537092287976f218a90df1e16d889fe31e79f7309f3224f613e9b52479f' +
                    'e73b7aad915319a3b62a5936649f7d015d7b09f7fa9f454f78a7c3dd4bf791e0'
            },
            {
                tcId: 13, result: 'invalid', flags: ["InvalidOaepPadding"],
                comment: "last byte of l_hash modified",
                msg: '313233343030',
                ct: '8b65065af82770625d24917d13fd97ae13247cad97910a2651f95800165b76cc' +
                    '34bfe06cbf8c31a7d7ab4f41e05c45a25b90c606378c8e49c95a15ca11ae37e7' +
                    '97a00f1b2680a6958c54396be4e1ceedcabc58d9f136b36867a2fefe648a9758' +
                    'f49634bfbcaa48717a116cba58c27539be10c56911aabe013e0329645e830842' +
                    '3c3aa42e0c9b1f4b5f546ddd9f90bf4d007dab52ac3879db755e4f2b96db5cf0' +
                    '1950f39076f261f50b1bae137be500b03ceff6ea1bbd80b33424f7faba5cc6b8' +
                    '6670fcb7db1a9b3c58bdfd7b75ba9f3ebd34ae32d320c757020a7324df7d3985' +
                    'bccfe0e81bb7f61bd98cb37219312299b4f274b2c90c52a8e1790f52e8fdd768'
            },
            {
                tcId: 17, result: 'invalid', flags: ["InvalidOaepPadding"],
                comment: "all bits in ps flipped",
                msg: '313233343030',
                ct: '4b4546460b54697beb899b54f474079169b4f7e79d0299586d821bd9091e9c5d' +
                    '2603b96c1aeb2924e887b15b211b07a657a85629932f97f18acd5a9f15684c99' +
                    '59fa41a6d1c10eeca68b7b95179492e80927860b7fadce3eb4e1e8610adc709e' +
                    '25580d8c7ad95af1de3a94b4a09e3078b86e88ae9630388711d20e28c801131c' +
                    'd1f924dfeddd85a9d404ef5db9e6a887845b5aa4763fbb72f259985ccf7ee6fc' +
                    '8329bf1ded74e5112f8c16df81e8038443df4bacb2eae1b06a48f178cdf22579' +
                    '41ca5887db4dc5135f0a2d050f56ac94ad9ffd4a13925c85501976937e723979' +
                    'cc31fd48c4d68d06e4c9cee53517dcb18da61fe4347658df495508d6ea9d7282'
            },
            {
                tcId: 19, result: 'invalid', flags: ["InvalidOaepPadding"],
                comment: "ps is all zero",
                msg: '313233343030',
                ct: 'a166bf7b5c2cf1896c0b924a69233a0a585bd47ed7f2330654aa68806deb0ff6' +
                    '8c6475050ab45c691bbbcc58dbc2f5c817729e8e195ebd39d48bd5e14977abae' +
                    '0829636831655917fb5a758fb43a8e505d6ce595f625970685f7ec81cb559221' +
                    '0f5d68c6e2e1ef26b4ef8c92bf44f077e1d5099f379cb8120ad185bf07877979' +
                    'ca81f251fb81be0ad3c14f4d7885fcec496f80033fd4279b6830a20cbdead27c' +
                    '0967e28d1e06ef4bd7ba89210ec0d696274a187dc2f13212f5adf06e9450eca3' +
                    '98325cfda73431036ac21b087d373c9f575c941f8cb078961176e31859a61c49' +
                    'baf8ff4f817a11010448d6a0e40dcede1a5ac3befa4c6e9d9d67d8e8fd8b6de3'
            },
            {
                tcId: 23, result: 'invalid', flags: ["InvalidOaepPadding"],
                comment: "First byte is 1",
                msg: '313233343030',
                ct: '3f92a694661cae336cac7a3c5a6f67e0655d10218a64459739ab9664f2cec589' +
                    '78939512df621e6b92fe3429bb22c08b5103da648a7719e7e95a04e6b6160154' +
                    '6955825d60f4c517619f851780ad17f1b8a955cf8c7f1a5e26ca4a0cc19cca75' +
                    '1d0790d56e1140a4705e19274f638b7c16d9d3e423a7f787d02699235e3e9e4d' +
                    '543a954f9b1bce5411c8ebdcae86a4bb86c66818a0bab51a2b00383b318e53d9' +
                    '5508bab1b19e388cd5a03cdceba0f7176c1782e19ef62cff69352d444b1ce0e1' +
                    'f339e96d8a65c07aa37f5f2cf33867f6c496e0da6cd79b3e2183b57064ce21a1' +
                    'b92072702e555a82cad75107fdfd8bd5e7ea5f119cfbbc1770e962fd0b781aff'
            },
            {
                tcId: 24, result: 'invalid', flags: ["InvalidOaepPadding"],
                comment: "m is 0",
                msg: '313233343030',
                ct: '0000000000000000000000000000000000000000000000000000000000000000' +
                    '0000000000000000000000000000000000000000000000000000000000000000' +
                    '0000000000000000000000000000000000000000000000000000000000000000' +
                    '0000000000000000000000000000000000000000000000000000000000000000' +
                    '0000000000000000000000000000000000000000000000000000000000000000' +
                    '0000000000000000000000000000000000000000000000000000000000000000' +
                    '0000000000000000000000000000000000000000000000000000000000000000' +
                    '0000000000000000000000000000000000000000000000000000000000000000'
            },
            {
                tcId: 26, result: 'invalid', flags: ["InvalidOaepPadding"],
                comment: "m is n-1",
                msg: '313233343030',
                ct: 'a2b451a07d0aa5f96e455671513550514a8a5b462ebef717094fa1fee82224e6' +
                    '37f9746d3f7cafd31878d80325b6ef5a1700f65903b469429e89d6eac8845097' +
                    'b5ab393189db92512ed8a7711a1253facd20f79c15e8247f3d3e42e46e48c98e' +
                    '254a2fe9765313a03eff8f17e1a029397a1fa26a8dce26f490ed81299615d981' +
                    '4c22da610428e09c7d9658594266f5c021d0fceca08d945a12be82de4d1ece6b' +
                    '4c03145b5d3495d4ed5411eb878daf05fd7afc3e09ada0f1126422f590975a19' +
                    '69816f48698bcbba1b4d9cae79d460d8f9f85e7975005d9bc22c4e5ac0f7c1a4' +
                    '5d12569a62807d3b9a02e5a530e773066f453d1f5b4c2e9cf7820283f742b9d4'
            },
            {
                tcId: 27, result: 'invalid', flags: ["InvalidCiphertext"],
                comment: "added n to c",
                msg: '313233343030',
                ct: 'b056e2513c7c470d897032d406e97b5946dcad52df1c1650d61a1d7b0af59e8c' +
                    'faec4d9e834d06d819b92a7d440d277e5039ab8aeff25043e98b281ae6ce0a91' +
                    'f8dfbbd1b4998fe5481671381b6a3952448b617ae606f06a0143561a040edaf3' +
                    'c972e611bd7cb814aa4761d38e4a007ca65af8fde6eb25d919d8bd9273cca762' +
                    '2984aa27994d049612424547775c5df75483962143522d075b8c55ea61b04583' +
                    'eb4c0358f9fbb902dedff30b7d8592b57094df4f6345668af53d1aea86fb36dd' +
                    '69b4434bacf8fc12c13802f5b03551ba8f207d4060a9f56e6b7e18c766eb82b6' +
                    'ce6ee0747fbe785c3c1c25fe7fb87de50032b172129fa41a69c3ce0e777ef10f'
            },
            {
                tcId: 28, result: 'invalid', flags: ["InvalidCiphertext"],
                comment: "ciphertext not reduced",
                msg: '313233343030',
                ct: '6ea4320bc5bcae709d0e4b9d67e7f0c248a65c5bc0762910e220ea96bdea088e' +
                    '20ce7ffb726a8fd87fa363249dc0ace75fdbe025b270dd72490cb164c4683881' +
                    '17bd95624bddfb70c1f07f98a6b9ccf9cee3d2b5f5b3e79a6664568a788b3f10' +
                    '02fc9546d6b3a0fb5f3cfb14f70785dc542dbbbaffbb3b791f0a5906ace090a3' +
                    'c29d123db768ecce56f0dbf99956f070ce2ebe8209c2ff6de6064ac6247f81c4' +
                    '064960c516f684f9e740b00f361844d9c1bcb1553bed9b297462e8badd3d431a' +
                    '09b62c773b0071a8d734aae4de04bac45b7bf8555471e937b0a36f0c1bce595e' +
                    'c9b3d366c9109319a3501156a08c21393e31fcffa2c51b242dac9f813c8f9686' +
                    '00'
            },
            {
                tcId: 29, result: 'invalid', flags: ["InvalidCiphertext"],
                comment: "ciphertext is empty",
                msg: '313233343030',
                ct: ''
            },
            {
                tcId: 32, result: 'invalid', flags: ["InvalidCiphertext"],
                comment: "truncated ciphertext",
                msg: '313233343030',
                ct: 'a290b0bf71a1141b2adc62b5b42b07fc52520cb05d1f39ccca7b7c22d379a6c2' +
                    'f2d93143d057050140527a1e5638243938b531ec3de7014b0151301e49b9fa43' +
                    '3482a02abdfd94193dc9c70157e557776a69ded01ecbeac405133595c61165a4' +
                    '28b6284729a4746b47d2bbaca9d7432c3b5693591cfee488eb3c68ddb6cde0dd' +
                    '61cfc6952423f994abecee34f5683732b29934a2c498ad48cdd30c149177189f' +
                    '48eefd9cc7232df18be11ff5f7e3af7319e3115997c599e2d8f7f4f663dcc400' +
                    '32d403436d3058a5ea66473660f0e195281ec6eba997d2a951ca6ca5f3c11271' +
                    '5c89da1d3dfb20a21940594ed10ade90ed7452b753757d7241cb8a803c373a'
            }
        ]
    };
    const wpKey = {
        n: BigInt('0x' + WYCHEPROOF_OAEP.n),
        e: BigInt('0x' + WYCHEPROOF_OAEP.e),
        d: BigInt('0x' + WYCHEPROOF_OAEP.d)
    };

    // ── Test 8: Wycheproof "valid" ciphertexts decrypt to the expected msg
    {
        const cases    = WYCHEPROOF_OAEP.tests.filter((t) => t.result === 'valid');
        const failures = [];
        for (const t of cases) {
            try {
                const pt = rsaDecryptOAEP(Buffer.from(t.ct, 'hex'), wpKey);
                if (pt.toString('hex') !== t.msg) failures.push(`tcId ${t.tcId}: wrong plaintext`);
            } catch (e) {
                failures.push(`tcId ${t.tcId}: threw "${e.message}"`);
            }
        }
        record(`Test 8: Wycheproof RSA-OAEP-2048-SHA256 — ${cases.length} valid ciphertexts decrypt to the expected msg`,
            cases.length > 0 && failures.length === 0, failures.join('; '));
    }

    // ── Test 9: Wycheproof "invalid" ciphertexts rejected, uniform error ─
    {
        const cases    = WYCHEPROOF_OAEP.tests.filter((t) => t.result === 'invalid');
        const failures = [];
        for (const t of cases) {
            let msg = null;
            try { rsaDecryptOAEP(Buffer.from(t.ct, 'hex'), wpKey); }
            catch (e) { msg = e.message; }
            // Every failure must look identical to the caller — padding
            // errors (Manger) and malformed ciphertexts alike.
            if (msg !== 'OAEP decoding error') {
                failures.push(`tcId ${t.tcId} (${t.comment}): ${msg === null ? 'ACCEPTED' : `error "${msg}"`}`);
            }
        }
        record(`Test 9: Wycheproof RSA-OAEP-2048-SHA256 — ${cases.length} invalid ciphertexts rejected with the uniform error`,
            cases.length > 0 && failures.length === 0, failures.join('; '));
    }

    process.exit(allPass ? 0 : 1);
}
