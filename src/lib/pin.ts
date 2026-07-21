// PINs are hashed client-side (no backend exists yet to do it server-side —
// see spec Section 7) using PBKDF2-SHA256 via the browser's built-in Web
// Crypto API, so no plaintext PIN is ever written to Firestore. This
// protects against a Firestore data dump handing out usable PINs directly;
// it does not change the kiosk's need to read employee records
// unauthenticated (see the data-exfiltration tradeoff in firestore.rules).

const PBKDF2_ITERATIONS = 100_000;
const HASH_BITS = 256;

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
