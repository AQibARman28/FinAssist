"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

// Two turns of the wheel, so each digit spins past a few before it settles.
// Each step is 1.2 lines tall: Archivo draws digits a little outside a
// one-line box, and the extra room keeps the neighbouring digits out of view.
const STEP = 1.2;
const WHEEL = "01234567890123456789".split("");

// A figure whose digits roll into place when it appears, like a mechanical
// counter. The plain text is there for screen readers and copying; the wheels
// are decoration. With reduced motion it simply shows the figure.
export function RollingNumber({ text, delay = 0, className }: { text: string; delay?: number; className?: string }) {
    const ref = useRef<HTMLSpanElement>(null);
    const reduce = useReducedMotion();

    useEffect(() => {
        const el = ref.current;
        if (reduce || !el || typeof el.animate !== "function") return;
        const wheels = [...el.querySelectorAll<HTMLElement>("[data-stop]")];
        const runs = wheels.map((w, i) => w.animate(
            [{ transform: "translateY(0)" }, { transform: `translateY(-${Number(w.dataset.stop) * STEP}em)` }],
            { duration: 1100 + i * 110, delay, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "backwards" },
        ));
        return () => runs.forEach((r) => r.cancel());
    }, [text, delay, reduce]);

    return (
        <span ref={ref} className={cn("inline-flex items-start h-[1.2em] leading-[1.2] whitespace-nowrap overflow-hidden", className)}>
            <span className="sr-only">{text}</span>
            {[...text].map((ch, i) => {
                if (!/\d/.test(ch)) return <span key={i} aria-hidden className="inline-block">{ch}</span>;
                const stop = 10 + Number(ch);
                return (
                    <span key={i} aria-hidden className="relative inline-block">
                        <span className="invisible">{ch}</span>
                        <span data-stop={stop} className="absolute -inset-x-[0.3em] top-0 flex flex-col items-center" style={{ transform: `translateY(-${stop * STEP}em)` }}>
                            {WHEEL.map((d, k) => <span key={k} className="block h-[1.2em]">{d}</span>)}
                        </span>
                    </span>
                );
            })}
        </span>
    );
}
