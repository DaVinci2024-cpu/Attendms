"use client";

import { forwardRef } from "react";
import { CameraOff } from "lucide-react";

interface CameraViewProps {
  error: string | null;
  ready: boolean;
  children?: React.ReactNode;
}

export const CameraView = forwardRef<HTMLVideoElement, CameraViewProps>(
  function CameraView({ error, ready, children }, ref) {
    if (error) {
      return (
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-xl bg-neutral-900 text-neutral-300">
          <CameraOff className="h-10 w-10" />
          <p className="max-w-xs text-center text-sm">{error}</p>
        </div>
      );
    }

    return (
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
        <video
          ref={ref}
          className="h-full w-full -scale-x-100 object-cover"
          muted
          playsInline
        />
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-neutral-400">
            Starting camera...
          </div>
        )}
        {children}
      </div>
    );
  }
);
