import * as THREE from 'three';
import { Cat } from '../renderer/cat';
import { Stage } from '../renderer/stage';
import { DEFAULT_LOOK } from '../renderer/look';
import { CatTree, PRESET_TREES, TREE_LIMITS, TreeConfig, TreeLibrary, TreePlatform, cleanLibrary, cleanTree } from '../renderer/props';

// 定制猫爬架:左边是存着的所有设计,中间是预览(旁边放一只猫比大小),右边改当前这个设计。
// 改动会自动存下来;点"把这个摆到桌面"才会换掉桌面上的那个。

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const desktop = window.desktop;
const copy = (c: TreeConfig): TreeConfig => ({ ...c, platforms: c.platforms.map((p) => ({ ...p })) });

let library: TreeLibrary = cleanLibrary(null);
let currentId = library.active;
const current = () => library.trees.find((t) => t.id === currentId) ?? library.trees[0];

// ---------- 预览 ----------
const stageEl = $('stage');
const view = new Stage(stageEl);
const world = new THREE.Group(); // 里面用"身长"单位,整体缩放到合适的大小
view.scene.add(world);
let tree = new CatTree(current().config);
world.add(tree.group);
let cat = new Cat(DEFAULT_LOOK);
cat.root.rotation.y = -0.45;
world.add(cat.root);

function layout() {
  const w = stageEl.clientWidth;
  const h = stageEl.clientHeight;
  if (!w || !h) return;
  view.resize(w, h);
  // 画面里要放下:左边的猫、爬架、最高一层上面再留一只蹲着的猫的高度
  const wide = tree.halfWidth * 2 + 2.8;
  const tall = Math.max(1.6, tree.height + 1.2);
  const scale = Math.min(w / wide, h / tall);
  world.scale.setScalar(scale);
  world.position.set((w - wide * scale) / 2 + (2.55 + tree.halfWidth) * scale, Math.max(16, (h - tall * scale) / 2), 0);
  tree.group.position.set(0, 0, -0.5);
  cat.root.position.set(-tree.halfWidth - 1.75, 0, 0);
  view.setLine(cat.lineColor, Math.max(1.2, scale * 0.0075), scale * 0.03);
}
new ResizeObserver(layout).observe(stageEl);

function rebuildTree() {
  world.remove(tree.group);
  tree.dispose();
  tree = new CatTree(current().config);
  world.add(tree.group);
  layout();
}

let last = performance.now();
function tick() {
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  cat.update(dt, { moving: false, airborne: false, swing: 0, lookPitch: 0.15, lookYaw: 0 }, 0.36);
  view.render();
  requestAnimationFrame(tick);
}

// ---------- 存取 ----------
let saveTimer = 0;
/** 改动后:重画预览,稍后自动存盘。存盘会通知桌面;桌面只在当前摆着的那个变了时才看得出变化 */
function changed() {
  rebuildTree();
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(save, 400);
}

async function save() {
  library = cleanLibrary(library);
  await desktop?.saveTrees(library);
}

// ---------- 控件 ----------
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, string> = {}, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  parent?.appendChild(node);
  return node;
}

function renderList() {
  const list = $('list');
  list.textContent = '';
  for (const t of library.trees) {
    const b = el('button', { type: 'button', className: 'item' }, list);
    b.setAttribute('aria-pressed', String(t.id === currentId));
    el('span', { textContent: t.name }, b);
    const onDesk = t.id === library.active;
    el('small', { textContent: onDesk ? '桌面上摆的是这个' : `${t.config.platforms.length} 层`, className: onDesk ? 'on' : '' }, b);
    b.addEventListener('click', () => select(t.id));
  }
  ($('delete') as HTMLButtonElement).disabled = library.trees.length <= 1;
}

function select(id: string) {
  currentId = id;
  renderAll();
  rebuildTree();
  $('saved').textContent = '';
}

const FIELDS: ['y' | 'x' | 'w', string, readonly [number, number]][] = [
  ['y', '高度', TREE_LIMITS.y],
  ['x', '左右', TREE_LIMITS.x],
  ['w', '宽度', TREE_LIMITS.w],
];
const KINDS: [TreePlatform['kind'], string][] = [
  ['flat', '平板'],
  ['bed', '猫窝'],
  ['box', '猫洞'],
];

/** 按当前设计重画平台列表。列表按从高到低显示,和画面里的上下顺序一致 */
function renderLayers() {
  const config = current().config;
  config.platforms.sort((a, b) => a.y - b.y);
  const list = $('layers');
  list.textContent = '';
  for (let i = config.platforms.length - 1; i >= 0; i--) {
    const p = config.platforms[i];
    const card = el('div', { className: 'layer' }, list);
    const head = el('header', {}, card);
    el('span', { textContent: `第 ${i + 1} 层${i === config.platforms.length - 1 ? '(最高)' : ''}` }, head);
    const remove = el('button', { type: 'button', className: 'remove', textContent: '删除' }, head);
    remove.disabled = config.platforms.length <= 1;
    remove.addEventListener('click', () => {
      config.platforms.splice(i, 1);
      renderLayers();
      renderList();
      changed();
    });
    const kinds = el('div', { className: 'kinds' }, card);
    for (const [kind, label] of KINDS) {
      const b = el('button', { type: 'button', textContent: label }, kinds);
      b.setAttribute('aria-pressed', String(p.kind === kind));
      b.addEventListener('click', () => {
        p.kind = kind;
        renderLayers();
        changed();
      });
    }
    for (const [key, label, [min, max]] of FIELDS) {
      const row = el('div', { className: 'row' }, card);
      const id = `l${i}-${key}`;
      el('label', { textContent: label, htmlFor: id }, row);
      const input = el('input', { type: 'range', id, min: String(min), max: String(max), step: '0.01' }, row);
      input.value = String(p[key]);
      const out = el('output', { textContent: p[key].toFixed(2) }, row);
      input.addEventListener('input', () => {
        p[key] = Number(input.value);
        out.textContent = p[key].toFixed(2);
        changed();
      });
      // 高度改完后层的顺序可能变了,松手时重排一次列表
      if (key === 'y') input.addEventListener('change', renderLayers);
    }
    const below = i === 0 ? 0 : config.platforms[i - 1].y;
    if (p.y - below > 1.35) el('p', { className: 'warn', textContent: '离下面一层比较高,猫跳上来会有点夸张。' }, card);
    if (p.w * config.size < 0.8) el('p', { className: 'warn', textContent: '这一层比猫的身体短,猫蹲上去会伸出去一截。' }, card);
  }
  ($('add') as HTMLButtonElement).disabled = config.platforms.length >= TREE_LIMITS.count;
}

function slider(id: string, key: 'size' | 'opacity') {
  const input = $<HTMLInputElement>(id);
  const out = $(`o-${key}`);
  const [min, max] = TREE_LIMITS[key];
  input.min = String(min);
  input.max = String(max);
  input.addEventListener('input', () => {
    current().config[key] = Number(input.value);
    out.textContent = `${Math.round(Number(input.value) * 100)}%`;
    if (key === 'size') renderLayers();
    changed();
  });
  return () => {
    input.value = String(current().config[key]);
    out.textContent = `${Math.round(current().config[key] * 100)}%`;
  };
}
const syncSize = slider('s-size', 'size');
const syncOpacity = slider('s-opacity', 'opacity');

function renderAll() {
  const { name, config } = current();
  $<HTMLInputElement>('name').value = name;
  $<HTMLInputElement>('c-platform').value = config.platformColor;
  $<HTMLInputElement>('c-post').value = config.postColor;
  $<HTMLInputElement>('k-ball').checked = config.ball;
  syncSize();
  syncOpacity();
  renderList();
  renderLayers();
}

$('name').addEventListener('input', (e) => {
  current().name = (e.target as HTMLInputElement).value || '未命名';
  renderList();
  changed();
});
$('add').addEventListener('click', () => {
  const config = current().config;
  const top = config.platforms[config.platforms.length - 1];
  // 新的一层放在最高层上面,左右和它错开
  config.platforms.push({ x: top.x > 0 ? -0.3 : 0.3, y: Math.min(TREE_LIMITS.y[1], top.y + 0.65), w: 1.05, kind: 'flat' });
  renderLayers();
  renderList();
  changed();
});
$('c-platform').addEventListener('input', (e) => {
  current().config.platformColor = (e.target as HTMLInputElement).value;
  changed();
});
$('c-post').addEventListener('input', (e) => {
  current().config.postColor = (e.target as HTMLInputElement).value;
  changed();
});
$('k-ball').addEventListener('change', (e) => {
  current().config.ball = (e.target as HTMLInputElement).checked;
  changed();
});
$('new').addEventListener('click', () => {
  const source = current();
  const id = `t${Date.now().toString(36)}`;
  library.trees.push({ id, name: `${source.name} 副本`.slice(0, 20), config: copy(source.config) });
  select(id);
  changed();
});
$('delete').addEventListener('click', () => {
  if (library.trees.length <= 1) return;
  library.trees = library.trees.filter((t) => t.id !== currentId);
  if (library.active === currentId) library.active = library.trees[0].id;
  select(library.trees[0].id);
  changed();
});
$('presets').addEventListener('click', () => {
  // 把被删掉的预设加回来;还在的不动
  for (const preset of PRESET_TREES) {
    if (!library.trees.some((t) => t.id === preset.id)) library.trees.push({ ...preset, config: cleanTree(preset.config) });
  }
  renderList();
  changed();
});
$('apply').addEventListener('click', async () => {
  library.active = currentId;
  renderList();
  window.clearTimeout(saveTimer);
  await save();
  $('saved').textContent = desktop ? '已经摆到桌面上了。' : '从桌面猫的菜单打开本页,才能摆到桌面。';
});

async function start() {
  const [saved, look] = await Promise.all([desktop?.getTrees(), desktop?.getLook()]);
  library = cleanLibrary(saved);
  currentId = library.active;
  if (look) {
    world.remove(cat.root);
    cat.dispose();
    cat = new Cat({ ...DEFAULT_LOOK, ...look });
    cat.root.rotation.y = -0.45;
    world.add(cat.root);
  }
  renderAll();
  rebuildTree();
  tick();
}
start();
