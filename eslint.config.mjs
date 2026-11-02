import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Electron's main process is deliberately plain CommonJS (.cjs) so it
    // works regardless of this package's own "type" setting — require()
    // there is correct, not a violation of the app code's own import style.
    "electron/**",
    "release/**",
  ]),
]);

export default eslintConfig;
