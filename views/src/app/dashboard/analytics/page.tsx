"use client";

import { motion } from "framer-motion";
import { FinancialHealthScore } from "@/components/dashboard/analytics/FinancialHealthScore";
import { SmartTipsWidget } from "@/components/dashboard/analytics/SmartTipsWidget";
import { SpendingComparisonChart } from "@/components/dashboard/analytics/SpendingComparisonChart";
import { HighSpendingAlerts } from "@/components/dashboard/analytics/HighSpendingAlerts";
import { RecurringExpensesList } from "@/components/dashboard/analytics/RecurringExpensesList";
import { ExpenseIncomeRatio } from "@/components/dashboard/analytics/ExpenseIncomeRatio";

export default function AnalyticsPage() {
    return (
        <div className="max-w-7xl mx-auto space-y-6">
            <header className="mb-8">
                <h1 className="text-3xl font-bold text-white tracking-tight">Analytics & AI Insights</h1>
                <p className="text-zinc-400 mt-2">Deep dive into your financial habits with AI-powered analysis.</p>
            </header>

            {/* Top Row: AI Score & Ratio */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-1">
                    <FinancialHealthScore />
                </div>
                <div className="md:col-span-1">
                    <ExpenseIncomeRatio />
                </div>
                <div className="md:col-span-1">
                    <HighSpendingAlerts />
                </div>
            </div>

            {/* Middle Row: Main Chart */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                    <SpendingComparisonChart />
                </div>
                <div className="lg:col-span-1">
                    <RecurringExpensesList />
                </div>
            </div>

            {/* Bottom Row: Smart Tips */}
            <div className="w-full">
                <SmartTipsWidget />
            </div>
        </div>
    );
}
