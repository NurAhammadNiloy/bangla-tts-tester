/** A tiny recording fake of CanvasRenderingContext2D + Path2D for Node tests. */
type M = [number, number, number, number, number, number];
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

export class FakePath2D {
  d: string;
  constructor(d?: string | FakePath2D) {
    this.d = typeof d === "string" ? d : d?.d ?? "";
  }
  addPath() {}
  moveTo() {}
  lineTo() {}
  closePath() {}
}

export interface Call {
  name: string;
  args: unknown[];
}

export function makeFakeCtx() {
  const calls: Call[] = [];
  const nanCalls: Call[] = [];
  let m: M = [1, 0, 0, 1, 0, 0];
  const stack: { m: M; alpha: number }[] = [];
  const state: Record<string, unknown> = {
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    fillStyle: "#000",
    strokeStyle: "#000",
    lineWidth: 1,
    font: "10px sans-serif",
    textAlign: "start",
    textBaseline: "alphabetic",
    lineCap: "butt",
    lineJoin: "miter",
  };
  const rec = (name: string, args: unknown[]) => {
    const c = { name, args };
    calls.push(c);
    if (args.some((a) => typeof a === "number" && !Number.isFinite(a))) nanCalls.push(c);
  };
  const api: Record<string, unknown> = {
    setTransform: (...a: number[]) => {
      rec("setTransform", a);
      m = [a[0], a[1], a[2], a[3], a[4], a[5]];
    },
    resetTransform: () => (m = [1, 0, 0, 1, 0, 0]),
    getTransform: () => ({ a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5] }),
    transform: (...a: number[]) => {
      rec("transform", a);
      m = mul(m, a as M);
    },
    translate: (x: number, y: number) => {
      rec("translate", [x, y]);
      m = mul(m, [1, 0, 0, 1, x, y]);
    },
    rotate: (r: number) => {
      rec("rotate", [r]);
      m = mul(m, [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]);
    },
    scale: (x: number, y: number) => {
      rec("scale", [x, y]);
      m = mul(m, [x, 0, 0, y, 0, 0]);
    },
    save: () => {
      rec("save", []);
      stack.push({ m: [...m] as M, alpha: state.globalAlpha as number });
    },
    restore: () => {
      rec("restore", []);
      const s = stack.pop();
      if (s) {
        m = s.m;
        state.globalAlpha = s.alpha;
      }
    },
    measureText: (s: string) => {
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(String(state.font))?.[1] ?? 10);
      return { width: [...String(s)].length * size * 0.55 };
    },
    createRadialGradient: (...a: number[]) => (rec("createRadialGradient", a), { addColorStop: () => {} }),
    createLinearGradient: (...a: number[]) => (rec("createLinearGradient", a), { addColorStop: () => {} }),
    setLineDash: () => {},
    getLineDash: () => [],
  };
  const ctx = new Proxy(state, {
    get(target, prop: string) {
      if (prop in api) return api[prop];
      if (prop in target) return target[prop];
      return (...args: unknown[]) => rec(prop, args);
    },
    set(target, prop: string, value) {
      target[prop] = value;
      if (typeof value === "number" && !Number.isFinite(value)) nanCalls.push({ name: `set ${prop}`, args: [value] });
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls, nanCalls, depth: () => stack.length };
}
