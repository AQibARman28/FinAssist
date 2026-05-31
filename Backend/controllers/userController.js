const crypto = require('node:crypto');
const User = require('../models/User');
const { masterEncrypt, masterDecrypt, encrypt, safeDecrypt, hashEmail, generateDataKey } = require('../utils/encryption');
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
const { sendVerificationCodeEmail, sendWelcomeEmail, sendPasswordResetEmail } = require('../utils/mailer');
const { logAudit } = require('../utils/audit');
const { seedDefaultCategoriesForUser } = require('../utils/defaultCategories');

// Lockout policy (SEC-1 Phase 4)
const LOGIN_WINDOW_MS    = 15 * 60 * 1000;   // 15 min
const LOGIN_FAIL_LIMIT   = 5;
const LOGIN_LOCKOUT_MS   = 15 * 60 * 1000;   // 15 min base, *2^lockoutCount

// Email verification (code-based, SEC-1 Phase 4 → code rework)
const EMAIL_CODE_TTL_MS        = 15 * 60 * 1000; // codes expire in 15 min
const EMAIL_CODE_MAX_ATTEMPTS  = 5;              // wrong guesses before invalidation
const EMAIL_RESEND_COOLDOWN_MS = 60 * 1000;      // min gap between resends

// Password reset (code-based) — same policy as email verification.
const PWRESET_TTL_MS       = 15 * 60 * 1000;
const PWRESET_MAX_ATTEMPTS = 5;

// Email verification is a gate only when REQUIRE_EMAIL_VERIFICATION=true.
// Default (unset) auto-verifies on signup — needed until a verified sending
// domain exists so codes can reach arbitrary users. Flip to 'true' to re-enable.
function requireEmailVerification() {
    return process.env.REQUIRE_EMAIL_VERIFICATION === 'true';
}

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

// ── Lockout helpers ──────────────────────────────────────────────────────────

function _isLocked(user) {
    return user.lockedUntil && user.lockedUntil.getTime() > Date.now();
}

async function _recordLoginFailure(user) {
    const now = new Date();
    if (!user.firstFailedLoginAt || (now - user.firstFailedLoginAt) > LOGIN_WINDOW_MS) {
        user.firstFailedLoginAt = now;
        user.failedLoginAttempts = 1;
    } else {
        user.failedLoginAttempts += 1;
    }
    if (user.failedLoginAttempts >= LOGIN_FAIL_LIMIT) {
        const factor = Math.pow(2, user.lockoutCount || 0);
        user.lockedUntil = new Date(now.getTime() + LOGIN_LOCKOUT_MS * factor);
        user.lockoutCount = (user.lockoutCount || 0) + 1;
        user.failedLoginAttempts = 0;
        user.firstFailedLoginAt  = null;
    }
    await user.save();
}

async function _clearLockout(user) {
    if (user.failedLoginAttempts || user.firstFailedLoginAt || user.lockedUntil || user.lockoutCount) {
        user.failedLoginAttempts = 0;
        user.firstFailedLoginAt  = null;
        user.lockedUntil         = null;
        user.lockoutCount        = 0;
    }
}

// ── Handlers ─────────────────────────────────────────────────────────────────

// POST /api/auth/register
const registerUser = async (req, res) => {
    try {
        const { name, email, password, currency } = req.body;

        const emailHash = await hashEmail(email);
        if (await User.findOne({ emailHash })) {
            return res.status(400).json({ success: false, message: 'Email already registered' });
        }

        // Generate per-user AES data key, encrypt it with the system master key
        const rawDataKey = generateDataKey();
        const encryptedDataKey = await masterEncrypt(rawDataKey);
        const dataKeyBuf = Buffer.from(rawDataKey, 'hex');

        const encName  = await encrypt(name, dataKeyBuf);
        const encEmail = await encrypt(email, dataKeyBuf);
        const keyBundle = await generateUserKeyBundle(dataKeyBuf);

        const user = new User({
            name: encName,
            email: encEmail,
            emailHash,
            password,
            currency: currency || 'BDT',
            encryptedDataKey,
            ...keyBundle,
        });

        // Two registration postures, toggled by REQUIRE_EMAIL_VERIFICATION:
        //   'true'  → issue a 6-digit code, no session until verified.
        //   else    → auto-verify and sign in immediately (default). Used when
        //             email can't yet reach arbitrary users (no verified
        //             sending domain). Flip the env var to re-enable the gate.
        if (requireEmailVerification()) {
            const code = _issueVerificationCode(user);
            await user.save();
            try { await seedDefaultCategoriesForUser(user._id); }
            catch (seedErr) { console.error('register: default-category seed failed:', seedErr.message); }
            try { await sendVerificationCodeEmail(email, code); }
            catch (mailErr) { console.error('register: verification email failed:', mailErr.message); }
            logAudit(req, 'register', user._id);
            return res.status(201).json({
                success: true,
                data: buildPublicUser(user, name, email),
                requiresEmailVerification: true,
                email,
                message: 'Account created. Enter the verification code we emailed you.',
            });
        }

        // Auto-verify: mark live, seed categories, send a best-effort welcome,
        // and establish the session so the user lands straight on the dashboard.
        user.emailVerified = true;
        await user.save();
        try { await seedDefaultCategoriesForUser(user._id); }
        catch (seedErr) { console.error('register: default-category seed failed:', seedErr.message); }
        try { await sendWelcomeEmail(email, name); }
        catch (mailErr) { console.error('register: welcome email failed:', mailErr.message); }
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
        _clearLockout(user);
        await user.save();
        logAudit(req, 'email.verify', user._id);

        const rawKey = await masterDecrypt(user.encryptedDataKey);
        const dataKey = Buffer.from(rawKey, 'hex');
        const plainName  = await safeDecrypt(user.name, dataKey);
        const plainEmail = await safeDecrypt(user.email, dataKey);

        // Thank-you / welcome email — best-effort, never blocks the response.
        try { await sendWelcomeEmail(plainEmail, plainName); }
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
        try { await sendVerificationCodeEmail(email, code); }
        catch (mailErr) { console.error('resend: verification email failed:', mailErr.message); }
        logAudit(req, 'email.resend_code', user._id);
        return res.json(generic);
    } catch (error) {
        console.error('Resend-code error:', error);
        return res.json(generic);
    }
};

// POST /api/auth/login
const loginUser = async (req, res) => {
    try {
        const { email, password, rememberMe } = req.body;

        const emailHash = await hashEmail(email);
        const user = await User.findOne({ emailHash });

        // Unified "invalid email or password" for the no-user case is
        // applied below alongside the wrong-password case. But: lockout
        // check has to happen even when the password is wrong, so we still
        // need to identify which user we're checking. We do the lockout
        // check inside the user-exists branch.
        if (!user) {
            logAudit(req, 'login.failure', null, { reason: 'unknown_email' });
            return res.status(401).json({ success: false, message: 'Invalid email or password' });
        }

        if (_isLocked(user)) {
            logAudit(req, 'login.failure', user._id, { reason: 'locked' });
            return res.status(423).json({
                success: false,
                message: 'Account temporarily locked due to repeated failed sign-ins. Try again later.',
                lockedUntil: user.lockedUntil,
            });
        }

        if (!(await user.comparePassword(password))) {
            await _recordLoginFailure(user);
            logAudit(req, 'login.failure', user._id, { reason: 'wrong_password' });
            return res.status(401).json({ success: false, message: 'Invalid email or password' });
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

        _clearLockout(user);

        // Lazy password rehash: legacy PBKDF2 hashes get upgraded to argon2id
        // on first successful login.
        if (user.passwordHashScheme !== 'argon2id') {
            user.password = password;      // pre('save') hook re-hashes with argon2id
        }
        await user.save();

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
                (await safeDecrypt(user.name, dataKey)),
                (await safeDecrypt(user.email, dataKey)),
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

        try { await sendPasswordResetEmail(email, code); }
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

        // Success — set new password (pre-save hook re-hashes argon2id), clear
        // reset + lockout state, and treat the email as verified (they just
        // proved control of it).
        user.password               = newPassword;
        user.passwordResetToken     = null;
        user.passwordResetExpiresAt = null;
        user.passwordResetAttempts  = 0;
        user.emailVerified          = true;
        _clearLockout(user);
        await user.save();

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
            data: buildPublicUser(user, await safeDecrypt(user.name, dataKey), await safeDecrypt(user.email, dataKey)),
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
const updateUserProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        const dataKey = req.dataKey;

        if (req.body.name)     user.name  = await encrypt(req.body.name, dataKey);
        if (req.body.currency) user.currency = req.body.currency;

        if (req.body.email) {
            const newEmail = req.body.email.toLowerCase().trim();
            const newHash  = await hashEmail(newEmail);
            const existing = await User.findOne({ emailHash: newHash });
            if (existing && existing._id.toString() !== user._id.toString()) {
                return res.status(400).json({ success: false, message: 'Email already in use' });
            }
            user.email     = await encrypt(newEmail, dataKey);
            user.emailHash = newHash;
        }

        const passwordChanged = Boolean(req.body.password);
        const emailChanged    = Boolean(req.body.email);
        if (req.body.password) user.password = req.body.password;

        await user.save();

        if (passwordChanged) logAudit(req, 'password.change',     user._id);
        if (emailChanged)    logAudit(req, 'profile.email_change', user._id);

        const plainName  = req.body.name  || req.user._name;
        const plainEmail = req.body.email || req.user._email;

        res.json({ success: true, data: buildPublicUser(user, plainName, plainEmail) });
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ success: false, message: 'Server error updating profile' });
    }
};

module.exports = {
    registerUser, loginUser, verifyCode, resendCode,
    forgotPassword, resetPassword,
    refreshSession, logout,
    getUserProfile, updateUserProfile,
};
