"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Plus, Check, AlertCircle, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    CATEGORY_ICONS, CATEGORY_COLOR_SWATCHES, ICON_NAMES, iconFor,
    type IconName,
} from "@/lib/categoryIcons";

// API shape — keep loose so we don't need a separate type module.
interface Category {
    _id: string;
    name: string;
    type: "expense" | "income" | "both";
    color: string;
    icon: IconName;
    isArchived: boolean;
    sortOrder: number;
}

interface CategoryPickerProps {
    value: string | null;
    onChange: (id: string) => void;
    type: "expense" | "income";
    error?: string;
    /** Optional placeholder when nothing selected. */
    placeholder?: string;
    /** Disables the trigger button. */
    disabled?: boolean;
}

export function CategoryPicker({
    value, onChange, type, error,
    placeholder = "Select category",
    disabled = false,
}: CategoryPickerProps) {
    const [cats, setCats]         = useState<Category[]>([]);
    const [open, setOpen]         = useState(false);
    const [loading, setLoading]   = useState(true);
    const [creating, setCreating] = useState(false);
    const rootRef                 = useRef<HTMLDivElement>(null);

    // ── Load categories on mount (and when type changes) ────────────────────
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        api.get(`/categories?type=${type}`)
            .then((res) => {
                if (cancelled) return;
                // Archived rows are excluded by default at the API layer; this
                // is belt-and-suspenders in case the API behavior changes.
                setCats((res.data?.data || []).filter((c: Category) => !c.isArchived));
            })
            .catch((err) => {
                console.error("CategoryPicker: load failed", err);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [type]);

    // ── Click-outside-to-close ──────────────────────────────────────────────
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
                setOpen(false);
                setCreating(false);
            }
        };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, [open]);

    const selected = value ? cats.find((c) => c._id === value) : null;

    const handleCreated = (cat: Category) => {
        setCats((prev) => [...prev, cat].sort((a, b) =>
            a.sortOrder !== b.sortOrder ? a.sortOrder - b.sortOrder : a.name.localeCompare(b.name)
        ));
        onChange(cat._id);
        setCreating(false);
        setOpen(false);
    };

    const TriggerIcon = selected ? iconFor(selected.icon) : ChevronDown;

    return (
        <div ref={rootRef} className="relative">
            <button
                type="button"
                onClick={() => !disabled && setOpen((o) => !o)}
                disabled={disabled}
                className={cn(
                    "w-full flex items-center gap-3 bg-black/40 border rounded-xl px-4 py-3 text-left transition-colors",
                    error ? "border-red-500/50" : "border-white/10",
                    !disabled && "hover:border-purple-500/30 focus:outline-none focus:border-purple-500/50",
                    disabled && "opacity-50 cursor-not-allowed",
                )}
            >
                {selected ? (
                    <>
                        <span
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{ backgroundColor: selected.color }}
                        />
                        <TriggerIcon className="w-4 h-4 text-zinc-400 shrink-0" />
                        <span className="text-white font-medium truncate">{selected.name}</span>
                    </>
                ) : (
                    <span className="text-zinc-500 flex-1">{placeholder}</span>
                )}
                <ChevronDown className={cn(
                    "w-4 h-4 text-zinc-500 ml-auto transition-transform",
                    open && "rotate-180",
                )} />
            </button>

            {error && (
                <div className="mt-1.5 flex items-center gap-1.5 text-red-400 text-xs">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            {open && (
                <div className="absolute top-full left-0 right-0 mt-2 z-50 bg-zinc-900 border border-white/10 rounded-xl shadow-2xl shadow-black/50 max-h-80 overflow-hidden flex flex-col">
                    {loading ? (
                        <div className="flex items-center justify-center py-8 text-zinc-500">
                            <Loader2 className="w-4 h-4 animate-spin" />
                        </div>
                    ) : creating ? (
                        <InlineCreateForm
                            type={type}
                            onCancel={() => setCreating(false)}
                            onCreated={handleCreated}
                        />
                    ) : (
                        <>
                            <div className="overflow-y-auto flex-1 py-1">
                                {cats.length === 0 ? (
                                    <div className="px-4 py-3 text-sm text-zinc-500">
                                        No {type} categories yet — create one below.
                                    </div>
                                ) : (
                                    cats.map((c) => {
                                        const Icon = iconFor(c.icon);
                                        const isSelected = c._id === value;
                                        return (
                                            <button
                                                key={c._id}
                                                type="button"
                                                onClick={() => { onChange(c._id); setOpen(false); }}
                                                className={cn(
                                                    "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors",
                                                    isSelected
                                                        ? "bg-purple-500/10 text-purple-300"
                                                        : "text-zinc-300 hover:bg-white/5",
                                                )}
                                            >
                                                <span
                                                    className="w-3 h-3 rounded-full shrink-0"
                                                    style={{ backgroundColor: c.color }}
                                                />
                                                <Icon className="w-4 h-4 shrink-0" />
                                                <span className="font-medium truncate">{c.name}</span>
                                                {isSelected && <Check className="w-4 h-4 ml-auto text-purple-400" />}
                                            </button>
                                        );
                                    })
                                )}
                            </div>
                            <button
                                type="button"
                                onClick={() => setCreating(true)}
                                className="flex items-center gap-2 px-4 py-3 text-sm text-purple-400 hover:bg-purple-500/10 border-t border-white/5 transition-colors"
                            >
                                <Plus className="w-4 h-4" />
                                New category
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

// ── Inline-create form (lives inside the open popover) ──────────────────────

interface InlineCreateFormProps {
    type: "expense" | "income";
    onCancel: () => void;
    onCreated: (cat: Category) => void;
}

function InlineCreateForm({ type, onCancel, onCreated }: InlineCreateFormProps) {
    const [name, setName]     = useState("");
    const [color, setColor]   = useState(CATEGORY_COLOR_SWATCHES[0]);
    const [icon, setIcon]     = useState<IconName>("more");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError]   = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;
        setSubmitting(true);
        setError(null);
        try {
            const res = await api.post("/categories", { name: name.trim(), type, color, icon });
            onCreated(res.data.data as Category);
        } catch (err: any) {
            const msg = err.response?.data?.message
                || (err.response?.data?.errors && Object.values(err.response.data.errors).join(", "))
                || "Failed to create category";
            setError(msg);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
            <input
                autoFocus
                type="text"
                placeholder="Category name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
                className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-purple-500/50"
            />

            <div>
                <div className="text-xs text-zinc-500 mb-1.5">Color</div>
                <div className="flex flex-wrap gap-1.5">
                    {CATEGORY_COLOR_SWATCHES.map((c) => (
                        <button
                            key={c}
                            type="button"
                            onClick={() => setColor(c)}
                            aria-label={`color ${c}`}
                            className={cn(
                                "w-6 h-6 rounded-full transition-all",
                                color === c ? "ring-2 ring-white ring-offset-2 ring-offset-zinc-900 scale-110" : "hover:scale-110",
                            )}
                            style={{ backgroundColor: c }}
                        />
                    ))}
                </div>
            </div>

            <div>
                <div className="text-xs text-zinc-500 mb-1.5">Icon</div>
                <div className="grid grid-cols-7 gap-1.5">
                    {ICON_NAMES.map((n) => {
                        const I = CATEGORY_ICONS[n];
                        const selected = icon === n;
                        return (
                            <button
                                key={n}
                                type="button"
                                onClick={() => setIcon(n)}
                                aria-label={n}
                                className={cn(
                                    "w-8 h-8 flex items-center justify-center rounded-lg transition-colors",
                                    selected
                                        ? "bg-purple-500/20 text-purple-300 ring-1 ring-purple-500/50"
                                        : "bg-black/40 text-zinc-400 hover:text-zinc-200 hover:bg-white/5",
                                )}
                            >
                                <I className="w-4 h-4" />
                            </button>
                        );
                    })}
                </div>
            </div>

            {error && (
                <div className="text-red-400 text-xs flex items-center gap-1.5">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            <div className="flex gap-2 pt-1">
                <button
                    type="submit"
                    disabled={submitting || !name.trim()}
                    className="flex-1 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-sm font-medium px-3 py-2 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                >
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Create
                </button>
                <button
                    type="button"
                    onClick={onCancel}
                    className="px-3 py-2 text-sm text-zinc-400 hover:text-zinc-200 rounded-lg transition-colors"
                >
                    Cancel
                </button>
            </div>
        </form>
    );
}
