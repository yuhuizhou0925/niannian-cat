import * as THREE from 'three';
import { Cat } from '../renderer/cat';
import { Stage } from '../renderer/stage';
import { CatLook, DEFAULT_LOOK, PRESETS, Pattern, rgbToHex } from '../renderer/look';
import { analyze } from './analyze';

// 外观工作室:放入照片或视频 → 提取毛色 → 在 3D 预览里微调 → 应用到桌面猫。

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const desktop = window.desktop;
const STORE_KEY = 'cat-look';

type ColorKey = 'base' | 'marking' | 'accent' | 'white' | 'eyes' | 'nose';
type ShapeKey = 'fluff' | 'ears' | 'head';

const COLORS: [ColorKey, string][] = [
  ['base', '主毛色'],
  ['marking', '花纹色'],
  ['accent', '第二花色'],
  ['white', '白色部分'],
  ['eyes', '眼睛'],
  ['nose', '鼻子'],
];
const PATTERNS: [Pattern, string][] = [
  ['solid', '纯色'],
  ['tabby', '虎斑'],
  ['spots', '斑点'],
  ['patches', '色块'],
  ['points', '重点色'],
  ['ragdoll', '布偶双色'],
];
const SHAPES: [ShapeKey, string, number, number][] = [
  ['head', '头', 0.85, 1.15],
  ['ears', '耳朵', 0.7, 1.4],
  ['fluff', '尾巴', 0.7, 1.3],
];

let look: CatLook = { ...DEFAULT_LOOK };
let activeSlot: ColorKey = 'base';

// ---------- 3D 预览 ----------
const stage = $('stage');
const view = new Stage(stage);
const { scene } = view;
let viewScale = 300;

const pivot = new THREE.Group(); // 绕身体中心旋转
scene.add(pivot);
const shadow = new THREE.Mesh(
  new THREE.CircleGeometry(0.52, 40),
  new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.13, depthWrite: false })
);
shadow.scale.y = 0.14;
view.under.add(shadow);

let cat = new Cat(look);
cat.root.position.x = -0.4;
pivot.add(cat.root);
let yaw = -0.6;
let walking = true;
let rebuildQueued = false;

function rebuild() {
  rebuildQueued = false;
  pivot.remove(cat.root);
  cat.dispose();
  cat = new Cat(look);
  cat.root.position.x = -0.4;
  pivot.add(cat.root);
  view.setLine(cat.lineColor, viewScale * 0.0075, viewScale * 0.03);
}

function changed() {
  if (!rebuildQueued) {
    rebuildQueued = true;
    requestAnimationFrame(rebuild);
  }
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(look));
  } catch {
    /* 存不了就算了,不影响使用 */
  }
  $('saved').textContent = '';
}

function layout() {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  if (!w || !h) return;
  view.resize(w, h);
  const scale = (viewScale = Math.min(w / 1.65, h / 1.2));
  view.setLine(cat.lineColor, scale * 0.0075, scale * 0.03);
  pivot.scale.setScalar(scale);
  pivot.position.set(w / 2, Math.max(24, (h - scale * 0.95) / 2), 0);
  shadow.scale.set(scale, scale * 0.14, 1);
  shadow.position.set(w / 2, pivot.position.y + 2, -600);
}
new ResizeObserver(layout).observe(stage);

let dragX: number | null = null;
stage.addEventListener('pointerdown', (e) => {
  dragX = e.clientX;
  stage.setPointerCapture(e.pointerId);
});
stage.addEventListener('pointermove', (e) => {
  if (dragX === null) return;
  yaw += (e.clientX - dragX) * 0.01;
  dragX = e.clientX;
});
stage.addEventListener('pointerup', () => (dragX = null));
stage.addEventListener('pointercancel', () => (dragX = null));

let last = performance.now();
function tick() {
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  pivot.rotation.y = yaw;
  cat.update(dt, { moving: walking, airborne: false, swing: 0, lookPitch: 0, lookYaw: 0 }, 0.36);
  view.render();
  requestAnimationFrame(tick);
}

// ---------- 控件 ----------
const colorInputs = {} as Record<ColorKey, HTMLInputElement>;
const pickButtons = {} as Record<ColorKey, HTMLButtonElement>;
const colorRows = {} as Record<ColorKey, HTMLElement>;
const shapeInputs = {} as Record<ShapeKey, HTMLInputElement>;
const patternButtons = {} as Record<Pattern, HTMLButtonElement>;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, string> = {}, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  parent?.appendChild(node);
  return node;
}

function buildControls() {
  for (const [key, label] of COLORS) {
    const row = el('div', { className: 'row' }, $('colors'));
    el('label', { textContent: label, htmlFor: `c-${key}` }, row);
    const input = el('input', { type: 'color', id: `c-${key}` }, row);
    input.addEventListener('input', () => {
      look[key] = input.value;
      changed();
    });
    const pick = el('button', { type: 'button', className: 'pick', textContent: '从照片取色', id: `p-${key}` }, row);
    pick.addEventListener('click', () => {
      activeSlot = key;
      sync();
      $('status').textContent = `在照片上点一下,或点下面的色块,就会设为「${label}」。`;
    });
    colorInputs[key] = input;
    pickButtons[key] = pick;
    colorRows[key] = row;
  }
  for (const [key, label] of PATTERNS) {
    const b = el('button', { type: 'button', textContent: label, id: `pt-${key}` }, $('patterns'));
    b.addEventListener('click', () => {
      look.pattern = key;
      sync();
      changed();
    });
    patternButtons[key] = b;
  }
  for (const [key, label, min, max] of SHAPES) {
    const row = el('div', { className: 'row' }, $('shape'));
    el('label', { textContent: label, htmlFor: `s-${key}` }, row);
    const input = el('input', { type: 'range', id: `s-${key}`, min: String(min), max: String(max), step: '0.01' }, row);
    el('span', {}, row);
    input.addEventListener('input', () => {
      look[key] = Number(input.value);
      changed();
    });
    shapeInputs[key] = input;
  }
  for (const preset of PRESETS) {
    const b = el('button', { type: 'button', textContent: preset.name }, $('presets'));
    b.addEventListener('click', () => {
      look = { ...DEFAULT_LOOK, ...preset.look };
      sync();
      changed();
    });
  }
  const belly = $<HTMLInputElement>('s-belly');
  belly.addEventListener('input', () => {
    look.belly = Number(belly.value);
    changed();
  });
  for (const key of ['socks', 'muzzle'] as const) {
    const box = $<HTMLInputElement>(`k-${key}`);
    box.addEventListener('change', () => {
      look[key] = box.checked;
      changed();
    });
  }
  $('walk').addEventListener('click', () => {
    walking = !walking;
    $('walk').setAttribute('aria-pressed', String(walking));
  });
  $('reset').addEventListener('click', () => {
    look = { ...DEFAULT_LOOK };
    sync();
    changed();
  });
  $('apply').addEventListener('click', async () => {
    if (!desktop) {
      $('saved').textContent = '已保存在这个页面里。从桌面猫的菜单打开本页,才能应用到桌面。';
      return;
    }
    await desktop.saveLook(look);
    $('saved').textContent = '已应用,看看桌面上的猫。';
  });
}

/** 把当前外观同步到所有控件 */
function sync() {
  for (const [key] of COLORS) {
    colorInputs[key].value = look[key];
    pickButtons[key].setAttribute('aria-pressed', String(activeSlot === key));
  }
  colorRows.accent.hidden = look.pattern !== 'patches';
  for (const [key] of PATTERNS) patternButtons[key].setAttribute('aria-pressed', String(look.pattern === key));
  for (const [key] of SHAPES) shapeInputs[key].value = String(look[key]);
  $<HTMLInputElement>('s-belly').value = String(look.belly);
  $<HTMLInputElement>('k-socks').checked = look.socks;
  $<HTMLInputElement>('k-muzzle').checked = look.muzzle;
}

function setSlot(hex: string) {
  look[activeSlot] = hex;
  sync();
  changed();
}

// ---------- 照片和视频 ----------
const photo = $<HTMLCanvasElement>('photo');
const pctx = photo.getContext('2d', { willReadFrequently: true })!;
const video = $<HTMLVideoElement>('video');
const seek = $<HTMLInputElement>('seek');
let needAnalysis = false;

function show(source: CanvasImageSource, sw: number, sh: number) {
  const k = Math.min(1, 720 / Math.max(sw, sh));
  photo.width = Math.max(1, Math.round(sw * k));
  photo.height = Math.max(1, Math.round(sh * k));
  pctx.drawImage(source, 0, 0, photo.width, photo.height);
  photo.hidden = false;
  photo.classList.add('picking');
  $('drop-hint').hidden = true;
}

function runAnalysis() {
  const k = Math.min(1, 128 / Math.max(photo.width, photo.height));
  const small = document.createElement('canvas');
  small.width = Math.max(1, Math.round(photo.width * k));
  small.height = Math.max(1, Math.round(photo.height * k));
  const sctx = small.getContext('2d')!;
  sctx.drawImage(photo, 0, 0, small.width, small.height);
  const result = analyze(sctx.getImageData(0, 0, small.width, small.height));

  const palette = $('palette');
  palette.textContent = '';
  for (const s of result.palette) {
    const b = el('button', { type: 'button', className: 'swatch', title: '设为当前选中的颜色' }, palette);
    el('i', {}, b).style.background = s.hex;
    el('span', { textContent: `${Math.round(s.share * 100)}%` }, b);
    b.addEventListener('click', () => setSlot(s.hex));
  }
  if (!result.palette.length) {
    $('status').textContent = '没能从这张图里提取到颜色,请换一张,或直接在右边手动调。';
    return;
  }
  look = { ...look, ...result.look };
  sync();
  changed();
  $('status').textContent =
    `已提取 ${result.palette.length} 种毛色并套到猫身上。花纹类型是估计的,不对可以在右边改。` +
    '眼睛颜色识别不了:点「眼睛」旁的「从照片取色」,再在照片上点一下眼睛。';
}

function loadImage(url: string, revoke = false) {
  const img = new Image();
  img.onload = () => {
    show(img, img.naturalWidth, img.naturalHeight);
    if (revoke) URL.revokeObjectURL(url);
    $('video-bar').hidden = true;
    runAnalysis();
  };
  img.onerror = () => {
    $('status').textContent = '这个文件打不开。请换成 JPG、PNG 或 WebP(iPhone 的 HEIC 需要先转换)。';
  };
  img.src = url;
}

function loadFile(file: File) {
  if (file.type.startsWith('video/')) {
    needAnalysis = true;
    video.src = URL.createObjectURL(file);
    video.load();
  } else {
    loadImage(URL.createObjectURL(file), true);
  }
}

video.addEventListener('loadedmetadata', () => {
  seek.max = String(video.duration || 1);
  seek.value = String(Math.min(0.5, (video.duration || 1) / 2));
  video.currentTime = Number(seek.value);
  $('video-bar').hidden = false;
});
video.addEventListener('seeked', () => {
  show(video, video.videoWidth, video.videoHeight);
  if (needAnalysis) {
    needAnalysis = false;
    runAnalysis();
  }
});
video.addEventListener('error', () => {
  $('status').textContent = '这个视频打不开。请换成 MP4 或 WebM。';
});
seek.addEventListener('input', () => (video.currentTime = Number(seek.value)));
$('reanalyze').addEventListener('click', runAnalysis);

const drop = $('drop');
const fileInput = $<HTMLInputElement>('file');
drop.addEventListener('click', (e) => {
  // 已有照片时,点击是取色;否则打开文件选择
  if (photo.hidden || e.target !== photo) {
    fileInput.click();
    return;
  }
  const rect = photo.getBoundingClientRect();
  const x = Math.round(((e.clientX - rect.left) / rect.width) * photo.width);
  const y = Math.round(((e.clientY - rect.top) / rect.height) * photo.height);
  const size = 5;
  const data = pctx.getImageData(Math.max(0, x - 2), Math.max(0, y - 2), size, size).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n++;
  }
  setSlot(rgbToHex([r / n, g / n, b / n]));
});
drop.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') fileInput.click();
});
fileInput.addEventListener('change', () => {
  if (fileInput.files?.[0]) loadFile(fileInput.files[0]);
  fileInput.value = '';
});
for (const type of ['dragenter', 'dragover'] as const) {
  drop.addEventListener(type, (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
}
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const file = e.dataTransfer?.files[0];
  if (file) loadFile(file);
});
// 拖到页面其他位置时不要让浏览器直接打开文件
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

// ---------- 启动 ----------
async function start() {
  buildControls();
  let saved: Partial<CatLook> | null = null;
  try {
    saved = (await desktop?.getLook()) ?? JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
  } catch {
    saved = null;
  }
  if (saved) look = { ...DEFAULT_LOOK, ...saved };
  sync();
  rebuild();
  layout();
  tick();
  const debugYaw = await desktop?.getDebugYaw();
  if (debugYaw) {
    yaw = Number(debugYaw);
    walking = false;
  }
  const test = await desktop?.getTestImage();
  if (test) loadImage(test);
}
start();
