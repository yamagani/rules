/**
 * Singletons shared between the shell and every remote. Keep this file identical across
 * apps/web/* (CI checks it). React and the json-render runtime must be single instances so
 * hooks and contexts work across federated modules.
 */
const singleton = { singleton: true };

export const sharedDeps = {
  react: { singleton: true, requiredVersion: '^19.2.3' },
  'react-dom': { singleton: true, requiredVersion: '^19.2.3' },
  'react-dom/client': { singleton: true, requiredVersion: '^19.2.3' },
  // Evaluated at module load by @json-render/react/schema and the catalog: must be eager.
  '@json-render/core': { singleton: true, eager: true },
  '@json-render/react': singleton,
  '@rules/ui-registry/catalog': singleton,
  '@rules/ui-registry/react': singleton,
  '@rules/ui-registry/host': singleton,
  '@rules/sdui-runtime': singleton,
  '@rules/auth': singleton,
  '@rules/auth/react': singleton,
};
