export interface Env {
  /** Bookmarks, read history, settings and fold state per install. Optional: see store.ts. */
  HN_KV?: KVNamespace;
  DEV?: string;
}
