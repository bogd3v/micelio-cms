import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import jsdoc from 'eslint-plugin-jsdoc';
import tsdoc from 'eslint-plugin-tsdoc';

export default tseslint.config(
  {
    ignores: [
      'dist/',
      'build/',
      'node_modules/',
      '.tmp/',
      '.cache/',
      '.strapi/',
      'public/uploads/',
      'coverage/',
      'database/',
      'data/',
      'types/generated/',
    ],
  },
  tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    files: ['**/*.ts', '**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        strapi: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-var-requires': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.property.name=/^(then|catch|finally)$/]",
          message: 'No promise chains: use await with try/catch (AGENTS.md, Async code).',
        },
      ],
    },
  },
  // TSDoc on exported declarations (standard, section 4, "Doc comments (TSDoc)").
  // The jsdoc rule is a warning while the areas get their comments (bogd3v/micelio-cms#116);
  // each area listed in the last block is already complete and fails on a missing one.
  {
    files: ['src/**/*.ts'],
    ignores: ['**/*.d.ts'],
    plugins: { tsdoc, jsdoc },
    rules: {
      'tsdoc/syntax': 'error',
      'jsdoc/require-jsdoc': [
        'warn',
        {
          publicOnly: true,
          require: { FunctionDeclaration: true, ClassDeclaration: true },
          contexts: [
            'ExportNamedDeclaration > TSInterfaceDeclaration',
            'ExportNamedDeclaration > TSTypeAliasDeclaration',
            'ExportNamedDeclaration > TSEnumDeclaration',
            'ExportNamedDeclaration > VariableDeclaration',
          ],
        },
      ],
    },
  },
  {
    files: ['src/extensions/**/*.ts', 'src/middlewares/**/*.ts'],
    rules: {
      'jsdoc/require-jsdoc': [
        'error',
        {
          publicOnly: true,
          require: { FunctionDeclaration: true, ClassDeclaration: true },
          contexts: [
            'ExportNamedDeclaration > TSInterfaceDeclaration',
            'ExportNamedDeclaration > TSTypeAliasDeclaration',
            'ExportNamedDeclaration > TSEnumDeclaration',
            'ExportNamedDeclaration > VariableDeclaration',
          ],
        },
      ],
    },
  }
);
