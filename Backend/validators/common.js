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

// Password complexity policy (Phase 4):
//   - 12+ characters
//   - mixed-character classes: at least one lower, one upper, one digit
//   Symbols are encouraged but not required (NIST 800-63B leans on length
//   over composition); the lower/upper/digit rule is the minimum the brief
//   calls out as "require mix".
const passwordPolicy = z
    .string()
    .min(12, 'Password must be at least 12 characters')
    .max(256, 'Password too long')
    .refine((s) => /[a-z]/.test(s), 'Password must contain a lowercase letter')
    .refine((s) => /[A-Z]/.test(s), 'Password must contain an uppercase letter')
    .refine((s) => /\d/.test(s),   'Password must contain a digit');

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
