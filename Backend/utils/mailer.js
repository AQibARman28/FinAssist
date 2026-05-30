/**
 * mailer.js — thin nodemailer wrapper. Falls back to logging the message
 * to the console when SMTP_HOST is not set (the default dev posture).
 *
 * Environment variables (all optional in dev):
 *   SMTP_HOST     hostname of the SMTP server
 *   SMTP_PORT     port (defaults to 587)
 *   SMTP_USER     username (omit for unauthenticated relays)
 *   SMTP_PASS     password
 *   SMTP_FROM     "From" header, e.g. "FinAssist <no-reply@example.com>"
 *   FRONTEND_URL  base URL for verification links (used by sendVerificationEmail)
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

async function sendMail({ to, subject, text, html }) {
    const transporter = _getTransporter();
    if (!transporter) {
        // Dev: surface the email content to the console so the developer can
        // follow the verification link without an SMTP setup.
        console.log('\n──── mail (no SMTP_HOST set; logging instead) ─────');
        console.log('To:     ', to);
        console.log('Subject:', subject);
        console.log(text);
        console.log('────────────────────────────────────────────────────\n');
        return;
    }

    const from = process.env.SMTP_FROM || 'FinAssist <no-reply@finassist.local>';
    await transporter.sendMail({ from, to, subject, text, html });
}

// Shared shell so both emails look consistent and on-brand (FinAssist purple).
function _wrap(heading, bodyHtml) {
    return `<!doctype html><html><body style="margin:0;background:#09090b;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#e4e4e7;padding:32px 0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="440" cellpadding="0" cellspacing="0" style="max-width:440px;background:#18181b;border:1px solid rgba(255,255,255,0.06);border-radius:20px;overflow:hidden">
      <tr><td style="background:linear-gradient(135deg,#7c3aed,#a855f7);padding:24px 32px">
        <span style="font-size:20px;font-weight:600;color:#fff;letter-spacing:.3px">FinAssist</span>
      </td></tr>
      <tr><td style="padding:32px">
        <h1 style="margin:0 0 16px;font-size:20px;color:#fff">${heading}</h1>
        ${bodyHtml}
      </td></tr>
      <tr><td style="padding:0 32px 28px"><p style="margin:0;font-size:12px;color:#71717a">If you didn't request this, you can safely ignore this email.</p></td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

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
        html: _wrap("Confirm your email",
            `<p style="margin:0 0 20px;color:#a1a1aa;font-size:14px">Enter this code in the app to finish setting up your account. It expires in <strong style="color:#e4e4e7">15 minutes</strong>.</p>
             <div style="text-align:center;margin:24px 0">
               <span style="display:inline-block;font-size:34px;font-weight:700;letter-spacing:10px;color:#fff;background:#0b0b0d;border:1px solid rgba(168,85,247,0.4);border-radius:14px;padding:16px 24px">${code}</span>
             </div>`),
    });
}

// "Thank you for joining" — sent once, the moment a user becomes verified/live.
async function sendWelcomeEmail(to, name) {
    const appUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
    const first = (typeof name === 'string' && name.trim()) ? name.trim().split(/\s+/)[0] : 'there';
    await sendMail({
        to,
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
               <a href="${appUrl}/dashboard" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 28px;border-radius:999px">Open your dashboard</a>
             </div>
             <p style="margin:0;color:#71717a;font-size:13px">Here's to taking control of your finances. 💜</p>`),
    });
}

async function sendVerificationEmail(to, token) {
    const base = process.env.FRONTEND_URL || 'http://localhost:3000';
    // The link goes through the API so the user can click the email and have
    // it land verified without involving the frontend at all. The API then
    // redirects the browser to /login?verified=1.
    const apiBase = (process.env.NEXT_PUBLIC_API_URL || `http://localhost:${process.env.PORT || 5000}/api`)
        .replace(/\/$/, '');
    const url = `${apiBase}/auth/verify-email?token=${encodeURIComponent(token)}`;

    await sendMail({
        to,
        subject: 'Verify your FinAssist email',
        text:
            `Welcome to FinAssist.\n\n` +
            `Confirm your email by opening this link within 24 hours:\n${url}\n\n` +
            `If you did not create an account, you can ignore this message.\n`,
    });
    return url;
}

module.exports = { sendMail, sendVerificationEmail, sendVerificationCodeEmail, sendWelcomeEmail };
