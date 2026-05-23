"use client";

import { useState } from "react";
import { Loader2, Plus, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface GoalFormProps {
    onSuccess: () => void;
}

const GOAL_TYPES = ["Emergency Fund", "Vacation", "Car", "House", "Education", "Investment", "Other"];

// Audience-relevant starting points — prefill title + a compatible goalType
// (all editable). Mapped onto the fixed type enum.
const SEEDS: { label: string; goalType: string }[] = [
    { label: "Emergency Fund",     goalType: "Emergency Fund" },
    { label: "DPS",                goalType: "Investment" },
    { label: "Hajj / Umrah",       goalType: "Other" },
    { label: "Wedding",            goalType: "Other" },
    { label: "Family support",     goalType: "Other" },
    { label: "Land / Flat",        goalType: "House" },
    { label: "Child's education",  goalType: "Education" },
];

const PRIORITIES = [{ label: "Low", value: 0 }, { label: "Medium", value: 1 }, { label: "High", value: 2 }];

export function GoalForm({ onSuccess }: GoalFormProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [formData, setFormData] = useState({
        title: "",
        targetAmount: "",
        targetDate: "",
        goalType: "Other",
        priority: 0,
        note: "",
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.title || !formData.targetAmount || !formData.targetDate) return;

        setIsLoading(true);
        try {
            await api.post("/goals", {
                title: formData.title,
                targetAmount: parseFloat(formData.targetAmount),
                targetDate: formData.targetDate,
                goalType: formData.goalType,
                priority: formData.priority,
                note: formData.note,
            });
            setFormData({ title: "", targetAmount: "", targetDate: "", goalType: "Other", priority: 0, note: "" });
            onSuccess();
        } catch (err) {
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="p-6 rounded-3xl bg-zinc-900/50 border border-white/5 backdrop-blur-sm">
            <div className="flex items-center gap-2 mb-4">
                <h3 className="text-white font-medium">Create New Goal</h3>
                <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-500 border border-yellow-500/20">Dream Big</span>
            </div>

            {/* Audience seed templates */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
                <span className="flex items-center gap-1 text-xs text-zinc-500"><Sparkles className="w-3 h-3" /> Quick start:</span>
                {SEEDS.map((s) => (
                    <button
                        key={s.label}
                        type="button"
                        onClick={() => setFormData((f) => ({ ...f, title: s.label, goalType: s.goalType }))}
                        className="text-xs px-2.5 py-1 rounded-full bg-black/40 border border-white/10 text-zinc-400 hover:text-yellow-400 hover:border-yellow-500/30 transition-colors"
                    >
                        {s.label}
                    </button>
                ))}
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="flex flex-col md:flex-row gap-4 md:items-end">
                    <div className="w-full md:flex-1 space-y-2">
                        <label className="text-xs text-zinc-500">Goal Name</label>
                        <input
                            type="text"
                            placeholder="e.g. Hajj fund, Down payment"
                            value={formData.title}
                            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-yellow-500/50 transition-colors"
                            required
                        />
                    </div>

                    <div className="w-full md:w-32 space-y-2">
                        <label className="text-xs text-zinc-500">Target</label>
                        <input
                            type="number"
                            placeholder="0.00"
                            value={formData.targetAmount}
                            onChange={(e) => setFormData({ ...formData, targetAmount: e.target.value })}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-yellow-500/50 transition-colors"
                            required
                        />
                    </div>

                    <div className="w-full md:w-40 space-y-2">
                        <label className="text-xs text-zinc-500">Type</label>
                        <select
                            value={formData.goalType}
                            onChange={(e) => setFormData({ ...formData, goalType: e.target.value })}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-zinc-300 focus:outline-none focus:border-yellow-500/50 transition-colors appearance-none cursor-pointer"
                        >
                            {GOAL_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                        </select>
                    </div>

                    <div className="w-full md:w-32 space-y-2">
                        <label className="text-xs text-zinc-500">Priority</label>
                        <select
                            value={formData.priority}
                            onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value, 10) })}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-zinc-300 focus:outline-none focus:border-yellow-500/50 transition-colors appearance-none cursor-pointer"
                        >
                            {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                        </select>
                    </div>

                    <div className="w-full md:w-40 space-y-2">
                        <label className="text-xs text-zinc-500">Target Date</label>
                        <input
                            type="date"
                            value={formData.targetDate}
                            onChange={(e) => setFormData({ ...formData, targetDate: e.target.value })}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-zinc-300 focus:outline-none focus:border-yellow-500/50 transition-colors cursor-pointer tabular-nums"
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
            </form>
        </div>
    );
}
