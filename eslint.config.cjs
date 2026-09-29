const js = require('@eslint/js')
const tseslint = require('@typescript-eslint/eslint-plugin')
const parser = require('@typescript-eslint/parser')
const globals = require('globals')

module.exports = [
    js.configs.recommended,
    {
        files: ['**/*.ts'],
        languageOptions: {
            parser,
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
                project: ['./tsconfig.json'],
            },
            globals: {
                ...globals.node,
            },
        },
        plugins: {
            '@typescript-eslint': tseslint,
        },
        rules: {
            // estilo
            'quotes': ['error', 'single'],
            'semi': ['error', 'never'],
            // 'indent': ['error', 2, { SwitchCase: 1 }],

            // typescript (TypeScript ya valida variables no definidas; las reglas base
            // no entienden tipos y dan falsos positivos en firmas de interfaces)
            'no-undef': 'off',
            'no-unused-vars': 'off',
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-unused-vars': ['warn'],
        },
    },
    {
        files: ['tests/**/*.ts'],
        languageOptions: {
            globals: {
                ...globals.node,
                ...globals.jest,
            },
        },
    },
]
