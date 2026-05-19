const Income = require('../models/Income');
const { encrypt, safeDecrypt } = require('../utils/encryption');
const { signRecord, verifyRecord, encryptNote, decryptNote } = require('../utils/signing');
const { assertCategoryOwnedAndTyped } = require('../utils/categoryGuard');
const { logAudit } = require('../utils/audit');
const { materializeRecurring } = require('../utils/recurring');

// Default materialization window when the client doesn't pass a date filter:
// the start through end of the current calendar month in UTC.
function _defaultWindow() {
    const now = new Date();
    const y   = now.getUTCFullYear();
    const m   = now.getUTCMonth();
    return {
        from: new Date(Date.UTC(y, m, 1, 0, 0, 0, 0)),
        to:   new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999)),
    };
}

// Payload that goes into the ECDSA serverAttestation. Stricter than
// Expense's signed payload — date, user, and createdAt are all bound,
// so any direct-DB rewrite of those fields detaches the signature.
function attestationPayload(income) {
    return {
        amount:    income.amount,
        category:  income.category,
        date:      income.date,
        user:      income.user,
        createdAt: income.createdAt,
    };
}

async function decryptIncome(income, user, dataKey) {
    const obj = income.toObject ? income.toObject({ virtuals: true }) : { ...income };
    obj.description = await safeDecrypt(income.description, dataKey);
    obj.note = income.note ? await decryptNote(income.note, user, dataKey) : null;
    return obj;
}

// POST /api/incomes
const createIncome = async (req, res) => {
    try {
        const { amount, category, description, date, isRecurring, recurringFrequency, isPostTax } = req.body;

        const guard = await assertCategoryOwnedAndTyped(req.user._id, category, 'income');
        if (!guard.ok) {
            return res.status(guard.status).json({ success: false, message: guard.message });
        }

        const incomeDate = new Date(date);
        const createdAt  = new Date();   // set explicitly so we can include it in the signature
        const encDesc    = await encrypt(description, req.dataKey);
        const encNote    = req.body.note ? (await encryptNote(req.body.note, req.user)) : undefined;

        const signed = await signRecord(
            { amount, category, date: incomeDate, user: req.user._id, createdAt },
            req.user,
            req.dataKey,
        );

        const income = await Income.create({
            user:               req.user._id,
            amount,
            category,
            description:        encDesc,
            date:               incomeDate,
            isRecurring:        !!isRecurring,
            // Only persist the cadence when isRecurring is true so one-off
            // entries don't carry a stray frequency.
            recurringFrequency: isRecurring ? recurringFrequency : undefined,
            isPostTax:          isPostTax === undefined ? true : isPostTax,
            note:               encNote,
            createdAt,
            serverAttestation:  signed,
        });

        logAudit(req, 'income.create', req.user._id, { incomeId: income._id.toString() });

        res.status(201).json({ success: true, data: await decryptIncome(income, req.user, req.dataKey) });
    } catch (error) {
        console.error('Create income error:', error);
        res.status(500).json({ success: false, message: 'Server error creating income' });
    }
};

// GET /api/incomes
const getIncomes = async (req, res) => {
    try {
        const { page = 1, limit = 10, category, startDate, endDate } = req.query;

        // Materialize recurring instances inside the requested window
        // before we list. Best-effort: a materialization failure shouldn't
        // hide the user's existing rows.
        const fallback = _defaultWindow();
        const matFrom = startDate ? new Date(startDate) : fallback.from;
        const matTo   = endDate   ? new Date(endDate)   : fallback.to;
        try {
            await materializeRecurring(Income, req.user._id, matFrom, matTo);
        } catch (matErr) {
            console.error('materializeRecurring (income) failed:', matErr.message);
        }

        const query = { user: req.user._id };
        if (category) query.category = category;
        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = new Date(startDate);
            if (endDate)   query.date.$lte = new Date(endDate);
        }

        const incomes = await Income.find(query)
            .sort({ date: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const items = [];
        for (const inc of incomes) {
            if (inc.serverAttestation && !(await verifyRecord(attestationPayload(inc), inc.serverAttestation, req.user))) {
                console.warn(`serverAttestation failed verification on income ${inc._id} (user ${req.user._id})`);
            }
            items.push(await decryptIncome(inc, req.user, req.dataKey));
        }

        const total = await Income.countDocuments(query);

        res.json({
            success: true,
            data: items,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit),
            },
        });
    } catch (error) {
        console.error('Get incomes error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching incomes' });
    }
};

// GET /api/incomes/:id
const getIncomeById = async (req, res) => {
    try {
        const income = await Income.findOne({ _id: req.params.id, user: req.user._id });
        if (!income) return res.status(404).json({ success: false, message: 'Income not found' });

        if (income.serverAttestation && !(await verifyRecord(attestationPayload(income), income.serverAttestation, req.user))) {
            console.warn(`serverAttestation failed verification on income ${income._id} (user ${req.user._id})`);
        }

        res.json({ success: true, data: await decryptIncome(income, req.user, req.dataKey) });
    } catch (error) {
        console.error('Get income error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching income' });
    }
};

// PUT /api/incomes/:id
const updateIncome = async (req, res) => {
    try {
        // Same guard as create — applies to whatever category the caller is
        // pointing at after the update.
        if (req.body.category !== undefined) {
            const guard = await assertCategoryOwnedAndTyped(req.user._id, req.body.category, 'income');
            if (!guard.ok) {
                return res.status(guard.status).json({ success: false, message: guard.message });
            }
        }

        const updates = {};
        if (req.body.amount             !== undefined) updates.amount             = req.body.amount;
        if (req.body.category           !== undefined) updates.category           = req.body.category;
        if (req.body.description        !== undefined) updates.description        = await encrypt(req.body.description, req.dataKey);
        if (req.body.date               !== undefined) updates.date               = new Date(req.body.date);
        if (req.body.isRecurring        !== undefined) updates.isRecurring        = req.body.isRecurring;
        if (req.body.recurringFrequency !== undefined) updates.recurringFrequency = req.body.recurringFrequency;
        if (req.body.isPostTax          !== undefined) updates.isPostTax          = req.body.isPostTax;
        if (req.body.note               !== undefined) {
            updates.note = (req.body.note === null || req.body.note === '')
                ? null
                : (await encryptNote(req.body.note, req.user));
        }

        // If the client turned isRecurring OFF, clear the cadence so the
        // record doesn't carry a stale frequency.
        if (updates.isRecurring === false && updates.recurringFrequency === undefined) {
            updates.recurringFrequency = undefined;
        }

        // serverAttestation is set on creation and NOT regenerated on update —
        // see docs/decisions/SEC-1-ecdsa.md.

        const updated = await Income.findOneAndUpdate(
            { _id: req.params.id, user: req.user._id },
            updates,
            { new: true, runValidators: true },
        );
        if (!updated) return res.status(404).json({ success: false, message: 'Income not found' });

        logAudit(req, 'income.update', req.user._id, { incomeId: updated._id.toString() });

        res.json({ success: true, data: await decryptIncome(updated, req.user, req.dataKey) });
    } catch (error) {
        console.error('Update income error:', error);
        res.status(500).json({ success: false, message: 'Server error updating income' });
    }
};

// DELETE /api/incomes/:id
const deleteIncome = async (req, res) => {
    try {
        const deleted = await Income.findOneAndDelete({ _id: req.params.id, user: req.user._id });
        if (!deleted) return res.status(404).json({ success: false, message: 'Income not found' });

        logAudit(req, 'income.delete', req.user._id, { incomeId: deleted._id.toString() });

        res.json({ success: true, message: 'Income deleted successfully' });
    } catch (error) {
        console.error('Delete income error:', error);
        res.status(500).json({ success: false, message: 'Server error deleting income' });
    }
};

module.exports = { createIncome, getIncomes, getIncomeById, updateIncome, deleteIncome };
