"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
    ChevronDown, Plus, Check, Loader2,
    Pencil, Trash2, Archive, Search, Eye, EyeOff,
} from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { useCategories } from "@/lib/useCategories";
import { cn } from "@/lib/utils";
import {
    CATEGORY_ICONS, CATEGORY_COLOR_SWATCHES, ICON_NAMES,
    type IconName,
} from "@/lib/categoryIcons";
import { CategoryIcon } from "@/components/CategoryIcon";
import { FieldError, FieldLabel } from "@/components/dashboard/ui";

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
    /** The trigger button's id, so a `<label htmlFor>` can point at it. */
    id?: string;
    /**
     * The id of a visible caption ("Category"). The trigger is then named by
     * that caption followed by its own text ("Category, Food").
     */
    labelledBy?: string;
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

// A category's own colour: a small square beside its name, nothing more
// (DESIGN.md › The Data Colour Rule).
function Swatch({ color }: { color?: string }) {
    return <span aria-hidden className="w-2.5 h-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: color }} />;
}

// The popover's footer and small row controls: platinum for the one action,
// quiet for the rest.
const footerAction = "inline-flex items-center gap-2 min-h-11 px-3 rounded-xl text-[13.5px] font-semibold text-plat hover:text-white hover:bg-white/[0.05] transition-colors focus-ring";

export function CategoryPicker({
    value, onChange, type, error,
    placeholder = "Select category",
    disabled = false,
    id,
    labelledBy,
    suggestedCategoryId,
    autoSelectDefault = false,
}: CategoryPickerProps) {
    const [open, setOpen]             = useState(false);
    const [mode, setMode]             = useState<"list" | "create" | "edit">("list");
    const [editingCat, setEditingCat] = useState<Category | null>(null);
    const [query, setQuery]           = useState("");
    const [showArchived, setShowArchived] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [rowError, setRowError]     = useState<{ id: string; msg: string } | null>(null);
    const [rowBusy, setRowBusy]       = useState<string | null>(null);

    const rootRef        = useRef<HTMLDivElement>(null);
    const searchRef      = useRef<HTMLInputElement>(null);
    const autoSelectedRef = useRef(false);
    const autoId = useId();
    const triggerId = id ?? `${autoId}-trigger`;
    const errorId = `${autoId}-error`;
    const searchId = `${autoId}-search`;

    // ── Load categories (incl. archived; the picker gates visibility itself) ──
    // From the list the rest of the app shares (lib/useCategories.ts).
    const categories = useCategories<Category>(type);
    const loading = categories.isLoading;
    // A create / edit / archive / delete shows at once from the server's reply;
    // the refetch that every write triggers (lib/api.ts) then replaces this.
    const [edited, setEdited] = useState<{ base: Category[]; items: Category[] } | null>(null);
    const cats = edited && edited.base === categories.all ? edited.items : categories.all;
    const setCats = (update: (prev: Category[]) => Category[]) => setEdited({ base: categories.all, items: update(cats) });

    // ── Usage: recently-used order + most-used (last 30d) for the default ─────
    // Usage is a nicety: if it fails to load, both simply stay empty.
    const usage = useApi<{ category?: string; date?: string }[]>(TX_PATH[type], { limit: 50 });
    const [openedAt] = useState(() => Date.now());
    const { recentIds, mostUsedId } = useMemo(() => {
        const items = usage.data ?? [];
        const seen = new Set<string>();
        const recent: string[] = [];
        for (const it of items) {
            if (it.category && !seen.has(it.category)) { seen.add(it.category); recent.push(it.category); }
        }

        const cutoff = openedAt - 30 * 86_400_000;
        const counts: Record<string, number> = {};
        for (const it of items) {
            if (it.category && it.date && new Date(it.date).getTime() >= cutoff) {
                counts[it.category] = (counts[it.category] || 0) + 1;
            }
        }
        let best: string | null = null, bestN = 0;
        for (const [id, n] of Object.entries(counts)) if (n > bestN) { best = id; bestN = n; }
        return { recentIds: recent.slice(0, 5), mostUsedId: best };
    }, [usage.data, openedAt]);

    // ── Opt-in default pre-select (visible, user-overridable) ─────────────────
    useEffect(() => {
        if (!autoSelectDefault || autoSelectedRef.current) return;
        if (value || !mostUsedId) return;
        if (!cats.some((c) => c._id === mostUsedId && !c.isArchived)) return;
        autoSelectedRef.current = true;
        onChange(mostUsedId);
    }, [autoSelectDefault, value, mostUsedId, cats, onChange]);

    // Only touches state setters, so it is stable across renders.
    const closeDropdown = useCallback(() => {
        setOpen(false);
        setMode("list");
        setQuery("");
        setDeletingId(null);
        setRowError(null);
    }, []);

    // ── Click-outside-to-close ────────────────────────────────────────────────
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) closeDropdown();
        };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, [open, closeDropdown]);

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

    const rowProps = (c: Category) => ({
        cat: c,
        selected: c._id === value,
        suggested: c._id === suggestedCategoryId,
        deleting: deletingId === c._id,
        busy: rowBusy === c._id,
        error: rowError?.id === c._id ? rowError.msg : null,
        onSelect: () => select(c._id),
        onEdit: () => { setEditingCat(c); setMode("edit"); },
        onAskDelete: () => { setDeletingId(c._id); setRowError(null); },
        onCancelDelete: () => { setDeletingId(null); setRowError(null); },
        onArchive: () => handleArchive(c),
        onForceDelete: () => handleForceDelete(c),
        onUnarchive: () => handleUnarchive(c),
    });

    return (
        <div ref={rootRef} className="relative">
            <button
                id={triggerId}
                type="button"
                onClick={() => { if (!disabled) { setOpen((o) => !o); setTimeout(() => searchRef.current?.focus(), 0); } }}
                disabled={disabled}
                aria-expanded={open}
                aria-labelledby={labelledBy ? `${labelledBy} ${triggerId}` : undefined}
                aria-describedby={error ? errorId : undefined}
                className={cn(
                    "field flex items-center gap-3 text-left",
                    // A button can't carry aria-invalid; the error line is tied to it instead.
                    error ? "border-red-400/60" : !disabled && "hover:border-white/20",
                    !disabled && "cursor-pointer",
                )}
            >
                {selected ? (
                    <>
                        <Swatch color={selected.color} />
                        <CategoryIcon icon={selected.icon} className="w-4 h-4 text-zinc-400 shrink-0" aria-hidden />
                        <span className="min-w-0 truncate text-white">{selected.name}</span>
                    </>
                ) : (
                    <span className="flex-1 min-w-0 truncate text-zinc-400">{placeholder}</span>
                )}
                <ChevronDown aria-hidden className={cn("w-4 h-4 shrink-0 ml-auto text-zinc-400 transition-transform", open && "rotate-180")} />
            </button>

            {error && <FieldError id={errorId}>{error}</FieldError>}

            {open && (
                <div className="absolute top-full left-0 mt-2 z-50 w-full min-w-[min(20rem,calc(100vw-2rem))] max-h-[28rem] flex flex-col overflow-hidden rounded-2xl bg-graphite-raised border border-white/10 shadow-[0_25px_50px_-12px_rgb(0_0_0/0.5)]">
                    {loading ? (
                        <div aria-hidden className="p-3 space-y-2">
                            {[0, 1, 2, 3].map((i) => <div key={i} className="h-11 rounded-xl bg-white/[0.05] animate-pulse" />)}
                        </div>
                    ) : mode === "create" ? (
                        <CategoryForm type={type} onCancel={() => setMode("list")} onSaved={handleCreated} />
                    ) : mode === "edit" && editingCat ? (
                        <CategoryForm type={type} initial={editingCat} onCancel={() => { setMode("list"); setEditingCat(null); }} onSaved={handleEdited} />
                    ) : (
                        <>
                            {/* Type-to-filter */}
                            <div className="p-2 shrink-0 border-b border-white/[0.07]">
                                <label htmlFor={searchId} className="sr-only">Search categories</label>
                                <div className="relative">
                                    <Search aria-hidden className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />
                                    <input
                                        id={searchId}
                                        ref={searchRef}
                                        value={query}
                                        onChange={(e) => setQuery(e.target.value)}
                                        placeholder="Search categories"
                                        className="field min-h-11 py-2 pl-10"
                                    />
                                </div>
                            </div>

                            <div className="overflow-y-auto flex-1 p-1.5">
                                {visible.length === 0 ? (
                                    <p className="px-3 py-3 text-[13.5px] text-zinc-400">
                                        {query.trim() ? "No matches." : `No ${type} categories yet — create one below.`}
                                    </p>
                                ) : (
                                    <>
                                        {recentCats.length > 0 && (
                                            <>
                                                <p className="px-3 pt-2 pb-1.5 label-caps text-zinc-400">Recent</p>
                                                {recentCats.map((c) => <CategoryRow key={`r-${c._id}`} {...rowProps(c)} />)}
                                                <p className="px-3 pt-3 pb-1.5 label-caps text-zinc-400">All</p>
                                            </>
                                        )}
                                        {restCats.map((c) => <CategoryRow key={c._id} {...rowProps(c)} />)}
                                    </>
                                )}
                            </div>

                            <div className="flex items-center justify-between gap-2 px-1.5 py-1 shrink-0 border-t border-white/[0.07]">
                                <button type="button" onClick={() => setMode("create")} className={footerAction}>
                                    <Plus className="w-4 h-4" aria-hidden /> New category
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowArchived((s) => !s)}
                                    aria-pressed={showArchived}
                                    className="btn-quiet text-[13px]"
                                >
                                    {showArchived ? <EyeOff className="w-4 h-4" aria-hidden /> : <Eye className="w-4 h-4" aria-hidden />}
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
    if (deleting) {
        return (
            <div className="my-1 p-3 rounded-xl bg-white/[0.05]">
                <p className="text-[13px] text-zinc-300">
                    {cat.isArchived ? `Delete "${cat.name}" permanently?` : `Remove "${cat.name}"?`}
                </p>
                {error && <FieldError>{error}</FieldError>}
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {!cat.isArchived && (
                        <button type="button" onClick={onArchive} disabled={busy} className="btn-secondary px-3 text-[13px]">
                            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <Archive className="w-3.5 h-3.5" aria-hidden />} Archive
                        </button>
                    )}
                    <button type="button" onClick={onForceDelete} disabled={busy} className="btn-danger px-3 text-[13px]">
                        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <Trash2 className="w-3.5 h-3.5" aria-hidden />} Delete
                    </button>
                    <button type="button" onClick={onCancelDelete} className="btn-quiet text-[13px]">
                        Cancel
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className={cn("group flex items-center gap-0.5 rounded-xl", cat.isArchived && "opacity-70")}>
            <button
                type="button"
                onClick={onSelect}
                aria-current={selected ? "true" : undefined}
                className={cn(
                    "flex-1 min-w-0 flex items-center gap-3 min-h-11 px-3 rounded-xl text-left text-[14px] transition-colors focus-ring",
                    selected ? "bg-white/[0.07] text-white" : "text-zinc-200 hover:bg-white/[0.05] hover:text-white",
                    suggested && !selected && "ring-1 ring-inset ring-plat/40",
                )}
            >
                <Swatch color={cat.color} />
                <CategoryIcon icon={cat.icon} className="w-4 h-4 shrink-0 text-zinc-400" aria-hidden />
                <span className="min-w-0 truncate font-medium">{cat.name}</span>
                {suggested && <span className="shrink-0 label-caps text-zinc-400">Suggested</span>}
                {cat.isArchived && <span className="shrink-0 label-caps text-zinc-400">Archived</span>}
                {selected && <Check className="w-4 h-4 ml-auto shrink-0 text-plat" aria-hidden />}
            </button>

            {/* Visible on hover and keyboard focus; always visible on touch screens. */}
            <div className="flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity">
                {cat.isArchived ? (
                    <button type="button" onClick={onUnarchive} disabled={busy} aria-label={`Un-archive ${cat.name}`} className="btn-icon">
                        {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Eye className="w-4 h-4" aria-hidden />}
                    </button>
                ) : (
                    <button type="button" onClick={onEdit} aria-label={`Edit ${cat.name}`} className="btn-icon">
                        <Pencil className="w-4 h-4" aria-hidden />
                    </button>
                )}
                <button type="button" onClick={onAskDelete} aria-label={`Delete ${cat.name}`} className="btn-icon hover:text-red-300 hover:bg-red-500/10">
                    <Trash2 className="w-4 h-4" aria-hidden />
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
    const nameId = useId();
    const errorId = useId();

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
        <div className="p-4 space-y-4 overflow-y-auto">
            <p className="font-semibold text-white">{isEdit ? `Edit "${initial.name}"` : "New category"}</p>

            <div>
                <FieldLabel htmlFor={nameId}>Name</FieldLabel>
                <input
                    id={nameId}
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
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? errorId : undefined}
                    className="field min-h-11 py-2.5"
                />
            </div>

            <fieldset>
                <legend className="mb-1.5 text-[13px] font-medium text-zinc-300">Color</legend>
                {/* The colour is the user's own label for the category, so the
                    palette keeps its hues. Each dot sits in a 44px target. */}
                <div className="-mx-1.5 flex flex-wrap">
                    {CATEGORY_COLOR_SWATCHES.map((c) => (
                        <button key={c} type="button" onClick={() => setColor(c)} aria-label={`color ${c}`} aria-pressed={color === c}
                            className="grid place-items-center w-11 h-11 rounded-full focus-ring">
                            <span aria-hidden
                                className={cn("w-6 h-6 rounded-full transition-transform",
                                    color === c ? "ring-2 ring-plat ring-offset-2 ring-offset-graphite-raised" : "hover:scale-110")}
                                style={{ backgroundColor: c }} />
                        </button>
                    ))}
                </div>
            </fieldset>

            <fieldset>
                <legend className="mb-1.5 text-[13px] font-medium text-zinc-300">Icon</legend>
                <div className="grid grid-cols-6 gap-1">
                    {ICON_NAMES.map((n) => {
                        const I = CATEGORY_ICONS[n];
                        const sel = icon === n;
                        return (
                            <button key={n} type="button" onClick={() => setIcon(n)} aria-label={n} aria-pressed={sel}
                                className={cn("h-11 grid place-items-center rounded-xl transition-colors focus-ring",
                                    sel ? "bg-plat text-plat-ink" : "bg-black/30 text-zinc-400 hover:text-white hover:bg-white/[0.07]")}>
                                <I className="w-4 h-4" aria-hidden />
                            </button>
                        );
                    })}
                </div>
            </fieldset>

            {error && <FieldError id={errorId}>{error}</FieldError>}

            <div className="flex gap-2">
                <button type="button" onClick={handleSubmit} disabled={submitting || !name.trim()} className="btn-primary flex-1">
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : isEdit ? <Check className="w-4 h-4" aria-hidden /> : <Plus className="w-4 h-4" aria-hidden />}
                    {isEdit ? "Save" : "Create"}
                </button>
                <button type="button" onClick={onCancel} className="btn-quiet">
                    Cancel
                </button>
            </div>
        </div>
    );
}
