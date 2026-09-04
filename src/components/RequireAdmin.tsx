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
  fetchEmployeeByAuthUid,
  fetchEmployeeByPortalUsername,
  fetchPermissionGrant,
} from "@/lib/firestoreRepo";
import { grantHas } from "@/lib/permissions";
import { portalEmail } from "@/lib/constants";
import { Sidebar } from "@/components/Sidebar";
import type { Permission, PermissionGrant } from "@/lib/types";

interface PermissionsContextValue {
  uid: string;
  email: string | null;
  // A human name wherever one exists — the linked employee's fullName for
  // a portal/grant account, since their Firebase email is a synthetic
  // emp_xxx@attendms.local address that means nothing to a person reading
  // an audit trail. Falls back to the email's local part for a real admin
  // account (no Employee record to look up), and to the uid only if
  // there's truly nothing else. Never null — every caller that stamps
  // "who did this" onto a record wants a string, not an optional one.
  displayName: string;
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

async function resolveDisplayName(user: User): Promise<string> {
  try {
    const employee = await fetchEmployeeByAuthUid(user.uid);
    if (employee) return employee.fullName;
  } catch {
    // Falls through to the email-based name below — not worth failing
    // the whole access check over a display-name lookup.
  }
  if (user.email) return user.email.split("@")[0];
  return user.uid;
}

// Resolved access state for the signed-in Firebase user — a single value
// rather than separate isAdmin/grant booleans that update independently,
// specifically so nothing can ever render "access denied" for someone
// who's actually authorized just because the admin check finished a beat
// before the grant check did (that race was the exact cause of the old
// per-navigation "denied" flash for granted, non-full-admin users).
type Access =
  | { status: "checking" }
  | { status: "denied" }
  | {
      status: "authorized";
      isAdmin: boolean;
      grant: PermissionGrant | null;
      displayName: string;
    };

export function RequireAdmin({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [access, setAccess] = useState<Access>({ status: "checking" });
  const [emailOrUsername, setEmailOrUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(getAuthClient(), (u) => {
      setUser(u);
      setAccess({ status: "checking" });
    });
  }, []);

  // "Signed in" no longer implies any particular access level — could be a
  // full admin, an employee portal account with no elevated access, or a
  // supervisor with a specific permission grant. This resolves which, and
  // only reports a final status once every read it depends on has
  // actually finished (see the Access type above).
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
          const displayName = await resolveDisplayName(user);
          if (!cancelled) {
            setAccess({ status: "authorized", isAdmin: true, grant: null, displayName });
          }
          return;
        }
        const admin = adminUids.includes(user.uid);
        const grant = admin ? null : await fetchPermissionGrant(user.uid);
        if (cancelled) return;
        if (!admin && !grant) {
          setAccess({ status: "denied" });
          return;
        }
        const displayName = await resolveDisplayName(user);
        if (!cancelled) {
          setAccess({ status: "authorized", isAdmin: admin, grant, displayName });
        }
      } catch {
        if (!cancelled) setAccess({ status: "denied" });
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
      const input = emailOrUsername.trim();
      // Admins sign in with their real email; an employee granted a
      // permission has no real email (their portal account uses a
      // synthetic one) — the same username -> account lookup /portal/login
      // uses resolves it here too, before verifying the real password
      // normally. Same account, same password, either entry point.
      let loginEmail = input;
      if (!input.includes("@")) {
        const employee = await fetchEmployeeByPortalUsername(input.toLowerCase());
        if (!employee) {
          setError("Incorrect email/username or password.");
          setSigningIn(false);
          return;
        }
        loginEmail = portalEmail(employee.employeeId);
      }
      await signInWithEmailAndPassword(getAuthClient(), loginEmail, password);
    } catch {
      setError("Incorrect email/username or password.");
    } finally {
      setSigningIn(false);
    }
  }

  if (user === undefined || (user && access.status === "checking")) {
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
              Admin: sign in with the account created for this company in
              the Firebase console. Supervisor: sign in with your portal
              username — you&apos;ll only see what you&apos;ve been granted
              access to.
            </p>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            Email or username
            <input
              type="text"
              required
              className="rounded-lg bg-neutral-800 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-600"
              value={emailOrUsername}
              onChange={(e) => setEmailOrUsername(e.target.value)}
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

  if (access.status !== "authorized") {
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

  const { isAdmin, grant, displayName } = access;
  const contextValue: PermissionsContextValue = {
    uid: user.uid,
    email: user.email,
    displayName,
    isAdmin,
    grant,
    has: (permission) => isAdmin || grantHas(grant, permission),
  };

  return (
    <PermissionsContext.Provider value={contextValue}>
      <div className="flex min-h-screen flex-col md:flex-row">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-end gap-2 px-4 py-3 text-sm text-neutral-400 print:hidden">
            {displayName}
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
      </div>
    </PermissionsContext.Provider>
  );
}
