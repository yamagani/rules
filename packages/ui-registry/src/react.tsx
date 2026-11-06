/** React registry: maps every catalog component to its implementation. */
import { defineRegistry } from '@json-render/react';
import { catalog } from './catalog';
import * as generic from './components/generic';
import { ensureStyles } from './components/styles';
import * as domain from './domain';

ensureStyles();

// Actions are dispatched by @rules/sdui-runtime's ActionProvider handlers.
const noop = async () => {};

export const { registry } = defineRegistry(catalog, {
  components: { ...generic, ...domain },
  actions: { navigate: noop, submit: noop, refresh: noop, openModal: noop, closeModal: noop, toast: noop },
});

export { catalog, validateScreenSpec, componentSchemas, actionSchemas } from './catalog';
export { ActionError, HostProvider, useHost, type HostServices, type MfeName } from './host';
export { ensureStyles } from './components/styles';
