"use client";

import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { api } from "@/lib/api";

interface GoalFormProps {
    onSuccess: () => void;
}

const GOAL_TYPES = ['Emergency Fund', 'Vacation', 'Car', 'House', 'Education', 'Investment', 'Other'];

export function GoalForm({ onSuccess }: GoalFormProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [formData, setFormData] = useState({
        title: "",
        targetAmount: "",
        targetDate: "",
        goalType: "Other"
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
                goalType: formData.goalType
            });

            setFormData({ title: "", targetAmount: "", targetDate: "", goalType: "Other" });
            onSuccess();
        } catch (err) {
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="p-6 rounded-3xl bg-zinc-900/50 border border-white/5 mb-8 backdrop-blur-sm">
            <div className="flex items-center gap-2 mb-4">
                <h3 className="text-white font-medium">Create New Goal</h3>
                <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-500 border border-yellow-500/20">Dream Big</span>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col md:flex-row gap-4 items-end">

                {/* Title Input */}
                <div className="w-full md:w-1/3 space-y-2">
                    <label className="text-xs text-zinc-500">Goal Name</label>
                    <input
                        type="text"
                        placeholder="e.g. New Macbook, Dream Vacation"
                        value={formData.title}
                        onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-yellow-500/50 transition-colors"
                        required
                    />
                </div>

                {/* Amount Input */}
                <div className="w-full md:w-1/4 space-y-2">
                    <label className="text-xs text-zinc-500">Target Amount</label>
                    <input
                        type="number"
                        placeholder="0.00"
                        value={formData.targetAmount}
                        onChange={(e) => setFormData({ ...formData, targetAmount: e.target.value })}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-yellow-500/50 transition-colors"
                        required
                    />
                </div>

                {/* Type Select */}
                <div className="w-full md:w-1/4 space-y-2">
                    <label className="text-xs text-zinc-500">Goal Type</label>
                    <select
                        value={formData.goalType}
                        onChange={(e) => setFormData({ ...formData, goalType: e.target.value })}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-zinc-300 focus:outline-none focus:border-yellow-500/50 transition-colors appearance-none cursor-pointer"
                    >
                        {GOAL_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                    </select>
                </div>

                {/* Date Input */}
                <div className="w-full md:w-1/4 space-y-2">
                    <label className="text-xs text-zinc-500">Target Date</label>
                    <input
                        type="date"
                        value={formData.targetDate}
                        onChange={(e) => setFormData({ ...formData, targetDate: e.target.value })}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-zinc-300 focus:outline-none focus:border-yellow-500/50 transition-colors cursor-pointer"
                        required
                    />
                </div>

                {/* Submit Button - GOLD Accent */}
                <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full md:w-auto px-6 py-3 bg-yellow-600 hover:bg-yellow-500 text-black font-semibold rounded-xl transition-all shadow-lg shadow-yellow-900/20 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                    {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                    <span>Create</span>
                </button>
            </form>
        </div>
    );
}
