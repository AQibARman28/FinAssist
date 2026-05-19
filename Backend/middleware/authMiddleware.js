/**
 * authMiddleware.protect — reads the access token from the fa_access cookie
 * (SEC-1 Phase 3). The previous Bearer-token flow is gone: tokens never live
 * in JS-readable storage anymore. Token minting helpers live in utils/sessions.js.
 */

const native = require('../utils/nativeCrypto');
const User = require('../models/User');
const { masterDecrypt, safeDecrypt } = require('../utils/encryption');
const { hasLegacyKeyBundle, regenerateUserKeyBundle } = require('../utils/keyManagement');
const { COOKIE_ACCESS } = require('../utils/sessions');

const protect = async (req, res, next) => {
    try {
        const token = req.cookies?.[COOKIE_ACCESS];
        if (!token) {
            return res.status(401).json({ success: false, message: 'Access denied. No session.' });
        }

        let decoded;
        try {
            decoded = native.verifyJwt(token, process.env.JWT_SECRET);
        } catch {
            return res.status(401).json({ success: false, message: 'Session expired or invalid.' });
        }

        // Reject temp 2FA tokens from accessing protected routes
        if (decoded.type === 'temp_2fa') {
            return res.status(401).json({ success: false, message: 'Complete two-factor authentication first.' });
        }

        const user = await User.findById(decoded.id).select('-password');
        if (!user) {
            return res.status(401).json({ success: false, message: 'User not found.' });
        }

        // Decrypt user's data key and attach to request for use in controllers
        if (user.encryptedDataKey) {
            const rawKey = await masterDecrypt(user.encryptedDataKey);
            req.dataKey = Buffer.from(rawKey, 'hex');

            // JIT migration: if the user still carries hex-JSON keypairs from
            // the Python era, rotate them to PEM now. One-time cost per legacy
            // user. After this, signRecord / encryptNote / getUserPrivateKeys
            // all see PEM and don't need to branch.
            if (hasLegacyKeyBundle(user)) {
                await regenerateUserKeyBundle(user, req.dataKey);
                await user.save();
            }

            req.user = user;
            req.user._name  = await safeDecrypt(user.name, req.dataKey);
            req.user._email = await safeDecrypt(user.email, req.dataKey);
        } else {
            // Legacy user without encryption at all
            req.dataKey = null;
            req.user = user;
            req.user._name  = user.name;
            req.user._email = user.email;
        }

        next();
    } catch (error) {
        console.error('Auth middleware error:', error.message);
        return res.status(401).json({ success: false, message: 'Token is not valid.' });
    }
};

module.exports = { protect };
