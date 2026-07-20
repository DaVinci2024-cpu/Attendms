"use client";

import { useEffect, useState } from "react";
import { loadFaceModels } from "@/lib/faceApi";

export function useFaceModels() {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
  }, []);

  return { loaded, error };
}
