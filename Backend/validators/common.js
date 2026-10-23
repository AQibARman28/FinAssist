const { z } = require('zod');
const { isCommonPassword } = require('../utils/passwordStrength');

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

// Password policy (NIST SP 800-63B §5.1.1): at least 8 characters, no
// composition rules, and never one of the most common passwords. Controllers
// add the breached-password screen (utils/passwordStrength.isBreachedPassword),
// which needs a network call and so can't live in a synchronous schema.
const passwordPolicy = z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(256, 'Password too long')
    .refine((p) => !isCommonPassword(p), 'This password is too common. Choose something less guessable.');

// 6-digit numeric TOTP code as a string. We use `.string()` not `.number()`
// because the wire format is a string and leading zeros matter.
const totpCode = z.string().regex(/^\d{6}$/, 'TOTP code must be 6 digits');

// One-time 2FA recovery code: two groups of five base32 characters.
const recoveryCode = z.string().regex(/^[A-Za-z2-7]{5}-[A-Za-z2-7]{5}$/, 'Recovery code looks like ABCDE-FGHIJ');

const idParams = z.object({ id: objectId }).strict();

module.exports = {
    objectId,
    expenseCategoryEnum,
    goalTypeEnum,
    goalStatusEnum,
    currencyEnum,
    passwordPolicy,
    totpCode,
    recoveryCode,
    idParams,
};
