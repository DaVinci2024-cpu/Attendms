import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { RegisterServiceWorker } from "@/components/RegisterServiceWorker";
import { SyncServiceInit } from "@/components/SyncServiceInit";
import { getStoredWebConfig } from "@/lib/server/firebaseConfigStore";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Attendms — Biometric Attendance Kiosk",
  description:
    "Offline-capable face + PIN attendance kiosk prototype (single-tenant demo).",
  manifest: "/manifest.json",
};

// Without this, mobile browsers render the page at a fixed desktop-width
// viewport and scale it down to fit — every page looks "zoomed out" and
// needs a pinch-zoom to use normally, instead of laying out natively at
// the phone's real width.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

// A Server Component (no "use client") specifically so this can read the
// stored Firebase web config directly off disk, same process, and embed it
// into the very first HTML response — src/lib/firebase.ts reads it back off
// `window.__FIREBASE_WEB_CONFIG__` synchronously on the client. Doing this
// server-side avoids an async fetch-then-initialize race on every page load
// against RequireAdmin's own mount effect (which needs Firebase Auth
// initialized immediately), and replaces the old NEXT_PUBLIC_FIREBASE_*
// build-time env vars — there's no longer a "build time" per business once
// this ships as one Electron binary for every install (see Phase 2).
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const webConfig = getStoredWebConfig();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {webConfig && (
          <script
            // Safe: webConfig only ever holds the public, non-secret fields
            // documented on StoredWebConfig — the same values Firebase
            // itself expects to ship inside a public client bundle.
            dangerouslySetInnerHTML={{
              __html: `window.__FIREBASE_WEB_CONFIG__ = ${JSON.stringify(webConfig)};`,
            }}
          />
        )}
        <RegisterServiceWorker />
        <SyncServiceInit />
        {children}
      </body>
    </html>
  );
}
