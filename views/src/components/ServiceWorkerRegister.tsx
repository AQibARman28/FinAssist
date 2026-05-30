"use client";

import { useEffect } from "react";

// Registers the PWA service worker (public/sw.js) once on the client, in
// production only. Rendered from the root layout. Renders nothing.
export function ServiceWorkerRegister() {
    useEffect(() => {
        if (process.env.NODE_ENV !== "production") return;
        if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
        const onLoad = () => navigator.serviceWorker.register("/sw.js").catch((err) => console.error("SW registration failed", err));
        window.addEventListener("load", onLoad);
        return () => window.removeEventListener("load", onLoad);
    }, []);
    return null;
}
