/**
 * mailer.js — thin nodemailer / Resend wrapper. Falls back to logging the
 * message to the console when no provider is configured (the default dev
 * posture). In production that fallback redacts one-time codes, so anyone
 * with access to the hosting logs can't use them to take over accounts.
 *
 * Environment variables (all optional in dev):
 *   RESEND_API_KEY  send through Resend's HTTPS API (takes priority over SMTP)
 *   SMTP_HOST       hostname of the SMTP server
 *   SMTP_PORT       port (defaults to 587)
 *   SMTP_USER       username (omit for unauthenticated relays)
 *   SMTP_PASS       password
 *   SMTP_FROM       "From" header, e.g. "FinAssist <no-reply@example.com>"
 *   FRONTEND_URL    base URL for links in emails
 *
 * Every value interpolated into HTML goes through escapeHtml().
 */

const nodemailer = require('nodemailer');

let _transporter = null;

function _getTransporter() {
    if (_transporter) return _transporter;
    if (!process.env.SMTP_HOST) return null;

    _transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_PORT === '465',
        ...(process.env.SMTP_USER ? {
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        } : {}),
    });
    return _transporter;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const _redact = (s) => String(s).replace(/\b\d{6}\b/g, '••••••');

// Send via Resend's HTTP API (https, port 443). Required on hosts that block
// outbound SMTP ports — e.g. Render's free tier.
async function _sendViaResend({ to, subject, text, html }) {
    const from = process.env.SMTP_FROM || 'FinAssist <onboarding@resend.dev>';
    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from, to, subject, text, html }),
    });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Resend API ${res.status}: ${body}`);
    }
}

async function sendMail({ to, subject, text, html }) {
    if (process.env.RESEND_API_KEY) {
        await _sendViaResend({ to, subject, text, html });
        return;
    }

    const transporter = _getTransporter();
    if (!transporter) {
        if (process.env.NODE_ENV === 'production') {
            // Never put a usable code in production logs.
            console.warn('mailer: no mail provider configured; message not sent');
            console.log(`mail (not sent) to=${to} subject="${_redact(subject)}"`);
            return;
        }
        // Dev: surface the email content to the console so the developer can
        // copy the code without an SMTP setup.
        console.log('\n──── mail (no mail provider set; logging instead) ─────');
        console.log('To:     ', to);
        console.log('Subject:', subject);
        console.log(text);
        console.log('──────────────────────────────────────────────────────\n');
        return;
    }

    const from = process.env.SMTP_FROM || 'FinAssist <no-reply@finassist.local>';
    await transporter.sendMail({ from, to, subject, text, html });
}

// Shared shell so every email looks consistent and on-brand (FinAssist purple).
// `heading` is escaped here; `bodyHtml` is built by the callers from escaped parts.
function _wrap(heading, bodyHtml) {
    return `<!doctype html><html><body style="margin:0;background:#09090b;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#e4e4e7;padding:32px 0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="440" cellpadding="0" cellspacing="0" style="max-width:440px;background:#18181b;border:1px solid rgba(255,255,255,0.06);border-radius:20px;overflow:hidden">
      <tr><td style="background:linear-gradient(135deg,#7c3aed,#a855f7);padding:24px 32px">
        <span style="font-size:20px;font-weight:600;color:#fff;letter-spacing:.3px">FinAssist</span>
      </td></tr>
      <tr><td style="padding:32px">
        <h1 style="margin:0 0 16px;font-size:20px;color:#fff">${escapeHtml(heading)}</h1>
        ${bodyHtml}
      </td></tr>
      <tr><td style="padding:0 32px 28px"><p style="margin:0;font-size:12px;color:#71717a">If you didn't request this, you can safely ignore this email.</p></td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

function _codeBlock(code) {
    return `<div style="text-align:center;margin:24px 0">
               <span style="display:inline-block;font-size:34px;font-weight:700;letter-spacing:10px;color:#fff;background:#0b0b0d;border:1px solid rgba(168,85,247,0.4);border-radius:14px;padding:16px 24px">${escapeHtml(code)}</span>
             </div>`;
}

const _appUrl = () => (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');

// 6-digit verification code shown prominently. The code lives only here.
async function sendVerificationCodeEmail(to, code) {
    await sendMail({
        to,
        subject: `${code} is your FinAssist verification code`,
        text:
            `Welcome to FinAssist!\n\n` +
            `Your verification code is: ${code}\n\n` +
            `Enter it in the app to confirm your email. It expires in 15 minutes.\n\n` +
            `If you didn't create an account, you can ignore this message.\n`,
        html: _wrap('Confirm your email',
            `<p style="margin:0 0 20px;color:#a1a1aa;font-size:14px">Enter this code in the app to finish setting up your account. It expires in <strong style="color:#e4e4e7">15 minutes</strong>.</p>
             ${_codeBlock(code)}`),
    });
}

// Password-reset code. Same look as the verification code email.
async function sendPasswordResetEmail(to, code) {
    await sendMail({
        to,
        subject: `${code} is your FinAssist password reset code`,
        text:
            `We received a request to reset your FinAssist password.\n\n` +
            `Your reset code is: ${code}\n\n` +
            `Enter it in the app to set a new password. It expires in 15 minutes.\n\n` +
            `If you didn't request this, you can ignore this email — your password stays the same.\n`,
        html: _wrap('Reset your password',
            `<p style="margin:0 0 20px;color:#a1a1aa;font-size:14px">Enter this code in the app to set a new password. It expires in <strong style="color:#e4e4e7">15 minutes</strong>. If you didn't request a reset, ignore this email.</p>
             ${_codeBlock(code)}`),
    });
}

// Code sent to a NEW address before an email change takes effect.
async function sendEmailChangeCodeEmail(to, code) {
    await sendMail({
        to,
        subject: `${code} confirms your new FinAssist email`,
        text:
            `Someone asked to move a FinAssist account to this address.\n\n` +
            `Your confirmation code is: ${code}\n\n` +
            `Enter it in Settings to finish the change. It expires in 15 minutes.\n`,
        html: _wrap('Confirm your new email',
            `<p style="margin:0 0 20px;color:#a1a1aa;font-size:14px">Enter this code in Settings to move your FinAssist account to this address. It expires in <strong style="color:#e4e4e7">15 minutes</strong>.</p>
             ${_codeBlock(code)}`),
    });
}

// Notice to the OLD address once an email change completes.
async function sendEmailChangedNotice(to) {
    await sendMail({
        to,
        subject: 'Your FinAssist email was changed',
        text:
            `The email on your FinAssist account was just changed and this address no longer signs in.\n\n` +
            `If you didn't do this, reset your password from the sign-in page right away.\n`,
        html: _wrap('Your sign-in email was changed',
            `<p style="margin:0;color:#a1a1aa;font-size:14px">The email on your FinAssist account was just changed and this address no longer signs in. If you didn't do this, reset your password from the sign-in page right away.</p>`),
    });
}

// Sent instead of a second account when someone registers an address that
// already has one — the sign-up screen itself looks identical either way.
async function sendAccountExistsEmail(to) {
    const appUrl = _appUrl();
    await sendMail({
        to,
        subject: 'You already have a FinAssist account',
        text:
            `Someone tried to create a FinAssist account with this email, but you already have one.\n\n` +
            `Sign in at ${appUrl}/login, or reset your password there if you've forgotten it.\n` +
            `If this wasn't you, you can ignore this message.\n`,
        html: _wrap('You already have an account',
            `<p style="margin:0 0 16px;color:#a1a1aa;font-size:14px">Someone tried to create a FinAssist account with this email, but you already have one. Sign in, or reset your password from the sign-in page if you've forgotten it.</p>
             <div style="text-align:center;margin:24px 0">
               <a href="${escapeHtml(appUrl)}/login" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 28px;border-radius:999px">Go to sign in</a>
             </div>`),
    });
}

// "Thank you for joining" — sent once, the moment an address is proven.
function buildWelcomeEmail(name, appUrl = _appUrl()) {
    const first = (typeof name === 'string' && name.trim()) ? name.trim().split(/\s+/)[0] : 'there';
    return {
        subject: 'Welcome to FinAssist 🎉',
        text:
            `Hi ${first},\n\n` +
            `Thank you for joining FinAssist — your account is live!\n\n` +
            `You can now track expenses, set savings goals, and see where your money goes.\n` +
            `Jump in: ${appUrl}/dashboard\n\n` +
            `Here's to taking control of your finances.\n— The FinAssist team\n`,
        html: _wrap(`Welcome aboard, ${first} 🎉`,
            `<p style="margin:0 0 16px;color:#a1a1aa;font-size:14px">Thank you for joining <strong style="color:#e4e4e7">FinAssist</strong> — your account is live. You're all set to track expenses, set savings goals, and finally see where your money goes.</p>
             <div style="text-align:center;margin:24px 0">
               <a href="${escapeHtml(appUrl)}/dashboard" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 28px;border-radius:999px">Open your dashboard</a>
             </div>
             <p style="margin:0;color:#71717a;font-size:13px">Here's to taking control of your finances. 💜</p>`),
    };
}

async function sendWelcomeEmail(to, name) {
    await sendMail({ to, ...buildWelcomeEmail(name) });
}

module.exports = {
    sendMail,
    sendVerificationCodeEmail,
    sendPasswordResetEmail,
    sendEmailChangeCodeEmail,
    sendEmailChangedNotice,
    sendAccountExistsEmail,
    sendWelcomeEmail,
    buildWelcomeEmail,
    escapeHtml,
};
