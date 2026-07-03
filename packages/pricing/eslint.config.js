import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['node_modules', 'coverage', 'eslint.config.js'] },
  ...tseslint.configs.recommended,
  prettier,
);
