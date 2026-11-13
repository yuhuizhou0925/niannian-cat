import * as THREE from 'three';
import { CatLook, mix, hexToRgb } from './look';

// 给捏好的模型画毛色。贴图是一张图集,布局和 tools/sculpt_cat.py 里的数字一一对应:
//   左半边:身体的侧视图(x 是前后,z 是高度),身体、腿、尾巴从这里取色;
//   右上:头绕一圈的展开图(横向是经度,正中间是脸的正前方;纵向是纬度,上面是头顶);
//   右下:耳朵背面的纯色块,和耳朵正面的小图。
// 所以这里就像在猫的侧面照和一张摊开的脸上涂颜色。

const W = 2048;
const H = 1024;
const SIDE_W = 1024;
const PI = Math.PI;
const FX = 0.15; // 身体拉长的量,和 sculpt_cat.py 里的 FX 一致
const U = 0.035; // 身体抬高的量,和 sculpt_cat.py 里的 UZ 一致

type Pt = [number, number];

/** 固定种子的随机数:每次画出来的毛流都一样 */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rgba = (hex: string, alpha: number) => `rgba(${hexToRgb(hex).join(',')},${alpha})`;

/** 布偶的耳朵和尾巴比面罩更深 */
export const pointColor = (look: CatLook) => (look.pattern === 'ragdoll' ? mix(look.marking, '#5a4038', 0.32) : look.marking);

export function paintSkin(look: CatLook) {
  const el = document.createElement('canvas');
  el.width = W;
  el.height = H;
  const ctx = el.getContext('2d')!;
  const { base, marking, accent, white, pattern } = look;
  const point = pointColor(look);
  const pointed = pattern === 'points' || pattern === 'ragdoll';
  // 毛流:稀疏、细长、和底色接近的一缕缕,整体晕开。不能画成密密麻麻的小短线,那样看着像一片小孔或小虫
  const furDark = rgba(mix(marking, '#6a5548', 0.3), 0.5);
  const furLight = 'rgba(255,255,255,0.6)';
  const strand = (b: Brush, rand: () => number, x: number, y: number, angle: number, len: number, width: number) => {
    const bend = (rand() - 0.5) * 0.25;
    b.line(
      [[x, y], [x + Math.cos(angle) * len * 0.5, y + Math.sin(angle) * len * 0.5], [x + Math.cos(angle + bend) * len, y + Math.sin(angle + bend) * len]],
      width, rand() < 0.5 ? furDark : furLight
    );
  };

  // 画笔:to 把模型坐标换成像素,scale 是每个模型单位多少像素
  const brush = (c: CanvasRenderingContext2D, to: (p: Pt) => Pt, scale: number): Brush => {
    const soft = (blur: number) => (c.filter = blur ? `blur(${blur * scale}px)` : 'none');
    const path = (pts: Pt[]) => {
      c.beginPath();
      pts.forEach((p, i) => (i ? c.lineTo(...to(p)) : c.moveTo(...to(p))));
    };
    return {
      poly(pts, color, blur = 0) {
        soft(blur);
        c.fillStyle = color;
        path(pts);
        c.fill();
      },
      oval(center, rx, ry, color, blur = 0) {
        soft(blur);
        c.fillStyle = color;
        c.beginPath();
        c.ellipse(...to(center), rx * scale, ry * scale, 0, 0, Math.PI * 2);
        c.fill();
      },
      line(pts, width, color, blur = 0) {
        soft(blur);
        c.strokeStyle = color;
        c.lineWidth = width * scale;
        c.lineCap = 'round';
        c.lineJoin = 'round';
        path(pts);
        c.stroke();
      },
      layer(blur, paint) {
        // 先画到一张临时画布上,再整体晕开贴回来:很多笔触一起柔化,比逐笔柔化快得多
        sctx.clearRect(0, 0, W, H);
        paint(brush(sctx, to, scale));
        sctx.filter = 'none';
        c.filter = `blur(${blur * scale}px)`;
        c.drawImage(scratch, 0, 0);
        c.filter = 'none';
      },
    };
  };
  const scratch = document.createElement('canvas');
  scratch.width = W;
  scratch.height = H;
  const sctx = scratch.getContext('2d')!;

  // 图集里的一块区域:先铺底色,再交给 paint 去画
  const region = (x: number, y: number, w: number, h: number, to: (p: Pt) => Pt, paint: (b: Brush) => void) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = base;
    ctx.fillRect(x, y, w, h);
    paint(brush(ctx, to, Math.abs(to([1, 0])[0] - to([0, 0])[0])));
    ctx.restore();
  };

  // ---------- 侧视图:坐标是 [x 前后, z 高度] ----------
  region(0, 0, SIDE_W, H, ([x, z]) => [((x + 0.4) / 1.4) * SIDE_W, (1 - z) * H], (b) => {
    if (pattern === 'tabby') {
      for (let i = 0; i < 11; i++) {
        const x = -0.12 + i * 0.075;
        b.poly([[x - 0.016, 0.56], [x + 0.016, 0.56], [x + 0.03, 0.3], [x + 0.02, 0.3]], marking, 0.004);
      }
      b.line([[-0.15, 0.515], [0.5 + FX, 0.52]], 0.03, marking);
      for (const z of [0.09, 0.15, 0.21]) b.line([[-0.1, z], [0.6 + FX, z]], 0.022, marking);
      for (let i = 0; i < 8; i++) b.line([[-0.4, 0.5 + i * 0.07], [-0.05, 0.46 + i * 0.07]], 0.026, marking);
    } else if (pattern === 'spots') {
      for (let i = 0; i < 26; i++) {
        const x = -0.14 + ((i * 0.618) % 1) * (0.62 + FX);
        const z = 0.3 + ((i * 0.377) % 1) * 0.22;
        b.oval([x, z], 0.02, 0.02, marking);
      }
      for (let i = 0; i < 6; i++) b.line([[-0.4, 0.52 + i * 0.08], [-0.05, 0.5 + i * 0.08]], 0.022, marking);
    } else if (pattern === 'patches') {
      b.oval([0.02, 0.44], 0.14, 0.12, marking, 0.006);
      b.oval([0.3 + FX, 0.42], 0.14, 0.13, accent, 0.006);
      b.poly([[-0.4, 1], [-0.4, 0.6], [-0.1, 0.6], [-0.02, 1]], marking, 0.006);
    } else if (pattern === 'points') {
      b.poly([[-0.4, 0.2], [1, 0.2], [1, 0], [-0.4, 0]], marking, 0.03);
    } else if (pattern === 'ragdoll') {
      // 背脊比体侧略深一点
      b.oval([0.23, 0.5 + U], 0.4, 0.08, mix(base, marking, 0.3), 0.04);
    }

    if (pointed) {
      // 尾巴(连同尾根附近):布偶的尾巴只比身体深一点,重点色猫的尾巴是深色
      const tail = pattern === 'ragdoll' ? mix(base, marking, 0.85) : point;
      const tz = U * 0.6;
      b.poly([[-0.4, 1], [-0.4, 0.42 + tz], [-0.14, 0.42 + tz], [-0.08, 0.47 + tz], [-0.06, 0.56 + tz], [-0.02, 1]], tail, 0.03);
    }

    if (pattern === 'ragdoll') {
      // 白色:肚子和四条腿,往前连到胸口的围脖和脖子下方、脸的下半部
      b.poly(
        [[-0.4, 0], [-0.4, 0.2 + U * 0.6], [-0.05, 0.22 + U * 0.8], [0.2 + FX / 2, 0.25 + U], [0.36 + FX, 0.33 + U], [0.42 + FX, 0.45 + U],
         [0.5 + FX, 0.5 + U], [0.6 + FX, 0.5 + U], [1, 0.5 + U], [1, 0]],
        white, 0.02
      );
    } else {
      if (look.belly > 0.02) {
        const top = 0.17 + look.belly * 0.13;
        b.poly([[-0.2, 0], [-0.2, top], [0.3 + FX, top + 0.01], [0.48 + FX, top + 0.1 * look.belly + 0.02], [0.62 + FX, top + 0.2 * look.belly], [0.62 + FX, 0]], white, 0.012);
      }
      if (look.socks) b.poly([[-0.4, 0], [-0.4, 0.105], [1, 0.105], [1, 0]], white, 0.004);
    }

    // 毛流:身体上往后下方披,腿上往下,尾巴上顺着尾巴往上
    ctx.globalAlpha = 0.3;
    b.layer(0.006, (fur) => {
      const rand = rng(11);
      for (let i = 0; i < 520; i++) {
        const x = -0.38 + rand() * 1.36;
        const z = 0.02 + rand() * 0.96;
        const jitter = (rand() - 0.5) * 0.3;
        // 胸口正面是从侧面投影过来的,笔触会被拉成一圈圈横纹,所以这一块不画
        if (x > 0.55 + FX && z < 0.52 + U) continue;
        // 布偶的肚子和腿是白的,深色笔触画上去像脏了一块,跳过
        if (pattern === 'ragdoll' && z < 0.27 + U) continue;
        let angle: number;
        if (x < -0.06 && z > 0.45) angle = 1.9 + jitter;
        else if (z < 0.22) angle = -PI / 2 + jitter;
        else if (x > 0.45 + FX) angle = -1.9 + jitter;
        else angle = PI + 0.4 + jitter;
        strand(fur, rand, x, z, angle, 0.09 + rand() * 0.1, 0.009 + rand() * 0.009);
      }
    });
    ctx.globalAlpha = 1;
  });

  // ---------- 头:坐标是 [经度, 纬度](弧度)。经度 0 是正前方,正数是猫的左边;纬度 0 是眼睛的高度 ----------
  region(SIDE_W, 0, 1024, 512, ([lon, lat]) => [SIDE_W + (lon / (2 * PI) + 0.5) * 1024, ((PI / 2 - lat) / PI) * 512], (b) => {
    const both = (draw: (s: number) => void) => {
      draw(1);
      draw(-1);
    };
    if (pattern === 'tabby') {
      for (const lon of [-0.33, -0.12, 0.12, 0.33]) b.line([[lon, 0.95], [lon * 0.8, 0.5]], 0.07, marking);
      both((s) => {
        b.line([[s * 0.95, 0.05], [s * 1.5, 0.2]], 0.06, marking);
        b.line([[s * 1.0, -0.2], [s * 1.5, -0.15]], 0.06, marking);
      });
    } else if (pattern === 'spots') {
      for (const [lon, lat] of [[-0.25, 0.8], [0.25, 0.8], [0, 0.6]]) b.oval([lon, lat], 0.07, 0.07, marking);
    } else if (pattern === 'patches') {
      b.oval([0.75, 0.5], 0.7, 0.6, marking, 0.04);
      b.oval([-0.95, 0.3], 0.6, 0.55, accent, 0.04);
    } else if (pattern === 'points') {
      b.oval([0, -0.05], 0.95, 0.7, marking, 0.15);
    } else if (pattern === 'ragdoll') {
      // 额头和头顶:比身体略深一点,带几道很淡的细纹
      const brow = mix(base, marking, 0.42);
      b.poly([[-2.5, 1.6], [-2.5, 0.3], [2.5, 0.3], [2.5, 1.6]], brow, 0.15);
      const streak = mix(base, marking, 0.8);
      for (const [lon, top, tilt] of [[-0.62, 1.0, 0.05], [-0.36, 1.05, 0.02], [0.33, 1.05, -0.03], [0.6, 0.98, -0.05], [0.85, 0.9, -0.04], [-0.88, 0.92, 0.06]]) {
        b.line([[lon + tilt, top], [lon, 0.62]], 0.035, streak, 0.025);
      }
      // 眼周:浅灰米褐色,自然晕开,没有硬边;往外到太阳穴,往下带到脸颊。左右只是大致对称
      const mask = marking;
      b.oval([0.66, 0.14], 0.5, 0.4, mask, 0.13);
      b.oval([-0.69, 0.11], 0.47, 0.42, mask, 0.13);
      b.oval([0.95, -0.16], 0.36, 0.24, mask, 0.12);
      b.oval([-0.9, -0.2], 0.33, 0.22, mask, 0.12);
      // 白色:脸的下半部(脸颊下方、下巴)、胡须垫,和一道比较宽、边缘柔和的鼻梁
      b.poly([[-2.3, -1.6], [-2.3, -0.46], [2.3, -0.46], [2.3, -1.6]], white, 0.08);
      b.oval([0, -0.36], 0.56, 0.3, white, 0.05);
      b.poly([[-0.08, 1.0], [0.07, 1.0], [0.13, 0.55], [0.2, 0.2], [0.3, 0], [0.46, -0.14], [-0.46, -0.14], [-0.3, 0], [-0.22, 0.2], [-0.15, 0.55]], white, 0.06);
    }
    // 毛流:从鼻子往四周散开
    ctx.globalAlpha = 0.28;
    b.layer(0.03, (fur) => {
      const rand = rng(23);
      for (let i = 0; i < 300; i++) {
        const lon = (rand() - 0.5) * 2 * PI;
        const lat = (rand() - 0.5) * 2.7;
        const angle = Math.atan2(lat + 0.3, lon) + (rand() - 0.5) * 0.3;
        strand(fur, rand, lon, lat, angle, 0.3 + rand() * 0.3, 0.04 + rand() * 0.04);
      }
    });
    ctx.globalAlpha = 1;
    // 嘴:很淡的一小道,不画成符号化的 w
    {
      const mouth = mix(look.nose, '#8a6f6a', 0.45);
      b.line([[0, -0.31], [0, -0.4]], 0.016, mouth, 0.008);
      both((s) => b.line([[0, -0.4], [s * 0.07, -0.445], [s * 0.15, -0.44]], 0.014, mouth, 0.008));
    }
    if (pattern !== 'ragdoll') {
      if (look.muzzle) {
        b.oval([0, -0.35], 0.5, 0.28, white, 0.03);
        b.oval([0, -0.85], 0.7, 0.35, white, 0.03);
        b.poly([[0, 0.35], [0.2, -0.12], [-0.2, -0.12]], white, 0.02);
      }
      if (look.belly > 0.4) b.poly([[-1.2, -1.6], [-1.2, -0.8], [1.2, -0.8], [1.2, -1.6]], white, 0.05);
    }
  });

  // ---------- 耳朵:背面是一块纯色;正面是外圈耳朵色、中间粉色耳窝,坐标 [y 左右, z 高度] ----------
  const earColor = (s: number) => (pointed ? point : pattern === 'patches' ? (s > 0 ? marking : accent) : base);
  // 耳朵的两块图用"头部坐标":y 是左右,z 是相对头中心的高度(头顶大约 0.16,耳尖大约 0.23)
  // 耳根的颜色和头顶衔接,往上过渡到耳朵的颜色
  const root = pattern === 'ragdoll' ? mix(base, marking, 0.42) : null;
  region(SIDE_W, 768, 256, 256, ([y, z]) => [SIDE_W + (y + 0.25) * 512, 768 + (0.45 - z) * 512], (b) => {
    for (const s of [1, -1]) {
      b.poly([[0, -0.05], [s * 0.25, -0.05], [s * 0.25, 0.45], [0, 0.45]], earColor(s));
      if (root) b.poly([[0, -0.05], [s * 0.25, -0.05], [s * 0.25, 0.16], [0, 0.16]], root, 0.04);
    }
  });
  // 正面:外圈是耳朵的颜色,中间是粉色的耳窝,耳窝根部有几撮浅色的毛
  region(SIDE_W + 256, 768, 512, 256, ([y, z]) => [SIDE_W + 256 + (y + 0.25) * 1024, 768 + (0.32 - z) * 1024], (b) => {
    const tuft = mix(white, '#f3c9c9', 0.3);
    for (const s of [1, -1]) {
      b.poly([[0, 0.07], [s * 0.25, 0.07], [s * 0.25, 0.32], [0, 0.32]], earColor(s));
      if (root) b.poly([[0, 0.07], [s * 0.25, 0.07], [s * 0.25, 0.145], [0, 0.145]], root, 0.025);
      b.poly([[s * 0.082, 0.128], [s * 0.12, 0.118], [s * 0.162, 0.132], [s * 0.168, 0.165], [s * 0.158, 0.196], [s * 0.132, 0.172]], '#e9a9b1', 0.009);
      b.line([[s * 0.09, 0.122], [s * 0.115, 0.168]], 0.009, tuft, 0.003);
      b.line([[s * 0.105, 0.118], [s * 0.134, 0.158]], 0.009, tuft, 0.003);
      b.line([[s * 0.08, 0.128], [s * 0.094, 0.156]], 0.008, tuft, 0.003);
    }
  });

  const tex = new THREE.CanvasTexture(el);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  return tex;
}

interface Brush {
  /** 多边形;blur 是边缘的柔化宽度(模型单位) */
  poly(pts: Pt[], color: string, blur?: number): void;
  oval(center: Pt, rx: number, ry: number, color: string, blur?: number): void;
  line(pts: Pt[], width: number, color: string, blur?: number): void;
  /** 把 paint 里画的东西作为一层,整体晕开后叠上来 */
  layer(blur: number, paint: (b: Brush) => void): void;
}
