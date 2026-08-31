"use client";

import { useEffect, useRef, useState } from "react";

/**
 * @param active Whether the camera should be running. Defaults to true
 * (e.g. the enroll page, which is a dedicated camera screen). The kiosk
 * passes this explicitly so the camera — and the device's camera
 * indicator light — is only on while a punch is actually in progress,
 * not just because the kiosk's idle screen is loaded.
 */
export function useCamera(active: boolean = true) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;

    let stream: MediaStream | null = null;
    let cancelled = false;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
          setReady(true);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not access camera"
        );
      }
    }

    start();

    // Runs when `active` flips back to false (or on unmount) — stops the
    // camera immediately rather than leaving it running in the background,
    // and resets `ready` so the next activation shows "Starting camera..."
    // again instead of a stale frame.
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
      setReady(false);
    };
  }, [active]);

  return { videoRef, ready, error };
}
