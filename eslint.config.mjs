import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import boundaries from "eslint-plugin-boundaries";
import globals from "globals";
import tseslint from "typescript-eslint";
import tokensEslintPlugin from "./packages/tokens/eslint-plugin.mjs";

const platformAgnostic = [
  "schema",
  "tokens",
  "storage",
  "crypto",
  "local-store",
  "change-wakeup",
  "core",
  "sync",
  "test-kit",
];

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/generated/**",
      "**/node_modules/**",
      "**/ios/**",
      "**/android/**",
      "**/src-tauri/target/**",
      "**/target/**",
      "**/.expo/**",
      "**/.turbo/**",
      "**/vitest.config.ts",
      "**/eslint-plugin.mjs",
      "eslint.config.mjs",
      "**/metro.config.cjs",
      "**/metro-shims/**",
      "apps/editor-lab/benchmarks/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  prettier,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { tokens: tokensEslintPlugin },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "all", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "tokens/no-raw-design-values": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSTypeReference[typeName.name='any']",
          message: "Committed TypeScript cannot contain any.",
        },
      ],
    },
  },
  {
    files: ["packages/{schema,tokens,storage,crypto,local-store,change-wakeup,core,sync,test-kit}/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "window", message: "DOM globals cannot enter platform-agnostic packages." },
        { name: "document", message: "DOM globals cannot enter platform-agnostic packages." },
        { name: "navigator", message: "DOM globals cannot enter platform-agnostic packages." },
        { name: "HTMLElement", message: "DOM globals cannot enter platform-agnostic packages." },
      ],
    },
  },
  {
    files: ["packages/**/*.{ts,tsx}", "apps/**/*.{ts,tsx}", "services/**/*.{ts,tsx}"],
    plugins: { boundaries },
    settings: {
      "boundaries/elements": [
        { type: "schema", pattern: "packages/schema/*" },
        { type: "tokens", pattern: "packages/tokens/*" },
        { type: "storage", pattern: "packages/storage/*" },
        { type: "crypto", pattern: "packages/crypto/*" },
        { type: "local-store", pattern: "packages/local-store/*" },
        { type: "change-wakeup", pattern: "packages/change-wakeup/*" },
        { type: "core", pattern: "packages/core/*" },
        { type: "sync", pattern: "packages/sync/*" },
        { type: "test-kit", pattern: "packages/test-kit/*" },
        { type: "editor-native", pattern: "packages/editor-native/*" },
        { type: "editor-web", pattern: "packages/editor-web/*" },
        { type: "storage-google-drive", pattern: "packages/storage-google-drive/*" },
        { type: "change-wakeup-relay", pattern: "packages/change-wakeup-relay/*" },
        { type: "crypto-native", pattern: "packages/crypto-native/*" },
        { type: "crypto-tauri", pattern: "packages/crypto-tauri/*" },
        { type: "local-store-expo", pattern: "packages/local-store-expo/*" },
        { type: "local-store-tauri", pattern: "packages/local-store-tauri/*" },
        { type: "ui-mobile", pattern: "packages/ui-mobile/*" },
        { type: "ui-desktop", pattern: "packages/ui-desktop/*" },
        { type: "import-export", pattern: "packages/import-export/*" },
        { type: "relay", pattern: "services/relay/*" },
        { type: "app-mobile", pattern: "apps/mobile/*" },
        { type: "app-desktop", pattern: "apps/desktop/*" },
        { type: "app-editor-lab", pattern: "apps/editor-lab/*" },
      ],
      "boundaries/ignore": ["**/*.test.ts", "**/*.test.tsx"],
    },
    rules: {
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          rules: [
            { from: { type: "schema" }, allow: [] },
            { from: { type: "tokens" }, allow: [] },
            { from: { type: "storage" }, allow: [] },
            { from: { type: "crypto" }, allow: [] },
            { from: { type: "local-store" }, allow: ["schema"] },
            { from: { type: "change-wakeup" }, allow: [] },
            {
              from: { type: "core" },
              allow: ["schema", "tokens", "storage", "crypto", "local-store", "change-wakeup"],
            },
            {
              from: { type: "sync" },
              allow: ["core", "schema", "storage", "crypto", "local-store"],
            },
            {
              from: { type: "test-kit" },
              allow: platformAgnostic,
            },
            { from: { type: "editor-native" }, allow: ["schema"] },
            { from: { type: "editor-web" }, allow: ["schema"] },
            { from: { type: "storage-google-drive" }, allow: ["storage", "change-wakeup"] },
            { from: { type: "change-wakeup-relay" }, allow: ["change-wakeup"] },
            { from: { type: "crypto-native" }, allow: ["crypto"] },
            { from: { type: "crypto-tauri" }, allow: ["crypto"] },
            { from: { type: "local-store-expo" }, allow: ["local-store", "schema"] },
            { from: { type: "local-store-tauri" }, allow: ["local-store", "schema"] },
            { from: { type: "ui-mobile" }, allow: ["tokens"] },
            { from: { type: "ui-desktop" }, allow: ["tokens"] },
            { from: { type: "import-export" }, allow: ["schema", "core"] },
            { from: { type: "relay" }, allow: ["change-wakeup"] },
            {
              from: { type: "app-mobile" },
              allow: [
                "schema",
                "tokens",
                "core",
                "sync",
                "storage",
                "crypto",
                "local-store",
                "change-wakeup",
                "editor-native",
                "crypto-native",
                "local-store-expo",
                "ui-mobile",
                "storage-google-drive",
                "change-wakeup-relay",
                "import-export",
              ],
            },
            {
              from: { type: "app-desktop" },
              allow: [
                "schema",
                "tokens",
                "core",
                "sync",
                "storage",
                "crypto",
                "local-store",
                "change-wakeup",
                "editor-web",
                "crypto-tauri",
                "local-store-tauri",
                "ui-desktop",
                "storage-google-drive",
                "change-wakeup-relay",
                "import-export",
              ],
            },
    {
      from: { type: "app-editor-lab" },
      allow: ["schema", "tokens", "core", "editor-native", "ui-mobile", "test-kit"],
    },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/vitest.config.ts", "scripts/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "tokens/no-raw-design-values": "off",
    },
  },
);
