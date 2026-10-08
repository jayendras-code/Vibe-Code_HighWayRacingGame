"use client";

import { useEffect, useRef, useState } from "react";
import {
  GameEngine,
  type GameOverPayload,
  type GameState,
  type HudPayload,
} from "@/game/engine";
import { getHighScore } from "@/game/storage";

const emptyHud: HudPayload = {
  score: 0,
  speed: 0,
  nitro: 100,
  highScore: 0,
  boosting: false,
  muted: false,
};

export default function Game() {
  const mountRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [hud, setHud] = useState<HudPayload>(emptyHud);
  const [state, setState] = useState<GameState>("start");
  const [gameOver, setGameOver] = useState<GameOverPayload | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const engine = new GameEngine(mount, {
      onHud: (next) => setHud(next),
      onStateChange: (next) => {
        setState(next);
        if (next !== "gameover") setGameOver(null);
      },
      onGameOver: (payload) => setGameOver(payload),
    });
    engineRef.current = engine;
    setHud((prev) => ({ ...prev, highScore: getHighScore() }));

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const showStart = state === "start";
  const showPause = state === "paused";
  const showOver = state === "gameover";

  return (
    <div className="game-root">
      <div ref={mountRef} className="game-mount" />

      <div className="hud">
        <div className="hud-stat">
          <span className="hud-label">Score</span>
          <span className="hud-value">{hud.score}</span>
        </div>
        <div className="hud-stat">
          <span className="hud-label">High</span>
          <span className="hud-value">{hud.highScore}</span>
        </div>
        <div className="hud-stat">
          <span className="hud-label">Speed</span>
          <span className="hud-value">{hud.speed} km/h</span>
        </div>
        <div className="nitro-wrap">
          <span className="hud-label">Nitro {hud.muted ? "· MUTED" : ""}</span>
          <div className="nitro-track">
            <div
              className={`nitro-fill${hud.boosting ? " boosting" : ""}`}
              style={{ width: `${hud.nitro}%` }}
            />
          </div>
        </div>
      </div>

      {showStart && (
        <div className="overlay" onClick={() => engineRef.current?.start()}>
          <div className="panel">
            <p className="eyebrow">Endless Highway</p>
            <h1>3D RACER</h1>
            <p className="lead">Press ENTER to start</p>
            <p className="high">High score: {hud.highScore}</p>
            <ul className="controls">
              <li>A / D or ← / → — change lanes</li>
              <li>W / ↑ accelerate · S / ↓ brake</li>
              <li>SHIFT or SPACE — nitro</li>
              <li>P pause · R restart · M mute</li>
            </ul>
          </div>
        </div>
      )}

      {showPause && (
        <div className="overlay">
          <div className="panel">
            <h1>PAUSED</h1>
            <p className="lead">Press P to resume</p>
          </div>
        </div>
      )}

      {showOver && (
        <div
          className="overlay"
          onClick={() => engineRef.current?.restart()}
        >
          <div className="panel">
            <h1>GAME OVER</h1>
            <p className="lead">Score: {gameOver?.score ?? hud.score}</p>
            <p className="high">High score: {hud.highScore}</p>
            {gameOver?.isNewHigh && <p className="new-high">NEW HIGH SCORE!</p>}
            <p className="lead">Press R to restart</p>
          </div>
        </div>
      )}

      <div className="touch-bar">
        <button
          type="button"
          className="touch-btn"
          onPointerDown={() => engineRef.current?.nudgeLane(-1)}
        >
          LEFT
        </button>
        <button
          type="button"
          className="touch-btn nitro"
          onPointerDown={() => engineRef.current?.setPointerNitro(true)}
          onPointerUp={() => engineRef.current?.setPointerNitro(false)}
          onPointerLeave={() => engineRef.current?.setPointerNitro(false)}
          onPointerCancel={() => engineRef.current?.setPointerNitro(false)}
        >
          NITRO
        </button>
        <button
          type="button"
          className="touch-btn"
          onPointerDown={() => engineRef.current?.nudgeLane(1)}
        >
          RIGHT
        </button>
      </div>
    </div>
  );
}
