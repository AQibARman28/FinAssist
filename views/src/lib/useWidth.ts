"use client";

import { useEffect, useRef, useState } from "react";

// An element's content width, kept current as it resizes. Charts draw in
// real pixels from it, so text and strokes stay crisp at every size.
export function useWidth<T extends HTMLElement>() {
    const ref = useRef<T>(null);
    const [width, setWidth] = useState(0);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    return [ref, width] as const;
}
