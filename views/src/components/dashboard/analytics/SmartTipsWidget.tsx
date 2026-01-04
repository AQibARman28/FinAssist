"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Lightbulb, ChevronRight, ChevronLeft } from "lucide-react";
import { api } from "@/lib/api";

interface Tip {
    category: string;
    message: string;
}

export function SmartTipsWidget() {
    const [tips, setTips] = useState<Tip[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchTips = async () => {
            try {
                const res = await api.get("/ai/smart-tips");
                setTips(res.data.data);
            } catch (err) {
                console.error("Failed to fetch smart tips", err);
            } finally {
                setLoading(false);
            }
        };
        fetchTips();
    }, []);

    const nextTip = () => {
        setCurrentIndex((prev) => (prev + 1) % tips.length);
    };

    const prevTip = () => {
        setCurrentIndex((prev) => (prev - 1 + tips.length) % tips.length);
    };

    if (loading) return <div className="h-40 animate-pulse bg-zinc-900/50 rounded-3xl" />;

    if (tips.length === 0) {
        return (
            <div className="p-6 rounded-3xl bg-zinc-900/50 border border-white/5 h-full flex flex-col items-center justify-center text-center">
                <Lightbulb className="w-8 h-8 text-zinc-700 mb-2" />
                <p className="text-zinc-500 text-sm">No tips available yet. Keep tracking your expenses!</p>
            </div>
        );
    }

    return (
        <div className="p-6 rounded-3xl bg-gradient-to-br from-indigo-900/20 to-purple-900/20 border border-white/10 relative overflow-hidden h-full">
            <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-yellow-500/10 text-yellow-500">
                        <Lightbulb className="w-4 h-4" />
                    </div>
                    <h3 className="text-lg font-semibold text-white">Smart Tips</h3>
                </div>

                <div className="flex gap-1">
                    <button onClick={prevTip} className="p-1 rounded-full hover:bg-white/10 text-zinc-400 transition-colors">
                        <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button onClick={nextTip} className="p-1 rounded-full hover:bg-white/10 text-zinc-400 transition-colors">
                        <ChevronRight className="w-4 h-4" />
                    </button>
                </div>
            </div>

            <div className="relative h-24">
                <AnimatePresence mode="wait">
                    <motion.div
                        key={currentIndex}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        transition={{ duration: 0.2 }}
                        className="absolute inset-0"
                    >
                        <span className="inline-block px-2 py-1 rounded-md bg-white/10 text-xs text-white/80 mb-2">
                            {tips[currentIndex].category}
                        </span>
                        <p className="text-white text-sm leading-relaxed">
                            {tips[currentIndex].message}
                        </p>
                    </motion.div>
                </AnimatePresence>
            </div>

            <div className="flex justify-center gap-1 mt-2">
                {tips.map((_, idx) => (
                    <div
                        key={idx}
                        className={`w-1.5 h-1.5 rounded-full transition-colors ${idx === currentIndex ? 'bg-white' : 'bg-white/20'}`}
                    />
                ))}
            </div>
        </div>
    );
}
