"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Lock, Mail, ArrowRight, AlertCircle, ShieldCheck, Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { apiErrorCode, apiErrorMessage, apiErrorStatus } from "@/lib/apiError";
import { useAuthStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { VerifyCode } from "@/components/auth/VerifyCode";

export default function LoginPage() {
    const router  = useRouter();
    const setUser = useAuthStore((s) => s.setUser);

    const [formData, setFormData]       = useState({ email: "", password: "" });
    const [rememberMe, setRememberMe]   = useState(false);
    const [showPw, setShowPw]           = useState(false);
    const [totpCode, setTotpCode]       = useState("");
    const [requires2FA, setRequires2FA] = useState(false);
    // Lost phone: sign in with one of the single-use recovery codes instead.
    const [useRecovery, setUseRecovery]   = useState(false);
    const [recoveryCode, setRecoveryCode] = useState("");
    const [isLoading, setIsLoading]     = useState(false);
    const [error, setError]             = useState<string | null>(null);
    // Set when login is blocked because the email isn't verified yet → we drop
    // into the same code-entry step (auto-resending a fresh code).
    const [needsVerifyEmail, setNeedsVerifyEmail] = useState<string | null>(null);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);

        try {
            const res = await api.post("/auth/login", { ...formData, rememberMe });

            if (res.data.requires2FA) {
                // The fa_temp cookie is now set server-side; we just flip the
                // form. No tempToken state needed on the client anymore.
                setRequires2FA(true);
            } else {
                setUser(res.data.data);
                router.push("/dashboard");
            }
        } catch (err: unknown) {
            if (apiErrorStatus(err) === 403 && apiErrorCode(err) === "email_unverified") {
                setError(null);
                setNeedsVerifyEmail(formData.email);
            } else {
                setError(apiErrorMessage(err, "Something went wrong. Please try again."));
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handle2FAVerify = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);

        try {
            const body = useRecovery ? { recoveryCode: recoveryCode.trim().toUpperCase() } : { token: totpCode };
            const res = await api.post("/auth/2fa/verify", body);
            setUser(res.data.data);
            router.push("/dashboard");
        } catch (err: unknown) {
            setError(apiErrorMessage(err, "Invalid verification code."));
            setTotpCode("");
            setRecoveryCode("");
        } finally {
            setIsLoading(false);
        }
    };

    // Recovery codes look like ABCDE-FGHIJ; insert the dash as the user types.
    const formatRecovery = (v: string) => {
        const raw = v.toUpperCase().replace(/[^A-Z2-7]/g, "").slice(0, 10);
        return raw.length > 5 ? `${raw.slice(0, 5)}-${raw.slice(5)}` : raw;
    };
    const secondFactorReady = useRecovery ? /^[A-Z2-7]{5}-[A-Z2-7]{5}$/.test(recoveryCode) : totpCode.length === 6;

    return (
        <div className="relative min-h-screen w-full flex items-center justify-center bg-zinc-950 overflow-hidden text-zinc-200">
            <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] bg-purple-900/30 rounded-full blur-[100px] mix-blend-screen animate-pulse" />
                <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] bg-violet-900/20 rounded-full blur-[120px] mix-blend-screen opacity-70" />
            </div>

            <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="relative z-10 w-full max-w-md p-8 sm:p-10 bg-black/40 backdrop-blur-2xl border border-white/5 rounded-3xl shadow-2xl shadow-purple-900/10 ring-1 ring-white/5"
            >
                <div className="text-center mb-8">
                    <motion.div
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ delay: 0.2 }}
                        className="inline-flex items-center gap-2 mb-2"
                    >
                        <div className="w-2 h-2 rounded-full bg-purple-500 shadow-[0_0_10px_#a855f7]" />
                        <h1 className="text-2xl font-light tracking-wide text-white">FinAssist</h1>
                    </motion.div>
                    <p className="text-zinc-500 text-sm">
                        {needsVerifyEmail ? "Verify your email" : requires2FA ? "Two-factor authentication" : "Access your financial vault"}
                    </p>
                </div>

                {error && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2"
                    >
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        {error}
                    </motion.div>
                )}

                {needsVerifyEmail ? (
                    <VerifyCode
                        email={needsVerifyEmail}
                        autoResend
                        onVerified={(u) => { setUser(u as Parameters<typeof setUser>[0]); router.push("/dashboard"); }}
                        onBack={() => setNeedsVerifyEmail(null)}
                    />
                ) : (
                <AnimatePresence mode="wait">
                    {!requires2FA ? (
                        <motion.form
                            key="login"
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 20 }}
                            onSubmit={handleLogin}
                            className="space-y-6"
                        >
                            <div className="space-y-4">
                                <div className="group">
                                    <div className="relative">
                                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500 group-focus-within:text-purple-400 transition-colors" />
                                        <input
                                            type="email"
                                            placeholder="Email Address"
                                            value={formData.email}
                                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                            className="w-full bg-zinc-900/50 border-b border-zinc-800 focus:border-purple-500 text-zinc-300 placeholder:text-zinc-600 pl-10 pr-4 py-3 outline-none transition-all duration-300 rounded-t-sm"
                                            required
                                        />
                                    </div>
                                </div>
                                <div className="group">
                                    <div className="relative">
                                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500 group-focus-within:text-purple-400 transition-colors" />
                                        <input
                                            type={showPw ? "text" : "password"}
                                            placeholder="Password"
                                            value={formData.password}
                                            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                            className="w-full bg-zinc-900/50 border-b border-zinc-800 focus:border-purple-500 text-zinc-300 placeholder:text-zinc-600 pl-10 pr-12 py-3 outline-none transition-all duration-300 rounded-t-sm"
                                            required
                                        />
                                        <button type="button" onClick={() => setShowPw((s) => !s)} className="absolute right-1 top-1/2 -translate-y-1/2 p-2 text-zinc-300 hover:text-white" aria-label={showPw ? "Hide password" : "Show password"}>
                                            {showPw ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center justify-between text-xs text-zinc-500">
                                <label className="flex items-center gap-2 cursor-pointer hover:text-zinc-400 transition-colors">
                                    <input
                                        type="checkbox"
                                        checked={rememberMe}
                                        onChange={(e) => setRememberMe(e.target.checked)}
                                        className="accent-purple-500 rounded border-zinc-700 bg-zinc-900"
                                    />
                                    Remember me
                                </label>
                                <Link href="/forgot-password" className="hover:text-purple-400 transition-colors">Forgot Password?</Link>
                            </div>

                            <motion.button
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                                className={cn(
                                    "w-full flex items-center justify-center gap-2 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white font-medium py-3 rounded-full shadow-lg shadow-purple-900/20 transition-all duration-300",
                                    isLoading && "opacity-80 cursor-wait"
                                )}
                                disabled={isLoading}
                            >
                                {isLoading ? (
                                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                ) : (
                                    <>Sign In <ArrowRight className="w-4 h-4" /></>
                                )}
                            </motion.button>
                        </motion.form>
                    ) : (
                        <motion.form
                            key="2fa"
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            onSubmit={handle2FAVerify}
                            className="space-y-6"
                        >
                            <div className="text-center mb-2">
                                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-purple-500/10 border border-purple-500/20 mb-3">
                                    <ShieldCheck className="w-6 h-6 text-purple-400" />
                                </div>
                                <p className="text-zinc-400 text-sm">
                                    {useRecovery ? "Enter one of your recovery codes" : "Enter the 6-digit code from your authenticator app"}
                                </p>
                            </div>

                            <div className="group">
                                {useRecovery ? (
                                    <input
                                        key="recovery"
                                        type="text"
                                        autoComplete="one-time-code"
                                        placeholder="ABCDE-FGHIJ"
                                        aria-label="Recovery code"
                                        value={recoveryCode}
                                        onChange={(e) => setRecoveryCode(formatRecovery(e.target.value))}
                                        className="w-full bg-zinc-900/50 border-b border-zinc-800 focus:border-purple-500 text-zinc-300 placeholder:text-zinc-600 text-center text-xl tracking-[0.3em] font-mono py-3 outline-none transition-all duration-300 rounded-t-sm"
                                        required
                                        autoFocus
                                    />
                                ) : (
                                    <input
                                        key="totp"
                                        type="text"
                                        inputMode="numeric"
                                        autoComplete="one-time-code"
                                        pattern="[0-9]{6}"
                                        maxLength={6}
                                        placeholder="000000"
                                        aria-label="Authenticator code"
                                        value={totpCode}
                                        onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                                        className="w-full bg-zinc-900/50 border-b border-zinc-800 focus:border-purple-500 text-zinc-300 placeholder:text-zinc-600 text-center text-2xl tracking-[0.5em] py-3 outline-none transition-all duration-300 rounded-t-sm"
                                        required
                                        autoFocus
                                    />
                                )}
                            </div>

                            <motion.button
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                                className={cn(
                                    "w-full flex items-center justify-center gap-2 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white font-medium py-3 rounded-full shadow-lg shadow-purple-900/20 transition-all duration-300",
                                    isLoading && "opacity-80 cursor-wait"
                                )}
                                disabled={isLoading || !secondFactorReady}
                            >
                                {isLoading ? (
                                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                ) : (
                                    <>Verify <ShieldCheck className="w-4 h-4" /></>
                                )}
                            </motion.button>

                            <button
                                type="button"
                                onClick={() => { setUseRecovery((v) => !v); setError(null); setTotpCode(""); setRecoveryCode(""); }}
                                className="w-full text-purple-400 hover:text-purple-300 text-xs transition-colors"
                            >
                                {useRecovery ? "Use my authenticator app instead" : "Lost your phone? Use a recovery code"}
                            </button>

                            <button
                                type="button"
                                onClick={() => { setRequires2FA(false); setUseRecovery(false); setError(null); }}
                                className="w-full text-zinc-500 hover:text-zinc-400 text-xs transition-colors"
                            >
                                ← Back to login
                            </button>
                        </motion.form>
                    )}
                </AnimatePresence>
                )}

                {!requires2FA && !needsVerifyEmail && (
                    <div className="mt-8 text-center text-xs text-zinc-500">
                        Don&apos;t have an account?{" "}
                        <Link href="/register" className="text-purple-400 hover:text-purple-300 transition-colors font-medium">
                            Create Access
                        </Link>
                    </div>
                )}
            </motion.div>
        </div>
    );
}
