import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatCardProps {
    title: string;
    value: string;
    trend?: string;
    trendUp?: boolean;
    icon: LucideIcon;
    className?: string;
    gradient?: boolean;
}

export function StatCard({ title, value, trend, trendUp, icon: Icon, className, gradient }: StatCardProps) {
    return (
        <div className={cn("p-6 rounded-3xl bg-zinc-900/50 border border-white/5 backdrop-blur-sm relative overflow-hidden group hover:border-purple-500/20 transition-colors", className)}>
            {gradient && (
                <div className="absolute top-0 right-0 w-[150px] h-[150px] bg-purple-600/10 blur-[80px] rounded-full pointer-events-none" />
            )}

            <div className="flex justify-between items-start mb-4">
                <div className="p-3 rounded-2xl bg-zinc-800/50 text-purple-400 group-hover:scale-110 transition-transform duration-300">
                    <Icon className="w-6 h-6" />
                </div>
                {trend && (
                    <span className={cn("text-sm font-medium px-2 py-1 rounded-full", trendUp ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400")}>
                        {trend}
                    </span>
                )}
            </div>

            <div>
                <h3 className="text-zinc-500 text-sm font-medium mb-1">{title}</h3>
                <p className={cn("text-3xl font-bold tracking-tight", gradient ? "text-transparent bg-clip-text bg-gradient-to-r from-white to-zinc-400" : "text-white")}>
                    {value}
                </p>
            </div>
        </div>
    );
}
