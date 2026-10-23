/**
 * dataMigrations.js — one-time jobs that ship with the data-at-rest
 * hardening. Both are idempotent and default to a dry run.
 *
 * upgradeFieldEncryption({ apply, sealPlaintext })
 *   Re-encrypts every v1 field ciphertext (no AAD) as a v2 ciphertext bound
 *   to its owner and field, and moves legacy RSA-OAEP notes onto the user's
 *   AES data key. A stored value that isn't valid ciphertext is counted as
 *   `unreadable` and left alone; with sealPlaintext it is treated as legacy
 *   plaintext (data written before encryption existed) and sealed. Only opt
 *   in after checking the dry-run list: a planted value would be sealed too.
 *
 * reattestRecords({ apply })
 *   Records signed before re-signing on update existed (or under a key bundle
 *   that was later regenerated) don't verify. This signs them over their
 *   current values, establishing a baseline after which any mismatch is
 *   tampering. The dry run lists every record it would sign so an operator
 *   can review them first.
 */

const enc = require('./encryption');
const { FIELDS, sealField, isBound, masterDecrypt } = enc;
const keyMgmt = require('./keyManagement');
const { signRecord, attestationStatus, encryptNote } = require('./signing');
const payloads = require('./attestationPayloads');

const USER_FIELDS = [
    ['name', FIELDS.userName],
    ['email', FIELDS.userEmail],
    ['pendingEmail', FIELDS.userPendingEmail],
    ['twoFactorSecret', FIELDS.userTotpSecret],
    ['encryptedRsaPrivateKey', FIELDS.userRsaPrivateKey],
    ['encryptedEccPrivateKey', FIELDS.userEccPrivateKey],
];

function _models() {
    return {
        User:    require('../models/User'),
        Expense: require('../models/Expense'),
        Income:  require('../models/Income'),
        Goal:    require('../models/Goal'),
        Budget:  require('../models/Budget'),
    };
}

async function _userDataKey(user) {
    if (!user.encryptedDataKey) return null;
    return Buffer.from(await masterDecrypt(user.encryptedDataKey), 'hex');
}

// Upgrades one value; returns { value, outcome } where outcome is
// 'skip' | 'upgraded' | 'sealed' | 'unreadable'.
async function _upgradeValue(value, dataKey, field, userId, sealPlaintext) {
    if (!value || isBound(value)) return { value, outcome: 'skip' };
    try {
        const plain = await enc.decrypt(value, dataKey);
        return { value: await sealField(plain, dataKey, field, userId), outcome: 'upgraded' };
    } catch {
        if (!sealPlaintext) return { value, outcome: 'unreadable' };
        return { value: await sealField(value, dataKey, field, userId), outcome: 'sealed' };
    }
}

async function upgradeFieldEncryption({ apply = false, sealPlaintext = false } = {}) {
    const { User, Expense, Income, Goal } = _models();
    const totals = { users: 0, upgraded: 0, sealed: 0, unreadable: 0, unreadableItems: [] };
    const tally = (outcome, item) => {
        if (outcome === 'upgraded') totals.upgraded += 1;
        if (outcome === 'sealed') totals.sealed += 1;
        if (outcome === 'unreadable') { totals.unreadable += 1; totals.unreadableItems.push(item); }
    };

    for (const user of await User.find({ encryptedDataKey: { $type: 'string' } }).lean()) {
        totals.users += 1;
        const dataKey = await _userDataKey(user);
        const userId = user._id;

        // 1. The user document. Private keys first, so notes below can be read.
        const userSet = {};
        for (const [key, field] of USER_FIELDS) {
            const r = await _upgradeValue(user[key], dataKey, field, userId, sealPlaintext && (key === 'name' || key === 'email'));
            tally(r.outcome, { kind: 'user', id: String(userId), field: key });
            if (r.outcome === 'upgraded' || r.outcome === 'sealed') { userSet[key] = r.value; user[key] = r.value; }
        }
        if (apply && Object.keys(userSet).length) await User.updateOne({ _id: userId }, { $set: userSet });

        // 2. Records: encrypted text fields plus notes.
        const plan = [
            [Expense, 'expense', [['description', FIELDS.expenseDescription]], FIELDS.expenseNote],
            [Income,  'income',  [['description', FIELDS.incomeDescription]],  FIELDS.incomeNote],
            [Goal,    'goal',    [['title', FIELDS.goalTitle], ['description', FIELDS.goalDescription]], FIELDS.goalNote],
        ];
        for (const [Model, kind, fields, noteField] of plan) {
            for (const doc of await Model.find({ user: userId }).lean()) {
                const set = {};
                for (const [key, field] of fields) {
                    const r = await _upgradeValue(doc[key], dataKey, field, userId, sealPlaintext);
                    tally(r.outcome, { kind, id: String(doc._id), field: key });
                    if (r.outcome === 'upgraded' || r.outcome === 'sealed') set[key] = r.value;
                }
                if (doc.note && !isBound(doc.note)) {
                    try {
                        const { rsaPrivateKey } = await keyMgmt.getUserPrivateKeys(user, dataKey);
                        const plain = await keyMgmt.rsaDecrypt(doc.note, rsaPrivateKey);
                        set.note = await encryptNote(plain, user, dataKey, noteField);
                        tally('upgraded');
                    } catch {
                        tally('unreadable', { kind, id: String(doc._id), field: 'note' });
                    }
                }
                if (apply && Object.keys(set).length) await Model.updateOne({ _id: doc._id }, { $set: set });
            }
        }
    }
    return totals;
}

async function reattestRecords({ apply = false } = {}) {
    const { User, Expense, Income, Goal, Budget } = _models();
    const result = { checked: 0, resigned: 0, needing: [] };

    for (const user of await User.find({ encryptedDataKey: { $type: 'string' }, encryptedEccPrivateKey: { $type: 'string' } }).lean()) {
        const dataKey = await _userDataKey(user);
        const userId = user._id;

        const kinds = [
            [Expense, 'expense', async (d) => [payloads.expense(d)]],
            [Income,  'income',  async (d) => [payloads.income(d)]],
            [Goal,    'goal',    async (d) => [payloads.goal(await enc.openField(d.title, dataKey, FIELDS.goalTitle, userId), d.targetAmount, d.goalType)]],
            [Budget,  'budget',  async (d) => payloads.budgetCandidates(d)],
        ];
        for (const [Model, kind, candidates] of kinds) {
            for (const doc of await Model.find({ user: userId }).lean()) {
                result.checked += 1;
                const options = await candidates(doc);
                let status = 'invalid';
                for (const p of options) {
                    status = await attestationStatus(p, doc.serverAttestation, user);
                    if (status !== 'invalid') break;
                }
                if (status === 'valid') continue;
                result.needing.push({ kind, id: String(doc._id), status });
                if (!apply) continue;
                const signature = await signRecord(options[0], user, dataKey);
                await Model.updateOne({ _id: doc._id }, { $set: { serverAttestation: signature } });
                result.resigned += 1;
            }
        }
    }
    return result;
}

module.exports = { upgradeFieldEncryption, reattestRecords };
