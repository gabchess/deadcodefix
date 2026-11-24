import tseslint from "typescript-eslint";
export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      ".superpowers/**",
      "artifacts/**",
      ".agents/**",
      "web/**",
    ],
  },
  ...tseslint.configs.recommended,
);
