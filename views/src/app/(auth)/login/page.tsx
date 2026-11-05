"use client";

import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { apiErrorCode, apiErrorMessage, apiErrorStatus } from "@/lib/apiError";
import { useAuthStore } from "@/lib/store";
import { VerifyCode } from "@/components/auth/VerifyCode";
import { FieldLabel, Notice, PageHeader } from "@/components/dashboard/ui";

const EASE = [0.16, 1, 0.3, 1] as const;
// One-time and recovery codes: Geist Mono, wide tracking, centred (the left
// padding gains the tracking's width so the characters sit in the middle).
const CODE_FIELD = "field min-h-14 text-center font-mono text-[20px] tracking-[0.3em] pl-[calc(1rem+0.3em)]";
const LINK = "rounded-lg font-semibold text-plat hover:text-white hover:underline underline-offset-4 transition-colors focus-ring";

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

    const heading = needsVerifyEmail
        ? { title: "Verify your email", sub: undefined }
        : requires2FA
            ? { title: "Two-factor check", sub: useRecovery ? "Enter one of your recovery codes." : "Enter the 6-digit code from your authenticator app." }
            : { title: "Sign in", sub: "Welcome back." };

    const spinner = (label: string) => <><Loader2 className="w-4 h-4 animate-spin" aria-hidden /><span className="sr-only">{label}</span></>;

    return (
        <>
            <div className="mb-8">
                <PageHeader title={heading.title} sub={heading.sub} />
            </div>

            {error && <div role="alert" className="mb-5"><Notice tone="bad" className="pr-4">{error}</Notice></div>}

            {needsVerifyEmail ? (
                <VerifyCode
                    email={needsVerifyEmail}
                    autoResend
                    onVerified={(u) => { setUser(u as Parameters<typeof setUser>[0]); router.push("/dashboard"); }}
                    onBack={() => setNeedsVerifyEmail(null)}
                />
            ) : (
            <AnimatePresence mode="wait" initial={false}>
                {!requires2FA ? (
                    <motion.form
                        key="login"
                        initial={{ opacity: 0, x: -12 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 12 }}
                        transition={{ duration: 0.25, ease: EASE }}
                        onSubmit={handleLogin}
                    >
                        <div className="space-y-5">
                            <div>
                                <FieldLabel htmlFor="login-email">Email</FieldLabel>
                                <input
                                    id="login-email"
                                    type="email"
                                    autoComplete="email"
                                    value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                    className="field"
                                    required
                                />
                            </div>
                            <div>
                                <FieldLabel htmlFor="login-password">Password</FieldLabel>
                                <div className="relative">
                                    <input
                                        id="login-password"
                                        type={showPw ? "text" : "password"}
                                        autoComplete="current-password"
                                        value={formData.password}
                                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                        className="field pr-14"
                                        required
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPw((s) => !s)}
                                        className="btn-icon absolute right-0.5 top-1/2 -translate-y-1/2"
                                        aria-label={showPw ? "Hide password" : "Show password"}
                                    >
                                        {showPw ? <EyeOff className="w-5 h-5" aria-hidden /> : <Eye className="w-5 h-5" aria-hidden />}
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4">
                            <label className="inline-flex items-center gap-2.5 min-h-11 cursor-pointer text-[13.5px] text-zinc-300">
                                <input
                                    type="checkbox"
                                    checked={rememberMe}
                                    onChange={(e) => setRememberMe(e.target.checked)}
                                    className="w-4 h-4 rounded accent-plat focus-ring"
                                />
                                Remember me
                            </label>
                            <Link href="/forgot-password" className={`inline-flex items-center min-h-11 text-[13.5px] ${LINK}`}>Forgot password?</Link>
                        </div>

                        <button type="submit" disabled={isLoading} className="btn-primary w-full min-h-12 mt-6">
                            {isLoading ? spinner("Signing in") : <>Sign in <ArrowRight className="w-4 h-4" aria-hidden /></>}
                        </button>
                    </motion.form>
                ) : (
                    <motion.form
                        key="2fa"
                        initial={{ opacity: 0, x: 12 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -12 }}
                        transition={{ duration: 0.25, ease: EASE }}
                        onSubmit={handle2FAVerify}
                    >
                        <div>
                            {useRecovery ? (
                                <>
                                    <FieldLabel htmlFor="login-recovery">Recovery code</FieldLabel>
                                    <input
                                        key="recovery"
                                        id="login-recovery"
                                        type="text"
                                        autoComplete="one-time-code"
                                        placeholder="ABCDE-FGHIJ"
                                        value={recoveryCode}
                                        onChange={(e) => setRecoveryCode(formatRecovery(e.target.value))}
                                        className={CODE_FIELD}
                                        required
                                        autoFocus
                                    />
                                </>
                            ) : (
                                <>
                                    <FieldLabel htmlFor="login-totp">Authenticator code</FieldLabel>
                                    <input
                                        key="totp"
                                        id="login-totp"
                                        type="text"
                                        inputMode="numeric"
                                        autoComplete="one-time-code"
                                        pattern="[0-9]{6}"
                                        maxLength={6}
                                        placeholder="000000"
                                        value={totpCode}
                                        onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                                        className={CODE_FIELD}
                                        required
                                        autoFocus
                                    />
                                </>
                            )}
                            <button
                                type="button"
                                onClick={() => { setUseRecovery((v) => !v); setError(null); setTotpCode(""); setRecoveryCode(""); }}
                                className={`mt-2 inline-flex items-center min-h-11 text-[13.5px] ${LINK}`}
                            >
                                {useRecovery ? "Use my authenticator app instead" : "Lost your phone? Use a recovery code"}
                            </button>
                        </div>

                        <button type="submit" disabled={isLoading || !secondFactorReady} className="btn-primary w-full min-h-12 mt-4">
                            {isLoading ? spinner("Verifying") : <>Verify <ShieldCheck className="w-4 h-4" aria-hidden /></>}
                        </button>

                        <button
                            type="button"
                            onClick={() => { setRequires2FA(false); setUseRecovery(false); setError(null); }}
                            className="btn-quiet -ml-3 mt-4"
                        >
                            <ArrowLeft className="w-4 h-4" aria-hidden /> Back to sign in
                        </button>
                    </motion.form>
                )}
            </AnimatePresence>
            )}

            {!requires2FA && !needsVerifyEmail && (
                <p className="mt-8 flex flex-wrap items-center gap-x-1.5 text-[13.5px] text-zinc-400">
                    Don&apos;t have an account?
                    <Link href="/register" className={`inline-flex items-center min-h-11 ${LINK}`}>Create an account</Link>
                </p>
            )}
        </>
    );
}
