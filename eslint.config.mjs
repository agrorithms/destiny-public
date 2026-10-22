import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "dist/**",
    "next-env.d.ts",
    // Playwright output. Regenerated every run; never hand-edited.
    "test-results/**",
    "playwright-report/**",
    "blob-report/**",
    // Stryker's sandbox: a copy of the whole project, left behind when a mutate:diff run
    // crashes. Linting it reports the project's own files a second time, out of context.
    ".stryker-tmp/**",
  ]),
]);

export default eslintConfig;
