"use client";

import { useEffect, useState } from "react";
import { loadFaceModels } from "@/lib/faceApi";

/**
 * @param active Whether to load the models at all. Defaults to true (e.g.
 * the enroll page, which always needs face capture regardless of the
 * kiosk's punch-time identification settings). The kiosk passes its
 * facial-recognition toggle explicitly, so a PIN-only kiosk never
 * downloads these models in the first place.
 */
export function useFaceModels(active: boolean = true) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    loadFaceModels()
      .then(() => {
        if (!cancelled) setLoaded(true);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load face models"
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  return { loaded, error };
}
