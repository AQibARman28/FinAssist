"use client";

import { MotionConfig } from "framer-motion";

// Honour the device's "reduce motion" setting for every framer-motion
// animation in the app: movement is dropped, fades stay, so state changes are
// still visible. (CSS animations are handled in globals.css.)
export function MotionProvider({ children }: { children: React.ReactNode }) {
    return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
