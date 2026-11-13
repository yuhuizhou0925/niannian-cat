"""用 Blender 捏猫:blender --background --python tools/sculpt_cat.py

做法:
1. 用椭球和沿曲线扫出的管子摆出各个部位,再加上一撮撮往外支出去的毛(脸颊、胸口、后腿、尾巴);
2. 体素重建把它们融合成一张连续的网格,再轻度平滑,保留蓬松的毛束轮廓;
3. UV 分几块:头用绕一圈的经纬度展开,身体用"侧视图"投影,耳朵正反面各一块,花纹在运行时画;
4. 建骨骼、自动蒙皮,在头上放眼睛和鼻子的定位点,导出 assets/cat.glb。

坐标:猫朝 +X,+Y 是猫的左侧,+Z 向上,地面 z=0。
"""
import bpy, bmesh, math, os
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'cat.glb')
VOXEL = 0.0065
TARGET_FACES = 12000

# ---- 贴图图集的布局(运行时画花纹的代码用同一套数字,见 src/renderer/skin.ts)----
ATLAS_W, ATLAS_H = 2048, 1024
SIDE = dict(x0=-0.40, x1=1.00, z0=0.0, z1=1.0, px=1024)   # 侧视图:x → 横向,z → 纵向,占左半边
HEAD_CHART = dict(px0=1024, w=1024, h=512)                 # 头:绕头一圈的经纬度展开(正中是脸),占右上
# 耳朵的两块图用"头部坐标"(相对头的中心、除以头的大小),这样改头的大小和位置不用改画法
EAR_BACK = dict(y0=-0.25, z1=0.45, px0=1024, py0=768, scale=512)    # 耳朵背面:256×256
EAR_FRONT = dict(y0=-0.25, z1=0.32, px0=1280, py0=768, scale=1024)  # 耳朵正面:512×256

FX = 0.15   # 身体拉长的量:胸口以前的部分整体前移
UZ = 0.035  # 腿加长的量:身体整体抬高
HEAD = Vector((0.65 + FX, 0.0, 0.585 + UZ))
HS = 1.05   # 头的整体大小

bpy.ops.wm.read_factory_settings(use_empty=True)
bm = bmesh.new()


def H(dx, dy, dz):
    """头部坐标 → 模型坐标"""
    return HEAD + Vector((dx, dy, dz)) * HS


def R(*r):
    return tuple(v * HS for v in r)


def ellipsoid(center, radii, rot=None):
    m = Matrix.Translation(center) @ (rot or Matrix.Identity(4)) @ Matrix.Diagonal((*radii, 1.0))
    bmesh.ops.create_uvsphere(bm, u_segments=28, v_segments=18, radius=1.0, matrix=m)


def tuft(base, direction, length, radius):
    """一撮毛:从 base 沿 direction 伸出去、越来越尖的锥形,融合平滑后是一小束顺着方向的毛"""
    d = Vector(direction).normalized()
    rot = Vector((0, 0, 1)).rotation_difference(d).to_matrix().to_4x4()
    m = Matrix.Translation(Vector(base) + d * length * 0.42) @ rot
    bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=radius, radius2=0.005, depth=length, matrix=m)


def catmull(pts, t):
    n = len(pts) - 1
    x = min(max(t, 0.0), 1.0) * n
    i = min(int(x), n - 1)
    f = x - i
    p0, p1, p2, p3 = pts[max(i - 1, 0)], pts[i], pts[i + 1], pts[min(i + 2, n)]
    return 0.5 * ((2 * p1) + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f ** 3)


def lerp_list(vals, t):
    x = min(max(t, 0.0), 1.0) * (len(vals) - 1)
    i = min(int(x), len(vals) - 2)
    f = x - i
    f = f * f * (3 - 2 * f)
    return vals[i] + (vals[i + 1] - vals[i]) * f


def tube(points, radii, wide=1.0, rings=22, segs=20):
    """沿经过 points 的曲线扫出一根管子,两端用球封口。wide 是左右方向的宽度系数。"""
    pts = [Vector(p) for p in points]
    loops = []
    for i in range(rings):
        t = i / (rings - 1)
        c = catmull(pts, t)
        T = (catmull(pts, min(t + 0.01, 1)) - catmull(pts, max(t - 0.01, 0))).normalized()
        B = Vector((0, 1, 0)) - T * T.y
        B.normalize()
        N = T.cross(B)
        r = lerp_list(radii, t)
        loops.append([bm.verts.new(c + (N * math.cos(a) + B * math.sin(a) * wide) * r)
                      for a in (j / segs * 2 * math.pi for j in range(segs))])
    for a, b in zip(loops, loops[1:]):
        for j in range(segs):
            bm.faces.new((a[j], a[(j + 1) % segs], b[(j + 1) % segs], b[j]))
    bm.faces.new(loops[0])
    bm.faces.new(loops[-1])
    for p, r in ((pts[0], radii[0]), (pts[-1], radii[-1])):
        ellipsoid(p, (r, r * wide, r))


BZ = 0.335 + UZ  # 躯干中轴的高度

# ---------- 躯干:有胸腔、有腰,长毛让它显得厚 ----------
tube([(-0.02, 0, BZ), (0.16, 0, BZ), (0.34 + FX * 0.5, 0, BZ - 0.005), (0.47 + FX, 0, BZ + 0.012)],
     [0.165, 0.172, 0.162, 0.175], wide=1.0, rings=24)
# 胸口的围脖:往前、往下鼓出来的一大团毛
ellipsoid((0.515 + FX, 0, BZ + 0.02), (0.125, 0.18, 0.18))
ellipsoid((0.56 + FX, 0, BZ + 0.11), (0.1, 0.17, 0.12))
for deg in (-75, -50, -25, 0, 25, 50, 75):
    a = math.radians(deg)
    tuft((0.55 + FX + math.cos(a) * 0.04, math.sin(a) * 0.14, BZ - 0.02), (math.cos(a) * 0.3, math.sin(a) * 0.3, -0.9), 0.115, 0.055)
# 脖子:很粗,被毛盖住
tube([(0.46 + FX, 0, BZ + 0.08), (0.55 + FX, 0, BZ + 0.16), (0.62 + FX, 0, BZ + 0.225)], [0.15, 0.142, 0.13], wide=1.12, rings=10)

# ---------- 头:宽而圆的脸盘,脸颊饱满,口鼻短小,不要尖下巴 ----------
ellipsoid(H(0, 0, 0), R(0.148, 0.18, 0.145))
ellipsoid(H(0.01, 0, 0.03), R(0.13, 0.152, 0.12))               # 额头
for s in (-1, 1):
    ellipsoid(H(0.03, s * 0.105, -0.05), R(0.1, 0.095, 0.095))     # 脸颊:最宽处在口鼻的高度
    ellipsoid(H(0.128, s * 0.033, -0.058), R(0.045, 0.047, 0.04))  # 胡须垫
    # 脸颊边上顺着往外下方垂的毛
    tuft(H(0.0, s * 0.125, -0.05), (0.0, s * 0.62, -0.78), 0.12 * HS, 0.05 * HS)
    tuft(H(-0.03, s * 0.115, -0.085), (-0.1, s * 0.4, -0.9), 0.11 * HS, 0.05 * HS)
ellipsoid(H(0.1, 0, -0.045), R(0.06, 0.08, 0.055))              # 口鼻的底
ellipsoid(H(0.1, 0, -0.098), R(0.046, 0.055, 0.036))            # 下巴
ellipsoid(H(0.112, 0, -0.008), R(0.05, 0.045, 0.04))            # 鼻梁
ellipsoid(H(-0.01, 0, -0.105), R(0.125, 0.165, 0.085))          # 下巴后面到脖子的毛,把脸的下缘垫圆

# ---------- 耳朵:偏小、短而厚,长在头的两侧,耳尖圆 ----------
EAR_WIDE = 2.2
EAR_R = [0.034 * HS, 0.034 * HS, 0.026 * HS, 0.012 * HS]   # 前后方向的厚度(半径),宽度 = 厚度 × EAR_WIDE
EAR_PTS = {s: [H(-0.03, s * 0.095, 0.03), H(-0.03, s * 0.118, 0.115), H(-0.024, s * 0.142, 0.175), H(-0.016, s * 0.158, 0.215)]
           for s in (-1, 1)}
for s in (-1, 1):
    tube(EAR_PTS[s], EAR_R, wide=EAR_WIDE, rings=16, segs=24)


def ear_coords(p):
    """点 p 在哪只耳朵附近:返回 (侧, 沿耳朵的位置 0..1, 耳朵中轴上最近的点, 到中轴的左右距离/半宽)"""
    s = 1 if p.y > 0 else -1
    best = None
    for k in range(25):
        t = k / 24
        a = catmull(EAR_PTS[s], t)
        dist = (Vector((0, p.y, p.z)) - Vector((0, a.y, a.z))).length
        if best is None or dist < best[0]:
            best = (dist, t, a)
    dist, t, a = best
    return s, t, a, dist / (lerp_list(EAR_R, t) * EAR_WIDE)


def in_ear(p):
    d = (p - HEAD) / HS
    outside = (d.x / 0.158) ** 2 + (d.y / 0.19) ** 2 + ((d.z - 0.02) / 0.16) ** 2 > 1.1
    return outside and d.z > 0.07 and abs(d.y) > 0.04 and d.length < 0.4


# ---------- 腿:有肩和大腿的结构,往下收细,脚掌大而圆 ----------
for s in (-1, 1):
    y = s * 0.09
    ellipsoid((0.44 + FX, y, BZ - 0.01), (0.09, 0.07, 0.115))                # 肩
    tube([(0.44 + FX, y, BZ - 0.02), (0.432 + FX, y, 0.2), (0.447 + FX, y, 0.055)], [0.078, 0.058, 0.047], rings=14)
    ellipsoid((0.478 + FX, y, 0.04), (0.076, 0.06, 0.04))                    # 前脚掌
    tuft((0.42 + FX, y, 0.24), (-0.55, 0, -0.85), 0.11, 0.035)                 # 前腿后侧的饰毛
    y = s * 0.102
    rot = Matrix.Rotation(0.25, 4, 'Y')
    ellipsoid((0.065, y, 0.27 + UZ * 0.7), (0.135, 0.088, 0.16), rot)        # 大腿
    tube([(0.11, y, 0.19 + UZ * 0.5), (0.02, y, 0.135), (0.045, y, 0.055)], [0.064, 0.05, 0.047], rings=14)
    ellipsoid((0.08, y, 0.04), (0.083, 0.062, 0.04))                         # 后脚掌
    tuft((-0.03, s * 0.085, 0.29 + UZ * 0.6), (-0.5, s * 0.1, -0.85), 0.16, 0.055)   # 后腿的"裤子"毛
    tuft((0.0, s * 0.1, 0.22 + UZ * 0.4), (-0.6, s * 0.05, -0.8), 0.11, 0.042)

# ---------- 尾巴:又粗又蓬的一大把,边缘有毛束 ----------
TZ = UZ * 0.6
TAIL = [(-0.04, 0, 0.40 + TZ), (-0.17, 0, 0.47 + TZ), (-0.265, 0, 0.60 + TZ), (-0.285, 0, 0.75 + TZ), (-0.235, 0, 0.865 + TZ), (-0.14, 0, 0.93 + TZ)]
tube(TAIL, [0.055, 0.09, 0.112, 0.115, 0.1, 0.07], rings=30, segs=20)
TAIL_V = [Vector(p) for p in TAIL]
for i, t in enumerate((0.25, 0.4, 0.55, 0.7, 0.82)):
    c = catmull(TAIL_V, t)
    T = (catmull(TAIL_V, t + 0.02) - catmull(TAIL_V, t - 0.02)).normalized()
    out = Vector((-T.z, 0, T.x))  # 尾巴外侧(远离身体的一面)
    for sign in (1, -1):          # 毛顺着尾巴往尾尖方向披,外侧和内侧各一撮
        side = (0.35, -0.35)[i % 2]
        tuft(c + out * sign * 0.07, T * 0.85 + out * sign * 0.45 + Vector((0, side, 0)), 0.12, 0.058)

bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
mesh = bpy.data.meshes.new('cat')
bm.to_mesh(mesh)
bm.free()
cat = bpy.data.objects.new('cat', mesh)
bpy.context.collection.objects.link(cat)
bpy.context.view_layer.objects.active = cat
cat.select_set(True)


def modifier(kind, **props):
    mod = cat.modifiers.new(kind.lower(), kind)
    for k, v in props.items():
        setattr(mod, k, v)
    bpy.ops.object.modifier_apply(modifier=mod.name)


# 融合成一张网格,再轻度平滑:部位之间顺滑过渡,毛束的起伏保留下来
modifier('REMESH', mode='VOXEL', voxel_size=VOXEL, adaptivity=0)
modifier('SMOOTH', factor=0.5, iterations=9)
modifier('DECIMATE', ratio=min(1.0, TARGET_FACES / max(1, len(cat.data.polygons))))
modifier('TRIANGULATE')
modifier('SMOOTH', factor=0.5, iterations=2)
for p in cat.data.polygons:
    p.use_smooth = True

# 耳窝:把耳朵正面中间往里按一点,形成一个浅浅的凹面
for v in cat.data.vertices:
    if not in_ear(v.co):
        continue
    side, t, axis, u = ear_coords(v.co)
    if v.co.x > axis.x and u < 1 and t > 0.3:
        bump = math.sin(min(1.0, (t - 0.3) / 0.65) * math.pi) ** 0.7
        v.co.x -= 0.014 * HS * (1 - u * u) * bump
cat.data.validate()
print('faces after sculpt:', len(cat.data.polygons))

# ---------- UV ----------
mesh = cat.data
uv = mesh.uv_layers.new(name='UVMap')
for poly in mesh.polygons:
    c = poly.center
    ear = in_ear(c)
    ear_front = ear and c.x > ear_coords(c)[2].x  # 以耳朵的中轴面分正反面,分界正好落在耳朵边缘
    head = (c - HEAD).length < 0.25 * HS and c.z > HEAD.z - 0.15 * HS
    verts = [mesh.vertices[mesh.loops[li].vertex_index].co for li in poly.loop_indices]
    lons = [math.atan2(v.y, v.x - HEAD.x) for v in verts]
    if max(lons) - min(lons) > math.pi:  # 跨过后脑勺的接缝:都放到同一侧
        lons = [l + 2 * math.pi if l < 0 else l for l in lons]
    for li, v, lon in zip(poly.loop_indices, verts, lons):
        n = (v - HEAD) / HS  # 头部坐标
        if ear:
            chart = EAR_FRONT if ear_front else EAR_BACK
            px = chart['px0'] + (n.y - chart['y0']) * chart['scale']
            py = chart['py0'] + (chart['z1'] - n.z) * chart['scale']
        elif head:
            lat = math.asin(max(-1.0, min(1.0, n.z / max(n.length, 1e-6))))
            px = HEAD_CHART['px0'] + (lon / (2 * math.pi) + 0.5) * HEAD_CHART['w']
            py = (math.pi / 2 - lat) / math.pi * HEAD_CHART['h']
        else:
            px = (v.x - SIDE['x0']) / (SIDE['x1'] - SIDE['x0']) * SIDE['px']
            py = (SIDE['z1'] - v.z) / (SIDE['z1'] - SIDE['z0']) * ATLAS_H
        uv.data[li].uv = (px / ATLAS_W, 1.0 - py / ATLAS_H)

# ---------- 骨骼 ----------
arm_data = bpy.data.armatures.new('rig')
arm = bpy.data.objects.new('rig', arm_data)
bpy.context.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')


def bone(name, head, tail, parent=None, deform=True):
    b = arm_data.edit_bones.new(name)
    b.head, b.tail = Vector(head), Vector(tail)
    b.use_deform = deform
    if parent:
        b.parent = arm_data.edit_bones[parent]
    return b


SZ = BZ + 0.005
MID = 0.2 + (0.26 + FX) / 2
bone('root', (0, 0, 0), (0, 0, 0.1), deform=False)
bone('hips', (0.02, 0, SZ), (0.2, 0, SZ), 'root')
bone('spine1', (0.2, 0, SZ), (MID, 0, SZ), 'hips')
bone('chest', (MID, 0, SZ), (0.46 + FX, 0, SZ + 0.02), 'spine1')
bone('neck', (0.46 + FX, 0, SZ + 0.06), (0.58 + FX, 0, SZ + 0.19), 'chest')
bone('head', (0.58 + FX, 0, SZ + 0.19), HEAD + Vector((0.05, 0, 0.035)), 'neck')
for s, tag in ((1, 'L'), (-1, 'R')):
    bone('ear' + tag, EAR_PTS[s][1], EAR_PTS[s][3], 'head')
    y = s * 0.09
    bone('armU' + tag, (0.44 + FX, y, BZ - 0.035), (0.428 + FX, y, 0.2), 'chest')
    bone('armL' + tag, (0.428 + FX, y, 0.2), (0.447 + FX, y, 0.05), 'armU' + tag)
    bone('hand' + tag, (0.447 + FX, y, 0.05), (0.53 + FX, y, 0.035), 'armL' + tag)
    y = s * 0.102
    bone('legU' + tag, (0.05, y, 0.31 + UZ), (0.115, y, 0.185 + UZ * 0.5), 'hips')
    bone('legL' + tag, (0.115, y, 0.185 + UZ * 0.5), (0.02, y, 0.135), 'legU' + tag)
    bone('legM' + tag, (0.02, y, 0.135), (0.05, y, 0.05), 'legL' + tag)
    bone('foot' + tag, (0.05, y, 0.05), (0.14, y, 0.035), 'legM' + tag)
prev = 'hips'
tail_pts = [catmull(TAIL_V, i / 6) for i in range(7)]
for i in range(6):
    bone('tail%d' % (i + 1), tail_pts[i], tail_pts[i + 1], prev)
    prev = 'tail%d' % (i + 1)
bpy.ops.object.mode_set(mode='OBJECT')

# 自动蒙皮
bpy.ops.object.select_all(action='DESELECT')
cat.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
print('vertex groups:', len(cat.vertex_groups), 'unweighted verts:', sum(1 for v in cat.data.vertices if not v.groups))

# ---------- 眼睛和鼻子的定位点:从正前方往脸上打射线,落在哪就放哪 ----------
bpy.context.view_layer.update()
tree = BVHTree.FromObject(cat, bpy.context.evaluated_depsgraph_get())


def marker(name, y, z):
    hit, normal, _, _ = tree.ray_cast(Vector((2.0, y, z)), Vector((-1, 0, 0)))
    e = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(e)
    e.parent = arm
    e.parent_type = 'BONE'
    e.parent_bone = 'head'
    bpy.context.view_layer.update()
    # 局部 Z 轴 = 表面法线,局部 Y 轴尽量朝上
    e.matrix_world = Matrix.Translation(hit) @ normal.to_track_quat('Z', 'Y').to_matrix().to_4x4()
    print(name, tuple(round(c, 3) for c in hit))


marker('eye_L', 0.078 * HS, HEAD.z + 0.012 * HS)
marker('eye_R', -0.078 * HS, HEAD.z + 0.012 * HS)
marker('nose', 0.0, HEAD.z - 0.03 * HS)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_skins=True,
                          export_animations=False, export_materials='NONE', export_normals=True, export_texcoords=True)
print('exported', OUT, os.path.getsize(OUT), 'bytes')
