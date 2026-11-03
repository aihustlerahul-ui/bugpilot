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
