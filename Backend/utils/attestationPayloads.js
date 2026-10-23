/**
 * attestationPayloads.js — the plaintext fields each record's ECDSA
 * attestation covers. Shared by the controllers (sign on create/update,
 * check on read) and utils/dataMigrations.js (baseline), so the definitions
 * can't drift apart.
 */

const expense = (e) => ({ amount: e.amount, category: e.category });

// Stricter than Expense: date, owner and createdAt are bound too, so a
// direct-DB rewrite of any of them detaches the signature.
const income = (i) => ({ amount: i.amount, category: i.category, date: i.date, user: i.user, createdAt: i.createdAt });

// Goal titles are encrypted; the attestation covers the decrypted title.
const goal = (title, targetAmount, goalType) => ({ title, targetAmount, goalType });

// Category serialized as its hex string so sign (string id from the body)
// and verify (ObjectId from the DB) produce the same canonical JSON.
const budget = (b) => ({ category: String(b.category), limit: b.limit, month: b.month, year: b.year });

// Budgets migrated from the String-enum era were signed over the category
// name, so they may verify against that shape instead.
const budgetCandidates = (b) => (b.legacyCategory
    ? [budget(b), budget({ category: b.legacyCategory, limit: b.limit, month: b.month, year: b.year })]
    : [budget(b)]);

module.exports = { expense, income, goal, budget, budgetCandidates };
