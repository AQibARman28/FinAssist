"use client";

import { useEffect, useState } from "react";
import {
    Plus, Pencil, Archive, Trash2, AlertCircle, Loader2,
    MoreVertical, Eye, EyeOff, X, Check,
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

type ColumnType = "expense" | "income";

export default function CategoriesPage() {
    const [cats, setCats]           = useState<Category[]>([]);
    const [loading, setLoading]     = useState(true);
    const [showArchived, setShowArchived] = useState(false);
    const [editing, setEditing]     = useState<Category | null>(null);
    const [creatingType, setCreatingType] = useState<ColumnType | null>(null);
    const [mobileTab, setMobileTab] = useState<ColumnType>("expense");

    const load = async () => {
        setLoading(true);
        try {
            const params = showArchived ? "?includeArchived=true" : "";
            const res = await api.get(`/categories${params}`);
            setCats(res.data.data || []);
        } catch (err) {
            console.error("load categories", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); /* eslint-disable-next-line */ }, [showArchived]);

    const expenseCats = cats.filter((c) => c.type === "expense" || c.type === "both");
    const incomeCats  = cats.filter((c) => c.type === "income"  || c.type === "both");

    return (
        <div className="p-6 max-w-6xl mx-auto space-y-6">
            <div className="flex items-end justify-between mb-8 flex-wrap gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-white">Categories</h1>
                    <p className="text-zinc-500 text-sm">Organize how you tag your expenses and income.</p>
                </div>
                <button
                    onClick={() => setShowArchived((s) => !s)}
                    className="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors"
                >
                    {showArchived ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    {showArchived ? "Hide archived" : "Show archived"}
                </button>
            </div>

            {/* Mobile tabs */}
            <div className="md:hidden flex gap-2 mb-4">
                {(["expense", "income"] as ColumnType[]).map((t) => (
                    <button
                        key={t}
                        onClick={() => setMobileTab(t)}
                        className={cn(
                            "flex-1 px-4 py-2 rounded-xl text-sm font-medium transition-colors capitalize",
                            mobileTab === t
                                ? "bg-purple-500/10 text-purple-400 border border-purple-500/30"
                                : "bg-zinc-900/50 text-zinc-400 border border-white/5",
                        )}
                    >
                        {t}
                    </button>
                ))}
            </div>

            {/* Columns (or one-at-a-time on mobile) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className={cn(mobileTab === "expense" ? "block" : "hidden", "md:block")}>
                    <Column
                        title="Expense"
                        type="expense"
                        cats={expenseCats}
                        loading={loading}
                        onAdd={() => setCreatingType("expense")}
                        onEdit={setEditing}
                        onMutated={load}
                    />
                </div>
                <div className={cn(mobileTab === "income" ? "block" : "hidden", "md:block")}>
                    <Column
                        title="Income"
                        type="income"
                        cats={incomeCats}
                        loading={loading}
                        onAdd={() => setCreatingType("income")}
                        onEdit={setEditing}
                        onMutated={load}
                    />
                </div>
            </div>

            {(creatingType || editing) && (
                <CategoryModal
                    initialType={editing?.type === "income" || editing?.type === "both" ? "income" : (editing?.type ?? creatingType ?? "expense")}
                    editing={editing}
                    onClose={() => { setCreatingType(null); setEditing(null); }}
                    onDone={() => { setCreatingType(null); setEditing(null); load(); }}
                />
            )}
        </div>
    );
}

// ── Column ─────────────────────────────────────────────────────────────────

interface ColumnProps {
    title: string;
    type: ColumnType;
    cats: Category[];
    loading: boolean;
    onAdd: () => void;
    onEdit: (c: Category) => void;
    onMutated: () => void;
}

function Column({ title, cats, loading, onAdd, onEdit, onMutated }: ColumnProps) {
    return (
        <div className="p-6 rounded-3xl bg-zinc-900/50 border border-white/5">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-white">{title}</h2>
                <button
                    onClick={onAdd}
                    className="flex items-center gap-1.5 text-sm text-purple-400 hover:text-purple-300 hover:bg-purple-500/10 px-3 py-1.5 rounded-lg transition-colors"
                >
                    <Plus className="w-4 h-4" />
                    Add category
                </button>
            </div>

            {loading ? (
                <div className="flex justify-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
                </div>
            ) : cats.length === 0 ? (
                <div className="text-sm text-zinc-500 text-center py-8">
                    No {title.toLowerCase()} categories yet.
                </div>
            ) : (
                <div className="space-y-1">
                    {cats.map((c) => (
                        <CategoryRow key={c._id} cat={c} onEdit={() => onEdit(c)} onMutated={onMutated} />
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Row + actions menu ─────────────────────────────────────────────────────

function CategoryRow({ cat, onEdit, onMutated }: { cat: Category; onEdit: () => void; onMutated: () => void; }) {
    const [menuOpen, setMenuOpen] = useState(false);
    const [busy, setBusy]         = useState(false);
    const [error, setError]       = useState<string | null>(null);
    const Icon = iconFor(cat.icon);

    const close = () => { setMenuOpen(false); setError(null); };

    const handleArchive = async () => {
        setBusy(true); setError(null);
        try {
            await api.delete(`/categories/${cat._id}`);
            close(); onMutated();
        } catch (err: any) {
            setError(err.response?.data?.message || "Failed to archive");
        } finally { setBusy(false); }
    };

    const handleForceDelete = async () => {
        if (!confirm(`Delete "${cat.name}" permanently? This can only succeed if no records reference it.`)) return;
        setBusy(true); setError(null);
        try {
            await api.delete(`/categories/${cat._id}?force=true`);
            close(); onMutated();
        } catch (err: any) {
            const refs = err.response?.data?.refs;
            const detail = refs ? ` (${refs.expenses ?? 0} expense(s), ${refs.incomes ?? 0} income(s) still reference this)` : "";
            setError((err.response?.data?.message || "Failed to delete") + detail);
        } finally { setBusy(false); }
    };

    return (
        <div className={cn(
            "group flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 transition-colors relative",
            cat.isArchived && "opacity-50",
        )}>
            <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
            <Icon className="w-4 h-4 text-zinc-400 shrink-0" />
            <span className="text-zinc-200 font-medium flex-1 truncate">{cat.name}</span>
            {cat.isArchived && (
                <span className="text-[10px] uppercase tracking-wider text-zinc-500 bg-white/5 px-2 py-0.5 rounded-full">archived</span>
            )}

            <div className="relative">
                <button
                    onClick={() => setMenuOpen((o) => !o)}
                    className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-white/5 transition-colors"
                >
                    <MoreVertical className="w-4 h-4" />
                </button>

                {menuOpen && (
                    <>
                        <div className="fixed inset-0 z-40" onClick={close} />
                        <div className="absolute right-0 top-full mt-1 z-50 w-44 bg-zinc-900 border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden py-1">
                            <button
                                onClick={() => { onEdit(); close(); }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-300 hover:bg-white/5"
                            >
                                <Pencil className="w-4 h-4" /> Edit
                            </button>
                            {!cat.isArchived ? (
                                <button
                                    onClick={handleArchive}
                                    disabled={busy}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-300 hover:bg-white/5 disabled:opacity-50"
                                >
                                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
                                    Archive
                                </button>
                            ) : (
                                <button
                                    onClick={handleForceDelete}
                                    disabled={busy}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                                >
                                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                                    Delete
                                </button>
                            )}
                            {error && (
                                <div className="px-3 py-2 border-t border-white/5 text-[11px] text-red-400 flex items-start gap-1.5">
                                    <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                                    <span>{error}</span>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

// ── Create / Edit modal ────────────────────────────────────────────────────

interface CategoryModalProps {
    initialType: ColumnType;
    editing: Category | null;
    onClose: () => void;
    onDone: () => void;
}

function CategoryModal({ initialType, editing, onClose, onDone }: CategoryModalProps) {
    const isEdit = !!editing;
    const [name, setName]     = useState(editing?.name ?? "");
    const [type, setType]     = useState<"expense" | "income" | "both">(editing?.type ?? initialType);
    const [color, setColor]   = useState(editing?.color ?? CATEGORY_COLOR_SWATCHES[0]);
    const [icon, setIcon]     = useState<IconName>(editing?.icon ?? "more");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError]   = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;
        setSubmitting(true); setError(null);
        try {
            if (isEdit) {
                // type is immutable on update — don't send it.
                await api.put(`/categories/${editing!._id}`, {
                    name: name.trim(), color, icon,
                });
            } else {
                await api.post(`/categories`, { name: name.trim(), type, color, icon });
            }
            onDone();
        } catch (err: any) {
            const msg = err.response?.data?.message
                || (err.response?.data?.errors && Object.values(err.response.data.errors).join(", "))
                || (isEdit ? "Failed to update category" : "Failed to create category");
            setError(msg);
        } finally { setSubmitting(false); }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
            <div className="relative bg-zinc-900 border border-white/10 rounded-3xl shadow-2xl shadow-black/50 w-full max-w-md">
                <div className="flex items-center justify-between p-5 border-b border-white/5">
                    <h2 className="text-lg font-semibold text-white">
                        {isEdit ? "Edit category" : "New category"}
                    </h2>
                    <button onClick={onClose} className="p-1 text-zinc-500 hover:text-zinc-200 rounded-lg transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-5 space-y-4">
                    <div className="space-y-1.5">
                        <label className="text-xs text-zinc-500">Name</label>
                        <input
                            autoFocus
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            maxLength={60}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-purple-500/50 transition-colors"
                            placeholder="e.g. Coffee"
                        />
                    </div>

                    {!isEdit ? (
                        <div className="space-y-1.5">
                            <label className="text-xs text-zinc-500">Type</label>
                            <div className="grid grid-cols-3 gap-2">
                                {(["expense", "income", "both"] as const).map((t) => (
                                    <button
                                        key={t}
                                        type="button"
                                        onClick={() => setType(t)}
                                        className={cn(
                                            "px-3 py-2.5 rounded-xl text-sm font-medium capitalize transition-colors",
                                            type === t
                                                ? "bg-purple-500/10 text-purple-400 border border-purple-500/30"
                                                : "bg-black/40 text-zinc-400 border border-white/10 hover:border-purple-500/20",
                                        )}
                                    >
                                        {t}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="text-xs text-zinc-500">
                            Type: <span className="text-zinc-300 capitalize">{type}</span> <span className="text-zinc-600">(immutable)</span>
                        </div>
                    )}

                    <div className="space-y-1.5">
                        <label className="text-xs text-zinc-500">Color</label>
                        <div className="flex flex-wrap gap-2">
                            {CATEGORY_COLOR_SWATCHES.map((c) => (
                                <button
                                    key={c}
                                    type="button"
                                    onClick={() => setColor(c)}
                                    aria-label={`color ${c}`}
                                    className={cn(
                                        "w-7 h-7 rounded-full transition-all",
                                        color === c ? "ring-2 ring-white ring-offset-2 ring-offset-zinc-900 scale-110" : "hover:scale-110",
                                    )}
                                    style={{ backgroundColor: c }}
                                />
                            ))}
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-xs text-zinc-500">Icon</label>
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
                                            "w-9 h-9 flex items-center justify-center rounded-lg transition-colors",
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
                        <div className="text-red-400 text-sm flex items-start gap-1.5">
                            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}

                    <div className="flex gap-2 pt-2">
                        <button
                            type="submit"
                            disabled={submitting || !name.trim()}
                            className="flex-1 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 disabled:opacity-50 text-white font-medium px-4 py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
                        >
                            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                            {isEdit ? "Save changes" : "Create"}
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-3 text-zinc-400 hover:text-zinc-200 rounded-xl transition-colors"
                        >
                            Cancel
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
