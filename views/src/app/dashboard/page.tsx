import { StatCard } from "@/components/dashboard/StatCard";
import { SpendingChart } from "@/components/dashboard/SpendingChart";
import { RecentTransactions } from "@/components/dashboard/RecentTransactions";
import { Wallet, CreditCard, TrendingUp, Bell } from "lucide-react";

export default function DashboardPage() {
    return (
        <div className="p-6 space-y-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-2xl font-bold text-white">Hello, User</h1>
                    <p className="text-zinc-500 text-sm">Here is your financial overview.</p>
                </div>
                <button className="p-3 bg-zinc-900 rounded-full border border-white/5 hover:border-purple-500/50 text-zinc-400 hover:text-white transition-all">
                    <Bell className="w-5 h-5" />
                </button>
            </div>

            {/* Stats Bento Grid - Top Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <StatCard
                    title="Total Balance"
                    value="$12,450.00"
                    trend="+2.5%"
                    trendUp={true}
                    icon={Wallet}
                    gradient={true}
                    className="col-span-1 md:col-span-1 bg-gradient-to-br from-zinc-900 to-black"
                />
                <StatCard
                    title="Monthly Spend"
                    value="$2,340.50"
                    trend="+12%"
                    trendUp={false}
                    icon={CreditCard}
                />
                <StatCard
                    title="Savings Goal"
                    value="$8,200.00"
                    trend="+5%"
                    trendUp={true}
                    icon={TrendingUp}
                />
            </div>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">

                {/* Chart Section - Takes 2 cols */}
                <div className="lg:col-span-2 p-6 rounded-3xl bg-zinc-900/50 border border-white/5 min-h-[400px]">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-lg font-semibold text-white">Spending Trends</h2>
                        <select className="bg-black/30 text-xs px-3 py-1 rounded-lg border border-white/5 text-zinc-400 outline-none">
                            <option>This Month</option>
                            <option>Last Month</option>
                        </select>
                    </div>
                    <SpendingChart />
                </div>

                {/* Transactions Section - Takes 1 col */}
                <div className="lg:col-span-1 p-6 rounded-3xl bg-zinc-900/50 border border-white/5">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-lg font-semibold text-white">Recent Transactions</h2>
                        <button className="text-xs text-purple-400 hover:text-purple-300">View All</button>
                    </div>
                    <RecentTransactions />
                </div>

            </div>
        </div>
    );
}
