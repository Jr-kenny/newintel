import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";

export const Route = createFileRoute("/product")({
  head: () => ({
    meta: [
      { title: "Product · run flow" },
      {
        name: "description",
        content:
          "Business → orchestrator → private specialist grid → returns to orchestrator and Intelligent Contract → customer dossier → escrow → USDC to grid wallets.",
      },
    ],
  }),
  component: Product,
});

const W = 1280;
const H = 880;

const N = {
  biz: { x: 40, y: 56, w: 230, h: 130 },
  orch: { x: 340, y: 48, w: 260, h: 160 },
  user: { x: 960, y: 48, w: 240, h: 130 },
  grid: { x: 300, y: 300, w: 300, h: 230 },
  ic: { x: 680, y: 280, w: 300, h: 260 },
  escrow: { x: 680, y: 620, w: 300, h: 130 },
  wallets: { x: 300, y: 640, w: 300, h: 120 },
};

type NodeBox = { x: number; y: number; w: number; h: number };

const midRight = (n: NodeBox) => [n.x + n.w, n.y + n.h / 2] as const;
const midLeft = (n: NodeBox) => [n.x, n.y + n.h / 2] as const;
const midBottom = (n: NodeBox) => [n.x + n.w / 2, n.y + n.h] as const;
const midTop = (n: NodeBox) => [n.x + n.w / 2, n.y] as const;

function cpath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  bowX = 0,
  bowY = 0,
) {
  return `M ${x1} ${y1} C ${x1 + bowX} ${y1 + bowY}, ${x2 + bowX} ${y2 + bowY}, ${x2} ${y2}`;
}

const EDGES: {
  id: string;
  d: string;
  label: string;
  lx: number;
  ly: number;
  hot?: boolean;
  ret?: boolean;
}[] = [
  {
    id: "biz-orch",
    d: (() => {
      const [x1, y1] = midRight(N.biz);
      const [x2, y2] = midLeft(N.orch);
      return cpath(x1, y1, x2, y2, 24, 0);
    })(),
    label: "inquiry",
    lx: 300,
    ly: 90,
  },
  {
    id: "orch-biz",
    d: (() => {
      const [x1, y1] = [N.orch.x + 8, N.orch.y + N.orch.h * 0.78];
      const [x2, y2] = [N.biz.x + N.biz.w * 0.5, N.biz.y + N.biz.h + 2];
      return cpath(x1, y1, x2, y2, -70, 90);
    })(),
    label: "returns to business",
    lx: 240,
    ly: 230,
    ret: true,
  },
  {
    id: "orch-grid",
    d: (() => {
      const [x1, y1] = [N.orch.x + N.orch.w * 0.35, N.orch.y + N.orch.h];
      const [x2, y2] = [N.grid.x + N.grid.w * 0.35, N.grid.y];
      return cpath(x1, y1, x2, y2, -20, 0);
    })(),
    label: "command · search_hints",
    lx: 380,
    ly: 275,
  },
  {
    id: "grid-orch",
    d: (() => {
      const [x1, y1] = [N.grid.x + N.grid.w * 0.62, N.grid.y];
      const [x2, y2] = [N.orch.x + N.orch.w * 0.62, N.orch.y + N.orch.h];
      return cpath(x1, y1, x2, y2, 30, 0);
    })(),
    label: "sends claims back",
    lx: 560,
    ly: 275,
    ret: true,
  },
  {
    id: "orch-user",
    d: (() => {
      const [x1, y1] = midRight(N.orch);
      const [x2, y2] = midLeft(N.user);
      return cpath(x1, y1, x2, y2, 40, -20);
    })(),
    label: "report → dossier",
    lx: 780,
    ly: 88,
  },
  {
    id: "grid-ic",
    d: (() => {
      const [x1, y1] = midRight(N.grid);
      const [x2, y2] = midLeft(N.ic);
      return cpath(x1, y1, x2, y2, 8, 0);
    })(),
    label: "record_finding",
    lx: 630,
    ly: 400,
    hot: true,
  },
  {
    id: "orch-ic",
    d: (() => {
      const [x1, y1] = [N.orch.x + N.orch.w * 0.85, N.orch.y + N.orch.h];
      const [x2, y2] = [N.ic.x + N.ic.w * 0.3, N.ic.y];
      return cpath(x1, y1, x2, y2, 140, 50);
    })(),
    label: "record_final · thesis",
    lx: 700,
    ly: 250,
    hot: true,
  },
  {
    id: "user-ic",
    d: (() => {
      const [x1, y1] = midBottom(N.user);
      const [x2, y2] = [N.ic.x + N.ic.w * 0.8, N.ic.y];
      return cpath(x1, y1, x2, y2, 30, 70);
    })(),
    label: "final package",
    lx: 1040,
    ly: 250,
  },
  {
    id: "ic-escrow",
    d: (() => {
      const [x1, y1] = midBottom(N.ic);
      const [x2, y2] = midTop(N.escrow);
      return cpath(x1, y1, x2, y2, 0, 0);
    })(),
    label: "adjudicate · payout_ready",
    lx: 830,
    ly: 590,
    hot: true,
  },
  {
    id: "escrow-wallets",
    d: (() => {
      const [x1, y1] = midLeft(N.escrow);
      const [x2, y2] = midRight(N.wallets);
      return cpath(x1, y1, x2, y2, -50, -40);
    })(),
    label: "USDC by weight",
    lx: 600,
    ly: 680,
    hot: true,
  },
  {
    id: "wallets-grid",
    d: (() => {
      const [x1, y1] = midTop(N.wallets);
      const [x2, y2] = midBottom(N.grid);
      return cpath(x1 + 20, y1, x2 + 20, y2, -90, 0);
    })(),
    label: "same private agents",
    lx: 280,
    ly: 560,
    ret: true,
  },
];

/** Soft rounded row — the look from the first pass. */
function RowLine({ text }: { text: string }) {
  return (
    <li className="loadrow truncate rounded-md border border-ink/12 bg-background/45 px-2 py-[5px] font-mono text-[0.5rem] leading-none text-muted-foreground">
      {text}
    </li>
  );
}

function Box({
  kicker,
  title,
  rows,
  n,
  accent = false,
}: {
  kicker: string;
  title: string;
  rows: string[];
  n: NodeBox;
  accent?: boolean;
}) {
  return (
    <div
      className="absolute flex flex-col overflow-hidden rounded-xl border-2 bg-card"
      style={{
        left: n.x,
        top: n.y,
        width: n.w,
        height: n.h,
        borderColor: accent ? "#c45c26" : "rgba(20,20,18,0.22)",
      }}
    >
      <div className="shrink-0 border-b border-ink/12 px-3 py-1.5">
        <p className="truncate font-mono text-[0.5rem] uppercase tracking-[0.1em] text-muted-foreground">
          {kicker}
        </p>
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-3 pb-3 pt-2.5">
        <p className="shrink-0 text-[0.75rem] font-semibold leading-snug">{title}</p>
        <ul className="mt-2.5 flex flex-col gap-[7px]">
          {rows.map((r) => (
            <RowLine key={r} text={r} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function Product() {
  return (
    <div className="flex-1 overflow-x-auto bg-vellum text-ink">
      <style>{`
        .fl {
          fill: none;
          stroke: rgba(20,20,18,0.3);
          stroke-width: 1.6;
        }
        .fl.hot { stroke: rgba(196,92,38,0.65); stroke-width: 1.8; }
        .fl.ret { stroke-dasharray: 5 4; stroke: rgba(20,20,18,0.35); }
        .lbl {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 10px;
          fill: #6b6a66;
          text-anchor: middle;
        }
        .lbl.hot { fill: #c45c26; }
        .dot { fill: #c45c26; }
        .loadrow { animation: pulse-row 1.9s ease-in-out infinite; }
        .loadrow:nth-child(2) { animation-delay: 0.28s; }
        .loadrow:nth-child(3) { animation-delay: 0.56s; }
        .loadrow:nth-child(4) { animation-delay: 0.84s; }
        @keyframes pulse-row {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; border-color: rgba(196,92,38,0.4); }
        }
        .blink { animation: blink 1.1s step-end infinite; }
        @keyframes blink { 50% { opacity: 0.25; } }
      `}</style>

      <div className="px-6 py-8 sm:px-10 sm:py-12">
        <header className="mb-5 max-w-2xl">
          <p className="label-mono text-signal blink">● run flow · live</p>
          <h1 className="mt-2 font-display text-3xl leading-tight sm:text-4xl">
            Business in. Private grid hunts. Contract judges. Grid gets paid.
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Solid = forward. Dashed = sending back out. Packets ride every wire.
          </p>
        </header>

        <div className="relative" style={{ width: W, height: H }}>
          <svg className="absolute inset-0" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
            <defs>
              <marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
                <path d="M0 1.5 L8 5 L0 8.5 z" fill="rgba(196,92,38,0.75)" />
              </marker>
              <marker id="ar-d" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
                <path d="M0 1.5 L8 5 L0 8.5 z" fill="rgba(20,20,18,0.4)" />
              </marker>
            </defs>

            {EDGES.map((e) => (
              <g key={e.id}>
                <path
                  id={e.id}
                  className={`fl ${e.hot ? "hot" : ""} ${e.ret ? "ret" : ""}`}
                  d={e.d}
                  markerEnd={e.hot ? "url(#ar)" : "url(#ar-d)"}
                />
                <text className={`lbl ${e.hot ? "hot" : ""}`} x={e.lx} y={e.ly}>
                  {e.label}
                </text>
                <circle className="dot" r="3.5">
                  <animateMotion dur="2.6s" repeatCount="indefinite" begin="0s">
                    <mpath href={`#${e.id}`} />
                  </animateMotion>
                </circle>
                <circle className="dot" r="3.5">
                  <animateMotion dur="2.6s" repeatCount="indefinite" begin="1.3s">
                    <mpath href={`#${e.id}`} />
                  </animateMotion>
                </circle>
              </g>
            ))}
          </svg>

          <Box
            kicker="01 · business"
            title="Supply + demand inquiry"
            rows={["what you sell", "region · window"]}
            n={N.biz}
          />
          <Box
            kicker="02 · orchestrator · :8889"
            title="Thinks · owns the run"
            rows={["sibyl recall", "hypotheses", "search_hints", "window + lease"]}
            n={N.orch}
            accent
          />
          <Box
            kicker="03 · private specialist grid"
            title="Private agents search"
            rows={[
              "web · loading…",
              "project · loading…",
              "procurement · loading…",
              "company · person · media",
            ]}
            n={N.grid}
            accent
          />
          <Box
            kicker="04 · customer"
            title="Dossier"
            rows={["executive + evidence", "served immediately"]}
            n={N.user}
          />
          <Box
            kicker="05 · genlayer · bradbury"
            title="Intelligent Contract"
            rows={[
              "NewintelContributionJudge",
              "record_finding ← grid",
              "record_final ← orchestrator",
              "adjudicate · milli 1000",
              "payout_ready gate",
              "0x10713BFf…AEaF8",
            ]}
            n={N.ic}
            accent
          />
          <Box
            kicker="06 · settlement escrow"
            title="Escrow holds the pool"
            rows={["re-reads get_verdict", "no ready · no USDC"]}
            n={N.escrow}
            accent
          />
          <Box
            kicker="07 · grid wallets · base sepolia"
            title="USDC to private agents"
            rows={["7/7 · $12 · payout_tx", "weight → wallet"]}
            n={N.wallets}
            accent
          />
        </div>

        <div className="mt-6 grid max-w-4xl gap-2 border-t border-border pt-5 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["solid →", "forward"],
            ["dashed ←", "sending back out"],
            ["loading rows", "specialists searching"],
            ["accent", "orch · grid · contract · escrow"],
          ].map(([k, v]) => (
            <div key={k}>
              <p className="font-mono text-[0.55rem] text-signal">{k}</p>
              <p className="mt-0.5 font-mono text-[0.52rem] text-muted-foreground">{v}</p>
            </div>
          ))}
        </div>

        <footer className="mt-6 flex flex-wrap items-center gap-5">
          <Link to="/app" className="inline-flex items-center gap-1 text-sm font-medium">
            Run a demand inquiry
            <ArrowUpRight className="size-3.5" aria-hidden />
          </Link>
          <Link to="/developers" className="text-sm text-muted-foreground underline-offset-2 hover:text-signal hover:underline">
            Plug in a private agent
          </Link>
        </footer>
      </div>
    </div>
  );
}
