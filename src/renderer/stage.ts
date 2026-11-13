import * as THREE from 'three';

// 渲染舞台:先把猫画到离屏缓冲,再用一遍后处理描线。
// 线只出现在"深度突变"的地方:外轮廓,以及前面的部位挡住后面的部位处。
// 部件平滑相接的地方深度是连续的,所以不会出现一圈一圈的接缝线。

const DEPTH_RANGE = 2000;

const VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FRAG = `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 texel;
uniform float radius;
uniform float depthStep;
uniform vec3 lineColor;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tColor, vUv);
  float d = texture2D(tDepth, vUv).r;
  // 周围有多少采样点明显比当前像素更靠前:越多说明越贴近一条遮挡边
  float hits = 0.0;
  for (int i = 0; i < 16; i++) {
    float a = float(i) * 0.3926991;
    float dn = texture2D(tDepth, vUv + vec2(cos(a), sin(a)) * texel * radius).r;
    hits += smoothstep(depthStep, depthStep * 2.0, d - dn);
  }
  float edge = smoothstep(0.0, 0.3, hits / 16.0);
  // 半透明的东西在缓冲里是乘过透明度的,这里先还原成本来的颜色
  vec3 rgb = mix(c.rgb / max(c.a, 0.001), lineColor, edge);
  float alpha = max(c.a, edge);
  gl_FragColor = vec4(rgb, 1.0);
  #include <colorspace_fragment>
  gl_FragColor = vec4(gl_FragColor.rgb * alpha, alpha);
}`;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class Stage {
  readonly renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
  readonly scene = new THREE.Scene(); // 猫
  readonly under = new THREE.Scene(); // 画在猫下面、不描线的东西(阴影)
  readonly camera = new THREE.OrthographicCamera(0, 1, 1, 0, 100, 100 + DEPTH_RANGE);
  width = 1;
  height = 1;

  private target: THREE.WebGLRenderTarget;
  private quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private quadScene = new THREE.Scene();
  private quadCamera = new THREE.Camera();

  constructor(container: HTMLElement) {
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.autoClear = false;
    container.appendChild(this.renderer.domElement);
    this.camera.position.z = 100 + DEPTH_RANGE / 2;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xcfc4b8, 1.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.7);
    sun.position.set(300, 900, 900);
    this.scene.add(sun);

    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType),
    });
    this.quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: {
          tColor: { value: this.target.texture },
          tDepth: { value: this.target.depthTexture },
          texel: { value: new THREE.Vector2(1, 1) },
          radius: { value: 4 },
          depthStep: { value: 0.003 },
          lineColor: { value: new THREE.Color(0x3a2a20) },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        blendSrcAlpha: THREE.OneFactor,
        blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      })
    );
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    const dpr = window.devicePixelRatio;
    this.camera.right = width;
    this.camera.top = height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height);
    this.target.setSize(Math.round(width * dpr), Math.round(height * dpr));
    this.quad.material.uniforms.texel.value.set(1 / this.target.width, 1 / this.target.height);
  }

  /** color:线的颜色;widthPx:线宽;stepPx:前后相差多少像素才算遮挡 */
  setLine(color: string, widthPx: number, stepPx: number) {
    const u = this.quad.material.uniforms;
    u.lineColor.value.set(color);
    u.radius.value = widthPx * window.devicePixelRatio;
    u.depthStep.value = stepPx / DEPTH_RANGE;
  }

  /** rect:只在这块区域里绘制(窗口坐标,原点左下),用来省电;不传就画全屏 */
  render(rect?: Rect) {
    const { renderer, target } = this;
    const dpr = window.devicePixelRatio;

    target.scissorTest = false;
    renderer.setRenderTarget(target);
    renderer.clear();
    if (rect) {
      target.scissor.set(rect.x * dpr, rect.y * dpr, rect.w * dpr, rect.h * dpr);
      target.scissorTest = true;
      renderer.setRenderTarget(target);
    }
    renderer.render(this.scene, this.camera);

    renderer.setRenderTarget(null);
    renderer.setScissorTest(false);
    renderer.clear();
    if (rect) {
      renderer.setScissor(rect.x, rect.y, rect.w, rect.h);
      renderer.setScissorTest(true);
    }
    renderer.render(this.under, this.camera);
    renderer.render(this.quadScene, this.quadCamera);
  }
}
