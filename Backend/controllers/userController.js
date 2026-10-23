const crypto = require('node:crypto');
const User = require('../models/User');
const native = require('../utils/nativeCrypto');
const mongoose = require('mongoose');
const { masterEncrypt, masterDecrypt, FIELDS, sealField, openField, hashEmail, generateDataKey } = require('../utils/encryption');
const { generateUserKeyBundle, hasLegacyKeyBundle, regenerateUserKeyBundle } = require('../utils/keyManagement');
const {
    COOKIE_REFRESH,
    mintTempToken,
    establishSession,
    rotateRefreshToken,
    revokeRefreshToken,
    revokeAllForUser,
    setAccessCookie,
    setRefreshCookie,
    setTempCookie,
    clearSessionCookies,
} = require('../utils/sessions');
const mailer = require('../utils/mailer');
const { logAudit } = require('../utils/audit');
const { seedDefaultCategoriesForUser } = require('../utils/defaultCategories');
const loginThrottle = require('../utils/loginThrottle');
const { isBreachedPassword } = require('../utils/passwordStrength');
const { emailVerificationRequired } = require('../utils/config');
const { checkAndRecordTotp } = require('../utils/totpGuard');

// Email verification (code-based, SEC-1 Phase 4 → code rework)
const EMAIL_CODE_TTL_MS        = 15 * 60 * 1000; // codes expire in 15 min
const EMAIL_CODE_MAX_ATTEMPTS  = 5;              // wrong guesses before invalidation
const EMAIL_RESEND_COOLDOWN_MS = 60 * 1000;      // min gap between resends

// Password reset and email change (code-based) — same policy as verification.
const PWRESET_TTL_MS       = 15 * 60 * 1000;
const PWRESET_MAX_ATTEMPTS = 5;
const EMAIL_CHANGE_TTL_MS       = 15 * 60 * 1000;
const EMAIL_CHANGE_MAX_ATTEMPTS = 5;

const GENERIC_LOGIN_FAILURE = 'Invalid email or password';
const THROTTLED_MESSAGE     = 'Too many sign-in attempts. Try again in a few minutes.';
const BREACHED_MESSAGE      = 'This password has appeared in a data breach. Choose a different one.';

// Email verification: on in production unless REQUIRE_EMAIL_VERIFICATION=false,
// off in development unless REQUIRE_EMAIL_VERIFICATION=true (utils/config.js).
const requireEmailVerification = () => emailVerificationRequired(process.env);

// An Argon2 hash of a random string, verified against when the email is
// unknown so that path costs the same as a wrong password (no timing oracle).
let _dummyHash = null;
async function _verifyAgainstDummy(candidate) {
    if (!_dummyHash) _dummyHash = native.hashPassword(crypto.randomBytes(16).toString('hex'));
    await native.verifyPassword(typeof candidate === 'string' ? candidate : '', await _dummyHash);
    return false;
}

const _normalizeEmail = (e) => String(e || '').toLowerCase().trim();

const buildPublicUser = (user, plainName, plainEmail) => ({
    _id: user._id,
    name: plainName,
    email: plainEmail,
    currency: user.currency,
    role: user.role,
    twoFactorEnabled: user.twoFactorEnabled
});

// ── Email-verification helpers ───────────────────────────────────────────────

function _hashVerificationToken(plaintext) {
    return crypto.createHash('sha256').update(plaintext).digest('hex');
}

// Uniform 6-digit numeric code (crypto.randomInt avoids modulo bias).
function _generateCode() {
    return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

// Issues a fresh code on the user doc (caller saves). Returns the plaintext
// code so it can be emailed; only sha256(code) is persisted.
function _issueVerificationCode(user) {
    const code = _generateCode();
    user.emailVerificationToken     = _hashVerificationToken(code);
    user.emailVerificationExpiresAt = new Date(Date.now() + EMAIL_CODE_TTL_MS);
    user.emailVerificationAttempts  = 0;
    return code;
}

// Constant-time compare of a candidate code against the stored hash.
function _codeMatches(candidate, storedHash) {
    if (typeof candidate !== 'string' || typeof storedHash !== 'string') return false;
    const a = Buffer.from(_hashVerificationToken(candidate), 'hex');
    const b = Buffer.from(storedHash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── Handlers ─────────────────────────────────────────────────────────────────

// Same body for a new sign-up and for an address that already has an account,
// so the sign-up form can't be used to discover who is registered.
const _verificationPending = (email) => ({
    success: true,
    requiresEmailVerification: true,
    email,
    message: 'Check your email for a verification code to finish signing up.',
});

// POST /api/auth/register
const registerUser = async (req, res) => {
    try {
        const { name, email, password, currency } = req.body;

        const emailHash = await hashEmail(email);
        if (await User.findOne({ emailHash })) {
            if (requireEmailVerification()) {
                try { await mailer.sendAccountExistsEmail(email); }
                catch (mailErr) { console.error('register: account-exists email failed:', mailErr.message); }
                logAudit(req, 'register.duplicate', null);
                return res.status(201).json(_verificationPending(email));
            }
            return res.status(400).json({ success: false, message: 'Email already registered' });
        }

        if (await isBreachedPassword(password)) {
            return res.status(400).json({ success: false, message: BREACHED_MESSAGE });
        }

        // Generate per-user AES data key, encrypt it with the system master key
        const rawDataKey = generateDataKey();
        const encryptedDataKey = await masterEncrypt(rawDataKey);
        const dataKeyBuf = Buffer.from(rawDataKey, 'hex');

        // The id is minted first: every encrypted field is bound to its owner.
        const userId   = new mongoose.Types.ObjectId();
        const encName  = await sealField(name, dataKeyBuf, FIELDS.userName, userId);
        const encEmail = await sealField(email, dataKeyBuf, FIELDS.userEmail, userId);
        const keyBundle = await generateUserKeyBundle(dataKeyBuf, userId);

        const user = new User({
            _id: userId,
            name: encName,
            email: encEmail,
            emailHash,
            password,
            currency: currency || 'BDT',
            encryptedDataKey,
            ...keyBundle,
        });

        // Two registration postures (utils/config.emailVerificationRequired):
        //   on  (production default) → issue a 6-digit code, no session until
        //                              verified; the welcome email follows
        //                              verification.
        //   off (development default) → sign in immediately. No welcome email:
        //                              the address was never proven, so we
        //                              don't send branded mail to it.
        if (requireEmailVerification()) {
            const code = _issueVerificationCode(user);
            await user.save();
            try { await seedDefaultCategoriesForUser(user._id); }
            catch (seedErr) { console.error('register: default-category seed failed:', seedErr.message); }
            try { await mailer.sendVerificationCodeEmail(email, code); }
            catch (mailErr) { console.error('register: verification email failed:', mailErr.message); }
            logAudit(req, 'register', user._id);
            return res.status(201).json(_verificationPending(email));
        }

        user.emailVerified = true;
        await user.save();
        try { await seedDefaultCategoriesForUser(user._id); }
        catch (seedErr) { console.error('register: default-category seed failed:', seedErr.message); }
        logAudit(req, 'register', user._id);
        await establishSession(res, user._id);
        return res.status(201).json({
            success: true,
            data: buildPublicUser(user, name, email),
            requiresEmailVerification: false,
        });
    } catch (error) {
        console.error('Register error:', error);
        if (error.name === 'ValidationError') {
            const msg = Object.values(error.errors).map(e => e.message).join(', ');
            return res.status(400).json({ success: false, message: msg });
        }
        res.status(500).json({ success: false, message: 'Server error during registration' });
    }
};

// POST /api/auth/verify-code  { email, code }
// Confirms the 6-digit code, marks the account live, sends the welcome email,
// and logs the user straight in (best UX — no second trip to /login).
const verifyCode = async (req, res) => {
    try {
        const { email, code } = req.body;
        const emailHash = await hashEmail(email);
        const user = await User.findOne({ emailHash });

        // Generic failure text avoids leaking which emails exist / are pending.
        const fail = (msg = 'Invalid or expired code') =>
            res.status(400).json({ success: false, message: msg });

        if (!user) return fail();
        if (user.emailVerified) {
            return res.status(400).json({ success: false, message: 'Email already verified. Please sign in.' });
        }
        if (!user.emailVerificationToken || !user.emailVerificationExpiresAt
            || user.emailVerificationExpiresAt.getTime() < Date.now()) {
            return fail('Your code has expired. Request a new one.');
        }
        if ((user.emailVerificationAttempts || 0) >= EMAIL_CODE_MAX_ATTEMPTS) {
            user.emailVerificationToken     = null;   // force a resend
            user.emailVerificationExpiresAt = null;
            await user.save();
            logAudit(req, 'email.verify_failure', user._id, { reason: 'too_many_attempts' });
            return fail('Too many incorrect attempts. Request a new code.');
        }
        if (!_codeMatches(code, user.emailVerificationToken)) {
            user.emailVerificationAttempts = (user.emailVerificationAttempts || 0) + 1;
            await user.save();
            logAudit(req, 'email.verify_failure', user._id, { reason: 'wrong_code' });
            return fail();
        }

        // Success → live.
        user.emailVerified              = true;
        user.emailVerificationToken     = null;
        user.emailVerificationExpiresAt = null;
        user.emailVerificationAttempts  = 0;
        await user.save();
        await loginThrottle.clear(emailHash);
        logAudit(req, 'email.verify', user._id);

        const rawKey = await masterDecrypt(user.encryptedDataKey);
        const dataKey = Buffer.from(rawKey, 'hex');
        const plainName  = await openField(user.name, dataKey, FIELDS.userName, user._id);
        const plainEmail = await openField(user.email, dataKey, FIELDS.userEmail, user._id);

        // Thank-you / welcome email — best-effort, never blocks the response.
        try { await mailer.sendWelcomeEmail(plainEmail, plainName); }
        catch (mailErr) { console.error('verify: welcome email failed:', mailErr.message); }

        // Log them in. (A brand-new account won't have 2FA, but mirror login's
        // branch for correctness if it somehow does.)
        if (user.twoFactorEnabled) {
            setTempCookie(res, mintTempToken(user._id));
            return res.json({ success: true, requires2FA: true });
        }
        await establishSession(res, user._id);
        return res.json({ success: true, data: buildPublicUser(user, plainName, plainEmail) });
    } catch (error) {
        console.error('Verify-code error:', error);
        res.status(500).json({ success: false, message: 'Server error verifying code' });
    }
};

// POST /api/auth/resend-code  { email }
// Always responds with a generic success (no account enumeration). Issues a
// fresh code unless one was sent within the cooldown window.
const resendCode = async (req, res) => {
    const generic = { success: true, message: 'If your account needs verification, a new code has been sent.' };
    try {
        const { email } = req.body;
        const emailHash = await hashEmail(email);
        const user = await User.findOne({ emailHash });
        if (!user || user.emailVerified) return res.json(generic);

        if (user.emailVerificationExpiresAt) {
            const issuedAt = user.emailVerificationExpiresAt.getTime() - EMAIL_CODE_TTL_MS;
            if (Date.now() - issuedAt < EMAIL_RESEND_COOLDOWN_MS) return res.json(generic);
        }

        const code = _issueVerificationCode(user);
        await user.save();
        try { await mailer.sendVerificationCodeEmail(email, code); }
        catch (mailErr) { console.error('resend: verification email failed:', mailErr.message); }
        logAudit(req, 'email.resend_code', user._id);
        return res.json(generic);
    } catch (error) {
        console.error('Resend-code error:', error);
        return res.json(generic);
    }
};

// POST /api/auth/login
//
// Every path that isn't a success looks the same from outside: an unknown
// email still pays for an Argon2 verify, and the throttle (keyed by the
// email's blind index, independent of the client IP) applies identically to
// emails with and without an account.
const loginUser = async (req, res) => {
    try {
        const { email, password, rememberMe } = req.body;

        const emailHash = await hashEmail(email);
        if (await loginThrottle.isThrottled(emailHash)) {
            logAudit(req, 'login.failure', null, { reason: 'throttled' });
            return res.status(429).json({ success: false, message: THROTTLED_MESSAGE });
        }

        const user = await User.findOne({ emailHash });
        const passwordOk = user ? await user.comparePassword(password) : await _verifyAgainstDummy(password);

        if (!passwordOk) {
            await loginThrottle.recordFailure(emailHash);
            logAudit(req, 'login.failure', user ? user._id : null, { reason: user ? 'wrong_password' : 'unknown_email' });
            return res.status(401).json({ success: false, message: GENERIC_LOGIN_FAILURE });
        }

        // Password OK — but block unverified accounts before establishing a
        // session.
        if (requireEmailVerification() && user.emailVerified === false) {
            logAudit(req, 'login.failure', user._id, { reason: 'email_unverified' });
            return res.status(403).json({
                success: false,
                code: 'email_unverified',
                message: 'Please verify your email first. Enter the code we emailed you.',
            });
        }

        await loginThrottle.clear(emailHash);

        // Lazy password rehash: legacy PBKDF2 (plain or wrapped) hashes get
        // upgraded to plain argon2id on first successful login.
        if (user.passwordHashScheme !== 'argon2id' || !user.password.startsWith('$argon2')) {
            user.password = password;      // pre('save') hook re-hashes with argon2id
            await user.save();
        }

        // 2FA — issue a short-lived temp token in a cookie and wait for TOTP verification
        if (user.twoFactorEnabled) {
            setTempCookie(res, mintTempToken(user._id));
            logAudit(req, 'login.success', user._id, { pending2FA: true });
            return res.json({ success: true, requires2FA: true });
        }

        // Decrypt PII for the response
        const rawKey = await masterDecrypt(user.encryptedDataKey);
        const dataKey = Buffer.from(rawKey, 'hex');

        // JIT migration: rotate legacy hex-JSON key bundle to PEM
        if (hasLegacyKeyBundle(user)) {
            await regenerateUserKeyBundle(user, dataKey);
            await user.save();
        }

        await establishSession(res, user._id, { rememberMe: !!rememberMe });
        logAudit(req, 'login.success', user._id);

        res.json({
            success: true,
            data: buildPublicUser(
                user,
                (await openField(user.name, dataKey, FIELDS.userName, user._id)),
                (await openField(user.email, dataKey, FIELDS.userEmail, user._id)),
            ),
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Server error during login' });
    }
};

// POST /api/auth/forgot-password  { email }
// Always responds generically (no account enumeration). If the account exists,
// emails a 6-digit reset code (subject to a short resend cooldown).
const forgotPassword = async (req, res) => {
    const generic = { success: true, message: 'If an account exists for that email, a reset code has been sent.' };
    try {
        const { email } = req.body;
        const user = await User.findOne({ emailHash: await hashEmail(email) });
        if (!user) return res.json(generic);

        if (user.passwordResetExpiresAt) {
            const issuedAt = user.passwordResetExpiresAt.getTime() - PWRESET_TTL_MS;
            if (Date.now() - issuedAt < EMAIL_RESEND_COOLDOWN_MS) return res.json(generic);
        }

        const code = _generateCode();
        user.passwordResetToken     = _hashVerificationToken(code);
        user.passwordResetExpiresAt = new Date(Date.now() + PWRESET_TTL_MS);
        user.passwordResetAttempts  = 0;
        await user.save();

        try { await mailer.sendPasswordResetEmail(email, code); }
        catch (mailErr) { console.error('forgot-password: email failed:', mailErr.message); }
        logAudit(req, 'password.reset_request', user._id);
        return res.json(generic);
    } catch (error) {
        console.error('Forgot-password error:', error);
        return res.json(generic);
    }
};

// POST /api/auth/reset-password  { email, code, newPassword }
// Verifies the reset code, sets the new password, marks the email verified,
// revokes all existing sessions, and logs the user in on this device.
const resetPassword = async (req, res) => {
    try {
        const { email, code, newPassword } = req.body;
        const user = await User.findOne({ emailHash: await hashEmail(email) });

        const fail = (msg = 'Invalid or expired code') =>
            res.status(400).json({ success: false, message: msg });

        if (!user) return fail();
        if (!user.passwordResetToken || !user.passwordResetExpiresAt
            || user.passwordResetExpiresAt.getTime() < Date.now()) {
            return fail('Your reset code has expired. Request a new one.');
        }
        if ((user.passwordResetAttempts || 0) >= PWRESET_MAX_ATTEMPTS) {
            user.passwordResetToken     = null;
            user.passwordResetExpiresAt = null;
            await user.save();
            logAudit(req, 'password.reset_failure', user._id, { reason: 'too_many_attempts' });
            return fail('Too many incorrect attempts. Request a new code.');
        }
        if (!_codeMatches(code, user.passwordResetToken)) {
            user.passwordResetAttempts = (user.passwordResetAttempts || 0) + 1;
            await user.save();
            logAudit(req, 'password.reset_failure', user._id, { reason: 'wrong_code' });
            return fail();
        }

        if (await isBreachedPassword(newPassword)) {
            return res.status(400).json({ success: false, message: BREACHED_MESSAGE });
        }

        // Success — set new password (pre-save hook re-hashes argon2id), clear
        // reset + throttle state, and treat the email as verified (they just
        // proved control of it).
        user.password               = newPassword;
        user.passwordResetToken     = null;
        user.passwordResetExpiresAt = null;
        user.passwordResetAttempts  = 0;
        user.emailVerified          = true;
        await user.save();
        await loginThrottle.clear(user.emailHash);

        // Kick any other/old sessions, then sign in on this device.
        await revokeAllForUser(user._id);
        logAudit(req, 'password.reset', user._id);

        if (user.twoFactorEnabled) {
            setTempCookie(res, mintTempToken(user._id));
            return res.json({ success: true, requires2FA: true });
        }
        const rawKey = await masterDecrypt(user.encryptedDataKey);
        const dataKey = Buffer.from(rawKey, 'hex');
        await establishSession(res, user._id);
        return res.json({
            success: true,
            data: buildPublicUser(user, await openField(user.name, dataKey, FIELDS.userName, user._id), await openField(user.email, dataKey, FIELDS.userEmail, user._id)),
        });
    } catch (error) {
        console.error('Reset-password error:', error);
        res.status(500).json({ success: false, message: 'Server error resetting password' });
    }
};

// POST /api/auth/refresh — rotate refresh token and reissue access cookie.
const refreshSession = async (req, res) => {
    try {
        const rotated = await rotateRefreshToken(req.cookies?.[COOKIE_REFRESH]);
        if (rotated && rotated.reuseDetected) {
            // A rotated token came back after the grace window: the session
            // was likely copied. Its whole family is already revoked.
            logAudit(req, 'refresh.reuse_detected', rotated.userId);
            clearSessionCookies(res);
            return res.status(401).json({ success: false, message: 'Session ended for your security. Please sign in again.' });
        }
        if (!rotated) {
            clearSessionCookies(res);
            return res.status(401).json({ success: false, message: 'Refresh token invalid or expired' });
        }

        setAccessCookie(res, rotated.accessToken);
        setRefreshCookie(res, rotated.refreshToken, rotated.refreshExpiresAt);
        logAudit(req, 'refresh.rotate', rotated.userId);
        res.json({ success: true });
    } catch (error) {
        console.error('Refresh error:', error);
        res.status(500).json({ success: false, message: 'Server error refreshing session' });
    }
};

// POST /api/auth/logout — revoke the current refresh token, clear cookies.
const logout = async (req, res) => {
    try {
        await revokeRefreshToken(req.cookies?.[COOKIE_REFRESH]);
        clearSessionCookies(res);
        // We don't know which user owned the cookie without decoding the
        // access JWT; log the event with userId=null and no metadata to
        // avoid leaking the token hash. The refresh row's revokedAt
        // timestamp in the RefreshToken collection still ties it back.
        logAudit(req, 'logout', null);
        res.json({ success: true });
    } catch (error) {
        clearSessionCookies(res);
        console.error('Logout error:', error);
        res.json({ success: true });
    }
};

// GET /api/auth/profile
const getUserProfile = async (req, res) => {
    try {
        res.json({
            success: true,
            data: {
                ...buildPublicUser(req.user, req.user._name, req.user._email),
                rsaPublicKey: req.user.rsaPublicKey,
                eccPublicKey: req.user.eccPublicKey,
                keyVersion:   req.user.keyVersion
            }
        });
    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({ success: false, message: 'Server error fetching profile' });
    }
};

// PUT /api/auth/profile
//
// Name and currency change freely. A new password or a different email is a
// sensitive change: it needs the current password, plus an authenticator code
// when 2FA is on, so a borrowed session can't be turned into a takeover. A
// password change signs out every other session; an email change only takes
// effect once the code sent to the new address is confirmed.
const updateUserProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        const dataKey = req.dataKey;
        const { name, currency, password, currentPassword, totp } = req.body;
        const newEmail = req.body.email ? _normalizeEmail(req.body.email) : null;
        const emailChanging = Boolean(newEmail) && newEmail !== _normalizeEmail(req.user._email);

        if (password || emailChanging) {
            if (!currentPassword || !(await user.comparePassword(currentPassword))) {
                logAudit(req, 'reauth.failure', user._id, { reason: 'wrong_password' });
                return res.status(401).json({ success: false, code: 'reauth_required', message: 'Enter your current password to change your email or password.' });
            }
            if (user.twoFactorEnabled) {
                if (!totp) {
                    return res.status(401).json({ success: false, code: 'totp_required', message: 'Enter your authenticator code to confirm this change.' });
                }
                const result = await checkAndRecordTotp(user, dataKey, totp);
                if (!result.ok) {
                    logAudit(req, 'reauth.failure', user._id, { reason: 'totp' });
                    return res.status(result.status).json({ success: false, code: 'totp_invalid', message: result.status === 423 ? 'Too many failed 2FA attempts. Try again in a few minutes.' : 'Invalid authenticator code.' });
                }
            }
            if (password && await isBreachedPassword(password)) {
                return res.status(400).json({ success: false, message: BREACHED_MESSAGE });
            }
        }

        if (name)     user.name = await sealField(name, dataKey, FIELDS.userName, user._id);
        if (currency) user.currency = currency;

        let emailCode = null;
        if (emailChanging) {
            emailCode = _generateCode();
            user.pendingEmail         = await sealField(newEmail, dataKey, FIELDS.userPendingEmail, user._id);
            user.pendingEmailHash     = await hashEmail(newEmail);
            user.emailChangeToken     = _hashVerificationToken(emailCode);
            user.emailChangeExpiresAt = new Date(Date.now() + EMAIL_CHANGE_TTL_MS);
            user.emailChangeAttempts  = 0;
        }
        if (password) user.password = password;

        await user.save();

        if (emailChanging) {
            try { await mailer.sendEmailChangeCodeEmail(newEmail, emailCode); }
            catch (mailErr) { console.error('profile: email-change code failed:', mailErr.message); }
            logAudit(req, 'profile.email_change_requested', user._id);
        }
        if (password) {
            await revokeAllForUser(user._id);
            await establishSession(res, user._id);   // this device stays signed in
            logAudit(req, 'password.change', user._id);
        }

        res.json({
            success: true,
            data: buildPublicUser(user, name || req.user._name, req.user._email),
            emailChangePending: emailChanging,
            ...(emailChanging ? { pendingEmail: newEmail } : {}),
        });
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ success: false, message: 'Server error updating profile' });
    }
};

// POST /api/auth/profile/email/confirm  { code }
// Completes an email change started in updateUserProfile.
const confirmEmailChange = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        const fail = (msg = 'Invalid or expired code') => res.status(400).json({ success: false, message: msg });

        if (!user || !user.pendingEmailHash || !user.emailChangeToken) return fail('There is no email change waiting for confirmation.');
        if (!user.emailChangeExpiresAt || user.emailChangeExpiresAt.getTime() < Date.now()) {
            return fail('Your code has expired. Change the email again to get a new one.');
        }
        if ((user.emailChangeAttempts || 0) >= EMAIL_CHANGE_MAX_ATTEMPTS) {
            user.emailChangeToken = null;
            user.emailChangeExpiresAt = null;
            await user.save();
            return fail('Too many incorrect attempts. Change the email again to get a new code.');
        }
        if (!_codeMatches(req.body.code, user.emailChangeToken)) {
            user.emailChangeAttempts = (user.emailChangeAttempts || 0) + 1;
            await user.save();
            return fail();
        }

        const taken = await User.findOne({ emailHash: user.pendingEmailHash, _id: { $ne: user._id } });
        if (taken) return res.status(409).json({ success: false, message: 'That email can\'t be used for this account.' });

        const oldEmail = req.user._email;
        const newEmail = await openField(user.pendingEmail, req.dataKey, FIELDS.userPendingEmail, user._id);
        if (!newEmail) return fail('That change could not be confirmed. Change the email again.');
        user.email     = await sealField(newEmail, req.dataKey, FIELDS.userEmail, user._id);
        user.emailHash = user.pendingEmailHash;
        user.pendingEmail = null;
        user.pendingEmailHash = null;
        user.emailChangeToken = null;
        user.emailChangeExpiresAt = null;
        user.emailChangeAttempts = 0;
        await user.save();

        try { await mailer.sendEmailChangedNotice(oldEmail); }
        catch (mailErr) { console.error('profile: email-changed notice failed:', mailErr.message); }
        logAudit(req, 'profile.email_change', user._id);

        res.json({ success: true, data: buildPublicUser(user, req.user._name, newEmail) });
    } catch (error) {
        console.error('Confirm email change error:', error);
        res.status(500).json({ success: false, message: 'Server error confirming email change' });
    }
};

module.exports = {
    registerUser, loginUser, verifyCode, resendCode,
    forgotPassword, resetPassword,
    refreshSession, logout,
    getUserProfile, updateUserProfile, confirmEmailChange,
};
