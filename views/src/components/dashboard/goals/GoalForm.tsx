"use client";

import { useState } from "react";
import { Loader2, Plus, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export type GoalPeriod = "monthly" | "yearly";

interface GoalFormProps {
    period: GoalPeriod;
    onSuccess: () => void;
}

// Free-form starting points — just prefill the name (everything editable).
const SEEDS = ["Emergency Fund", "DPS", "Hajj / Umrah", "Wedding", "New phone", "Land / Flat", "Child's education"];

export function GoalForm({ period, onSuccess }: GoalFormProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [formData, setFormData] = useState({ title: "", targetAmount: "", note: "" });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.title.trim() || !formData.targetAmount) return;

        setIsLoading(true);
        setError(null);
        try {
            await api.post("/goals", {
                title: formData.title.trim(),
                targetAmount: parseFloat(formData.targetAmount),
                period,
                note: formData.note || undefined,
            });
            setFormData({ title: "", targetAmount: "", note: "" });
            onSuccess();
        } catch (err) {
            const e = err as { response?: { data?: { message?: string } } };
            setError(e.response?.data?.message || "Failed to create goal");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="p-6 rounded-3xl bg-zinc-900/50 border border-white/5 backdrop-blur-sm">
            <div className="flex items-center gap-2 mb-4">
                <h3 className="text-white font-medium">New {period} goal</h3>
                <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-500 border border-yellow-500/20">Name it anything</span>
            </div>

            {/* Name suggestions */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
                <span className="flex items-center gap-1 text-xs text-zinc-500"><Sparkles className="w-3 h-3" /> Quick start:</span>
                {SEEDS.map((s) => (
                    <button
                        key={s}
                        type="button"
                        onClick={() => setFormData((f) => ({ ...f, title: s }))}
                        className="text-xs px-2.5 py-1 rounded-full bg-black/40 border border-white/10 text-zinc-400 hover:text-yellow-400 hover:border-yellow-500/30 transition-colors"
                    >
                        {s}
                    </button>
                ))}
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="flex flex-col md:flex-row gap-4 md:items-end">
                    <div className="w-full md:flex-1 space-y-2">
                        <label className="text-xs text-zinc-500">Goal name</label>
                        <input
                            type="text"
                            placeholder="e.g. Hajj fund, Down payment, New laptop"
                            value={formData.title}
                            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-yellow-500/50 transition-colors"
                            required
                        />
                    </div>

                    <div className="w-full md:w-40 space-y-2">
                        <label className="text-xs text-zinc-500">Target amount</label>
                        <input
                            type="number"
                            min={1}
                            step="any"
                            placeholder="0.00"
                            value={formData.targetAmount}
                            onChange={(e) => setFormData({ ...formData, targetAmount: e.target.value })}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-yellow-500/50 transition-colors"
                            required
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={isLoading}
                        className={cn("w-full md:w-auto px-6 py-3 bg-yellow-600 hover:bg-yellow-500 text-black font-semibold rounded-xl transition-all shadow-lg shadow-yellow-900/20 flex items-center justify-center gap-2 disabled:opacity-50")}
                    >
                        {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                        <span>Create</span>
                    </button>
                </div>

                <div className="space-y-2">
                    <label className="text-xs text-zinc-500">Private note (optional)</label>
                    <textarea
                        placeholder="Visible only to you"
                        value={formData.note}
                        onChange={(e) => setFormData({ ...formData, note: e.target.value })}
                        rows={2}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-yellow-500/50 transition-colors resize-y"
                    />
                </div>

                {error && <p className="text-xs text-red-400">{error}</p>}
            </form>
        </div>
    );
}
