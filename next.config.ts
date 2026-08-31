import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every route in this app is a client component with no server-side data
  // needs (Firestore/Firebase Auth/face-api all run in the browser), so it
  // exports as a plain static site — no Next.js server or serverless
  // functions required to host it.
  output: "export",
};

export default nextConfig;
