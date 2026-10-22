/**
 * Persistent save slot. IndexedDB is the primary store (no size limit worth
 * worrying about, survives reloads). When IndexedDB is unavailable (private
 * windows, blocked storage) the save falls back to a cookie, trimmed to fit
 * the ~4 KB cookie limit by dropping the bulky parts (map fog, felled trees).
 */
export type SaveData = {
  version: 1;
  savedAt: number;
  quest: { mission: number; step: number; counts: [string, number][] };
  player: {
    x: number;
    z: number;
    yaw: number;
    health: number;
    hunger: number;
    thirst: number;
    xp: number;
    level: number;
    skillPoints: number;
    skills: Record<string, number>;
    inventory: Record<string, number>;
    weapons: string[];
    clips: Record<string, number>;
    upgrades: string[];
  };
  world: {
    hour: number;
    days: number;
    used: string[];
    discovered: string[];
    /** fog-of-war bitmap, base64 of packed bits */
    fog?: string;
    harvested?: number[];
    /** the lands beyond the valley: their seed, felled frontier trees and searched jars */
    frontier?: { seed: number; harvested: string[]; searched: string[] };
    /** the region map's fog, packed like `fog` */
    frontierFog?: string;
    /** the player's camp pieces */
    camp?: { kind: string; x: number; z: number; yaw: number }[];
    prisonOpened: boolean;
    carrying: boolean;
  };
  stats: Record<string, number>;
};

const DB = 'fidai-1945';
const STORE = 'saves';
const SLOT = 'slot-1';
const COOKIE = 'fidai_save';

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (!('indexedDB' in window)) return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function writeCookie(data: SaveData): boolean {
  try {
    // keep the cookie small: no fog, no felled trees
    const slim: SaveData = {
      ...data,
      world: { ...data.world, fog: undefined, harvested: undefined, frontierFog: undefined, frontier: data.world.frontier && { seed: data.world.frontier.seed, harvested: [], searched: [] } },
    };
    const value = encodeURIComponent(JSON.stringify(slim));
    if (value.length > 3900) return false;
    document.cookie = `${COOKIE}=${value}; max-age=${60 * 60 * 24 * 365}; path=/; SameSite=Lax`;
    return true;
  } catch {
    return false;
  }
}

function readCookie(): SaveData | null {
  try {
    const hit = document.cookie.split('; ').find((c) => c.startsWith(`${COOKIE}=`));
    if (!hit) return null;
    return JSON.parse(decodeURIComponent(hit.slice(COOKIE.length + 1))) as SaveData;
  } catch {
    return null;
  }
}

export class SaveStore {
  private db: Promise<IDBDatabase | null> = openDb();
  /** where the last save landed: shown in the pause menu */
  backend: 'indexeddb' | 'cookie' | 'none' = 'none';

  async save(data: SaveData): Promise<boolean> {
    const db = await this.db;
    if (db) {
      const ok = await new Promise<boolean>((resolve) => {
        try {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(data, SLOT);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
          tx.onabort = () => resolve(false);
        } catch {
          resolve(false);
        }
      });
      if (ok) {
        this.backend = 'indexeddb';
        return true;
      }
    }
    if (writeCookie(data)) {
      this.backend = 'cookie';
      return true;
    }
    this.backend = 'none';
    return false;
  }

  async load(): Promise<SaveData | null> {
    const db = await this.db;
    if (db) {
      const fromDb = await new Promise<SaveData | null>((resolve) => {
        try {
          const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(SLOT);
          req.onsuccess = () => resolve((req.result as SaveData | undefined) ?? null);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
      if (fromDb?.version === 1) return fromDb;
    }
    const c = readCookie();
    return c?.version === 1 ? c : null;
  }

  async clear(): Promise<void> {
    const db = await this.db;
    if (db) {
      await new Promise<void>((resolve) => {
        try {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).delete(SLOT);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        } catch {
          resolve();
        }
      });
    }
    document.cookie = `${COOKIE}=; max-age=0; path=/`;
  }
}

/** Pack a 0/1 byte array into base64 (9216 cells -> ~1.5 KB). */
export function packBits(bits: Uint8Array): string {
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i += 1) if (bits[i]) bytes[i >> 3] |= 1 << (i & 7);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function unpackBits(b64: string, into: Uint8Array): void {
  const s = atob(b64);
  for (let i = 0; i < into.length; i += 1) into[i] = (s.charCodeAt(i >> 3) >> (i & 7)) & 1;
}
