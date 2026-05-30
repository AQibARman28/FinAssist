import type { MetadataRoute } from "next";

// Served by Next at /manifest.webmanifest and auto-linked into <head>.
// Makes FinAssist installable as a standalone app (home-screen icon, splash,
// full-screen launch).
export default function manifest(): MetadataRoute.Manifest {
    return {
        name: "FinAssist — Personal Finance Manager",
        short_name: "FinAssist",
        description: "Track expenses, manage budgets, set savings goals, and get AI-powered insights.",
        start_url: "/dashboard",
        scope: "/",
        display: "standalone",
        background_color: "#09090b",
        theme_color: "#7c3aed",
        orientation: "portrait-primary",
        icons: [
            { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
    };
}
