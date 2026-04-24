const jwt = require('jsonwebtoken');
const { generateSecret, generateURI, verifySync } = require('otplib');
const QRCode = require('qrcode');
const User = require('../models/User');
const { generateToken } = require('../middleware/authMiddleware');
const { masterDecrypt, encrypt, decrypt, safeDecrypt } = require('../utils/encryption');

// POST /api/auth/2fa/setup — generate TOTP secret + QR code (requires auth)
const setup2FA = async (req, res) => {
    try {
        const secret = generateSecret();
        const otpauthUrl = generateURI({ type: 'totp', label: req.user._email, secret, issuer: 'FinAssist' });
        const qrDataUrl = await QRCode.toDataURL(otpauthUrl);

        // Store encrypted secret (NOT enabled yet — user must verify first)
        const user = await User.findById(req.user._id);
        user.twoFactorSecret = encrypt(secret, req.dataKey);
        await user.save();

        res.json({
            success: true,
            data: {
                qrCode: qrDataUrl,
                manualKey: secret
            }
        });
    } catch (error) {
        console.error('2FA setup error:', error);
        res.status(500).json({ success: false, message: 'Failed to set up 2FA' });
    }
};

// POST /api/auth/2fa/enable — verify TOTP code and activate 2FA
const enable2FA = async (req, res) => {
    try {
        const { token: totpToken } = req.body;
        if (!totpToken) return res.status(400).json({ success: false, message: 'Verification code required' });

        const user = await User.findById(req.user._id);
        if (!user.twoFactorSecret) {
            return res.status(400).json({ success: false, message: 'Run 2FA setup first' });
        }

        const secret = decrypt(user.twoFactorSecret, req.dataKey);
        if (!verifySync({ token: totpToken, secret })?.valid) {
            return res.status(401).json({ success: false, message: 'Invalid verification code' });
        }

        user.twoFactorEnabled = true;
        await user.save();

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

        const secret = decrypt(user.twoFactorSecret, req.dataKey);
        if (!verifySync({ token: totpToken, secret })?.valid) {
            return res.status(401).json({ success: false, message: 'Invalid verification code' });
        }

        user.twoFactorEnabled = false;
        user.twoFactorSecret  = undefined;
        await user.save();

        res.json({ success: true, message: 'Two-factor authentication disabled' });
    } catch (error) {
        console.error('2FA disable error:', error);
        res.status(500).json({ success: false, message: 'Failed to disable 2FA' });
    }
};

// POST /api/auth/2fa/verify — called with tempToken after login step-1
const verify2FA = async (req, res) => {
    try {
        const { tempToken, token: totpToken } = req.body;
        if (!tempToken || !totpToken) {
            return res.status(400).json({ success: false, message: 'tempToken and token are required' });
        }

        let decoded;
        try {
            decoded = jwt.verify(tempToken, process.env.JWT_SECRET);
        } catch {
            return res.status(401).json({ success: false, message: 'Expired or invalid session. Please log in again.' });
        }

        if (decoded.type !== 'temp_2fa') {
            return res.status(401).json({ success: false, message: 'Invalid token type' });
        }

        const user = await User.findById(decoded.id);
        if (!user) return res.status(401).json({ success: false, message: 'User not found' });

        const rawKey  = masterDecrypt(user.encryptedDataKey);
        const dataKey = Buffer.from(rawKey, 'hex');
        const secret  = decrypt(user.twoFactorSecret, dataKey);

        if (!verifySync({ token: totpToken, secret })?.valid) {
            return res.status(401).json({ success: false, message: 'Invalid verification code' });
        }

        res.json({
            success: true,
            data: {
                _id:              user._id,
                name:             safeDecrypt(user.name, dataKey),
                email:            safeDecrypt(user.email, dataKey),
                currency:         user.currency,
                role:             user.role,
                twoFactorEnabled: user.twoFactorEnabled,
                token:            generateToken(user._id)
            }
        });
    } catch (error) {
        console.error('2FA verify error:', error);
        res.status(500).json({ success: false, message: 'Verification failed' });
    }
};

module.exports = { setup2FA, enable2FA, disable2FA, verify2FA };
