"use client";

import { useState } from "react";
import { Loader2, Save } from "lucide-react";
import { api } from "@/lib/api";
import { useCurrency } from "@/lib/useCurrency";

const CATEGORIES = ["Food", "Transport", "Entertainment", "Shopping", "Bills", "Healthcare", "Education", "Other"];

interface BudgetFormProps {
    onSuccess: () => void;
}

export function BudgetForm({ onSuccess }: BudgetFormProps) {
    const { currency } = useCurrency();
    const [isLoading, setIsLoading] = useState(false);
    const [formData, setFormData] = useState({
        category: "",
        limit: ""
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.category || !formData.limit) return;

        setIsLoading(true);
        try {
            const now = new Date();
            await api.post("/budgets", {
                category: formData.category,
                limit: parseFloat(formData.limit),
                month: now.getMonth() + 1,
                year: now.getFullYear()
            });

            setFormData({ category: "", limit: "" });
            onSuccess();
        } catch (err) {
            console.error(err);
            alert("Failed to set budget. It might already exist—try editing instead.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="p-6 rounded-3xl bg-zinc-900/50 border border-white/5 mb-8">
            <div className="flex items-center gap-2 mb-4">
                <h3 className="text-white font-medium">Set Monthly Budget</h3>
                <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">Planning</span>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col md:flex-row gap-4 items-end">

                {/* Category Select */}
                <div className="w-full md:w-1/3 space-y-2">
                    <label className="text-xs text-zinc-500">Category</label>
                    <select
                        value={formData.category}
                        onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-zinc-300 focus:outline-none focus:border-purple-500/50 transition-colors appearance-none cursor-pointer"
                        required
                    >
                        <option value="" disabled>Select Category</option>
                        {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                    </select>
                </div>

                {/* Limit Input */}
                <div className="w-full md:w-1/3 space-y-2">
                    <label className="text-xs text-zinc-500">Monthly Limit ({currency})</label>
                    <input
                        type="number"
                        placeholder="e.g. 500"
                        value={formData.limit}
                        onChange={(e) => setFormData({ ...formData, limit: e.target.value })}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-purple-500/50 transition-colors"
                        required
                    />
                </div>

                {/* Submit Button */}
                <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full md:w-auto px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-xl transition-all shadow-lg shadow-purple-900/20 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                    {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-4 h-4" />}
                    <span>Set Limit</span>
                </button>
            </form>
        </div>
    );
}
