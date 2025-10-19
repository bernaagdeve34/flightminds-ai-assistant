type Entry<T> = { data: T; ts: number };
const store = new Map<string, Entry<unknown>>();

export function setCache<T>(key: string, data: T): void {
  store.set(key, { data, ts: Date.now() });
}

export function getCache<T>(key: string, maxAgeMs?: number): { data: T; ts: number } | null {
  const v = store.get(key) as Entry<T> | undefined;
  if (!v) return null;
  if (maxAgeMs && Date.now() - v.ts > maxAgeMs) return null;
  return { data: v.data, ts: v.ts };
}
