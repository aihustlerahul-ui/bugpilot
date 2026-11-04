import type { StorageAdapter } from './types';

/** Structural subset of expo-secure-store; the host passes the module in. */
export type SecureStoreLike = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};

export function createSecureStoreAdapter(secureStore: SecureStoreLike): StorageAdapter {
  return {
    getItem: (k) => secureStore.getItemAsync(k),
    setItem: (k, v) => secureStore.setItemAsync(k, v),
    removeItem: (k) => secureStore.deleteItemAsync(k),
  };
}

/**
 * Zero-config default: use expo-secure-store when the host app has it (the session
 * then survives restarts), otherwise keep the session in memory only.
 * The require is inside its own `try` so Metro treats it as an optional dependency.
 */
export function createDefaultStorage(): StorageAdapter {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-secure-store') as SecureStoreLike & { default?: SecureStoreLike };
    const store = mod.default ?? mod;
    if (typeof store.getItemAsync === 'function') return createSecureStoreAdapter(store);
  } catch {
    // expo-secure-store not installed
  }
  return createMemoryAdapter();
}

export function createMemoryAdapter(): StorageAdapter {
  const map = new Map<string, string>();
  return {
    getItem: async (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: async (k, v) => {
      map.set(k, v);
    },
    removeItem: async (k) => {
      map.delete(k);
    },
  };
}
