import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

/**
 * Rule 2 — layer separation is lint-enforced, not documented.
 *
 * `src/game/**` is the pure simulation. It may not reach for React, Three.js,
 * or the DOM. That restriction is what makes the whole simulation unit-testable
 * in plain Node, and it is the structural guarantee behind the no-re-render
 * invariant (§17.2, §30.2, §37.6).
 */
const GAME_LAYER_FORBIDDEN = [
  { name: 'react', message: 'src/game/** is the pure simulation layer (gameplan §30.2). No React.' },
  { name: 'react-dom', message: 'src/game/** is the pure simulation layer (gameplan §30.2). No React.' },
  { name: 'three', message: 'src/game/** may not import three (gameplan §30.2). Use src/game/math/vec3.ts.' },
  { name: 'zustand', message: 'src/game/** must not know about UI state (gameplan §30.2, §32.1).' },
  { name: 'gsap', message: 'GSAP animates DOM only and never the simulation (gameplan §25.3).' },
]

const GAME_LAYER_FORBIDDEN_PATTERNS = [
  { group: ['three/*', 'three/**'], message: 'src/game/** may not import three (gameplan §30.2).' },
  { group: ['@react-three/*', '@react-three/**'], message: 'src/game/** may not import R3F (gameplan §30.2).' },
  { group: ['@/render/*', '@/render/**', '../render/*', '**/render/**'], message: 'The simulation may not depend on the render layer (gameplan §30.2).' },
  { group: ['@/ui/*', '@/ui/**', '../ui/*', '**/ui/**'], message: 'The simulation may not depend on the UI layer (gameplan §30.2).' },
  { group: ['@/state/*', '@/state/**', '**/state/**'], message: 'The simulation may not depend on zustand stores (gameplan §32.1).' },
  // Web Audio is a DOM API, so the audio layer sits beside render/ and ui/
  // rather than inside game/systems/ where §30.1's file listing places it.
  // §30.2 wins because it is the enforceable rule; this makes that structural.
  { group: ['@/audio/*', '@/audio/**', '**/audio/**'], message: 'The simulation may not depend on the audio layer (gameplan §30.2).' },
]

export default tseslint.config(
  // `docs/reference/` is an archived copy of the UI Builder output, kept as a
  // visual reference for the port. It is not shipped and is not held to the
  // project's rules.
  { ignores: ['dist', 'coverage', 'node_modules', 'docs/**', '*.timestamp-*', 'tools/**/*.mjs'] },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['eslint.config.js'] },
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.browser, ...globals.es2022 },
    },
    rules: {
      /* Rule 7 — no `any`, no non-null assertions, no ts-ignore. */
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-ignore': true, 'ts-expect-error': 'allow-with-description' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],

      /* Rule 10 — no console in production code; use the dev logger. */
      'no-console': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
    },
  },

  /* The architectural invariant. */
  {
    files: ['src/game/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: GAME_LAYER_FORBIDDEN, patterns: GAME_LAYER_FORBIDDEN_PATTERNS }],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'src/game/** must run headless in Node (gameplan §30.2).' },
        { name: 'document', message: 'src/game/** must run headless in Node (gameplan §30.2).' },
        { name: 'navigator', message: 'src/game/** must run headless in Node (gameplan §30.2).' },
        { name: 'requestAnimationFrame', message: 'The simulation is driven by an injected dt, never by rAF (gameplan §18.2, Rule 5).' },
        { name: 'performance', message: 'Rule 5 — nothing in src/game/ may read wall-clock time.' },
      ],
      /* Rule 5 — fixed timestep, always. Nothing in game/ reads the clock. */
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: 'Rule 5 — the simulation may not read wall-clock time.' },
        { object: 'Math', property: 'random', message: 'Use the seeded PRNG in game/core/Random.ts (gameplan §10.4).' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'Rule 5 — the simulation may not read wall-clock time.',
        },
      ],
    },
  },

  /* The render layer may read simulation state but never mutate it. */
  {
    files: ['src/render/**/*.{ts,tsx}', 'src/ui/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/game/systems/*', '@/game/systems/**'],
              message: 'Presentation layers read the World, they do not run systems (gameplan §30.2).',
            },
          ],
        },
      ],
    },
  },

  /* Tests and tooling get a longer leash. */
  {
    // Tooling and tests share a relaxed profile: they run in Node, print to
    // stdout, and are not subject to the zero-allocation or layer-purity rules
    // that govern `src/game/**`.
    files: ['tests/**/*.{ts,tsx}', 'tools/**/*.ts', '*.config.{ts,js}', 'src/**/*.test.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
)
