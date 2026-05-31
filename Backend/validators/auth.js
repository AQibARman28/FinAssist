const { z } = require('zod');
const { passwordPolicy, totpCode, currencyEnum } = require('./common');

const email = z.string().email('Invalid email').max(254, 'Email too long');
const name  = z.string().min(1, 'Name is required').max(120, 'Name too long');

const register = z
    .object({
        name,
        email,
        password: passwordPolicy,
        currency: currencyEnum.optional(),
    })
    .strict();

// Login uses a lighter password schema — we don't enforce complexity on the
// candidate, just shape it as a non-empty string. The complexity check at
// register time is what matters; rejecting historical short passwords here
// would break login for users whose hash predates the policy.
const login = z
    .object({
        email,
        password: z.string().min(1, 'Password is required').max(256, 'Password too long'),
        rememberMe: z.boolean().optional(),
    })
    .strict();

const updateProfile = z
    .object({
        name:     name.optional(),
        email:    email.optional(),
        currency: currencyEnum.optional(),
        password: passwordPolicy.optional(),
    })
    .strict()
    .refine((d) => Object.keys(d).length > 0, 'At least one field must be provided');

const twoFactorVerify = z
    .object({ token: totpCode })
    .strict();

const verifyCode = z
    .object({
        email,
        code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
    })
    .strict();

const resendCode = z
    .object({ email })
    .strict();

const forgotPassword = z
    .object({ email })
    .strict();

const resetPassword = z
    .object({
        email,
        code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
        newPassword: passwordPolicy,
    })
    .strict();

module.exports = { register, login, updateProfile, twoFactorVerify, verifyCode, resendCode, forgotPassword, resetPassword };
