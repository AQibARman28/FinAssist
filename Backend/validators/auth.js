const { z } = require('zod');
const { passwordPolicy, totpCode, recoveryCode, currencyEnum } = require('./common');

const email = z.string().email('Invalid email').max(254, 'Email too long');

// Letters from any script, combining marks, spaces, apostrophes, hyphens and
// periods — enough for "José María O'Neil-Søren", never enough for markup.
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}' .\-]*$/u;
const name = z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(120, 'Name too long')
    .regex(NAME_RE, 'Use letters, spaces, apostrophes, hyphens or periods');

const register = z
    .object({
        name,
        email,
        password: passwordPolicy,
        currency: currencyEnum.optional(),
    })
    .strict();

// Login uses a lighter password schema — we don't enforce the policy on the
// candidate, just shape it as a non-empty string. Rejecting historical short
// passwords here would lock out users whose hash predates the policy.
const login = z
    .object({
        email,
        password: z.string().min(1, 'Password is required').max(256, 'Password too long'),
        rememberMe: z.boolean().optional(),
    })
    .strict();

// Changing the email or password needs the current password (and a TOTP code
// when 2FA is on); the controller enforces that because only it knows whether
// the submitted email actually differs from the current one.
const updateProfile = z
    .object({
        name:            name.optional(),
        email:           email.optional(),
        currency:        currencyEnum.optional(),
        password:        passwordPolicy.optional(),
        currentPassword: z.string().min(1).max(256).optional(),
        totp:            totpCode.optional(),
    })
    .strict()
    .refine((d) => Object.keys(d).length > 0, 'At least one field must be provided');

const sixDigitCode = z.string().regex(/^\d{6}$/, 'Code must be 6 digits');

const confirmEmailChange = z
    .object({ code: sixDigitCode })
    .strict();

// Enable/disable take an authenticator code; sign-in verification and disable
// also accept a one-time recovery code instead.
const twoFactorEnable = z
    .object({ token: totpCode })
    .strict();

const twoFactorVerify = z
    .object({ token: totpCode.optional(), recoveryCode: recoveryCode.optional() })
    .strict()
    .refine((d) => Boolean(d.token) !== Boolean(d.recoveryCode), 'Provide an authenticator code or a recovery code');

const verifyCode = z
    .object({
        email,
        code: sixDigitCode,
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
        code: sixDigitCode,
        newPassword: passwordPolicy,
    })
    .strict();

module.exports = {
    register, login, updateProfile, confirmEmailChange,
    twoFactorEnable, twoFactorVerify,
    verifyCode, resendCode, forgotPassword, resetPassword,
};
