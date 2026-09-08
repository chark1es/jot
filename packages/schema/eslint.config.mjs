import root from "../../eslint.config.mjs";

export default [
  {
    ignores: [
      "eslint.config.mjs",
      "vitest.config.mjs",
      "generated/**",
      "dist/**",
      "fixtures/**",
      "native-tests/**",
    ],
  },
  ...root,
];
