"use client";

import { motion } from "framer-motion";
import { Mail, Lock, ArrowRight, ArrowLeft, AlertCircle, Check, X, KeyRound, Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import { cn } from "@/lib/utils";

// Mirror the server password policy (Backend/validators/common.js).
const PASSWORD_RULES = [
    { id: "len", label: "At least 6 characters", test: (s: string) => s.length >= 6 },
] as const;

const RESEND_COOLDOWN = 30;

export default function ForgotPasswordPage() {
    const router = useRouter();
    const setUser = useAuthStore((s) => s.setUser);

    const [step, setStep] = useState<"email" | "reset">("email");
    const [email, setEmail] = useState("");
    const [code, setCode] = useState("");
    const [password, setPassword] = useState("");
    const [showPw, setShowPw] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [info, setInfo] = useState<string | null>(null);
    const [cooldown, setCooldown] = useState(0);

    const checks = PASSWORD_RULES.map((r) => ({ ...r, ok: r.test(password) }));
    const passwordOk = checks.every((c) => c.ok);

    useEffect(() => {
        if (cooldown <= 0) return;
        const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
        return () => clearTimeout(t);
    }, [cooldown]);

    const requestCode = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!email) return;
        setLoading(true);
        setError(null);
        try {
            await api.post("/auth/forgot-password", { email });
            setStep("reset");
            setInfo(`If an account exists for ${email}, a 6-digit code is on its way.`);
            setCooldown(RESEND_COOLDOWN);
        } catch {
            // Endpoint is intentionally generic; surface the same friendly note.
            setStep("reset");
            setInfo(`If an account exists for ${email}, a 6-digit code is on its way.`);
            setCooldown(RESEND_COOLDOWN);
        } finally {
            setLoading(false);
        }
    };

    const submitReset = async (e: React.FormEvent) => {
        e.preventDefault();
        if (code.length !== 6 || !passwordOk) return;
        setLoading(true);
        setError(null);
        try {
            const res = await api.post("/auth/reset-password", { email, code, newPassword: password });
            if (res.data?.requires2FA) {
                setError("Two-factor is enabled on this account — sign in from the login page to continue.");
                return;
            }
            setUser(res.data?.data);
            router.push("/dashboard");
        } catch (err) {
            const e2 = err as { response?: { data?: { message?: string } } };
            setError(e2.response?.data?.message || "Couldn't reset your password. Try again.");
            setCode("");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="relative min-h-screen w-full flex items-center justify-center bg-zinc-950 overflow-hidden text-zinc-200 py-10">
            <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] bg-purple-900/30 rounded-full blur-[100px] mix-blend-screen animate-pulse" />
                <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] bg-violet-900/20 rounded-full blur-[120px] mix-blend-screen opacity-70" />
            </div>

            <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, ease: "easeOut" }}
                className="relative z-10 w-full max-w-md p-8 sm:p-10 bg-black/40 backdrop-blur-2xl border border-white/5 rounded-3xl shadow-2xl shadow-purple-900/10 ring-1 ring-white/5"
            >
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-purple-500/10 border border-purple-500/20 mb-3">
                        <KeyRound className="w-6 h-6 text-purple-400" />
                    </div>
                    <h1 className="text-xl font-light tracking-wide text-white">Reset your password</h1>
                    <p className="text-zinc-500 text-sm mt-1">
                        {step === "email" ? "We'll email you a 6-digit code." : `Enter the code sent to ${email} and choose a new password.`}
                    </p>
                </div>

                {error && (
                    <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0" /> {error}
                    </div>
                )}
                {info && !error && (
                    <div className="mb-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm flex items-center gap-2">
                        <Check className="w-4 h-4 shrink-0" /> {info}
                    </div>
                )}

                {step === "email" ? (
                    <form onSubmit={requestCode} className="space-y-6">
                        <div className="relative group">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500 group-focus-within:text-purple-400 transition-colors" />
                            <input
                                type="email"
                                placeholder="Email Address"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full bg-zinc-900/50 border-b border-zinc-800 focus:border-purple-500 text-zinc-300 placeholder:text-zinc-600 pl-10 pr-4 py-3 outline-none transition-all rounded-t-sm"
                                required
                                autoFocus
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={loading || !email}
                            className={cn("w-full flex items-center justify-center gap-2 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white font-medium py-3 rounded-full shadow-lg shadow-purple-900/20 transition-all", (loading || !email) && "opacity-60 cursor-not-allowed")}
                        >
                            {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <>Send reset code <ArrowRight className="w-4 h-4" /></>}
                        </button>
                    </form>
                ) : (
                    <form onSubmit={submitReset} className="space-y-5">
                        <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]{6}"
                            maxLength={6}
                            placeholder="000000"
                            value={code}
                            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                            className="w-full bg-zinc-900/50 border-b border-zinc-800 focus:border-purple-500 text-zinc-300 placeholder:text-zinc-600 text-center text-2xl tracking-[0.5em] py-3 outline-none transition-all rounded-t-sm"
                            required
                            autoFocus
                        />

                        <div>
                            <div className="relative group">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500 group-focus-within:text-purple-400 transition-colors" />
                                <input
                                    type={showPw ? "text" : "password"}
                                    placeholder="New password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full bg-zinc-900/50 border-b border-zinc-800 focus:border-purple-500 text-zinc-300 placeholder:text-zinc-600 pl-10 pr-12 py-3 outline-none transition-all rounded-t-sm"
                                    required
                                />
                                <button type="button" onClick={() => setShowPw((s) => !s)} className="absolute right-1 top-1/2 -translate-y-1/2 p-2 text-zinc-300 hover:text-white" aria-label={showPw ? "Hide password" : "Show password"}>
                                    {showPw ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                </button>
                            </div>
                            <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                                {checks.map((c) => (
                                    <li key={c.id} className={cn("flex items-center gap-1.5", c.ok ? "text-emerald-400" : "text-zinc-500")}>
                                        {c.ok ? <Check className="w-3 h-3" /> : <X className="w-3 h-3 opacity-50" />}{c.label}
                                    </li>
                                ))}
                            </ul>
                        </div>

                        <button
                            type="submit"
                            disabled={loading || code.length !== 6 || !passwordOk}
                            className={cn("w-full flex items-center justify-center gap-2 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white font-medium py-3 rounded-full shadow-lg shadow-purple-900/20 transition-all", (loading || code.length !== 6 || !passwordOk) && "opacity-60 cursor-not-allowed")}
                        >
                            {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <>Reset password &amp; sign in <ArrowRight className="w-4 h-4" /></>}
                        </button>

                        <button
                            type="button"
                            onClick={() => requestCode()}
                            disabled={cooldown > 0}
                            className={cn("w-full text-xs transition-colors", cooldown > 0 ? "text-zinc-600 cursor-not-allowed" : "text-purple-400 hover:text-purple-300")}
                        >
                            {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
                        </button>
                    </form>
                )}

                <div className="mt-8 text-center text-xs text-zinc-500">
                    <Link href="/login" className="inline-flex items-center gap-1 text-zinc-400 hover:text-purple-300 transition-colors">
                        <ArrowLeft className="w-3 h-3" /> Back to sign in
                    </Link>
                </div>
            </motion.div>
        </div>
    );
}
