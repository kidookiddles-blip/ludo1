import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

const globals = {
  console: "readonly",
  crypto: "readonly",
  document: "readonly",
  AudioContext: "readonly",
  Element: "readonly",
  localStorage: "readonly",
  navigator: "readonly",
  OscillatorType: "readonly",
  performance: "readonly",
  PointerEvent: "readonly",
  process: "readonly",
  setInterval: "readonly",
  window: "readonly"
};

export default [
  {
    ignores: ["dist/**", "node_modules/**"]
  },
  js.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module"
      },
      globals
    },
    plugins: {
      "@typescript-eslint": tseslint
    },
    rules: {
      ...tseslint.configs.recommended.rules
    }
  },
  {
    files: ["**/*.{js,cjs,mjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        console: "readonly",
        module: "readonly",
        process: "readonly"
      }
    }
  }
];
