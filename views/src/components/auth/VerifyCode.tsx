"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Loader2, MailCheck } from "lucide-react";
import { api } from "@/lib/api";
import { FieldLabel, Notice } from "@/components/dashboard/ui";

interface VerifyCodeProps {
    email: string;
    onVerified: (user: unknown) => void;
    // Request a fresh code on mount (used when arriving from a failed login,
    // where the user may not have a current code in hand).
    autoResend?: boolean;
    onBack?: () => void;
}

const RESEND_COOLDOWN = 30; // seconds

// One-time codes are set in Geist Mono with wide tracking (DESIGN.md › Inputs).
// The left padding gains the tracking's width so the digits sit centred.
const CODE_FIELD = "field min-h-14 text-center font-mono text-[20px] tracking-[0.3em] pl-[calc(1rem+0.3em)]";

export function VerifyCode({ email, onVerified, autoResend = false, onBack }: VerifyCodeProps) {
    const [code, setCode] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [info, setInfo] = useState<string | null>(null);
    const [cooldown, setCooldown] = useState(0);

    // Ask the server for a fresh code. State is only touched once the request
    // settles; success and failure look the same because the server stays
    // generic about whether the address exists, and we mirror it.
    const requestCode = useCallback(() => {
        const onSettled = () => {
            setInfo(`We sent a new code to ${email}.`);
            setCooldown(RESEND_COOLDOWN);
        };
        return api.post("/auth/resend-code", { email }).then(onSettled, onSettled);
    }, [email]);

    // "Resend code" button: clear any previous error, then request.
    const resend = () => {
        setError(null);
        return requestCode();
    };

    // Optional auto-resend on first mount (`error` is still null then, so
    // there's nothing to clear).
    useEffect(() => {
        if (autoResend) requestCode();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Cooldown ticker.
    useEffect(() => {
        if (cooldown <= 0) return;
        const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
        return () => clearTimeout(t);
    }, [cooldown]);

    const handleVerify = async (e: React.FormEvent) => {
        e.preventDefault();
        if (code.length !== 6) return;
        setIsLoading(true);
        setError(null);
        try {
            const res = await api.post("/auth/verify-code", { email, code });
            if (res.data?.requires2FA) {
                setError("This account has two-factor enabled — please sign in from the login page.");
                return;
            }
            onVerified(res.data?.data);
        } catch (err) {
            const e2 = err as { response?: { data?: { message?: string } } };
            setError(e2.response?.data?.message || "Couldn't verify that code. Try again.");
            setCode("");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <motion.div
            key="verify"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-5"
        >
            <div>
                <p className="text-[14px] text-zinc-300">
                    We sent a 6-digit code to <span className="font-semibold text-white break-all">{email}</span>.
                </p>
                {error && <div role="alert" className="mt-4"><Notice tone="bad" className="pr-4">{error}</Notice></div>}
                {/* Always present, so a new message is announced. */}
                <div role="status">
                    {info && !error && <Notice tone="neutral" icon={MailCheck} className="mt-4 pr-4">{info}</Notice>}
                </div>
            </div>

            <form onSubmit={handleVerify} className="space-y-5">
                <div>
                    <FieldLabel htmlFor="verify-code">Verification code</FieldLabel>
                    <input
                        id="verify-code"
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

                <button type="submit" disabled={isLoading || code.length !== 6} className="btn-primary w-full min-h-12">
                    {isLoading
                        ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden /><span className="sr-only">Verifying</span></>
                        : <>Verify and continue <ArrowRight className="w-4 h-4" aria-hidden /></>}
                </button>
            </form>

            {/* Quiet actions, pulled out by their padding so their text lines up with the form. */}
            <div className="-mx-3 flex items-center justify-between gap-2">
                {onBack ? (
                    <button type="button" onClick={onBack} className="btn-quiet">
                        <ArrowLeft className="w-4 h-4" aria-hidden /> Back
                    </button>
                ) : <span />}
                <button type="button" onClick={resend} disabled={cooldown > 0} className="btn-quiet tabular-nums">
                    {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
                </button>
            </div>
        </motion.div>
    );
}
