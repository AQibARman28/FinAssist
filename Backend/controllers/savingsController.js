const Goal = require('../models/Goal');
const SavingsEntry = require('../models/SavingsEntry');
const User = require('../models/User');
const { getBalance } = require('../services/balance');
const { logAudit } = require('../utils/audit');

// Load goals + savings entries and compute the full balance picture.
async function loadBalance(userId, now = new Date()) {
    const [goals, entries] = await Promise.all([
        Goal.find({ user: userId }),
        SavingsEntry.find({ user: userId }),
    ]);
    return { entries, balance: await getBalance(userId, goals, entries, now) };
}

function ym(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// GET /api/savings → { balance, entries }
const getSavings = async (req, res) => {
    try {
        const { entries, balance } = await loadBalance(req.user._id);
        const sorted = [...entries].sort((a, b) => new Date(b.date) - new Date(a.date));
        res.json({
            success: true,
            data: {
                balance: balance.savingsBalance,
                wallet: balance.available,
                entries: sorted.map((e) => ({ _id: e._id, amount: e.amount, direction: e.direction, source: e.source, note: e.note, date: e.date })),
            },
        });
    } catch (error) {
        console.error('Get savings error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching savings' });
    }
};

// POST /api/savings/deposit { amount, note? } — move Wallet → Savings.
const depositSavings = async (req, res) => {
    try {
        const { amount, note } = req.body;
        const { balance } = await loadBalance(req.user._id);
        if (amount > balance.available) {
            return res.status(400).json({
                success: false,
                message: `Only ${Math.max(0, Math.round(balance.available))} ${req.user.currency} is available in your wallet to set aside.`,
            });
        }
        await SavingsEntry.create({ user: req.user._id, amount, direction: 'deposit', source: 'manual', note });
        logAudit(req, 'savings.deposit', req.user._id, { amount });
        const after = await loadBalance(req.user._id);
        res.status(201).json({ success: true, data: { balance: after.balance.savingsBalance, wallet: after.balance.available }, message: 'Moved to savings' });
    } catch (error) {
        console.error('Savings deposit error:', error);
        res.status(500).json({ success: false, message: 'Server error depositing to savings' });
    }
};

// POST /api/savings/withdraw { amount, note? } — move Savings → Wallet.
const withdrawSavings = async (req, res) => {
    try {
        const { amount, note } = req.body;
        const { balance } = await loadBalance(req.user._id);
        if (amount > balance.savingsBalance) {
            return res.status(400).json({
                success: false,
                message: `Only ${Math.max(0, Math.round(balance.savingsBalance))} ${req.user.currency} is in your savings to withdraw.`,
            });
        }
        await SavingsEntry.create({ user: req.user._id, amount, direction: 'withdraw', source: 'manual', note });
        logAudit(req, 'savings.withdraw', req.user._id, { amount });
        const after = await loadBalance(req.user._id);
        res.status(201).json({ success: true, data: { balance: after.balance.savingsBalance, wallet: after.balance.available }, message: 'Returned to wallet' });
    } catch (error) {
        console.error('Savings withdraw error:', error);
        res.status(500).json({ success: false, message: 'Server error withdrawing from savings' });
    }
};

// Wallet value as of the end of the previous calendar month.
async function priorMonthClosing(userId, now) {
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const endOfLastMonth = new Date(startOfThisMonth.getTime() - 1);
    const goals = await Goal.find({ user: userId });
    const entries = await SavingsEntry.find({ user: userId });
    const bal = await getBalance(userId, goals, entries, endOfLastMonth);
    return { priorClosing: bal.available, startOfThisMonth, endOfLastMonth };
}

// GET /api/wallet/rollover-status — is a first-of-month prompt pending?
const rolloverStatus = async (req, res) => {
    try {
        const now = new Date();
        const currentYM = ym(now);
        if (req.user.lastRolloverYearMonth === currentYM) {
            return res.json({ success: true, data: { pending: false } });
        }
        const { priorClosing, endOfLastMonth } = await priorMonthClosing(req.user._id, now);
        // Nothing to carry/save → no prompt (covers brand-new users).
        if (Math.round(priorClosing) === 0) {
            return res.json({ success: true, data: { pending: false } });
        }
        res.json({
            success: true,
            data: {
                pending: true,
                priorClosing,
                month: endOfLastMonth.toLocaleString('en-US', { month: 'long' }),
                year: endOfLastMonth.getFullYear(),
            },
        });
    } catch (error) {
        console.error('Rollover status error:', error);
        res.status(500).json({ success: false, message: 'Server error checking rollover' });
    }
};

// POST /api/wallet/rollover { action: 'carry' | 'save' }
const rollover = async (req, res) => {
    try {
        const { action } = req.body;
        const now = new Date();
        const { priorClosing, startOfThisMonth } = await priorMonthClosing(req.user._id, now);

        // "Save" only makes sense for a positive surplus; a deficit always carries.
        if (action === 'save' && priorClosing > 0) {
            await SavingsEntry.create({
                user: req.user._id,
                amount: priorClosing,
                direction: 'deposit',
                source: 'rollover',
                date: startOfThisMonth,
                note: `Carried-forward balance moved to savings`,
            });
        }

        await User.updateOne({ _id: req.user._id }, { $set: { lastRolloverYearMonth: ym(now) } });
        logAudit(req, 'wallet.rollover', req.user._id, { action, amount: Math.round(priorClosing) });
        res.json({ success: true, message: action === 'save' && priorClosing > 0 ? 'Moved to savings' : 'Carried forward' });
    } catch (error) {
        console.error('Rollover error:', error);
        res.status(500).json({ success: false, message: 'Server error processing rollover' });
    }
};

module.exports = { getSavings, depositSavings, withdrawSavings, rolloverStatus, rollover };
