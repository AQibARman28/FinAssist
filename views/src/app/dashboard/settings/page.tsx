"use client";

import { useState } from "react";
import { Check, CircleCheck, Copy, Loader2, Mail, ShieldCheck, ShieldOff } from "lucide-react";
import Image from "next/image";
import { api } from "@/lib/api";
import { apiErrorMessage } from "@/lib/apiError";
import { useAuthStore } from "@/lib/store";
import { moneyFormatter } from "@/lib/money";
import { Card, FieldLabel, Notice, Page, PageHeader, StateNote, Term } from "@/components/dashboard/ui";

// Written out rather than looked up with Intl.DisplayNames, so the server and
// the browser always render the same names.
const CURRENCIES = [
    { code: "BDT", name: "Bangladeshi taka" },
    { code: "USD", name: "US dollar" },
    { code: "EUR", name: "Euro" },
    { code: "GBP", name: "British pound" },
    { code: "INR", name: "Indian rupee" },
    { code: "CAD", name: "Canadian dollar" },
    { code: "AUD", name: "Australian dollar" },
    { code: "SGD", name: "Singapore dollar" },
    { code: "AED", name: "UAE dirham" },
];
// The sample amount the Currency card shows in the chosen style.
const PREVIEW_AMOUNT = 12500;

// One-time and recovery codes: Geist Mono with wide tracking (DESIGN.md ›
// Inputs). The left padding gains the tracking's width so the code sits centred.
const CODE_FIELD = "field font-mono text-[20px] tracking-[0.3em] text-center pl-[calc(1rem+0.3em)]";
const LINK_BUTTON = "inline-flex items-center min-h-11 rounded-lg text-[13.5px] font-semibold text-plat hover:text-white hover:underline underline-offset-4 transition-colors focus-ring";

const formatRecovery = (v: string) => {
    const raw = v.toUpperCase().replace(/[^A-Z2-7]/g, "").slice(0, 10);
    return raw.length > 5 ? `${raw.slice(0, 5)}-${raw.slice(5)}` : raw;
};

function Spinner() {
    return <Loader2 className="w-4 h-4 animate-spin" aria-hidden />;
}

// A numbered step in the two-factor setup.
function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
    return (
        <li className="flex gap-4">
            <span className="grid place-items-center shrink-0 w-7 h-7 rounded-full border border-white/10 text-[12.5px] font-medium tabular-nums text-zinc-300">{n}</span>
            <div className="min-w-0 flex-1">
                <p className="font-semibold text-white leading-7">{title}</p>
                <div className="mt-4">{children}</div>
            </div>
        </li>
    );
}

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
    const twoFactorOn = !!user?.twoFactorEnabled;
    const changing = emailChanged && form.password ? "email and password" : emailChanged ? "email" : "password";

    const profileError = error && <div role="alert"><Notice tone="bad" className="pr-4">{error}</Notice></div>;

    return (
        // One calm column: each part of the account is its own card, and the
        // profile form's cards share the one Save button under them.
        <Page className="max-w-[840px]">
            <PageHeader title="Settings" sub="Your profile, currency, password and two-factor sign-in." />

            {pendingEmail ? (
                <Card title="Confirm your new email" id="settings-email-confirm">
                    <form onSubmit={confirmEmail} className="space-y-5">
                        <p className="text-[14px] text-zinc-300 max-w-prose">
                            We sent a 6-digit code to <span className="font-semibold text-white break-all">{pendingEmail}</span>. Your email changes once you enter it.
                        </p>
                        <div>
                            <FieldLabel htmlFor="email-change-code">Email change code</FieldLabel>
                            <input
                                id="email-change-code"
                                type="text"
                                inputMode="numeric"
                                autoComplete="one-time-code"
                                maxLength={6}
                                placeholder="000000"
                                value={emailCode}
                                onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, ""))}
                                className={`${CODE_FIELD} sm:max-w-[16rem]`}
                                required
                                autoFocus
                            />
                        </div>
                        {profileError}
                        <div className="flex flex-wrap items-center gap-3">
                            <button type="submit" disabled={isLoading || emailCode.length !== 6} className="btn-primary">
                                {isLoading ? <Spinner /> : <Mail className="w-4 h-4" aria-hidden />}
                                Confirm new email
                            </button>
                            <button type="button" onClick={() => { setPendingEmail(null); setEmailCode(""); setError(null); }} className="btn-quiet">
                                Keep my current email
                            </button>
                        </div>
                    </form>
                </Card>
            ) : (
                <form onSubmit={handleSubmit} className="flex flex-col gap-4 md:gap-6">
                    <Card title="Profile" id="settings-profile">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <div>
                                <FieldLabel htmlFor="profile-name">Full name</FieldLabel>
                                <input
                                    id="profile-name"
                                    type="text"
                                    value={form.name}
                                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                                    className="field"
                                    required
                                />
                            </div>
                            <div>
                                <FieldLabel htmlFor="profile-email">Email</FieldLabel>
                                <input
                                    id="profile-email"
                                    type="email"
                                    value={form.email}
                                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                                    aria-describedby={emailChanged ? "profile-email-hint" : undefined}
                                    className="field"
                                    required
                                />
                                {emailChanged && (
                                    <p id="profile-email-hint" className="mt-2 text-[12.5px] text-zinc-400">
                                        We&apos;ll send a code to the new address. It changes once you enter that code.
                                    </p>
                                )}
                            </div>
                        </div>
                    </Card>

                    <Card title="Currency" id="settings-currency">
                        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] items-end gap-5 sm:gap-10">
                            <div>
                                <FieldLabel htmlFor="profile-currency">Show amounts in</FieldLabel>
                                <select
                                    id="profile-currency"
                                    value={form.currency}
                                    onChange={(e) => setForm({ ...form, currency: e.target.value })}
                                    aria-describedby="profile-currency-note"
                                    className="field"
                                >
                                    {CURRENCIES.map((c) => (
                                        <option key={c.code} value={c.code} className="bg-graphite">{c.code} · {c.name}</option>
                                    ))}
                                </select>
                            </div>
                            <dl className="sm:pb-2.5">
                                <Term label="Looks like" className="sm:text-right">{moneyFormatter(form.currency).format(PREVIEW_AMOUNT)}</Term>
                            </dl>
                        </div>
                        <p id="profile-currency-note" className="mt-4 text-[12.5px] text-zinc-400">
                            Every amount is shown in this currency. Amounts you&apos;ve already logged aren&apos;t converted.
                        </p>
                    </Card>

                    <Card title="Password" id="settings-password">
                        <p id="profile-password-note" className="-mt-1 mb-5 text-[13.5px] text-zinc-400 max-w-prose">
                            Leave both blank to keep your current password. A new password signs out your other sessions.
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <div>
                                <FieldLabel htmlFor="profile-new-password">New password</FieldLabel>
                                <input
                                    id="profile-new-password"
                                    type="password"
                                    autoComplete="new-password"
                                    value={form.password}
                                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                                    placeholder="At least 8 characters"
                                    aria-describedby="profile-password-note"
                                    className="field"
                                />
                            </div>
                            <div>
                                <FieldLabel htmlFor="profile-confirm-password">Confirm password</FieldLabel>
                                <input
                                    id="profile-confirm-password"
                                    type="password"
                                    autoComplete="new-password"
                                    value={form.confirmPassword}
                                    onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                                    className="field"
                                />
                            </div>
                        </div>
                    </Card>

                    {/* The step this change needs, marked as the current step. */}
                    {sensitive && (
                        <Card title="Confirm it's you" id="settings-reauth" className="ring-1 ring-plat/40">
                            <p className="-mt-1 mb-5 text-[13.5px] text-zinc-300 max-w-prose">
                                To change your {changing}, enter your current password{twoFactorOn ? " and a code from your authenticator app" : ""}.
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                <div>
                                    <FieldLabel htmlFor="profile-current-password">Current password</FieldLabel>
                                    <input
                                        id="profile-current-password"
                                        type="password"
                                        autoComplete="current-password"
                                        value={form.currentPassword}
                                        onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
                                        className="field"
                                        required
                                    />
                                </div>
                                {twoFactorOn && (
                                    <div>
                                        <FieldLabel htmlFor="profile-totp">Authenticator code</FieldLabel>
                                        <input
                                            id="profile-totp"
                                            type="text"
                                            inputMode="numeric"
                                            autoComplete="one-time-code"
                                            maxLength={6}
                                            placeholder="000000"
                                            value={form.totp}
                                            onChange={(e) => setForm({ ...form, totp: e.target.value.replace(/\D/g, "") })}
                                            className={CODE_FIELD}
                                            required
                                        />
                                    </div>
                                )}
                            </div>
                        </Card>
                    )}

                    {profileError}
                    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end sm:gap-6">
                        <p role="status" className="sm:mr-auto">
                            {success && <StateNote tone="good" icon={CircleCheck} className="text-[13.5px]">{success}</StateNote>}
                        </p>
                        <button type="submit" disabled={isLoading} className="btn-primary w-full sm:w-auto sm:min-w-40">
                            {isLoading && <Spinner />}
                            Save changes
                        </button>
                    </div>
                </form>
            )}

            <Card
                title="Two-factor authentication"
                id="settings-2fa"
                aside={twoFactorOn
                    ? <StateNote tone="good" icon={ShieldCheck}>On</StateNote>
                    : <StateNote tone="neutral" icon={ShieldOff}>Off</StateNote>}
            >
                {tfaError && <div role="alert" className="mb-5"><Notice tone="bad" className="pr-4">{tfaError}</Notice></div>}
                <div role="status">
                    {/* Turning protection off is confirmed plainly, not in the "good" tone. */}
                    {tfaSuccess && <Notice tone={twoFactorOn ? "good" : "neutral"} icon={CircleCheck} className="mb-5 pr-4">{tfaSuccess}</Notice>}
                </div>

                {tfaStep === "idle" && (
                    <div className="space-y-5">
                        <p className="text-[14px] text-zinc-300 max-w-prose">
                            {twoFactorOn
                                ? "Signing in asks for a 6-digit code from your authenticator app as well as your password."
                                : "Use an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password) for an extra layer of security: signing in then asks for a 6-digit code as well."}
                        </p>
                        {!twoFactorOn ? (
                            <button type="button" onClick={startSetup2FA} disabled={tfaLoading} className="btn-secondary">
                                {tfaLoading ? <Spinner /> : <ShieldCheck className="w-4 h-4" aria-hidden />}
                                Turn on two-factor
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={() => { setTfaStep("disable"); setTfaError(null); setTfaSuccess(null); }}
                                className="btn-danger"
                            >
                                <ShieldOff className="w-4 h-4" aria-hidden />
                                Turn off two-factor
                            </button>
                        )}
                    </div>
                )}

                {tfaStep === "setup" && tfaQR && (
                    <ol className="space-y-8">
                        <Step n={1} title="Scan this QR code with your authenticator app">
                            <div className="flex flex-col sm:flex-row sm:items-center gap-5 sm:gap-8">
                                {/* The code needs a light quiet zone to scan: a white plate. */}
                                <div className="self-start shrink-0 p-3 rounded-xl bg-white">
                                    <Image src={tfaQR} alt="2FA QR code" width={180} height={180} unoptimized />
                                </div>
                                {tfaManual && (
                                    <div className="min-w-0">
                                        <p className="text-[12.5px] text-zinc-400">Or enter this key by hand</p>
                                        <code className="mt-2 block font-mono text-[14px] leading-7 tracking-[0.3em] text-white break-all select-all">{tfaManual}</code>
                                    </div>
                                )}
                            </div>
                        </Step>
                        <Step n={2} title="Enter the 6-digit code it shows">
                            <form onSubmit={confirmEnable2FA} className="space-y-5">
                                <div>
                                    <FieldLabel htmlFor="tfa-enable-code">Authenticator code</FieldLabel>
                                    <input
                                        id="tfa-enable-code"
                                        type="text"
                                        inputMode="numeric"
                                        autoComplete="one-time-code"
                                        pattern="[0-9]{6}"
                                        maxLength={6}
                                        placeholder="000000"
                                        value={tfaCode}
                                        onChange={(e) => setTfaCode(e.target.value.replace(/\D/g, ""))}
                                        className={`${CODE_FIELD} sm:max-w-[16rem]`}
                                        required
                                        autoFocus
                                    />
                                </div>
                                <div className="flex flex-wrap items-center gap-3">
                                    <button type="submit" disabled={tfaLoading || tfaCode.length !== 6} className="btn-primary">
                                        {tfaLoading ? <Spinner /> : <ShieldCheck className="w-4 h-4" aria-hidden />}
                                        Confirm and turn on
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => { setTfaStep("idle"); setTfaCode(""); setTfaQR(null); setTfaError(null); }}
                                        className="btn-quiet"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </form>
                        </Step>
                    </ol>
                )}

                {tfaStep === "codes" && (
                    <div className="space-y-5">
                        <StateNote tone="good" icon={ShieldCheck} className="text-[13.5px]">Two-factor authentication is on</StateNote>
                        <p className="text-[14px] text-zinc-300 max-w-prose">
                            Save these recovery codes somewhere safe. Each one signs you in once if you lose your phone, and they won&apos;t be shown again.
                        </p>
                        <ul
                            aria-label="Recovery codes"
                            className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-x-8 gap-y-3 p-5 rounded-xl bg-black/40 border border-white/10 font-mono text-[15px] tracking-[0.3em] text-white select-all"
                        >
                            {recoveryCodes.map((c) => <li key={c}>{c}</li>)}
                        </ul>
                        <div className="flex flex-wrap items-center gap-3">
                            <button type="button" onClick={copyRecoveryCodes} className="btn-secondary">
                                {codesCopied ? <Check className="w-4 h-4" aria-hidden /> : <Copy className="w-4 h-4" aria-hidden />}
                                {codesCopied ? "Copied" : "Copy codes"}
                            </button>
                            <button
                                type="button"
                                onClick={() => { setRecoveryCodes([]); setTfaStep("idle"); setTfaSuccess("Two-factor authentication enabled."); }}
                                className="btn-primary"
                            >
                                I&apos;ve saved them
                            </button>
                        </div>
                    </div>
                )}

                {tfaStep === "disable" && (
                    <form onSubmit={confirmDisable2FA} className="space-y-5">
                        <p className="text-[14px] text-zinc-300 max-w-prose">
                            {tfaUseRecovery ? "Enter one of your recovery codes to turn off two-factor." : "Enter the code from your authenticator app to turn off two-factor."}
                        </p>
                        <div>
                            {tfaUseRecovery ? (
                                <>
                                    <FieldLabel htmlFor="tfa-disable-recovery">Recovery code</FieldLabel>
                                    <input
                                        id="tfa-disable-recovery"
                                        type="text"
                                        placeholder="ABCDE-FGHIJ"
                                        value={tfaCode}
                                        onChange={(e) => setTfaCode(formatRecovery(e.target.value))}
                                        className={`${CODE_FIELD} sm:max-w-[18rem]`}
                                        required
                                        autoFocus
                                    />
                                </>
                            ) : (
                                <>
                                    <FieldLabel htmlFor="tfa-disable-code">Authenticator code</FieldLabel>
                                    <input
                                        id="tfa-disable-code"
                                        type="text"
                                        inputMode="numeric"
                                        autoComplete="one-time-code"
                                        pattern="[0-9]{6}"
                                        maxLength={6}
                                        placeholder="000000"
                                        value={tfaCode}
                                        onChange={(e) => setTfaCode(e.target.value.replace(/\D/g, ""))}
                                        className={`${CODE_FIELD} sm:max-w-[16rem]`}
                                        required
                                        autoFocus
                                    />
                                </>
                            )}
                            <button
                                type="button"
                                onClick={() => { setTfaUseRecovery((v) => !v); setTfaCode(""); setTfaError(null); }}
                                className={`mt-2 ${LINK_BUTTON}`}
                            >
                                {tfaUseRecovery ? "Use my authenticator app instead" : "Lost your phone? Use a recovery code"}
                            </button>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                            <button type="submit" disabled={tfaLoading || !disableReady} className="btn-danger">
                                {tfaLoading ? <Spinner /> : <ShieldOff className="w-4 h-4" aria-hidden />}
                                Turn off two-factor
                            </button>
                            <button
                                type="button"
                                onClick={() => { setTfaStep("idle"); setTfaCode(""); setTfaUseRecovery(false); setTfaError(null); }}
                                className="btn-quiet"
                            >
                                Cancel
                            </button>
                        </div>
                    </form>
                )}
            </Card>
        </Page>
    );
}
