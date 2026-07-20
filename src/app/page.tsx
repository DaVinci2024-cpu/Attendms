import Link from "next/link";
import { ScanFace, UserPlus } from "lucide-react";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-10 bg-black px-6 text-white">
      <div className="text-center">
        <h1 className="text-3xl font-semibold">Attendms</h1>
        <p className="mt-2 max-w-md text-neutral-400">
          Biometric attendance prototype — single-tenant demo company, face
          + PIN punches, fully offline-capable once loaded.
        </p>
      </div>

      <div className="flex w-full max-w-md flex-col gap-4">
        <Link
          href="/enroll"
          className="flex items-center gap-3 rounded-xl bg-neutral-900 p-5 transition hover:bg-neutral-800"
        >
          <UserPlus className="h-6 w-6 text-blue-400" />
          <div>
            <p className="font-medium">Enroll employee</p>
            <p className="text-sm text-neutral-400">
              Capture face snapshots, PIN, and consent
            </p>
          </div>
        </Link>

        <Link
          href="/kiosk"
          className="flex items-center gap-3 rounded-xl bg-neutral-900 p-5 transition hover:bg-neutral-800"
        >
          <ScanFace className="h-6 w-6 text-emerald-400" />
          <div>
            <p className="font-medium">Attendance kiosk</p>
            <p className="text-sm text-neutral-400">
              Detect a face, confirm PIN, log the punch
            </p>
          </div>
        </Link>
      </div>
    </div>
  );
}
