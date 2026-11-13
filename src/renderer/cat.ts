import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import glb from '../../assets/cat.glb';
import { CatLook, darken, mix } from './look';
import { paintSkin } from './skin';
import { Eye, Mouth } from './eye';

// 猫的模型是在 Blender 里捏的(tools/sculpt_cat.py → assets/cat.glb):一张连续的蒙皮网格加骨骼。
// 这里负责每帧摆骨骼:走路步态、腿的 IK、头看向鼠标、尾巴摆动、被拎起时下垂。
// 约定(glTF 坐标):猫朝 +X,Y 向上,Z 是左右。root 原点在地面。

export interface CatInput {
  moving: boolean; // 是否在走
  airborne: boolean; // 被拎起或下落中
  swing: number; // 悬空时腿的前后摆动
  lookPitch: number; // 头的俯仰目标
  lookYaw: number; // 头朝镜头方向的偏转目标(0..1)
  gaze?: THREE.Vector2; // 视线方向(屏幕上的右和上,长度 0..1);不给就自己随意看
  sit?: number; // 蹲坐 0..1
  eat?: number; // 低头吃或喝 0..1
  hiss?: number; // 哈气 0..1:弓背、飞机耳、炸尾巴、张嘴
  reach?: { x: number; y: number }; // 前爪去够的位置(root 空间)
  reachWeight?: number; // 够的力度 0..1
  excite?: number; // 兴奋 0..1:尾巴甩得更快更大
  sleep?: number; // 睡着 0..1:闭眼、低头、呼吸变慢变深
  leap?: number; // 跳跃腾空 0..1:前腿往前伸、后腿往后蹬
  tilt?: number; // 身体前后倾斜的角度(弧度,正数是头朝上)
  stalk?: number; // 伏击 0..1:前身压低、屁股撅起来左右扭
  bothPaws?: number; // 0..1:两只前爪一起去够(站起来拍、躺着抱)
  roll?: number; // 绕身体长轴翻滚的角度(弧度);接近 ±π 就是四脚朝天躺着
  kick?: number; // 兔子蹬 0..1:躺着时两条后腿轮流快速蹬
}

let template: THREE.Object3D | null = null;

/** 解析打包进来的模型;创建 Cat 之前要先等它完成 */
export function loadCatModel(): Promise<void> {
  return new Promise((resolve, reject) => {
    const buffer = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer;
    new GLTFLoader().parse(buffer, '', (gltf) => {
      template = gltf.scene;
      resolve();
    }, reject);
  });
}

const damp = (current: number, target: number, rate: number, dt: number) =>
  current + (target - current) * (1 - Math.exp(-rate * dt));

// 两段式柔和明暗
const gradient = new THREE.DataTexture(new Uint8Array([222, 255]), 2, 1, THREE.RedFormat);
gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
gradient.needsUpdate = true;

// 后腿折起来时膝弯里的阴影:大腿和小腿的蒙皮权重交界处,就是蹲下时两段腿叠在一起的地方。
// 蹲得越低(uFold 越大)这一小块阴影越明显,站直时完全没有。骨骼编号是 cat.glb 里蒙皮的顺序。
const FOLD_VERTEX_PARS = `#include <common>
varying float vFold;
float foldWeight(float a, float b) {
  vec4 near = step(abs(skinIndex - a), vec4(0.5)) + step(abs(skinIndex - b), vec4(0.5));
  return dot(skinWeight, min(near, vec4(1.0)));
}`;
const FOLD_VERTEX = `{
  float thigh = foldWeight(2.0, 6.0); // legUL / legUR
  float shin = foldWeight(3.0, 7.0); // legLL / legLR
  vFold = 4.0 * thigh * shin; // 两边各占一半的地方就是膝弯
}`;
const FOLD_FRAGMENT = `diffuseColor.rgb *= mix(vec3(1.0), vec3(0.56, 0.49, 0.5), uFold * smoothstep(0.12, 0.55, vFold));`;

const ARM_OUT = 0.55; // 伸爪时前腿往外张开的角度(弧度)
const BACK_HEIGHT = 0.54; // 站着时背有多高(身长单位),躺下时身体要抬起这么多
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const IDENTITY = new THREE.Quaternion();

interface Leg {
  front: boolean;
  side: number; // 身体的哪一侧:-1 左(-Z),+1 右(+Z)
  phase: number;
  upper: THREE.Bone;
  lower: THREE.Bone;
  meta: THREE.Bone | null;
  paw: THREE.Bone;
  a: number;
  b: number;
  restUpper: number; // 静止姿势里上段的方向角
  restLower: number;
  footDX: number; // 静止时脚相对髋/肩的前后偏移
  footY: number; // 静止时脚关节的高度
  hock: THREE.Vector2; // 后腿:脚关节 → 脚踝
}

export class Cat {
  readonly root = new THREE.Group();
  /** 描线颜色:比主毛色深很多的同色系 */
  readonly lineColor: string;

  private bones: Record<string, THREE.Bone> = {};
  private order: THREE.Bone[] = [];
  private restQ = new Map<THREE.Object3D, THREE.Quaternion>(); // 静止姿势下的朝向(root 空间)
  private restP = new Map<THREE.Object3D, THREE.Vector3>(); // 静止姿势下的位置(root 空间)
  private world = new Map<THREE.Object3D, THREE.Quaternion>(); // 这一帧的朝向(root 空间)
  private delta = new Map<THREE.Bone, THREE.Quaternion>(); // 这一帧相对静止姿势转了多少(root 空间)
  private legs: Leg[] = [];
  private eyes: { eye: Eye; anchor: THREE.Object3D }[] = [];
  private gaze = new THREE.Vector2();
  private wander = new THREE.Vector2();
  private wanderIn = 1;
  private mouth: Mouth | null = null;
  private fold = { value: 0 }; // 后腿折起来的程度,给褶皱阴影用
  private model!: THREE.Object3D; // 整只猫的模型;翻滚时转的是它,root 只管位置和朝向
  private stalkW = 0;
  private pawsW = 0;
  private rollW = 0;
  private kickW = 0;
  private nearSide = 1; // 这一帧身体的哪一侧朝着屏幕外(离镜头近)
  private sitW = 0;
  private eatW = 0;
  private hissW = 0;
  private reachW = 0;
  private reachAt = new THREE.Vector2();
  private tailPhase = 0;
  private leapW = 0;
  private sleepW = 0;
  private tiltW = 0;
  private hipsRestLocal = new THREE.Vector3();
  private headAnchor = new THREE.Vector3();

  private phase = 0;
  private gait = 0;
  private air = 0;
  private pitch = 0;
  private yaw = 0;
  private time = 0;
  private blinkIn = 2;
  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private v = new THREE.Vector3();

  constructor(readonly look: CatLook) {
    if (!template) throw new Error('loadCatModel() 还没完成');
    this.lineColor = darken(look.base, 0.74);
    const model = cloneSkinned(template);
    this.root.add(model);
    this.model = model;
    this.root.updateMatrixWorld(true);

    model.traverse((obj) => {
      this.restQ.set(obj, obj.getWorldQuaternion(new THREE.Quaternion()));
      this.restP.set(obj, obj.getWorldPosition(new THREE.Vector3()));
      if ((obj as THREE.Bone).isBone) {
        this.bones[obj.name] = obj as THREE.Bone;
        this.order.push(obj as THREE.Bone);
        this.delta.set(obj as THREE.Bone, new THREE.Quaternion());
        this.world.set(obj, new THREE.Quaternion());
      }
      if ((obj as THREE.SkinnedMesh).isSkinnedMesh) {
        const mesh = obj as THREE.SkinnedMesh;
        const material = new THREE.MeshToonMaterial({ map: paintSkin(look), gradientMap: gradient });
        material.onBeforeCompile = (shader) => {
          shader.uniforms.uFold = this.fold;
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', FOLD_VERTEX_PARS)
            .replace('#include <skinning_vertex>', '#include <skinning_vertex>\n' + FOLD_VERTEX);
          shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\nuniform float uFold;\nvarying float vFold;')
            .replace('#include <map_fragment>', '#include <map_fragment>\n' + FOLD_FRAGMENT);
        };
        mesh.material = material;
        mesh.frustumCulled = false;
      }
    });
    this.hipsRestLocal.copy(this.bones.hips.position);

    // 少量体型参数:直接缩放对应的骨骼
    this.bones.head.scale.setScalar(look.head);
    this.bones.earL.scale.setScalar(look.ears);
    this.bones.earR.scale.setScalar(look.ears);
    this.bones.tail1.scale.setScalar(look.fluff);

    this.buildFace(model);
    this.buildLegs();
  }

  private buildFace(model: THREE.Object3D) {
    const look = this.look;
    const noseAnchor = model.getObjectByName('nose');
    // 定位点的局部坐标:+Y 是脸的表面法线,-Z 朝上,X 是左右
    for (const name of ['eye_L', 'eye_R']) {
      const anchor = model.getObjectByName(name);
      if (!anchor) continue;
      // 鼻子在定位点的哪一侧,内眼角就在哪一侧
      const toNose = noseAnchor ? anchor.worldToLocal(noseAnchor.getWorldPosition(new THREE.Vector3())) : new THREE.Vector3();
      const eye = new Eye(look, 0.088, toNose.x > 0, mix(this.lineColor, look.marking, 0.35));
      anchor.add(eye.mesh);
      this.eyes.push({ eye, anchor });
    }
    if (noseAnchor) {
      this.mouth = new Mouth();
      noseAnchor.add(this.mouth.mesh);
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.017, 14, 10), new THREE.MeshToonMaterial({ color: look.nose, gradientMap: gradient }));
      nose.scale.set(1.25, 0.5, 0.8);
      nose.position.set(0, -0.002, 0);
      noseAnchor.add(nose);
    }
    this.headAnchor.copy(this.restP.get(this.bones.head)!);
  }

  private buildLegs() {
    const p2 = (bone: THREE.Bone) => {
      const p = this.restP.get(bone)!;
      return new THREE.Vector2(p.x, p.y);
    };
    const make = (front: boolean, tag: string, phase: number) => {
      const upper = this.bones[(front ? 'armU' : 'legU') + tag];
      const lower = this.bones[(front ? 'armL' : 'legL') + tag];
      const meta = front ? null : this.bones['legM' + tag];
      const paw = this.bones[(front ? 'hand' : 'foot') + tag];
      const S = p2(upper);
      const K = p2(lower);
      const A = p2(front ? paw : meta!); // 下段的末端(前腿是腕,后腿是脚踝)
      const F = p2(paw); // 脚关节
      this.legs.push({
        front, side: tag === 'R' ? 1 : -1, phase, upper, lower, meta, paw,
        a: S.distanceTo(K),
        b: K.distanceTo(A),
        restUpper: Math.atan2(K.y - S.y, K.x - S.x),
        restLower: Math.atan2(A.y - K.y, A.x - K.x),
        footDX: F.x - S.x,
        footY: F.y,
        hock: A.clone().sub(F),
      });
    };
    // 猫走路的落脚顺序:左后 → 左前 → 右后 → 右前
    make(false, 'L', 0);
    make(true, 'L', 0.25);
    make(false, 'R', 0.5);
    make(true, 'R', 0.75);
  }

  headWorldPosition(out: THREE.Vector3) {
    return this.bones.head.getWorldPosition(out);
  }

  /** 让骨骼在"父骨骼这一帧的转动"基础上,再绕 root 空间的轴转一下 */
  private turn(name: string, parent: string | null, ...steps: [THREE.Vector3, number][]) {
    const d = this.delta.get(this.bones[name])!;
    if (parent) d.copy(this.delta.get(this.bones[parent])!);
    else d.identity();
    for (const [axis, angle] of steps) d.multiply(this.q.setFromAxisAngle(axis, angle));
  }

  /** 把 delta 换算成每根骨骼的局部旋转 */
  private applyPose() {
    for (const bone of this.order) {
      const parent = bone.parent!;
      const parentWorld = this.world.get(parent) ?? this.restQ.get(parent) ?? IDENTITY;
      const w = this.world.get(bone)!.copy(this.delta.get(bone)!).multiply(this.restQ.get(bone)!);
      bone.quaternion.copy(this.q2.copy(parentWorld).invert()).multiply(w);
    }
  }

  update(dt: number, input: CatInput, speed: number) {
    this.time += dt;
    const t = this.time;
    this.gait = damp(this.gait, input.moving && !input.airborne ? 1 : 0, 8, dt);
    this.air = damp(this.air, input.airborne ? 1 : 0, 10, dt);
    const { air, gait } = this;
    this.nearSide = Math.cos(this.root.rotation.y) > 0 ? 1 : -1;

    this.sitW = damp(this.sitW, input.sit ?? 0, 6, dt);
    this.eatW = damp(this.eatW, input.eat ?? 0, 6, dt);
    this.hissW = damp(this.hissW, input.hiss ?? 0, 14, dt);
    this.reachW = damp(this.reachW, input.reachWeight ?? 0, 14, dt);
    this.leapW = damp(this.leapW, input.leap ?? 0, 13, dt);
    this.sleepW = damp(this.sleepW, input.sleep ?? 0, 3, dt);
    const sleep = this.sleepW;
    this.tiltW = damp(this.tiltW, input.tilt ?? 0, 10, dt);
    if (input.reach) this.reachAt.set(input.reach.x, input.reach.y);
    const { sitW: sit, eatW: eat, hissW: hiss } = this;
    this.stalkW = damp(this.stalkW, input.stalk ?? 0, 9, dt);
    this.pawsW = damp(this.pawsW, input.bothPaws ?? 0, 10, dt);
    this.rollW = damp(this.rollW, input.roll ?? 0, 7, dt);
    this.kickW = damp(this.kickW, input.kick ?? 0, 8, dt);
    const stalk = this.stalkW;
    const onBack = Math.min(1, Math.abs(this.rollW) / 2.5); // 翻过去了多少
    // 翻滚是绕脚下那条线转的,所以翻过去之后要把身体抬起来,让背贴着地面
    this.model.rotation.x = this.rollW;
    this.model.position.y = BACK_HEIGHT * 0.5 * (1 - Math.cos(this.rollW));
    this.fold.value = Math.max(sit, 0.8 * stalk);
    const excite = input.excite ?? 0;

    // 走得越快,步子迈得越勤
    const cycle = 0.85 * Math.pow(THREE.MathUtils.clamp(0.36 / Math.max(speed, 0.01), 0.4, 1), 0.6);
    const stance = 0.65;
    this.phase = (this.phase + (dt / cycle) * gait) % 1;
    const stride = speed * cycle * stance;
    const wave = (offset: number) => Math.sin(this.phase * Math.PI * 2 + offset);

    // 躯干:走路时起伏和左右扭动,静止时呼吸;被拎起时下垂;蹲坐时屁股落地、前身略抬;
    // 吃东西时前身压低;哈气时弓背(屁股和肩低、腰拱起)
    const bob = Math.sin(this.phase * Math.PI * 4) * 0.007 * gait + Math.sin(t * (2.2 - 1.1 * sleep)) * (0.003 + 0.006 * sleep);
    // 伸出一只前爪时重心要变,身体不会纹丝不动:
    // 够高处 → 屁股往下坐、前身抬起来(另一只前爪还撑在地上);够低处 → 前身往下沉,撑地的那条腿弯下去。
    // 已经站起来、或者躺着的时候不用。
    const reachHigh = THREE.MathUtils.smoothstep((this.reachAt.y - 0.5) / 0.5, 0.25, 0.75);
    const reachBody = this.reachW * (1 - onBack) * (1 - THREE.MathUtils.clamp(Math.abs(this.tiltW) / 0.5, 0, 1));
    const reachLift = reachBody * THREE.MathUtils.lerp(-0.13, 0.22, reachHigh);
    const reachSquat = reachBody * 0.11 * reachHigh;
    const lift = bob - 0.18 * sit - 0.02 * eat + 0.03 * hiss - 0.1 * stalk - reachSquat;
    const rootBoneQ = this.restQ.get(this.bones.root)!;
    this.bones.hips.position.copy(this.hipsRestLocal).add(this.v.set(0, lift, 0).applyQuaternion(this.q.copy(rootBoneQ).invert()));
    this.turn('hips', null, [Z, 0.22 * air + 0.26 * sit - 0.15 * eat + 0.28 * hiss + this.tiltW - 0.2 * stalk - 0.17 * onBack + reachLift], [Y, wave(0) * 0.05 * gait + Math.sin(t * 17) * 0.14 * stalk]);
    this.turn('spine1', 'hips', [Y, wave(0.9) * -0.05 * gait], [Z, -0.08 * air - 0.05 * hiss - 0.12 * onBack]);
    this.turn('chest', 'spine1', [Y, wave(1.8) * -0.05 * gait], [Z, -0.08 * air - 0.28 * eat - 0.5 * hiss + 0.1 * stalk - 0.2 * onBack]); // 躺着时身体蜷起来一点,头抬离地面
    this.turn('neck', 'chest', [Z, -0.85 * eat + 0.45 * hiss - 0.25 * onBack]);

    // 头:不跟着身体晃,只看向目标,走路时轻微点头;吃东西时低头、一下一下地动
    this.pitch = damp(this.pitch, input.lookPitch, 6, dt);
    this.yaw = damp(this.yaw, input.lookYaw, 6, dt);
    const nod = Math.sin(this.phase * Math.PI * 4 + 1) * 0.02 * gait + (Math.sin(t * 9) * 0.07 - 0.8) * eat - 0.28 * sleep;
    this.turn('head', null, [Y, -this.yaw * 0.9 * (1 - eat)], [Z, this.pitch * (1 - eat) * (1 - onBack) + nod - 0.75 * onBack]);
    // 耳朵:哈气时往两边、往后压平(飞机耳)。左耳在 -Z 一侧
    this.turn('earL', 'head', [X, -0.95 * hiss], [Z, 0.45 * hiss]);
    this.turn('earR', 'head', [X, 0.95 * hiss], [Z, 0.45 * hiss]);

    // 尾巴:平时竖着慢慢摆;兴奋时甩得又快又大;悬空或蹲坐时放下来;哈气时炸开、绷直
    this.tailPhase += dt * 1.6 * (1 + 2.2 * excite);
    this.bones.tail1.scale.setScalar(this.look.fluff * (1 + 0.4 * hiss));
    for (let i = 1; i <= 6; i++) {
      const sway = Math.sin(this.tailPhase - i * 0.5) * (0.035 + 0.012 * i) * (1 + 1.6 * excite) * (1 - 0.7 * hiss);
      // 躺着的时候尾巴平放在地上(不然"垂下来"的尾巴会朝天竖着)
      const drop = i === 1 ? 1.2 * air * (1 - onBack) + 1.25 * Math.max(sit, onBack) : 0.1 * air + 0.1 * sit;
      this.turn('tail' + i, i === 1 ? 'hips' : 'tail' + (i - 1), [Z, drop], [X, sway], [Y, sway * 0.6]);
    }

    // 腿先跟着身体走一遍,拿到髋和肩这一帧的位置,再解 IK
    for (const leg of this.legs) {
      const parent = leg.upper.parent as THREE.Bone;
      this.delta.get(leg.upper)!.copy(this.delta.get(parent)!);
    }
    this.applyPose();
    this.root.updateMatrixWorld(true);
    for (const leg of this.legs) this.solveLeg(leg, stride, stance, input.swing);
    this.applyPose();

    // 眼神:看向目标;没有目标时隔一会儿随意换个方向。眨眼是上眼皮落下来
    this.wanderIn -= dt;
    if (this.wanderIn < 0) {
      this.wanderIn = 1.2 + Math.random() * 3;
      this.wander.set((Math.random() - 0.5) * 0.9, (Math.random() - 0.4) * 0.5);
    }
    const target = input.gaze ?? this.wander;
    this.gaze.x = damp(this.gaze.x, target.x, 9, dt);
    this.gaze.y = damp(this.gaze.y, target.y, 9, dt);
    this.blinkIn -= dt;
    if (this.blinkIn < -0.16) this.blinkIn = 2.5 + Math.random() * 4;
    const lid = this.blinkIn < 0 ? Math.abs(this.blinkIn + 0.08) / 0.08 : 1; // 1 → 0 → 1
    this.root.updateMatrixWorld(true);
    for (const { eye, anchor } of this.eyes) {
      // 把屏幕上的视线方向换到这只眼睛自己的"右"和"上"
      anchor.getWorldQuaternion(this.q);
      const right = this.v.set(1, 0, 0).applyQuaternion(this.q);
      const gx = this.gaze.x * right.x + this.gaze.y * right.y;
      const up = this.v.set(0, 0, -1).applyQuaternion(this.q);
      const gy = this.gaze.x * up.x + this.gaze.y * up.y;
      eye.update(0.74 * lid * (1 - sleep), THREE.MathUtils.clamp(gx, -1, 1), THREE.MathUtils.clamp(gy, -1, 1), this.hissW);
    }
    this.mouth?.update(this.hissW);
  }

  private solveLeg(leg: Leg, stride: number, stance: number, swing: number) {
    const { a, b, front, hock } = leg;
    const air = this.air;
    const socket = this.model.worldToLocal(leg.upper.getWorldPosition(this.v));
    const sx = socket.x;
    const sy = socket.y;

    // 地面上的落脚点
    const p = (this.phase + leg.phase) % 1;
    let offset: number;
    let lift = 0;
    if (p < stance) {
      offset = THREE.MathUtils.lerp(stride / 2, -stride / 2, p / stance);
    } else {
      const u = (p - stance) / (1 - stance);
      offset = THREE.MathUtils.lerp(-stride / 2, stride / 2, THREE.MathUtils.smoothstep(u, 0, 1));
      lift = Math.sin(u * Math.PI) * 0.055;
    }
    const groundX = sx + leg.footDX + offset * this.gait + (front ? 0 : 0.1 * this.sitW);
    const groundY = leg.footY + lift * this.gait;

    // 悬空时腿自然垂下
    const reach = a + b + (front ? 0 : hock.y);
    // 兔子蹬:两条后腿轮流收回来再蹬出去
    const kick = front ? 0 : this.kickW;
    const kickPhase = Math.sin(this.time * 26 + leg.phase * Math.PI * 2);
    const hangX = sx + (front ? 0.02 : 0.05) + swing * (front ? 1 : 0.7) + kick * (0.06 + 0.07 * kickPhase);
    const hangY = sy - reach * (0.93 - kick * (0.26 - 0.2 * kickPhase));
    let footX = THREE.MathUtils.lerp(groundX, hangX, air);
    let footY = THREE.MathUtils.lerp(groundY, hangY, air);
    if (this.leapW > 0.01) {
      // 腾空:前腿往前下方伸出去准备落地,后腿往后蹬
      const span = (a + b) * 0.8;
      footX = THREE.MathUtils.lerp(footX, sx + (front ? 0.17 : -0.16), this.leapW);
      footY = THREE.MathUtils.lerp(footY, sy - span, this.leapW);
    }
    let reachOut = 0;
    if (front && this.reachW > 0.01) {
      // 伸爪子去够:用靠近屏幕这一侧的爪子(另一侧的会被身体挡住);两只一起够时另一只也跟上
      const w = this.reachW * (leg.side === this.nearSide ? 1 : 0.9 * this.pawsW);
      reachOut = w;
      // 目标是按站着的坐标给的;翻过去之后"上"反过来了,换算一下
      const reachY = (this.reachAt.y - this.model.position.y) * Math.cos(this.rollW);
      footX = THREE.MathUtils.lerp(footX, this.reachAt.x, w);
      footY = THREE.MathUtils.lerp(footY, reachY, w);
    }

    // 两段 IK:前腿解到腕,后腿解到脚踝
    const tx = front ? footX : footX + hock.x;
    const ty = front ? footY : footY + hock.y;
    const dx = tx - sx;
    const dy = ty - sy;
    const d = THREE.MathUtils.clamp(Math.hypot(dx, dy), 0.02, a + b - 1e-3);
    const toTarget = Math.atan2(dy, dx);
    const A = Math.acos(THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1));
    const bend = front ? -1 : 1; // 前腿肘向后,后腿膝向前
    const upperAngle = toTarget + bend * A;
    const kx = sx + Math.cos(upperAngle) * a;
    const ky = sy + Math.sin(upperAngle) * a;
    const lowerAngle = Math.atan2(sy + Math.sin(toTarget) * d - ky, sx + Math.cos(toTarget) * d - kx);

    // 伸出去的前腿整条往身体外侧张开一点,这样它在胸口的长毛前面,不会被毛挡住
    const out = this.q.setFromAxisAngle(X, leg.side * ARM_OUT * reachOut);
    this.delta.get(leg.upper)!.copy(out).multiply(this.q2.setFromAxisAngle(Z, upperAngle - leg.restUpper));
    this.delta.get(leg.lower)!.copy(out).multiply(this.q2.setFromAxisAngle(Z, lowerAngle - leg.restLower));
    if (leg.meta) this.delta.get(leg.meta)!.setFromAxisAngle(Z, -0.35 * air);
    this.delta.get(leg.paw)!.copy(out).multiply(this.q2.setFromAxisAngle(Z, -0.7 * air)); // 悬空时脚尖下垂
  }

  dispose() {
    this.root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      if (!(obj as THREE.SkinnedMesh).isSkinnedMesh) obj.geometry.dispose(); // 蒙皮网格的几何体是各只猫共用的
      const mat = obj.material as THREE.Material & { map?: THREE.Texture | null };
      mat.map?.dispose();
      mat.dispose();
    });
  }
}
