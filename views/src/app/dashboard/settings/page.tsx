"use client";

import { useState, useEffect } from "react";
import { User, Mail, DollarSign, Lock, Save, Loader2, CheckCircle, ShieldCheck, ShieldOff, ScanLine } from "lucide-react";
import Image from "next/image";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const CURRENCIES = ["BDT", "USD", "EUR", "GBP", "INR", "CAD", "AUD", "SGD", "AED"];

export default function SettingsPage() {
    const { user, setAuth, token } = useAuthStore();
    const [form, setForm] = useState({ name: "", email: "", currency: "BDT", password: "", confirmPassword: "" });
    const [isLoading, setIsLoading]   = useState(false);
    const [success, setSuccess]       = useState(false);
    const [error, setError]           = useState<string | null>(null);

    // 2FA state
    const [tfaStep, setTfaStep]       = useState<"idle" | "setup" | "disable">("idle");
    const [tfaQR, setTfaQR]           = useState<string | null>(null);
    const [tfaManual, setTfaManual]   = useState<string | null>(null);
    const [tfaCode, setTfaCode]       = useState("");
    const [tfaLoading, setTfaLoading] = useState(false);
    const [tfaError, setTfaError]     = useState<string | null>(null);
    const [tfaSuccess, setTfaSuccess] = useState<string | null>(null);

    useEffect(() => {
        if (user) setForm((f) => ({ ...f, name: user.name, email: user.email, currency: user.currency }));
    }, [user]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccess(false);

        if (form.password && form.password !== form.confirmPassword) {
            setError("Passwords do not match");
            return;
        }

        setIsLoading(true);
        try {
            const payload: Record<string, string> = {
                name: form.name,
                email: form.email,
                currency: form.currency,
            };
            if (form.password) payload.password = form.password;

            const res = await api.put("/auth/profile", payload);
            setAuth(res.data.data, res.data.data.token ?? token ?? "");
            setSuccess(true);
            setForm((f) => ({ ...f, password: "", confirmPassword: "" }));
        } catch (err: any) {
            setError(err.response?.data?.message || "Failed to update profile");
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
        } catch (err: any) {
            setTfaError(err.response?.data?.message || "Failed to start 2FA setup");
        } finally {
            setTfaLoading(false);
        }
    };

    const confirmEnable2FA = async (e: React.FormEvent) => {
        e.preventDefault();
        setTfaError(null);
        setTfaLoading(true);
        try {
            await api.post("/auth/2fa/enable", { token: tfaCode });
            // Patch local user state so the toggle reflects immediately
            if (user) setAuth({ ...user, twoFactorEnabled: true }, token ?? "");
            setTfaSuccess("Two-factor authentication enabled.");
            setTfaStep("idle");
            setTfaCode("");
            setTfaQR(null);
        } catch (err: any) {
            setTfaError(err.response?.data?.message || "Invalid code. Try again.");
            setTfaCode("");
        } finally {
            setTfaLoading(false);
        }
    };

    const confirmDisable2FA = async (e: React.FormEvent) => {
        e.preventDefault();
        setTfaError(null);
        setTfaLoading(true);
        try {
            await api.post("/auth/2fa/disable", { token: tfaCode });
            if (user) setAuth({ ...user, twoFactorEnabled: false }, token ?? "");
            setTfaSuccess("Two-factor authentication disabled.");
            setTfaStep("idle");
            setTfaCode("");
        } catch (err: any) {
            setTfaError(err.response?.data?.message || "Invalid code. Try again.");
            setTfaCode("");
        } finally {
            setTfaLoading(false);
        }
    };

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
                    <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
                )}
                {success && (
                    <div className="mb-4 p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm flex items-center gap-2">
                        <CheckCircle className="w-4 h-4" /> Profile updated successfully
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <div>
                            <label className="block text-zinc-400 text-sm mb-2">Full Name</label>
                            <div className="relative">
                                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                                <input
                                    type="text"
                                    value={form.name}
                                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                                    className="w-full bg-zinc-800/50 border border-zinc-700 focus:border-purple-500 text-zinc-200 placeholder:text-zinc-600 pl-9 pr-4 py-2.5 rounded-xl outline-none transition-colors"
                                    required
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-zinc-400 text-sm mb-2">Email</label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                                <input
                                    type="email"
                                    value={form.email}
                                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                                    className="w-full bg-zinc-800/50 border border-zinc-700 focus:border-purple-500 text-zinc-200 placeholder:text-zinc-600 pl-9 pr-4 py-2.5 rounded-xl outline-none transition-colors"
                                    required
                                />
                            </div>
                        </div>
                    </div>

                    <div>
                        <label className="block text-zinc-400 text-sm mb-2">Currency</label>
                        <div className="relative">
                            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                            <select
                                value={form.currency}
                                onChange={(e) => setForm({ ...form, currency: e.target.value })}
                                className="w-full bg-zinc-800/50 border border-zinc-700 focus:border-purple-500 text-zinc-200 pl-9 pr-4 py-2.5 rounded-xl outline-none transition-colors appearance-none"
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
                            <label className="block text-zinc-400 text-sm mb-2">New Password</label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                                <input
                                    type="password"
                                    value={form.password}
                                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                                    placeholder="••••••••"
                                    className="w-full bg-zinc-800/50 border border-zinc-700 focus:border-purple-500 text-zinc-200 placeholder:text-zinc-600 pl-9 pr-4 py-2.5 rounded-xl outline-none transition-colors"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-zinc-400 text-sm mb-2">Confirm Password</label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                                <input
                                    type="password"
                                    value={form.confirmPassword}
                                    onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                                    placeholder="••••••••"
                                    className="w-full bg-zinc-800/50 border border-zinc-700 focus:border-purple-500 text-zinc-200 placeholder:text-zinc-600 pl-9 pr-4 py-2.5 rounded-xl outline-none transition-colors"
                                />
                            </div>
                        </div>
                    </div>

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
                    Use an authenticator app (Google Authenticator, Authy) for an extra layer of security.
                </p>

                {tfaError && (
                    <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{tfaError}</div>
                )}
                {tfaSuccess && (
                    <div className="mb-4 p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm flex items-center gap-2">
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
                                onClick={() => { setTfaStep("disable"); setTfaError(null); }}
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
                            <Image src={tfaQR} alt="2FA QR code" width={180} height={180} />
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
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]{6}"
                                    maxLength={6}
                                    placeholder="000000"
                                    value={tfaCode}
                                    onChange={(e) => setTfaCode(e.target.value.replace(/\D/g, ""))}
                                    className="w-48 bg-zinc-800/50 border border-zinc-700 focus:border-purple-500 text-zinc-200 placeholder:text-zinc-600 pl-9 pr-4 py-2.5 rounded-xl outline-none transition-colors tracking-widest text-center"
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

                {tfaStep === "disable" && (
                    <form onSubmit={confirmDisable2FA} className="space-y-4">
                        <p className="text-zinc-400 text-sm">Enter your authenticator code to confirm disabling 2FA</p>
                        <div className="relative">
                            <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                            <input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]{6}"
                                maxLength={6}
                                placeholder="000000"
                                value={tfaCode}
                                onChange={(e) => setTfaCode(e.target.value.replace(/\D/g, ""))}
                                className="w-48 bg-zinc-800/50 border border-zinc-700 focus:border-red-500 text-zinc-200 placeholder:text-zinc-600 pl-9 pr-4 py-2.5 rounded-xl outline-none transition-colors tracking-widest text-center"
                                required
                                autoFocus
                            />
                        </div>
                        <div className="flex gap-3">
                            <button
                                type="submit"
                                disabled={tfaLoading || tfaCode.length !== 6}
                                className={cn(
                                    "flex items-center gap-2 bg-red-600/20 hover:bg-red-600/30 border border-red-500/30 text-red-400 px-5 py-2 rounded-xl text-sm font-medium transition-all",
                                    (tfaLoading || tfaCode.length !== 6) && "opacity-50 cursor-not-allowed"
                                )}
                            >
                                {tfaLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldOff className="w-4 h-4" />}
                                Disable 2FA
                            </button>
                            <button
                                type="button"
                                onClick={() => { setTfaStep("idle"); setTfaCode(""); setTfaError(null); }}
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
