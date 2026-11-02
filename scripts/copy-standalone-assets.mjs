// Next's "standalone" output traces server.js's own dependencies into
// .next/standalone/ but deliberately leaves out two things it doesn't
// consider "code": public/ and .next/static/. Without copying them in here,
// the standalone server starts fine but 404s on every asset and static file
// (icons, manifest.json, face-api's /models/*, _next/static/* JS chunks).
// Run after every `next build` — see package.json's "build" script.
import { cpSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const standaloneDir = join(root, ".next", "standalone");

if (!existsSync(standaloneDir)) {
  console.error(
    "copy-standalone-assets: .next/standalone not found — did `next build` run with output: \"standalone\" in next.config.ts?"
  );
  process.exit(1);
}

function copy(from, to) {
  if (!existsSync(from)) return;
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
}

copy(join(root, "public"), join(standaloneDir, "public"));
copy(join(root, ".next", "static"), join(standaloneDir, ".next", "static"));

console.log("copy-standalone-assets: copied public/ and .next/static into .next/standalone/");
