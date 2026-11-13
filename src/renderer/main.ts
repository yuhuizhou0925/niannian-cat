import * as THREE from 'three';
import { Cat } from './cat';
import { Stage } from './stage';
import { CatLook, DEFAULT_LOOK } from './look';
import { Ball, Bowl, CatTree, DEFAULT_TREE, House, PropKind, TreeLibrary, Wand, WandStand, activeTree, cleanLibrary } from './props';
import { crunchSound, hissSound, lapSound, setMuted } from './sounds';

declare global {
  interface Window {
    desktop?: {
      setClickThrough(through: boolean): void;
      getLook(): Promise<Partial<CatLook> | null>;
      saveLook(look: CatLook): Promise<void>;
      onLookChanged(cb: (look: Partial<CatLook>) => void): void;
      onCommand(cb: (command: string, value?: boolean | number) => void): void;
      getTestImage(): Promise<string | null>;
      getDebugYaw(): Promise<string | null>;
      getDebug(): Promise<string | null>;
      reportSize(size: number): void;
      setWandHeld(held: boolean): void;
      getTrees(): Promise<Partial<TreeLibrary> | null>;
      saveTrees(library: TreeLibrary): Promise<void>;
      onTreesChanged(cb: (library: Partial<TreeLibrary>) => void): void;
    };
  }
}

// 场景用像素做单位:原点在窗口左下角,猫沿窗口底边(Dock 上方)活动。
// 一个"身长"单位对应的像素。菜单里可以选整体大小,选完会重新加载这个窗口
const SIZE_KEY = 'cat-size';
const SIZE = THREE.MathUtils.clamp(Number(localStorage.getItem(SIZE_KEY)) || 0.75, 0.5, 1.2); // 默认是"中"
const SCALE = 170 * SIZE;
window.desktop?.reportSize(SIZE); // 让菜单里的选中项和实际一致
const WALK = 0.36; // 走路速度,身长/秒
const RUN = 0.95; // 追逗猫棒时的速度
const YAW_RIGHT = -0.45; // 朝右时略微转向镜头,看起来是 3/4 侧面
const YAW_LEFT = -(Math.PI - 0.45);
const MARGIN = 160;
const STORE_KEY = 'cat-world';

const stage = new Stage(document.body);
const { scene, camera } = stage;
const useLine = () => stage.setLine(cat.lineColor, 1.5, 0.03 * SCALE);

let cat = new Cat(DEFAULT_LOOK);
cat.root.scale.setScalar(SCALE);
scene.add(cat.root);
useLine();

function setLook(partial: Partial<CatLook>) {
  const next = new Cat({ ...DEFAULT_LOOK, ...partial });
  next.root.scale.setScalar(SCALE);
  next.root.position.copy(cat.root.position);
  next.root.rotation.copy(cat.root.rotation);
  scene.remove(cat.root);
  cat.dispose();
  cat = next;
  scene.add(cat.root);
  useLine();
}
window.desktop?.getLook().then((look) => look && setLook(look));
window.desktop?.onLookChanged(setLook);

// 脚下的接触阴影(屏幕空间的扁椭圆)
const shadow = new THREE.Mesh(
  new THREE.CircleGeometry(0.58 * SCALE, 40),
  new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.2, depthWrite: false })
);
shadow.scale.y = 0.1;
shadow.position.z = -400;
stage.under.add(shadow);

let W = 1;
let H = 1;
function resize() {
  W = window.innerWidth;
  H = window.innerHeight;
  stage.resize(W, H);
}
window.addEventListener('resize', resize);
resize();

// ---------- 世界:道具的位置、盆里还剩多少、猫有多饿多渴 ----------
interface World {
  food: number; // 食盆里的猫粮 0..1
  water: number;
  hunger: number; // 0 饱 .. 1 很饿
  thirst: number;
  energy: number; // 1 精神 .. 0 累坏了
  x: Record<PropKind, number>; // 道具的横向位置(像素)
  tree: boolean; // 是否摆出猫爬架
  toy: { x: number; y: number } | null; // 逗猫棒挂在哪(像素);null 表示在座子里或在手上
  ball: { x: number }; // 小球停在哪
  savedAt: number;
}
const HUNGER_RATE = 1 / 360; // 六分钟从饱到很饿
const TIRE_RATE = 1 / 420; // 醒着七分钟从精神到很累,玩的时候累得更快
const SLEEP_RATE = 1 / 75; // 睡一分多钟就恢复
const THIRST_RATE = 1 / 300;

function loadWorld(): World {
  const fresh: World = {
    food: 1, water: 1, hunger: 0.3, thirst: 0.3, energy: 0.8,
    x: { food: W * 0.56, water: W * 0.56 + 0.55 * SCALE, tree: W * 0.8, wand: W * 0.44, house: W * 0.14 },
    tree: true, toy: null, ball: { x: W * 0.14 + (House.WIDTH / 2 + 0.35) * SCALE }, savedAt: Date.now(),
  };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null') as World | null;
    if (!saved) return fresh;
    // 关着的这段时间,猫也在慢慢变饿变渴
    const away = Math.max(0, (Date.now() - saved.savedAt) / 1000);
    return {
      ...fresh, ...saved, x: { ...fresh.x, ...saved.x },
      hunger: Math.min(1, saved.hunger + away * HUNGER_RATE),
      thirst: Math.min(1, saved.thirst + away * THIRST_RATE),
      energy: Math.min(1, saved.energy + away * SLEEP_RATE), // 关着的时候当它在睡觉
    };
  } catch {
    return fresh;
  }
}
const world = loadWorld();
function saveWorld() {
  world.savedAt = Date.now();
  world.ball = { x: ball.pos.x };
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(world));
  } catch {
    /* 存不了不影响玩 */
  }
}
setInterval(saveWorld, 5000);

const HOUSE_Z = -230; // 房子放在最靠后的一层;猫睡觉时待在房子里面,所以只能从门洞里看到它
const bowls = { food: new Bowl('food'), water: new Bowl('water') };
let tree = new CatTree(DEFAULT_TREE);
const treeHolder = new THREE.Group(); // 爬架自己带着整体大小的缩放,所以外面再套一层来放位置和像素缩放
treeHolder.add(tree.group);
const props = new THREE.Group();
scene.add(props);
const stand = new WandStand();
const house = new House();
const KINDS: PropKind[] = ['food', 'water', 'tree', 'wand', 'house'];
const propGroup: Record<PropKind, THREE.Group> = { food: bowls.food.group, water: bowls.water.group, tree: treeHolder, wand: stand.group, house: house.group };
const PROP_HALF: Record<PropKind, number> = { food: 0.19 * SCALE, water: 0.19 * SCALE, tree: tree.halfWidth * SCALE, wand: 0.3 * SCALE, house: (House.WIDTH / 2 + 0.1) * SCALE };
for (const kind of KINDS) {
  propGroup[kind].scale.setScalar(SCALE);
  propGroup[kind].userData.kind = kind;
  props.add(propGroup[kind]);
}
function placeProps() {
  for (const kind of KINDS) {
    world.x[kind] = THREE.MathUtils.clamp(world.x[kind], PROP_HALF[kind], W - PROP_HALF[kind]);
    // 道具放在猫的后面一点,猫从它们前面走过
    propGroup[kind].position.set(world.x[kind], 0, kind === 'tree' ? -110 : kind === 'house' ? HOUSE_Z : -70);
  }
  treeHolder.visible = world.tree;
  bowls.food.setLevel(world.food);
  bowls.water.setLevel(world.water);
}
placeProps();
/** 爬架第 n 层平台的位置(像素),n 从 1 开始,从低到高 */
const platform = (n: number) => ({ x: world.x.tree + tree.platforms[n - 1].x * SCALE, y: tree.platforms[n - 1].y * SCALE });

/** 换一个猫爬架(用户在"定制猫爬架"里改了之后) */
function setTree(library: Partial<TreeLibrary>) {
  treeHolder.remove(tree.group);
  tree.dispose();
  tree = new CatTree(activeTree(cleanLibrary(library)));
  treeHolder.add(tree.group);
  PROP_HALF.tree = tree.halfWidth * SCALE;
  placeProps();
  // 猫正在架子上的话,架子变了就让它落回地面
  if (level > 0) {
    level = 0;
    descending = false;
    state = 'fall';
    vx = vy = 0;
  }
}
window.desktop?.getTrees().then((library) => library && setTree(library));
window.desktop?.onTreesChanged(setTree);

// 逗猫棒
const wand = new Wand(SCALE);
// 逗猫棒有三种状态:插在座子里;拿在手上(毛球跟着鼠标);挂在某个位置(猫自己会去玩)
let wandOn = false; // 是否拿在手上
let toyShown = false;
const toyOut = () => wandOn || world.toy !== null;

// 小球:平时放在房子旁边
const ball = new Ball(SCALE);
ball.pos.set(world.ball.x, Ball.R * SCALE);
scene.add(ball.group);

// 猫能玩的东西有三样:逗猫棒、小球、爬架上挂着的小球。它们都有一个位置,都能被拍一下
interface Thing {
  pos: THREE.Vector2;
  knock(dx: number, dy: number): void;
}
const treeToy: Thing = { pos: new THREE.Vector2(), knock: (dx) => tree.knockToy(dx) };
let thing: Thing = wand; // 现在在玩(或者上一次玩)的是哪一样
/** 现在玩的这样东西还在不在(逗猫棒被收回、球被捡走、爬架被收起来,就没得玩了) */
const thingOut = () => (thing === wand ? toyOut() : thing === ball ? dragging !== 'ball' : world.tree && tree.toy !== null);

/** 状态变了之后:更新座子、毛球的显示,通知主进程(拿在手上时 Esc 可以放回去),更新点击穿透 */
function refreshWand() {
  stand.setHeld(toyOut());
  if (toyOut() !== toyShown) {
    toyShown = toyOut();
    if (toyShown) {
      scene.add(wand.toy, wand.pin);
      stage.under.add(wand.string);
    } else {
      scene.remove(wand.toy, wand.pin);
      stage.under.remove(wand.string);
    }
  }
  wand.pin.visible = !wandOn;
  window.desktop?.setWandHeld(wandOn);
  updateThrough();
  saveWorld();
}

/** on:拿到手上(从座子里,或从挂着的地方取下来);off:放回座子 */
function setWand(on: boolean) {
  if (on) {
    if (wandOn) return;
    if (!world.toy) wand.reset(world.x.wand + 0.2 * SCALE, 0.5 * SCALE); // 从座子的位置荡向鼠标
    world.toy = null;
    wandOn = true;
    thing = wand;
    // 猫马上有反应:在地上就立刻开始追;在爬架上就马上下来
    goalLevel = 0;
    if (state === 'sleep' && world.energy > 0.5) wake(); // 睡得差不多了才会被逗起来
    if (level === 0 && ['idle', 'walk', 'sit', 'eat', 'drink'].includes(state) && !tired()) {
      onArrive = null;
      state = 'play';
    } else if (state === 'perch') timer = 0;
  } else {
    if (!toyOut()) return;
    wandOn = false;
    world.toy = null;
    goalLevel = 0;
  }
  refreshWand();
}

/** 把逗猫棒挂在某个位置,手松开;之后猫会自己去玩 */
function pinToy(x: number, y: number) {
  wandOn = false;
  thing = wand;
  world.toy = { x: THREE.MathUtils.clamp(x, 30, W - 30), y: THREE.MathUtils.clamp(y, 0.6 * SCALE, H - 10) };
  playCooldown = 0;
  refreshWand();
}

/** 要玩的东西,猫在地面上够不够得着 */
const toyOnGround = () => thing.pos.y < 2.3 * SCALE;
/** 要玩的东西在爬架的哪一层旁边(猫可以蹲在那一层上玩);没有就是 0 */
function toyLevel() {
  if (!world.tree) return 0;
  for (let n = tree.platforms.length; n >= 1; n--) {
    const p = platform(n);
    const near = Math.abs(thing.pos.x - p.x) < (tree.platforms[n - 1].w / 2 + 0.9) * SCALE;
    if (near && thing.pos.y > p.y + 0.15 * SCALE && thing.pos.y < p.y + 1.7 * SCALE) return n;
  }
  return 0;
}

// ---------- 行为 ----------
// (上次挂着的毛球在下面的启动代码里恢复)
type State = 'sleep' | 'idle' | 'walk' | 'sit' | 'eat' | 'drink' | 'crouch' | 'jump' | 'land' | 'perch' | 'play' | 'stalk' | 'rear' | 'flop' | 'pounce' | 'hiss' | 'held' | 'fall';
let state: State = 'idle';
let timer = 1.2; // 当前状态还要持续多久
let level = 0; // 0 是地面,1 起是爬架从低到高的第几层
let descending = false; // 正在一层一层往下走
let targetX = 0;
let moveSpeed = WALK;
let onArrive: (() => void) | null = null;
let yaw = YAW_RIGHT;
let wantYaw = YAW_RIGHT;
let vx = 0;
let vy = 0;
let soundIn = 0;
let swipeIn = 0;
let reachWeight = 0;
let holdReach = false; // 仅自检用:爪子一直举着,方便截图
let debugPose = false; // 仅自检用:正在摆姿势截图
let stalkIn = 2; // 隔多久再来一次伏击
let swipes = 0; // 这一轮已经拍了几下
let flopAfter = 4; // 拍够这么多下就躺下来抱着玩
let playTimer = 0; // 玩挂着的毛球,这一轮还要玩多久
let playCooldown = 0; // 玩腻了之后,隔多久再去玩
let goalLevel = 0; // 为了玩毛球要爬到爬架的第几层
const jump = { x0: 0, y0: 0, x1: 0, y1: 0, t: 0, dur: 0.5, height: 60, tilt: 0, then: () => {} };
cat.root.position.set(W * 0.3, 0, 0);

const facing = () => (Math.cos(yaw) >= 0 ? 1 : -1);
const face = (dir: number) => (wantYaw = dir >= 0 ? YAW_RIGHT : YAW_LEFT);
const rest = (seconds: number) => {
  state = 'idle';
  timer = seconds;
};

function walkTo(x: number, then: (() => void) | null = null, speed = WALK) {
  targetX = THREE.MathUtils.clamp(x, 80, W - 80);
  face(targetX - cat.root.position.x);
  moveSpeed = speed;
  onArrive = then;
  state = 'walk';
}

/** 跳到某个位置。分三段:先转向并下蹲蓄力,再腾空,落地后缓冲一下 */
function jumpTo(x: number, y: number, to: number, then: () => void) {
  const pos = cat.root.position;
  Object.assign(jump, { x0: pos.x, y0: pos.y, x1: x, y1: y, t: 0, tilt: 0, then });
  const rise = y - pos.y;
  const far = Math.abs(x - pos.x);
  if (rise >= 0) {
    // 往上跳:弧线高一些,时间随距离变长
    jump.height = 45 + rise * 0.18;
    jump.dur = 0.4 + Math.hypot(far, rise) * 0.0009;
  } else {
    // 往下跳:只轻轻一跃就落下去,时间按下落的高度算
    jump.height = 16 + far * 0.04;
    jump.dur = 0.16 + Math.sqrt((2 * -rise) / 2600) + far * 0.0004;
  }
  if (Math.abs(x - pos.x) > 4) face(x - pos.x);
  level = to;
  state = 'crouch';
  timer = 0.28;
}

const perch = () => {
  state = 'perch';
  // 还没爬到要去的那层就只停一下;到了那层就待着玩一阵
  timer = goalLevel > level ? 0.6 : goalLevel === level && goalLevel > 0 ? playTimer : 6 + Math.random() * 10;
};

/** 上下爬架时在地面上的起落点:最低一层平台靠外的那一侧 */
function treeFoot() {
  const lowest = tree.platforms[0];
  const side = lowest.x <= 0 ? -1 : 1;
  return world.x.tree + (lowest.x + side * (lowest.w / 2 + 0.55)) * SCALE;
}

/** 跳到第 n 层(0 是地面)。站在平台上时让身体大致落在平台中间 */
function hopTo(n: number, then: () => void) {
  const pos = cat.root.position;
  if (n === 0) return jumpTo(treeFoot(), 0, 0, then);
  const p = platform(n);
  const dir = Math.abs(p.x - pos.x) > 0.25 * SCALE ? Math.sign(p.x - pos.x) : facing();
  jumpTo(p.x - dir * 0.4 * SCALE, p.y, n, then);
}

function climb() {
  descending = false;
  walkTo(treeFoot(), () => hopTo(1, perch));
}

/** 往下走一层;到了中间的平台先停一下再继续 */
function climbDown() {
  if (level <= 0) return;
  descending = true;
  if (level === 1) {
    hopTo(0, () => {
      descending = false;
      rest(0.5);
    });
  } else {
    hopTo(level - 1, () => {
      state = 'perch';
      timer = 0.7 + Math.random() * 0.5;
    });
  }
}

function goEat(kind: 'food' | 'water') {
  const dir = Math.sign(world.x[kind] - cat.root.position.x) || 1;
  // 走到嘴正好在盆上方的位置
  walkTo(world.x[kind] - dir * 0.99 * SCALE, () => {
    face(dir);
    state = kind === 'food' ? 'eat' : 'drink';
    soundIn = 0.4;
  });
}

const tired = () => world.energy < 0.22;

/** 走到房子门口,钻进去睡觉 */
function goSleep() {
  walkTo(world.x.house, () => {
    state = 'sleep';
    wantYaw = -Math.PI / 2; // 转过来脸朝外
  });
}

/** 醒过来,从房子里出来 */
function wake() {
  if (state !== 'sleep') return;
  cat.root.position.z = 0;
  face(Math.random() < 0.5 ? 1 : -1);
  rest(0.8);
}

const wantsFood = () => world.hunger > 0.6 && world.food > 0.03;
const wantsWater = () => world.thirst > 0.6 && world.water > 0.03;

/** 闲下来时决定接下来干什么 */
function decide() {
  if (level > 0) return perch();
  if (tired()) return goSleep(); // 累了先睡觉,这时候逗它也不玩
  if (wandOn) {
    thing = wand;
    state = 'play';
    return;
  }
  if (wantsFood()) return goEat('food');
  if (wantsWater()) return goEat('water');
  if (playCooldown <= 0) {
    // 自己找东西玩:小球一直都在;挂着的逗猫棒最吸引它;爬架上的小球也算一样
    const options: Thing[] = [ball];
    if (world.toy) options.push(wand, wand);
    if (world.tree && tree.toy) options.push(treeToy);
    thing = options[Math.floor(Math.random() * options.length)];
    // 够得着就在地上玩,在爬架旁边就爬上去玩
    playTimer = 8 + Math.random() * 7;
    if (toyOnGround()) {
      state = 'play';
      return;
    }
    goalLevel = toyLevel();
    if (goalLevel) return climb();
    playCooldown = 15; // 够不着,过会儿再看
  }
  const roll = Math.random();
  if (roll < 0.5) {
    const x = cat.root.position.x;
    let next = x;
    for (let i = 0; i < 8 && Math.abs(next - x) < 220; i++) next = MARGIN + Math.random() * Math.max(1, W - MARGIN * 2);
    walkTo(next, () => rest(1.5 + Math.random() * 3));
  } else if (roll < 0.72 && world.tree) {
    climb();
  } else {
    state = 'sit';
    timer = 4 + Math.random() * 6;
  }
}

/** 用户动了某样玩具(扔了球、拨了一下爬架上的小球):猫要是闲着,马上过来玩 */
function playWith(target: Thing) {
  if (wandOn) return; // 手上拿着逗猫棒时,它只盯着逗猫棒
  thing = target;
  playCooldown = 0;
  if (tired()) return;
  if (state === 'perch') {
    goalLevel = 0;
    timer = 0; // 在爬架上:先下来
  } else if (level === 0 && ['idle', 'walk', 'sit'].includes(state)) {
    playTimer = 8 + Math.random() * 7;
    onArrive = null;
    if (toyOnGround()) state = 'play';
    else {
      goalLevel = toyLevel();
      if (goalLevel) climb();
    }
  }
}

function hiss() {
  if (['held', 'fall', 'crouch', 'jump', 'land', 'pounce', 'hiss', 'sleep'].includes(state)) return;
  state = 'hiss';
  timer = 1.7;
  onArrive = null;
  hissSound();
}

/** 房子状态牌上写的那几个字:它现在在干什么,或者它现在最想要什么 */
function statusLabel(perchPlay: boolean) {
  if (state === 'sleep') return '睡觉中';
  if (state === 'held' || state === 'fall') return '放我下来';
  if (state === 'hiss') return '生气了';
  if (state === 'eat') return '吃饭中';
  if (state === 'drink') return '喝水中';
  if (['play', 'pounce', 'stalk', 'rear', 'flop'].includes(state) || perchPlay) return '玩耍中';
  if (tired()) return '困了';
  if (world.hunger > 0.6) return world.food > 0.03 ? '饿了' : '没粮了';
  if (world.thirst > 0.6) return world.water > 0.03 ? '渴了' : '没水了';
  if (level > 0) return '爬架上';
  if (state === 'walk') return '散步中';
  return '发呆中';
}

// ---------- 鼠标 ----------
const mouse = new THREE.Vector2(-9999, -9999); // 场景坐标(像素)
const mouseVel = new THREE.Vector2();
const grab = new THREE.Vector2();
const ndc = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
let through = true;
type Target = 'cat' | PropKind | 'toy' | 'ball';
let press: { x: number; y: number; at: number; on: Target } | null = null;
let dragging: PropKind | 'toy' | 'ball' | null = null;
let dragOffset = 0;
let dragOffsetY = 0;
const pokes: number[] = [];

function pick(): Target | null {
  ndc.set((mouse.x / W) * 2 - 1, (mouse.y / H) * 2 - 1);
  raycaster.setFromCamera(ndc, camera);
  // 挂着的毛球和图钉也能点、能拖(判定范围比模型大一点,好点中)
  if (world.toy && (Math.hypot(mouse.x - wand.pos.x, mouse.y - wand.pos.y) < 0.16 * SCALE || Math.hypot(mouse.x - world.toy.x, mouse.y - world.toy.y) < 0.08 * SCALE)) return 'toy';
  if (Math.hypot(mouse.x - ball.pos.x, mouse.y - ball.pos.y) < 0.15 * SCALE) return 'ball';
  if (raycaster.intersectObject(cat.root, true).length) return 'cat';
  const hit = raycaster.intersectObject(props, true)[0];
  if (!hit) return null;
  let obj: THREE.Object3D | null = hit.object;
  while (obj && !obj.userData.kind) obj = obj.parent;
  return obj && obj.visible ? (obj.userData.kind as PropKind) : null;
}

/** 鼠标点击该给谁:拿着逗猫棒时整个屏幕的点击都归桌宠(不然会点到后面的窗口);
 *  平时只有鼠标在猫或道具上、或正拖着什么时才接收,其余位置穿透到桌面 */
function updateThrough() {
  setThrough(!(wandOn || state === 'held' || dragging || press || pick()));
}

function setThrough(next: boolean) {
  if (next === through) return;
  through = next;
  window.desktop?.setClickThrough(next);
}

let lastMoveAt = performance.now();
window.addEventListener('mousemove', (e) => {
  if (debugPose) return; // 自检时玩具的位置是定好的,不跟真的鼠标走
  const now = performance.now();
  const dt = Math.max(1, now - lastMoveAt) / 1000;
  lastMoveAt = now;
  const x = e.clientX;
  const y = H - e.clientY;
  if (mouse.x > -9000) {
    mouseVel.x = THREE.MathUtils.lerp(mouseVel.x, (x - mouse.x) / dt, 0.4);
    mouseVel.y = THREE.MathUtils.lerp(mouseVel.y, (y - mouse.y) / dt, 0.4);
  }
  mouse.set(x, y);

  if (press && Math.hypot(x - press.x, y - press.y) > 6) {
    // 按住并拖动:拎起猫,或者挪动道具
    if (press.on === 'cat') {
      cat.root.position.z = 0; // 睡着时被拎起来,就从房子里出来了
      state = 'held';
      level = 0;
      descending = false;
      onArrive = null;
      grab.set(cat.root.position.x - mouse.x, cat.root.position.y - mouse.y);
      mouseVel.set(0, 0);
    } else if (press.on === 'toy' && world.toy) {
      dragging = 'toy';
      dragOffset = world.toy.x - x;
      dragOffsetY = world.toy.y - y;
    } else if (press.on === 'ball') {
      dragging = 'ball'; // 捡起小球
    } else if (press.on !== 'toy') {
      dragging = press.on;
      dragOffset = world.x[dragging] - x;
    }
    press = null;
  }
  if (dragging === 'toy') {
    // 拖着挂点走,毛球跟着荡
    world.toy = { x: THREE.MathUtils.clamp(x + dragOffset, 30, W - 30), y: THREE.MathUtils.clamp(y + dragOffsetY, 0.6 * SCALE, H - 10) };
  } else if (dragging === 'ball') {
    ball.pos.set(x, Math.max(y, Ball.R * SCALE));
    ball.vel.set(0, 0);
  } else if (dragging) {
    world.x[dragging] = x + dragOffset;
    placeProps();
  }
  updateThrough();
});

window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('mousedown', (e) => {
  if (wandOn) {
    // 拿着逗猫棒时:点座子或点右键是放回座子(按 Esc 也行);点其他任何位置是把它挂在那儿
    if (e.button === 2 || pick() === 'wand') setWand(false);
    else pinToy(mouse.x, mouse.y);
    return;
  }
  if (e.button !== 0) return;
  const on = pick();
  if (on) press = { x: mouse.x, y: mouse.y, at: performance.now(), on };
});

window.addEventListener('mouseup', () => {
  if (state === 'held') {
    state = 'fall';
    vx = THREE.MathUtils.clamp(mouseVel.x, -900, 900);
    vy = THREE.MathUtils.clamp(mouseVel.y, -900, 900);
  } else if (dragging) {
    const wasBall = dragging === 'ball';
    dragging = null;
    if (wasBall) {
      // 松手:球带着鼠标的速度飞出去(轻轻放下就是原地落下),猫看到了会过来玩
      ball.vel.set(THREE.MathUtils.clamp(mouseVel.x, -1400, 1400), THREE.MathUtils.clamp(mouseVel.y, -1400, 1400));
      playWith(ball);
    }
    saveWorld();
  } else if (press) {
    // 没拖动就松手,是一次点击
    if (press.on === 'food' || press.on === 'water') {
      world[press.on] = 1;
      placeProps();
      saveWorld();
    } else if (press.on === 'wand') {
      // 点座子:逗猫棒在座子里就拿起来;不在(挂在别处)就收回座子
      setWand(!toyOut());
    } else if (press.on === 'ball') {
      // 点一下小球:把它踢出去
      ball.knock((Math.random() < 0.5 ? -1 : 1) * (220 + Math.random() * 160), 420);
      playWith(ball);
    } else if (press.on === 'tree' && tree.toy) {
      // 点一下爬架:拨一下上面挂着的小球
      tree.knockToy((Math.random() < 0.5 ? -1 : 1) * 260);
      playWith(treeToy);
    } else if (press.on === 'house') {
      wake(); // 点一下房子:叫醒它
    } else if (press.on === 'toy') {
      // 点挂着的毛球:取下来拿在手上
      setWand(true);
    } else if (press.on === 'cat' && state === 'sleep') {
      wake();
    } else if (press.on === 'cat') {
      // 连着戳它三下,它会哈气
      const now = performance.now();
      pokes.push(now);
      while (pokes.length && now - pokes[0] > 2500) pokes.shift();
      if (pokes.length >= 3) {
        pokes.length = 0;
        hiss();
      }
    }
  }
  press = null;
  updateThrough();
});

window.desktop?.onCommand((command, value) => {
  if (command === 'feed') world.food = 1;
  else if (command === 'water') world.water = 1;
  else if (command === 'wand') setWand(Boolean(value));
  else if (command === 'hiss') hiss();
  else if (command === 'tree') {
    world.tree = Boolean(value);
    if (!world.tree && level > 0) {
      level = 0;
      descending = false;
      state = 'fall';
      vx = vy = 0;
    }
  } else if (command === 'mute') setMuted(Boolean(value));
  else if (command === 'size') {
    localStorage.setItem(SIZE_KEY, String(value));
    saveWorld();
    location.reload();
    return;
  }
  placeProps();
  saveWorld();
});

// ---------- 主循环 ----------
const headPos = new THREE.Vector3();
const gaze = new THREE.Vector2();
const reach = { x: 0, y: 0 };
let lastFrame = performance.now();

function tick() {
  const frameNow = performance.now();
  const dt = Math.min((frameNow - lastFrame) / 1000, 0.05);
  lastFrame = frameNow;
  const pos = cat.root.position;

  world.hunger = Math.min(1, world.hunger + dt * HUNGER_RATE);
  world.thirst = Math.min(1, world.thirst + dt * THIRST_RATE);
  const playing = state === 'play' || state === 'pounce' || state === 'stalk' || state === 'rear' || state === 'flop';
  const busy = playing;
  if (state === 'sleep') world.energy = Math.min(1, world.energy + dt * SLEEP_RATE);
  else world.energy = Math.max(0, world.energy - dt * TIRE_RATE * (busy ? 3 : 1));
  house.update(state === 'sleep' && Math.abs(yaw - wantYaw) < 0.3, frameNow / 1000);
  if (wandOn && mouse.x > -9000) wand.update(dt, mouse.x, mouse.y, SCALE);
  else if (world.toy) wand.update(dt, world.toy.x, world.toy.y, SCALE);
  ball.update(dt, W, SCALE, dragging === 'ball');
  tree.updateToy(dt);
  tree.toyPosition(treeToy.pos).multiplyScalar(SCALE);
  treeToy.pos.x += world.x.tree;
  if (wandOn) thing = wand;
  playCooldown -= dt;
  // 拿着逗猫棒但鼠标 40 秒没动:自己放回座子,把屏幕的点击还给桌面
  if (wandOn && frameNow - lastMoveAt > 40000) setWand(false);
  const toy = thing.pos;
  reachWeight = 0;

  if (state === 'sleep') {
    // 待在房子里面(跟着房子走,所以拖房子时它也跟着),睡够了自己出来
    pos.x = world.x.house;
    pos.y = 0;
    pos.z = THREE.MathUtils.lerp(pos.z, HOUSE_Z - 0.62 * SCALE, 1 - Math.exp(-6 * dt));
    if (world.energy >= 0.98) wake();
  } else if (state === 'idle' || state === 'sit' || state === 'perch') {
    timer -= dt;
    // 蹲着的时候,有逗猫棒、饿了或渴了就不蹲了
    if (state !== 'idle' && (wandOn || wantsFood() || wantsWater() || tired())) timer = Math.min(timer, 0.3);
    if (timer <= 0) {
      if (state === 'perch') {
        const stay = !descending && !wandOn && !wantsFood() && !wantsWater() && !tired();
        if (stay && goalLevel > level) hopTo(level + 1, perch);
        else if (stay && goalLevel === 0 && level < tree.platforms.length && Math.random() < 0.5) hopTo(level + 1, perch);
        else {
          if (goalLevel) playCooldown = 25 + Math.random() * 25; // 玩够了
          goalLevel = 0;
          climbDown();
        }
      } else decide();
    }
  } else if (state === 'walk') {
    if (Math.abs(yaw - wantYaw) < 0.35) {
      const dir = Math.sign(targetX - pos.x);
      pos.x += dir * moveSpeed * SCALE * Math.cos(YAW_RIGHT) * dt;
      // 走过了头,或者本来就已经站在目的地(dir 为 0),都算到了
      if (dir === 0 || Math.sign(targetX - pos.x) !== dir) {
        pos.x = targetX;
        const then = onArrive;
        onArrive = null;
        rest(0.5);
        then?.();
      }
    }
  } else if (state === 'eat' || state === 'drink') {
    const kind = state === 'eat' ? 'food' : 'water';
    const need = state === 'eat' ? 'hunger' : 'thirst';
    world[need] = Math.max(0, world[need] - dt * 0.11);
    world[kind] = Math.max(0, world[kind] - dt * 0.055);
    bowls[kind].setLevel(world[kind]);
    soundIn -= dt;
    if (soundIn <= 0) {
      soundIn = state === 'eat' ? 0.3 + Math.random() * 0.25 : 0.22 + Math.random() * 0.1;
      (state === 'eat' ? crunchSound : lapSound)();
    }
    if (world[need] <= 0.02 || world[kind] <= 0.02) rest(1.5);
  } else if (state === 'crouch') {
    // 蓄力:等转好身、蹲够了再起跳
    timer -= dt;
    if (timer <= 0 && Math.abs(yaw - wantYaw) < 0.3) state = 'jump';
  } else if (state === 'jump') {
    const before = pos.y;
    jump.t = Math.min(1, jump.t + dt / jump.dur);
    const u = jump.t;
    pos.x = THREE.MathUtils.lerp(jump.x0, jump.x1, u);
    pos.y = THREE.MathUtils.lerp(jump.y0, jump.y1, u) + 4 * jump.height * u * (1 - u);
    // 身体顺着运动方向倾斜:上升时头朝上,下落时头朝下
    const speedX = Math.max(60, Math.abs(jump.x1 - jump.x0) / jump.dur);
    jump.tilt = THREE.MathUtils.clamp(Math.atan2((pos.y - before) / Math.max(dt, 1e-3), speedX) * 0.55, -0.55, 0.5);
    if (u >= 1) {
      state = 'land';
      timer = 0.24;
    }
  } else if (state === 'land') {
    // 落地缓冲:蹲一下再站起来
    timer -= dt;
    if (timer <= 0) {
      rest(0.3);
      jump.then();
    }
  } else if (state === 'play') {
    if (!wandOn) playTimer -= dt;
    if (!thingOut() || tired()) rest(0.8); // 玩累了就不玩了,下一步会去睡觉
    else if (!wandOn && playTimer <= 0) {
      playCooldown = 20 + Math.random() * 25; // 玩腻了,歇一阵
      rest(1.5);
    } else {
      // 追着玩具跑,追到跟前就伸爪子拍;玩具举高了就跳起来扑
      const ahead = toy.x - pos.x;
      const dir = Math.sign(ahead) || 1;
      face(dir);
      const gap = Math.abs(ahead) - 0.95 * SCALE; // 玩具离嘴还有多远
      const turned = Math.abs(yaw - wantYaw) < 0.35;
      moveSpeed = gap > 0.5 * SCALE ? RUN : WALK;
      if (turned && gap > 0.12 * SCALE) pos.x += dir * moveSpeed * SCALE * dt;
      else if (turned && gap < -0.35 * SCALE) pos.x -= dir * WALK * SCALE * dt; // 太近了,退一点
      swipeIn -= dt;
      stalkIn -= dt;
      if (turned && stalkIn <= 0 && gap > 0.9 * SCALE && gap < 2.4 * SCALE && toy.y < 1.5 * SCALE) {
        // 隔着一段距离:先趴低盯住,扭扭屁股,再扑过去
        stalkIn = 6 + Math.random() * 6;
        state = 'stalk';
        timer = 0.9 + Math.random() * 0.5;
      } else if (turned && Math.abs(gap) < 0.45 * SCALE) {
        if (toy.y < 1.25 * SCALE) {
          reachWeight = 0.55 + 0.45 * Math.sin(frameNow / 90);
          if (swipeIn <= 0) {
            swipeIn = 0.5 + Math.random() * 0.6;
            thing.knock(dir * 260, 180);
            if (++swipes >= flopAfter) {
              // 拍了几下之后干脆躺下,四脚朝天抱着玩(布偶最爱这样)
              swipes = 0;
              flopAfter = 3 + Math.floor(Math.random() * 4);
              state = 'flop';
              timer = 5 + Math.random() * 3;
            }
          }
        } else if (toy.y < 1.8 * SCALE) {
          // 玩具在头顶上方一点:后腿站起来,两只前爪去拍
          state = 'rear';
          timer = 2 + Math.random() * 2;
        } else if (swipeIn <= 0) {
          // 玩具举得高:跳起来扑,最高跳到两个身长左右
          swipeIn = 1.1 + Math.random() * 0.8;
          state = 'pounce';
          vx = ahead * 0.6;
          vy = Math.sqrt(2 * 2600 * THREE.MathUtils.clamp(toy.y - 0.9 * SCALE, 40, 1.9 * SCALE));
        }
      }
    }
  } else if (state === 'stalk' || state === 'rear' || state === 'flop') {
    if (!wandOn) playTimer -= dt;
    timer -= dt;
    swipeIn -= dt;
    const ahead = toy.x - pos.x;
    const dir = Math.sign(ahead) || 1;
    const gap = Math.abs(ahead) - 0.95 * SCALE;
    if (!thingOut() || tired()) rest(0.8);
    else if (state === 'stalk') {
      face(dir);
      if (gap > 3 * SCALE) state = 'play'; // 玩具跑远了,不等了,直接追
      else if (timer <= 0) {
        // 扑:一个又低又远的跳,正好落在玩具跟前
        vy = Math.sqrt(2 * 2600 * THREE.MathUtils.clamp(toy.y - 0.6 * SCALE, 30, 1.2 * SCALE));
        vx = (ahead - dir * 0.8 * SCALE) / ((2 * vy) / 2600);
        state = 'pounce';
      }
    } else if (state === 'rear') {
      face(dir);
      reachWeight = 0.8 + 0.2 * Math.sin(frameNow / 80);
      if (swipeIn <= 0) {
        swipeIn = 0.35 + Math.random() * 0.4;
        thing.knock(dir * 200, 200);
      }
      if (Math.abs(gap) > 0.7 * SCALE || toy.y < 1.1 * SCALE) state = 'play'; // 玩具走了或放低了,放下前爪
      else if (toy.y > 1.9 * SCALE || timer <= 0) {
        // 够不着,或者站够了:从站姿直接跳起来扑
        swipeIn = 1.1 + Math.random() * 0.8;
        state = 'pounce';
        vx = ahead * 0.6;
        vy = Math.sqrt(2 * 2600 * THREE.MathUtils.clamp(toy.y - 0.9 * SCALE, 40, 1.9 * SCALE));
      }
    } else {
      // 躺着:玩具在够得着的地方就用前爪抱、后腿蹬;玩具走远了就翻身起来接着追
      const near = Math.abs(ahead) < 1.5 * SCALE && toy.y < 1.7 * SCALE;
      reachWeight = near ? 0.75 + 0.25 * Math.sin(frameNow / 110) : 0;
      if (near && swipeIn <= 0) {
        swipeIn = 0.3 + Math.random() * 0.4;
        thing.knock((Math.random() - 0.5) * 320, 200);
      }
      if (timer <= 0 || Math.abs(ahead) > 2.2 * SCALE) {
        state = 'play';
        swipeIn = 0.6; // 留点时间翻身
      } else if (!wandOn && playTimer <= 0) {
        playCooldown = 20 + Math.random() * 25;
        rest(1.5);
      }
    }
  } else if (state === 'pounce') {
    vy -= 2600 * dt;
    pos.x += vx * dt;
    pos.y += vy * dt;
    reachWeight = 1;
    if (Math.hypot(toy.x - (pos.x + facing() * 0.95 * SCALE), toy.y - (pos.y + 0.6 * SCALE)) < 0.4 * SCALE) thing.knock(facing() * 120, 260);
    if (pos.y <= 0) {
      pos.y = 0;
      state = 'play';
    }
  } else if (state === 'hiss') {
    timer -= dt;
    pos.x -= facing() * 40 * dt * Math.max(0, timer - 1.2) * 4; // 先往后缩一下
    if (timer <= 0) (level > 0 ? perch : () => rest(1.2))();
  } else if (state === 'held') {
    pos.x = mouse.x + grab.x;
    pos.y = Math.max(0, mouse.y + grab.y);
  } else if (state === 'fall') {
    const before = pos.y;
    vy -= 2600 * dt;
    pos.x += vx * dt;
    pos.y += vy * dt;
    // 松手时下面正好是爬架的平台:落在平台上,不穿过去
    if (vy <= 0 && world.tree) {
      const body = pos.x + facing() * 0.4 * SCALE; // 身体中间的位置
      for (let n = tree.platforms.length; n >= 1; n--) {
        const p = platform(n);
        if (before >= p.y && pos.y <= p.y && Math.abs(body - p.x) < (tree.platforms[n - 1].w / 2 + 0.25) * SCALE) {
          pos.y = p.y;
          level = n;
          goalLevel = 0;
          descending = false;
          jump.then = perch;
          state = 'land';
          timer = 0.24;
          break;
        }
      }
    }
    if (state === 'fall' && pos.y <= 0) {
      pos.y = 0;
      rest(1 + Math.random() * 2);
    }
  }
  if (state !== 'held') pos.x = THREE.MathUtils.clamp(pos.x, 80, W - 80);

  yaw += (wantYaw - yaw) * (1 - Math.exp(-7 * dt));
  cat.root.rotation.y = yaw;
  const dir = facing();

  // 头和眼睛:有逗猫棒时盯着玩具,否则看鼠标;鼠标在身后时把头转向镜头
  cat.headWorldPosition(headPos);
  const tracking = mouse.x > -9000;
  // 蹲在爬架上玩旁边挂着的毛球:面朝它,伸爪子拍
  const perchPlay = state === 'perch' && goalLevel > 0 && level === goalLevel && thingOut();
  if (perchPlay) {
    face(toy.x - pos.x);
    const ahead = (toy.x - pos.x) * facing();
    const rise = toy.y - pos.y;
    swipeIn -= dt;
    if (ahead > 0.45 * SCALE && ahead < 1.6 * SCALE && rise > -0.1 * SCALE && rise < 1.3 * SCALE) {
      reachWeight = 0.55 + 0.45 * Math.sin(frameNow / 90);
      if (swipeIn <= 0) {
        swipeIn = 0.6 + Math.random() * 0.8;
        thing.knock(facing() * 240, 160);
      }
    }
  }
  house.setStatus({
    food: 1 - world.hunger,
    energy: world.energy,
    water: 1 - world.thirst,
    low: { food: world.hunger > 0.6, energy: tired(), water: world.thirst > 0.6 },
    label: statusLabel(perchPlay),
  });
  const watching = wandOn || (thingOut() && (playing || perchPlay));
  const lookX = watching ? toy.x : mouse.x;
  const lookY = watching ? toy.y : mouse.y;
  const forward = (lookX - headPos.x) * dir;
  const up = lookY - headPos.y;
  const lookPitch = tracking ? THREE.MathUtils.clamp(Math.atan2(up, Math.max(Math.abs(forward), 80)), -0.4, 0.55) : 0;
  const lookYaw = tracking && state !== 'sleep' ? THREE.MathUtils.clamp(-forward / 300, 0, 1) : 0;
  gaze.set(lookX - headPos.x, lookY - headPos.y).divideScalar(260).clampLength(0, 1);

  // 前爪去够玩具的位置,换到猫自己的坐标里
  reach.x = ((toy.x - pos.x) * dir) / SCALE;
  reach.y = (toy.y - pos.y) / SCALE;

  const airborne = state === 'held' || state === 'fall' || state === 'pounce' || state === 'flop';
  const swing = state === 'held' ? THREE.MathUtils.clamp((-mouseVel.x * dir) / 6000, -0.1, 0.1) : 0;
  mouseVel.multiplyScalar(Math.exp(-6 * dt));
  const moving = state === 'walk' || (state === 'play' && Math.abs(toy.x - pos.x) - 0.95 * SCALE > 0.12 * SCALE);

  if (holdReach && reachWeight > 0) reachWeight = 1;
  cat.update(dt, {
    moving, airborne, swing, lookPitch, lookYaw,
    gaze: tracking && state !== 'sleep' ? gaze : undefined,
    sleep: state === 'sleep' ? 1 : 0,
    sit: state === 'sleep' ? 1 : perchPlay ? 0.45 : state === 'sit' || state === 'perch' ? 1 : state === 'crouch' ? 0.75 : state === 'land' ? 0.7 * Math.max(0, timer / 0.24) : 0,
    leap: state === 'jump' ? 1 : 0,
    tilt: state === 'jump' ? jump.tilt : state === 'rear' ? 0.95 : 0,
    stalk: state === 'stalk' ? 1 : 0,
    bothPaws: state === 'rear' || state === 'flop' ? 1 : 0,
    roll: state === 'flop' ? -dir * 2.85 : 0, // 肚皮稍微朝着屏幕这边
    kick: state === 'flop' && reachWeight > 0 ? 1 : 0,
    eat: state === 'eat' || state === 'drink' ? 1 : 0,
    hiss: state === 'hiss' && timer > 0.25 ? 1 : 0,
    reach, reachWeight,
    excite: playing || state === 'pounce' || perchPlay ? 1 : 0,
  }, state === 'play' ? moveSpeed : state === 'walk' ? moveSpeed : WALK);

  // 阴影落在猫脚下那一层(地面或平台)
  const floor = level > 0 && state !== 'jump' && state !== 'crouch' ? platform(level).y : 0;
  shadow.position.x = pos.x + dir * 0.38 * SCALE;
  shadow.position.y = floor + 2;
  const height = Math.min(1, Math.max(0, pos.y - floor) / 400);
  (shadow.material as THREE.MeshBasicMaterial).opacity = state === 'sleep' ? 0 : 0.2 * (1 - height * 0.8);
  shadow.scale.x = 1 - height * 0.4;

  // 只重画有东西的那一条区域;逗猫棒开着时玩具可能在任何地方,就画全屏
  if (wandOn) stage.render();
  else {
    let left = pos.x - 1.6 * SCALE;
    let right = pos.x + 1.6 * SCALE;
    let top = pos.y + 1.9 * SCALE;
    for (const kind of KINDS) {
      if (kind === 'tree' && !world.tree) continue;
      left = Math.min(left, world.x[kind] - PROP_HALF[kind] - 20);
      right = Math.max(right, world.x[kind] + PROP_HALF[kind] + 20);
      if (kind === 'tree') top = Math.max(top, (tree.height + 1.5) * SCALE);
      if (kind === 'house') top = Math.max(top, (House.HEIGHT + 0.9) * SCALE);
    }
    if (world.toy) {
      // 挂着的毛球和它的线也要画进去
      left = Math.min(left, world.toy.x - 0.9 * SCALE, toy.x - 0.3 * SCALE);
      right = Math.max(right, world.toy.x + 0.9 * SCALE, toy.x + 0.3 * SCALE);
      top = Math.max(top, world.toy.y + 40);
    }
    // 小球可能滚到任何地方
    left = Math.min(left, ball.pos.x - 0.3 * SCALE);
    right = Math.max(right, ball.pos.x + 0.3 * SCALE);
    top = Math.max(top, ball.pos.y + 0.3 * SCALE);
    left = Math.max(0, Math.floor(left));
    stage.render({ x: left, y: 0, w: Math.ceil(Math.min(W, right) - left), h: Math.ceil(Math.min(H, top)) });
  }
  requestAnimationFrame(tick);
}

// 上次退出时毛球挂在某处的话,原样挂回去
if (world.toy) {
  wand.reset(world.toy.x, world.toy.y - 0.45 * SCALE);
  refreshWand();
}

// 仅自检用:直接进入某个状态,方便截图检查姿势
window.desktop?.getDebug().then((debug) => {
  if (!debug) return;
  const pos = cat.root.position;
  debugPose = true;
  // 自检时不让它因为饿了、困了或想玩而自己走开
  world.hunger = world.thirst = 0;
  world.energy = 1;
  playCooldown = 9999;
  if (debug === 'sit') {
    state = 'sit';
    timer = 99;
  } else if (debug === 'eat') {
    world.food = 1;
    world.hunger = 1;
    pos.x = world.x.food - 0.99 * SCALE;
    state = 'eat';
  } else if (debug === 'hiss') {
    state = 'hiss';
    timer = 99;
  } else if (debug === 'tree') {
    level = tree.platforms.length;
    pos.set(platform(level).x - 0.4 * SCALE, platform(level).y, 0);
    state = 'perch';
    timer = 99;
  } else if (debug === 'down') {
    // 从最高层开始往下跳,用来检查下台阶的动作
    level = tree.platforms.length;
    pos.set(platform(level).x - 0.4 * SCALE, platform(level).y, 0);
    descending = true;
    state = 'perch';
    timer = 0.15;
  } else if (debug === 'sleep') {
    world.energy = 0.3;
    pos.x = world.x.house;
    state = 'sleep';
    wantYaw = yaw = -Math.PI / 2;
  } else if (debug === 'unpin') {
    setWand(false); // 把自检时挂上去的毛球收回座子
  } else if (debug === 'pin') {
    // 把毛球挂在爬架最高层旁边,猫已经蹲在那层上玩
    const n = tree.platforms.length;
    level = goalLevel = n;
    playTimer = 99;
    pos.set(platform(n).x - 0.4 * SCALE, platform(n).y, 0);
    world.toy = { x: platform(n).x + 0.75 * SCALE, y: platform(n).y + 1.15 * SCALE };
    wand.reset(world.toy.x, world.toy.y - 0.45 * SCALE);
    refreshWand();
    perch();
  } else if (debug === 'stalk' || debug === 'rear' || debug === 'flop') {
    const at = { stalk: [2.4, 0.9], rear: [1.1, 1.95], flop: [0.7, 1.5] }[debug];
    mouse.set(pos.x + at[0] * SCALE, at[1] * SCALE);
    setWand(true);
    wand.reset(mouse.x, mouse.y - 0.45 * SCALE);
    state = debug;
    timer = 99;
    swipeIn = 99;
  } else if (debug === 'ball' || debug === 'treetoy') {
    // 让它马上去玩小球 / 爬架上的小球
    if (debug === 'ball') ball.pos.x = pos.x + 2 * SCALE;
    else pos.x = world.x.tree - 2 * SCALE;
    playCooldown = 0;
    playWith(debug === 'ball' ? ball : treeToy);
    playTimer = 99;
  } else if (debug === 'swipe' || debug === 'swipe-left') {
    // 站着伸爪去够斜上方的玩具(朝右 / 朝左),爪子一直举着
    const side = debug === 'swipe' ? 1 : -1;
    mouse.set(pos.x + side * 1.15 * SCALE, (side > 0 ? 1.5 : 0.62) * SCALE); // 朝右够高处,朝左够低处
    setWand(true);
    wand.reset(mouse.x, mouse.y - 0.45 * SCALE);
    state = 'play';
    flopAfter = 9999;
    stalkIn = 9999;
    holdReach = true;
  } else if (debug === 'wand') {
    mouse.set(pos.x + 1.3 * SCALE, 0.95 * SCALE);
    setWand(true);
    state = 'play';
  }
  placeProps();
});
tick();
