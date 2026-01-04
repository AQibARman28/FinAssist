"use client";

import { useEffect, useState } from "react";
import { GoalForm } from "@/components/dashboard/goals/GoalForm";
import { GoalCard } from "@/components/dashboard/goals/GoalCard";
import { StatCard } from "@/components/dashboard/StatCard";
import { Trophy, Target, TrendingUp } from "lucide-react";
import { api } from "@/lib/api";

interface Goal {
    _id: string;
    title: string;
    currentAmount: number;
    targetAmount: number;
    targetDate: string;
    daysRemaining: number;
    progressPercentage: number;
}

export default function GoalsPage() {
    const [goals, setGoals] = useState<Goal[]>([]);
    const [refreshTrigger, setRefreshTrigger] = useState(0);

    useEffect(() => {
        const fetchGoals = async () => {
            try {
                // Fetch standard list
                const res = await api.get("/goals");
                const rawGoals = res.data.data;

                // Calculate basic derived data
                const processedGoals = rawGoals.map((g: any) => ({
                    ...g,
                    daysRemaining: Math.ceil((new Date(g.targetDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)),
                    progressPercentage: g.targetAmount > 0 ? (g.currentAmount / g.targetAmount) * 100 : 0
                }));

                setGoals(processedGoals);
            } catch (err) {
                console.error(err);
            }
        };

        fetchGoals();
    }, [refreshTrigger]);

    const handleRefresh = () => {
        setRefreshTrigger(prev => prev + 1);
    };

    const totalSaved = goals.reduce((acc, curr) => acc + curr.currentAmount, 0);
    const totalTarget = goals.reduce((acc, curr) => acc + curr.targetAmount, 0);

    return (
        <div className="p-6 space-y-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-white">Savings Goals</h1>
                <p className="text-zinc-500 text-sm">Visualize your dreams and make them happen.</p>
            </div>

            {/* Stats - GOLD Theme for Goals */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <StatCard
                    title="Total Saved"
                    value={`$${totalSaved.toLocaleString()}`}
                    trend="All Goals"
                    trendUp={true}
                    icon={Trophy}
                    className="bg-gradient-to-br from-yellow-900/20 to-zinc-900/50 border-yellow-500/20"
                />
                <StatCard
                    title="Total Target"
                    value={`$${totalTarget.toLocaleString()}`}
                    icon={Target}
                    className="bg-zinc-900/50"
                />
                <div className="p-6 rounded-3xl bg-zinc-900/50 border border-white/5 flex flex-col justify-center">
                    <div className="flex items-center gap-3 text-zinc-400 mb-2">
                        <TrendingUp className="w-5 h-5 text-yellow-500" />
                        <span className="text-sm font-medium">Overall Progress</span>
                    </div>
                    <div className="text-3xl font-bold text-white">
                        {totalTarget > 0 ? ((totalSaved / totalTarget) * 100).toFixed(1) : 0}%
                    </div>
                </div>
            </div>

            {/* Create Goal Form */}
            <GoalForm onSuccess={handleRefresh} />

            {/* Goals Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {goals.map((goal) => (
                    <GoalCard
                        key={goal._id}
                        {...goal}
                        onUpdate={handleRefresh}
                    />
                ))}

                {goals.length === 0 && (
                    <div className="col-span-full py-20 text-center border border-dashed border-white/10 rounded-3xl bg-white/5">
                        <Target className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
                        <p className="text-zinc-500">No active goals.</p>
                        <p className="text-zinc-600 text-sm mt-1">Create one above to start saving.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
