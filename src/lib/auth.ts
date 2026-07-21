import { getAuth, type Auth } from "firebase/auth";
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
