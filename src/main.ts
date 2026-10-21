import './styles.css';
import { MaterialLibrary } from './assets/Materials';
import { Game } from './game/Game';
import { applyDom, t, type StringKey } from './i18n';
import { NavGrid } from './world/NavGrid';
import { Vegetation } from './world/Vegetation';
import { World } from './world/World';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');

if (!canvas) {
  throw new Error('Missing #game-canvas element.');
}

applyDom();

const fill = document.querySelector<HTMLElement>('#loading-fill');
const label = document.querySelector<HTMLElement>('#loading-step');

/** Let the browser paint the loading screen between heavy build stages. */
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

async function stage<T>(key: StringKey, progress: number, build: () => T): Promise<T> {
  if (label) label.textContent = t(key);
  if (fill) fill.style.width = `${progress * 100}%`;
  await nextFrame();
  return build();
}

let game: Game | null = null;

async function boot(): Promise<void> {
  const target = canvas as HTMLCanvasElement;
  const lib = await stage('load.terrain', 0.05, () => new MaterialLibrary());
  const world = await stage('load.world', 0.2, () => new World(lib));
  const veg = await stage('load.veg', 0.55, () => new Vegetation(world.terrain, world.collision));
  const nav = await stage('load.nav', 0.72, () => new NavGrid(world.terrain, world.collision));
  game = await stage('load.people', 0.86, () => new Game(target, { lib, world, veg, nav }));
  await stage('load.ready', 0.97, () => game?.warmUp());
  if (fill) fill.style.width = '100%';
  game.start();
  document.querySelector('#loading-screen')?.classList.add('done');
  document.querySelector('#title-screen')?.classList.remove('hidden');
  window.setTimeout(() => document.querySelector('#loading-screen')?.classList.add('hidden'), 600);
}

void boot();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    game?.dispose();
  });
}
