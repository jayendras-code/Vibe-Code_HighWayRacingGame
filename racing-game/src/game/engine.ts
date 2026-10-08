import * as THREE from "three";
import { AudioManager } from "./audio";
import { CONFIG, laneX } from "./config";
import { getHighScore, saveHighScore } from "./storage";

export type GameState = "start" | "playing" | "paused" | "gameover";

export type HudPayload = {
  score: number;
  speed: number;
  nitro: number;
  highScore: number;
  boosting: boolean;
  muted: boolean;
};

export type GameOverPayload = {
  score: number;
  isNewHigh: boolean;
};

export type EngineCallbacks = {
  onHud: (hud: HudPayload) => void;
  onStateChange: (state: GameState) => void;
  onGameOver: (payload: GameOverPayload) => void;
};

type ObstacleKind = "car" | "cone" | "barrier";

type Obstacle = {
  mesh: THREE.Group;
  kind: ObstacleKind;
  active: boolean;
  hw: number;
  hl: number;
  extraSpeed: number;
  scored: boolean;
};

type ScrollItem = {
  mesh: THREE.Object3D;
  span: number;
};

const CAR_COLORS = [0x2b6cb0, 0xdd6b20, 0x38a169, 0x805ad5, 0xd69e2e, 0x319795];

export class GameEngine {
  private container: HTMLElement;
  private callbacks: EngineCallbacks;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private audio = new AudioManager();
  private disposed = false;
  private rafId = 0;
  private loopRunning = false;

  private state: GameState = "start";
  private keys = new Set<string>();
  private score = 0;
  private distance = 0;
  private highScore = 0;
  private cruiseSpeed = CONFIG.player.startSpeed;
  private nitro = CONFIG.nitro.start;
  private nitroLocked = false;
  private boosting = false;
  private wasBoosting = false;
  private hudAcc = 0;
  private spawnAcc = 0;
  private elapsed = 0;

  private player = new THREE.Group();
  private wheels: THREE.Mesh[] = [];
  private flame: THREE.Mesh | null = null;
  private lane = CONFIG.player.startLane;
  private playerX = laneX(CONFIG.player.startLane);

  private obstacles: Obstacle[] = [];
  private roadItems: ScrollItem[] = [];
  private scenery: ScrollItem[] = [];

  private camX = 0;
  private currentFov = CONFIG.camera.fov;

  constructor(container: HTMLElement, callbacks: EngineCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.highScore = getHighScore();

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(CONFIG.renderer.clearColor);
    this.scene.fog = new THREE.Fog(CONFIG.fog.color, CONFIG.fog.near, CONFIG.fog.far);

    this.camera = new THREE.PerspectiveCamera(
      CONFIG.camera.fov,
      this.aspect(),
      CONFIG.camera.near,
      CONFIG.camera.far,
    );

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.renderer.maxPixelRatio));
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setClearColor(CONFIG.renderer.clearColor);
    this.renderer.shadowMap.enabled = false;
    this.container.appendChild(this.renderer.domElement);

    this.addLights();
    this.buildEnvironment();
    this.buildPlayer();
    this.resetPlayfields();
    this.placeCamera(true);
    this.bindEvents();
    this.emitHud();
    this.setState("start");
    this.beginLoop();
  }

  start(): void {
    if (this.disposed || this.state === "playing") return;
    this.audio.ensure();
    if (this.state === "paused") {
      this.setState("playing");
      this.clock.getDelta();
      return;
    }
    this.resetPlayfields();
    this.setState("playing");
    this.audio.startJingle();
    this.clock.getDelta();
  }

  restart(): void {
    if (this.disposed) return;
    this.audio.ensure();
    this.resetPlayfields();
    this.setState("playing");
    this.audio.startJingle();
    this.clock.getDelta();
  }

  pause(): void {
    if (this.disposed) return;
    if (this.state === "playing") {
      this.setState("paused");
      this.audio.setEngine(false, this.cruiseSpeed, false);
    } else if (this.state === "paused") {
      this.setState("playing");
      this.clock.getDelta();
    }
  }

  toggleMute(): boolean {
    this.audio.ensure();
    const muted = this.audio.toggleMute();
    this.emitHud();
    return muted;
  }

  nudgeLane(dir: -1 | 1): void {
    this.lane = THREE.MathUtils.clamp(this.lane + dir, 0, CONFIG.lanes.count - 1);
  }

  setPointerNitro(held: boolean): void {
    if (held) this.keys.add("shift");
    else {
      this.keys.delete("shift");
      this.keys.delete(" ");
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loopRunning = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("resize", this.onResize);
    this.audio.dispose();
    const seenGeo = new Set<THREE.BufferGeometry>();
    const seenMat = new Set<THREE.Material>();
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry && !seenGeo.has(mesh.geometry)) {
        seenGeo.add(mesh.geometry);
        mesh.geometry.dispose();
      }
      const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      for (const mat of mats) {
        if (!seenMat.has(mat)) {
          seenMat.add(mat);
          mat.dispose();
        }
      }
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    const canvas = this.renderer.domElement;
    canvas.remove();
  }

  private beginLoop(): void {
    if (this.loopRunning) return;
    this.loopRunning = true;
    this.clock.start();
    const tick = () => {
      if (this.disposed || !this.loopRunning) return;
      this.rafId = requestAnimationFrame(tick);
      this.update();
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private update(): void {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.state === "playing") this.updatePlay(dt);
    else this.audio.setEngine(false, this.cruiseSpeed, false);

    this.flickerFlame(dt);
    this.placeCamera(false, dt);
    this.renderer.render(this.scene, this.camera);

    this.hudAcc += dt;
    if (this.hudAcc >= 1 / CONFIG.hud.fps) {
      this.hudAcc = 0;
      this.emitHud();
    }
  }

  private updatePlay(dt: number): void {
    this.elapsed += dt;
    this.handleSpeed(dt);
    this.handleNitro(dt);

    const worldSpeed = this.cruiseSpeed * (this.boosting ? CONFIG.nitro.multiplier : 1);
    this.distance += worldSpeed * dt * CONFIG.score.distancePerUnit;
    this.score = Math.floor(this.distance);

    this.playerX = THREE.MathUtils.damp(this.playerX, laneX(this.lane), CONFIG.player.steerLerp, dt);
    this.player.position.x = this.playerX;
    const targetRoll = (laneX(this.lane) - this.playerX) * CONFIG.player.rollAmount * 0.35;
    this.player.rotation.z = THREE.MathUtils.damp(
      this.player.rotation.z,
      targetRoll,
      CONFIG.player.rollLerp,
      dt,
    );

    const spin = worldSpeed * dt * 1.6;
    for (const wheel of this.wheels) wheel.rotation.x += spin;

    this.scrollItems(this.roadItems, worldSpeed, dt);
    this.scrollItems(this.scenery, worldSpeed, dt);
    this.updateObstacles(worldSpeed, dt);
    this.spawnAcc += dt;
    const interval = Math.max(
      CONFIG.spawn.intervalMin,
      CONFIG.spawn.intervalStart - this.elapsed * CONFIG.difficulty.spawnRampPerSec,
    );
    if (this.spawnAcc >= interval) {
      this.spawnAcc = 0;
      this.spawnWave();
    }

    this.audio.setEngine(true, worldSpeed, this.boosting);
  }

  private handleSpeed(dt: number): void {
    const up = this.keys.has("arrowup") || this.keys.has("w");
    const down = this.keys.has("arrowdown") || this.keys.has("s");
    if (up) this.cruiseSpeed += CONFIG.player.accel * dt;
    if (down) this.cruiseSpeed -= CONFIG.player.brake * dt;
    this.cruiseSpeed += CONFIG.difficulty.speedRampPerSec * dt;
    this.cruiseSpeed = THREE.MathUtils.clamp(
      this.cruiseSpeed,
      CONFIG.player.minSpeed,
      CONFIG.player.maxSpeed,
    );
  }

  private handleNitro(dt: number): void {
    const want =
      (this.keys.has("shift") || this.keys.has(" ")) &&
      this.nitro > 0 &&
      !this.nitroLocked;
    this.boosting = want;
    if (this.boosting && !this.wasBoosting) this.audio.nitroWhoosh();
    this.wasBoosting = this.boosting;

    if (this.boosting) {
      this.nitro -= CONFIG.nitro.drainPerSec * dt;
      if (this.nitro <= 0) {
        this.nitro = 0;
        this.boosting = false;
        this.nitroLocked = true;
      }
    } else {
      this.nitro = Math.min(CONFIG.nitro.max, this.nitro + CONFIG.nitro.rechargePerSec * dt);
      if (this.nitro >= CONFIG.nitro.lockUntil) this.nitroLocked = false;
    }

    if (this.flame) this.flame.visible = this.boosting;
  }

  private flickerFlame(dt: number): void {
    if (!this.flame) return;
    if (!this.flame.visible) return;
    const pulse = 0.85 + Math.sin(performance.now() * 0.04) * 0.2 + Math.random() * 0.15;
    this.flame.scale.set(pulse, 1.1 + Math.random() * 0.4, pulse);
    const mat = this.flame.material as THREE.MeshStandardMaterial;
    mat.emissive.set(Math.random() > 0.5 ? 0xff6a00 : 0x3b9dff);
    mat.color.copy(mat.emissive);
    void dt;
  }

  private scrollItems(items: ScrollItem[], speed: number, dt: number): void {
    for (const item of items) {
      item.mesh.position.z += speed * dt;
      if (item.mesh.position.z > CONFIG.road.wrapZ) {
        item.mesh.position.z -= item.span;
      }
    }
  }

  private updateObstacles(worldSpeed: number, dt: number): void {
    for (const obs of this.obstacles) {
      if (!obs.active) continue;
      obs.mesh.position.z += (worldSpeed + obs.extraSpeed) * dt;
      if (
        !obs.scored &&
        obs.mesh.position.z > this.player.position.z + 1.2
      ) {
        obs.scored = true;
        const dx = Math.abs(obs.mesh.position.x - this.player.position.x);
        if (dx < CONFIG.score.nearMissMaxDx) {
          this.distance += CONFIG.score.nearMissPoints;
          this.nitro = Math.min(CONFIG.nitro.max, this.nitro + CONFIG.nitro.nearMissFill);
          this.audio.nearMiss();
        }
      }
      if (obs.mesh.position.z > CONFIG.spawn.recycleZ) {
        this.deactivate(obs);
        continue;
      }
      if (this.hitsPlayer(obs)) this.crash();
    }
  }

  private hitsPlayer(obs: Obstacle): boolean {
    const dx = Math.abs(obs.mesh.position.x - this.player.position.x);
    const dz = Math.abs(obs.mesh.position.z - this.player.position.z);
    return dx < obs.hw + CONFIG.player.halfWidth && dz < obs.hl + CONFIG.player.halfLength;
  }

  private crash(): void {
    if (this.state !== "playing") return;
    this.boosting = false;
    if (this.flame) this.flame.visible = false;
    this.audio.setEngine(false, this.cruiseSpeed, false);
    this.audio.crash();
    this.audio.gameOverJingle();
    const finalScore = Math.floor(this.distance);
    this.score = finalScore;
    const isNewHigh = finalScore > this.highScore;
    this.highScore = saveHighScore(finalScore);
    this.setState("gameover");
    this.callbacks.onGameOver({ score: finalScore, isNewHigh });
    this.emitHud();
  }

  private spawnWave(): void {
    const occupied = this.pickLanes();
    for (const lane of occupied) {
      const roll = Math.random();
      const kind: ObstacleKind = roll < 0.68 ? "car" : roll < 0.86 ? "cone" : "barrier";
      const obs = this.acquire(kind);
      obs.active = true;
      obs.scored = false;
      obs.extraSpeed = kind === "car" ? CONFIG.spawn.extraOncoming * (0.7 + Math.random() * 0.6) : 0;
      obs.mesh.visible = true;
      obs.mesh.position.set(laneX(lane), 0, CONFIG.spawn.farZ - Math.random() * 8);
    }
  }

  private pickLanes(): number[] {
    const lanes = [0, 1, 2];
    const free = lanes[Math.floor(Math.random() * lanes.length)];
    const blocked = lanes.filter((l) => l !== free);
    if (Math.random() < 0.45) return [blocked[Math.floor(Math.random() * blocked.length)]];
    return blocked;
  }

  private acquire(kind: ObstacleKind): Obstacle {
    const pooled = this.obstacles.find((o) => !o.active && o.kind === kind);
    if (pooled) return pooled;
    const made = this.makeObstacle(kind);
    this.obstacles.push(made);
    this.scene.add(made.mesh);
    return made;
  }

  private deactivate(obs: Obstacle): void {
    obs.active = false;
    obs.mesh.visible = false;
  }

  private resetPlayfields(): void {
    this.score = 0;
    this.distance = 0;
    this.cruiseSpeed = CONFIG.player.startSpeed;
    this.nitro = CONFIG.nitro.start;
    this.nitroLocked = false;
    this.boosting = false;
    this.wasBoosting = false;
    this.spawnAcc = 0.6;
    this.elapsed = 0;
    this.hudAcc = 0;
    this.lane = CONFIG.player.startLane;
    this.playerX = laneX(this.lane);
    this.player.position.set(this.playerX, 0, 0);
    this.player.rotation.z = 0;
    if (this.flame) this.flame.visible = false;
    for (const obs of this.obstacles) this.deactivate(obs);
  }

  private addLights(): void {
    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.15);
    sun.position.set(-12, 22, 10);
    this.scene.add(ambient, sun);
  }

  private buildEnvironment(): void {
    const total = CONFIG.road.segmentLength * CONFIG.road.segmentCount;
    const roadMat = new THREE.MeshLambertMaterial({ color: CONFIG.road.asphalt });
    const lineMat = new THREE.MeshLambertMaterial({ color: CONFIG.road.lineColor });
    const grassMat = new THREE.MeshLambertMaterial({ color: CONFIG.ground.color });
    const shoulderMat = new THREE.MeshLambertMaterial({ color: 0x4b5563 });

    for (let i = 0; i < CONFIG.road.segmentCount; i++) {
      const z = -i * CONFIG.road.segmentLength;
      const road = new THREE.Mesh(new THREE.PlaneGeometry(CONFIG.road.width, CONFIG.road.segmentLength), roadMat);
      road.rotation.x = -Math.PI / 2;
      road.position.set(0, 0.01, z);
      this.scene.add(road);
      this.roadItems.push({ mesh: road, span: total });

      for (const side of [-1, 1]) {
        const shoulder = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, CONFIG.road.segmentLength), shoulderMat);
        shoulder.position.set(side * (CONFIG.road.width / 2 + 0.1), 0.06, z);
        this.scene.add(shoulder);
        this.roadItems.push({ mesh: shoulder, span: total });
      }
    }

    const dashSpan = CONFIG.road.dashLength + CONFIG.road.dashGap;
    const dashCount = Math.ceil(total / dashSpan);
    for (const divider of [-CONFIG.lanes.width / 2, CONFIG.lanes.width / 2]) {
      for (let i = 0; i < dashCount; i++) {
        const dash = new THREE.Mesh(
          new THREE.BoxGeometry(CONFIG.road.dashWidth, 0.04, CONFIG.road.dashLength),
          lineMat,
        );
        dash.position.set(divider, 0.05, -i * dashSpan);
        this.scene.add(dash);
        this.roadItems.push({ mesh: dash, span: dashCount * dashSpan });
      }
    }

    for (const side of [-1, 1]) {
      const grass = new THREE.Mesh(
        new THREE.PlaneGeometry(CONFIG.ground.width, CONFIG.ground.length),
        grassMat,
      );
      grass.rotation.x = -Math.PI / 2;
      grass.position.set(side * (CONFIG.road.width / 2 + CONFIG.ground.width / 2 + 0.4), 0, -80);
      this.scene.add(grass);
    }

    const buildingColors = [0x64748b, 0x475569, 0x334155, 0x94a3b8];
    for (let i = 0; i < 18; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const h = 4 + Math.random() * 10;
      const w = 3 + Math.random() * 3;
      const d = 3 + Math.random() * 4;
      const building = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshLambertMaterial({ color: buildingColors[i % buildingColors.length] }),
      );
      building.position.set(side * (18 + Math.random() * 10), h / 2, -i * 18);
      this.scene.add(building);
      this.scenery.push({ mesh: building, span: 18 * 18 });
    }

    const treeGreen = new THREE.MeshLambertMaterial({ color: 0x166534 });
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7c4a1e });
    for (let i = 0; i < 24; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 1.2, 6), trunkMat);
      trunk.position.y = 0.6;
      const crown = new THREE.Mesh(new THREE.ConeGeometry(1.1, 2.4, 7), treeGreen);
      crown.position.y = 2.1;
      tree.add(trunk, crown);
      tree.position.set(side * (8.2 + (i % 5) * 0.35), 0, -i * 14);
      this.scene.add(tree);
      this.scenery.push({ mesh: tree, span: 24 * 14 });
    }
  }

  private buildPlayer(): void {
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0xe11d2e });
    const cabinMat = new THREE.MeshLambertMaterial({ color: 0x7dd3fc });
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x111827 });
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x1f2937 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 3.2), bodyMat);
    body.position.y = 0.58;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.46, 1.45), cabinMat);
    cabin.position.set(0, 1.05, -0.15);
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.28), darkMat);
    spoiler.position.set(0, 0.92, 1.4);

    this.player.add(body, cabin, spoiler);

    const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.28, 10);
    const offsets: [number, number, number][] = [
      [-0.85, 0.32, 1.05],
      [0.85, 0.32, 1.05],
      [-0.85, 0.32, -1.05],
      [0.85, 0.32, -1.05],
    ];
    for (const [x, y, z] of offsets) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, y, z);
      this.player.add(wheel);
      this.wheels.push(wheel);
    }

    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.28, 1.4, 8),
      new THREE.MeshStandardMaterial({
        color: 0xff6a00,
        emissive: 0xff6a00,
        emissiveIntensity: 1.4,
        transparent: true,
        opacity: 0.85,
      }),
    );
    flame.rotation.x = Math.PI / 2;
    flame.position.set(0, 0.45, 2.2);
    flame.visible = false;
    this.flame = flame;
    this.player.add(flame);
    this.scene.add(this.player);
  }

  private makeObstacle(kind: ObstacleKind): Obstacle {
    const mesh = new THREE.Group();
    if (kind === "car") {
      const color = CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(1.55, 0.48, 3.05),
        new THREE.MeshLambertMaterial({ color }),
      );
      body.position.y = 0.56;
      const cabin = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.4, 1.3),
        new THREE.MeshLambertMaterial({ color: 0xcbd5e1 }),
      );
      cabin.position.set(0, 0.98, -0.2);
      mesh.add(body, cabin);
      mesh.visible = false;
      return { mesh, kind, active: false, hw: 0.82, hl: 1.6, extraSpeed: 0, scored: false };
    }
    if (kind === "cone") {
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(0.38, 1.1, 8),
        new THREE.MeshLambertMaterial({ color: 0xf97316 }),
      );
      cone.position.y = 0.55;
      const base = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 0.08, 0.7),
        new THREE.MeshLambertMaterial({ color: 0x111827 }),
      );
      base.position.y = 0.04;
      mesh.add(cone, base);
      mesh.visible = false;
      return { mesh, kind, active: false, hw: 0.4, hl: 0.4, extraSpeed: 0, scored: false };
    }
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 0.9, 0.55),
      new THREE.MeshLambertMaterial({ color: 0xfacc15 }),
    );
    bar.position.y = 0.45;
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(1.82, 0.18, 0.56),
      new THREE.MeshLambertMaterial({ color: 0x111827 }),
    );
    stripe.position.y = 0.55;
    mesh.add(bar, stripe);
    mesh.visible = false;
    return { mesh, kind: "barrier", active: false, hw: 0.95, hl: 0.4, extraSpeed: 0, scored: false };
  }

  private placeCamera(instant: boolean, dt = 0.016): void {
    const follow = instant
      ? this.player.position.x
      : THREE.MathUtils.damp(this.camX, this.player.position.x, CONFIG.camera.followLerp, dt);
    this.camX = follow;
    this.camera.position.set(this.camX, CONFIG.camera.height, CONFIG.camera.distance);
    this.camera.lookAt(this.camX, 1.1, -CONFIG.camera.lookAhead);

    const targetFov = this.boosting ? CONFIG.camera.nitroFov : CONFIG.camera.fov;
    this.currentFov = instant
      ? targetFov
      : THREE.MathUtils.damp(this.currentFov, targetFov, CONFIG.camera.fovLerp, dt);
    if (Math.abs(this.camera.fov - this.currentFov) > 0.05) {
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
    }
  }

  private setState(state: GameState): void {
    this.state = state;
    this.callbacks.onStateChange(state);
  }

  private emitHud(): void {
    const worldSpeed = this.cruiseSpeed * (this.boosting ? CONFIG.nitro.multiplier : 1);
    this.callbacks.onHud({
      score: Math.floor(this.score),
      speed: Math.round(worldSpeed * 3.6),
      nitro: Math.round(this.nitro),
      highScore: this.highScore,
      boosting: this.boosting,
      muted: this.audio.isMuted,
    });
  }

  private aspect(): number {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    return w / Math.max(1, h);
  }

  private bindEvents(): void {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("resize", this.onResize);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const key = e.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)) {
      e.preventDefault();
    }
    if (e.repeat && (key === "enter" || key === "r" || key === "p" || key === "m")) return;

    if (key === "enter") {
      this.audio.ensure();
      this.start();
      return;
    }
    if (key === "r") {
      this.audio.ensure();
      this.restart();
      return;
    }
    if (key === "p") {
      this.pause();
      return;
    }
    if (key === "m") {
      this.toggleMute();
      return;
    }
    if (!e.repeat && (key === "arrowleft" || key === "a")) {
      this.nudgeLane(-1);
    }
    if (!e.repeat && (key === "arrowright" || key === "d")) {
      this.nudgeLane(1);
    }
    this.keys.add(key);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key.toLowerCase());
  };

  private onResize = (): void => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.renderer.maxPixelRatio));
    this.renderer.setSize(w, h);
  };
}
