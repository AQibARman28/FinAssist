"use client";

import { useEffect, useState } from "react";
import { AlertCircle, ShoppingBag } from "lucide-react";
import { api } from "@/lib/api";

export function HighSpendingAlerts() {
    const [alerts, setAlerts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchAlerts = async () => {
            try {
                const res = await api.get("/analytics/high-spending");
                setAlerts(res.data.data);
            } catch (err) {
                console.error("Failed to fetch alerts", err);
            } finally {
                setLoading(false);
            }
        };
        fetchAlerts();
    }, []);

    if (loading) return <div className="h-40 animate-pulse bg-zinc-900/50 rounded-3xl" />;

    if (alerts.length === 0) {
        return (
            <div className="p-6 rounded-3xl bg-zinc-900/50 border border-white/5 flex flex-col items-center justify-center text-center h-full">
                <div className="p-3 rounded-full bg-green-500/10 text-green-500 mb-3">
                    <ShoppingBag className="w-5 h-5" />
                </div>
                <p className="text-zinc-400 text-sm">No unusual spending detected.</p>
            </div>
        );
    }

    return (
        <div className="p-6 rounded-3xl bg-zinc-900/50 border border-white/5 h-full">
            <div className="flex items-center gap-2 mb-4">
                <AlertCircle className="w-5 h-5 text-red-500" />
                <h3 className="text-lg font-semibold text-white">Unusual Spending</h3>
            </div>

            <div className="space-y-3">
                {alerts.map((item, idx) => (
                    <div key={idx} className="p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                        <div className="flex justify-between items-start">
                            <div>
                                <span className="text-red-400 text-sm font-medium">{item._id}</span>
                                <p className="text-xs text-red-300/70 mt-0.5">50% higher than average</p>
                            </div>
                            <span className="text-red-400 font-bold">${item.total.toFixed(0)}</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
