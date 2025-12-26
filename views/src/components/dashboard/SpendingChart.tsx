"use client";

import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const data = [
    { name: "Mon", amount: 120 },
    { name: "Tue", amount: 250 },
    { name: "Wed", amount: 180 },
    { name: "Thu", amount: 300 },
    { name: "Fri", amount: 280 },
    { name: "Sat", amount: 350 },
    { name: "Sun", amount: 210 },
];

export function SpendingChart() {
    return (
        <div className="h-[300px] w-full mt-4">
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data}>
                    <defs>
                        <linearGradient id="colorAmount" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <XAxis
                        dataKey="name"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: '#71717a', fontSize: 12 }}
                        dy={10}
                    />
                    <YAxis
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: '#71717a', fontSize: 12 }}
                        dx={-10}
                    />
                    <Tooltip
                        contentStyle={{
                            backgroundColor: '#09090b',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '12px',
                            padding: '12px'
                        }}
                        itemStyle={{ color: '#e4e4e7' }}
                    />
                    <Area
                        type="monotone"
                        dataKey="amount"
                        stroke="#a855f7"
                        strokeWidth={3}
                        fillOpacity={1}
                        fill="url(#colorAmount)"
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
}
