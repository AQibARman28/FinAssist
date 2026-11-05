"use client";

import { ArrowLeft, ArrowRight, Circle, CircleCheck, Eye, EyeOff, Loader2, MailCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import { FieldLabel, Notice, PageHeader, StateNote } from "@/components/dashboard/ui";

// Mirror the server password policy (Backend/validators/common.js).
const PASSWORD_RULES = [
    { id: "len", label: "At least 8 characters", test: (s: string) => s.length >= 8 },
] as const;

const RESEND_COOLDOWN = 30;

// One-time codes: Geist Mono, wide tracking, centred (the left padding gains
// the tracking's width so the digits sit in the middle).
const CODE_FIELD = "field min-h-14 text-center font-mono text-[20px] tracking-[0.3em] pl-[calc(1rem+0.3em)]";

export default function ForgotPasswordPage() {
    const router = useRouter();
    const setUser = useAuthStore((s) => s.setUser);

    // "done": the password changed but two-factor is on, so they sign in again.
    const [step, setStep] = useState<"email" | "reset" | "done">("email");
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
                setStep("done");
                setInfo(null);
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

    const spinner = (label: string) => <><Loader2 className="w-4 h-4 animate-spin" aria-hidden /><span className="sr-only">{label}</span></>;

    return (
        <>
            <div className="mb-8">
                <PageHeader
                    title={step === "done" ? "Password changed" : "Reset your password"}
                    sub={step === "email" ? "We'll email you a 6-digit code."
                        : step === "done" ? "Two-factor is on, so sign in with your new password and the code from your authenticator app."
                        : `Enter the code sent to ${email} and choose a new password.`}
                />
            </div>

            {error && <div role="alert" className="mb-5"><Notice tone="bad" className="pr-4">{error}</Notice></div>}
            {/* Always present, so the "code is on its way" note is announced. */}
            <div role="status">
                {info && !error && <Notice tone="neutral" icon={MailCheck} className="mb-5 pr-4">{info}</Notice>}
            </div>

            {step === "done" ? (
                <Link href="/login" className="btn-primary w-full min-h-12">
                    Sign in <ArrowRight className="w-4 h-4" aria-hidden />
                </Link>
            ) : step === "email" ? (
                <form onSubmit={requestCode} className="space-y-6">
                    <div>
                        <FieldLabel htmlFor="forgot-email">Email</FieldLabel>
                        <input
                            id="forgot-email"
                            type="email"
                            autoComplete="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="field"
                            required
                            autoFocus
                        />
                    </div>
                    <button type="submit" disabled={loading || !email} className="btn-primary w-full min-h-12">
                        {loading ? spinner("Sending") : <>Send reset code <ArrowRight className="w-4 h-4" aria-hidden /></>}
                    </button>
                </form>
            ) : (
                <form onSubmit={submitReset} className="space-y-5">
                    <div>
                        <FieldLabel htmlFor="forgot-code">Reset code</FieldLabel>
                        <input
                            id="forgot-code"
                            type="text"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            pattern="[0-9]{6}"
                            maxLength={6}
                            placeholder="000000"
                            value={code}
                            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                            className={CODE_FIELD}
                            required
                            autoFocus
                        />
                    </div>

                    <div>
                        <FieldLabel htmlFor="forgot-new-password">New password</FieldLabel>
                        <div className="relative">
                            <input
                                id="forgot-new-password"
                                type={showPw ? "text" : "password"}
                                autoComplete="new-password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                aria-describedby="forgot-password-rules"
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
                        <ul id="forgot-password-rules" className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
                            {checks.map((c) => (
                                <li key={c.id}>
                                    <StateNote tone={c.ok ? "good" : "neutral"} icon={c.ok ? CircleCheck : Circle}>
                                        <span className="sr-only">{c.ok ? "Done: " : "Needed: "}</span>{c.label}
                                    </StateNote>
                                </li>
                            ))}
                        </ul>
                    </div>

                    <div className="pt-2">
                        <button type="submit" disabled={loading || code.length !== 6 || !passwordOk} className="btn-primary w-full min-h-12">
                            {loading ? spinner("Resetting") : <>Reset password and sign in <ArrowRight className="w-4 h-4" aria-hidden /></>}
                        </button>
                    </div>

                    <div className="-mx-3 flex justify-end">
                        <button type="button" onClick={() => requestCode()} disabled={cooldown > 0} className="btn-quiet tabular-nums">
                            {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
                        </button>
                    </div>
                </form>
            )}

            {step !== "done" && <p className="mt-8">
                <Link
                    href="/login"
                    className="inline-flex items-center gap-1.5 min-h-11 rounded-lg text-[13.5px] font-semibold text-plat hover:text-white hover:underline underline-offset-4 transition-colors focus-ring"
                >
                    <ArrowLeft className="w-4 h-4" aria-hidden /> Back to sign in
                </Link>
            </p>}
        </>
    );
}
