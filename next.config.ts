import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This branch targets the Electron desktop build (see electron/main.cjs),
  // where the app runs behind its own local Node server rather than being
  // hosted as a prerendered static site — that server is what lets Phase 2+
  // add real API routes (firebase-admin, LAN sync) that a static export can
  // never have. The Netlify-hosted PWA keeps using static export on its own
  // branch; this one intentionally diverges.
  //
  // "standalone" (not the server-mode default) so the production build
  // traces its own dependencies into .next/standalone/server.js plus a
  // pruned node_modules — a single self-contained folder Electron can spawn
  // directly, the same "ship dist/, no project node_modules at runtime"
  // shape as retailrp's esbuild-bundled server.cjs. scripts/copy-standalone-assets.mjs
  // copies public/ and .next/static into it after every build, matching the
  // steps Next's own docs call out as the standalone output's two gaps.
  output: "standalone",
};

export default nextConfig;
