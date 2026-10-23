const native = require('../utils/nativeCrypto');
const QRCode = require('qrcode');
const User = require('../models/User');
const { masterDecrypt, FIELDS, sealField, openField } = require('../utils/encryption');
const { hasLegacyKeyBundle, regenerateUserKeyBundle } = require('../utils/keyManagement');
const { COOKIE_TEMP, establishSession, clearTempCookie, jwtSecrets } = require('../utils/sessions');
const { checkAndRecordTotp, checkSecondFactor, generateRecoveryCodes } = require('../utils/totpGuard');
const { logAudit } = require('../utils/audit');

// New enrolments use SHA-1 — what common authenticator apps compute whatever
// the otpauth URI says. Existing enrolments keep their stored algorithm.
const NEW_ENROLMENT_ALGORITHM = 'sha1';

function _secondFactorFailure(res, result) {
    return res.status(result.status).json({
        success: false,
        message: result.status === 423
            ? 'Too many failed 2FA attempts. Try again in a few minutes.'
            : result.replay
                ? 'Code already used. Wait for the next 30-second window.'
                : 'Invalid verification code',
    });
}

// POST /api/auth/2fa/setup — generate a TOTP secret + QR code (requires auth).
// Refused while 2FA is on: re-keying a live secret without a code would let
// anyone holding a session move 2FA to their own device.
const setup2FA = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (user.twoFactorEnabled) {
            return res.status(409).json({ success: false, message: 'Two-factor authentication is already on. Turn it off first to enrol a new device.' });
        }

        const secret = native.generateTotpSecret();
        const otpauthUrl = native.totpOtpauthUri(req.user._email, 'FinAssist', secret, NEW_ENROLMENT_ALGORITHM);
        const qrDataUrl = await QRCode.toDataURL(otpauthUrl);

        // Store the encrypted secret (NOT enabled yet — the user must verify first).
        user.twoFactorSecret = await sealField(secret, req.dataKey, FIELDS.userTotpSecret, user._id);
        user.twoFactorAlgorithm = NEW_ENROLMENT_ALGORITHM;
        await user.save();

        res.json({ success: true, data: { qrCode: qrDataUrl, manualKey: secret, otpauthUrl } });
    } catch (error) {
        console.error('2FA setup error:', error);
        res.status(500).json({ success: false, message: 'Failed to set up 2FA' });
    }
};

// POST /api/auth/2fa/enable — verify a TOTP code, activate 2FA, and hand out
// one-time recovery codes (shown once; only their hashes are stored).
const enable2FA = async (req, res) => {
    try {
        const { token: totpToken } = req.body;

        const user = await User.findById(req.user._id);
        if (user.twoFactorEnabled) {
            return res.status(409).json({ success: false, message: 'Two-factor authentication is already on.' });
        }
        if (!user.twoFactorSecret) {
            return res.status(400).json({ success: false, message: 'Run 2FA setup first' });
        }

        const result = await checkAndRecordTotp(user, req.dataKey, totpToken);
        if (!result.ok) return _secondFactorFailure(res, result);

        const { codes, hashes } = generateRecoveryCodes();
        user.twoFactorEnabled = true;
        user.twoFactorRecoveryCodes = hashes;
        await user.save();
        logAudit(req, '2fa.enable', user._id);
        res.json({ success: true, message: 'Two-factor authentication enabled', recoveryCodes: codes });
    } catch (error) {
        console.error('2FA enable error:', error);
        res.status(500).json({ success: false, message: 'Failed to enable 2FA' });
    }
};

// POST /api/auth/2fa/disable — needs an authenticator code or a recovery code.
const disable2FA = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user.twoFactorEnabled) {
            return res.status(400).json({ success: false, message: 'Two-factor authentication is not on.' });
        }

        const result = await checkSecondFactor(user, req.dataKey, req.body);
        if (!result.ok) return _secondFactorFailure(res, result);

        user.twoFactorEnabled = false;
        user.twoFactorSecret  = undefined;
        user.twoFactorAlgorithm = undefined;
        user.twoFactorRecoveryCodes = [];
        await user.save();
        logAudit(req, '2fa.disable', user._id, req.body.recoveryCode ? { via: 'recovery_code' } : null);
        res.json({ success: true, message: 'Two-factor authentication disabled' });
    } catch (error) {
        console.error('2FA disable error:', error);
        res.status(500).json({ success: false, message: 'Failed to disable 2FA' });
    }
};

// POST /api/auth/2fa/verify — completes sign-in using the fa_temp cookie set
// by /auth/login. Accepts { token } or { recoveryCode }.
const verify2FA = async (req, res) => {
    try {
        const tempToken = req.cookies?.[COOKIE_TEMP];
        if (!tempToken) {
            return res.status(400).json({ success: false, message: '2FA gate missing or expired' });
        }

        let decoded;
        try {
            decoded = native.verifyJwt(tempToken, jwtSecrets());
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

        const result = await checkSecondFactor(user, dataKey, req.body);
        if (!result.ok) return _secondFactorFailure(res, result);
        if (req.body.recoveryCode) logAudit(req, '2fa.recovery_used', user._id, { remaining: result.remaining });

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
                name:             (await openField(user.name, dataKey, FIELDS.userName, user._id)),
                email:            (await openField(user.email, dataKey, FIELDS.userEmail, user._id)),
                currency:         user.currency,
                role:             user.role,
                twoFactorEnabled: user.twoFactorEnabled,
            },
            ...(req.body.recoveryCode ? { recoveryCodesRemaining: result.remaining } : {}),
        });
    } catch (error) {
        console.error('2FA verify error:', error);
        res.status(500).json({ success: false, message: 'Verification failed' });
    }
};

module.exports = { setup2FA, enable2FA, disable2FA, verify2FA };
