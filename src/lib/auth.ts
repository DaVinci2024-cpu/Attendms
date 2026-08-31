import { initializeApp, deleteApp } from "firebase/app";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signOut,
  type Auth,
} from "firebase/auth";
import { getFirebaseApp } from "./firebase";

let authInstance: Auth | null = null;

/**
 * Single admin account, no public self-signup: the one admin user is
 * created directly in the Firebase console (Authentication -> Users -> Add
 * user), so there is no unauthenticated path that can mint an admin.
 */
export function getAuthClient(): Auth {
  if (!authInstance) {
    authInstance = getAuth(getFirebaseApp());
  }
  return authInstance;
}

/**
 * Creates a Firebase Auth account for an employee's portal login. Calling
 * `createUserWithEmailAndPassword` on the app's normal Auth instance would
 * sign the admin out and sign in as the new employee instead — the client
 * SDK always adopts whatever account it just created. To avoid that, this
 * spins up a throwaway *second* Firebase app instance (same project config,
 * different in-memory app name), creates the account there, signs it back
 * out, and tears the temporary app down — leaving the admin's own session
 * on the primary app untouched throughout.
 */
export async function createEmployeePortalAccount(
  email: string,
  temporaryPassword: string
): Promise<string> {
  const primary = getFirebaseApp();
  const secondary = initializeApp(primary.options, `portal-setup-${Date.now()}`);
  try {
    const secondaryAuth = getAuth(secondary);
    const credential = await createUserWithEmailAndPassword(
      secondaryAuth,
      email,
      temporaryPassword
    );
    const uid = credential.user.uid;
    await signOut(secondaryAuth);
    return uid;
  } finally {
    await deleteApp(secondary);
  }
}
