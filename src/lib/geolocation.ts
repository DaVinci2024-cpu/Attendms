// Browser geolocation + a light, passive device signal for the kiosk's
// punch-location feature. See PunchDevice in src/lib/types.ts for why
// device tracking stops at "notice it changed" rather than "prove it's
// the company's tablet" — that needs real kiosk pairing, not this.

export function requestPosition(options?: PositionOptions): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Geolocation is not supported on this device."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 15000,
      maximumAge: 60000,
      ...options,
    });
  });
}

// Standard great-circle distance between two lat/long points, in meters.
export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const EARTH_RADIUS_M = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const DEVICE_ID_STORAGE_KEY = "attendms_device_id";

// A random id generated once and kept in this browser's localStorage —
// not tied to hardware, just enough to notice "this employee's punches
// are suddenly coming from a browser we haven't seen before".
export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // Storage blocked (private browsing, etc.) — a fresh id every load
    // is still better than none for this one punch.
    return crypto.randomUUID();
  }
}

// A short, human-readable guess at the device/browser from the User-
// Agent string — coarse on purpose, just for a glance on the dashboard.
export function summarizeUserAgent(ua: string): string {
  let platform = "Unknown device";
  if (/iPad/i.test(ua)) platform = "iPad";
  else if (/iPhone/i.test(ua)) platform = "iPhone";
  else if (/Android/i.test(ua)) platform = "Android";
  else if (/Macintosh/i.test(ua)) platform = "Mac";
  else if (/Windows/i.test(ua)) platform = "Windows";
  else if (/Linux/i.test(ua)) platform = "Linux";

  let browser = "";
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/Chrome\//i.test(ua)) browser = "Chrome";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/Safari\//i.test(ua)) browser = "Safari";

  return browser ? `${platform} · ${browser}` : platform;
}
