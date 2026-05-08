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
 * In 2001 James Manger published an attack on PKCS#1 v1.5 (the predecessor
 * to OAEP) that works against any RSA implementation that distinguishes
 * different padding-validation failures. By submitting carefully chosen
 * ciphertexts and watching which error message comes back, the attacker
 * can recover the entire plaintext one bit at a time, in roughly k log(k)
 * decryption queries where k is the bit length of n.
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
 * Pure-BigInt RSA in JavaScript is slow:
 *   - Key generation: ~5–30 seconds (Miller-Rabin × ~1500 candidate primes).
 *   - Encryption: ~10 ms (e=65537 needs only 17 squarings).
 *   - Decryption: ~100–500 ms (d is ~2048 bits, so 2048 squarings).
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
// a real 2048-bit keypair and runs an OAEP round-trip — that's the slow
// part, somewhere between 5 and 30 seconds depending on machine speed and
// how many primality candidates Miller-Rabin needs to reject. Tests 6–7
// reuse the keypair from Test 5, so they're fast.
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
        process.stdout.write('  generating RSA-2048 keypair (this takes 5-30 seconds)... ');
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

    process.exit(allPass ? 0 : 1);
}
