# Attendms

Biometric attendance PWA — Phase 0 single-tenant prototype.

Built per the technical spec: face detection + matching runs entirely
client-side (`@vladmandic/face-api`), every punch also requires the matched
employee's PIN, and attendance data is meant to keep working with no
network connection once the app and its models have loaded once.

This is the **Phase 0** slice: one hardcoded demo company, no admin auth,
no kiosk pairing. Multi-tenant hardening, kiosk pairing, and PWA/service
worker packaging are later phases (see the spec's Section 6).

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a Firebase project (or reuse one), add a Web app to it, and copy
   its config into `.env.local`:

   ```bash
   cp .env.local.example .env.local
   # then fill in the NEXT_PUBLIC_FIREBASE_* values from
   # Firebase console -> Project settings -> General -> Your apps
   ```

   Enable **Firestore** in the Firebase console (any mode — this prototype
   does not yet enforce security rules; see "Known gaps" below).

3. Face recognition models are already vendored into `public/models`
   (copied from the `@vladmandic/face-api` npm package: SSD Mobilenet
   detector, 68-point landmarks, and the 128-d recognition net — see
   `src/lib/faceApi.ts`). No separate download step is needed.

4. Run the dev server:

   ```bash
   npm run dev
   ```

   Open <http://localhost:3000>. Camera access requires either
   `localhost` or HTTPS.

## Using the prototype

- **`/enroll`** — capture 1-3 face snapshots for a new employee, set their
  PIN, record consent, and save. Only the extracted numeric embeddings and
  the consent record are stored; captured video frames never leave the
  browser and are never persisted.
- **`/kiosk`** — continuously scans for a face, matches it against the
  cached employee descriptors (Euclidean distance, threshold in
  `src/lib/constants.ts`), then requires the matched employee's PIN before
  logging a punch. Punch direction (in vs. out) is derived from that
  employee's most recent locally-cached attendance record, so it stays
  correct even fully offline. A wrong PIN after a face match counts as an
  attempt; too many attempts logs a suspicious event instead of retrying
  forever. A successful punch debounces that employee for ~5 seconds.

## Project structure

- `src/lib/types.ts` — Firestore schema types (`Employee`, `AttendanceLog`,
  `SuspiciousEvent`, ...).
- `src/lib/firebase.ts` — Firestore initialized with IndexedDB-backed
  offline persistence.
- `src/lib/firestoreRepo.ts` — reads/writes against the demo company's
  subcollections.
- `src/lib/faceApi.ts` — loads face-api models and runs detection.
- `src/lib/faceMatching.ts` — Euclidean distance + best-match selection.
- `src/lib/punchLogic.ts` — derives punch_in/punch_out from local cache.

## Known gaps (by design, for this phase)

- No Firebase Auth / admin login, no multi-tenant `companyId` isolation,
  no Firestore security rules, no kiosk pairing flow, no PWA manifest or
  service worker, no PIN hashing. These are explicitly Phase 1-2 work per
  the spec and are out of scope for this single-tenant prototype.
