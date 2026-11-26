import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

// Narrow on purpose: only the two hooks rules run. The @typescript-eslint
// plugin is registered with no rules so existing `eslint-disable
// @typescript-eslint/*` comments resolve instead of erroring.
export default [
  { ignores: ["dist/**", "dev-dist/**", "node_modules/**"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { parser: tseslint.parser },
    linterOptions: { reportUnusedDisableDirectives: "off" },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
];
