const native = require('../utils/nativeCrypto');
const QRCode = require('qrcode');
const User = require('../models/User');
const { masterDecrypt, encrypt, safeDecrypt } = require('../utils/encryption');
const { hasLegacyKeyBundle, regenerateUserKeyBundle } = require('../utils/keyManagement');
const { COOKIE_TEMP, establishSession, clearTempCookie } = require('../utils/sessions');
const { checkAndRecordTotp } = require('../utils/totpGuard');
const { logAudit } = require('../utils/audit');

// POST /api/auth/2fa/setup — generate TOTP secret + QR code (requires auth)
const setup2FA = async (req, res) => {
    try {
        const secret = native.generateTotpSecret();
        const otpauthUrl = native.totpOtpauthUri(req.user._email, 'FinAssist', secret);
        const qrDataUrl = await QRCode.toDataURL(otpauthUrl);

        // Store encrypted secret (NOT enabled yet — user must verify first)
        const user = await User.findById(req.user._id);
        user.twoFactorSecret = await encrypt(secret, req.dataKey);
        await user.save();

        res.json({ success: true, data: { qrCode: qrDataUrl, manualKey: secret } });
    } catch (error) {
        console.error('2FA setup error:', error);
        res.status(500).json({ success: false, message: 'Failed to set up 2FA' });
    }
};

// POST /api/auth/2fa/enable — verify TOTP code and activate 2FA
const enable2FA = async (req, res) => {
    try {
        const { token: totpToken } = req.body;

        const user = await User.findById(req.user._id);
        if (!user.twoFactorSecret) {
            return res.status(400).json({ success: false, message: 'Run 2FA setup first' });
        }

        const result = await checkAndRecordTotp(user, req.dataKey, totpToken);
        if (!result.ok) {
            return res.status(result.status).json({
                success: false,
                message: result.status === 423
                    ? 'Too many failed 2FA attempts. Try again in a few minutes.'
                    : result.replay
                        ? 'Code already used. Wait for the next 30-second window.'
                        : 'Invalid verification code',
            });
        }

        user.twoFactorEnabled = true;
        await user.save();
        logAudit(req, '2fa.enable', user._id);
        res.json({ success: true, message: 'Two-factor authentication enabled' });
    } catch (error) {
        console.error('2FA enable error:', error);
        res.status(500).json({ success: false, message: 'Failed to enable 2FA' });
    }
};

// POST /api/auth/2fa/disable
const disable2FA = async (req, res) => {
    try {
        const { token: totpToken } = req.body;
        const user = await User.findById(req.user._id);

        const result = await checkAndRecordTotp(user, req.dataKey, totpToken);
        if (!result.ok) {
            return res.status(result.status).json({
                success: false,
                message: result.status === 423
                    ? 'Too many failed 2FA attempts. Try again in a few minutes.'
                    : result.replay
                        ? 'Code already used. Wait for the next 30-second window.'
                        : 'Invalid verification code',
            });
        }

        user.twoFactorEnabled = false;
        user.twoFactorSecret  = undefined;
        await user.save();
        logAudit(req, '2fa.disable', user._id);
        res.json({ success: true, message: 'Two-factor authentication disabled' });
    } catch (error) {
        console.error('2FA disable error:', error);
        res.status(500).json({ success: false, message: 'Failed to disable 2FA' });
    }
};

// POST /api/auth/2fa/verify — uses fa_temp cookie set by /auth/login
const verify2FA = async (req, res) => {
    try {
        const { token: totpToken } = req.body;
        const tempToken = req.cookies?.[COOKIE_TEMP];
        if (!tempToken) {
            return res.status(400).json({ success: false, message: '2FA gate missing or expired' });
        }

        let decoded;
        try {
            decoded = native.verifyJwt(tempToken, process.env.JWT_SECRET);
        } catch {
            clearTempCookie(res);
            return res.status(401).json({ success: false, message: 'Expired or invalid session. Please log in again.' });
        }

        if (decoded.type !== 'temp_2fa') {
            clearTempCookie(res);
            return res.status(401).json({ success: false, message: 'Invalid token type' });
        }

        const user = await User.findById(decoded.id);
        if (!user) return res.status(401).json({ success: false, message: 'User not found' });

        const rawKey  = await masterDecrypt(user.encryptedDataKey);
        const dataKey = Buffer.from(rawKey, 'hex');

        const result = await checkAndRecordTotp(user, dataKey, totpToken);
        if (!result.ok) {
            return res.status(result.status).json({
                success: false,
                message: result.status === 423
                    ? 'Too many failed 2FA attempts. Try again in a few minutes.'
                    : result.replay
                        ? 'Code already used. Wait for the next 30-second window.'
                        : 'Invalid verification code',
            });
        }

        // JIT migration: rotate legacy hex-JSON key bundle to PEM
        if (hasLegacyKeyBundle(user)) {
            await regenerateUserKeyBundle(user, dataKey);
            await user.save();
        }

        clearTempCookie(res);
        await establishSession(res, user._id);
        logAudit(req, 'login.success', user._id, { via2FA: true });

        res.json({
            success: true,
            data: {
                _id:              user._id,
                name:             (await safeDecrypt(user.name, dataKey)),
                email:            (await safeDecrypt(user.email, dataKey)),
                currency:         user.currency,
                role:             user.role,
                twoFactorEnabled: user.twoFactorEnabled,
            }
        });
    } catch (error) {
        console.error('2FA verify error:', error);
        res.status(500).json({ success: false, message: 'Verification failed' });
    }
};

module.exports = { setup2FA, enable2FA, disable2FA, verify2FA };
