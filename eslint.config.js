/**
 * ESLint Configuration (flat config)
 *
 * Type-aware linting is deliberately off: the Convex functions import from
 * `convex/_generated/`, which only exists after a deployment has been
 * provisioned, so a type-aware pass would fail on a fresh clone. `tsc --noEmit`
 * already covers types for everything else.
 */

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "convex/_generated/**", ".next/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        chrome: "readonly",
        // Injected by the build as the compiled overlay stylesheet
        __CLAPBOARD_CSS__: "readonly",
      },
    },
    rules: {
      // Matches tsconfig's noUnusedLocals/noUnusedParameters, which allow a
      // leading underscore to mark an argument as intentionally unused
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  }
);
