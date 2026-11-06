import { defineConfig } from 'vitest/config';
import { vitestPreset } from '@rules/config/vitest';

export default defineConfig({ test: { ...vitestPreset, environment: 'node' } });
