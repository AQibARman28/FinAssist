"use client";

import { ShoppingBag, Coffee, Car, Home } from "lucide-react";

const transactions = [
    { id: 1, name: "Grocery Shopping", date: "Today, 10:45 AM", amount: "-$125.00", icon: ShoppingBag, color: "bg-orange-500/10 text-orange-400" },
    { id: 2, name: "Starbucks Coffee", date: "Today, 08:30 AM", amount: "-$5.50", icon: Coffee, color: "bg-amber-500/10 text-amber-400" },
    { id: 3, name: "Uber Ride", date: "Yesterday, 6:20 PM", amount: "-$24.00", icon: Car, color: "bg-blue-500/10 text-blue-400" },
    { id: 4, name: "Rent Payment", date: "Oct 01, 2024", amount: "-$1,200.00", icon: Home, color: "bg-purple-500/10 text-purple-400" },
];

export function RecentTransactions() {
    return (
        <div className="space-y-4">
            {transactions.map((tx) => (
                <div key={tx.id} className="flex items-center justify-between p-3 rounded-2xl hover:bg-white/5 transition-colors cursor-pointer group">
                    <div className="flex items-center gap-4">
                        <div className={`p-3 rounded-xl ${tx.color} group-hover:scale-105 transition-transform`}>
                            <tx.icon className="w-5 h-5" />
                        </div>
                        <div>
                            <h4 className="text-white font-medium text-sm">{tx.name}</h4>
                            <p className="text-zinc-500 text-xs">{tx.date}</p>
                        </div>
                    </div>
                    <span className="text-white font-medium text-sm">{tx.amount}</span>
                </div>
            ))}
        </div>
    );
}
