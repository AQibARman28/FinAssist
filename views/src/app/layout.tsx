import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Archivo, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { NetworkStatus } from "@/components/NetworkStatus";
import { MotionProvider } from "@/components/MotionProvider";

// Archivo carries the whole app (DESIGN.md › Typography). Its width axis gives
// the extra-wide light figures and the wide, spaced labels their character.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FinAssist — Personal Finance Manager",
  description: "Track expenses, manage budgets, set savings goals, and see what's safe to spend each day, with rule-based tips.",
  applicationName: "FinAssist",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "FinAssist",
  },
  icons: {
    icon: [{ url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#09090b",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Reading the request headers opts every page into dynamic rendering, which
  // the per-request CSP nonce set in src/proxy.ts needs: Next stamps that
  // nonce onto its own scripts only when it renders the page per request.
  await headers();
  return (
    <html lang="en">
      <body
        className={`${archivo.variable} ${geistMono.variable} antialiased`}
      >
        <MotionProvider>{children}</MotionProvider>
        <NetworkStatus />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
