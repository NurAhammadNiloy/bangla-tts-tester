"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { STARTER_LIBRARY } from "@/lib/puppet/library";
import { SAMPLE_EPISODE } from "@/lib/puppet/sample";
import { createShotDrawer, speakerAnchor } from "@/lib/puppet/engine";
import { drawCharacter } from "@/lib/puppet/rig";
import { poseAt } from "@/lib/puppet/actions";
import { drawShapes } from "@/lib/puppet/draw";
import { skyColor } from "@/lib/puppet/atmosphere";
import { ACTIONS } from "@/lib/puppet/actions";
import type { Action, CharacterAsset, EpisodePlan, Face, PlaceAsset, PropAsset } from "@/lib/puppet/types";

const SHOT_SECONDS = 2.5;
const FACES: Face[] = ["neutral", "happy", "sad", "crying", "angry", "shocked", "scared", "worried"];

function fakeTalk(t: number) {
  return Math.max(0, Math.sin(t * 17) * 0.5 + Math.sin(t * 7.3) * 0.35 + 0.15);
}

function CharacterCard({ asset, face, t }: { asset: CharacterAsset; face: Face; t: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#efe7d6";
    ctx.fillRect(0, 0, c.width, c.height);
    const pose = poseAt("talk", t, 10, fakeTalk(t) * 0.7, asset.id.length, { face });
    drawCharacter(ctx, asset, pose, { x: c.width / 2, y: c.height - 8, scale: (c.height - 16) / asset.size[1] });
  }, [asset, face, t]);
  return (
    <figure className="flex flex-col items-center gap-1">
      <canvas ref={ref} width={160} height={300} className="rounded border border-black/10" />
      <figcaption className="text-center text-xs">{asset.id}</figcaption>
    </figure>
  );
}

function PlaceCard({ asset }: { asset: PlaceAsset }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const s = c.width / asset.size[0];
    ctx.setTransform(s, 0, 0, s, 0, 0);
    const sky = skyColor("day");
    const map = (x: string) => (x === "$sky" ? sky : x);
    drawShapes(ctx, asset.layers.back, map);
    drawShapes(ctx, asset.layers.mid, map);
    drawShapes(ctx, asset.layers.front, map);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = "rgba(255,0,0,0.5)";
    ctx.beginPath();
    ctx.moveTo(0, asset.floorY * s);
    ctx.lineTo(c.width, asset.floorY * s);
    ctx.stroke();
  }, [asset]);
  return (
    <figure className="flex flex-col items-center gap-1">
      <canvas ref={ref} width={243} height={288} className="rounded border border-black/10" />
      <figcaption className="text-xs">{asset.id}</figcaption>
    </figure>
  );
}

function PropCard({ asset }: { asset: PropAsset }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#efe7d6";
    ctx.fillRect(0, 0, c.width, c.height);
    const s = Math.min((c.width - 16) / asset.size[0], (c.height - 16) / asset.size[1], 2.2);
    ctx.setTransform(s, 0, 0, s, (c.width - asset.size[0] * s) / 2, (c.height - asset.size[1] * s) / 2);
    drawShapes(ctx, asset.shapes);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#c62f2f";
    ctx.beginPath();
    ctx.arc((c.width - asset.size[0] * s) / 2 + asset.anchor[0] * s, (c.height - asset.size[1] * s) / 2 + asset.anchor[1] * s, 3, 0, Math.PI * 2);
    ctx.fill();
  }, [asset]);
  return (
    <figure className="flex flex-col items-center gap-1">
      <canvas ref={ref} width={120} height={120} className="rounded border border-black/10" />
      <figcaption className="text-xs">{asset.id}</figcaption>
    </figure>
  );
}

function actionPlan(action: Action): EpisodePlan {
  const two = action === "hug";
  const needsChair = action === "sit" || action === "stand";
  return {
    version: 2,
    series: "",
    episode: 1,
    title: action,
    caption: "",
    mood: "drama",
    format: "9:16",
    cast: [
      { id: "a", name: "A", asset: "young_woman", look: "", voice: "female" },
      { id: "b", name: "B", asset: "old_man", look: "", voice: "male_old" },
    ],
    places: [{ id: "p", asset: action === "lie_down" ? "hospital_room" : "countryside", look: "", time: "day" }],
    shots: [
      {
        line: "",
        speaker: "a",
        place: "p",
        actors: two
          ? [
              { id: "a", x: 0.25, action: "hug", face: "crying" },
              { id: "b", x: 0.75, action: "hug", face: "sad" },
            ]
          : [{ id: "a", x: action === "walk_out" || action === "run" ? 0.3 : action === "lie_down" ? 0.75 : 0.5, action, face: "neutral", prop: action === "phone_ear" ? "smartphone" : undefined }],
        props: needsChair ? [{ id: "chair", x: 0.5 }] : action === "lie_down" ? [{ id: "bed", x: 0.6 }] : undefined,
        camera: { shot: "wide", move: "hold" },
      },
    ],
    end: { type: "the_end", text: "" },
  };
}

function ActionCard({ action, t }: { action: Action; t: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const draw = useMemo(() => createShotDrawer(actionPlan(action), 0, STARTER_LIBRARY, { vignette: false }), [action]);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    draw(ctx, c.width, c.height, { t, dur: 3, talk: action === "talk" ? fakeTalk(t) : 0 });
  }, [draw, t, action]);
  return (
    <figure className="flex flex-col items-center gap-1">
      <canvas ref={ref} width={216} height={384} className="rounded border border-black/10" />
      <figcaption className="text-xs">{action}</figcaption>
    </figure>
  );
}

function Player({ initialShot, initialTime, startPaused }: { initialShot: number; initialTime: number; startPaused: boolean }) {
  const plan = SAMPLE_EPISODE;
  const n = plan.shots.length;
  const ref = useRef<HTMLCanvasElement>(null);
  const [shot, setShot] = useState(Math.max(0, Math.min(n - 1, initialShot)));
  const [playing, setPlaying] = useState(!startPaused);
  const [time, setTime] = useState(Math.max(0, initialTime));
  const [anchors, setAnchors] = useState(false);
  const drawers = useMemo(() => plan.shots.map((_, i) => createShotDrawer(plan, i, STARTER_LIBRARY)), [plan]);

  // animation clock
  const clock = useRef({ shot, time });
  useEffect(() => {
    clock.current = { shot, time };
  }, [shot, time]);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      let { shot: sh, time: tm } = clock.current;
      tm += dt;
      if (tm >= SHOT_SECONDS) {
        tm = 0;
        sh = (sh + 1) % n;
      }
      clock.current = { shot: sh, time: tm };
      setShot(sh);
      setTime(tm);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, n]);

  // paint
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const f = { t: time, dur: SHOT_SECONDS, talk: fakeTalk(time) };
    drawers[shot](ctx, c.width, c.height, f);
    if (anchors) {
      const a = speakerAnchor(plan, shot, STARTER_LIBRARY, c.width, c.height, f);
      if (a) {
        ctx.fillStyle = "#ff2d55";
        ctx.beginPath();
        ctx.arc(a.x, a.y, 14, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    c.dataset.frame = `${shot}:${time.toFixed(2)}`;
  }, [drawers, shot, time, anchors, plan]);

  const s = plan.shots[shot];
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Sample episode: {plan.title}</h2>
      <div className="flex flex-wrap gap-4">
        <canvas id="puppet-player" ref={ref} width={1080} height={1920} style={{ width: 360, height: 640 }} className="rounded-lg border border-black/20 bg-black" />
        <div className="flex max-w-md flex-col gap-2 text-sm">
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded bg-black px-3 py-1 text-white" onClick={() => setPlaying((p) => !p)}>
              {playing ? "Pause" : "Play"}
            </button>
            <select
              aria-label="Shot"
              className="rounded border px-2 py-1"
              value={shot}
              onChange={(e) => {
                setShot(Number(e.target.value));
                setTime(0);
              }}
            >
              {plan.shots.map((x, i) => (
                <option key={i} value={i}>
                  Shot {i + 1}: {x.camera.shot} / {x.camera.move}
                  {x.screen ? ` · ${x.screen.type}` : ""}
                  {x.layout === "split" ? " · split" : ""}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={anchors} onChange={(e) => setAnchors(e.target.checked)} /> speaker anchor
            </label>
          </div>
          <input aria-label="Time" type="range" min={0} max={SHOT_SECONDS} step={0.01} value={time} onChange={(e) => setTime(Number(e.target.value))} />
          <p>
            t = {time.toFixed(2)} s · speaker: <b>{s.speaker}</b>
          </p>
          <p className="text-base">{s.line}</p>
          <p className="text-xs text-black/60">Subtitles and speech bubbles are drawn by the video renderer, not the puppet engine.</p>
        </div>
      </div>
    </section>
  );
}

export default function PuppetPreview({
  initialShot = 0,
  initialTime = 0,
  startPaused = false,
  only,
}: {
  initialShot?: number;
  initialTime?: number;
  startPaused?: boolean;
  only?: "player" | "assets";
}) {
  const [face, setFace] = useState<Face>("neutral");
  const [t, setT] = useState(initialTime || 0.4);
  const lib = STARTER_LIBRARY;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 p-6">
      <h1 className="text-2xl font-bold">Puppet engine preview</h1>
      {only !== "assets" && <Player initialShot={initialShot} initialTime={initialTime} startPaused={startPaused} />}
      {only !== "player" && (
        <>
          <section className="flex flex-col gap-3" id="characters">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-semibold">Characters ({Object.keys(lib.characters).length})</h2>
              <select aria-label="Face" className="rounded border px-2 py-1 text-sm" value={face} onChange={(e) => setFace(e.target.value as Face)}>
                {FACES.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
              <input aria-label="Pose time" type="range" min={0} max={6} step={0.05} value={t} onChange={(e) => setT(Number(e.target.value))} />
            </div>
            <div className="flex flex-wrap gap-3">
              {Object.values(lib.characters).map((a) => (
                <CharacterCard key={a.id} asset={a} face={face} t={t} />
              ))}
            </div>
          </section>
          <section className="flex flex-col gap-3" id="actions">
            <h2 className="text-lg font-semibold">Actions ({ACTIONS.length}) — time follows the slider above (3 s shot)</h2>
            <div className="flex flex-wrap gap-3">
              {ACTIONS.map((a) => (
                <ActionCard key={a} action={a} t={Math.min(3, t)} />
              ))}
            </div>
          </section>
          <section className="flex flex-col gap-3" id="places">
            <h2 className="text-lg font-semibold">Places ({Object.keys(lib.places).length}) — red line = floorY</h2>
            <div className="flex flex-wrap gap-3">
              {Object.values(lib.places).map((a) => (
                <PlaceCard key={a.id} asset={a} />
              ))}
            </div>
          </section>
          <section className="flex flex-col gap-3" id="props">
            <h2 className="text-lg font-semibold">Props ({Object.keys(lib.props).length}) — red dot = anchor</h2>
            <div className="flex flex-wrap gap-3">
              {Object.values(lib.props).map((a) => (
                <PropCard key={a.id} asset={a} />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
