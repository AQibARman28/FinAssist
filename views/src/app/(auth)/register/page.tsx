"use client";

import { ArrowRight, Circle, CircleCheck, Eye, EyeOff, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { apiErrorBody } from "@/lib/apiError";
import { useAuthStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { VerifyCode } from "@/components/auth/VerifyCode";
import { FieldError, FieldLabel, Notice, PageHeader, StateNote } from "@/components/dashboard/ui";

// Mirrors the server's password policy (Backend/validators/common.js).
// Showing it client-side stops users from staring at a generic
// "Invalid request" while wondering which rule they broke. The server also
// refuses very common and breached passwords, and says so in its message.
const PASSWORD_RULES = [
    { id: "len", label: "At least 8 characters", test: (s: string) => s.length >= 8 },
] as const;

const LINK = "inline-flex items-center min-h-11 rounded-lg font-semibold text-plat hover:text-white hover:underline underline-offset-4 transition-colors focus-ring";

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
    // After registering we drop into the inline "enter the code" step.
    const [pendingEmail, setPendingEmail] = useState<string | null>(null);
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
            // The field says so under itself; take the user there.
            document.getElementById("register-confirm")?.focus();
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

            // Every account now verifies by code. Drop into the inline
            // code-entry step; on success the server logs them straight in.
            if (res.data?.requiresEmailVerification) {
                setPendingEmail(res.data?.email || formData.email);
            } else {
                setUser(res.data.data);
                router.push("/dashboard");
            }
        } catch (err: unknown) {
            const data = apiErrorBody(err);
            if (data?.errors && typeof data.errors === "object") {
                setFieldErrors(data.errors);
                // Surface the first field-specific message as the banner too
                // so the user sees what's wrong without having to look down.
                const first = Object.values(data.errors)[0];
                setError(first || data.message || "Registration failed.");
            } else {
                setError(data?.message || "Registration failed. Please try again.");
            }
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <>
            <div className="mb-8">
                {pendingEmail
                    ? <PageHeader title="Check your email" sub="One last step." />
                    : <PageHeader title="Create your account" sub="Your spending, budgets and goals in one place." />}
            </div>

            {pendingEmail ? (
                <VerifyCode
                    email={pendingEmail}
                    onVerified={(u) => { setUser(u as Parameters<typeof setUser>[0]); router.push("/dashboard"); }}
                    onBack={() => setPendingEmail(null)}
                />
            ) : (
            <>
            {error && <div role="alert" className="mb-5"><Notice tone="bad" className="pr-4">{error}</Notice></div>}

            <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                <Field id="register-name" label="Full name" type="text" autoComplete="name"
                    value={formData.name}
                    onChange={(v) => setFormData({ ...formData, name: v })}
                    error={fieldErrors.name}
                    required maxLength={120}
                />

                <Field id="register-email" label="Email" type="email" autoComplete="email"
                    value={formData.email}
                    onChange={(v) => setFormData({ ...formData, email: v })}
                    error={fieldErrors.email}
                    required
                />

                <Field id="register-password" label="Password" type="password" autoComplete="new-password"
                    value={formData.password}
                    onChange={(v) => setFormData({ ...formData, password: v })}
                    error={fieldErrors.password}
                    hintId="register-password-rules"
                    required
                >
                    {/* Live policy hints: an icon and words for each rule. */}
                    <ul id="register-password-rules" className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
                        {passwordChecks.map((c) => (
                            <li key={c.id}>
                                <StateNote tone={c.ok ? "good" : "neutral"} icon={c.ok ? CircleCheck : Circle}>
                                    <span className="sr-only">{c.ok ? "Done: " : "Needed: "}</span>{c.label}
                                </StateNote>
                            </li>
                        ))}
                    </ul>
                </Field>

                <Field id="register-confirm" label="Confirm password" type="password" autoComplete="new-password"
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

                <div className="pt-2">
                    <button type="submit" disabled={isLoading} className="btn-primary w-full min-h-12">
                        {isLoading
                            ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden /><span className="sr-only">Creating your account</span></>
                            : <>Create account <ArrowRight className="w-4 h-4" aria-hidden /></>}
                    </button>
                </div>
            </form>

            <p className="mt-8 flex flex-wrap items-center gap-x-1.5 text-[13.5px] text-zinc-400">
                Already have an account?
                <Link href="/login" className={LINK}>Sign in</Link>
            </p>
            </>
            )}
        </>
    );
}

// ── One labelled field: its label, the well, an optional hint under it, and
// its error, wired with aria-invalid and aria-describedby. Password fields
// get a show/hide toggle. ──

interface FieldProps {
    id: string;
    label: string;
    type: "text" | "email" | "password";
    autoComplete: string;
    value: string;
    onChange: (v: string) => void;
    onBlur?: () => void;
    error?: string;
    // The id of a hint rendered as `children` (for aria-describedby).
    hintId?: string;
    children?: React.ReactNode;
    required?: boolean;
    maxLength?: number;
}

function Field({ id, label, type, autoComplete, value, onChange, onBlur, error, hintId, children, required, maxLength }: FieldProps) {
    const [reveal, setReveal] = useState(false);
    const isPassword = type === "password";
    const inputType = isPassword && reveal ? "text" : type;
    const errorId = `${id}-error`;
    const describedBy = [hintId, error ? errorId : null].filter(Boolean).join(" ") || undefined;
    return (
        <div>
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            <div className="relative">
                <input
                    id={id}
                    type={inputType}
                    autoComplete={autoComplete}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    onBlur={onBlur}
                    required={required}
                    maxLength={maxLength}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={describedBy}
                    className={cn("field", isPassword && "pr-14")}
                />
                {isPassword && (
                    <button
                        type="button"
                        onClick={() => setReveal((s) => !s)}
                        className="btn-icon absolute right-0.5 top-1/2 -translate-y-1/2"
                        aria-label={reveal ? "Hide password" : "Show password"}
                    >
                        {reveal ? <EyeOff className="w-5 h-5" aria-hidden /> : <Eye className="w-5 h-5" aria-hidden />}
                    </button>
                )}
            </div>
            {children}
            {error && <FieldError id={errorId}>{error}</FieldError>}
        </div>
    );
}
