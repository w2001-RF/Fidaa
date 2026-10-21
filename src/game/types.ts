import type * as THREE from 'three';
import type { Text } from '../i18n';
import type { WeaponId } from './Items';

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
  name: Text;
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
  | 'herb'
  | 'wood'
  | 'scrap'
  | 'weapon'
  | 'bench'
  | 'carcass'
  | 'harvest'
  | 'ride'
  | 'trade'
  | 'cook';

export type Interactable = {
  id: string;
  kind: InteractKind;
  pos: THREE.Vector3;
  radius: number;
  prompt: Text;
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
  /** Weapon granted by a 'weapon' pickup */
  weapon?: WeaponId;
};

export type ItemId =
  | 'francs'
  | 'flour'
  | 'tagine'
  | 'tea'
  | 'driedMeat'
  | 'bread'
  | 'dates'
  | 'herbs'
  | 'water'
  | 'bandage'
  | 'ammo'
  | 'pistolAmmo'
  | 'shot'
  | 'bolt'
  | 'arrow'
  | 'scrap'
  | 'cloth'
  | 'wood'
  | 'powder'
  | 'rawMeat'
  | 'cookedMeat'
  | 'hide'
  | 'bone'
  | 'sinew'
  | 'stone'
  | 'ore'
  | 'leaflet'
  | 'key';

export type LootBundle = Partial<Record<ItemId, number>>;
