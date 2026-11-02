// Firebase Auth's client config only — this app's Firestore access moved
// server-side (src/lib/server/firebaseAdmin.ts) in the Electron port; the
// browser/renderer now only ever needs Firebase for sign-in (RequireAdmin,
// portal login). See db.ts/dexieRepo.ts for the Firestore-replacement
// (Dexie) and syncService.ts for how data actually reaches Firestore now.
import { initializeApp, getApps, getApp, type FirebaseApp, type FirebaseOptions } from "firebase/app";
import type { StoredWebConfig } from "./server/firebaseConfigStore";

declare global {
  interface Window {
    // Embedded server-side by src/app/layout.tsx, which reads it directly
    // off this install's stored config (see firebaseConfigStore.ts) — the
    // runtime, per-install replacement for the old NEXT_PUBLIC_FIREBASE_*
    // build-time env vars, which only ever worked for one Firebase project
    // per Netlify deploy, not one Electron binary shared by every business.
    __FIREBASE_WEB_CONFIG__?: StoredWebConfig;
  }
}

export function getFirebaseApp(): FirebaseApp {
  if (getApps().length) return getApp();

  const webConfig = typeof window !== "undefined" ? window.__FIREBASE_WEB_CONFIG__ : undefined;
  if (!webConfig) {
    throw new Error(
      "This install hasn't connected a Firebase project yet — go to System > Cloud Sync to connect one."
    );
  }
  return initializeApp(webConfig as FirebaseOptions);
}
