import * as THREE from 'three';
import { CatLook, mix } from './look';

// 眼睛是画出来的,不是一个圆片。照着真猫的眼神画,不要动漫感:
//   眼眶是柔和的椭圆,外眼角不上挑;上眼皮略微压住虹膜,看起来平静、松弛、有点慵懒;
//   虹膜是偏灰的蓝,瞳孔大而圆,所以整只眼睛偏深;没有画出来的"眼线",只有一圈细细的深色眼睑;
//   高光只有小小的一点。
// 虹膜和瞳孔会在眼眶里移动(看向鼠标),眨眼是上眼皮落下来。

const CW = 256;
const CH = 192;
/** 画面里眼眶的宽度占画布的比例,用来把"眼睛实际多宽"换算成面片大小 */
const EYE_SPAN = 200 / CW;

export class Eye {
  readonly mesh: THREE.Mesh;
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private drawn = { open: -1, x: 9, y: 9, angry: -1 };

  /** width:眼睛在模型里的宽度;innerOnRight:内眼角是否在面片的 +X 一侧 */
  constructor(private look: CatLook, width: number, private innerOnRight: boolean, private lineColor: string) {
    const canvas = document.createElement('canvas');
    canvas.width = CW;
    canvas.height = CH;
    this.ctx = canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    const w = width / EYE_SPAN;
    const geo = new THREE.PlaneGeometry(w, (w * CH) / CW);
    geo.rotateX(-Math.PI / 2); // 面片法线 → 定位点的 +Y(脸的表面法线),面片的"上" → 定位点的 -Z
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.texture, alphaTest: 0.5, side: THREE.DoubleSide }));
    this.mesh.position.y = 0.004; // 稍微浮在脸的表面上
    this.update(0.74, 0, 0);
  }

  /** open:睁开程度 0..1;gx, gy:视线方向 -1..1(面片自己的右和上) */
  update(open: number, gx: number, gy: number, angry = 0) {
    const d = this.drawn;
    if (Math.abs(open - d.open) < 0.02 && Math.abs(gx - d.x) < 0.03 && Math.abs(gy - d.y) < 0.03 && Math.abs(angry - d.angry) < 0.04) return;
    d.open = open;
    d.x = gx;
    d.y = gy;
    d.angry = angry;
    this.draw(open, gx, gy, angry);
    this.texture.needsUpdate = true;
  }

  private draw(open: number, gx: number, gy: number, angry: number) {
    const { ctx, look } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, CW, CH);
    // 之后统一按"内眼角在左"来画,坐标原点在眼睛中心
    const flip = this.innerOnRight ? -1 : 1;
    ctx.setTransform(flip, 0, 0, 1, CW / 2, CH / 2 + 4);
    const lookX = gx * flip;

    const inner: [number, number] = [-96, 8]; // 内眼角
    const outer: [number, number] = [96, 4]; // 外眼角和内眼角差不多高,不上挑
    const lowY = 86; // 下眼睑的弧度
    const upY = THREE.MathUtils.lerp(lowY - 6, -96, open); // 上眼皮:闭眼时落到下眼睑上
    // 生气时上眼皮靠鼻子的一侧压下来,变成往中间皱的眼神
    const upper = () => ctx.bezierCurveTo(-52, upY + 6 + 70 * angry, 40, upY - 8 + 18 * angry, outer[0], outer[1]);
    const lower = () => ctx.bezierCurveTo(52, lowY - 6, -46, lowY, inner[0], inner[1]);

    if (open > 0.06) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(...inner);
      upper();
      lower();
      ctx.clip();

      // 眼眶里的底色:虹膜外圈的深色
      const rim = mix(look.eyes, '#1a2030', 0.7);
      ctx.fillStyle = rim;
      ctx.fillRect(-CW, -CH, CW * 2, CH * 2);

      // 虹膜:随视线移动
      const cx = lookX * 20;
      const cy = 4 - gy * 11;
      const iris = ctx.createRadialGradient(cx, cy, 16, cx, cy, 64);
      iris.addColorStop(0, mix(look.eyes, '#ffffff', 0.22));
      iris.addColorStop(0.5, look.eyes);
      iris.addColorStop(0.85, mix(look.eyes, '#1a2030', 0.45));
      iris.addColorStop(1, rim);
      ctx.fillStyle = iris;
      ctx.beginPath();
      ctx.arc(cx, cy, 64, 0, Math.PI * 2);
      ctx.fill();

      // 瞳孔:大而圆,略竖
      ctx.fillStyle = '#0b0b10';
      ctx.beginPath();
      ctx.ellipse(cx, cy, THREE.MathUtils.lerp(38, 11, angry), 42, 0, 0, Math.PI * 2); // 生气时瞳孔缩成竖线
      ctx.fill();

      // 上眼皮投在眼球上的阴影
      const shade = ctx.createLinearGradient(0, upY * 0.75, 0, upY * 0.75 + 46);
      shade.addColorStop(0, 'rgba(10,12,24,0.6)');
      shade.addColorStop(1, 'rgba(10,12,24,0)');
      ctx.fillStyle = shade;
      ctx.fillRect(-CW, -CH, CW * 2, CH * 2);

      // 高光:小小的一点
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.ellipse(cx + 15, cy - 17, 6.5, 5, -0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // 眼睑:一圈细线,上面略粗一点;没有挑出去的眼线
    ctx.strokeStyle = this.lineColor;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(...outer);
    lower();
    ctx.stroke();
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(...inner);
    upper();
    ctx.stroke();
    // 内眼角一点点泪痕
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(...inner);
    ctx.lineTo(inner[0] - 7, inner[1] + 13);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  dispose() {
    this.texture.dispose();
  }
}

/** 哈气时张开的嘴:画出来的一小片,贴在鼻子下面;平时不显示 */
export class Mouth {
  readonly mesh: THREE.Mesh;

  constructor() {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    // 口腔
    ctx.fillStyle = '#6b2530';
    ctx.strokeStyle = '#3a2420';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(22, 30);
    ctx.quadraticCurveTo(64, 14, 106, 30);
    ctx.quadraticCurveTo(102, 104, 64, 112);
    ctx.quadraticCurveTo(26, 104, 22, 30);
    ctx.fill();
    ctx.stroke();
    // 舌头
    ctx.fillStyle = '#e88a98';
    ctx.beginPath();
    ctx.ellipse(64, 88, 22, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    // 上下四颗尖牙
    ctx.fillStyle = '#fffdf6';
    for (const [x, y, dir, len] of [[38, 28, 1, 30], [90, 28, 1, 30], [48, 108, -1, 18], [80, 108, -1, 18]]) {
      ctx.beginPath();
      ctx.moveTo(x - 7, y);
      ctx.lineTo(x + 7, y);
      ctx.lineTo(x, y + dir * len);
      ctx.fill();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.PlaneGeometry(0.085, 0.085);
    geo.rotateX(-Math.PI / 2); // 和眼睛一样:法线朝定位点的 +Y,"上"是 -Z
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: texture, alphaTest: 0.5, side: THREE.DoubleSide }));
    this.mesh.position.set(0, 0.012, 0.05); // 鼻子下方
    this.mesh.visible = false;
  }

  update(open: number) {
    this.mesh.visible = open > 0.15;
    this.mesh.scale.set(0.8 + 0.2 * open, 1, Math.max(0.05, open));
  }
}
