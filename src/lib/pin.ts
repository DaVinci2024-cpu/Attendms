// PINs are hashed client-side (no backend exists yet to do it server-side —
// see spec Section 7) using PBKDF2-SHA256 via the browser's built-in Web
// Crypto API, so no plaintext PIN is ever written to Firestore. This
// protects against a Firestore data dump handing out usable PINs directly;
// it does not change the kiosk's need to read employee records
// unauthenticated (see the data-exfiltration tradeoff in firestore.rules).

const PBKDF2_ITERATIONS = 100_000;
const HASH_BITS = 256;

// Fixed at exactly 6 digits everywhere a PIN is set (enrollment, and an
// admin resetting one from /admin/employees) — the kiosk's PIN-only mode
// identifies who's punching by checking the typed PIN against every
// active employee's hash, so keeping the search space at its full
// 1,000,000 codes (vs. 10,000 at 4 digits) matters more than it used to.
export const PIN_PATTERN = /^\d{6}$/;

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

async function derive(pin: string, salt: Uint8Array): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    HASH_BITS
  );
  return toHex(bits);
}

export async function hashPin(
  pin: string
): Promise<{ pinHash: string; pinSalt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const pinHash = await derive(pin, salt);
  return { pinHash, pinSalt: toHex(salt.buffer) };
}

export async function verifyPin(
  pin: string,
  pinSalt: string,
  pinHash: string
): Promise<boolean> {
  const candidate = await derive(pin, fromHex(pinSalt));
  return candidate === pinHash;
}

// Finds whichever of `people` this PIN belongs to, by checking it against
// each of their stored hashes in parallel (each person has their own
// salt, so this can't be short-circuited into a single comparison the
// way a normal password lookup could). Used both to auto-detect who's
// punching from PIN alone (kiosk), and to reject a PIN at enrollment
// that's already in use by someone else — see the PIN-uniqueness note in
// src/app/enroll/page.tsx.
export async function findByPin<T extends { pinSalt: string; pinHash: string }>(
  pin: string,
  people: T[]
): Promise<T | null> {
  const matches: (T | null)[] = await Promise.all(
    people.map(async (person): Promise<T | null> =>
      (await verifyPin(pin, person.pinSalt, person.pinHash)) ? person : null
    )
  );
  return matches.find((person) => person !== null) ?? null;
}
