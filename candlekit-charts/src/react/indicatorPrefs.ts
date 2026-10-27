/**
 * Shared, localStorage-backed indicator preferences (favorites + recents).
 *
 * A tiny external store so every view — the catalog modal and the quick panel —
 * stays in sync the instant one of them stars/uses an indicator. Consumed via
 * {@link useIndicatorPrefs} (built on React's useSyncExternalStore).
 */
import { useSyncExternalStore } from "react";

const FAV_KEY = "finchart.ind.favorites";
const RECENT_KEY = "finchart.ind.recents";
const RECENT_MAX = 8;

function load(key: string): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}
function persist(key: string, list: string[]): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(list));
  } catch {
    /* ignore quota / unavailable */
  }
}

// Reassigned (new array) on every change so useSyncExternalStore snapshots are stable.
let favorites: string[] = load(FAV_KEY);
let recents: string[] = load(RECENT_KEY);

const listeners = new Set<() => void>();
function emit(): void {
  for (const l of listeners) l();
}

export function subscribeIndicatorPrefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getFavorites(): string[] {
  return favorites;
}
export function getRecents(): string[] {
  return recents;
}
export function isFavorite(name: string): boolean {
  return favorites.includes(name);
}

export function toggleFavorite(name: string): void {
  favorites = favorites.includes(name) ? favorites.filter((n) => n !== name) : [...favorites, name];
  persist(FAV_KEY, favorites);
  emit();
}

export function pushRecent(name: string): void {
  recents = [name, ...recents.filter((n) => n !== name)].slice(0, RECENT_MAX);
  persist(RECENT_KEY, recents);
  emit();
}

export interface IndicatorPrefs {
  favorites: string[];
  recents: string[];
  isFavorite: (name: string) => boolean;
  toggleFavorite: (name: string) => void;
  pushRecent: (name: string) => void;
}

/** Subscribe a component to the shared favorites/recents store. */
export function useIndicatorPrefs(): IndicatorPrefs {
  const favs = useSyncExternalStore(subscribeIndicatorPrefs, getFavorites, getFavorites);
  const recent = useSyncExternalStore(subscribeIndicatorPrefs, getRecents, getRecents);
  return { favorites: favs, recents: recent, isFavorite, toggleFavorite, pushRecent };
}
