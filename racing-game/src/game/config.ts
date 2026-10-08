export const CONFIG = {
  storageKey: "racingHighScore",

  renderer: {
    maxPixelRatio: 2,
    clearColor: 0x87ceeb,
  },

  fog: {
    color: 0x87ceeb,
    near: 40,
    far: 210,
  },

  camera: {
    fov: 60,
    nitroFov: 78,
    fovLerp: 8,
    near: 0.1,
    far: 280,
    height: 5.6,
    distance: 11.5,
    lookAhead: 10,
    followLerp: 7,
  },

  road: {
    width: 11.4,
    segmentLength: 24,
    segmentCount: 14,
    wrapZ: 16,
    asphalt: 0x2a2d33,
    lineColor: 0xf4f4f4,
    dashLength: 3.2,
    dashGap: 4.2,
    dashWidth: 0.12,
  },

  lanes: {
    count: 3,
    width: 3.6,
  },

  ground: {
    color: 0x3d8c40,
    width: 80,
    length: 340,
  },

  player: {
    startLane: 1,
    steerLerp: 10,
    rollAmount: 0.22,
    rollLerp: 12,
    accel: 18,
    brake: 26,
    minSpeed: 16,
    startSpeed: 22,
    maxSpeed: 46,
    halfWidth: 0.85,
    halfLength: 1.7,
  },

  nitro: {
    max: 100,
    start: 100,
    drainPerSec: 25,
    rechargePerSec: 8,
    multiplier: 1.8,
    lockUntil: 20,
    nearMissFill: 6,
  },

  spawn: {
    farZ: -175,
    recycleZ: 14,
    intervalStart: 1.35,
    intervalMin: 0.42,
    extraOncoming: 8,
  },

  difficulty: {
    speedRampPerSec: 0.85,
    spawnRampPerSec: 0.012,
  },

  score: {
    distancePerUnit: 1,
    nearMissPoints: 40,
    nearMissMaxDx: 2.9,
  },

  hud: {
    fps: 10,
  },

  audio: {
    masterGain: 0.32,
  },
};

export function laneX(lane: number): number {
  const mid = (CONFIG.lanes.count - 1) / 2;
  return (lane - mid) * CONFIG.lanes.width;
}
