import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
export default [
 {ignores:['**/node_modules/**','**/dist/**','**/.next/**','.runtime/**','**/next-env.d.ts']},
 {files:['**/*.{js,mjs,ts,tsx}'],languageOptions:{globals:{...globals.node,...globals.browser}},rules:{...js.configs.recommended.rules,'no-unused-vars':['error',{args:'none',caughtErrors:'none'}],'no-eval':'error','no-implied-eval':'error','no-new-func':'error'}},
 {files:['**/*.{ts,tsx}'],languageOptions:{parser:tseslint.parser,parserOptions:{ecmaFeatures:{jsx:true}}},rules:{'no-unused-vars':'off','no-undef':'off'}},
];
