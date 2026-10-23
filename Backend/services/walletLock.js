/**
 * walletLock.js — per-user mutual exclusion for wallet-capped writes (G4).
 *
 * Savings deposits/withdrawals, goal contributions/allocations and the
 * month-rollover "save" all read the balance, check a cap, then insert. Two
 * such requests in parallel both pass the check and overdraw. Multi-document
 * transactions aren't available on a standalone mongod, so instead every
 * capped write for a user runs while holding that user's lock:
 *
 *   one document per user in `walletlocks`: { _id: userId, token, lockedUntil }
 *
 * acquire = a single atomic findOneAndUpdate that only matches when the lock
 * is free or expired, with upsert. If someone else holds it, the filter
 * misses, the upsert collides on _id (E11000) and we back off and retry.
 * release = clear the lock only if we still own it (token match).
 *
 * `lockedUntil` is a lease: a crashed holder blocks the user for at most
 * `ttlMs`, after which the next caller takes over. If the lock can't be
 * obtained within `waitMs`, WalletBusyError (HTTP 409) is thrown.
 */

const crypto = require('node:crypto');
const mongoose = require('mongoose');

const walletLockSchema = new mongoose.Schema({
    _id:         { type: mongoose.Schema.Types.ObjectId }, // = user id
    token:       { type: String, default: null },
    lockedUntil: { type: Date, default: null },
}, { collection: 'walletlocks', versionKey: false });

const WalletLock = mongoose.models.WalletLock || mongoose.model('WalletLock', walletLockSchema);

// Mutable so tests (and ops) can tune them.
const settings = {
    ttlMs:  15_000, // lease length — far above any real critical section
    waitMs: 5_000,  // how long a caller queues before giving up with 409
};

class WalletBusyError extends Error {
    constructor() {
        super('Another wallet update is in progress. Please try again.');
        this.name = 'WalletBusyError';
        this.code = 'WALLET_BUSY';
        this.status = 409;
    }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function acquire(userId, { ttlMs = settings.ttlMs, waitMs = settings.waitMs } = {}) {
    const token = crypto.randomUUID();
    const deadline = Date.now() + waitMs;
    let backoff = 5;
    for (;;) {
        const now = new Date();
        try {
            const doc = await WalletLock.findOneAndUpdate(
                { _id: userId, $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }] },
                { $set: { token, lockedUntil: new Date(now.getTime() + ttlMs) } },
                { upsert: true, new: true, lean: true },
            );
            if (doc && doc.token === token) return token;
        } catch (err) {
            if (err?.code !== 11000) throw err; // held by someone else
        }
        if (Date.now() >= deadline) throw new WalletBusyError();
        await sleep(backoff + Math.random() * backoff);
        backoff = Math.min(backoff * 2, 80);
    }
}

async function release(userId, token) {
    await WalletLock.updateOne({ _id: userId, token }, { $set: { token: null, lockedUntil: null } });
}

// Run `fn` while holding the user's wallet lock; always releases.
async function withWalletLock(userId, fn, opts) {
    const token = await acquire(userId, opts);
    try {
        return await fn();
    } finally {
        await release(userId, token).catch((err) => console.error('walletLock release failed:', err.message));
    }
}

module.exports = { acquire, release, withWalletLock, WalletBusyError, WalletLock, settings };
