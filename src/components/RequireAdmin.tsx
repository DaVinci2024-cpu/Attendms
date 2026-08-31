"use client";

import { createContext, useContext, useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { Loader2, LogOut, ShieldAlert } from "lucide-react";
import { getAuthClient } from "@/lib/auth";
import {
  ensureAdminBootstrap,
  fetchCompany,
  fetchPermissionGrant,
} from "@/lib/firestoreRepo";
import { grantHas } from "@/lib/permissions";
import { AdminNav } from "@/components/AdminNav";
import type { Permission, PermissionGrant } from "@/lib/types";

interface PermissionsContextValue {
  uid: string;
  email: string | null;
  isAdmin: boolean;
  grant: PermissionGrant | null;
  has: (permission: Permission) => boolean;
}

const PermissionsContext = createContext<PermissionsContextValue | null>(null);

/** Fine-grained permission check for use inside any page under RequireAdmin. */
export function usePermissions(): PermissionsContextValue {
  const ctx = useContext(PermissionsContext);
  if (!ctx) {
    throw new Error("usePermissions must be used within RequireAdmin");
  }
  return ctx;
}

export function RequireAdmin({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [isAdmin, setIsAdmin] = useState<boolean | undefined>(undefined);
  const [grant, setGrant] = useState<PermissionGrant | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(getAuthClient(), (u) => {
      setUser(u);
      setIsAdmin(undefined);
      setGrant(null);
    });
  }, []);

  // "Signed in" no longer implies any particular access level — could be a
  // full admin, an employee portal account with no elevated access, or a
  // supervisor with a specific permission grant. This resolves which.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function checkAccess() {
      if (!user) return;
      try {
        const company = await fetchCompany();
        const adminUids = company?.adminUids ?? [];
        if (adminUids.length === 0) {
          // Bootstrapping: nobody has claimed admin yet — see
          // firestore.rules for why this is only reachable pre-bootstrap.
          await ensureAdminBootstrap(user.uid);
          if (!cancelled) setIsAdmin(true);
          return;
        }
        const admin = adminUids.includes(user.uid);
        if (!cancelled) setIsAdmin(admin);
        if (!admin) {
          const g = await fetchPermissionGrant(user.uid);
          if (!cancelled) setGrant(g);
        }
      } catch {
        if (!cancelled) setIsAdmin(false);
      }
    }

    checkAccess();
    return () => {
      cancelled = true;
    };
  }, [user]);

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

  if (user === undefined || (user && isAdmin === undefined)) {
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

  const hasAnyAccess = isAdmin || grant !== null;

  if (!hasAnyAccess) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
        <ShieldAlert className="h-8 w-8 text-red-400" />
        <p className="max-w-sm text-sm text-neutral-300">
          {user.email} is signed in, but this account doesn&apos;t have
          admin/supervisor access. If this is an employee portal account,
          use the employee portal instead.
        </p>
        <button
          type="button"
          onClick={() => signOut(getAuthClient())}
          className="flex items-center gap-1 rounded-lg bg-neutral-800 px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-700"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>
    );
  }

  const contextValue: PermissionsContextValue = {
    uid: user.uid,
    email: user.email,
    isAdmin: Boolean(isAdmin),
    grant,
    has: (permission) => Boolean(isAdmin) || grantHas(grant, permission),
  };

  return (
    <PermissionsContext.Provider value={contextValue}>
      <div>
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 pt-4">
          <AdminNav />
          <div className="flex items-center gap-2 text-sm text-neutral-400">
            {user.email}
            <button
              type="button"
              onClick={() => signOut(getAuthClient())}
              className="flex items-center gap-1 hover:text-neutral-200"
            >
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </div>
        </div>
        {children}
      </div>
    </PermissionsContext.Provider>
  );
}
