"use client";

import dynamic from "next/dynamic";

const Game = dynamic(() => import("./Game"), {
  ssr: false,
  loading: () => (
    <div className="game-root">
      <div className="overlay">
        <div className="panel">
          <h1>3D RACER</h1>
          <p className="lead">Loading track…</p>
        </div>
      </div>
    </div>
  ),
});

export default function GameLoader() {
  return <Game />;
}
