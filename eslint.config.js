import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Each application builds into its own apps/<app>/dist; 'dist' alone would only match a
  // root-level directory left over from before the storefront/admin/seller split.
  globalIgnores(['**/dist']),

  // Frontend: React in the browser. Covers all three applications plus the shared package —
  // before the split this was a bare 'src/**', which after the move matched nothing at all and
  // silently stopped linting every frontend file in the repository.
  {
    files: ['apps/*/src/**/*.{js,jsx}', 'packages/*/src/**/*.{js,jsx}', 'apps/*/vite.config.js'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },

  // Each application's session file pairs its provider component with its `use*Session` hook —
  // the standard React context shape, and deliberately one file per application so the admin and
  // seller sessions never share a module. Fast refresh flags the hook only because it is a
  // non-component export; splitting it out would add a file per app to satisfy a dev-ergonomics
  // rule. The rule stays on for every other export in these files.
  {
    files: ['apps/*/src/*Session.jsx'],
    rules: {
      'react-refresh/only-export-components': [
        'error',
        { allowExportNames: ['useAdminSession', 'useSellerSession'] },
      ],
    },
  },

  // Backend and build scripts: Node, no React, no browser globals.
  {
    files: ['server/**/*.js', 'scripts/**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.node,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      // Express error middleware must keep its 4-arg signature even when `next` is unused.
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
])
