import fs from 'fs';
import path from 'path';

// Plain CommonJS shared with metro.config.js.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { NATIVE_STUBS, nativeStubFor } = require('../../../metro/native-stubs') as {
  NATIVE_STUBS: Record<string, string>;
  nativeStubFor(moduleName: string, platform: string | null): string | undefined;
};

/** Packages that import the stubbed modules, and so decide which names a stub must export. */
const IMPORTERS: Record<string, string[]> = {
  '@revenuecat/purchases-js-hybrid-mappings': ['react-native-purchases'],
  '@sentry-internal/replay': ['@sentry/browser', '@sentry/react', '@sentry/react-native'],
  '@sentry-internal/replay-canvas': ['@sentry/browser', '@sentry/react', '@sentry/react-native'],
  '@sentry-internal/feedback': ['@sentry/browser', '@sentry/react', '@sentry/react-native'],
};

function jsFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : jsFiles(p);
    return /\.(c|m)?js$/.test(e.name) ? [p] : [];
  });
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/** Every name the package's built files import from `moduleName` (ESM and CommonJS forms). */
function importedNames(pkg: string, moduleName: string): Set<string> {
  const root = path.dirname(require.resolve(`${pkg}/package.json`, { paths: [__dirname] }));
  const m = escape(moduleName);
  const named = new RegExp(`(?:import|export)\\s*\\{([^}]*)\\}\\s*from\\s*['"]${m}['"]`, 'g');
  const cjsVar = new RegExp(`(\\w+)\\s*=\\s*require\\(['"]${m}['"]\\)`, 'g');
  const names = new Set<string>();
  for (const file of jsFiles(root)) {
    const src = fs.readFileSync(file, 'utf8');
    if (!src.includes(moduleName)) continue;
    for (const match of src.matchAll(named)) {
      for (const part of (match[1] ?? '').split(',')) {
        const name = part
          .trim()
          .split(/\s+as\s+/)[0]
          ?.trim();
        if (name) names.add(name);
      }
    }
    for (const match of src.matchAll(cjsVar)) {
      for (const use of src.matchAll(new RegExp(`\\b${match[1]}\\.(\\w+)`, 'g'))) {
        if (use[1]) names.add(use[1]);
      }
    }
  }
  return names;
}

describe('native bundle stubs (metro/native-stubs.js, docs/perf-s7.md)', () => {
  it('stubs the RevenueCat browser engine and Sentry replay and web feedback on native only', () => {
    expect(Object.keys(NATIVE_STUBS).sort()).toEqual(Object.keys(IMPORTERS).sort());
    for (const moduleName of Object.keys(NATIVE_STUBS)) {
      expect(nativeStubFor(moduleName, 'android')).toBe(NATIVE_STUBS[moduleName]);
      expect(nativeStubFor(moduleName, 'ios')).toBe(NATIVE_STUBS[moduleName]);
      expect(nativeStubFor(moduleName, 'web')).toBeUndefined();
    }
    expect(nativeStubFor('@sentry/react-native', 'android')).toBeUndefined();
  });

  it.each(Object.keys(IMPORTERS))('exports every name the dependencies import from %s', (mod) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const stub = require(NATIVE_STUBS[mod] as string) as Record<string, unknown>;
    const needed = new Set<string>();
    for (const pkg of IMPORTERS[mod] ?? []) for (const n of importedNames(pkg, mod)) needed.add(n);
    expect(needed.size).toBeGreaterThan(0);
    const missing = [...needed].filter((n) => n !== 'default' && !(n in stub));
    expect(missing).toEqual([]);
  });

  it('fails loudly if replay or feedback is ever enabled without removing the stub', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const stub = require(NATIVE_STUBS['@sentry-internal/replay'] as string) as Record<
      string,
      () => unknown
    >;
    expect(() => stub.replayIntegration?.()).toThrow(/not bundled in native builds/);
    expect(() => stub.buildFeedbackIntegration?.()).toThrow(/not bundled in native builds/);
    expect(stub.getReplay?.()).toBeUndefined();
  });

  it('is not used by the app: Sentry starts with the navigation integration only', () => {
    const init = fs.readFileSync(path.join(__dirname, '../sentry/init.ts'), 'utf8');
    expect(init).not.toMatch(/replay|feedback/i);
  });
});
