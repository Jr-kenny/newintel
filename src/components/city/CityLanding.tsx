import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import "./city.css";

type Building = {
  ticker: string;
  blurb: string;
  thesis: string;
  x: number;
  y: number;
  w: number;
  d: number;
  h: number;
  c: string;
  cols: number;
  rows: number;
  venue?: boolean;
};

const BUILDINGS: Building[] = [
  { ticker: "MARLOWE", blurb: "Marlowe Bay Hotels · rooms and fit-out", thesis: "Permit filings plus contractor talk signal fit-out demand months before any order.", x: 20, y: 20, w: 90, d: 90, h: 220, c: "#a9b7c9", cols: 5, rows: 9 },
  { ticker: "ILONA", blurb: "Ilona Hospitality · restaurants and leases", thesis: "New leases plus an appointed contractor point to near-term fit-out need.", x: 125, y: 30, w: 75, d: 70, h: 110, c: "#e9c1a0", cols: 4, rows: 5 },
  { ticker: "CORVINE", blurb: "Corvine Living · serviced apartments", thesis: "Unit counts are disputed, so the dossier holds timing open until sources agree.", x: 30, y: 130, w: 80, d: 70, h: 80, c: "#b9d4c2", cols: 4, rows: 4 },
  { ticker: "TAMPA+", blurb: "Tampa hospital network · 120-bed wing", thesis: "An approved wing pulls displays, networking and backup power within one quarter.", x: 320, y: 20, w: 70, d: 120, h: 170, c: "#c9bfe0", cols: 4, rows: 7 },
  { ticker: "NAIROBI", blurb: "Nairobi retail chain · 8 new branches", thesis: "Branch announcements confirmed across sources signal refrigeration and POS need.", x: 410, y: 30, w: 90, d: 80, h: 130, c: "#9fb8d8", cols: 5, rows: 6 },
  { ticker: "GRID", blurb: "Agent grid · investigations run day and night", thesis: "Independent specialists investigate every question, so coverage never sleeps.", x: 330, y: 160, w: 170, d: 50, h: 40, c: "#e6a49a", cols: 8, rows: 2, venue: true },
  { ticker: "MANCHR", blurb: "Manchester fulfilment · two warehouses", thesis: "Leased space plus hiring signals shelving and scanner demand, timing unresolved.", x: 20, y: 320, w: 120, d: 80, h: 90, c: "#e8dcc4", cols: 6, rows: 4 },
  { ticker: "KANO", blurb: "Kano food processors · capacity moves", thesis: "Cold-chain and packaging demand follows processing expansions with a lag.", x: 30, y: 420, w: 80, d: 90, h: 150, c: "#dcb3b8", cols: 4, rows: 7 },
  { ticker: "ACCRA", blurb: "Accra clinics · new equipment lines", thesis: "Every new ward needs power and networking before it opens its doors.", x: 150, y: 330, w: 60, d: 60, h: 60, c: "#c3ccb0", cols: 3, rows: 3 },
  { ticker: "LAGOS", blurb: "Lagos developers · towers and estates", thesis: "Large builds land here first. Permits and guides move the whole block.", x: 330, y: 330, w: 80, d: 80, h: 260, c: "#a8cfd0", cols: 4, rows: 11 },
  { ticker: "ABUJA", blurb: "Abuja distributors · pharma and food", thesis: "Distribution contracts confirm demand is real and timed.", x: 430, y: 340, w: 80, d: 60, h: 45, c: "#ecd9a1", cols: 4, rows: 2 },
  { ticker: "DELTA", blurb: "Delta manufacturers · plants and lines", thesis: "Plant mix shifts exposure at the margin across suppliers.", x: 340, y: 430, w: 160, d: 80, h: 100, c: "#cfc5d6", cols: 8, rows: 5 },
];

const TREES: [number, number][] = [
  [150, 150], [180, 120], [340, 100], [60, 470],
  [470, 150], [490, 470], [230, 400], [200, 470],
];

const STRIP: [string, string][] = [
  ["MARLOWE", "82% confidence"],
  ["TAMPA+", "81% confidence"],
  ["NAIROBI", "77% confidence"],
  ["ILONA", "64% confidence"],
  ["MANCHR", "timing open"],
  ["LAGOS", "window open"],
  ["KANO", "tracking"],
  ["ABUJA", "64% confidence"],
];

function useTape() {
  const [items, setItems] = useState<[string, string, number][]>(
    STRIP.map(([s, p]) => [s, p, 1]),
  );
  return { items, live: false };
}

function Windows({ cols, rows, seed }: { cols: number; rows: number; seed: number }) {
  const cells = [];
  for (let i = 0; i < rows * cols; i++) {
    // Deterministic so server and client render the same lattice.
    const lit = (seed * 7 + i * 13) % 20 < 11;
    const tone = (seed + i) % 7 === 0 ? " cool" : (seed + i) % 4 === 0 ? " warm" : "";
    cells.push(<i key={i} className={`win${lit ? " on" : ""}${tone}`} aria-hidden />);
  }
  return <div className="wins" style={{ ["--cols" as string]: cols }}>{cells}</div>;
}

function useDayNight(paused: boolean) {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || paused) return;
    let raf = 0;
    // Start at midday so the city opens in full daylight, then drifts slowly.
    const DAY_MS = 240_000;
    const start = performance.now() - 0.45 * DAY_MS;
    const tick = (now: number) => {
      const t = ((now - start) % DAY_MS) / DAY_MS;
      const night = t < 0.2 || t > 0.83 ? 0.9 : t < 0.32 || t > 0.7 ? 0.35 : 0;
      rootRef.current?.style.setProperty("--night", night.toFixed(2));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paused]);
  return rootRef;
}

function useFitScale() {
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.92);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const fit = () => {
      const s = Math.min(1.0, el.clientWidth / 620);
      setScale(Math.max(0.45, s));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { stageRef, scale };
}

export function CityLanding() {
  const [active, setActive] = useState<Building | null>(null);
  const [paused, setPaused] = useState(false);
  const { items } = useTape();
  const skyRef = useDayNight(paused);
  const { stageRef, scale } = useFitScale();
  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (reduceMotion) setPaused(true);
  }, [reduceMotion]);

  const tape = [...items, ...items];

  return (
    <div ref={skyRef} className="city" style={{ ["--night" as string]: 0 }}>
      <div className="city-stars" aria-hidden />
      <div className="city-sky-orb city-sun" aria-hidden />
      <div className="city-sky-orb city-moon" aria-hidden />

      <section className="city-hero" aria-label="Newintel demand city">
        <div className="city-copy">
          <p className="label-mono city-eyebrow">Event-driven demand intelligence</p>
          <h1>Find the demand before it becomes the order.</h1>
          <p className="city-lede">
            Describe what you sell. Newintel investigates the companies drifting toward a
            purchase like yours, expansions, permits, filings, capacity moves, then states
            the verdict and the window, with evidence behind every call.
          </p>
          <div className="city-cta">
            <Link to="/app" className="city-btn city-btn-solid">Ask your first question</Link>
            <Link to="/how-it-works" className="city-btn">How the loop works</Link>
            <Link to="/developers" className="city-btn">Developers</Link>
          </div>
          <ul className="city-stats">
            <li>Evidence per match</li>
            <li>Dossier first, verdict last</li>
            <li>Investigations on demand</li>
          </ul>
          {active && (
            <div className="city-thesis" aria-live="polite">
              <p className="label-mono">{active.ticker} · dossier</p>
              <p><strong>{active.blurb}.</strong> {active.thesis}</p>
              <Link to="/app" className="city-thesis-link">{active.venue ? "Enter the app" : `Investigate ${active.ticker} in the app`}</Link>
            </div>
          )}
        </div>

        <div ref={stageRef} className="city-stage" role="img" aria-label="Isometric demand city, buildings are companies under investigation">
          <div className="city-scene" style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
            <div className="city-ground">
              {TREES.map(([x, y], i) => (
                <i key={i} className="city-tree" style={{ left: x, top: y }} aria-hidden />
              ))}
              {BUILDINGS.map((b, i) => (
                <div
                  key={b.ticker}
                  className="city-slot"
                  style={{ ["--x" as string]: `${b.x}px`, ["--y" as string]: `${b.y}px`, ["--w" as string]: `${b.w}px`, ["--d" as string]: `${b.d}px`, ["--h" as string]: `${b.h}px`, ["--c" as string]: b.c } as React.CSSProperties}
                >
                  <div className="city-shadow" aria-hidden />
                  <button
                    type="button"
                    className="city-b"
                    aria-label={`${b.ticker}, ${b.blurb}. ${b.thesis}`}
                    onMouseEnter={() => setActive(b)}
                    onFocus={() => setActive(b)}
                    onMouseLeave={() => setActive((cur) => (cur?.ticker === b.ticker ? null : cur))}
                    onClick={() => setActive(b)}
                  >
                    <span className="city-face city-south"><Windows cols={b.cols} rows={b.rows} seed={i + 1} /><i className="city-door" aria-hidden /></span>
                    <span className="city-face city-east"><Windows cols={Math.max(2, Math.round(b.cols * 0.8))} rows={b.rows} seed={i + 11} /></span>
                    <span className="city-face city-top">
                      <span className="city-tag"><b>{b.ticker}</b>{b.blurb}</span>
                    </span>
                  </button>
                  {b.venue && <div className="city-neon" aria-hidden>Agent Grid</div>}
                </div>
              ))}
              <i className="city-car city-car-x1" style={{ ["--cc" as string]: "#ff8a65" }} aria-hidden />
              <i className="city-car city-car-x2" style={{ ["--cc" as string]: "#5ec4b6" }} aria-hidden />
              <i className="city-car city-car-y1" style={{ ["--cc" as string]: "#f6d365" }} aria-hidden />
              <i className="city-car city-car-y2" style={{ ["--cc" as string]: "#8fa7ff" }} aria-hidden />
            </div>
          </div>
        </div>
      </section>

      <section className="city-loop" aria-label="How Newintel thinks">
        <div className="city-loop-inner">
          <p className="label-mono">The loop</p>
          <h2>Question, evidence, chains, verdict, window.</h2>
          <ol>
            <li><strong>Target.</strong> You ask a demand question. Say hotel fit-out in Lagos.</li>
            <li><strong>Fan out.</strong> Independent specialists investigate everything around it, not the question itself.</li>
            <li><strong>Chains.</strong> One expansion fans into fit-out, equipment, power and staffing.</li>
            <li><strong>Dossier.</strong> Each thread carries its evidence, freshness, and what would invalidate it.</li>
            <li><strong>Window.</strong> Only then, demand windows say whether the need is open, committed, or unclear.</li>
          </ol>
          <div className="city-cta">
            <Link to="/app" className="city-btn city-btn-solid">Enter the app</Link>
          </div>
        </div>
      </section>

      <div className="city-tape" aria-hidden>
        <div className="city-tape-track">
          {tape.map(([s, p, d], i) => (
            <span key={`${s}-${i}`}><b>{s}</b> <i className={d > 0 ? "up" : "down"}>{p}</i></span>
          ))}
          <span className="city-tape-note">illustrative · investigations run day and night</span>
        </div>
      </div>
    </div>
  );
}
