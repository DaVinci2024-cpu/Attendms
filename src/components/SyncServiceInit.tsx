"use client";

import { useEffect } from "react";
import { syncService } from "@/lib/syncService";
import { ensureCompanyDoc } from "@/lib/dexieRepo";

/**
 * Starts the Dexie <-> Firestore/LAN sync loop (see syncService.ts) once,
 * for the whole app — not just the admin pages. The kiosk route needs this
 * running too: it's what keeps a kiosk's local employee/schedule data fresh
 * even though the kiosk itself never signs in, and what pushes its
 * recorded punches up to Firestore/LAN peers. Pure client-side; does
 * nothing during server rendering.
 */
export function SyncServiceInit() {
  useEffect(() => {
    ensureCompanyDoc().finally(() => syncService.init());
  }, []);

  return null;
}
