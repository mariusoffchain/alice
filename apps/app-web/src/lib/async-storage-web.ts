const AsyncStorage = {
  async getItem(key: string): Promise<string | null> {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    if (typeof window === 'undefined') return;
    localStorage.setItem(key, value);
  },
  async removeItem(key: string): Promise<void> {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(key);
  },
  async multiRemove(keys: string[]): Promise<void> {
    if (typeof window === 'undefined') return;
    for (const key of keys) localStorage.removeItem(key);
  },
};

export default AsyncStorage;
