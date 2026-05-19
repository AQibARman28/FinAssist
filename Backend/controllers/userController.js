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

const buildPublicUser = (user, plainName, plainEmail) => ({
    _id: user._id,
    name: plainName,
    email: plainEmail,
    currency: user.currency,
    role: user.role,
    twoFactorEnabled: user.twoFactorEnabled
});

// POST /api/auth/register
const registerUser = async (req, res) => {
    try {
        const { name, email, password, currency } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ success: false, message: 'Name, email and password are required' });
        }
        if (password.length < 6) {
            return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
        }

        const emailHash = await hashEmail(email);
        if (await User.findOne({ emailHash })) {
            return res.status(400).json({ success: false, message: 'Email already registered' });
        }

        // Generate per-user AES data key, encrypt it with the system master key
        const rawDataKey = generateDataKey();
        const encryptedDataKey = await masterEncrypt(rawDataKey);
        const dataKeyBuf = Buffer.from(rawDataKey, 'hex');

        // Encrypt PII
        const encName  = await encrypt(name, dataKeyBuf);
        const encEmail = await encrypt(email, dataKeyBuf);

        // Generate RSA-2048 + ECC P-256 key pairs; store private keys encrypted
        const keyBundle = await generateUserKeyBundle(dataKeyBuf);

        const user = await User.create({
            name: encName,
            email: encEmail,
            emailHash,
            password,
            currency: currency || 'BDT',
            encryptedDataKey,
            ...keyBundle
        });

        await establishSession(res, user._id);

        res.status(201).json({
            success: true,
            data: buildPublicUser(user, name, email),
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

// POST /api/auth/login
const loginUser = async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email and password are required' });
        }

        const emailHash = await hashEmail(email);
        const user = await User.findOne({ emailHash });

        if (!user || !(await user.comparePassword(password))) {
            return res.status(401).json({ success: false, message: 'Invalid email or password' });
        }

        // Lazy password rehash: legacy PBKDF2 hashes get upgraded to argon2id
        // on first successful login. Save happens regardless of 2FA path so the
        // migration completes even for 2FA users (whose response returns early).
        if (user.passwordHashScheme !== 'argon2id') {
            user.password = password;      // pre('save') hook re-hashes with argon2id
            await user.save();
        }

        // 2FA — issue a short-lived temp token in a cookie and wait for TOTP verification
        if (user.twoFactorEnabled) {
            setTempCookie(res, mintTempToken(user._id));
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
// Public route (no `protect`) because the access cookie may already be expired.
const refreshSession = async (req, res) => {
    try {
        const rotated = await rotateRefreshToken(req.cookies?.[COOKIE_REFRESH]);
        if (!rotated) {
            clearSessionCookies(res);
            return res.status(401).json({ success: false, message: 'Refresh token invalid or expired' });
        }

        setAccessCookie(res, rotated.accessToken);
        setRefreshCookie(res, rotated.refreshToken, rotated.refreshExpiresAt);
        res.json({ success: true });
    } catch (error) {
        console.error('Refresh error:', error);
        res.status(500).json({ success: false, message: 'Server error refreshing session' });
    }
};

// POST /api/auth/logout — revoke the current refresh token, clear cookies.
// Public route — callable when the access token is already expired so the
// client can still clean up the server-side refresh row.
const logout = async (req, res) => {
    try {
        await revokeRefreshToken(req.cookies?.[COOKIE_REFRESH]);
        clearSessionCookies(res);
        res.json({ success: true });
    } catch (error) {
        // Even on failure, blow away the cookies so the client lands logged out.
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

        // Email change requires updating emailHash too
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

        if (req.body.password) user.password = req.body.password;

        await user.save();

        const plainName  = req.body.name  || req.user._name;
        const plainEmail = req.body.email || req.user._email;

        // Session cookies stay valid — the access JWT carries only {id}, which
        // is unchanged. No token rotation needed on profile change.

        res.json({ success: true, data: buildPublicUser(user, plainName, plainEmail) });
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ success: false, message: 'Server error updating profile' });
    }
};

module.exports = { registerUser, loginUser, refreshSession, logout, getUserProfile, updateUserProfile };
