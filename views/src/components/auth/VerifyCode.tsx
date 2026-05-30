"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { MailCheck, ArrowRight, AlertCircle, Check } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface VerifyCodeProps {
    email: string;
    onVerified: (user: unknown) => void;
    // Request a fresh code on mount (used when arriving from a failed login,
    // where the user may not have a current code in hand).
    autoResend?: boolean;
    onBack?: () => void;
}

const RESEND_COOLDOWN = 30; // seconds

export function VerifyCode({ email, onVerified, autoResend = false, onBack }: VerifyCodeProps) {
    const [code, setCode] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [info, setInfo] = useState<string | null>(null);
    const [cooldown, setCooldown] = useState(0);

    const resend = useCallback(async () => {
        setError(null);
        try {
            await api.post("/auth/resend-code", { email });
            setInfo(`We sent a new code to ${email}.`);
            setCooldown(RESEND_COOLDOWN);
        } catch {
            setInfo(`We sent a new code to ${email}.`); // server stays generic; mirror it
            setCooldown(RESEND_COOLDOWN);
        }
    }, [email]);

    // Optional auto-resend on first mount.
    useEffect(() => {
        if (autoResend) resend();
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
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="space-y-6"
        >
            <div className="text-center mb-2">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-purple-500/10 border border-purple-500/20 mb-3">
                    <MailCheck className="w-6 h-6 text-purple-400" />
                </div>
                <p className="text-zinc-300 text-sm font-medium">Check your email</p>
                <p className="text-zinc-500 text-xs mt-1">
                    We sent a 6-digit code to <span className="text-zinc-300">{email}</span>
                </p>
            </div>

            {error && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" /> {error}
                </div>
            )}
            {info && !error && (
                <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm flex items-center gap-2">
                    <Check className="w-4 h-4 shrink-0" /> {info}
                </div>
            )}

            <form onSubmit={handleVerify} className="space-y-6">
                <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    placeholder="000000"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                    className="w-full bg-zinc-900/50 border-b border-zinc-800 focus:border-purple-500 text-zinc-300 placeholder:text-zinc-600 text-center text-2xl tracking-[0.5em] py-3 outline-none transition-all duration-300 rounded-t-sm"
                    required
                    autoFocus
                />

                <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    type="submit"
                    disabled={isLoading || code.length !== 6}
                    className={cn(
                        "w-full flex items-center justify-center gap-2 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white font-medium py-3 rounded-full shadow-lg shadow-purple-900/20 transition-all duration-300",
                        (isLoading || code.length !== 6) && "opacity-60 cursor-not-allowed",
                    )}
                >
                    {isLoading ? (
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                        <>Verify &amp; continue <ArrowRight className="w-4 h-4" /></>
                    )}
                </motion.button>
            </form>

            <div className="flex items-center justify-between text-xs text-zinc-500">
                {onBack ? (
                    <button type="button" onClick={onBack} className="hover:text-zinc-300 transition-colors">← Back</button>
                ) : <span />}
                <button
                    type="button"
                    onClick={resend}
                    disabled={cooldown > 0}
                    className={cn("transition-colors", cooldown > 0 ? "text-zinc-600 cursor-not-allowed" : "text-purple-400 hover:text-purple-300")}
                >
                    {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
                </button>
            </div>
        </motion.div>
    );
}
