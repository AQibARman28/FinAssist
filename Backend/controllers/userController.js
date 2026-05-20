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
    setAccessCookie,
    setRefreshCookie,
    setTempCookie,
    clearSessionCookies,
} = require('../utils/sessions');
const { sendVerificationEmail } = require('../utils/mailer');
const { logAudit } = require('../utils/audit');
const { seedDefaultCategoriesForUser } = require('../utils/defaultCategories');

// Lockout policy (SEC-1 Phase 4)
const LOGIN_WINDOW_MS    = 15 * 60 * 1000;   // 15 min
const LOGIN_FAIL_LIMIT   = 5;
const LOGIN_LOCKOUT_MS   = 15 * 60 * 1000;   // 15 min base, *2^lockoutCount
const EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h

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

async function _issueVerificationToken(user) {
    const plaintext = crypto.randomBytes(32).toString('base64url');
    user.emailVerificationToken     = _hashVerificationToken(plaintext);
    user.emailVerificationExpiresAt = new Date(Date.now() + EMAIL_TOKEN_TTL_MS);
    return plaintext;
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

        // Dev-mode bypass: when SMTP isn't configured the operator (who is
        // also the user) can't receive the verification email, so insisting
        // on the verification gate just blocks them from their own dashboard.
        // Auto-verify, skip the token, establish a session. Production with
        // SMTP_HOST set still runs the full verify-by-email flow.
        const smtpConfigured = Boolean(process.env.SMTP_HOST);
        let verificationToken = null;
        if (smtpConfigured) {
            verificationToken = await _issueVerificationToken(user);
        } else {
            user.emailVerified = true;
        }
        await user.save();

        // Best-effort default-category seed. A rare unique-index hit (e.g.
        // a partial earlier migration left some rows behind for this same
        // userId) should not fail registration — the user can create the
        // remaining categories manually. Same fail-open posture as the
        // verification email below.
        try {
            await seedDefaultCategoriesForUser(user._id);
        } catch (seedErr) {
            console.error('register: default-category seed failed:', seedErr.message);
        }

        if (smtpConfigured) {
            // Best-effort email. Don't fail the registration on a mail outage —
            // the user can request a re-send (Phase 5+) or the operator can
            // pull the URL from logs.
            try {
                await sendVerificationEmail(email, verificationToken);
            } catch (mailErr) {
                console.error('register: verification email failed:', mailErr.message);
            }
        }

        logAudit(req, 'register', user._id);

        if (smtpConfigured) {
            // Production posture: no session until they click the link.
            return res.status(201).json({
                success: true,
                data: buildPublicUser(user, name, email),
                requiresEmailVerification: true,
                message: 'Account created. Check your email for a verification link.',
            });
        }

        // Dev posture: drop them straight onto the dashboard.
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

// GET /api/auth/verify-email?token=...
// Public route — opened directly from the email. Redirects to the frontend
// login page with ?verified=1 (or ?verified=0 on failure).
const verifyEmail = async (req, res) => {
    const frontend = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
    try {
        const token = req.query?.token;
        if (typeof token !== 'string' || token.length === 0) {
            return res.redirect(`${frontend}/login?verified=0&reason=missing`);
        }
        const hash = _hashVerificationToken(token);
        const user = await User.findOne({ emailVerificationToken: hash });
        if (!user) {
            return res.redirect(`${frontend}/login?verified=0&reason=invalid`);
        }
        if (!user.emailVerificationExpiresAt || user.emailVerificationExpiresAt.getTime() < Date.now()) {
            return res.redirect(`${frontend}/login?verified=0&reason=expired`);
        }
        user.emailVerified              = true;
        user.emailVerificationToken     = null;
        user.emailVerificationExpiresAt = null;
        await user.save();
        logAudit(req, 'email.verify', user._id);
        return res.redirect(`${frontend}/login?verified=1`);
    } catch (error) {
        console.error('Verify-email error:', error);
        return res.redirect(`${frontend}/login?verified=0&reason=error`);
    }
};

// POST /api/auth/login
const loginUser = async (req, res) => {
    try {
        const { email, password } = req.body;

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
        if (user.emailVerified === false) {
            logAudit(req, 'login.failure', user._id, { reason: 'email_unverified' });
            return res.status(403).json({
                success: false,
                message: 'Please verify your email address before signing in. Check your inbox for the verification link.',
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

        await establishSession(res, user._id);
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
    registerUser, loginUser, verifyEmail,
    refreshSession, logout,
    getUserProfile, updateUserProfile,
};
