"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { getAuthClient } from "@/lib/auth";
import { fetchEmployeeByPortalUsername } from "@/lib/firestoreRepo";
import { portalEmail } from "@/lib/constants";

export default function PortalLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setSigningIn(true);
    setError(null);
    try {
      const employee = await fetchEmployeeByPortalUsername(
        username.trim().toLowerCase()
      );
      if (!employee) {
        setError("Incorrect username or password.");
        return;
      }
      await signInWithEmailAndPassword(
        getAuthClient(),
        portalEmail(employee.employeeId),
        password
      );
      router.push("/portal");
    } catch {
      setError("Incorrect username or password.");
    } finally {
      setSigningIn(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <Link
        href="/"
        className="flex items-center gap-1 self-start text-sm text-neutral-400 hover:text-neutral-200"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>
      <form
        onSubmit={handleLogin}
        className="flex w-full max-w-sm flex-col gap-4 rounded-xl bg-neutral-900 p-6"
      >
        <div>
          <h1 className="text-xl font-semibold">Employee portal</h1>
          <p className="text-sm text-neutral-400">
            Sign in with the username and password your admin gave you.
          </p>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          Username
          <input
            required
            className="rounded-lg bg-neutral-800 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-600"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Password
          <input
            type="password"
            required
            className="rounded-lg bg-neutral-800 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-600"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={signingIn}
          className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 font-medium text-white disabled:cursor-not-allowed disabled:bg-neutral-700"
        >
          {signingIn && <Loader2 className="h-4 w-4 animate-spin" />}
          Sign in
        </button>
      </form>
    </div>
  );
}
