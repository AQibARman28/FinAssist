"use client";

import { useState } from "react";
import { User, Mail, DollarSign, Lock, Save, Loader2, CheckCircle, ShieldCheck, ShieldOff, ScanLine, KeyRound, Copy, Check } from "lucide-react";
import Image from "next/image";
import { api } from "@/lib/api";
import { apiErrorMessage } from "@/lib/apiError";
import { useAuthStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const CURRENCIES = ["BDT", "USD", "EUR", "GBP", "INR", "CAD", "AUD", "SGD", "AED"];

const inputClass = "w-full bg-zinc-800/50 border border-zinc-700 focus:border-purple-500 text-zinc-200 placeholder:text-zinc-600 pl-9 pr-4 py-2.5 rounded-xl outline-none transition-colors";
const codeInputClass = "w-48 bg-zinc-800/50 border border-zinc-700 focus:border-purple-500 text-zinc-200 placeholder:text-zinc-600 pl-9 pr-4 py-2.5 rounded-xl outline-none transition-colors tracking-widest text-center";

const formatRecovery = (v: string) => {
    const raw = v.toUpperCase().replace(/[^A-Z2-7]/g, "").slice(0, 10);
    return raw.length > 5 ? `${raw.slice(0, 5)}-${raw.slice(5)}` : raw;
};

export default function SettingsPage() {
    const { user, setUser } = useAuthStore();
    const [form, setForm] = useState({ name: "", email: "", currency: "BDT", password: "", confirmPassword: "", currentPassword: "", totp: "" });
    const [isLoading, setIsLoading]   = useState(false);
    const [success, setSuccess]       = useState<string | null>(null);
    const [error, setError]           = useState<string | null>(null);

    // Email change waiting for the code sent to the new address
    const [pendingEmail, setPendingEmail] = useState<string | null>(null);
    const [emailCode, setEmailCode]       = useState("");

    // 2FA state
    const [tfaStep, setTfaStep]       = useState<"idle" | "setup" | "disable" | "codes">("idle");
    const [tfaQR, setTfaQR]           = useState<string | null>(null);
    const [tfaManual, setTfaManual]   = useState<string | null>(null);
    const [tfaCode, setTfaCode]       = useState("");
    const [tfaUseRecovery, setTfaUseRecovery] = useState(false);
    const [recoveryCodes, setRecoveryCodes]   = useState<string[]>([]);
    const [codesCopied, setCodesCopied]       = useState(false);
    const [tfaLoading, setTfaLoading] = useState(false);
    const [tfaError, setTfaError]     = useState<string | null>(null);
    const [tfaSuccess, setTfaSuccess] = useState<string | null>(null);

    // Mirror the stored profile into the form whenever the user object changes
    // (first read from storage, and every save that returns a fresh user).
    // Adjusted during render — React's "store the previous value" pattern —
    // instead of in an effect, so the form never paints with stale values.
    const [formUser, setFormUser] = useState<typeof user>(null);
    if (user !== formUser) {
        setFormUser(user);
        if (user) setForm((f) => ({ ...f, name: user.name, email: user.email, currency: user.currency }));
    }

    // Changing the email or password is a sensitive change: the server wants
    // the current password (and an authenticator code when 2FA is on).
    const emailChanged = !!user && form.email.trim().toLowerCase() !== user.email.trim().toLowerCase();
    const sensitive = emailChanged || form.password.length > 0;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);

        if (form.password && form.password !== form.confirmPassword) {
            setError("Passwords do not match");
            return;
        }
        if (form.password && form.password.length < 8) {
            setError("Your new password needs at least 8 characters");
            return;
        }

        // Send only what changed.
        const payload: Record<string, string> = {};
        if (user && form.name !== user.name) payload.name = form.name;
        if (user && form.currency !== user.currency) payload.currency = form.currency;
        if (emailChanged) payload.email = form.email.trim();
        if (form.password) payload.password = form.password;
        if (sensitive) {
            payload.currentPassword = form.currentPassword;
            if (user?.twoFactorEnabled) payload.totp = form.totp;
        }
        if (Object.keys(payload).length === 0) {
            setSuccess("Nothing to save");
            return;
        }

        setIsLoading(true);
        try {
            const res = await api.put("/auth/profile", payload);
            setUser(res.data.data);
            if (res.data.emailChangePending) {
                setPendingEmail(res.data.pendingEmail || form.email.trim());
                setSuccess(null);
            } else {
                setSuccess(form.password ? "Password changed. Your other sessions were signed out." : "Profile updated");
            }
            setForm((f) => ({ ...f, password: "", confirmPassword: "", currentPassword: "", totp: "", email: res.data.data.email }));
        } catch (err: unknown) {
            setError(apiErrorMessage(err, "Failed to update profile"));
        } finally {
            setIsLoading(false);
        }
    };

    const confirmEmail = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setIsLoading(true);
        try {
            const res = await api.post("/auth/profile/email/confirm", { code: emailCode });
            setUser(res.data.data);
            setForm((f) => ({ ...f, email: res.data.data.email }));
            setPendingEmail(null);
            setEmailCode("");
            setSuccess("Email changed. A notice went to your old address.");
        } catch (err: unknown) {
            setError(apiErrorMessage(err, "That code didn't work"));
            setEmailCode("");
        } finally {
            setIsLoading(false);
        }
    };

    const startSetup2FA = async () => {
        setTfaError(null);
        setTfaSuccess(null);
        setTfaLoading(true);
        try {
            const res = await api.post("/auth/2fa/setup");
            setTfaQR(res.data.data.qrCode);
            setTfaManual(res.data.data.manualKey);
            setTfaStep("setup");
        } catch (err: unknown) {
            setTfaError(apiErrorMessage(err, "Failed to start 2FA setup"));
        } finally {
            setTfaLoading(false);
        }
    };

    const confirmEnable2FA = async (e: React.FormEvent) => {
        e.preventDefault();
        setTfaError(null);
        setTfaLoading(true);
        try {
            const res = await api.post("/auth/2fa/enable", { token: tfaCode });
            if (user) setUser({ ...user, twoFactorEnabled: true });
            setRecoveryCodes(res.data.recoveryCodes || []);
            setCodesCopied(false);
            setTfaStep("codes");
            setTfaCode("");
            setTfaQR(null);
        } catch (err: unknown) {
            setTfaError(apiErrorMessage(err, "Invalid code. Try again."));
            setTfaCode("");
        } finally {
            setTfaLoading(false);
        }
    };

    const copyRecoveryCodes = async () => {
        try {
            await navigator.clipboard.writeText(recoveryCodes.join("\n"));
            setCodesCopied(true);
        } catch {
            setTfaError("Couldn't copy automatically. Select the codes and copy them by hand.");
        }
    };

    const confirmDisable2FA = async (e: React.FormEvent) => {
        e.preventDefault();
        setTfaError(null);
        setTfaLoading(true);
        try {
            const body = tfaUseRecovery ? { recoveryCode: tfaCode } : { token: tfaCode };
            await api.post("/auth/2fa/disable", body);
            if (user) setUser({ ...user, twoFactorEnabled: false });
            setTfaSuccess("Two-factor authentication disabled.");
            setTfaStep("idle");
            setTfaCode("");
            setTfaUseRecovery(false);
        } catch (err: unknown) {
            setTfaError(apiErrorMessage(err, "Invalid code. Try again."));
            setTfaCode("");
        } finally {
            setTfaLoading(false);
        }
    };

    const disableReady = tfaUseRecovery ? /^[A-Z2-7]{5}-[A-Z2-7]{5}$/.test(tfaCode) : tfaCode.length === 6;

    return (
        <div className="p-6 max-w-2xl mx-auto space-y-6">
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-white">Settings</h1>
                <p className="text-zinc-500 text-sm">Manage your account and preferences</p>
            </div>

            {/* Profile section */}
            <div className="p-6 rounded-3xl bg-zinc-900/50 border border-white/5">
                <h2 className="text-lg font-semibold text-white mb-6">Profile</h2>

                {error && (
                    <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm" role="alert">{error}</div>
                )}
                {success && (
                    <div className="mb-4 p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm flex items-center gap-2" role="status">
                        <CheckCircle className="w-4 h-4" /> {success}
                    </div>
                )}

                {pendingEmail ? (
                    <form onSubmit={confirmEmail} className="space-y-4">
                        <p className="text-zinc-300 text-sm">
                            We sent a 6-digit code to <span className="text-white font-medium">{pendingEmail}</span>. Your email changes once you enter it.
                        </p>
                        <div className="relative">
                            <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                            <input
                                id="email-change-code"
                                type="text"
                                inputMode="numeric"
                                autoComplete="one-time-code"
                                maxLength={6}
                                placeholder="000000"
                                aria-label="Email change code"
                                value={emailCode}
                                onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, ""))}
                                className={codeInputClass}
                                required
                                autoFocus
                            />
                        </div>
                        <div className="flex gap-3">
                            <button
                                type="submit"
                                disabled={isLoading || emailCode.length !== 6}
                                className={cn(
                                    "flex items-center gap-2 bg-gradient-to-r from-violet-600 to-purple-600 text-white px-5 py-2 rounded-xl text-sm font-medium transition-all",
                                    (isLoading || emailCode.length !== 6) && "opacity-50 cursor-not-allowed"
                                )}
                            >
                                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                                Confirm new email
                            </button>
                            <button type="button" onClick={() => { setPendingEmail(null); setEmailCode(""); setError(null); }} className="text-zinc-500 hover:text-zinc-400 text-sm px-3 py-2">
                                Keep my current email
                            </button>
                        </div>
                    </form>
                ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <div>
                            <label htmlFor="profile-name" className="block text-zinc-400 text-sm mb-2">Full Name</label>
                            <div className="relative">
                                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                                <input
                                    id="profile-name"
                                    type="text"
                                    value={form.name}
                                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                                    className={inputClass}
                                    required
                                />
                            </div>
                        </div>
                        <div>
                            <label htmlFor="profile-email" className="block text-zinc-400 text-sm mb-2">Email</label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                                <input
                                    id="profile-email"
                                    type="email"
                                    value={form.email}
                                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                                    className={inputClass}
                                    required
                                />
                            </div>
                        </div>
                    </div>

                    <div>
                        <label htmlFor="profile-currency" className="block text-zinc-400 text-sm mb-2">Currency</label>
                        <div className="relative">
                            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                            <select
                                id="profile-currency"
                                value={form.currency}
                                onChange={(e) => setForm({ ...form, currency: e.target.value })}
                                className={cn(inputClass, "appearance-none")}
                            >
                                {CURRENCIES.map((c) => (
                                    <option key={c} value={c} className="bg-zinc-900">{c}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <hr className="border-white/5" />

                    <p className="text-zinc-500 text-sm">Change password — leave blank to keep current</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <div>
                            <label htmlFor="profile-new-password" className="block text-zinc-400 text-sm mb-2">New Password</label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                                <input
                                    id="profile-new-password"
                                    type="password"
                                    autoComplete="new-password"
                                    value={form.password}
                                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                                    placeholder="At least 8 characters"
                                    className={inputClass}
                                />
                            </div>
                        </div>
                        <div>
                            <label htmlFor="profile-confirm-password" className="block text-zinc-400 text-sm mb-2">Confirm Password</label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                                <input
                                    id="profile-confirm-password"
                                    type="password"
                                    autoComplete="new-password"
                                    value={form.confirmPassword}
                                    onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                                    className={inputClass}
                                />
                            </div>
                        </div>
                    </div>

                    {sensitive && (
                        <div className="p-4 rounded-2xl bg-purple-500/5 border border-purple-500/20 space-y-4">
                            <p className="text-zinc-300 text-sm flex items-center gap-2">
                                <KeyRound className="w-4 h-4 text-purple-400" />
                                Confirm it&apos;s you to change your {emailChanged && form.password ? "email and password" : emailChanged ? "email" : "password"}.
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                <div>
                                    <label htmlFor="profile-current-password" className="block text-zinc-400 text-sm mb-2">Current password</label>
                                    <div className="relative">
                                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                                        <input
                                            id="profile-current-password"
                                            type="password"
                                            autoComplete="current-password"
                                            value={form.currentPassword}
                                            onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
                                            className={inputClass}
                                            required
                                        />
                                    </div>
                                </div>
                                {user?.twoFactorEnabled && (
                                    <div>
                                        <label htmlFor="profile-totp" className="block text-zinc-400 text-sm mb-2">Authenticator code</label>
                                        <div className="relative">
                                            <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                                            <input
                                                id="profile-totp"
                                                type="text"
                                                inputMode="numeric"
                                                autoComplete="one-time-code"
                                                maxLength={6}
                                                placeholder="000000"
                                                value={form.totp}
                                                onChange={(e) => setForm({ ...form, totp: e.target.value.replace(/\D/g, "") })}
                                                className={cn(inputClass, "tracking-widest")}
                                                required
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={isLoading}
                        className={cn(
                            "flex items-center gap-2 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white font-medium px-6 py-2.5 rounded-full transition-all",
                            isLoading && "opacity-70 cursor-wait"
                        )}
                    >
                        {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Save Changes
                    </button>
                </form>
                )}
            </div>

            {/* Two-Factor Authentication section */}
            <div className="p-6 rounded-3xl bg-zinc-900/50 border border-white/5">
                <div className="flex items-center justify-between mb-2">
                    <h2 className="text-lg font-semibold text-white">Two-Factor Authentication</h2>
                    <span className={cn(
                        "text-xs px-2.5 py-1 rounded-full font-medium",
                        user?.twoFactorEnabled
                            ? "bg-green-500/10 text-green-400 border border-green-500/20"
                            : "bg-zinc-800 text-zinc-500 border border-zinc-700"
                    )}>
                        {user?.twoFactorEnabled ? "Enabled" : "Disabled"}
                    </span>
                </div>
                <p className="text-zinc-500 text-sm mb-5">
                    Use an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password) for an extra layer of security.
                </p>

                {tfaError && (
                    <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm" role="alert">{tfaError}</div>
                )}
                {tfaSuccess && (
                    <div className="mb-4 p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm flex items-center gap-2" role="status">
                        <CheckCircle className="w-4 h-4" /> {tfaSuccess}
                    </div>
                )}

                {tfaStep === "idle" && (
                    <div>
                        {!user?.twoFactorEnabled ? (
                            <button
                                onClick={startSetup2FA}
                                disabled={tfaLoading}
                                className="flex items-center gap-2 bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/30 text-purple-300 px-5 py-2.5 rounded-xl text-sm font-medium transition-all"
                            >
                                {tfaLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                                Enable 2FA
                            </button>
                        ) : (
                            <button
                                onClick={() => { setTfaStep("disable"); setTfaError(null); setTfaSuccess(null); }}
                                className="flex items-center gap-2 bg-red-600/10 hover:bg-red-600/20 border border-red-500/20 text-red-400 px-5 py-2.5 rounded-xl text-sm font-medium transition-all"
                            >
                                <ShieldOff className="w-4 h-4" />
                                Disable 2FA
                            </button>
                        )}
                    </div>
                )}

                {tfaStep === "setup" && tfaQR && (
                    <div className="space-y-4">
                        <p className="text-zinc-400 text-sm">1. Scan this QR code with your authenticator app</p>
                        <div className="inline-block p-3 bg-white rounded-xl">
                            <Image src={tfaQR} alt="2FA QR code" width={180} height={180} unoptimized />
                        </div>
                        {tfaManual && (
                            <div>
                                <p className="text-zinc-500 text-xs mb-1">Or enter this key manually:</p>
                                <code className="block bg-zinc-800 text-purple-300 text-xs px-3 py-2 rounded-lg tracking-widest break-all">{tfaManual}</code>
                            </div>
                        )}
                        <form onSubmit={confirmEnable2FA} className="space-y-3">
                            <p className="text-zinc-400 text-sm">2. Enter the 6-digit code to confirm</p>
                            <div className="relative">
                                <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                                <input
                                    id="tfa-enable-code"
                                    type="text"
                                    inputMode="numeric"
                                    autoComplete="one-time-code"
                                    pattern="[0-9]{6}"
                                    maxLength={6}
                                    placeholder="000000"
                                    aria-label="Authenticator code"
                                    value={tfaCode}
                                    onChange={(e) => setTfaCode(e.target.value.replace(/\D/g, ""))}
                                    className={codeInputClass}
                                    required
                                    autoFocus
                                />
                            </div>
                            <div className="flex gap-3">
                                <button
                                    type="submit"
                                    disabled={tfaLoading || tfaCode.length !== 6}
                                    className={cn(
                                        "flex items-center gap-2 bg-gradient-to-r from-violet-600 to-purple-600 text-white px-5 py-2 rounded-xl text-sm font-medium transition-all",
                                        (tfaLoading || tfaCode.length !== 6) && "opacity-50 cursor-not-allowed"
                                    )}
                                >
                                    {tfaLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                                    Confirm &amp; Enable
                                </button>
                                <button
                                    type="button"
                                    onClick={() => { setTfaStep("idle"); setTfaCode(""); setTfaQR(null); setTfaError(null); }}
                                    className="text-zinc-500 hover:text-zinc-400 text-sm px-3 py-2"
                                >
                                    Cancel
                                </button>
                            </div>
                        </form>
                    </div>
                )}

                {tfaStep === "codes" && (
                    <div className="space-y-4">
                        <p className="text-zinc-300 text-sm">
                            Two-factor authentication is on. Save these recovery codes somewhere safe. Each one signs you in once if you lose your phone, and they won&apos;t be shown again.
                        </p>
                        <ul className="grid grid-cols-2 gap-2 p-4 rounded-2xl bg-zinc-950 border border-white/5 font-mono text-sm text-purple-200 select-all" aria-label="Recovery codes">
                            {recoveryCodes.map((c) => <li key={c}>{c}</li>)}
                        </ul>
                        <div className="flex flex-wrap gap-3">
                            <button
                                type="button"
                                onClick={copyRecoveryCodes}
                                className="flex items-center gap-2 bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/30 text-purple-300 px-4 py-2 rounded-xl text-sm font-medium transition-all"
                            >
                                {codesCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                {codesCopied ? "Copied" : "Copy codes"}
                            </button>
                            <button
                                type="button"
                                onClick={() => { setRecoveryCodes([]); setTfaStep("idle"); setTfaSuccess("Two-factor authentication enabled."); }}
                                className="flex items-center gap-2 bg-gradient-to-r from-violet-600 to-purple-600 text-white px-4 py-2 rounded-xl text-sm font-medium transition-all"
                            >
                                I&apos;ve saved them
                            </button>
                        </div>
                    </div>
                )}

                {tfaStep === "disable" && (
                    <form onSubmit={confirmDisable2FA} className="space-y-4">
                        <p className="text-zinc-400 text-sm">
                            {tfaUseRecovery ? "Enter one of your recovery codes to turn off 2FA" : "Enter your authenticator code to confirm disabling 2FA"}
                        </p>
                        <div className="relative">
                            <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                            {tfaUseRecovery ? (
                                <input
                                    id="tfa-disable-recovery"
                                    type="text"
                                    placeholder="ABCDE-FGHIJ"
                                    aria-label="Recovery code"
                                    value={tfaCode}
                                    onChange={(e) => setTfaCode(formatRecovery(e.target.value))}
                                    className={cn(codeInputClass, "w-56 font-mono focus:border-red-500")}
                                    required
                                    autoFocus
                                />
                            ) : (
                                <input
                                    id="tfa-disable-code"
                                    type="text"
                                    inputMode="numeric"
                                    autoComplete="one-time-code"
                                    pattern="[0-9]{6}"
                                    maxLength={6}
                                    placeholder="000000"
                                    aria-label="Authenticator code"
                                    value={tfaCode}
                                    onChange={(e) => setTfaCode(e.target.value.replace(/\D/g, ""))}
                                    className={cn(codeInputClass, "focus:border-red-500")}
                                    required
                                    autoFocus
                                />
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={() => { setTfaUseRecovery((v) => !v); setTfaCode(""); setTfaError(null); }}
                            className="text-purple-400 hover:text-purple-300 text-xs"
                        >
                            {tfaUseRecovery ? "Use my authenticator app instead" : "Lost your phone? Use a recovery code"}
                        </button>
                        <div className="flex gap-3">
                            <button
                                type="submit"
                                disabled={tfaLoading || !disableReady}
                                className={cn(
                                    "flex items-center gap-2 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 text-red-400 px-5 py-2 rounded-xl text-sm font-medium transition-all",
                                    (tfaLoading || !disableReady) && "opacity-50 cursor-not-allowed"
                                )}
                            >
                                {tfaLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldOff className="w-4 h-4" />}
                                Disable 2FA
                            </button>
                            <button
                                type="button"
                                onClick={() => { setTfaStep("idle"); setTfaCode(""); setTfaUseRecovery(false); setTfaError(null); }}
                                className="text-zinc-500 hover:text-zinc-400 text-sm px-3 py-2"
                            >
                                Cancel
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}
