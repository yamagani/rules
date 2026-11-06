import { describe, expect, it } from 'vitest';
import { componentNames, componentSchemas, validateScreenSpec } from './catalog';
import { propFixtures } from './fixtures';

describe('catalog component schemas', () => {
  it('has a fixture for every component', () => {
    expect(Object.keys(propFixtures).sort()).toEqual([...componentNames].sort());
  });

  it.each(componentNames)('%s accepts its valid fixture and rejects the invalid one', (name) => {
    const schema = componentSchemas[name].props;
    const valid = schema.safeParse(propFixtures[name].valid);
    expect(valid.success, JSON.stringify(valid.error?.issues)).toBe(true);
    expect(schema.safeParse(propFixtures[name].invalid).success).toBe(false);
  });
});

describe('validateScreenSpec', () => {
  const page = { type: 'Page', props: { title: 'Rules' }, children: ['b'] };
  const button = { type: 'Button', props: { label: 'Go' }, children: [], on: { press: { action: 'refresh', params: {} } } };

  it('accepts a valid spec and keeps action bindings', () => {
    const res = validateScreenSpec({ root: 'p', elements: { p: page, b: button } });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect((res.spec.elements.b as { on?: unknown }).on).toBeDefined();
      expect(res.spec.elements.p?.props).toEqual({ title: 'Rules', breadcrumbs: [] }); // defaults applied
    }
  });

  it('reports bad props, unknown components, dangling children and unknown actions', () => {
    const issues = (spec: unknown) => {
      const r = validateScreenSpec(spec);
      return r.ok ? [] : r.issues.map((i) => i.path);
    };
    expect(issues({ root: 'p', elements: { p: { ...page, props: {} }, b: button } })).toContain('elements.p.props.title');
    expect(issues({ root: 'p', elements: { p: { ...page, children: ['missing'] } } })).toContain('elements.p.children');
    expect(issues({ root: 'p', elements: { p: page, b: { ...button, on: { press: { action: 'rm -rf' } } } } })).toContain('elements.b.on.press');
    expect(issues({ root: 'x', elements: { p: page, b: button } })).toContain('root');
    expect(validateScreenSpec({ root: 'p', elements: { p: { type: 'Marquee', props: {}, children: [] } } }).ok).toBe(false);
  });
});
