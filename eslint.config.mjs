import micelio from '@micelio/eslint-config'

// The shared rules come from @micelio/eslint-config; what follows is only what is this repository's own.
export default [
  ...micelio,
  {
    ignores: [
      'src/plugins/*/dist/',
      '.strapi/',
      'public/uploads/',
      'database/',
      'data/',
      'types/generated/',
    ],
  },
  {
    files: ['**/*.ts', '**/*.js'],
    languageOptions: {
      globals: {
        strapi: 'readonly',
      },
    },
    rules: {
      // Strapi's config and plugin entry points are CommonJS.
      '@typescript-eslint/no-var-requires': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
]
