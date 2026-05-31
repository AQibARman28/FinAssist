const { z } = require('zod');

// 24-char hex Mongo ObjectId. Validated at the controller boundary so
// mismatched IDs land as 400 instead of CastError 500s downstream.
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

const expenseCategoryEnum = z.enum([
    'Food', 'Transport', 'Entertainment', 'Shopping',
    'Bills', 'Healthcare', 'Education', 'Other',
]);

const goalTypeEnum = z.enum([
    'Emergency Fund', 'Vacation', 'Car', 'House',
    'Education', 'Investment', 'Other',
]);

const goalStatusEnum = z.enum(['Active', 'Completed', 'Paused']);

const currencyEnum = z.enum([
    'BDT', 'USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'SGD', 'AED',
]);

// Password policy: minimum 6 characters (relaxed from the earlier 12-char +
// upper/lower/digit rule at the owner's request, for a lighter sign-up).
const passwordPolicy = z
    .string()
    .min(6, 'Password must be at least 6 characters')
    .max(256, 'Password too long');

// 6-digit numeric TOTP code as a string. We use `.string()` not `.number()`
// because the wire format is a string and leading zeros matter.
const totpCode = z.string().regex(/^\d{6}$/, 'TOTP code must be 6 digits');

const idParams = z.object({ id: objectId }).strict();

module.exports = {
    objectId,
    expenseCategoryEnum,
    goalTypeEnum,
    goalStatusEnum,
    currencyEnum,
    passwordPolicy,
    totpCode,
    idParams,
};
