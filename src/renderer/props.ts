import * as THREE from 'three';

// 桌面上的道具:食盆、水盆、猫爬架,还有逗猫棒上的玩具。
// 道具的模型按"身长"单位搭,整体乘以 scale 变成像素。

const gradient = new THREE.DataTexture(new Uint8Array([210, 255]), 2, 1, THREE.RedFormat);
gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
gradient.needsUpdate = true;
const toon = (color: string) => new THREE.MeshToonMaterial({ color, gradientMap: gradient });

export type PropKind = 'food' | 'water' | 'tree' | 'wand' | 'house';

export class Bowl {
  readonly group = new THREE.Group();
  private fill: THREE.Mesh;

  constructor(readonly kind: 'food' | 'water') {
    // 碗的剖面绕一圈:外壁、碗沿、内壁
    const profile = [[0, 0], [0.13, 0], [0.175, 0.09], [0.158, 0.09], [0.12, 0.022], [0, 0.022]].map(([x, y]) => new THREE.Vector2(x, y));
    this.group.add(new THREE.Mesh(new THREE.LatheGeometry(profile, 32), toon(kind === 'food' ? '#e58f6e' : '#6fa9d6')));
    // 里面的东西:猫粮堆成小丘,水微微鼓出碗沿,这样从侧面也看得出还剩多少
    this.fill = new THREE.Mesh(new THREE.SphereGeometry(0.145, 24, 14), toon(kind === 'food' ? '#9a6a3c' : '#a9d8f5'));
    this.fill.position.y = 0.05;
    this.group.add(this.fill);
    this.setLevel(1);
  }

  setLevel(level: number) {
    this.fill.visible = level > 0.03;
    this.fill.scale.set(1, (this.kind === 'food' ? 0.2 + 0.55 * level : 0.12 + 0.3 * level), 1);
  }
}

/** 一层平台。位置和宽度用"身长"单位,是缩放之前的尺寸 */
export interface TreePlatform {
  x: number; // 平台中心相对主柱的左右位置
  y: number; // 顶面高度
  w: number; // 宽度
  kind: 'flat' | 'bed' | 'box'; // 平板 / 带围边的猫窝 / 下面带一个猫洞箱子
}

/** 一个猫爬架的设计。用户可以在"定制猫爬架"窗口里改 */
export interface TreeConfig {
  platforms: TreePlatform[];
  platformColor: string;
  postColor: string;
  ball: boolean; // 顶层下面挂不挂小球
  size: number; // 整体大小(1 是和猫等比例的原始大小)
  opacity: number; // 不透明度:越小越透,越不挡屏幕
}

/** 猫爬架库:存着的所有设计,和当前摆在桌面上的是哪一个 */
export interface TreeLibrary {
  active: string;
  trees: { id: string; name: string; config: TreeConfig }[];
}

const design = (platforms: [number, number, number, TreePlatform['kind']][], platformColor = '#efe3d3', postColor = '#c8a476'): TreeConfig => ({
  platforms: platforms.map(([x, y, w, kind]) => ({ x, y, w, kind })),
  platformColor, postColor, ball: true, size: 0.8, opacity: 0.6,
});

export const PRESET_TREES: TreeLibrary['trees'] = [
  { id: 'classic', name: '经典两层', config: design([[-0.3, 0.75, 1.05, 'flat'], [0.3, 1.4, 1.05, 'flat']]) },
  { id: 'tower', name: '三层高塔', config: design([[-0.35, 0.7, 1.0, 'flat'], [0.4, 1.3, 1.0, 'flat'], [-0.2, 1.95, 1.15, 'bed']], '#dfe8ee', '#b9966a') },
  { id: 'stool', name: '矮凳猫窝', config: design([[0, 0.6, 1.25, 'bed']], '#f1dcd6', '#c9a98f') },
  { id: 'stairs', name: '阶梯', config: design([[-0.75, 0.5, 0.95, 'flat'], [0, 0.95, 0.95, 'flat'], [0.75, 1.4, 0.95, 'flat']], '#e6ead9', '#b7a37a') },
  { id: 'cubby', name: '猫洞加猫窝', config: design([[0, 0.62, 1.1, 'box'], [0.4, 1.35, 1.15, 'bed']], '#ece2f0', '#bfa38a') },
];

export const DEFAULT_TREE: TreeConfig = PRESET_TREES[0].config;
export const TREE_LIMITS = { x: [-1, 1], y: [0.4, 3.2], w: [0.8, 1.7], size: [0.5, 1.1], opacity: [0.2, 1], count: 5 } as const;

/** 把存下来的配置整理成合法的:数值夹到范围内,平台按高度从低到高排 */
export function cleanTree(raw: Partial<TreeConfig> | null | undefined): TreeConfig {
  const clamp = (v: unknown, [lo, hi]: readonly [number, number], fallback: number) =>
    typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
  const platforms = (Array.isArray(raw?.platforms) && raw!.platforms.length ? raw!.platforms : DEFAULT_TREE.platforms)
    .slice(0, TREE_LIMITS.count)
    .map((p): TreePlatform => ({
      x: clamp(p?.x, TREE_LIMITS.x, 0),
      y: clamp(p?.y, TREE_LIMITS.y, 1),
      w: clamp(p?.w, TREE_LIMITS.w, 1.05),
      kind: p?.kind === 'bed' || p?.kind === 'box' ? p.kind : 'flat',
    }))
    .sort((a, b) => a.y - b.y);
  const color = (v: unknown, fallback: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback);
  return {
    platforms,
    platformColor: color(raw?.platformColor, DEFAULT_TREE.platformColor),
    postColor: color(raw?.postColor, DEFAULT_TREE.postColor),
    ball: raw?.ball ?? true,
    size: clamp(raw?.size, TREE_LIMITS.size, 0.8),
    opacity: clamp(raw?.opacity, TREE_LIMITS.opacity, 0.6),
  };
}

export function cleanLibrary(raw: Partial<TreeLibrary> | null | undefined): TreeLibrary {
  const trees = (Array.isArray(raw?.trees) && raw!.trees.length ? raw!.trees : PRESET_TREES)
    .filter((t) => t && typeof t.id === 'string')
    .map((t) => ({ id: t.id, name: typeof t.name === 'string' && t.name.trim() ? t.name.slice(0, 20) : '未命名', config: cleanTree(t.config) }));
  const list = trees.length ? trees : PRESET_TREES.map((t) => ({ ...t, config: cleanTree(t.config) }));
  return { active: list.some((t) => t.id === raw?.active) ? raw!.active! : list[0].id, trees: list };
}

export const activeTree = (library: TreeLibrary) => (library.trees.find((t) => t.id === library.active) ?? library.trees[0]).config;

export class CatTree {
  readonly group = new THREE.Group();
  /** 平台从低到高,已经乘过整体大小(身长单位):x 是中心,y 是顶面高度,w 是宽度 */
  readonly platforms: { x: number; y: number; w: number }[];
  /** 整个爬架的半宽和高度(身长单位,已经乘过整体大小) */
  readonly halfWidth: number;
  readonly height: number;
  /** 顶层下面挂着的小球:挂点的位置和绳长(身长单位,已经乘过整体大小);没挂就是 null */
  toy: { x: number; y: number; len: number } | null = null;
  private toyPivot: THREE.Group | null = null;
  private toyAngle = 0;
  private toySpin = 0;

  constructor(config: TreeConfig) {
    config = cleanTree(config);
    const { platforms, size } = config;
    // 半透明、不写深度:不会被描线,叠在桌面上只是一层淡淡的形状,少挡屏幕
    const material = (color: string) => {
      const m = toon(color);
      m.transparent = config.opacity < 0.995;
      m.opacity = config.opacity;
      m.depthWrite = !m.transparent;
      return m;
    };
    const flat = material(config.platformColor);
    const wood = material(config.postColor);
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      this.group.add(m);
    };
    const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z = 0) => add(new THREE.BoxGeometry(w, h, d), mat, x, y, z);
    const post = (x: number, top: number) => add(new THREE.CylinderGeometry(0.06, 0.06, top - 0.06, 18), wood, x, 0.06 + (top - 0.06) / 2);

    const top = platforms[platforms.length - 1];
    // 中间一根主柱通到最高层;够不着主柱的平台自己再立一根
    post(0, top.y - 0.04);
    const posts = [0];
    for (const p of platforms) {
      if (Math.abs(p.x) > p.w / 2 - 0.1) {
        post(p.x, p.y - 0.04);
        posts.push(p.x);
      }
      box(p.w, 0.06, 0.6, flat, p.x, p.y - 0.03);
      if (p.kind === 'bed') {
        // 猫窝:两头和后面有一圈矮围边
        for (const side of [-1, 1]) box(0.06, 0.13, 0.6, flat, p.x + side * (p.w / 2 - 0.03), p.y + 0.065);
        box(p.w, 0.13, 0.05, flat, p.x, p.y + 0.065, -0.275);
      } else if (p.kind === 'box') {
        // 平台下面的箱子,正面开一个圆形猫洞
        const h = Math.min(0.5, p.y - 0.12);
        box(p.w * 0.92, h, 0.58, flat, p.x, p.y - 0.06 - h / 2);
        add(new THREE.CircleGeometry(Math.min(0.17, h * 0.38), 28), material('#5a4a40'), p.x, p.y - 0.06 - h / 2, 0.292);
      }
    }
    // 底座盖住所有柱子,再宽出一点
    const baseL = Math.min(...posts) - 0.55;
    const baseR = Math.max(...posts) + 0.55;
    box(baseR - baseL, 0.06, 0.68, flat, (baseL + baseR) / 2, 0.03);
    if (config.ball) {
      // 顶层平台下面挂一个小球
      const side = top.x >= 0 ? 1 : -1;
      const bx = top.x + side * (top.w / 2 - 0.1);
      // 小球和绳子挂在一个转轴上,被拍到会像钟摆一样荡
      const len = 0.22;
      const pivot = new THREE.Group();
      pivot.position.set(bx, top.y - 0.03, 0.2);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), material('#e0607f'));
      ball.position.y = -len;
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.18, 6), material('#9a8f85'));
      cord.position.y = -0.09;
      pivot.add(ball, cord);
      this.group.add(pivot);
      this.toyPivot = pivot;
      this.toy = { x: bx * size, y: (top.y - 0.03) * size, len: len * size };
    }
    const left = Math.min(baseL, ...platforms.map((p) => p.x - p.w / 2));
    const right = Math.max(baseR, ...platforms.map((p) => p.x + p.w / 2));
    this.halfWidth = Math.max(-left, right) * size;
    this.height = top.y * size;
    this.platforms = platforms.map((p) => ({ x: p.x * size, y: p.y * size, w: p.w * size }));
    this.group.scale.setScalar(size);
  }

  /** 小球的钟摆:每帧调一次 */
  updateToy(dt: number) {
    if (!this.toyPivot) return;
    this.toySpin += (-45 * this.toyAngle - 1.5 * this.toySpin) * dt;
    this.toyAngle = THREE.MathUtils.clamp(this.toyAngle + this.toySpin * dt, -1.3, 1.3);
    this.toyPivot.rotation.z = this.toyAngle;
  }

  /** 小球被拍了一下(dx:横向的力,正数往右) */
  knockToy(dx: number) {
    this.toySpin += dx * 0.022;
  }

  /** 小球这一刻的位置(身长单位,相对爬架的原点) */
  toyPosition(out: THREE.Vector2) {
    if (!this.toy) return out.set(0, 0);
    return out.set(this.toy.x + Math.sin(this.toyAngle) * this.toy.len, this.toy.y - Math.cos(this.toyAngle) * this.toy.len);
  }

  dispose() {
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    });
  }
}

/** 猫的小房子:正面有一个圆门,猫累了会钻进去睡觉,从门里能看到它 */
export class House {
  readonly group = new THREE.Group();
  /** 尺寸(身长单位) */
  static readonly WIDTH = 1.45;
  static readonly HEIGHT = 1.3;
  static readonly DEPTH = 1.0;
  /** 门的中心高度 */
  static readonly DOOR_Y = 0.5;
  private zzz: THREE.Sprite[] = [];
  // 正面的状态牌:门洞周围三段弧形的量表(饱、精力、水),门楣上一块小牌子写着它现在在干什么
  private static readonly PX = 360; // 状态牌画布上每个身长单位的像素数
  private panel = document.createElement('canvas');
  private panelTexture = new THREE.CanvasTexture(this.panel);
  private panelKey = '';

  constructor() {
    const w = House.WIDTH / 2;
    const wall = 0.82; // 墙高
    const outline = () => {
      const shape = new THREE.Shape();
      shape.moveTo(-w, 0);
      shape.lineTo(w, 0);
      shape.lineTo(w, wall);
      shape.lineTo(0, House.HEIGHT);
      shape.lineTo(-w, wall);
      shape.closePath();
      return shape;
    };
    const walls = toon('#f4e8d6');
    const roofMat = toon('#dd9379');
    const dark = toon('#6b574b');
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      this.group.add(m);
      return m;
    };
    const d = House.DEPTH / 2;
    // 正面:带圆门洞的墙
    const front = outline();
    const door = new THREE.Path();
    door.absarc(0, House.DOOR_Y, 0.37, 0, Math.PI * 2, true);
    front.holes.push(door);
    add(new THREE.ExtrudeGeometry(front, { depth: 0.05, bevelEnabled: false, curveSegments: 32 }), walls, 0, 0, d - 0.05);
    // 背面和里面:深色,让门洞里看起来是暗的
    add(new THREE.ExtrudeGeometry(outline(), { depth: 0.04, bevelEnabled: false }), dark, 0, 0, -d);
    for (const side of [-1, 1]) add(new THREE.BoxGeometry(0.05, wall, House.DEPTH), walls, side * (w - 0.025), wall / 2);
    add(new THREE.BoxGeometry(House.WIDTH, 0.04, House.DEPTH), dark, 0, 0.02);
    // 屋顶:两块斜板,比墙宽出一点
    const slope = Math.atan2(House.HEIGHT - wall, w);
    const len = Math.hypot(House.HEIGHT - wall, w) + 0.16;
    for (const side of [-1, 1]) {
      const roof = add(new THREE.BoxGeometry(len, 0.07, House.DEPTH + 0.14), roofMat, side * (w / 2 + 0.03), (House.HEIGHT + wall) / 2 + 0.03);
      roof.rotation.z = -side * slope;
    }
    // 状态牌:贴在正面墙上的一层透明画布
    this.panel.width = Math.round(House.WIDTH * House.PX);
    this.panel.height = Math.round(House.HEIGHT * House.PX);
    this.panelTexture.colorSpace = THREE.SRGBColorSpace;
    this.panelTexture.anisotropy = 4;
    add(
      new THREE.PlaneGeometry(House.WIDTH, House.HEIGHT),
      new THREE.MeshBasicMaterial({ map: this.panelTexture, transparent: true, depthWrite: false }),
      0, House.HEIGHT / 2, d + 0.01
    );
    // 睡着时从屋顶飘出来的 Zzz
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.font = 'bold 52px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#ffffff';
    ctx.strokeText('z', 32, 30);
    ctx.fillStyle = '#7d8fb5';
    ctx.fillText('z', 32, 30);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    for (let i = 0; i < 3; i++) {
      const z = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
      z.visible = false;
      this.zzz.push(z);
      this.group.add(z);
    }
  }

  /** 更新正面的状态牌。量表都是 0..1(越满越好);low 是哪几项已经低到会影响它的行为;label 是它现在在干什么 */
  setStatus(status: { food: number; energy: number; water: number; low: { food: boolean; energy: boolean; water: boolean }; label: string }) {
    const step = (v: number) => Math.round(THREE.MathUtils.clamp(v, 0, 1) * 50) / 50; // 变化够大才重画
    const meters = [
      // 从左下顺时针绕门洞一圈:饱 → 精力 → 水。start 是图标所在的角度
      { icon: '🍖', value: step(status.food), low: status.low.food, color: '#e8954a', start: 232 },
      { icon: '⚡', value: step(status.energy), low: status.low.energy, color: '#7fb85a', start: 132 },
      { icon: '💧', value: step(status.water), low: status.low.water, color: '#5b9fd8', start: 32 },
    ];
    const key = meters.map((m) => `${m.value}${m.low ? '!' : ''}`).join('|') + status.label;
    if (key === this.panelKey) return;
    this.panelKey = key;

    const px = House.PX;
    const ctx = this.panel.getContext('2d')!;
    const X = (x: number) => (x + House.WIDTH / 2) * px;
    const Y = (y: number) => (House.HEIGHT - y) * px;
    const rad = (deg: number) => (-deg * Math.PI) / 180; // 画布的 y 朝下,角度要反过来
    ctx.clearRect(0, 0, this.panel.width, this.panel.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const R = 0.42; // 门洞半径是 0.37,量表紧贴着它外面绕
    ctx.lineCap = 'round';
    ctx.lineWidth = 0.05 * px;
    for (const m of meters) {
      const from = m.start - 14;
      const sweep = 76;
      ctx.strokeStyle = 'rgba(107, 87, 75, 0.2)';
      ctx.beginPath();
      ctx.arc(X(0), Y(House.DOOR_Y), R * px, rad(from), rad(from - sweep));
      ctx.stroke();
      if (m.value > 0) {
        ctx.strokeStyle = m.low ? '#d9534f' : m.color;
        ctx.beginPath();
        ctx.arc(X(0), Y(House.DOOR_Y), R * px, rad(from), rad(from - sweep * m.value));
        ctx.stroke();
      }
      ctx.font = `${0.115 * px}px "Apple Color Emoji", sans-serif`;
      ctx.fillStyle = '#000000';
      const a = (m.start * Math.PI) / 180;
      ctx.fillText(m.icon, X(Math.cos(a) * R), Y(House.DOOR_Y + Math.sin(a) * R));
    }

    // 门楣上的小牌子
    const w = 0.44 * px;
    const h = 0.14 * px;
    ctx.fillStyle = '#8a6a55';
    ctx.beginPath();
    ctx.roundRect(X(0) - w / 2, Y(1.035) - h / 2, w, h, h / 2);
    ctx.fill();
    ctx.font = `600 ${0.092 * px}px -apple-system, "PingFang SC", sans-serif`;
    ctx.fillStyle = '#fff6e8';
    ctx.fillText(status.label, X(0), Y(1.035) + 0.004 * px, w - 0.06 * px);
    this.panelTexture.needsUpdate = true;
  }

  /** asleep:猫是否在里面睡着;t:时间(秒) */
  update(asleep: boolean, t: number) {
    this.zzz.forEach((z, i) => {
      z.visible = asleep;
      const u = (t * 0.35 + i / 3) % 1; // 每个 z 从屋顶边往上飘、变大、变淡
      z.position.set(0.5 + u * 0.35 + Math.sin(u * 6 + i) * 0.04, House.HEIGHT - 0.05 + u * 0.6, House.DEPTH / 2 + 0.05);
      z.scale.setScalar(0.12 + u * 0.14);
      (z.material as THREE.SpriteMaterial).opacity = Math.sin(u * Math.PI);
    });
  }
}

/** 逗猫棒的小座子:平时逗猫棒插在里面,点一下拿起来,再点一下座子放回去 */
export class WandStand {
  readonly group = new THREE.Group();
  private resting = new THREE.Group();

  constructor() {
    const cup = [[0, 0], [0.085, 0], [0.07, 0.13], [0.058, 0.13], [0.058, 0.02], [0, 0.02]].map(([x, y]) => new THREE.Vector2(x, y));
    this.group.add(new THREE.Mesh(new THREE.LatheGeometry(cup, 24), toon('#d9c7e6')));
    // 插在座子里的逗猫棒:一根斜着的细杆,杆头垂下一个粉色毛球
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.62, 8), toon('#8a8f98'));
    stick.position.set(0.07, 0.33, 0);
    stick.rotation.z = -0.22;
    this.resting.add(stick);
    for (const [r, x, y, color] of [[0.062, 0.2, 0.5, '#e3457f'], [0.055, 0.215, 0.42, '#d93a75']] as const) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), toon(color));
      puff.position.set(x, y, 0);
      this.resting.add(puff);
    }
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.1, 6), toon('#c0306c'));
    cord.position.set(0.17, 0.6, 0);
    cord.rotation.z = 1.0;
    this.resting.add(cord);
    this.group.add(this.resting);
  }

  /** 逗猫棒被拿走时,座子是空的 */
  setHeld(held: boolean) {
    this.resting.visible = !held;
  }
}

/** 逗猫棒:一个挂在鼠标下面晃的粉色毛球,和一根连到鼠标的线 */
export class Wand {
  readonly toy = new THREE.Group();
  readonly string: THREE.Line;
  /** 挂在某个位置时,挂点上的小图钉 */
  readonly pin: THREE.Mesh;
  readonly pos = new THREE.Vector2();
  private vel = new THREE.Vector2();
  private points = new Float32Array(6);

  constructor(scale: number) {
    const puff = (r: number, x: number, y: number, color: string) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), toon(color));
      m.position.set(x, y, 0);
      this.toy.add(m);
    };
    puff(0.07, 0, 0.03, '#e3457f');
    puff(0.065, 0.02, -0.06, '#d93a75');
    puff(0.02, 0, 0.1, '#9a9a9a');
    this.toy.scale.setScalar(scale);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.points, 3));
    this.string = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#c0306c' }));
    this.string.frustumCulled = false;
    this.pin = new THREE.Mesh(new THREE.SphereGeometry(0.03 * scale, 14, 10), toon('#c0306c'));
  }

  /** 玩具被弹簧拉向挂点(鼠标,或挂住的位置)下方一点,所以会晃 */
  update(dt: number, mouseX: number, mouseY: number, scale: number) {
    this.pin.position.set(mouseX, mouseY, 60);
    const tx = mouseX;
    const ty = Math.max(0.1 * scale, mouseY - 0.45 * scale);
    this.vel.x += ((tx - this.pos.x) * 70 - this.vel.x * 6) * dt;
    this.vel.y += ((ty - this.pos.y) * 70 - this.vel.y * 6) * dt;
    this.pos.addScaledVector(this.vel, dt);
    this.toy.position.set(this.pos.x, this.pos.y, 60);
    this.points.set([mouseX, mouseY, 60, this.pos.x, this.pos.y + 0.1 * scale, 60]);
    this.string.geometry.attributes.position.needsUpdate = true;
  }

  /** 被爪子拍到:弹开 */
  knock(dx: number, dy: number) {
    this.vel.x += dx;
    this.vel.y += dy;
  }

  reset(x: number, y: number) {
    this.pos.set(x, y);
    this.vel.set(0, 0);
  }
}

/** 一个可以滚、可以弹的小球:猫自己会去玩,也可以捡起来扔到别处 */
export class Ball {
  static readonly R = 0.085; // 半径(身长单位)
  readonly group = new THREE.Group();
  readonly pos = new THREE.Vector2(); // 球心(像素)
  readonly vel = new THREE.Vector2();

  constructor(scale: number) {
    this.group.add(new THREE.Mesh(new THREE.SphereGeometry(Ball.R, 24, 16), toon('#58b7c4')));
    // 两道交叉的浅色条纹,滚起来才看得出在转
    for (const axis of ['x', 'y'] as const) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(Ball.R * 0.97, Ball.R * 0.13, 8, 32), toon('#f6f1e4'));
      band.rotation[axis] = Math.PI / 2;
      this.group.add(band);
    }
    this.group.scale.setScalar(scale);
  }

  /** held:正被鼠标拿着(这时位置由鼠标决定,不受重力) */
  update(dt: number, width: number, scale: number, held: boolean) {
    const r = Ball.R * scale;
    if (!held) {
      this.vel.y -= 2600 * dt;
      this.pos.addScaledVector(this.vel, dt);
      if (this.pos.y <= r) {
        // 落地:弹几下,然后在地上滚,慢慢停下来
        this.pos.y = r;
        this.vel.y = this.vel.y < -90 ? -this.vel.y * 0.55 : 0;
        this.vel.x *= Math.exp(-1.8 * dt);
        if (Math.abs(this.vel.x) < 4) this.vel.x = 0;
      }
      if (this.pos.x < r + 8 || this.pos.x > width - r - 8) {
        // 碰到屏幕边缘弹回来
        this.pos.x = THREE.MathUtils.clamp(this.pos.x, r + 8, width - r - 8);
        this.vel.x *= -0.6;
      }
      this.group.rotation.z -= (this.vel.x * dt) / r;
    }
    this.group.position.set(this.pos.x, this.pos.y, 60);
  }

  knock(dx: number, dy: number) {
    this.vel.x += dx;
    this.vel.y += dy;
  }
}
