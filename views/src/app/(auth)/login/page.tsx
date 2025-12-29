
"use client";

import { motion } from "framer-motion";
import { Lock, Mail, ArrowRight, AlertCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/store";

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

export default function LoginPage() {
    const router = useRouter();
    const setAuth = useAuthStore((state) => state.setAuth);

    const [formData, setFormData] = useState({
        email: "",
        password: "",
    });
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);

        try {
            const res = await api.post("/auth/login", formData);

            // Store user and token
            setAuth(res.data.data, res.data.data.token);

            // Redirect to dashboard
            router.push("/dashboard");
        } catch (err: any) {
            setError(
                err.response?.data?.message || "Something went wrong. Please try again."
            );
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="relative min-h-screen w-full flex items-center justify-center bg-zinc-950 overflow-hidden text-zinc-200">
            {/* Background Aurora Effect */}
            <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] bg-purple-900/30 rounded-full blur-[100px] mix-blend-screen animate-pulse" />
                <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] bg-violet-900/20 rounded-full blur-[120px] mix-blend-screen opacity-70" />
            </div>

            {/* Floating Card */}
            <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="relative z-10 w-full max-w-md p-8 sm:p-10 bg-black/40 backdrop-blur-2xl border border-white/5 rounded-3xl shadow-2xl shadow-purple-900/10 ring-1 ring-white/5"
            >
                <div className="text-center mb-8">
                    <motion.div
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ delay: 0.2 }}
                        className="inline-flex items-center gap-2 mb-2"
                    >
                        <div className="w-2 h-2 rounded-full bg-purple-500 shadow-[0_0_10px_#a855f7]" />
                        <h1 className="text-2xl font-light tracking-wide text-white">
                            FinAssist
                        </h1>
                    </motion.div>
                    <p className="text-zinc-500 text-sm">Access your financial vault</p>
                </div>

                {error && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2"
                    >
                        <AlertCircle className="w-4 h-4" />
                        {error}
                    </motion.div>
                )}

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="space-y-4">
                        <div className="group">
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500 group-focus-within:text-purple-400 transition-colors" />
                                <input
                                    type="email"
                                    placeholder="Email Address"
                                    value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                    className="w-full bg-zinc-900/50 border-b border-zinc-800 focus:border-purple-500 text-zinc-300 placeholder:text-zinc-600 pl-10 pr-4 py-3 outline-none transition-all duration-300 rounded-t-sm"
                                    required
                                />
                            </div>
                        </div>

                        <div className="group">
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500 group-focus-within:text-purple-400 transition-colors" />
                                <input
                                    type="password"
                                    placeholder="Password"
                                    value={formData.password}
                                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                    className="w-full bg-zinc-900/50 border-b border-zinc-800 focus:border-purple-500 text-zinc-300 placeholder:text-zinc-600 pl-10 pr-4 py-3 outline-none transition-all duration-300 rounded-t-sm"
                                    required
                                />
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center justify-between text-xs text-zinc-500">
                        <label className="flex items-center gap-2 cursor-pointer hover:text-zinc-400 transition-colors">
                            <input type="checkbox" className="accent-purple-500 rounded border-zinc-700 bg-zinc-900" />
                            Remember me
                        </label>
                        <Link href="#" className="hover:text-purple-400 transition-colors">
                            Forgot Password?
                        </Link>
                    </div>

                    <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        className={cn(
                            "w-full flex items-center justify-center gap-2 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white font-medium py-3 rounded-full shadow-lg shadow-purple-900/20 transition-all duration-300",
                            isLoading && "opacity-80 cursor-wait"
                        )}
                        disabled={isLoading}
                    >
                        {isLoading ? (
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                            <>
                                Sign In <ArrowRight className="w-4 h-4" />
                            </>
                        )}
                    </motion.button>
                </form>

                <div className="mt-8 text-center text-xs text-zinc-500">
                    Don't have an account?{" "}
                    <Link href="/register" className="text-purple-400 hover:text-purple-300 transition-colors font-medium">
                        Create Access
                    </Link>
                </div>
            </motion.div>
        </div>
    );
}

