import type * as THREE from 'three';

export type Faction = 'french' | 'makhzen';
export type Rank = 'soldier' | 'officer' | 'sentry';

export type EnemySpawn = {
  id: string;
  faction: Faction;
  rank: Rank;
  zone: string;
  x: number;
  z: number;
  /** Patrol loop (x,z). Empty = stationary guard looking around `facing`. */
  patrol: number[][];
  facing?: number;
  /** Fixed standing height (watchtower). */
  fixedY?: number;
  /** Carries a quest item when searched. */
  carries?: 'key';
};

export type NpcSpawn = {
  id: string;
  name: string;
  outfit: 'zahra' | 'lahcen' | 'villager' | 'villagerF' | 'prisoner';
  x: number;
  z: number;
  facing: number;
  sitting?: boolean;
  /** Ambient walking loop (townsfolk). */
  walk?: number[][];
};

export type InteractKind =
  | 'water'
  | 'oven'
  | 'talk'
  | 'loot'
  | 'leaflet'
  | 'pole'
  | 'prison'
  | 'cache'
  | 'rest'
  | 'body'
  | 'herb';

export type Interactable = {
  id: string;
  kind: InteractKind;
  pos: THREE.Vector3;
  radius: number;
  prompt: string;
  enabled: boolean;
  /** Seconds the key must be held (0 = instant). */
  hold: number;
  /** Used by loot containers / bodies */
  loot?: LootBundle;
  /** Free payload: npc id, pole index, enemy id… */
  ref?: string;
  /** Re-enable time for ovens */
  cooldownUntil?: number;
  /** Quest gating: only enabled while this quest step is active */
  questGate?: string;
};

export type ItemId = 'bread' | 'dates' | 'herbs' | 'ammo' | 'leaflet' | 'key' | 'water';

export type LootBundle = Partial<Record<ItemId, number>>;
