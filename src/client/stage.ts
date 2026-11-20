import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Mat, Puzzle, V3 } from '../shared/puzzle';

// Ink blue, terracotta, sage, plum.
export const PIECE_COLORS = [0x3f6fb5, 0xd0613f, 0x5f9a5a, 0x8d5a9e];
export const PIECE_CSS = ['#3f6fb5', '#d0613f', '#5f9a5a', '#8d5a9e'];

const WALL_Z = -6.5;
// One quiet accent: the goal is drawn in ink on the wall.
const INK = new THREE.Color(0x1d1915);


type Shot = 'hero' | 'play';

function radialTexture(inner: string, outer: string, stop = 0): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(stop, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export type StagePiece = { cells: V3[]; anchor: V3; color: number; mat: Mat };
export type FaceHit = { piece: number; cell: V3; normal: V3 };

type Spin = { from: THREE.Quaternion; to: THREE.Quaternion; t0: number; dur: number };
type Slide = { from: THREE.Vector3; to: THREE.Vector3; t0: number; dur: number };

function matToQuat(m: Mat): THREE.Quaternion {
  const m4 = new THREE.Matrix4().set(
    m[0]!, m[1]!, m[2]!, 0,
    m[3]!, m[4]!, m[5]!, 0,
    m[6]!, m[7]!, m[8]!, 0,
    0, 0, 0, 1,
  );
  return new THREE.Quaternion().setFromRotationMatrix(m4);
}

function plasterTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ece7df';
  g.fillRect(0, 0, 256, 256);
  const img = g.getImageData(0, 0, 256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 14;
    img.data[i] = img.data[i]! + n;
    img.data[i + 1] = img.data[i + 1]! + n;
    img.data[i + 2] = img.data[i + 2]! + n;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 3);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function poolTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(128, 128, 8, 128, 128, 128);
  grd.addColorStop(0, 'rgba(255,214,150,0.16)');
  grd.addColorStop(1, 'rgba(255,214,150,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const cellXY = (k: string): [number, number] => {
  const [x = '0', y = '0'] = k.split(',');
  return [Number(x), Number(y)];
};

/** Thin quads along the outside edge of a set of wall cells. */
function outlineGeometry(cells: string[], width: number): THREE.BufferGeometry {
  const set = new Set(cells);
  const pos: number[] = [];
  const quad = (x1: number, y1: number, x2: number, y2: number) => {
    const hw = width / 2;
    const [ax, ay, bx, by] = [x1 - hw, y1 - hw, x2 + hw, y2 + hw];
    pos.push(ax, ay, 0, bx, ay, 0, bx, by, 0, ax, ay, 0, bx, by, 0, ax, by, 0);
  };
  for (const k of cells) {
    const [x, y] = cellXY(k);
    const has = (dx: number, dy: number) => set.has(`${x + dx},${y + dy}`);
    if (!has(0, 1)) quad(x - 0.5, y + 0.5, x + 0.5, y + 0.5);
    if (!has(0, -1)) quad(x - 0.5, y - 0.5, x + 0.5, y - 0.5);
    if (!has(-1, 0)) quad(x - 0.5, y - 0.5, x - 0.5, y + 0.5);
    if (!has(1, 0)) quad(x + 0.5, y - 0.5, x + 0.5, y + 0.5);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return geo;
}

export class Stage {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  private keyLight: THREE.DirectionalLight;
  private root = new THREE.Group(); // everything that belongs to the current puzzle
  private pieces: THREE.Group[] = [];
  private pedestals: THREE.Mesh[] = [];
  private rings: THREE.Mesh[] = [];
  private spins = new Map<number, Spin>();
  private slides = new Map<number, Slide>();
  private targetCells = new Map<string, THREE.Mesh>();
  private strayPool: THREE.Mesh[] = [];
  private outline: THREE.Mesh | null = null;
  private outlineGlow: THREE.Mesh | null = null;
  private grid: THREE.LineSegments;
  private sparks: { mesh: THREE.Mesh; v: THREE.Vector3; life: number }[] = [];
  private selected = 0;
  private winAt = 0;
  private pieceCount = 1;
  private raycaster = new THREE.Raycaster();
  private clock = new THREE.Clock();
  private cellGeo = new THREE.PlaneGeometry(1, 1);
  private cube = new RoundedBoxGeometry(0.94, 0.94, 0.94, 4, 0.1);
  private shot: Shot = 'hero';
  private camPos = new THREE.Vector3(4, 3, 9);
  private camLook = new THREE.Vector3(0, 0, -4);
  private playPos = new THREE.Vector3();
  private playLook = new THREE.Vector3();
  private loadedAt = 0;
  private envMap: THREE.Texture;
  private contactTex = radialTexture('rgba(0,0,0,0.7)', 'rgba(0,0,0,0)');

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Lights are kept dim and exposure high, so the scene sits below 1.0
    // and only the deliberately bright gold crosses the bloom threshold.
    this.renderer.toneMappingExposure = 1.45;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Reflections for glossy blocks and brass.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    // Only the blocks, brass and floor get reflections: on the wall they'd wash out the shadows.
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    this.scene.background = new THREE.Color(0x15110e);
    this.scene.fog = new THREE.Fog(0x15110e, 16, 30);

    // The light that casts the puzzle shadow: straight at the wall.
    this.keyLight = new THREE.DirectionalLight(0xfff1dc, 1.3);
    this.keyLight.position.set(0, 0, 12);
    this.keyLight.target.position.set(0, 0, WALL_Z);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    const sc = this.keyLight.shadow.camera;
    sc.left = -8; sc.right = 8; sc.top = 6; sc.bottom = -6; sc.near = 1; sc.far = 30;
    this.keyLight.shadow.bias = -0.0004;
    this.keyLight.shadow.normalBias = 0.01;
    this.scene.add(this.keyLight, this.keyLight.target);

    // Soft fill so the blocks read as 3D from above. No shadows.
    const top = new THREE.DirectionalLight(0xffd9a8, 0.6);
    // Nearly straight down, so it lights the blocks but barely touches the wall.
    top.position.set(2.5, 12, 1.2);
    top.target.position.set(0, -2, 0.6);
    this.scene.add(top.target);
    this.scene.add(top);
    this.scene.add(new THREE.HemisphereLight(0xffeedd, 0x221a14, 0.16));

    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(26, 14),
      new THREE.MeshStandardMaterial({ map: plasterTexture(), roughness: 0.95, envMapIntensity: 0 }),
    );
    wall.position.set(0, 1, WALL_Z);
    wall.receiveShadow = true;
    this.scene.add(wall);
    // Darken the wall's edges so the light reads as a spotlight.
    const wallShade = new THREE.Mesh(
      new THREE.PlaneGeometry(26, 14),
      new THREE.MeshBasicMaterial({
        map: radialTexture('rgba(10,6,3,0)', 'rgba(10,6,3,0.85)', 0.25),
        transparent: true,
        depthWrite: false,
      }),
    );
    wallShade.position.set(0, 0.6, WALL_Z + 0.004);
    wallShade.scale.set(1, 1.15, 1);
    this.scene.add(wallShade);
    // Skirting line where wall meets floor
    const skirt = new THREE.Mesh(
      new THREE.BoxGeometry(26, 0.18, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x2b231c, roughness: 0.5, metalness: 0.2 }),
    );
    skirt.position.set(0, -2.01, WALL_Z + 0.06);
    this.scene.add(skirt);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 30),
      new THREE.MeshStandardMaterial({ color: 0x17120e, roughness: 0.6, metalness: 0.1, envMap: this.envMap, envMapIntensity: 0.12 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2.1;
    this.scene.add(floor);
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 10),
      new THREE.MeshBasicMaterial({ map: poolTexture(), transparent: true, depthWrite: false }),
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(0, -2.09, -0.5);
    this.scene.add(pool);

    // Builder guide: the 3×3×3 space a piece may use.
    this.grid = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(3, 3, 3)),
      new THREE.LineBasicMaterial({ color: 0xf4ebdc, transparent: true, opacity: 0.25 }),
    );
    this.grid.visible = false;
    this.scene.add(this.grid, this.root);



    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---------- loading ----------

  private clear() {
    this.scene.remove(this.root);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.pieces = [];
    this.pedestals = [];
    this.rings = [];
    this.spins.clear();
    this.slides.clear();
    this.targetCells.clear();
    this.strayPool = [];
    this.outline = this.outlineGlow = null;
    this.winAt = 0;
    this.keyLight.intensity = 1.3;
    this.loadedAt = performance.now();
  }

  /** 'hero': slow drifting title shot. 'play': the puzzle view. */
  setShot(shot: Shot) {
    this.shot = shot;
  }

  /** Show a puzzle: pieces in their start pose plus the gold target. */
  load(puzzle: Puzzle) {
    this.clear();
    this.grid.visible = false;
    for (const k of puzzle.target) {
      const [x, y] = cellXY(k);
      const m = new THREE.Mesh(
        this.cellGeo,
        new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.08, depthWrite: false }),
      );
      m.position.set(x, y, WALL_Z + 0.01);
      this.targetCells.set(k, m);
      this.root.add(m);
    }
    this.outlineGlow = new THREE.Mesh(
      outlineGeometry(puzzle.target, 0.22),
      new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0, depthWrite: false }),
    );
    this.outline = new THREE.Mesh(
      outlineGeometry(puzzle.target, 0.06),
      new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }),
    );
    this.outlineGlow.position.z = this.outline.position.z = WALL_Z + 0.02;
    this.root.add(this.outlineGlow, this.outline);
    this.setPieces(puzzle.pieces.map((p) => ({ cells: p.cells, anchor: p.anchor, color: p.color, mat: p.start })), true);
  }

  /** (Re)build the piece meshes. Used by puzzles and by the builder. */
  setPieces(list: StagePiece[], dropIn = false) {
    for (const g of this.pieces) this.root.remove(g);
    for (const p of this.pedestals) this.root.remove(p);
    for (const r of this.rings) this.root.remove(r);
    const oldPos = this.pieces.map((g) => g.position.clone());
    this.pieces = [];
    this.pedestals = [];
    this.rings = [];
    this.pieceCount = list.length;
    list.forEach((p, i) => {
      const color = PIECE_COLORS[p.color % PIECE_COLORS.length]!;
      const mat = new THREE.MeshPhysicalMaterial({
        color,
        roughness: 0.36,
        metalness: 0,
        clearcoat: 0.7,
        clearcoatRoughness: 0.22,
        envMap: this.envMap,
        envMapIntensity: 0.25,
      });
      const g = new THREE.Group();
      g.position.set(...p.anchor);
      for (const c of p.cells) {
        const m = new THREE.Mesh(this.cube, mat);
        m.position.set(...c);
        m.castShadow = true;
        m.userData.piece = i;
        m.userData.cell = c;
        g.add(m);
      }
      g.quaternion.copy(matToQuat(p.mat));
      g.userData.dropAt = dropIn ? performance.now() + 250 + i * 140 : 0;
      if (dropIn) g.position.y = 5;
      this.pieces.push(g);
      this.root.add(g);
      // glide pieces that moved sideways (builder adding a piece)
      const before = oldPos[i];
      if (before && before.x !== p.anchor[0]) {
        this.slides.set(i, { from: before, to: new THREE.Vector3(...p.anchor), t0: performance.now(), dur: 300 });
        g.position.copy(before);
      }

      const ped = new THREE.Mesh(
        new THREE.CylinderGeometry(1.05, 1.15, 0.18, 48),
        new THREE.MeshStandardMaterial({ color: 0x2a231d, roughness: 0.6, metalness: 0.3 }),
      );
      ped.position.set(p.anchor[0], -2.0, p.anchor[2]);
      this.pedestals.push(ped);
      this.root.add(ped);
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(1.06, 0.035, 10, 72),
        new THREE.MeshStandardMaterial({ color: 0x6b645c, metalness: 1, roughness: 0.35, envMap: this.envMap, envMapIntensity: 0.5 }),
      );
      rim.rotation.x = Math.PI / 2;
      rim.position.set(p.anchor[0], -1.91, p.anchor[2]);
      this.root.add(rim);
      const contact = new THREE.Mesh(
        new THREE.PlaneGeometry(3.4, 3.4),
        new THREE.MeshBasicMaterial({ map: this.contactTex, transparent: true, depthWrite: false }),
      );
      contact.rotation.x = -Math.PI / 2;
      contact.position.set(p.anchor[0], -2.085, p.anchor[2]);
      this.root.add(contact);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.2, 0.018, 8, 96),
        new THREE.MeshBasicMaterial({
          color: 0xf3ede4,
          transparent: true,
          opacity: 0.8,
        }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.set(p.anchor[0], -1.89, p.anchor[2]);
      this.rings.push(ring);
      this.root.add(ring);
    });
    this.select(Math.min(this.selected, list.length - 1));
    this.resize();
  }

  showGrid(on: boolean) {
    this.grid.visible = on;
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    const span = Math.max(4.6, this.pieceCount * 1.6 + 2.6);
    const portrait = aspect < 1;
    const dist = portrait ? 12.5 : 15.5;
    const vfov = 2 * Math.atan(Math.tan(Math.atan(span / dist)) / Math.min(aspect, 1.6)) * (180 / Math.PI);
    this.camera.fov = THREE.MathUtils.clamp(vfov, 34, 72);
    this.playLook.set(0, portrait ? -0.6 : 0.2, -3.2);
    // One or two pieces need less room, so move in closer on narrow screens.
    const zoom = portrait ? Math.max(0.66, Math.min(1, (this.pieceCount * 1.6 + 2.6) / 7.4)) : 1;
    this.playPos
      .set(0, portrait ? 8.6 : 8, portrait ? 12.5 : 11.5)
      .sub(this.playLook)
      .multiplyScalar(zoom)
      .add(this.playLook);
    this.camera.updateProjectionMatrix();
  }

  select(i: number) {
    this.selected = Math.max(0, i);
    this.pieces.forEach((g, j) => {
      const on = j === this.selected;
      g.traverse((o) => {
        if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) {
          o.material.emissive.copy(on ? o.material.color : new THREE.Color(0));
          o.material.emissiveIntensity = on ? 0.16 : 0;
        }
      });
    });
    this.rings.forEach((r, j) => (r.visible = j === this.selected));
    const g = this.pieces[this.selected];
    if (g) this.grid.position.copy(g.position);
  }

  /** Animate piece i to orientation m. */
  turn(i: number, m: Mat, dur = 260) {
    const g = this.pieces[i];
    if (!g) return;
    this.spins.set(i, { from: g.quaternion.clone(), to: matToQuat(m), t0: performance.now(), dur });
  }

  /** Tint covered target cells and mark stray shadow cells. */
  showCoverage(shadow: string[]) {
    const covered = new Set(shadow);
    for (const [k, m] of this.targetCells) {
      if (m.material instanceof THREE.MeshBasicMaterial) m.material.opacity = covered.has(k) ? 0 : 0.08;
    }
    const strays = shadow.filter((k) => !this.targetCells.has(k));
    while (this.strayPool.length < strays.length) {
      const m = new THREE.Mesh(
        this.cellGeo,
        new THREE.MeshBasicMaterial({ color: 0xd2563a, transparent: true, opacity: 0.07, depthWrite: false }),
      );
      this.root.add(m);
      this.strayPool.push(m);
    }
    this.strayPool.forEach((m, j) => {
      const k = strays[j];
      m.visible = !!k;
      if (k) {
        const [x, y] = cellXY(k);
        m.position.set(x, y, WALL_Z + 0.011);
      }
    });
  }

  private hit(clientX: number, clientY: number) {
    const r = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(v, this.camera);
    return this.raycaster.intersectObjects(this.pieces, true)[0];
  }

  /** Piece under a screen point, or null. */
  pick(clientX: number, clientY: number): number | null {
    const p = this.hit(clientX, clientY)?.object.userData.piece;
    return typeof p === 'number' ? p : null;
  }

  /** Block and face under a screen point, in the piece's own coordinates. */
  pickFace(clientX: number, clientY: number): FaceHit | null {
    const h = this.hit(clientX, clientY);
    const piece = h?.object.userData.piece;
    const cell = h?.object.userData.cell;
    if (!h?.face || typeof piece !== 'number' || !Array.isArray(cell)) return null;
    // Rounded edges have slanted normals: snap to the strongest axis.
    const n = h.face.normal;
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    const normal: V3 =
      ax >= ay && ax >= az ? [Math.sign(n.x), 0, 0] : ay >= az ? [0, Math.sign(n.y), 0] : [0, 0, Math.sign(n.z)];
    const [cx = 0, cy = 0, cz = 0] = cell.map(Number);
    return { piece, cell: [cx, cy, cz], normal };
  }

  celebrate() {
    this.winAt = performance.now();
  }

  private frame() {
    const now = performance.now();
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = now / 1000;

    // Camera: glide between the drifting hero shot and the play view.
    const portrait = this.camera.aspect < 1;
    // On phones the card covers the bottom half, so aim low and keep the pieces up top.
    const heroPos = portrait
      ? new THREE.Vector3(Math.sin(t * 0.12) * 1.4 + 0.8, 6.8, 10)
      : new THREE.Vector3(Math.sin(t * 0.12) * 3.2 + 2.6, 2.8, 8.8);
    const heroLook = portrait ? new THREE.Vector3(0, -3.6, -2.4) : new THREE.Vector3(0, 0.4, -4.5);
    const goalPos = this.shot === 'hero' ? heroPos : this.playPos;
    const goalLook = this.shot === 'hero' ? heroLook : this.playLook;
    const k = 1 - Math.exp(-dt * (this.shot === 'hero' ? 1.2 : 2.6));
    this.camPos.lerp(goalPos, k);
    this.camLook.lerp(goalLook, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);

    // Pieces drop onto their pedestals one by one.
    this.pieces.forEach((g, i) => {
      const at = g.userData.dropAt;
      if (typeof at !== 'number' || !at) return;
      const u = Math.min(1, Math.max(0, (now - at) / 650));
      const e = u < 1 ? 1 - Math.pow(1 - u, 3) * Math.cos(u * Math.PI * 2.2) : 1;
      const base = this.slides.get(i)?.to.y ?? 0;
      g.position.y = base + (1 - e) * 5;
      if (u >= 1) g.userData.dropAt = 0;
    });

    // Outline fades in after the pieces land.
    const fade = Math.min(1, Math.max(0, (now - this.loadedAt - 500) / 700));
    if (!this.winAt) {
      if (this.outline?.material instanceof THREE.MeshBasicMaterial) this.outline.material.opacity = 0.95 * fade;
      if (this.outlineGlow?.material instanceof THREE.MeshBasicMaterial)
        this.outlineGlow.material.opacity = 0;
    }


    for (const [i, s] of this.spins) {
      const u = Math.min(1, (now - s.t0) / s.dur);
      const c = 1.4; // ease-out-back: a weighty little settle
      const e = 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2);
      this.pieces[i]?.quaternion.slerpQuaternions(s.from, s.to, e);
      if (u >= 1) {
        this.pieces[i]?.quaternion.copy(s.to);
        this.spins.delete(i);
      }
    }
    for (const [i, s] of this.slides) {
      const u = Math.min(1, (now - s.t0) / s.dur);
      const e = 1 - Math.pow(1 - u, 3);
      this.pieces[i]?.position.lerpVectors(s.from, s.to, e);
      if (i === this.selected && this.pieces[i]) this.grid.position.copy(this.pieces[i].position);
      if (u >= 1) this.slides.delete(i);
    }

    const ring = this.rings[this.selected];
    if (ring && ring.material instanceof THREE.MeshBasicMaterial) {
      ring.material.opacity = this.winAt ? 0 : 0.55 + Math.sin(now / 700) * 0.2;
      ring.scale.setScalar(1);
    }

    if (this.winAt) {
      const w = (now - this.winAt) / 1000;
      const flash = Math.max(0, 1 - w * 0.8);
      this.keyLight.intensity = 1.3 + flash * 0.35;
      if (this.outline?.material instanceof THREE.MeshBasicMaterial) {
        this.outline.material.opacity = 0.95;
        this.outline.material.color.copy(INK);
      }
      if (this.outlineGlow?.material instanceof THREE.MeshBasicMaterial) this.outlineGlow.material.opacity = 0;
      this.pieces.forEach((g, i) => {
        const q = w * 6 - i * 0.6;
        g.scale.setScalar(q > 0 && w < 1.5 ? 1 + Math.max(0, Math.sin(Math.min(q, Math.PI))) * 0.06 : 1);
      });
    }

    this.sparks = this.sparks.filter((s) => {
      s.life -= dt * 0.7;
      s.mesh.position.addScaledVector(s.v, dt);
      s.v.y -= dt * 0.6;
      if (s.mesh.material instanceof THREE.MeshBasicMaterial) s.mesh.material.opacity = Math.max(0, s.life);
      if (s.life <= 0) {
        this.scene.remove(s.mesh);
        return false;
      }
      return true;
    });

    this.renderer.render(this.scene, this.camera);
  }
}
