"use client";

import { useEffect } from "react";

// Registers the PWA service worker (public/sw.js) once on the client, in
// production only. Rendered from the root layout. Renders nothing.
export function ServiceWorkerRegister() {
    useEffect(() => {
        if (process.env.NODE_ENV !== "production") return;
        if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

        // When a NEW service worker takes control (i.e. an update shipped),
        // reload once so the user immediately sees the new version. Guarded so
        // the first-ever install (no prior controller) doesn't trigger a reload.
        const hadController = !!navigator.serviceWorker.controller;
        let refreshing = false;
        const onControllerChange = () => {
            if (refreshing || !hadController) return;
            refreshing = true;
            window.location.reload();
        };
        navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

        const onLoad = () => {
            navigator.serviceWorker
                .register("/sw.js")
                .then((reg) => reg.update().catch(() => {})) // check for a newer sw.js each load
                .catch((err) => console.error("SW registration failed", err));
        };
        window.addEventListener("load", onLoad);
        return () => {
            window.removeEventListener("load", onLoad);
            navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
        };
    }, []);
    return null;
}
