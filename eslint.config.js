import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Domain packages hold the core model. They may import only relative modules
 * and other domain packages; third-party libraries belong in adapter packages
 * (see docs/adr/0009-module-boundaries.md).
 */
const DOMAIN_PACKAGES = ['doc-model', 'annotations', 'project', 'compile', 'api'];

export default defineConfig(
  { ignores: ['**/dist/**', '**/coverage/**'] },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    files: DOMAIN_PACKAGES.map((name) => `packages/${name}/src/**/*.ts`),
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: `^(?!\\.{1,2}/|@myleaf/(${DOMAIN_PACKAGES.join('|')})$)`,
              message:
                'Domain packages may import only relative modules and other domain packages. Put third-party integrations in an adapter package.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
  },
  prettier,
);
