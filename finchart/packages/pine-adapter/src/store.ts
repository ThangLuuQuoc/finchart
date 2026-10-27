/**
 * PineIndicatorStore — persists user-added Pine scripts and turns them into
 * candlekit `IndicatorDef`s (via {@link pineModuleToIndicatorDef}) for the
 * "My Pine scripts" group of the indicator menu (Phase 2).
 *
 * Both compilation and persistence are INJECTED so the store stays
 * environment-agnostic:
 *   - browser: pass a compile fn that does ts.transpile + Blob import, and a
 *     localStorage-backed `PineStorage`.
 *   - node/test: pass a compile fn using new Function(), and the default
 *     in-memory storage.
 *
 * The store never imports candlekit — `registerInto` accepts any object with a
 * structural `register(def)` method.
 */

import { pineModuleToIndicatorDef, type IndicatorDef, type PineModule, type AdapterOptions } from './index';

export interface PineScriptEntry {
  id: string;
  name: string;
  source: string;
}

/** Pluggable persistence. Browser passes a localStorage-backed implementation. */
export interface PineStorage {
  load(): PineScriptEntry[];
  save(entries: PineScriptEntry[]): void;
}

/** Compiles Pine source into a runnable module. Throws on parse/compile error. */
export type PineCompileFn = (source: string) => PineModule;

export interface AddResult {
  ok: boolean;
  entry?: PineScriptEntry;
  def?: IndicatorDef;
  error?: string;
}

export interface BuildResult {
  defs: IndicatorDef[];
  errors: Array<{ id: string; name: string; error: string }>;
}

/** Minimal structural registry (candlekit's IndicatorRegistry satisfies this). */
export interface RegistryLike {
  register(def: IndicatorDef): unknown;
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'pine';
}

/** Default in-memory storage (no persistence across reloads). */
export function memoryStorage(initial: PineScriptEntry[] = []): PineStorage {
  let entries = [...initial];
  return {
    load: () => [...entries],
    save: (next) => { entries = [...next]; },
  };
}

/** localStorage-backed storage for the browser. */
export function localStorageStorage(key = 'finchart.pine.scripts', ls: Storage = globalThis.localStorage): PineStorage {
  return {
    load() {
      try {
        const raw = ls.getItem(key);
        return raw ? (JSON.parse(raw) as PineScriptEntry[]) : [];
      } catch {
        return [];
      }
    },
    save(entries) {
      ls.setItem(key, JSON.stringify(entries));
    },
  };
}

export class PineIndicatorStore {
  private entries: PineScriptEntry[];

  constructor(
    private readonly compile: PineCompileFn,
    private readonly storage: PineStorage = memoryStorage(),
    private readonly adapterOpts: AdapterOptions = {},
  ) {
    this.entries = this.storage.load();
  }

  list(): PineScriptEntry[] {
    return [...this.entries];
  }

  has(id: string): boolean {
    return this.entries.some(e => e.id === id);
  }

  /** Compile + persist a new script. Returns the def on success, the error otherwise. */
  add(source: string, opts: { id?: string; name?: string } = {}): AddResult {
    let mod: PineModule;
    try {
      mod = this.compile(source);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    const name = opts.name ?? mod.meta?.name ?? 'Pine Indicator';
    const id = opts.id ?? this.uniqueId(slug(name));
    const entry: PineScriptEntry = { id, name, source };

    let def: IndicatorDef;
    try {
      def = pineModuleToIndicatorDef(mod, { ...this.adapterOpts, source: 'pine' });
    } catch (e) {
      return { ok: false, entry, error: e instanceof Error ? e.message : String(e) };
    }

    this.entries = [...this.entries.filter(x => x.id !== id), entry];
    this.storage.save(this.entries);
    return { ok: true, entry, def };
  }

  remove(id: string): void {
    this.entries = this.entries.filter(e => e.id !== id);
    this.storage.save(this.entries);
  }

  /** Compile every stored script into an IndicatorDef, collecting failures. */
  buildDefs(): BuildResult {
    const defs: IndicatorDef[] = [];
    const errors: BuildResult['errors'] = [];
    for (const e of this.entries) {
      try {
        const mod = this.compile(e.source);
        defs.push(pineModuleToIndicatorDef(mod, { ...this.adapterOpts, source: 'pine', title: e.name }));
      } catch (err) {
        errors.push({ id: e.id, name: e.name, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return { defs, errors };
  }

  /** Build + register all stored scripts into a candlekit-style registry. */
  registerInto(registry: RegistryLike): BuildResult {
    const result = this.buildDefs();
    for (const def of result.defs) registry.register(def);
    return result;
  }

  private uniqueId(base: string): string {
    if (!this.has(base)) return base;
    let i = 2;
    while (this.has(`${base}-${i}`)) i++;
    return `${base}-${i}`;
  }
}
