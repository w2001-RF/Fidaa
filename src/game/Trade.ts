import type { ItemId } from './types';
import type { Upgrade, WeaponId } from './Items';

/**
 * The souk's prices in Protectorate francs, 1945. Rationing and the black
 * market made bread dear and guns dearer: a pistol cost a labourer's month.
 * `buy` is what you pay for a lot of `qty`; `sell` is what a trader pays you per
 * unit (none: they won't buy it). Guns and tools are sold, never bought back.
 */
export type Ware = {
  id: string;
  item?: ItemId;
  weapon?: WeaponId;
  upgrade?: Upgrade;
  qty: number;
  buy?: number;
  sell?: number;
  /** only smugglers deal in this (the souk's back rooms, the nomads) */
  contraband?: boolean;
};

export const WARES: Ware[] = [
  // food and medicine
  { id: 'bread', item: 'bread', qty: 1, buy: 8, sell: 3 },
  { id: 'flour', item: 'flour', qty: 2, buy: 10 },
  { id: 'dates', item: 'dates', qty: 3, buy: 9, sell: 1 },
  { id: 'herbs', item: 'herbs', qty: 1, buy: 6, sell: 2 },
  { id: 'tea', item: 'tea', qty: 2, buy: 10, sell: 2 },
  { id: 'bandage', item: 'bandage', qty: 1, buy: 25, sell: 10 },
  { id: 'rawMeat', item: 'rawMeat', qty: 1, buy: 12, sell: 6 },
  { id: 'cookedMeat', item: 'cookedMeat', qty: 1, sell: 9 },
  { id: 'driedMeat', item: 'driedMeat', qty: 1, buy: 14, sell: 7 },
  { id: 'tagine', item: 'tagine', qty: 1, sell: 18 },
  // materials
  { id: 'hide', item: 'hide', qty: 1, buy: 35, sell: 15 },
  { id: 'bone', item: 'bone', qty: 1, sell: 2 },
  { id: 'sinew', item: 'sinew', qty: 1, buy: 12, sell: 4 },
  { id: 'wood', item: 'wood', qty: 3, buy: 6, sell: 1 },
  { id: 'stone', item: 'stone', qty: 3, buy: 6, sell: 1 },
  { id: 'cloth', item: 'cloth', qty: 1, buy: 9, sell: 3 },
  { id: 'scrap', item: 'scrap', qty: 1, buy: 10, sell: 4 },
  { id: 'ore', item: 'ore', qty: 1, sell: 9 },
  { id: 'powder', item: 'powder', qty: 1, buy: 35, sell: 12, contraband: true },
  // ammunition
  { id: 'ammo', item: 'ammo', qty: 5, buy: 60, sell: 5, contraband: true },
  { id: 'pistolAmmo', item: 'pistolAmmo', qty: 8, buy: 55, sell: 3, contraband: true },
  { id: 'shot', item: 'shot', qty: 4, buy: 30, sell: 3 },
  { id: 'bolt', item: 'bolt', qty: 6, buy: 24, sell: 2 },
  { id: 'arrow', item: 'arrow', qty: 8, buy: 20, sell: 1 },
  // tools
  { id: 'axe', upgrade: 'axe', qty: 1, buy: 160 },
  { id: 'hammer', upgrade: 'hammer', qty: 1, buy: 160 },
  { id: 'knife', upgrade: 'skinningKnife', qty: 1, buy: 90 },
  { id: 'skin', upgrade: 'bigSkin', qty: 1, buy: 70 },
  // guns
  { id: 'sling', weapon: 'sling', qty: 1, buy: 40 },
  { id: 'bow', weapon: 'bow', qty: 1, buy: 280 },
  { id: 'crossbow', weapon: 'crossbow', qty: 1, buy: 650 },
  { id: 'musket', weapon: 'musket', qty: 1, buy: 450, contraband: true },
  { id: 'shotgun', weapon: 'shotgun', qty: 1, buy: 1300, contraband: true },
  { id: 'pistol', weapon: 'pistol', qty: 1, buy: 1800, contraband: true },
];

/** The haggler's eye: each Scavenger rank buys 4% cheaper and sells 6% dearer. */
export function priceBuy(w: Ware, scavenger: number): number {
  return Math.max(1, Math.round((w.buy ?? 0) * (1 - scavenger * 0.04)));
}

export function priceSell(w: Ware, scavenger: number): number {
  return Math.max(1, Math.round((w.sell ?? 0) * (1 + scavenger * 0.06)));
}
