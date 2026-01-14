import globals from 'globals';

export default [
  {
    ignores: ['node_modules/**', 'coverage/**'],
  },
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'off', // Server uses console for logging
      'prefer-const': 'error',
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'no-throw-literal': 'error',
      'no-return-await': 'error',
      'require-await': 'error',
    },
  },
];
