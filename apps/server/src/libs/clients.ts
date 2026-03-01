/**
 * Shared singleton instances for external services.
 *
 * The @openstatus/tinybird and @openstatus/upstash packages have been removed.
 * Consumers that previously relied on `tb` or `redis` should migrate to
 * alternative implementations.  The stubs below prevent import errors while
 * that migration is in progress.
 */

// Tinybird client stub -- returns empty data for every method access
export const tb = new Proxy(
  {},
  {
    get(_target, _prop) {
      return (..._args: unknown[]) => Promise.resolve({ data: [] });
    },
  },
) as Record<string, (...args: unknown[]) => Promise<{ data: unknown[] }>>;

// Redis client stub -- backed by an in-memory Map so existing call-sites
// continue to work during the transition period.
const _store = new Map<string, { value: string; expiresAt?: number }>();

function isExpired(entry: { expiresAt?: number } | undefined): boolean {
  if (!entry) return true;
  if (entry.expiresAt && Date.now() > entry.expiresAt) return true;
  return false;
}

export const redis = {
  get<T = string>(key: string): Promise<T | null> {
    const entry = _store.get(key);
    if (!entry || isExpired(entry)) {
      _store.delete(key);
      return Promise.resolve(null);
    }
    try {
      return Promise.resolve(JSON.parse(entry.value) as T);
    } catch {
      return Promise.resolve(entry.value as unknown as T);
    }
  },
  set(
    key: string,
    value: unknown,
    opts?: { ex?: number },
  ): Promise<string> {
    const serialized =
      typeof value === "string" ? value : JSON.stringify(value);
    _store.set(key, {
      value: serialized,
      expiresAt: opts?.ex ? Date.now() + opts.ex * 1000 : undefined,
    });
    return Promise.resolve("OK");
  },
  del(key: string): Promise<number> {
    const existed = _store.has(key) ? 1 : 0;
    _store.delete(key);
    return Promise.resolve(existed);
  },
  getdel<T = string>(key: string): Promise<T | null> {
    const entry = _store.get(key);
    _store.delete(key);
    if (!entry || isExpired(entry)) return Promise.resolve(null);
    try {
      return Promise.resolve(JSON.parse(entry.value) as T);
    } catch {
      return Promise.resolve(entry.value as unknown as T);
    }
  },
  expire(key: string, seconds: number): Promise<number> {
    const entry = _store.get(key);
    if (!entry) return Promise.resolve(0);
    entry.expiresAt = Date.now() + seconds * 1000;
    return Promise.resolve(1);
  },
};
