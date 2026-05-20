"use client";

import { motion } from "framer-motion";
import { Lock, Mail, User, ArrowRight, AlertCircle, Check, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import { cn } from "@/lib/utils";

// Mirrors the server's password policy (Backend/validators/common.js).
// Showing it client-side stops users from staring at a generic
// "Invalid request" while wondering which rule they broke.
const PASSWORD_RULES = [
    { id: "len",   label: "12+ characters",     test: (s: string) => s.length >= 12 },
    { id: "lower", label: "Lowercase letter",   test: (s: string) => /[a-z]/.test(s) },
    { id: "upper", label: "Uppercase letter",   test: (s: string) => /[A-Z]/.test(s) },
    { id: "digit", label: "Digit",              test: (s: string) => /\d/.test(s) },
] as const;

export default function RegisterPage() {
    const router  = useRouter();
    const setUser = useAuthStore((s) => s.setUser);

    const [formData, setFormData] = useState({
        name: "",
        email: "",
        password: "",
        confirmPassword: ""
    });
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
    // Only show the "passwords don't match" warning AFTER the user has left
    // the confirm field or submitted -- typing mid-confirm shouldn't blink
    // red on every keystroke until the lengths happen to match.
    const [confirmTouched, setConfirmTouched] = useState(false);

    const passwordChecks = PASSWORD_RULES.map((r) => ({ ...r, ok: r.test(formData.password) }));
    const passwordOk = passwordChecks.every((c) => c.ok);
    const passwordsMatch = formData.password.length > 0 && formData.password === formData.confirmPassword;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setFieldErrors({});
        setConfirmTouched(true);   // force-show any mismatch on submit

        if (formData.password !== formData.confirmPassword) {
            setError("Passwords do not match");
            return;
        }

        if (!passwordOk) {
            setError("Password doesn't meet the requirements above");
            return;
        }

        setIsLoading(true);
        try {
            const res = await api.post("/auth/register", {
                name: formData.name,
                email: formData.email,
                password: formData.password
            });

            // Two posture branches driven by the API response:
            //   requiresEmailVerification === true → prod-style, no session.
            //                                        Bounce to /login with a
            //                                        notice.
            //   requiresEmailVerification === false → dev-style (no SMTP),
            //                                         server set the session
            //                                         cookies; land on /dashboard.
            if (res.data?.requiresEmailVerification) {
                router.push("/login?registered=1");
            } else {
                setUser(res.data.data);
                router.push("/dashboard");
            }
        } catch (err: any) {
            const data = err.response?.data;
            if (data?.errors && typeof data.errors === "object") {
                setFieldErrors(data.errors);
                // Surface the first field-specific message as the banner too
                // so the user sees what's wrong without having to look down.
                const first = Object.values(data.errors as Record<string, string>)[0];
                setError(first || data.message || "Registration failed.");
            } else {
                setError(data?.message || "Registration failed. Please try again.");
            }
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="relative min-h-screen w-full flex items-center justify-center bg-zinc-950 overflow-hidden text-zinc-200 py-10">
            <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-[-20%] right-[-10%] w-[600px] h-[600px] bg-purple-900/30 rounded-full blur-[100px] mix-blend-screen animate-pulse" />
                <div className="absolute bottom-[-20%] left-[-10%] w-[500px] h-[500px] bg-violet-900/20 rounded-full blur-[120px] mix-blend-screen opacity-70" />
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
                        <h1 className="text-2xl font-light tracking-wide text-white">
                            FinAssist
                        </h1>
                    </motion.div>
                    <p className="text-zinc-500 text-sm">Create your financial identity</p>
                </div>

                {error && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-start gap-2"
                    >
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>{error}</span>
                    </motion.div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                    <FormField icon={User} type="text" placeholder="Full Name"
                        value={formData.name}
                        onChange={(v) => setFormData({ ...formData, name: v })}
                        error={fieldErrors.name}
                        required maxLength={120}
                    />

                    <FormField icon={Mail} type="email" placeholder="Email Address"
                        value={formData.email}
                        onChange={(v) => setFormData({ ...formData, email: v })}
                        error={fieldErrors.email}
                        required
                    />

                    <div>
                        <FormField icon={Lock} type="password" placeholder="Password"
                            value={formData.password}
                            onChange={(v) => setFormData({ ...formData, password: v })}
                            error={fieldErrors.password}
                            required
                        />
                        {/* Live policy hints */}
                        <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                            {passwordChecks.map((c) => (
                                <li
                                    key={c.id}
                                    className={cn(
                                        "flex items-center gap-1.5",
                                        c.ok ? "text-emerald-400" : "text-zinc-500",
                                    )}
                                >
                                    {c.ok ? <Check className="w-3 h-3" /> : <X className="w-3 h-3 opacity-50" />}
                                    {c.label}
                                </li>
                            ))}
                        </ul>
                    </div>

                    <FormField icon={Lock} type="password" placeholder="Confirm Password"
                        value={formData.confirmPassword}
                        onChange={(v) => setFormData({ ...formData, confirmPassword: v })}
                        onBlur={() => setConfirmTouched(true)}
                        error={
                            confirmTouched && formData.confirmPassword.length > 0 && !passwordsMatch
                                ? "Passwords don't match"
                                : undefined
                        }
                        required
                    />

                    <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        type="submit"
                        className={cn(
                            "w-full flex items-center justify-center gap-2 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white font-medium py-3 rounded-full shadow-lg shadow-purple-900/20 transition-all duration-300 mt-2",
                            isLoading && "opacity-80 cursor-wait"
                        )}
                        disabled={isLoading}
                    >
                        {isLoading ? (
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                            <>
                                Create Account <ArrowRight className="w-4 h-4" />
                            </>
                        )}
                    </motion.button>
                </form>

                <div className="mt-8 text-center text-xs text-zinc-500">
                    Already have an account?{" "}
                    <Link href="/login" className="text-purple-400 hover:text-purple-300 transition-colors font-medium">
                        Sign In
                    </Link>
                </div>
            </motion.div>
        </div>
    );
}

// ── Small field wrapper to keep the JSX flat and the error rendering DRY ──

interface FormFieldProps {
    icon: React.ComponentType<{ className?: string }>;
    type: "text" | "email" | "password";
    placeholder: string;
    value: string;
    onChange: (v: string) => void;
    onBlur?: () => void;
    error?: string;
    required?: boolean;
    maxLength?: number;
}

function FormField({ icon: Icon, type, placeholder, value, onChange, onBlur, error, required, maxLength }: FormFieldProps) {
    return (
        <div className="group">
            <div className="relative">
                <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500 group-focus-within:text-purple-400 transition-colors" />
                <input
                    type={type}
                    placeholder={placeholder}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    onBlur={onBlur}
                    required={required}
                    maxLength={maxLength}
                    className={cn(
                        "w-full bg-zinc-900/50 border-b text-zinc-300 placeholder:text-zinc-600 pl-10 pr-4 py-3 outline-none transition-all duration-300 rounded-t-sm",
                        error
                            ? "border-red-500/60 focus:border-red-500"
                            : "border-zinc-800 focus:border-purple-500",
                    )}
                />
            </div>
            {error && (
                <div className="mt-1 flex items-center gap-1.5 text-red-400 text-xs">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    <span>{error}</span>
                </div>
            )}
        </div>
    );
}
