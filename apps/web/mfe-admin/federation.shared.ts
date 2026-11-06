/** Singletons shared between the shell and every remote. Keep in sync across apps/web/*. */
export const sharedDeps = {
  react: { singleton: true, requiredVersion: '^19.2.3' },
  'react-dom': { singleton: true, requiredVersion: '^19.2.3' },
};
