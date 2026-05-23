"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
    ChevronDown, Plus, Check, AlertCircle, Loader2,
    Pencil, Trash2, Archive, Search, Eye, EyeOff, Sparkles,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
    CATEGORY_ICONS, CATEGORY_COLOR_SWATCHES, ICON_NAMES, iconFor,
    type IconName,
} from "@/lib/categoryIcons";

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
    placeholder?: string;
    disabled?: boolean;
    /**
     * SEAM for EXP-1 Phase 4 (learning categorizer): when provided, the matching
     * row is pre-highlighted as a suggestion. No caller passes this yet; the
     * suggestion layer will wire it in. It NEVER auto-selects — categorization
     * stays an explicit user choice.
     */
    suggestedCategoryId?: string;
    /**
     * When true and nothing is selected yet, pre-select the user's most-used
     * category over the last 30 days (one fewer tap in the common case). The
     * user can always change it — it's a visible default, not a silent assign.
     */
    autoSelectDefault?: boolean;
}

const TX_PATH = { expense: "/expenses", income: "/incomes" } as const;

export function CategoryPicker({
    value, onChange, type, error,
    placeholder = "Select category",
    disabled = false,
    suggestedCategoryId,
    autoSelectDefault = false,
}: CategoryPickerProps) {
    const [cats, setCats]             = useState<Category[]>([]);
    const [open, setOpen]             = useState(false);
    const [loading, setLoading]       = useState(true);
    const [mode, setMode]             = useState<"list" | "create" | "edit">("list");
    const [editingCat, setEditingCat] = useState<Category | null>(null);
    const [query, setQuery]           = useState("");
    const [showArchived, setShowArchived] = useState(false);
    const [recentIds, setRecentIds]   = useState<string[]>([]);
    const [mostUsedId, setMostUsedId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [rowError, setRowError]     = useState<{ id: string; msg: string } | null>(null);
    const [rowBusy, setRowBusy]       = useState<string | null>(null);

    const rootRef        = useRef<HTMLDivElement>(null);
    const searchRef      = useRef<HTMLInputElement>(null);
    const autoSelectedRef = useRef(false);

    // ── Load categories (incl. archived; the picker gates visibility itself) ──
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        api.get(`/categories?type=${type}&includeArchived=true`)
            .then((res) => { if (!cancelled) setCats(res.data?.data || []); })
            .catch((err) => { if (!cancelled) console.error("CategoryPicker: load failed", err); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [type]);

    // ── Usage: recently-used order + most-used (last 30d) for the default ─────
    useEffect(() => {
        let cancelled = false;
        api.get(`${TX_PATH[type]}?limit=50`)
            .then((res) => {
                if (cancelled) return;
                const items: { category?: string; date?: string }[] = res.data?.data ?? [];
                const seen = new Set<string>();
                const recent: string[] = [];
                for (const it of items) {
                    if (it.category && !seen.has(it.category)) { seen.add(it.category); recent.push(it.category); }
                }
                setRecentIds(recent.slice(0, 5));

                const cutoff = Date.now() - 30 * 86_400_000;
                const counts: Record<string, number> = {};
                for (const it of items) {
                    if (it.category && it.date && new Date(it.date).getTime() >= cutoff) {
                        counts[it.category] = (counts[it.category] || 0) + 1;
                    }
                }
                let best: string | null = null, bestN = 0;
                for (const [id, n] of Object.entries(counts)) if (n > bestN) { best = id; bestN = n; }
                setMostUsedId(best);
            })
            .catch(() => { /* usage is a nicety; degrade silently */ });
        return () => { cancelled = true; };
    }, [type]);

    // ── Opt-in default pre-select (visible, user-overridable) ─────────────────
    useEffect(() => {
        if (!autoSelectDefault || autoSelectedRef.current) return;
        if (value || !mostUsedId) return;
        if (!cats.some((c) => c._id === mostUsedId && !c.isArchived)) return;
        autoSelectedRef.current = true;
        onChange(mostUsedId);
    }, [autoSelectDefault, value, mostUsedId, cats, onChange]);

    // ── Click-outside-to-close ────────────────────────────────────────────────
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) closeDropdown();
        };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, [open]);

    const closeDropdown = () => {
        setOpen(false);
        setMode("list");
        setQuery("");
        setDeletingId(null);
        setRowError(null);
    };

    const selected = value ? cats.find((c) => c._id === value) : null;

    // Visible rows (archived gate + text filter), preserving API sort order.
    const visible = useMemo(() => {
        const q = query.trim().toLowerCase();
        return cats.filter((c) =>
            (showArchived || !c.isArchived) &&
            (!q || c.name.toLowerCase().includes(q)),
        );
    }, [cats, showArchived, query]);

    const recentCats = useMemo(() => {
        if (query.trim()) return [];
        const byId = new Map(cats.map((c) => [c._id, c]));
        return recentIds
            .map((id) => byId.get(id))
            .filter((c): c is Category => !!c && !c.isArchived);
    }, [recentIds, cats, query]);

    const recentSet = useMemo(() => new Set(recentCats.map((c) => c._id)), [recentCats]);
    const restCats = visible.filter((c) => !recentSet.has(c._id));

    const select = (id: string) => { onChange(id); closeDropdown(); };

    const handleCreated = (cat: Category) => {
        setCats((prev) => [...prev, cat].sort((a, b) =>
            a.sortOrder !== b.sortOrder ? a.sortOrder - b.sortOrder : a.name.localeCompare(b.name)));
        onChange(cat._id);
        closeDropdown();
    };

    const handleEdited = (cat: Category) => {
        setCats((prev) => prev.map((c) => (c._id === cat._id ? cat : c)));
        setMode("list");
        setEditingCat(null);
    };

    const handleArchive = async (cat: Category) => {
        setRowBusy(cat._id); setRowError(null);
        try {
            await api.delete(`/categories/${cat._id}`); // no force = soft archive
            setCats((prev) => prev.map((c) => (c._id === cat._id ? { ...c, isArchived: true } : c)));
            if (value === cat._id) onChange("");
            setDeletingId(null);
        } catch (err) {
            const e = err as { response?: { data?: { message?: string } } };
            setRowError({ id: cat._id, msg: e.response?.data?.message || "Failed to archive" });
        } finally { setRowBusy(null); }
    };

    const handleForceDelete = async (cat: Category) => {
        setRowBusy(cat._id); setRowError(null);
        try {
            await api.delete(`/categories/${cat._id}?force=true`);
            setCats((prev) => prev.filter((c) => c._id !== cat._id));
            if (value === cat._id) onChange("");
            setDeletingId(null);
        } catch (err) {
            const e = err as { response?: { data?: { message?: string; refs?: { expenses?: number; incomes?: number } } } };
            const refs = e.response?.data?.refs;
            const detail = refs
                ? `${refs.expenses ?? 0} expense(s), ${refs.incomes ?? 0} income(s) use this — archive instead.`
                : (e.response?.data?.message || "Failed to delete");
            setRowError({ id: cat._id, msg: detail });
        } finally { setRowBusy(null); }
    };

    const handleUnarchive = async (cat: Category) => {
        setRowBusy(cat._id); setRowError(null);
        try {
            const res = await api.put(`/categories/${cat._id}`, { isArchived: false });
            const updated = res.data?.data as Category;
            setCats((prev) => prev.map((c) => (c._id === cat._id ? updated : c)));
        } catch (err) {
            const e = err as { response?: { data?: { message?: string } } };
            setRowError({ id: cat._id, msg: e.response?.data?.message || "Failed to un-archive" });
        } finally { setRowBusy(null); }
    };

    const TriggerIcon = selected ? iconFor(selected.icon) : ChevronDown;

    return (
        <div ref={rootRef} className="relative">
            <button
                type="button"
                onClick={() => { if (!disabled) { setOpen((o) => !o); setTimeout(() => searchRef.current?.focus(), 0); } }}
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
                        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: selected.color }} />
                        <TriggerIcon className="w-4 h-4 text-zinc-400 shrink-0" />
                        <span className="text-white font-medium truncate">{selected.name}</span>
                    </>
                ) : (
                    <span className="text-zinc-500 flex-1">{placeholder}</span>
                )}
                <ChevronDown className={cn("w-4 h-4 text-zinc-500 ml-auto transition-transform", open && "rotate-180")} />
            </button>

            {error && (
                <div className="mt-1.5 flex items-center gap-1.5 text-red-400 text-xs">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            {open && (
                <div className="absolute top-full left-0 mt-2 z-50 w-full min-w-[20rem] bg-zinc-900 border border-white/10 rounded-xl shadow-2xl shadow-black/50 max-h-[28rem] flex flex-col overflow-hidden">
                    {loading ? (
                        <div className="flex items-center justify-center py-8 text-zinc-500">
                            <Loader2 className="w-4 h-4 animate-spin" />
                        </div>
                    ) : mode === "create" ? (
                        <CategoryForm type={type} onCancel={() => setMode("list")} onSaved={handleCreated} />
                    ) : mode === "edit" && editingCat ? (
                        <CategoryForm type={type} initial={editingCat} onCancel={() => { setMode("list"); setEditingCat(null); }} onSaved={handleEdited} />
                    ) : (
                        <>
                            {/* Type-to-filter */}
                            <div className="p-2 border-b border-white/5 shrink-0">
                                <div className="flex items-center gap-2 bg-black/40 rounded-lg px-2.5 py-1.5">
                                    <Search className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                                    <input
                                        ref={searchRef}
                                        value={query}
                                        onChange={(e) => setQuery(e.target.value)}
                                        placeholder="Search categories"
                                        className="bg-transparent text-sm text-white placeholder:text-zinc-600 focus:outline-none w-full"
                                    />
                                </div>
                            </div>

                            <div className="overflow-y-auto flex-1 py-1">
                                {visible.length === 0 ? (
                                    <div className="px-4 py-3 text-sm text-zinc-500">
                                        {query.trim() ? "No matches." : `No ${type} categories yet — create one below.`}
                                    </div>
                                ) : (
                                    <>
                                        {recentCats.length > 0 && (
                                            <>
                                                <div className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-wider text-zinc-600">Recent</div>
                                                {recentCats.map((c) => (
                                                    <CategoryRow
                                                        key={`r-${c._id}`} cat={c} selected={c._id === value}
                                                        suggested={c._id === suggestedCategoryId}
                                                        deleting={deletingId === c._id} busy={rowBusy === c._id}
                                                        error={rowError?.id === c._id ? rowError.msg : null}
                                                        onSelect={() => select(c._id)}
                                                        onEdit={() => { setEditingCat(c); setMode("edit"); }}
                                                        onAskDelete={() => { setDeletingId(c._id); setRowError(null); }}
                                                        onCancelDelete={() => { setDeletingId(null); setRowError(null); }}
                                                        onArchive={() => handleArchive(c)} onForceDelete={() => handleForceDelete(c)}
                                                        onUnarchive={() => handleUnarchive(c)}
                                                    />
                                                ))}
                                                <div className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-wider text-zinc-600">All</div>
                                            </>
                                        )}
                                        {restCats.map((c) => (
                                            <CategoryRow
                                                key={c._id} cat={c} selected={c._id === value}
                                                suggested={c._id === suggestedCategoryId}
                                                deleting={deletingId === c._id} busy={rowBusy === c._id}
                                                error={rowError?.id === c._id ? rowError.msg : null}
                                                onSelect={() => select(c._id)}
                                                onEdit={() => { setEditingCat(c); setMode("edit"); }}
                                                onAskDelete={() => { setDeletingId(c._id); setRowError(null); }}
                                                onCancelDelete={() => { setDeletingId(null); setRowError(null); }}
                                                onArchive={() => handleArchive(c)} onForceDelete={() => handleForceDelete(c)}
                                                onUnarchive={() => handleUnarchive(c)}
                                            />
                                        ))}
                                    </>
                                )}
                            </div>

                            <div className="flex items-center justify-between border-t border-white/5 shrink-0">
                                <button
                                    type="button"
                                    onClick={() => setMode("create")}
                                    className="flex items-center gap-2 px-4 py-3 text-sm text-purple-400 hover:bg-purple-500/10 transition-colors"
                                >
                                    <Plus className="w-4 h-4" /> New category
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowArchived((s) => !s)}
                                    className="flex items-center gap-1.5 px-3 py-3 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                                >
                                    {showArchived ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                    {showArchived ? "Hide archived" : "Show archived"}
                                </button>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

// ── Category row (select + inline edit/archive/delete) ──────────────────────

interface CategoryRowProps {
    cat: Category;
    selected: boolean;
    suggested: boolean;
    deleting: boolean;
    busy: boolean;
    error: string | null;
    onSelect: () => void;
    onEdit: () => void;
    onAskDelete: () => void;
    onCancelDelete: () => void;
    onArchive: () => void;
    onForceDelete: () => void;
    onUnarchive: () => void;
}

function CategoryRow({
    cat, selected, suggested, deleting, busy, error,
    onSelect, onEdit, onAskDelete, onCancelDelete, onArchive, onForceDelete, onUnarchive,
}: CategoryRowProps) {
    const Icon = iconFor(cat.icon);

    if (deleting) {
        return (
            <div className="px-4 py-2.5 bg-white/5">
                <div className="text-xs text-zinc-300 mb-2">
                    {cat.isArchived ? `Delete "${cat.name}" permanently?` : `Remove "${cat.name}"?`}
                </div>
                {error && (
                    <div className="text-[11px] text-red-400 flex items-start gap-1.5 mb-2">
                        <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" /><span>{error}</span>
                    </div>
                )}
                <div className="flex gap-2">
                    {!cat.isArchived && (
                        <button type="button" onClick={onArchive} disabled={busy}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg bg-white/5 text-zinc-200 hover:bg-white/10 disabled:opacity-50">
                            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Archive className="w-3 h-3" />} Archive
                        </button>
                    )}
                    <button type="button" onClick={onForceDelete} disabled={busy}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-50">
                        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />} Delete
                    </button>
                    <button type="button" onClick={onCancelDelete} className="px-2.5 py-1.5 text-xs text-zinc-400 hover:text-zinc-200">
                        Cancel
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className={cn("group flex items-center pr-1", cat.isArchived && "opacity-60")}>
            <button
                type="button"
                onClick={onSelect}
                className={cn(
                    "flex-1 min-w-0 flex items-center gap-3 px-4 py-2.5 text-left transition-colors",
                    selected ? "bg-purple-500/10 text-purple-300" : "text-zinc-300 hover:bg-white/5",
                )}
            >
                <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                <Icon className="w-4 h-4 shrink-0" />
                <span className="font-medium truncate">{cat.name}</span>
                {suggested && (
                    <span className="flex items-center gap-1 text-[10px] text-amber-300/90 bg-amber-400/10 px-1.5 py-0.5 rounded-full shrink-0">
                        <Sparkles className="w-2.5 h-2.5" /> suggested
                    </span>
                )}
                {cat.isArchived && (
                    <span className="text-[10px] uppercase tracking-wider text-zinc-500 shrink-0">archived</span>
                )}
                {selected && <Check className="w-4 h-4 ml-auto text-purple-400 shrink-0" />}
            </button>

            <div className="flex items-center gap-0.5 pr-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                {cat.isArchived ? (
                    <button type="button" onClick={onUnarchive} disabled={busy} aria-label={`Un-archive ${cat.name}`}
                        className="p-1.5 rounded-lg text-zinc-500 hover:text-emerald-400 hover:bg-white/5">
                        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                ) : (
                    <button type="button" onClick={onEdit} aria-label={`Edit ${cat.name}`}
                        className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-white/5">
                        <Pencil className="w-3.5 h-3.5" />
                    </button>
                )}
                <button type="button" onClick={onAskDelete} aria-label={`Delete ${cat.name}`}
                    className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10">
                    <Trash2 className="w-3.5 h-3.5" />
                </button>
            </div>
        </div>
    );
}

// ── Create / Edit form (lives inside the popover; NOT a <form> to avoid nesting) ──

interface CategoryFormProps {
    type: "expense" | "income";
    initial?: Category;
    onCancel: () => void;
    onSaved: (cat: Category) => void;
}

function CategoryForm({ type, initial, onCancel, onSaved }: CategoryFormProps) {
    const isEdit = !!initial;
    const [name, setName]   = useState(initial?.name ?? "");
    const [color, setColor] = useState(initial?.color ?? CATEGORY_COLOR_SWATCHES[0]);
    const [icon, setIcon]   = useState<IconName>(initial?.icon ?? "more");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async () => {
        if (!name.trim()) return;
        setSubmitting(true); setError(null);
        try {
            const res = isEdit
                ? await api.put(`/categories/${initial._id}`, { name: name.trim(), color, icon })
                : await api.post(`/categories`, { name: name.trim(), type, color, icon });
            onSaved(res.data.data as Category);
        } catch (err) {
            const e = err as { response?: { data?: { message?: string; errors?: Record<string, string> } } };
            setError(e.response?.data?.message
                || (e.response?.data?.errors && Object.values(e.response.data.errors).join(", "))
                || (isEdit ? "Failed to update category" : "Failed to create category"));
        } finally { setSubmitting(false); }
    };

    return (
        <div className="p-4 space-y-3 overflow-y-auto">
            <div className="text-sm font-medium text-white">{isEdit ? `Edit "${initial.name}"` : "New category"}</div>
            <input
                autoFocus
                type="text"
                placeholder="Category name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); handleSubmit(); }
                    else if (e.key === "Escape") { e.preventDefault(); onCancel(); }
                }}
                maxLength={60}
                className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-purple-500/50"
            />

            <div>
                <div className="text-xs text-zinc-500 mb-1.5">Color</div>
                <div className="flex flex-wrap gap-1.5">
                    {CATEGORY_COLOR_SWATCHES.map((c) => (
                        <button key={c} type="button" onClick={() => setColor(c)} aria-label={`color ${c}`}
                            className={cn("w-6 h-6 rounded-full transition-all",
                                color === c ? "ring-2 ring-white ring-offset-2 ring-offset-zinc-900 scale-110" : "hover:scale-110")}
                            style={{ backgroundColor: c }} />
                    ))}
                </div>
            </div>

            <div>
                <div className="text-xs text-zinc-500 mb-1.5">Icon</div>
                <div className="grid grid-cols-7 gap-1.5">
                    {ICON_NAMES.map((n) => {
                        const I = CATEGORY_ICONS[n];
                        const sel = icon === n;
                        return (
                            <button key={n} type="button" onClick={() => setIcon(n)} aria-label={n}
                                className={cn("w-8 h-8 flex items-center justify-center rounded-lg transition-colors",
                                    sel ? "bg-purple-500/20 text-purple-300 ring-1 ring-purple-500/50"
                                        : "bg-black/40 text-zinc-400 hover:text-zinc-200 hover:bg-white/5")}>
                                <I className="w-4 h-4" />
                            </button>
                        );
                    })}
                </div>
            </div>

            {error && (
                <div className="text-red-400 text-xs flex items-center gap-1.5">
                    <AlertCircle className="w-3 h-3 shrink-0" /><span>{error}</span>
                </div>
            )}

            <div className="flex gap-2 pt-1">
                <button type="button" onClick={handleSubmit} disabled={submitting || !name.trim()}
                    className="flex-1 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-sm font-medium px-3 py-2 rounded-lg transition-colors flex items-center justify-center gap-1.5">
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : isEdit ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                    {isEdit ? "Save" : "Create"}
                </button>
                <button type="button" onClick={onCancel} className="px-3 py-2 text-sm text-zinc-400 hover:text-zinc-200 rounded-lg transition-colors">
                    Cancel
                </button>
            </div>
        </div>
    );
}
