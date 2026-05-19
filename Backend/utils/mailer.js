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

module.exports = { sendMail, sendVerificationEmail };
