/*
 * FinAssist service worker — deliberately conservative because this is a
 * finance app handling sensitive, must-be-fresh data.
 *
 * Rules:
 *   - NEVER cache anything under /api (auth, money data) — always network.
 *   - Cache-first only for immutable build assets (/_next/static, icons) so the
 *     app shell launches instantly and works offline.
 *   - Navigations: network-first, falling back to a cached page only offline.
 *   - Bump CACHE to invalidate old static caches on deploy.
 */
// Bump this version on every deploy that changes cached assets — it forces the
// browser to install the new service worker, purge old caches (see activate),
// and (with the controllerchange reload in ServiceWorkerRegister) refresh the
// app. Without a bump, an unchanged sw.js means clients keep the old version.
const CACHE = "finassist-static-v2";

self.addEventListener("install", (event) => {
    self.skipWaiting();
    event.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/icons/icon-192.png", "/icons/icon-512.png"]).catch(() => {})));
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
        ).then(() => self.clients.claim()),
    );
});

self.addEventListener("fetch", (event) => {
    const { request } = event;
    if (request.method !== "GET") return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;      // third-party: leave alone
    if (url.pathname.startsWith("/api")) return;          // sensitive: never cache

    const isImmutable = url.pathname.startsWith("/_next/static") || url.pathname.startsWith("/icons");

    if (isImmutable) {
        // Cache-first for fingerprinted/immutable assets.
        event.respondWith(
            caches.match(request).then((hit) =>
                hit || fetch(request).then((res) => {
                    const copy = res.clone();
                    caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
                    return res;
                }),
            ),
        );
        return;
    }

    if (request.mode === "navigate") {
        // Network-first; fall back to a cached shell only when offline.
        event.respondWith(
            fetch(request)
                .then((res) => {
                    const copy = res.clone();
                    caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
                    return res;
                })
                .catch(() => caches.match(request).then((hit) => hit || caches.match("/dashboard"))),
        );
    }
});
