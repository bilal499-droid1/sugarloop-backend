import js from '@eslint/js'
import globals from 'globals'

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Unused args are common in Express middleware signatures (notably the
      // four-arg error handler), so only flag them when they precede a used one.
      // ignoreRestSiblings allows the `const { omitted, ...rest } = obj` idiom, where
      // the named binding exists precisely so it can be left out of the rest.
      'no-unused-vars': [
        'error',
        { args: 'after-used', argsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      'no-console': 'off',
    },
  },
]
