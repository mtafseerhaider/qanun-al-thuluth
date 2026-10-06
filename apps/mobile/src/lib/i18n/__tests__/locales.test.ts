import { resources } from '../resources';

type Tree = { [key: string]: string | Tree };

function keyPaths(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string' ? [path] : keyPaths(value, path);
  });
}

function placeholders(tree: Tree): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const walk = (t: Tree, prefix: string) => {
    for (const [k, v] of Object.entries(t)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (typeof v === 'string')
        out[path] = (v.match(/{{\s*\w+\s*}}/g) ?? []).map((p) => p.replace(/\s/g, '')).sort();
      else walk(v, path);
    }
  };
  walk(tree, '');
  return out;
}

describe('locale resources', () => {
  const en = resources.en as unknown as Record<string, Tree>;
  const ur = resources.ur as unknown as Record<string, Tree>;

  it('has the same namespaces in en and ur', () => {
    expect(Object.keys(ur).sort()).toEqual(Object.keys(en).sort());
  });

  it.each(Object.keys(resources.en))('has identical key sets in en and ur for %s', (ns) => {
    expect(keyPaths(ur[ns] as Tree).sort()).toEqual(keyPaths(en[ns] as Tree).sort());
  });

  it.each(Object.keys(resources.en))('keeps the same interpolation placeholders in %s', (ns) => {
    expect(placeholders(ur[ns] as Tree)).toEqual(placeholders(en[ns] as Tree));
  });

  it('has no empty strings', () => {
    for (const locale of [en, ur]) {
      for (const tree of Object.values(locale)) {
        const walk = (t: Tree) =>
          Object.values(t).forEach((v) =>
            typeof v === 'string' ? expect(v.trim()).not.toBe('') : walk(v),
          );
        walk(tree);
      }
    }
  });
});
