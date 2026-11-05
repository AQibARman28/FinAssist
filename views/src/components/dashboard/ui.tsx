"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ChevronRight, CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { RollingNumber } from "./home/RollingNumber";

// The Timeline world's shared pieces (DESIGN.md). Every dashboard page is
// built from these, so a card, a heading, a meter or a state reads the same
// wherever it appears.

const EASE = [0.16, 1, 0.3, 1] as const;

type Tone = "good" | "warn" | "bad" | "neutral";
type IconType = React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

// The page column: centred, capped at 1280px, with the shell's side padding.
export function Page({ children, className }: { children: React.ReactNode; className?: string }) {
    return (
        <div className={cn("mx-auto max-w-[1280px] px-4 pt-5 md:px-8 md:pt-8 lg:px-10 flex flex-col gap-4 md:gap-6 [&>*]:min-w-0", className)}>
            {children}
        </div>
    );
}

// The page's own heading: the headline style (light, a little wide), a
// sentence under it, and the page's main actions on the right.
export function PageHeader({ title, sub, children, id = "page-title" }: {
    title: string;
    sub?: React.ReactNode;
    children?: React.ReactNode;
    id?: string;
}) {
    return (
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <div className="min-w-0">
                {/* tabIndex -1: focus can land here when a panel the user was in closes. */}
                <h1 id={id} tabIndex={-1} className="text-[26px] md:text-[30px] font-light [font-stretch:112%] tracking-[-0.01em] text-white break-words outline-none">{title}</h1>
                {sub && <p className="mt-1.5 text-[13.5px] text-zinc-400 max-w-prose">{sub}</p>}
            </div>
            {children && <div className="flex flex-wrap items-center gap-2 shrink-0">{children}</div>}
        </header>
    );
}

// A page's headline figure: the label in wide capitals, the amount extra-wide
// and light, rolling into place. A figure that failed to load is a dash,
// never a zero.
export function HeroFigure({ label, value, unit, loading, failed, children, className, size = "lg" }: {
    label: string;
    value: string | null;
    unit?: string;
    loading?: boolean;
    failed?: boolean;
    children?: React.ReactNode;
    className?: string;
    size?: "lg" | "md";
}) {
    const text = size === "lg" ? "text-[clamp(3.25rem,9vw,5.5rem)]" : "text-[clamp(2.5rem,6vw,3.5rem)]";
    return (
        <div className={cn("min-w-0", className)}>
            <p className="label-caps text-zinc-300">{label}</p>
            <div className={cn("mt-2 flex flex-wrap items-baseline gap-x-3 text-white", text)}>
                {loading ? (
                    <span aria-hidden className="block h-[1em] w-[4.5em] rounded-2xl bg-white/[0.05] animate-pulse" />
                ) : failed || value === null ? (
                    <Missing className="figure-wide leading-[1.2]" />
                ) : (
                    <RollingNumber text={value} className="figure-wide" />
                )}
                {unit && !loading && !failed && value !== null && <span className="text-[17px] md:text-[20px] text-zinc-300">{unit}</span>}
            </div>
            {children && <div className="mt-3 text-[15px] md:text-[16px] text-zinc-300 max-w-prose">{children}</div>}
        </div>
    );
}

// A smaller figure for a row of terms ("In savings ৳4,200"): wide capitals
// over a light, wide amount with tabular digits.
export function Term({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
    return (
        <div className={cn("min-w-0", className)}>
            <dt className="label-caps text-zinc-400">{label}</dt>
            <dd className="mt-2 text-[22px] md:text-[26px] leading-none font-light [font-stretch:112%] tabular-nums text-white break-words">{children}</dd>
        </div>
    );
}

// The section frame: a graphite surface with a faint top highlight, 24px
// corners, a heading in wide spaced capitals, and an optional link or control
// on the right. Without a title it is just the surface.
export function Card({
    title, id, action, aside, children, className,
}: {
    title?: string;
    id?: string;
    action?: { href: string; label: string };
    // A control in the header instead of a link (a month toggle, a label).
    aside?: React.ReactNode;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <section aria-labelledby={title ? id : undefined} className={cn("min-w-0 p-5 md:p-7 rounded-3xl bg-graphite shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]", className)}>
            {title && (
                <div className="flex flex-wrap items-center justify-between gap-3 mb-5 min-h-11">
                    <h2 id={id} className="label-caps text-[12px] text-zinc-300">{title}</h2>
                    {aside}
                    {action && <CardLink href={action.href}>{action.label}</CardLink>}
                </div>
            )}
            {children}
        </section>
    );
}

export function CardLink({ href, children }: { href: string; children: React.ReactNode }) {
    return (
        <Link
            href={href}
            className="-mr-2 inline-flex items-center gap-0.5 min-h-11 px-2 rounded-lg text-[13px] font-semibold text-plat hover:text-white hover:bg-white/[0.05] transition-colors focus-ring"
        >
            {children}
            <ChevronRight className="w-4 h-4" aria-hidden />
        </Link>
    );
}

// A segmented control: "This month / Last month", "Monthly / Yearly", a
// page's views. The chosen option is the platinum pill.
export function Segmented<T extends string>({ items, value, onChange, label, className }: {
    items: { key: T; label: string; icon?: IconType }[];
    value: T;
    onChange: (v: T) => void;
    label: string;
    className?: string;
}) {
    return (
        <div role="group" aria-label={label} className={cn("inline-flex max-w-full overflow-x-auto p-[3px] rounded-full bg-white/[0.07]", className)}>
            {items.map(({ key, label: text, icon: Icon }) => (
                <button
                    key={key}
                    type="button"
                    aria-pressed={key === value}
                    onClick={() => onChange(key)}
                    className={cn(
                        "inline-flex shrink-0 items-center gap-1.5 min-h-9 px-3.5 rounded-full text-xs font-semibold transition-colors focus-ring",
                        key === value ? "bg-plat text-plat-ink" : "text-zinc-400 hover:text-zinc-200",
                    )}
                >
                    {Icon && <Icon className="w-3.5 h-3.5" aria-hidden />}
                    {text}
                </button>
            ))}
        </div>
    );
}

// The value couldn't load: a dash, never a made-up zero (page shows the retry).
export function Missing({ className }: { className?: string }) {
    return (
        <span className={cn("text-zinc-600", className)}>
            <span aria-hidden>—</span><span className="sr-only">Couldn&apos;t load</span>
        </span>
    );
}

const TONE_ICON: Record<Tone, string> = {
    good: "text-emerald-400",
    warn: "text-amber-300",
    bad: "text-red-400",
    neutral: "text-zinc-400",
};

// Words plus an icon for a state, never colour alone.
export function StateNote({ tone, icon: Icon, children, className }: {
    tone: Tone;
    icon?: IconType;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <span className={cn("inline-flex items-center gap-1.5 text-[12.5px] text-zinc-300", className)}>
            {Icon && <Icon aria-hidden className={cn("w-[15px] h-[15px] shrink-0", TONE_ICON[tone])} />}
            {children}
        </span>
    );
}

const NOTICE: Record<Tone, string> = {
    good: "bg-emerald-500/10 border-emerald-500/20 text-emerald-100",
    warn: "bg-amber-500/10 border-amber-500/20 text-amber-100",
    bad: "bg-red-500/10 border-red-500/20 text-red-100",
    neutral: "bg-white/[0.04] border-white/[0.08] text-zinc-300",
};
const NOTICE_ICON: Record<Tone, IconType> = { good: CircleCheck, warn: TriangleAlert, bad: CircleAlert, neutral: Info };

// A sentence that needs attention, in its state's tint, with its icon. An
// optional action sits on the right ("See the plan").
export function Notice({ tone, children, action, className, icon, role }: {
    tone: Tone;
    children: React.ReactNode;
    action?: React.ReactNode;
    className?: string;
    icon?: IconType;
    // "alert" for an error that just happened, "status" for news.
    role?: "alert" | "status";
}) {
    const Icon = icon ?? NOTICE_ICON[tone];
    return (
        <div role={role} className={cn("flex items-center gap-3 pl-4 py-1.5 min-h-12 rounded-xl border text-[13.5px]", action ? "pr-1.5" : "pr-4", NOTICE[tone], className)}>
            <Icon aria-hidden className={cn("w-4 h-4 shrink-0", TONE_ICON[tone])} />
            <div className="flex-1 min-w-0 py-1.5">{children}</div>
            {action}
        </div>
    );
}

// A thin meter on a platinum track. `tick` marks a reference point (an even
// pace through the month); the fill grows from the left on first view.
export function Meter({ fraction, tone = "plat", tick, delay = 0, className, size = "md" }: {
    fraction: number;
    // "dim" is a figure compared with the one being read (last month).
    tone?: "plat" | "dim" | "warn" | "bad" | "good";
    tick?: number;
    delay?: number;
    className?: string;
    size?: "sm" | "md";
}) {
    const fill = tone === "bad" ? "bg-red-400" : tone === "warn" ? "bg-amber-400" : tone === "good" ? "bg-emerald-400" : tone === "dim" ? "bg-plat/30" : "bg-plat";
    return (
        <div aria-hidden className={cn("relative rounded-full bg-plat/[0.12]", size === "sm" ? "h-1" : "h-2", className)}>
            <motion.div
                className={cn("absolute inset-y-0 left-0 rounded-full", fill)}
                style={{ width: `${Math.max(0, Math.min(1, fraction)) * 100}%`, originX: 0 }}
                initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true }}
                transition={{ duration: 0.9, delay: 0.15 + delay, ease: EASE }}
            />
            {tick !== undefined && (
                <motion.span
                    className="absolute -top-[5px] -bottom-[5px] w-[2px] -ml-px rounded-full bg-zinc-100"
                    style={{ left: `${Math.max(0, Math.min(1, tick)) * 100}%` }}
                    initial={{ opacity: 0, y: -8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
                    transition={{ duration: 0.5, delay: 0.7 + delay, ease: EASE }}
                />
            )}
        </div>
    );
}

// Nothing here yet: a plain sentence, a quieter line under it, and the one
// action that fills the space. No dashed boxes.
export function Empty({ icon: Icon, title, children, action, className }: {
    icon?: IconType;
    title: string;
    children?: React.ReactNode;
    action?: React.ReactNode;
    className?: string;
}) {
    return (
        <div className={cn("flex flex-col items-center gap-3 py-12 px-4 text-center", className)}>
            {Icon && <span className="grid place-items-center w-12 h-12 rounded-2xl bg-white/[0.05] text-zinc-400"><Icon className="w-5 h-5" aria-hidden /></span>}
            <p className="font-semibold text-white">{title}</p>
            {children && <p className="-mt-1.5 text-[13.5px] text-zinc-400 max-w-sm">{children}</p>}
            {action && <div className="mt-1">{action}</div>}
        </div>
    );
}

// A placeholder block in the final content's size and corner.
export function Skeleton({ className }: { className?: string }) {
    return <div aria-hidden className={cn("rounded-2xl bg-white/[0.05] animate-pulse", className)} />;
}

// A form field's label and the line under it. Errors are announced.
export function FieldLabel({ htmlFor, children, className }: { htmlFor: string; children: React.ReactNode; className?: string }) {
    return <label htmlFor={htmlFor} className={cn("block mb-2 text-[13px] font-medium text-zinc-300", className)}>{children}</label>;
}

export function FieldError({ id, children }: { id?: string; children: React.ReactNode }) {
    return <p id={id} role="alert" className="mt-2 text-xs text-red-400">{children}</p>;
}
