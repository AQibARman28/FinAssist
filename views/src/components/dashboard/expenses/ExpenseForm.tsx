"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Plus, Loader2 } from "lucide-react";
import { api } from "@/lib/api";

const CATEGORIES = ["Food", "Transport", "Entertainment", "Shopping", "Bills", "Healthcare", "Education", "Other"];

interface ExpenseFormProps {
    onAdd: () => void;
}

export function ExpenseForm({ onAdd }: ExpenseFormProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [formData, setFormData] = useState({
        title: "", // Mapped to description in backend
        amount: "",
        category: "",
        date: new Date().toISOString().split('T')[0]
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.title || !formData.amount || !formData.category) return;

        setIsLoading(true);
        try {
            await api.post("/expenses", {
                description: formData.title,
                amount: parseFloat(formData.amount),
                category: formData.category,
                date: formData.date
            });

            setFormData({ ...formData, title: "", amount: "" });
            onAdd(); // Refresh list
        } catch (err) {
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="p-6 rounded-3xl bg-zinc-900/50 border border-white/5 mb-6">
            <h3 className="text-white font-medium mb-4">Add New Expense</h3>
            <form onSubmit={handleSubmit} className="flex flex-col md:flex-row gap-4 items-end">

                {/* Title Input */}
                <div className="w-full md:w-1/3 space-y-2">
                    <label className="text-xs text-zinc-500">What was it for?</label>
                    <input
                        type="text"
                        placeholder="e.g. Starbucks, Uber"
                        value={formData.title}
                        onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-purple-500/50 transition-colors"
                        required
                    />
                </div>

                {/* Amount Input */}
                <div className="w-full md:w-1/4 space-y-2">
                    <label className="text-xs text-zinc-500">Amount</label>
                    <input
                        type="number"
                        placeholder="0.00"
                        value={formData.amount}
                        onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 focus:outline-none focus:border-purple-500/50 transition-colors"
                        required
                    />
                </div>

                {/* Category Select */}
                <div className="w-full md:w-1/4 space-y-2">
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

                {/* Submit Button */}
                <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full md:w-auto px-6 py-3 bg-white text-black font-medium rounded-xl hover:bg-zinc-200 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                >
                    {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                    <span>Add</span>
                </button>
            </form>
        </div>
    );
}
