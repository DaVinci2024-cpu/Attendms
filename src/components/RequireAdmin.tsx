"use client";

import { useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { Loader2, LogOut } from "lucide-react";
import { getAuthClient } from "@/lib/auth";

export function RequireAdmin({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(getAuthClient(), setUser);
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setSigningIn(true);
    setError(null);
    try {
      await signInWithEmailAndPassword(getAuthClient(), email, password);
    } catch {
      setError("Incorrect email or password.");
    } finally {
      setSigningIn(false);
    }
  }

  if (user === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
      </div>
    );
  }

  if (user === null) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <form
          onSubmit={handleLogin}
          className="flex w-full max-w-sm flex-col gap-4 rounded-xl bg-neutral-900 p-6"
        >
          <div>
            <h1 className="text-xl font-semibold">Admin sign-in</h1>
            <p className="text-sm text-neutral-400">
              This is an admin-only area. Sign in with the account created
              for this company in the Firebase console.
            </p>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            Email
            <input
              type="email"
              required
              className="rounded-lg bg-neutral-800 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-600"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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

  return (
    <div>
      <div className="flex items-center justify-end gap-2 px-4 pt-4 text-sm text-neutral-400">
        {user.email}
        <button
          type="button"
          onClick={() => signOut(getAuthClient())}
          className="flex items-center gap-1 hover:text-neutral-200"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>
      {children}
    </div>
  );
}
