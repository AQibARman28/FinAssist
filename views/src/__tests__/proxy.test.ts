import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";

// NextResponse.rewrite encodes the forwarded request's headers as
// x-middleware-override-headers (the full list) + x-middleware-request-<name>.
function forwarded(res: Response) {
    const names = (res.headers.get("x-middleware-override-headers") ?? "").split(",").filter(Boolean);
    return Object.fromEntries(names.map((n) => [n, res.headers.get(`x-middleware-request-${n}`)]));
}

const apiRequest = (headers: Record<string, string>) =>
    new NextRequest("https://app.example/api/auth/login", { method: "POST", headers });

const spoofed = {
    "x-forwarded-for": "6.6.6.6",
    "x-real-ip": "6.6.6.6",
    forwarded: "for=6.6.6.6",
};

afterEach(() => {
    delete process.env.VERCEL;
    delete process.env.CLIENT_IP_HEADER;
    delete process.env.PROXY_SHARED_SECRET;
});

test("self-hosted with no trusted source: client-chosen addresses never reach the API", () => {
    const sent = forwarded(proxy(apiRequest(spoofed)));
    assert.equal(sent["x-forwarded-for"], undefined);
    assert.equal(sent["x-real-ip"], undefined);
    assert.equal(sent["forwarded"], undefined);
});

test("self-hosted behind a reverse proxy: the address comes only from CLIENT_IP_HEADER", () => {
    process.env.CLIENT_IP_HEADER = "x-real-ip";
    const sent = forwarded(proxy(apiRequest({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "6.6.6.6, 203.0.113.7" })));
    assert.equal(sent["x-forwarded-for"], "203.0.113.7");
    assert.equal(sent["x-real-ip"], undefined);
});

test("on Vercel: the platform-set x-real-ip is forwarded as the single address", () => {
    process.env.VERCEL = "1";
    const sent = forwarded(proxy(apiRequest({ "x-real-ip": "198.51.100.4", "x-forwarded-for": "198.51.100.4" })));
    assert.equal(sent["x-forwarded-for"], "198.51.100.4");
});

test("the proxy secret is added and a client-supplied copy is replaced", () => {
    process.env.PROXY_SHARED_SECRET = "a".repeat(64);
    const sent = forwarded(proxy(apiRequest({ "x-finassist-proxy": "forged" })));
    assert.equal(sent["x-finassist-proxy"], "a".repeat(64));
});
