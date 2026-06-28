import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules', '.verify-logs'] },

  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    extends: [js.configs.recommended],
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  // Node CLI scripts (the verifier harness, certify, livelock-guard, data-generate).
  // Plain-JS files don't get typescript-eslint's no-undef relaxation, so declare the
  // Node globals they rely on.
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        globalThis: 'readonly',
      },
    },
  },

  {
    files: ['**/*.{ts,tsx}'],
    extends: [...tseslint.configs.recommended],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Documented, intentional disable (quality-gate-kit-vite-react §3): Context files
      // idiomatically export their Provider + matching hook together (DataSourceContext,
      // ScopeProvider), which this rule would otherwise flag. Fast-refresh ergonomics are
      // not worth splitting those co-located pairs.
      'react-refresh/only-export-components': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
    },
  },

  // eslint-config-prettier MUST come last: it turns off stylistic rules
  // that conflict with Prettier.
  prettier,
)
