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
        <div className={cn("p-4 md:p-5 rounded-2xl bg-zinc-900/50 border border-white/5 backdrop-blur-sm relative overflow-hidden group hover:border-purple-500/20 transition-colors", className)}>
            {gradient && (
                <div className="absolute top-0 right-0 w-[150px] h-[150px] bg-purple-600/10 blur-[80px] rounded-full pointer-events-none" />
            )}

            <div className="flex justify-between items-start mb-3">
                <div className="p-2 md:p-2.5 rounded-xl bg-zinc-800/50 text-purple-400">
                    <Icon className="w-4 h-4 md:w-5 md:h-5" />
                </div>
                {trend && (
                    <span className={cn("text-[11px] font-medium px-2 py-0.5 rounded-full", trendUp ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400")}>
                        {trend}
                    </span>
                )}
            </div>

            <div>
                <h3 className="text-zinc-500 text-xs font-medium mb-0.5">{title}</h3>
                <p className={cn("text-xl md:text-2xl font-bold tracking-tight tabular-nums truncate", gradient ? "text-transparent bg-clip-text bg-gradient-to-r from-white to-zinc-400" : "text-white")}>
                    {value}
                </p>
            </div>
        </div>
    );
}
