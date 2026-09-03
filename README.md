# Attendms

Biometric attendance PWA for one real company (single-tenant — not a
multi-company SaaS yet).

Face detection + matching runs entirely client-side
(`@vladmandic/face-api`), every punch also requires the matched employee's
PIN, and attendance data keeps working with no network connection once the
app and its models have loaded once.

## Setup (production use, real employees)

### 1. Install dependencies

```bash
npm install
```

### 2. Create a real Firebase project

1. Go to <https://console.firebase.google.com>, sign in, click **Add
   project**, and create one for your company.
2. On the project's home screen, click the **`</>`** (web) icon to register
   a web app. Copy the config values shown (`apiKey`, `authDomain`, etc.)
   — you'll need them in step 4.
3. In the left sidebar: **Build -> Firestore Database -> Create database**.
   Any region; start mode doesn't matter, since you'll replace the rules in
   step 5 anyway.
4. In the left sidebar: **Build -> Authentication -> Get started -> enable
   the "Email/Password" sign-in provider.**
5. Still in **Authentication**, go to the **Users** tab and click **Add
   user**. Create exactly one user: your real admin email and a strong
   password. This is the *only* way an admin account gets created — there
   is no signup page in the app, on purpose, so nobody else can mint an
   admin for your company.

### 3. Lock down Firestore with real security rules

In the Firebase console: **Firestore Database -> Rules**, replace
everything with the contents of [`firestore.rules`](./firestore.rules) in
this repo, then click **Publish**.

Read the comments at the top of that file — it explains the one
intentional tradeoff (employee face descriptors have to stay readable
without login so the kiosk can work offline) and why physical security of
the kiosk tablet matters as a result.

### 4. Configure your environment

```bash
cp .env.local.example .env.local
```

Fill in:
- The `NEXT_PUBLIC_FIREBASE_*` values from step 2.
- `NEXT_PUBLIC_COMPANY_ID` — any short id with no spaces, e.g. `acme_ltd`.
- `NEXT_PUBLIC_COMPANY_NAME` — your real company name.
- `NEXT_PUBLIC_ADMIN_EMAIL` — the admin email you created in step 2.5.
- `NEXT_PUBLIC_KIOSK_ID` — leave the default unless you're running more
  than one physical kiosk.

Face recognition models are already vendored into `public/models` (copied
from the `@vladmandic/face-api` npm package: Tiny Face Detector, its
matching tiny 68-point landmark net, and the 128-d recognition net —
chosen for real-time performance on modest kiosk hardware over the
heavier SSD Mobilenet detector). No separate download step is needed.

### 5. Run it

```bash
npm run dev
```

Open <http://localhost:3000>. Camera access requires either `localhost` or
HTTPS — for a real deployed kiosk tablet, that means deploying this behind
HTTPS (e.g. Vercel, or any host with a TLS certificate).

## Using it

- **`/enroll`** — admin-only (sign in with the account from setup step
  2.5). Set a new employee's name and 6-digit PIN, and save. Capturing
  1-3 face snapshots is optional (defaults to on/off based on whether
  facial recognition is currently enabled for the kiosk, see below) —
  an employee can always punch in with just their PIN either way. Only
  the extracted numeric embeddings and a PBKDF2 hash of the PIN are
  stored; raw video frames and the plaintext PIN never leave the
  browser.
- **`/admin/employees`** — admin-only. Lists enrolled employees and lets
  you delete an employee's descriptors + consent record entirely (not just
  mark them inactive) — this is the deletion path required for the
  biometric-data consent given at enrollment.
- **`/kiosk`** — no login. Continuously scans for a face, matches it
  against the cached employee descriptors (Euclidean distance, threshold
  in `src/lib/constants.ts`), then requires the matched employee's PIN
  before logging a punch. Punch direction (in vs. out) is derived from
  that employee's most recent locally-cached attendance record, so it
  stays correct even fully offline. A wrong PIN after a face match counts
  as an attempt; too many attempts logs a suspicious event instead of
  retrying forever. A successful punch debounces that employee for ~5
  seconds.

## Deploying to Netlify

Every route in this app is a client component with no server-side data
needs — Firestore, Firebase Auth, and face-api all run in the browser — so
it builds as a plain static site (`next.config.ts` sets `output: "export"`)
and needs no serverless functions to host.

1. Push this repo to GitHub (already done if you're reading this from the
   repo).
2. In the [Netlify dashboard](https://app.netlify.com), **Add new site ->
   Import an existing project**, pick this repo. Netlify should read
   `netlify.toml` automatically:
   - Build command: `npm run build`
   - Publish directory: `out`
3. Before the first deploy, add every variable from your `.env.local` under
   **Site configuration -> Environment variables** (the same
   `NEXT_PUBLIC_FIREBASE_*`, `NEXT_PUBLIC_COMPANY_*`,
   `NEXT_PUBLIC_ADMIN_EMAIL`, `NEXT_PUBLIC_KIOSK_ID` values) — the build
   needs them to produce a working site, and `.env.local` itself is never
   committed to the repo.
4. Deploy. Netlify gives you a `https://<something>.netlify.app` URL.
5. **Required extra step**: Firebase Auth only allows sign-in from domains
   you've explicitly authorized. In Firebase console -> Authentication ->
   Settings -> **Authorized domains**, add your new Netlify domain (and
   your custom domain too, if you attach one later). Skipping this makes
   admin/employee portal sign-in fail with an unauthorized-domain error —
   the kiosk's face+PIN punching still works fine either way, since it
   never signs in.
6. Camera access requires HTTPS, which Netlify provides by default, so the
   kiosk will work on the deployed URL without any extra TLS setup.

## Compliance note

The consent text shown at enrollment (`src/app/enroll/page.tsx`) is
written to align with the general principles of Uganda's Data Protection
and Privacy Act, 2019 (consent, purpose limitation, security, deletion
rights) — **it is not legal advice.** Have it reviewed against current
NITA-U / Personal Data Protection Office guidance before actually
onboarding employees, and revisit it if you ever operate in another
jurisdiction.

## Project structure

- `src/lib/types.ts` — Firestore schema types (`Employee`, `AttendanceLog`,
  `SuspiciousEvent`, ...).
- `src/lib/firebase.ts` / `src/lib/auth.ts` — Firestore (IndexedDB offline
  persistence) and Firebase Auth clients.
- `src/lib/firestoreRepo.ts` — reads/writes against your company's
  subcollections.
- `src/lib/pin.ts` — PBKDF2 PIN hashing/verification.
- `src/lib/faceApi.ts` — loads face-api models and runs detection.
- `src/lib/faceMatching.ts` — Euclidean distance + best-match selection.
- `src/lib/hours.ts` — pairs punch_in/punch_out into sessions with
  computed duration.
- `src/components/RequireAdmin.tsx` — gates every `/admin/*` page (and
  `/enroll`) behind Firebase Auth sign-in + admin membership.
- `public/sw.js` — hand-written service worker caching the app shell
  (hashed JS/CSS bundles, face-api model files) for offline loading.
- `firestore.rules` — the security rules to publish in the Firebase
  console.

## Known gaps (still out of scope)

- **Single company only** — no multi-tenant custom claims / company
  isolation. Fine for one company; would need real work to sell to more
  than one.
- **No kiosk pairing** — the kiosk has no credential of its own, it just
  relies on the Firestore rules above. A stolen/rooted tablet is a full
  dump of your employees' face descriptors — see the tradeoff note in
  `firestore.rules`. Physical security of the tablet matters.
- **No active liveness detection** — PIN is the only defense against a
  photo held up to the camera. A head-turn challenge-response check is
  planned but not yet built.
