"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Activity, AlertTriangle, CheckCircle } from "lucide-react";
import { api } from "@/lib/api";

export function FinancialHealthScore() {
    const [score, setScore] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchScore = async () => {
            try {
                const res = await api.get("/ai/financial-health-score");
                setScore(res.data.data.financialHealthScore);
            } catch (err) {
                console.error("Failed to fetch health score", err);
            } finally {
                setLoading(false);
            }
        };
        fetchScore();
    }, []);

    const getColor = (score: number) => {
        if (score >= 80) return "text-green-500";
        if (score >= 50) return "text-yellow-500";
        return "text-red-500";
    };

    const getMessage = (score: number) => {
        if (score >= 80) return "Excellent! You're in great financial shape.";
        if (score >= 50) return "Good, but there's room for improvement.";
        return "Attention needed. Review your spending habits.";
    };

    if (loading) return <div className="h-48 animate-pulse bg-zinc-900/50 rounded-3xl" />;

    return (
        <div className="p-6 rounded-3xl bg-zinc-900/50 border border-white/5 relative overflow-hidden">
            <div className="flex justify-between items-start mb-4">
                <div>
                    <h3 className="text-lg font-semibold text-white">Financial Health</h3>
                    <p className="text-xs text-zinc-500">AI-calculated wellness score</p>
                </div>
                <Activity className="w-5 h-5 text-purple-400" />
            </div>

            <div className="flex flex-col items-center justify-center py-4">
                <div className="relative">
                    {/* Background Circle */}
                    <svg className="w-32 h-32 transform -rotate-90">
                        <circle
                            cx="64"
                            cy="64"
                            r="56"
                            stroke="currentColor"
                            strokeWidth="12"
                            fill="transparent"
                            className="text-zinc-800"
                        />
                        {/* Progress Circle */}
                        <motion.circle
                            initial={{ strokeDasharray: "352 352", strokeDashoffset: 352 }}
                            animate={{ strokeDashoffset: 352 - (352 * (score || 0)) / 100 }}
                            transition={{ duration: 1.5, ease: "easeOut" }}
                            cx="64"
                            cy="64"
                            r="56"
                            stroke="currentColor"
                            strokeWidth="12"
                            fill="transparent"
                            className={getColor(score || 0)}
                            strokeLinecap="round"
                        />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                        <span className={`text-3xl font-bold ${getColor(score || 0)}`}>{score}</span>
                    </div>
                </div>

                <p className="mt-4 text-center text-sm text-zinc-400">
                    {getMessage(score || 0)}
                </p>
            </div>
        </div>
    );
}
