"use client";

import { type ChangeEvent, type ClipboardEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { signIn, useSession } from "next-auth/react";
import { LiveKitRoom, VideoConference, useLocalParticipant } from "@livekit/components-react";
import { ParticipantVolumeController } from "@/components/ParticipantVolumeController";
import "@livekit/components-styles";
import { ParticipantEvent, Track, type LocalTrackPublication, type TrackPublication } from "livekit-client";
import { animate } from "animejs";

const CharacterSheetEditor = dynamic(
  () => import("@/components/CharacterSheetEditor").then((mod) => mod.CharacterSheetEditor),
  { ssr: false }
);
const FloatingVideoConference = dynamic(
  () => import("@/components/FloatingVideoConference").then((mod) => mod.FloatingVideoConference),
  { ssr: false }
);
const MusicPlayer = dynamic(
  () => import("@/components/MusicPlayer").then((mod) => mod.MusicPlayer),
  { ssr: false }
);
const CollaborativeDocument = dynamic(
  () => import("@/components/CollaborativeDocument").then((mod) => mod.CollaborativeDocument),
  { ssr: false }
);
type ApiResponse<T> = {
  data: T | null;
  error: { code: string; message: string } | null;
};

type Participant = {
  id: string;
  name: string;
  role: "gm" | "player" | "admin";
  inCall: boolean;
  micOn: boolean;
  camOn: boolean;
  callChannelSlug?: string | null;
  lastSeen?: string;
};

type Roll = {
  id: string;
  participantId: string;
  participantName: string;
  rollName?: string | null;
  sides: number;
  count: number;
  expression?: string | null;
  modifier?: number | null;
  results: number[];
  total: number;
  createdAt: string;
};

type Channel = {
  id: string;
  name: string;
  slug: string;
  type: "text" | "voice" | "dice";
};

type InitiativeEntry = {
  id: string;
  participantId: string | null;
  participantName: string | null;
  creatureName: string | null;
  expression: string;
  result: number;
  results?: number[];
  sortOrder: number;
  isAlive?: boolean;
};

type InitiativeState = {
  currentTurnEntryId: string | null;
  turnCount: number;
  roundCount: number;
};

/** Unified reveal data for dice overlay (main roll or initiative). */
type RollRevealData = {
  expression: string;
  total: number;
  results: number[];
  participantName: string;
  rollName?: string | null;
};

type ChatMessage = {
  id: string;
  channelId: string;
  content: string | null;
  imageDataUrl?: string | null;
  createdAt: string;
  participant: {
    id: string;
    name: string;
    role: "gm" | "player" | "admin";
  };
};

const LIVEKIT_URL = process.env.NEXT_PUBLIC_LIVEKIT_URL ?? "";
const CALL_STALE_MS = 3 * 60 * 1000; // 3 min - hide from call if no ping
const ONLINE_MS = 90 * 1000; // 1.5 min - show as "online"
const CHAT_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const CHAT_IMAGE_MAX_DATA_URL_LENGTH = 3_100_000;
const CHAT_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]);
const PARTICIPANT_VOLUME_MIN = 0;
const PARTICIPANT_VOLUME_MAX = 2;
const PARTICIPANT_VOLUME_STEP = 0.05;

function clampParticipantVolume(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(PARTICIPANT_VOLUME_MAX, Math.max(PARTICIPANT_VOLUME_MIN, value));
}

async function parseApiResponse<T>(res: Response): Promise<ApiResponse<T>> {
  const text = await res.text().catch(() => "");
  if (!text) {
    return {
      data: null,
      error: {
        code: res.ok ? "empty_response" : `http_${res.status}`,
        message: res.ok ? "Empty response" : `Request failed (${res.status})`,
      },
    };
  }
  try {
    return JSON.parse(text) as ApiResponse<T>;
  } catch {
    return {
      data: null,
      error: {
        code: "invalid_json",
        message: res.ok ? "Invalid response" : `Request failed (${res.status})`,
      },
    };
  }
}

function parseStoredParticipantVolumes(raw: string | null): Record<string, number> {
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([, value]) => typeof value === "number" && Number.isFinite(value))
        .map(([participantId, value]) => [
          participantId,
          clampParticipantVolume(value as number),
        ])
    );
  } catch {
    return {};
  }
}

function participantVolumeToPercent(value: number) {
  return Math.round(clampParticipantVolume(value) * 100);
}

function formatLastSeen(iso: string | undefined): { label: string; online: boolean } {
  if (!iso) return { label: "—", online: false };
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < ONLINE_MS) return { label: "Online", online: true };
  if (ms < 60 * 1000) return { label: `${Math.floor(ms / 1000)}s ago`, online: false };
  if (ms < 60 * 60 * 1000) return { label: `${Math.floor(ms / 60000)}m ago`, online: false };
  if (ms < 24 * 60 * 60 * 1000) return { label: `${Math.floor(ms / 3600000)}h ago`, online: false };
  return { label: `${Math.floor(ms / 86400000)}d ago`, online: false };
}

function isChatImageTypeSupported(type: string) {
  return CHAT_IMAGE_TYPES.has(type.toLowerCase());
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Could not read image."));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () => reject(new Error("Could not read image."));
    reader.readAsDataURL(file);
  });
}

/** Parse expression to get sides per die for overlay tumbling (e.g. "2d6+3" → [6,6]). */
function parseExpressionSides(expr: string): number[] {
  const out: number[] = [];
  const regex = /(\d*)d(\d+)/gi;
  let m;
  while ((m = regex.exec(expr)) !== null) {
    const count = m[1] ? parseInt(m[1], 10) : 1;
    const sides = parseInt(m[2], 10);
    for (let i = 0; i < count; i++) out.push(sides);
  }
  return out.length ? out : [20];
}

/** Get sides for each die in order from expression, or [sides×count] for legacy. */
function getTermSides(roll: Roll): number[] {
  if (roll.expression?.trim()) {
    const expr = roll.expression.trim().replace(/\s+/g, "");
    const out: number[] = [];
    const regex = /(\d*)d(\d+)/gi;
    let m;
    while ((m = regex.exec(expr)) !== null) {
      const count = m[1] ? parseInt(m[1], 10) : 1;
      const sides = parseInt(m[2], 10);
      for (let i = 0; i < count; i++) out.push(sides);
    }
    return out.length > 0 ? out : Array(roll.count).fill(roll.sides);
  }
  return Array(roll.count).fill(roll.sides);
}

/**
 * Returns a flat mask (one bool per die in roll.results) indicating whether
 * that die was dropped by a keep-highest/lowest modifier. The server stores
 * kept dice first within each term, followed by dropped ones.
 */
function getDroppedMask(roll: Roll): boolean[] {
  const rawExpr = roll.expression?.trim().replace(/\s+/g, "");
  if (!rawExpr) return Array(roll.results.length).fill(false);
  const expanded = /^(adv|dis)(d20)?/i.test(rawExpr)
    ? rawExpr.replace(/^(adv|dis)(d20)?/i, (_match, kw: string) =>
        kw.toLowerCase() === "adv" ? "2d20kh1" : "2d20kl1"
      )
    : rawExpr;
  const termRegex = /(\d*)d(\d+)(?:k([hl])?(\d+))?/gi;
  const mask: boolean[] = [];
  let m;
  while ((m = termRegex.exec(expanded)) !== null) {
    const count = m[1] ? parseInt(m[1], 10) : 1;
    const keepCount = m[4] ? parseInt(m[4], 10) : count;
    for (let i = 0; i < count; i += 1) {
      mask.push(i >= keepCount);
    }
  }
  while (mask.length < roll.results.length) mask.push(false);
  return mask;
}

function describeRoll(roll: Pick<Roll, "rollName" | "expression" | "count" | "sides">): string {
  const fallback = `${roll.count}d${roll.sides}`;
  if (roll.rollName && roll.expression) return `${roll.rollName} · ${roll.expression}`;
  return roll.rollName ?? roll.expression ?? fallback;
}

/** Normalise an arbitrary die-sides value into the closest standard polyhedral
 * for picking its silhouette. Non-standard sizes fall back to the nearest
 * supported shape. */
function normalizedDieKind(sides: number): 4 | 6 | 8 | 10 | 12 | 20 | 100 {
  if (sides === 4) return 4;
  if (sides === 6) return 6;
  if (sides === 8) return 8;
  if (sides === 10) return 10;
  if (sides === 12) return 12;
  if (sides === 20) return 20;
  if (sides >= 100) return 100;
  if (sides <= 4) return 4;
  if (sides <= 6) return 6;
  if (sides <= 8) return 8;
  if (sides <= 12) return 12;
  if (sides <= 20) return 20;
  return 100;
}

const URL_REGEX = /\b((?:https?:\/\/|www\.)[^\s<>"']+)/gi;

function renderMessageContent(content: string): ReactNode {
  if (!content) return null;
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(URL_REGEX.source, "gi");
  while ((match = re.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index));
    }
    const raw = match[0];
    const href = raw.startsWith("http") ? raw : `https://${raw}`;
    parts.push(
      <a
        key={`${match.index}-${raw}`}
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="text-sky-600 underline hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300"
      >
        {raw}
      </a>
    );
    lastIndex = match.index + raw.length;
  }
  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
  }
  return parts;
}

type DiePalette = { bg: string; fg: string; stroke: string };

/** Explicit hex palette per tone so SVG fills don't rely on CSS-custom-property
 * inheritance into <svg> children (which is flaky in some browsers/Tailwind v4
 * layer setups and can cause all-black fills). */
const DIE_PALETTES: Record<string, DiePalette> = {
  neutral: { bg: "rgb(244 244 245)", fg: "rgb(82 82 91)", stroke: "rgb(161 161 170)" },
  red: { bg: "rgb(254 226 226)", fg: "rgb(153 27 27)", stroke: "rgb(220 38 38)" },
  amber: { bg: "rgb(254 243 199)", fg: "rgb(120 53 15)", stroke: "rgb(217 119 6)" },
  yellow: { bg: "rgb(254 249 195)", fg: "rgb(113 63 18)", stroke: "rgb(202 138 4)" },
  lime: { bg: "rgb(236 252 203)", fg: "rgb(54 83 20)", stroke: "rgb(101 163 13)" },
  emeraldSoft: { bg: "rgb(236 253 245)", fg: "rgb(6 95 70)", stroke: "rgb(16 185 129)" },
  emerald: { bg: "rgb(209 250 229)", fg: "rgb(4 120 87)", stroke: "rgb(5 150 105)" },
};

/** Map (value, sides) to a die palette. Value 1 = red, max value = emerald. */
function dicePalette(value: number, sides: number): DiePalette {
  if (sides <= 1) return DIE_PALETTES.neutral;
  const t = (value - 1) / (sides - 1); // 0..1
  if (t <= 0) return DIE_PALETTES.red;
  if (t >= 1) return DIE_PALETTES.emerald;
  if (t < 0.25) return DIE_PALETTES.amber;
  if (t < 0.5) return DIE_PALETTES.yellow;
  if (t < 0.75) return DIE_PALETTES.lime;
  return DIE_PALETTES.emeraldSoft;
}

/** SVG silhouette for a polyhedral die. Each shape uses a 48x48 viewBox and
 * receives its colours inline from the `palette` prop (see `dicePalette`).
 * The silhouettes include inner-facet lines so each die reads as the actual
 * polyhedron (with its face count) rather than just a flat polygon:
 *   d4   = tetrahedron (triangle + 3 inner edges → 3 visible faces)
 *   d6   = cube (rounded square + corner bevels)
 *   d8   = octahedron (diamond + horiz + vert equator → 4 visible faces)
 *   d10  = pentagonal trapezohedron (kite + equator + 4 facet ridges)
 *   d12  = dodecahedron (outer pentagon + inner rotated pentagon + spokes)
 *   d20  = icosahedron (hexagon + inner downward triangle + 3 outer triangles)
 *   d100 = d% (two overlapping circles)                                    */
function DiePolygon({ sides, palette }: { sides: number; palette: DiePalette }) {
  const kind = normalizedDieKind(sides);
  const fillProps = {
    fill: palette.bg,
    stroke: palette.stroke,
    strokeWidth: 2,
    strokeLinejoin: "round" as const,
    strokeLinecap: "round" as const,
    vectorEffect: "non-scaling-stroke" as const,
  };
  const accentProps = {
    fill: "none",
    stroke: palette.stroke,
    strokeWidth: 1.2,
    strokeOpacity: 0.55,
    strokeLinejoin: "round" as const,
    strokeLinecap: "round" as const,
    vectorEffect: "non-scaling-stroke" as const,
  };
  switch (kind) {
    case 4:
      // Tetrahedron: triangle face with 3 ridges meeting near centroid,
      // hinting at the 3 visible side faces (4th face is hidden on the back).
      return (
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <polygon {...fillProps} points="24,4 44,42 4,42" />
          <polyline {...accentProps} points="24,4 24,30" />
          <polyline {...accentProps} points="4,42 24,30" />
          <polyline {...accentProps} points="44,42 24,30" />
        </svg>
      );
    case 6:
      // Cube: rounded square with two corner bevels suggesting 3D depth.
      return (
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <rect {...fillProps} x="5" y="5" width="38" height="38" rx="6" />
          <polyline {...accentProps} points="12,5 5,12" />
          <polyline {...accentProps} points="43,36 36,43" />
        </svg>
      );
    case 8:
      // Octahedron: rhombus with horizontal + vertical equators → 4 visible
      // triangular faces (top-left, top-right, bottom-left, bottom-right).
      return (
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <polygon {...fillProps} points="24,3 45,24 24,45 3,24" />
          <polyline {...accentProps} points="3,24 45,24" />
          <polyline {...accentProps} points="24,3 24,45" />
        </svg>
      );
    case 10:
      // Pentagonal trapezohedron: kite outline plus equator and 4 radial
      // ridges to the visible upper/lower kite-face edges.
      return (
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <polygon {...fillProps} points="24,2 44,18 24,46 4,18" />
          <polyline {...accentProps} points="4,18 44,18" />
          <polyline {...accentProps} points="24,2 24,18" />
          <polyline {...accentProps} points="24,18 14,46" />
          <polyline {...accentProps} points="24,18 34,46" />
        </svg>
      );
    case 12:
      // Dodecahedron: outer pentagon + inner (opposite) pentagon rotated
      // 36° with spokes connecting them, giving the 5 visible trapezoid faces.
      return (
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <polygon {...fillProps} points="24,3 45,19 37,44 11,44 3,19" />
          <polygon {...accentProps} points="24,17 34,24 30,35 18,35 14,24" />
          <polyline {...accentProps} points="24,3 24,17" />
          <polyline {...accentProps} points="45,19 34,24" />
          <polyline {...accentProps} points="37,44 30,35" />
          <polyline {...accentProps} points="11,44 18,35" />
          <polyline {...accentProps} points="3,19 14,24" />
        </svg>
      );
    case 20:
      // Icosahedron: hexagon outline + inner downward triangle (front face)
      // + 3 small triangles in the top/bottom-left/bottom-right, giving the
      // classic "6 visible triangular faces" d20 silhouette.
      return (
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <polygon {...fillProps} points="24,3 44,14 44,34 24,45 4,34 4,14" />
          <polygon {...accentProps} points="24,16 36,34 12,34" />
          <polyline {...accentProps} points="24,3 24,16" />
          <polyline {...accentProps} points="44,14 36,34" />
          <polyline {...accentProps} points="4,14 12,34" />
        </svg>
      );
    case 100:
    default:
      // d% – two overlapping dice faces.
      return (
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <circle {...fillProps} cx="17" cy="24" r="13" />
          <circle {...fillProps} cx="31" cy="24" r="13" />
        </svg>
      );
  }
}

/** Tumbling die face during roll – cycles numbers for tension. */
function TumblingDie({
  sides,
  finalValue,
  isRevealing,
  palette,
}: {
  sides: number;
  finalValue: number;
  isRevealing: boolean;
  palette: DiePalette;
}) {
  const [display, setDisplay] = useState(finalValue);
  const dieRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (isRevealing) return;
    const id = setInterval(() => {
      setDisplay((prev) => (prev % sides) + 1);
    }, 60 + Math.random() * 40);
    return () => clearInterval(id);
  }, [sides, isRevealing]);

  useEffect(() => {
    const node = dieRef.current;
    if (!node) return;

    if (isRevealing) {
      const reveal = animate(node, {
        scale: [0.35, 1.18, 0.94, 1],
        rotate: [-8, 6, -2, 0],
        duration: 520,
        ease: "out(3)",
      });
      return () => {
        reveal.pause();
      };
    }

    const tumble = animate(node, {
      x: [-3, 3, -2, 2, 0],
      y: [2, -2, -3, 3, 0],
      rotate: [-8, 7, -5, 6, 0],
      duration: 280,
      ease: "inOutSine",
      loop: true,
    });
    return () => {
      tumble.pause();
      node.style.transform = "";
    };
  }, [isRevealing, finalValue]);

  return (
    <span ref={dieRef} className="die-shape h-12 w-12" title={`d${sides}`}>
      <DiePolygon sides={sides} palette={palette} />
      <span className="die-num text-xl" style={{ color: palette.fg }}>
        {isRevealing ? finalValue : display}
      </span>
    </span>
  );
}

function DiceNotationHelp({
  open,
  onClose,
  align = "left",
}: {
  open: boolean;
  onClose: () => void;
  align?: "left" | "right";
}) {
  if (!open) return null;
  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 cursor-default"
        aria-hidden
        tabIndex={-1}
        onClick={onClose}
      />
      <div
        className={`absolute ${align === "right" ? "right-0" : "left-0"} top-6 z-50 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-zinc-200 bg-white p-3 text-xs shadow-2xl ring-1 ring-black/5 dark:border-zinc-700 dark:bg-zinc-900`}
      >
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Dice notation
          </p>
          <button
            type="button"
            className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            onClick={onClose}
            aria-label="Close help"
          >
            ×
          </button>
        </div>
        <ul className="space-y-1.5 text-zinc-700 dark:text-zinc-200">
          <li>
            <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] dark:bg-zinc-800">d20</code>
            {" "}— tek bir 20 yüzlü zar
          </li>
          <li>
            <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] dark:bg-zinc-800">2d6+3</code>
            {" "}— iki d6 topla, +3 ekle
          </li>
          <li>
            <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] dark:bg-zinc-800">1d20-1d4</code>
            {" "}— çıkarma da mümkün
          </li>
          <li className="border-t border-zinc-200 pt-1.5 dark:border-zinc-700">
            <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[11px] text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">adv</code>
            {" "}— <strong>Avantaj</strong> (2d20, büyüğünü al). <code className="font-mono">adv+5</code> modifier ile.
          </li>
          <li>
            <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[11px] text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">dis</code>
            {" "}— <strong>Dezavantaj</strong> (2d20, küçüğünü al)
          </li>
          <li>
            <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[11px] text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">4d6kh3</code>
            {" "}— 4 zar at, en büyük 3&apos;ünü say (karakter statları)
          </li>
          <li>
            <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[11px] text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">4d6kl1</code>
            {" "}— en küçük 1&apos;ini say. <code className="font-mono">k3</code> = <code className="font-mono">kh3</code>.
          </li>
          <li className="border-t border-zinc-200 pt-1.5 dark:border-zinc-700">
            <code className="rounded bg-sky-100 px-1.5 py-0.5 font-mono text-[11px] text-sky-900 dark:bg-sky-900/40 dark:text-sky-200">2rr2d20</code>
            {" "}— <strong>iterasyon</strong>: 2d20&apos;yi 2 kez at (max 20)
          </li>
        </ul>
        <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
          Düşen zarlar soluk &amp; üstü çizili görünür.
        </p>
      </div>
    </>
  );
}

function DiceHelpButton({
  open,
  onToggle,
  align = "left",
  onClose,
}: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  align?: "left" | "right";
}) {
  return (
    <div className="relative">
      <button
        type="button"
        className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-200/70 text-[10px] font-bold text-amber-800 transition hover:bg-amber-300 dark:bg-amber-700/60 dark:text-amber-100 dark:hover:bg-amber-600"
        onClick={onToggle}
        aria-expanded={open}
        aria-label="Dice notation help"
        title="Nasıl zar atılır?"
      >
        ?
      </button>
      <DiceNotationHelp open={open} onClose={onClose} align={align} />
    </div>
  );
}

function DieChip({
  sides,
  value,
  size = "sm",
  dropped = false,
}: {
  sides: number;
  value: number;
  size?: "sm" | "md";
  dropped?: boolean;
}) {
  const dim = size === "md" ? "h-9 w-9" : "h-8 w-8";
  const txt = size === "md" ? "text-sm" : "text-xs";
  const palette = dicePalette(value, sides);
  return (
    <span
      className={`die-wrap ${dropped ? "opacity-40 grayscale" : ""}`}
      title={dropped ? `d${sides} (dropped)` : `d${sides}`}
    >
      <span className={`die-shape ${dim} ${dropped ? "line-through decoration-zinc-500 decoration-2" : ""}`}>
        <DiePolygon sides={sides} palette={palette} />
        <span className={`die-num ${txt}`} style={{ color: palette.fg }}>
          {value}
        </span>
      </span>
      <span className="die-label">d{sides}</span>
    </span>
  );
}

function AnimatedSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const knobRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (knobRef.current) {
      animate(knobRef.current, {
        x: checked ? 16 : 0,
        duration: 220,
        ease: "out(3)",
      });
    }
  }, [checked]);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-900 ${
        checked ? "bg-sky-500" : "bg-zinc-300 dark:bg-zinc-700"
      }`}
    >
      <span
        ref={knobRef}
        className="inline-block h-4 w-4 rounded-full bg-white shadow-sm"
        style={{ marginLeft: 2 }}
      />
    </button>
  );
}

function MinimizedCallBar({ onExpand }: { onExpand: () => void }) {
  const { localParticipant } = useLocalParticipant();
  const barRef = useRef<HTMLDivElement>(null);

  const micEnabled = localParticipant.isMicrophoneEnabled;
  const camEnabled = localParticipant.isCameraEnabled;

  useEffect(() => {
    if (barRef.current) {
      animate(barRef.current, {
        scale: [0.85, 1],
        opacity: [0, 1],
        duration: 280,
        ease: "out(3)",
      });
    }
  }, []);

  return (
    <div
      ref={barRef}
      className="fixed bottom-24 right-4 z-50 flex items-center gap-1 rounded-full border border-zinc-200 bg-white/95 px-1.5 py-1 shadow-lg backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95"
    >
      <button
        type="button"
        onClick={() => localParticipant.setMicrophoneEnabled(!micEnabled)}
        className={`rounded-full p-2 transition ${
          micEnabled
            ? "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            : "bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400"
        }`}
        title={micEnabled ? "Mute mic" : "Unmute mic"}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {micEnabled ? (
            <>
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </>
          ) : (
            <>
              <line x1="1" y1="1" x2="23" y2="23" />
              <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
              <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .77-.13 1.53-.36 2.24" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </>
          )}
        </svg>
      </button>
      <button
        type="button"
        onClick={() => localParticipant.setCameraEnabled(!camEnabled)}
        className={`rounded-full p-2 transition ${
          camEnabled
            ? "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            : "bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-400"
        }`}
        title={camEnabled ? "Turn off camera" : "Turn on camera"}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {camEnabled ? (
            <>
              <path d="M23 7l-7 5 7 5V7z" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </>
          ) : (
            <>
              <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </>
          )}
        </svg>
      </button>
      <div className="mx-0.5 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />
      <button
        type="button"
        onClick={onExpand}
        className="rounded-full p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        title="Expand video"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 15l6-6 6 6" />
        </svg>
      </button>
    </div>
  );
}

const PTT_KEY_OPTIONS = [
  { code: "Space", label: "Space" },
  { code: "KeyV", label: "V" },
  { code: "KeyF", label: "F" },
  { code: "KeyT", label: "T" },
  { code: "ShiftLeft", label: "Left Shift" },
] as const;

function getPttKeyLabel(code: string) {
  const found = PTT_KEY_OPTIONS.find((option) => option.code === code);
  if (found) return found.label;
  if (code.startsWith("Key")) return code.slice(3).toUpperCase();
  return code;
}

function VoiceRuntimeControls({
  mode,
  pttKeyCode,
  noiseThreshold,
}: {
  mode: "always" | "ptt";
  pttKeyCode: string;
  noiseThreshold: number;
}) {
  const { localParticipant } = useLocalParticipant();
  const [pttActive, setPttActive] = useState(false);
  const [inputLevel, setInputLevel] = useState(0);
  const [isNoiseOpen, setIsNoiseOpen] = useState(true);
  const [micPublication, setMicPublication] = useState<TrackPublication | null>(null);

  // Make sure the mic track is published once; after that we gate audio by
  // toggling the underlying MediaStreamTrack instead of unpublishing it.
  useEffect(() => {
    void localParticipant.setMicrophoneEnabled(true).catch(() => {});
  }, [localParticipant]);

  // Keep a ref to the current mic publication so we re-attach the analyser if
  // LiveKit ever republishes the track (e.g. user mutes from the built-in UI
  // and unmutes again, or a device change occurs).
  useEffect(() => {
    const syncPublication = () => {
      const pub = localParticipant.getTrackPublication(Track.Source.Microphone);
      setMicPublication((prev) => (prev === pub ? prev : pub ?? null));
    };

    syncPublication();

    const onPublished = (_pub: LocalTrackPublication) => syncPublication();
    const onUnpublished = (_pub: LocalTrackPublication) => syncPublication();
    const onMuteChanged = (_pub: TrackPublication) => syncPublication();

    localParticipant.on(ParticipantEvent.LocalTrackPublished, onPublished);
    localParticipant.on(ParticipantEvent.LocalTrackUnpublished, onUnpublished);
    localParticipant.on(ParticipantEvent.TrackMuted, onMuteChanged);
    localParticipant.on(ParticipantEvent.TrackUnmuted, onMuteChanged);

    // Publications can appear asynchronously after connect; poll briefly until
    // we see one so the meter always starts.
    let attempts = 0;
    const pollTimer: ReturnType<typeof setInterval> = setInterval(() => {
      attempts += 1;
      syncPublication();
      if (attempts > 40) clearInterval(pollTimer);
    }, 250);

    return () => {
      localParticipant.off(ParticipantEvent.LocalTrackPublished, onPublished);
      localParticipant.off(ParticipantEvent.LocalTrackUnpublished, onUnpublished);
      localParticipant.off(ParticipantEvent.TrackMuted, onMuteChanged);
      localParticipant.off(ParticipantEvent.TrackUnmuted, onMuteChanged);
      clearInterval(pollTimer);
    };
  }, [localParticipant]);

  // Input meter + noise-gate decision loop. Re-runs whenever the publication
  // (and thus the underlying MediaStreamTrack) changes or the threshold moves.
  useEffect(() => {
    const micTrack = micPublication?.track;
    const mediaTrack = micTrack?.mediaStreamTrack;
    if (!mediaTrack) {
      setInputLevel(0);
      return;
    }

    let analyser: AnalyserNode | null = null;
    let context: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let lowFrames = 0;
    let highFrames = 0;

    try {
      context = new AudioContext();
      analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.2;
      source = context.createMediaStreamSource(new MediaStream([mediaTrack]));
      source.connect(analyser);
    } catch {
      return;
    }

    const data = new Uint8Array(analyser.fftSize);
    // Map the 1..50 slider to a reasonable RMS range (0.01..0.25). The old
    // mapping (value / 100) capped at 0.5, which is louder than shouting.
    const sliderFraction = Math.min(1, Math.max(0, (noiseThreshold - 1) / 49));
    const threshold = 0.01 + sliderFraction * 0.24;
    const openFrames = 2; // ~140ms to open
    const closeFrames = 10; // ~700ms hang time before closing

    timer = setInterval(() => {
      if (!analyser) return;
      analyser.getByteTimeDomainData(data);
      let sumSquares = 0;
      for (let i = 0; i < data.length; i += 1) {
        const normalized = (data[i] - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / data.length);
      setInputLevel(rms);

      if (rms >= threshold) {
        highFrames += 1;
        lowFrames = 0;
      } else {
        lowFrames += 1;
        highFrames = 0;
      }

      if (highFrames >= openFrames) setIsNoiseOpen(true);
      else if (lowFrames >= closeFrames) setIsNoiseOpen(false);
    }, 70);

    return () => {
      if (timer) clearInterval(timer);
      try {
        source?.disconnect();
      } catch {}
      if (context && context.state !== "closed") void context.close().catch(() => {});
    };
  }, [micPublication, noiseThreshold]);

  useEffect(() => {
    if (mode !== "ptt") return;

    const isTypingTarget = (eventTarget: EventTarget | null) => {
      const node = eventTarget as HTMLElement | null;
      if (!node) return false;
      const tag = node.tagName.toLowerCase();
      return tag === "input" || tag === "textarea" || node.isContentEditable;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== pttKeyCode) return;
      if (isTypingTarget(event.target)) return;
      if (event.repeat) return;
      event.preventDefault();
      setPttActive(true);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== pttKeyCode) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      setPttActive(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [mode, pttKeyCode]);

  // Apply the gate/PTT state by toggling the MediaStreamTrack directly. This
  // keeps the LiveKit publication alive, so the analyser keeps reading real
  // audio and the gate can re-open without a republish cycle.
  useEffect(() => {
    const micTrack = micPublication?.track;
    const mediaTrack = micTrack?.mediaStreamTrack;
    if (!mediaTrack) return;
    const shouldEnable = mode === "ptt" ? pttActive : isNoiseOpen;
    if (mediaTrack.enabled !== shouldEnable) {
      mediaTrack.enabled = shouldEnable;
    }
  }, [isNoiseOpen, mode, pttActive, micPublication]);

  return (
    <div className="absolute bottom-16 left-2 z-40 flex items-center gap-2">
      <div className="pointer-events-none rounded-lg bg-black/60 px-2 py-1 text-[10px] text-white">
        <span>Input {Math.round(inputLevel * 100)}</span>
        <span className="mx-2">|</span>
        {mode === "ptt" ? (
          <span>{pttActive ? "PTT live" : `Hold ${getPttKeyLabel(pttKeyCode)}`}</span>
        ) : (
          <span>{isNoiseOpen ? "Mic open" : "Noise gate closed"}</span>
        )}
      </div>
      {mode === "ptt" ? (
        <button
          type="button"
          className="pointer-events-auto rounded-lg bg-zinc-800 px-3 py-2 text-xs font-semibold text-white hover:bg-zinc-700 active:bg-emerald-600"
          onMouseDown={() => setPttActive(true)}
          onMouseUp={() => setPttActive(false)}
          onMouseLeave={() => setPttActive(false)}
          onTouchStart={(e) => { e.preventDefault(); setPttActive(true); }}
          onTouchEnd={(e) => { e.preventDefault(); setPttActive(false); }}
        >
          Hold to talk
        </button>
      ) : null}
    </div>
  );
}

export default function RoomPage() {
  const params = useParams();
  const router = useRouter();
  const search = useSearchParams();
  const { data: session, status } = useSession();
  const roomId = params.roomId as string;
  const participantVolumeStorageKey = `aynfrp:room:${roomId}:participantVolumes`;
  const [room, setRoom] = useState<{
    id: string;
    name: string;
    inviteCode: string;
    sessionState: "waiting" | "active" | "ended";
    gmId: string | null;
    createdByParticipantId: string | null;
    recap: string | null;
    backgroundMusicUrl: string | null;
  } | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [rolls, setRolls] = useState<Roll[]>([]);
  const rollCursorRef = useRef(new Date().toISOString());
  const rollsInitializedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("aynfrp:lastName") ?? "";
  });
  useEffect(() => {
    if (displayName.trim()) return;
    const accountName = session?.user?.name?.trim();
    if (accountName) {
      setDisplayName(accountName);
      return;
    }
    const email = session?.user?.email ?? "";
    const prefix = email.split("@")[0]?.trim();
    if (prefix) setDisplayName(prefix);
  }, [session?.user?.name, session?.user?.email, displayName]);
  const [storedParticipantId, setStoredParticipantId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(`aynfrp:room:${roomId}:participant`);
  });
  const [callJoined, setCallJoined] = useState(false);
  const [callFrameReady, setCallFrameReady] = useState(false);
  const [callToken, setCallToken] = useState<string | null>(null);
  const [callError, setCallError] = useState<string | null>(null);
  const [participantVolumes, setParticipantVolumes] = useState<Record<string, number>>(() => {
    if (typeof window === "undefined") return {};
    return parseStoredParticipantVolumes(localStorage.getItem(participantVolumeStorageKey));
  });
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [channelCreateOpen, setChannelCreateOpen] = useState(false);
  const [channelCreateType, setChannelCreateType] = useState<"text" | "voice" | "dice">("text");
  const [channelCreateName, setChannelCreateName] = useState("");
  const [channelCreateError, setChannelCreateError] = useState<string | null>(null);
  const [channelCreating, setChannelCreating] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatImagePreview, setChatImagePreview] = useState<string | null>(null);
  const [chatImageName, setChatImageName] = useState<string | null>(null);
  const [chatSending, setChatSending] = useState(false);
  const [unreadByChannel, setUnreadByChannel] = useState<Record<string, number>>({});
  const chatCursorRef = useRef<string>(new Date().toISOString());
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const chatImageInputRef = useRef<HTMLInputElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const isSwitchingVoiceChannelRef = useRef(false);
  const [audioMode, setAudioMode] = useState<"always" | "ptt">("always");
  const [pttKeyCode, setPttKeyCode] = useState<string>("Space");
  const [noiseThreshold, setNoiseThreshold] = useState(5);
  const [diceExpression, setDiceExpression] = useState("d20");
  const [diceHelpOpen, setDiceHelpOpen] = useState(false);
  const [initiativeHelpOpen, setInitiativeHelpOpen] = useState(false);
  const [diceError, setDiceError] = useState<string | null>(null);
  const [rollingDice, setRollingDice] = useState(false);
  const [diceLogHeight, setDiceLogHeight] = useState<number>(192);
  const diceLogResizeRef = useRef<{ startY: number; startHeight: number; current: number } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem("frp:dice-log:height");
      if (!raw) return;
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isFinite(parsed)) return;
      setDiceLogHeight(Math.min(900, Math.max(120, parsed)));
    } catch {
      // Ignore storage errors.
    }
  }, []);

  const handleDiceLogResizeStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = diceLogHeight;
      diceLogResizeRef.current = { startY, startHeight, current: startHeight };
      const onMove = (moveEvent: PointerEvent) => {
        const ctx = diceLogResizeRef.current;
        if (!ctx) return;
        const delta = moveEvent.clientY - ctx.startY;
        const next = Math.min(900, Math.max(120, ctx.startHeight + delta));
        ctx.current = next;
        setDiceLogHeight(next);
      };
      const onUp = () => {
        const ctx = diceLogResizeRef.current;
        if (ctx) {
          try {
            window.localStorage.setItem("frp:dice-log:height", String(Math.round(ctx.current)));
          } catch {
            // Ignore storage errors.
          }
        }
        diceLogResizeRef.current = null;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [diceLogHeight]
  );
  const [rollOverlay, setRollOverlay] = useState<
    | { phase: "rolling"; expression: string }
    | { phase: "reveal"; data: RollRevealData }
    | null
  >(null);
  const [namedRolls, setNamedRolls] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = localStorage.getItem("aynfrp:namedRolls");
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  const [namedRollInput, setNamedRollInput] = useState<string | null>(null);
  const [rollToasts, setRollToasts] = useState<Roll[]>([]);
  const [exitingRollToastIds, setExitingRollToastIds] = useState<Set<string>>(() => new Set());
  const rollToastTimersRef = useRef<Map<string, { exit: number; remove: number }>>(new Map());
  const [initiativeEntries, setInitiativeEntries] = useState<InitiativeEntry[]>([]);
  const [initiativeState, setInitiativeState] = useState<InitiativeState>({
    currentTurnEntryId: null,
    turnCount: 0,
    roundCount: 0,
  });
  const [initiativeTurnCountInput, setInitiativeTurnCountInput] = useState("");
  const [showTurnCountForm, setShowTurnCountForm] = useState(false);
  const [initiativeCreatureName, setInitiativeCreatureName] = useState("");
  const [initiativeExpression, setInitiativeExpression] = useState("d20");
  const [initiativeAdding, setInitiativeAdding] = useState(false);
  const [initiativeError, setInitiativeError] = useState<string | null>(null);
  const [initiativeExpanded, setInitiativeExpanded] = useState(false);
  const [musicUrl, setMusicUrl] = useState("");
  const [musicError, setMusicError] = useState<string | null>(null);
  const [gmAssignError, setGmAssignError] = useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = useState<null | "code" | "link">(null);
  const [inviteCopyError, setInviteCopyError] = useState<string | null>(null);
  const [inviteMenuOpen, setInviteMenuOpen] = useState(false);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameInput, setRenameInput] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [roomRenameEditing, setRoomRenameEditing] = useState(false);
  const [roomRenameInput, setRoomRenameInput] = useState("");
  const [roomRenameSaving, setRoomRenameSaving] = useState(false);
  const [roomRenameError, setRoomRenameError] = useState<string | null>(null);
  const [welcomePromptOpen, setWelcomePromptOpen] = useState(false);
  const [floatVideos, setFloatVideos] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("aynfrp:floatVideos") === "1";
  });
  const [floatingVideoSize, setFloatingVideoSize] = useState<{ w: number; h: number } | null>(null);
  const [floatingVideoMinimized, setFloatingVideoMinimized] = useState(false);
  const [musicModuleOpen, setMusicModuleOpen] = useState(false);
  const [floatingVideoPosition, setFloatingVideoPosition] = useState<{ x: number; y: number } | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem("aynfrp:floatVideoPos");
      if (raw) {
        const p = JSON.parse(raw) as { x: number; y: number };
        if (typeof p.x === "number" && typeof p.y === "number") return p;
      }
    } catch {}
    return null;
  });

  const queryParticipantId = search.get("pid");
  const participantId = queryParticipantId ?? storedParticipantId;
  const currentParticipant = useMemo(
    () => participants.find((person) => person.id === participantId) ?? null,
    [participantId, participants]
  );
  const role: "gm" | "player" | "admin" = currentParticipant?.role ?? "player";
  const canManageSession = role === "gm" || role === "admin";
  const isRoomAdmin =
    currentParticipant?.id != null && room?.createdByParticipantId === currentParticipant.id;
  const canKick = role === "admin" || isRoomAdmin;
  const canRenameRoom = role === "admin" || isRoomAdmin;
  const textChannels = useMemo(() => channels.filter((channel) => channel.type === "text"), [channels]);
  const voiceChannels = useMemo(() => channels.filter((channel) => channel.type === "voice"), [channels]);
  const diceChannels = useMemo(() => channels.filter((channel) => channel.type === "dice"), [channels]);
  const selectedChannel = useMemo(
    () => channels.find((channel) => channel.id === selectedChannelId) ?? channels[0] ?? null,
    [channels, selectedChannelId]
  );
  const selectedTextChannelId = selectedChannel?.type === "text" ? selectedChannel.id : null;
  const activeVoiceChannel = useMemo(() => {
    if (selectedChannel?.type === "voice") return selectedChannel;
    return voiceChannels[0] ?? null;
  }, [selectedChannel, voiceChannels]);
  const joinedVoiceSlug = currentParticipant?.callChannelSlug ?? null;
  const joinedInSelectedVoice =
    !!callJoined && !!activeVoiceChannel && joinedVoiceSlug === activeVoiceChannel.slug;
  const voiceMembersBySlug = useMemo(() => {
    const now = Date.now();
    const grouped: Record<string, Participant[]> = {};
    participants.forEach((person) => {
      if (!person.inCall || !person.callChannelSlug) return;
      if (person.lastSeen && now - new Date(person.lastSeen).getTime() >= CALL_STALE_MS) return;
      grouped[person.callChannelSlug] = grouped[person.callChannelSlug]
        ? [...grouped[person.callChannelSlug], person]
        : [person];
    });
    return grouped;
  }, [participants]);
  const activeVoiceParticipants = useMemo(() => {
    if (!activeVoiceChannel) return [];
    return voiceMembersBySlug[activeVoiceChannel.slug] ?? [];
  }, [activeVoiceChannel, voiceMembersBySlug]);
  const lastRoll = rolls[0] ?? null;
  const previousRoll = rolls[1] ?? null;

  useEffect(() => {
    if (status !== "authenticated") return;
    if (queryParticipantId) {
      setStoredParticipantId(queryParticipantId);
      localStorage.setItem(`aynfrp:room:${roomId}:participant`, queryParticipantId);
      const nextSearch = new URLSearchParams(search.toString());
      nextSearch.delete("pid");
      const nextQuery = nextSearch.toString();
      router.replace(nextQuery ? `/room/${roomId}?${nextQuery}` : `/room/${roomId}`);
    }
  }, [roomId, queryParticipantId, router, search, status]);

  useEffect(() => {
    if (!currentParticipant) return;
    localStorage.setItem(`aynfrp:room:${roomId}:role`, currentParticipant.role);
  }, [currentParticipant, roomId]);

  useEffect(() => {
    if (!currentParticipant) return;
    if (typeof window === "undefined") return;
    const confirmed = localStorage.getItem(`aynfrp:room:${roomId}:nameConfirmed`);
    if (!confirmed) {
      setRenameInput(currentParticipant.name);
      setWelcomePromptOpen(true);
    }
  }, [currentParticipant, roomId]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const nextStoredEntries = Object.entries(participantVolumes).filter(
      ([, value]) => Math.abs(clampParticipantVolume(value) - 1) > 0.001
    );

    if (nextStoredEntries.length === 0) {
      localStorage.removeItem(participantVolumeStorageKey);
      return;
    }

    localStorage.setItem(
      participantVolumeStorageKey,
      JSON.stringify(Object.fromEntries(nextStoredEntries))
    );
  }, [participantVolumeStorageKey, participantVolumes]);

  const dismissRollToast = useCallback((id: string) => {
    const timers = rollToastTimersRef.current.get(id);
    if (timers) {
      window.clearTimeout(timers.exit);
      window.clearTimeout(timers.remove);
      rollToastTimersRef.current.delete(id);
    }
    setExitingRollToastIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setRollToasts((prev) => prev.filter((roll) => roll.id !== id));
  }, []);

  const pushRollToast = useCallback((roll: Roll) => {
    setRollToasts((prev) => {
      if (prev.some((existing) => existing.id === roll.id)) return prev;
      return [roll, ...prev].slice(0, 6);
    });
    const existing = rollToastTimersRef.current.get(roll.id);
    if (existing) {
      window.clearTimeout(existing.exit);
      window.clearTimeout(existing.remove);
    }
    const exit = window.setTimeout(() => {
      setExitingRollToastIds((prev) => {
        const next = new Set(prev);
        next.add(roll.id);
        return next;
      });
    }, 5000);
    const remove = window.setTimeout(() => {
      setRollToasts((prev) => prev.filter((r) => r.id !== roll.id));
      setExitingRollToastIds((prev) => {
        if (!prev.has(roll.id)) return prev;
        const next = new Set(prev);
        next.delete(roll.id);
        return next;
      });
      rollToastTimersRef.current.delete(roll.id);
    }, 5000 + 280);
    rollToastTimersRef.current.set(roll.id, { exit, remove });
  }, []);

  useEffect(() => {
    rollCursorRef.current = new Date().toISOString();
    rollsInitializedRef.current = false;
    rollToastTimersRef.current.forEach(({ exit, remove }) => {
      window.clearTimeout(exit);
      window.clearTimeout(remove);
    });
    rollToastTimersRef.current.clear();
    setRollToasts([]);
    setExitingRollToastIds(new Set());
  }, [roomId]);

  useEffect(() => {
    const timersMap = rollToastTimersRef.current;
    return () => {
      timersMap.forEach(({ exit, remove }) => {
        window.clearTimeout(exit);
        window.clearTimeout(remove);
      });
      timersMap.clear();
    };
  }, []);

  useEffect(() => {
    if (status !== "unauthenticated") return;
    const inviteParam = search.get("invite");
    if (inviteParam) {
      // Land back on the room page after login so we can prompt for display name here.
      const callbackUrl = `/room/${roomId}?invite=${encodeURIComponent(inviteParam)}`;
      void signIn("google", { callbackUrl });
      return;
    }
    router.replace("/join");
  }, [status, router, search, roomId]);

  useEffect(() => {
    if (status !== "authenticated") return;
    let interval: NodeJS.Timeout | null = null;

    async function loadRoom() {
      const res = await fetch(`/api/rooms/${roomId}`);
      const payload = await parseApiResponse<NonNullable<typeof room>>(res);
      if (payload.error || !payload.data) {
        setError(payload.error?.message ?? "Room not found");
        return;
      }
      setRoom(payload.data);
      if (payload.data.backgroundMusicUrl) {
        setMusicUrl(payload.data.backgroundMusicUrl);
      }
    }

    async function loadParticipants() {
      const res = await fetch(`/api/rooms/${roomId}/participants`);
      const payload = await parseApiResponse<{
        participants: Participant[];
        sessionState: "waiting" | "active" | "ended";
      }>(res);
      if (payload.data) {
        if (participantId && !payload.data.participants.some((p) => p.id === participantId)) {
          localStorage.removeItem(`aynfrp:room:${roomId}:participant`);
          localStorage.removeItem(`aynfrp:room:${roomId}:role`);
          setStoredParticipantId(null);
          const inviteParam = search.get("invite");
          if (inviteParam) {
            setParticipants(payload.data.participants);
            setRoom((prev) => (prev ? { ...prev, sessionState: payload.data!.sessionState } : prev));
            return;
          }
          router.replace("/join");
          return;
        }
        setParticipants(payload.data.participants);
        setRoom((prev) => (prev ? { ...prev, sessionState: payload.data!.sessionState } : prev));
      }
    }

    async function loadRolls() {
      const res = await fetch(`/api/rooms/${roomId}/rolls`);
      const payload = await parseApiResponse<{ cursor: string; rolls: Roll[] }>(res);
      if (payload.data) {
        setRolls(payload.data.rolls);
        rollCursorRef.current = payload.data.cursor;
        rollsInitializedRef.current = true;
      }
    }

    async function loadChannels() {
      const res = await fetch(`/api/rooms/${roomId}/channels`);
      const payload = await parseApiResponse<{ channels: Channel[] }>(res);
      if (payload.error || !payload.data) {
        setChannelsError(payload.error?.message ?? "Could not load channels");
        return;
      }
      const nextChannels = payload.data.channels;
      setChannels(nextChannels);
      setSelectedChannelId((prev) => {
        if (prev) return prev;
        const firstText = nextChannels.find((channel) => channel.type === "text");
        const firstVoice = nextChannels.find((channel) => channel.type === "voice");
        return firstText?.id ?? firstVoice?.id ?? null;
      });
    }

    async function loadInitiative() {
      const res = await fetch(`/api/rooms/${roomId}/initiative`);
      const payload = await parseApiResponse<{
        entries: InitiativeEntry[];
        currentTurnEntryId: string | null;
        turnCount: number;
        roundCount: number;
      }>(res);
      if (payload.data) {
        setInitiativeEntries(payload.data.entries);
        setInitiativeState({
          currentTurnEntryId: payload.data.currentTurnEntryId ?? null,
          turnCount: payload.data.turnCount ?? 0,
          roundCount: payload.data.roundCount ?? 0,
        });
      }
    }
    void loadInitiative();

    loadRoom();
    loadParticipants();
    loadRolls();
    loadChannels();

    interval = setInterval(async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      loadParticipants();
      const roomRes = await fetch(`/api/rooms/${roomId}`);
      const roomPayload = await parseApiResponse<{
        id: string;
        name: string;
        inviteCode: string;
        sessionState: string;
        gmId: string | null;
        createdByParticipantId: string | null;
        recap: string | null;
        backgroundMusicUrl: string | null;
      }>(roomRes);
      if (roomPayload.data) {
        const d = roomPayload.data;
        setRoom((prev) =>
          prev
            ? {
                ...prev,
                name: d.name,
                inviteCode: d.inviteCode,
                sessionState: d.sessionState as "waiting" | "active" | "ended",
                gmId: d.gmId,
                createdByParticipantId: d.createdByParticipantId,
                recap: d.recap,
                backgroundMusicUrl: d.backgroundMusicUrl,
              }
            : prev
        );
        if (d.backgroundMusicUrl) setMusicUrl(d.backgroundMusicUrl);
      }
      const initRes = await fetch(`/api/rooms/${roomId}/initiative`);
      const initPayload = await parseApiResponse<{
        entries: InitiativeEntry[];
        currentTurnEntryId: string | null;
        turnCount: number;
        roundCount: number;
      }>(initRes);
      if (initPayload.data) {
        setInitiativeEntries(initPayload.data.entries);
        setInitiativeState({
          currentTurnEntryId: initPayload.data.currentTurnEntryId ?? null,
          turnCount: initPayload.data.turnCount ?? 0,
          roundCount: initPayload.data.roundCount ?? 0,
        });
      }
      if (participantId) {
        fetch(`/api/rooms/${roomId}/ping`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ participantId }),
        }).catch(() => null);
      }
    }, 5000);

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [roomId, participantId, status]);

  useEffect(() => {
    let stopped = false;

    async function pollRollUpdates() {
      if (!rollsInitializedRef.current) return;

      try {
        const res = await fetch(
          `/api/rooms/${roomId}/rolls?since=${encodeURIComponent(rollCursorRef.current)}`
        );
        const payload = (await res.json()) as ApiResponse<{ cursor: string; rolls: Roll[] }>;
        if (stopped || payload.error || !payload.data) return;

        rollCursorRef.current = payload.data.cursor;
        if (payload.data.rolls.length === 0) return;

        const incomingRolls = payload.data.rolls;
        setRolls((prev) => {
          const seen = new Set(prev.map((roll) => roll.id));
          const freshRolls = incomingRolls.filter((roll) => !seen.has(roll.id)).reverse();
          if (freshRolls.length === 0) return prev;
          return [...freshRolls, ...prev].slice(0, 50);
        });

        const externalRolls = incomingRolls.filter((roll) => roll.participantId !== participantId);
        if (externalRolls.length > 0) {
          for (const roll of [...externalRolls].reverse()) {
            pushRollToast(roll);
          }
        }
      } catch {
        return;
      }
    }

    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void pollRollUpdates();
    }, 1000);

    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [participantId, roomId, pushRollToast]);

  useEffect(() => {
    if (!selectedTextChannelId) return;
    fetch(`/api/rooms/${roomId}/chat/messages?channelId=${selectedTextChannelId}`)
      .then((res) => res.json())
      .then((payload: ApiResponse<{ messages: ChatMessage[] }>) => {
        if (payload.error || !payload.data) {
          setChatError(payload.error?.message ?? "Could not load chat");
          return;
        }
        setChatError(null);
        setChatMessages(payload.data.messages);
        const latest = payload.data.messages[payload.data.messages.length - 1]?.createdAt;
        if (latest && latest > chatCursorRef.current) {
          chatCursorRef.current = latest;
        }
        shouldStickToBottomRef.current = true;
      });
  }, [roomId, selectedTextChannelId]);

  useEffect(() => {
    clearSelectedChatImage();
  }, [selectedTextChannelId]);

  useEffect(() => {
    if (!participantId) return;

    let stopped = false;
    async function pollUpdates() {
      try {
        const res = await fetch(
          `/api/rooms/${roomId}/chat/updates?since=${encodeURIComponent(chatCursorRef.current)}`
        );
        const payload = (await res.json()) as ApiResponse<{ cursor: string; messages: ChatMessage[] }>;
        if (stopped || payload.error || !payload.data) return;
        chatCursorRef.current = payload.data.cursor;
        if (payload.data.messages.length === 0) return;

        const knownChannelIds = new Set(channels.map((c) => c.id));
        const hasUnknownChannel = payload.data.messages.some((m) => !knownChannelIds.has(m.channelId));
        if (hasUnknownChannel) {
          fetch(`/api/rooms/${roomId}/channels`)
            .then((r) => r.json())
            .then((p: ApiResponse<{ channels: Channel[] }>) => {
              if (!stopped && p.data) setChannels(p.data.channels);
            })
            .catch(() => null);
        }

        if (selectedTextChannelId) {
          const selectedNew = payload.data.messages.filter(
            (message) => message.channelId === selectedTextChannelId
          );
          if (selectedNew.length > 0) {
            setChatMessages((prev) => {
              const seen = new Set(prev.map((message) => message.id));
              const merged = [...prev];
              selectedNew.forEach((message) => {
                if (!seen.has(message.id)) merged.push(message);
              });
              return merged.slice(-200);
            });
          }
        }

        const unreadDeltas: Record<string, number> = {};
        payload.data.messages.forEach((message) => {
          if (message.channelId === selectedTextChannelId) return;
          unreadDeltas[message.channelId] = (unreadDeltas[message.channelId] ?? 0) + 1;
        });
        if (Object.keys(unreadDeltas).length > 0) {
          setUnreadByChannel((prev) => {
            const next = { ...prev };
            Object.entries(unreadDeltas).forEach(([channelId, count]) => {
              next[channelId] = (next[channelId] ?? 0) + count;
            });
            return next;
          });
        }
      } catch {
        return;
      }
    }

    void pollUpdates();
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void pollUpdates();
    }, 1000);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [participantId, roomId, selectedTextChannelId, channels]);

  useEffect(() => {
    if (!selectedTextChannelId) return;
    setUnreadByChannel((prev) => {
      if (!prev[selectedTextChannelId]) return prev;
      return { ...prev, [selectedTextChannelId]: 0 };
    });
  }, [selectedTextChannelId]);

  useEffect(() => {
    if (!selectedTextChannelId) return;
    if (!shouldStickToBottomRef.current) return;
    const element = chatContainerRef.current;
    if (!element) return;
    requestAnimationFrame(() => {
      element.scrollTop = element.scrollHeight;
    });
  }, [chatMessages, selectedTextChannelId]);

  useEffect(() => {
    if (callJoined && selectedChannel?.type !== "voice") {
      setFloatVideos(true);
      setFloatingVideoMinimized(false);
    }
  }, [callJoined, selectedChannel?.type]);

  async function joinViaInvite() {
    setError(null);
    const invite = search.get("invite");
    if (!invite) return;
    if (!displayName.trim()) {
      setError("Enter a display name to join");
      return;
    }

    const res = await fetch("/api/rooms/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteCode: invite, displayName: displayName.trim() }),
    });
    const payload = (await res.json()) as ApiResponse<{
      roomId: string;
      participant: { id: string; role: "gm" | "player" | "admin" };
    }>;
    if (payload.error || !payload.data) {
      setError(payload.error?.message ?? "Unable to join");
      return;
    }
    setStoredParticipantId(payload.data.participant.id);
    localStorage.setItem("aynfrp:lastName", displayName.trim());
    localStorage.setItem(`aynfrp:room:${roomId}:participant`, payload.data.participant.id);
    localStorage.setItem(`aynfrp:room:${roomId}:role`, payload.data.participant.role);
    window.history.replaceState({}, "", `/room/${roomId}`);
  }

  async function startSession() {
    if (!participantId) return;
    await fetch(`/api/rooms/${roomId}/session/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId }),
    });
  }

  async function endSession() {
    if (!participantId) return;
    await fetch(`/api/rooms/${roomId}/session/end`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId }),
    });
  }

  const ROLL_TENSION_MS = 1200;
  const REVEAL_DISPLAY_MS = 1800;

  async function rollDice(expressionOverride?: string, rollNameOverride?: string) {
    setDiceError(null);
    if (!participantId) return;
    const rawExpr = (expressionOverride ?? diceExpression).trim() || "d20";

    // Iterative syntax: "NrrEXPR" rolls EXPR N times sequentially. e.g. "2rr2d20"
    const iterMatch = /^(\d+)\s*rr\s*(.+)$/i.exec(rawExpr);
    let iterations = 1;
    let expr = rawExpr;
    if (iterMatch) {
      iterations = parseInt(iterMatch[1] ?? "1", 10);
      expr = (iterMatch[2] ?? "").trim();
      if (!Number.isFinite(iterations) || iterations <= 0) {
        setDiceError("Iteration count must be a positive number");
        return;
      }
      if (iterations > 20) {
        setDiceError("Max 20 iterations allowed");
        return;
      }
      if (!expr) {
        setDiceError("Missing dice expression after 'rr'");
        return;
      }
    }

    setRollingDice(true);
    try {
      for (let i = 0; i < iterations; i += 1) {
        setRollOverlay({ phase: "rolling", expression: expr });
        const res = await fetch(`/api/rooms/${roomId}/roll`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            participantId,
            expression: expr,
            rollName: rollNameOverride || undefined,
          }),
        });
        const payload = (await res.json()) as ApiResponse<{ roll: Roll }>;
        if (payload.error) {
          setRollOverlay(null);
          setDiceError(payload.error.message);
          setRollingDice(false);
          return;
        }
        if (!payload.data?.roll) {
          setRollOverlay(null);
          setRollingDice(false);
          return;
        }
        const newRoll = payload.data.roll;
        await new Promise((r) => setTimeout(r, ROLL_TENSION_MS));
        setRollOverlay({
          phase: "reveal",
          data: {
            expression: newRoll.expression ?? "",
            total: newRoll.total,
            results: newRoll.results,
            participantName: newRoll.participantName,
            rollName: newRoll.rollName ?? null,
          },
        });
        await new Promise((r) => setTimeout(r, REVEAL_DISPLAY_MS));
        setRolls((prev) => [newRoll, ...prev.filter((roll) => roll.id !== newRoll.id)].slice(0, 50));
        pushRollToast(newRoll);
      }
      setRollOverlay(null);
      setRollingDice(false);
    } catch {
      setRollOverlay(null);
      setRollingDice(false);
    }
  }

  function saveNamedRoll(name: string) {
    const trimmed = name.trim().toLowerCase().replace(/\s+/g, "-");
    if (!trimmed) return;
    const next = { ...namedRolls, [trimmed]: diceExpression.trim() || "d20" };
    setNamedRolls(next);
    localStorage.setItem("aynfrp:namedRolls", JSON.stringify(next));
    setNamedRollInput(null);
  }

  function removeNamedRoll(name: string) {
    const next = { ...namedRolls };
    delete next[name];
    setNamedRolls(next);
    localStorage.setItem("aynfrp:namedRolls", JSON.stringify(next));
  }

  async function clearRollLog() {
    if (!participantId) return;
    const res = await fetch(`/api/rooms/${roomId}/rolls/clear`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId }),
    });
    if (res.ok) setRolls([]);
  }

  async function startInitiative() {
    if (!participantId) return;
    setInitiativeError(null);
    const res = await fetch(`/api/rooms/${roomId}/initiative`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId, action: "start" }),
    });
    const payload = (await res.json()) as ApiResponse<{ started?: boolean }>;
    if (payload.error) {
      setInitiativeError(payload.error.message);
    } else {
      setInitiativeEntries([]);
      setInitiativeState({ currentTurnEntryId: null, turnCount: 0, roundCount: 0 });
    }
  }

  async function removeInitiativeEntry(entryId: string) {
    if (!participantId) return;
    setInitiativeError(null);
    const res = await fetch(`/api/rooms/${roomId}/initiative`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId, action: "remove", entryId }),
    });
    const payload = (await res.json()) as ApiResponse<{ removed?: boolean }>;
    if (payload.error) {
      setInitiativeError(payload.error.message);
    } else {
      void (async () => {
        const initRes = await fetch(`/api/rooms/${roomId}/initiative`);
        const initPayload = (await initRes.json()) as ApiResponse<{
          entries: InitiativeEntry[];
          currentTurnEntryId: string | null;
          turnCount: number;
          roundCount: number;
        }>;
        if (initPayload.data) {
          setInitiativeEntries(initPayload.data.entries);
          setInitiativeState({
            currentTurnEntryId: initPayload.data.currentTurnEntryId ?? null,
            turnCount: initPayload.data.turnCount ?? 0,
            roundCount: initPayload.data.roundCount ?? 0,
          });
        }
      })();
    }
  }

  async function toggleInitiativeAlive(entryId: string) {
    if (!participantId) return;
    setInitiativeError(null);
    const res = await fetch(`/api/rooms/${roomId}/initiative`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId, action: "toggleAlive", entryId }),
    });
    const payload = (await res.json()) as ApiResponse<{ isAlive?: boolean }>;
    if (payload.error) {
      setInitiativeError(payload.error.message);
    } else {
      setInitiativeEntries((prev) =>
        prev.map((e) =>
          e.id === entryId ? { ...e, isAlive: payload.data?.isAlive ?? !e.isAlive } : e
        )
      );
    }
  }

  async function nextTurn() {
    if (!participantId) return;
    setInitiativeError(null);
    const res = await fetch(`/api/rooms/${roomId}/initiative`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId, action: "nextTurn" }),
    });
    const payload = (await res.json()) as ApiResponse<{
      currentTurnEntryId?: string;
      turnCount?: number;
      roundCount?: number;
    }>;
    if (payload.error) {
      setInitiativeError(payload.error.message);
    } else if (payload.data) {
      setInitiativeState({
        currentTurnEntryId: payload.data.currentTurnEntryId ?? null,
        turnCount: payload.data.turnCount ?? 0,
        roundCount: payload.data.roundCount ?? 0,
      });
    }
  }

  async function setInitiativeTurnCount(count: number) {
    if (!participantId) return;
    setInitiativeError(null);
    const res = await fetch(`/api/rooms/${roomId}/initiative`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId, action: "setTurnCount", turnCount: count }),
    });
    const payload = (await res.json()) as ApiResponse<{ turnCount?: number; roundCount?: number }>;
    if (payload.error) {
      setInitiativeError(payload.error.message);
    } else if (payload.data) {
      const { turnCount: newCount, roundCount: newRound } = payload.data;
      setInitiativeState((prev) => ({
        ...prev,
        ...(typeof newCount === "number" && { turnCount: newCount }),
        ...(typeof newRound === "number" && { roundCount: newRound }),
      }));
    }
  }

  async function addInitiativeEntry(isCreature: boolean, expr?: string, creatureName?: string) {
    if (!participantId) return;
    setInitiativeError(null);
    const rawExpression = (expr ?? initiativeExpression).trim() || "d20";

    // Iterative syntax: "NrrEXPR" adds N initiative entries each rolling EXPR.
    // Useful for quickly rolling initiative for a batch of identical creatures.
    const iterMatch = /^(\d+)\s*rr\s*(.+)$/i.exec(rawExpression);
    let iterations = 1;
    let expression = rawExpression;
    if (iterMatch) {
      iterations = parseInt(iterMatch[1] ?? "1", 10);
      expression = (iterMatch[2] ?? "").trim();
      if (!Number.isFinite(iterations) || iterations <= 0) {
        setInitiativeError("Iteration count must be a positive number");
        return;
      }
      if (iterations > 20) {
        setInitiativeError("Max 20 iterations allowed");
        return;
      }
      if (!expression) {
        setInitiativeError("Missing dice expression after 'rr'");
        return;
      }
    }

    setInitiativeAdding(true);
    try {
      for (let i = 0; i < iterations; i += 1) {
        setRollOverlay({ phase: "rolling", expression });
        const body: Record<string, unknown> = {
          participantId,
          action: "add",
          expression,
        };
        if (isCreature && creatureName?.trim()) {
          // When iterating creatures, append a counter so entries remain distinct.
          body.creatureName =
            iterations > 1
              ? `${creatureName.trim()} ${i + 1}`
              : creatureName.trim();
        } else if (!isCreature) {
          body.targetParticipantId = participantId;
        }
        const res = await fetch(`/api/rooms/${roomId}/initiative`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = (await res.json()) as ApiResponse<{
          entry: InitiativeEntry & { results?: number[] };
        }>;
        if (payload.error) {
          setRollOverlay(null);
          setInitiativeError(payload.error.message);
          setInitiativeAdding(false);
          return;
        }
        if (!payload.data?.entry) {
          setRollOverlay(null);
          setInitiativeAdding(false);
          return;
        }
        const entry = payload.data.entry;
        const results = entry.results ?? [entry.result];
        await new Promise((r) => setTimeout(r, ROLL_TENSION_MS));
        setRollOverlay({
          phase: "reveal",
          data: {
            expression: entry.expression,
            total: entry.result,
            results,
            participantName: entry.creatureName ?? entry.participantName ?? "—",
          },
        });
        await new Promise((r) => setTimeout(r, REVEAL_DISPLAY_MS));
      }
      setInitiativeCreatureName("");
      const initRes = await fetch(`/api/rooms/${roomId}/initiative`);
      const initPayload = (await initRes.json()) as ApiResponse<{ entries: InitiativeEntry[] }>;
      if (initPayload.data) setInitiativeEntries(initPayload.data.entries);
      setRollOverlay(null);
      setInitiativeAdding(false);
    } catch {
      setRollOverlay(null);
      setInitiativeAdding(false);
    }
  }

  async function setBackgroundMusic(urlOverride?: string) {
    if (!participantId) return;
    setMusicError(null);
    const url = urlOverride ?? musicUrl;
    const res = await fetch(`/api/rooms/${roomId}/music`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId, url }),
    });
    const payload = (await res.json()) as ApiResponse<{ url: string | null }>;
    if (payload.error) {
      setMusicError(payload.error.message);
    } else if (payload.data) {
      setRoom((prev) => (prev ? { ...prev, backgroundMusicUrl: payload.data!.url } : prev));
    }
  }

  async function leaveRoom() {
    if (!participantId) return;
    await fetch(`/api/rooms/${roomId}/leave`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId }),
    });
    router.replace("/join");
  }

  async function kickParticipant(targetId: string) {
    if (!participantId) return;
    const res = await fetch(`/api/rooms/${roomId}/kick`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId, targetParticipantId: targetId }),
    });
    if (res.ok) void refreshParticipants();
  }

  async function renameSelf(nextName: string): Promise<boolean> {
    setRenameError(null);
    if (!participantId) return false;
    const trimmed = nextName.trim();
    if (!trimmed) {
      setRenameError("Enter a name");
      return false;
    }
    if (trimmed.length > 40) {
      setRenameError("Use 40 characters or fewer");
      return false;
    }
    setRenameSaving(true);
    try {
      const res = await fetch(`/api/rooms/${roomId}/participants`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId, displayName: trimmed }),
      });
      const payload = (await res.json()) as ApiResponse<{
        participant: { id: string; name: string };
      }>;
      if (payload.error || !payload.data) {
        setRenameError(payload.error?.message ?? "Unable to update name");
        return false;
      }
      localStorage.setItem("aynfrp:lastName", trimmed);
      localStorage.setItem(`aynfrp:room:${roomId}:nameConfirmed`, "1");
      setParticipants((prev) =>
        prev.map((p) =>
          p.id === payload.data!.participant.id ? { ...p, name: payload.data!.participant.name } : p
        )
      );
      setDisplayName(trimmed);
      return true;
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : "Unable to update name");
      return false;
    } finally {
      setRenameSaving(false);
    }
  }

  async function refreshParticipants() {
    const res = await fetch(`/api/rooms/${roomId}/participants`);
    const payload = (await res.json()) as ApiResponse<{
      participants: Participant[];
      sessionState: "waiting" | "active" | "ended";
    }>;
    if (payload.data) {
      setParticipants(payload.data.participants);
      setRoom((prev) => (prev ? { ...prev, sessionState: payload.data!.sessionState } : prev));
    }
  }

  async function refreshRoom() {
    const res = await fetch(`/api/rooms/${roomId}`);
    const payload = (await res.json()) as ApiResponse<typeof room>;
    if (payload.data) {
      setRoom(payload.data);
    }
  }

  async function saveRoomName() {
    if (!participantId) return;
    const trimmed = roomRenameInput.trim();
    if (!trimmed) {
      setRoomRenameError("Enter a room name");
      return;
    }
    if (trimmed.length > 120) {
      setRoomRenameError("Use 120 characters or fewer");
      return;
    }
    if (trimmed === room?.name) {
      setRoomRenameEditing(false);
      setRoomRenameError(null);
      return;
    }
    setRoomRenameSaving(true);
    setRoomRenameError(null);
    try {
      const res = await fetch(`/api/rooms/${roomId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId, name: trimmed }),
      });
      const payload = (await res.json()) as ApiResponse<{ id: string; name: string }>;
      if (payload.error) {
        setRoomRenameError(payload.error.message);
        return;
      }
      if (payload.data) {
        setRoom((prev) => (prev ? { ...prev, name: payload.data!.name } : prev));
      }
      setRoomRenameEditing(false);
    } catch (err) {
      setRoomRenameError(err instanceof Error ? err.message : "Unable to update name");
    } finally {
      setRoomRenameSaving(false);
    }
  }

  async function assignGm(targetParticipantId: string) {
    setGmAssignError(null);
    if (!participantId) return;
    const res = await fetch(`/api/rooms/${roomId}/gm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId, gmParticipantId: targetParticipantId }),
    });
    const payload = (await res.json()) as ApiResponse<{ gmId: string }>;
    if (payload.error) {
      setGmAssignError(payload.error.message);
    } else {
      void refreshRoom();
      void refreshParticipants();
    }
  }

  async function updateCallState(updates: {
    inCall?: boolean;
    micOn?: boolean;
    camOn?: boolean;
    channelSlug?: string | null;
  }) {
    if (!participantId) return;
    await fetch(`/api/rooms/${roomId}/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId, ...updates }),
    }).catch(() => null);
  }

  async function handleJoinCall() {
    if (!participantId) {
      setCallError("Join the room first before starting the call.");
      return;
    }
    setCallError(null);
    setCallFrameReady(false);
    if (callJoined) {
      isSwitchingVoiceChannelRef.current = true;
    }

    if (!LIVEKIT_URL) {
      setCallError("Video server URL is missing. Set NEXT_PUBLIC_LIVEKIT_URL in env.");
      return;
    }

    try {
      const res = await fetch(`/api/rooms/${roomId}/video-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId, channelSlug: activeVoiceChannel?.slug }),
      });
      const payload = (await res.json()) as ApiResponse<{ token: string }>;
      if (payload.error || !payload.data) {
        setCallError(payload.error?.message ?? "Could not start call");
        return;
      }

      setCallToken(payload.data.token);
      setCallJoined(true);
      await updateCallState({
        inCall: true,
        micOn: true,
        camOn: true,
        channelSlug: activeVoiceChannel?.slug ?? null,
      });
    } catch {
      setCallError("Could not connect to video room. Check your connection and try again.");
    }
  }

  async function handleQuitCall() {
    setCallError(null);
    setCallJoined(false);
    setCallFrameReady(false);
    setCallToken(null);
    await updateCallState({ inCall: false, micOn: false, camOn: false, channelSlug: null });
  }

  function updateParticipantVolume(targetParticipantId: string, nextPercent: number) {
    const nextVolume = clampParticipantVolume(nextPercent / 100);

    setParticipantVolumes((prev) => {
      if (Math.abs(nextVolume - 1) <= 0.001) {
        if (!(targetParticipantId in prev)) return prev;
        const nextVolumes = { ...prev };
        delete nextVolumes[targetParticipantId];
        return nextVolumes;
      }

      return { ...prev, [targetParticipantId]: nextVolume };
    });
  }

  function clearSelectedChatImage() {
    setChatImagePreview(null);
    setChatImageName(null);
    if (chatImageInputRef.current) {
      chatImageInputRef.current.value = "";
    }
  }

  async function processChatImageFile(file: File): Promise<boolean> {
    setChatError(null);
    if (!isChatImageTypeSupported(file.type)) {
      setChatError("Please choose a PNG, JPG, GIF or WebP image.");
      return false;
    }
    if (file.size > CHAT_IMAGE_MAX_BYTES) {
      setChatError("Images must be 2 MB or smaller.");
      return false;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      if (dataUrl.length > CHAT_IMAGE_MAX_DATA_URL_LENGTH) {
        setChatError("Image is too large to send.");
        return false;
      }
      setChatImagePreview(dataUrl);
      setChatImageName(file.name || "pasted-image");
      return true;
    } catch {
      setChatError("Could not load the selected image.");
      return false;
    }
  }

  async function handleChatImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const ok = await processChatImageFile(file);
    if (!ok) event.target.value = "";
  }

  async function handleChatPaste(event: ClipboardEvent<HTMLInputElement>) {
    const items = event.clipboardData?.items;
    if (!items || items.length === 0) return;

    for (const item of Array.from(items)) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (!file) continue;
      if (!isChatImageTypeSupported(file.type)) continue;
      event.preventDefault();
      await processChatImageFile(file);
      return;
    }
  }

  async function sendChatMessage() {
    setChatError(null);
    if (!participantId || selectedChannel?.type !== "text" || chatSending) return;

    const trimmedContent = chatInput.trim();
    if (!trimmedContent && !chatImagePreview) return;

    setChatSending(true);
    try {
      const res = await fetch(`/api/rooms/${roomId}/chat/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId: selectedChannel.id,
          participantId,
          content: trimmedContent,
          imageDataUrl: chatImagePreview,
        }),
      });
      const payload = (await res.json()) as ApiResponse<{ message: ChatMessage }>;
      if (payload.error || !payload.data) {
        setChatError(payload.error?.message ?? "Could not send message");
        return;
      }
      setChatInput("");
      clearSelectedChatImage();
      setChatMessages((prev) => {
        const exists = prev.some((msg) => msg.id === payload.data!.message.id);
        return exists ? prev : [...prev, payload.data!.message].slice(-200);
      });
    } catch {
      setChatError("Could not send message");
    } finally {
      setChatSending(false);
    }
  }

  async function createChannel() {
    setChannelCreateError(null);
    if (!participantId) {
      setChannelCreateError("Join room first to create channels.");
      return;
    }
    if (!channelCreateName.trim()) {
      setChannelCreateError("Please enter a channel name.");
      return;
    }
    setChannelCreating(true);
    try {
      const res = await fetch(`/api/rooms/${roomId}/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantId,
          type: channelCreateType,
          name: channelCreateName.trim(),
        }),
      });
      const payload = (await res.json()) as ApiResponse<{ channel: Channel }>;
      if (payload.error || !payload.data) {
        setChannelCreateError(payload.error?.message ?? "Could not create channel");
        return;
      }
      setChannels((prev) =>
        [...prev, payload.data!.channel].sort((a, b) => {
          if (a.type !== b.type) {
            const order = { text: 0, dice: 1, voice: 2 };
            return (order[a.type] ?? 3) - (order[b.type] ?? 3);
          }
          return a.name.localeCompare(b.name);
        })
      );
      setSelectedChannelId(payload.data.channel.id);
      setChannelCreateName("");
      setChannelCreateOpen(false);
    } finally {
      setChannelCreating(false);
    }
  }

  function buildInviteLink() {
    const code = room?.inviteCode ?? "";
    const path = `/room/${roomId}?invite=${code}`;
    if (typeof window === "undefined") return path;
    return `${window.location.origin}${path}`;
  }

  async function copyToClipboard(text: string): Promise<boolean> {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // fall through to legacy approach
    }
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  }

  async function handleCopyInviteCode() {
    setInviteCopyError(null);
    const copied = await copyToClipboard(room?.inviteCode ?? "");
    if (copied) {
      setInviteCopied("code");
      setTimeout(() => setInviteCopied((prev) => (prev === "code" ? null : prev)), 1800);
    } else {
      setInviteCopyError("Could not copy automatically. Please copy the code manually.");
    }
    setInviteMenuOpen(false);
  }

  async function handleCopyInviteLink() {
    setInviteCopyError(null);
    const copied = await copyToClipboard(buildInviteLink());
    if (copied) {
      setInviteCopied("link");
      setTimeout(() => setInviteCopied((prev) => (prev === "link" ? null : prev)), 1800);
    } else {
      setInviteCopyError("Could not copy automatically. Please copy the link manually.");
    }
    setInviteMenuOpen(false);
  }

  useEffect(() => {
    const leavePayload = JSON.stringify({
      participantId,
      inCall: false,
      micOn: false,
      camOn: false,
      channelSlug: null,
    });

    const handleBeforeUnload = () => {
      if (!participantId) return;
      const url = `/api/rooms/${roomId}/call`;
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([leavePayload], { type: "application/json" }));
      } else {
        void fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: leavePayload,
          keepalive: true,
        }).catch(() => null);
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      if (!participantId) return;
      void fetch(`/api/rooms/${roomId}/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: leavePayload,
      }).catch(() => null);
    };
  }, [participantId, roomId]);

  const invitePrompt = useMemo(() => search.get("invite"), [search]);

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-zinc-50 p-6 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Checking sign-in status...</p>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <div className="min-h-screen bg-zinc-50 p-6 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Redirecting to sign-in...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-zinc-50 p-6 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        <Link className="mt-4 inline-flex text-sm text-zinc-600 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300" href="/join">
          Back to join
        </Link>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="min-h-screen bg-zinc-50 p-6 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Loading room...</p>
      </div>
    );
  }

  if (invitePrompt && !participantId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-6 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
            Invite
          </span>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">
            Join {room.name}
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Pick the display name others will see in this room. You can change it later from
            the Participants panel.
          </p>
          <form
            className="mt-5 flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void joinViaInvite();
            }}
          >
            <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Display name
              <input
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                placeholder="Your name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                maxLength={40}
                autoFocus
              />
            </label>
            {error ? (
              <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>
            ) : null}
            <button
              type="submit"
              className="inline-flex h-10 items-center justify-center rounded-full bg-zinc-900 px-4 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
              disabled={!displayName.trim()}
            >
              Join room
            </button>
            <Link
              href="/join"
              className="mt-1 text-center text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              Back to sessions
            </Link>
          </form>
        </div>
      </div>
    );
  }

  return (
    <>
      {rollToasts.length > 0 ? (
        <div className="pointer-events-none fixed right-6 top-20 z-[60] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2">
          {rollToasts.map((toast) => {
            const isExiting = exitingRollToastIds.has(toast.id);
            const sidesList = getTermSides(toast);
            const droppedMask = getDroppedMask(toast);
            return (
              <button
                key={toast.id}
                type="button"
                className={`pointer-events-auto flex w-full flex-col gap-2 rounded-2xl border border-amber-200/80 bg-white/95 px-3.5 py-2.5 text-left shadow-xl ring-1 ring-black/5 backdrop-blur transition hover:border-amber-300 hover:bg-white dark:border-amber-900/60 dark:bg-zinc-950/95 dark:hover:bg-zinc-950 ${
                  isExiting ? "animate-roll-toast-out" : "animate-roll-toast-in"
                }`}
                onClick={() => dismissRollToast(toast.id)}
                title="Kapatmak için tıkla"
                aria-label={`${toast.participantName} ${describeRoll(toast)} = ${toast.total}. Kapatmak için tıkla.`}
              >
                <div className="flex items-center gap-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {toast.participantName}
                    </p>
                    <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                      {describeRoll(toast)}
                    </p>
                  </div>
                  <span className="inline-flex h-9 min-w-[2.5rem] shrink-0 items-center justify-center rounded-xl bg-amber-500/15 px-2 text-lg font-bold tabular-nums text-amber-700 ring-1 ring-inset ring-amber-500/30 dark:bg-amber-400/15 dark:text-amber-300 dark:ring-amber-400/30">
                    {toast.total}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {sidesList.map((sides, i) => (
                    <DieChip
                      key={`${toast.id}-${i}`}
                      sides={sides}
                      value={toast.results[i] ?? 0}
                      size="sm"
                      dropped={droppedMask[i]}
                    />
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      ) : null}
      {welcomePromptOpen && currentParticipant ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          aria-modal
          role="dialog"
          aria-label="Set display name"
        >
          <div className="mx-4 w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Welcome to {room?.name}
            </h2>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
              How should other players see you in this room? You can change this anytime
              from the Participants menu.
            </p>
            <form
              className="mt-4 flex flex-col gap-3"
              onSubmit={async (event) => {
                event.preventDefault();
                const ok = await renameSelf(renameInput);
                if (ok) {
                  setWelcomePromptOpen(false);
                }
              }}
            >
              <label className="flex flex-col gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Display name
                <input
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
                  value={renameInput}
                  onChange={(event) => setRenameInput(event.target.value)}
                  maxLength={40}
                  autoFocus
                />
              </label>
              {renameError ? (
                <p className="text-xs text-rose-600">{renameError}</p>
              ) : null}
              <div className="mt-1 flex items-center justify-end gap-2">
                <button
                  type="button"
                  className="rounded-lg px-3 py-2 text-xs font-semibold text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  onClick={() => {
                    if (typeof window !== "undefined") {
                      localStorage.setItem(`aynfrp:room:${roomId}:nameConfirmed`, "1");
                    }
                    setWelcomePromptOpen(false);
                    setRenameError(null);
                  }}
                >
                  Keep {currentParticipant.name}
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
                  disabled={renameSaving}
                >
                  {renameSaving ? "Saving…" : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
      {rollOverlay ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 animate-roll-overlay-in backdrop-blur-sm"
          aria-modal
          role="dialog"
          aria-label="Dice roll"
        >
          <div className="mx-4 flex min-w-[320px] shrink-0 max-w-md flex-col items-center rounded-2xl border-2 border-amber-200/50 bg-gradient-to-b from-amber-50 to-amber-100/80 px-8 py-10 shadow-2xl">
            {rollOverlay.phase === "rolling" ? (
              <>
                <p className="mb-6 text-lg font-semibold uppercase tracking-widest text-amber-900/80">
                  Rolling…
                </p>
                <div className="flex flex-wrap justify-center gap-3">
                  {parseExpressionSides(rollOverlay.expression).map((sides, i) => (
                    <TumblingDie
                      key={i}
                      sides={sides}
                      finalValue={1}
                      isRevealing={false}
                      palette={DIE_PALETTES.amber}
                    />
                  ))}
                </div>
                <p className="mt-6 text-xs text-amber-800/70">The dice tumble through fate…</p>
              </>
            ) : (
              (() => {
                const { data } = rollOverlay;
                const termSides = parseExpressionSides(data.expression);
                const isNat20 = data.results.some((r, i) => (termSides[i] ?? 20) === 20 && r === 20);
                const isNat1 = data.results.some((r, i) => (termSides[i] ?? 20) === 20 && r === 1);
                const label = data.rollName
                  ? `${data.participantName} · ${data.rollName}`
                  : data.participantName;
                return (
                  <div className="flex flex-col items-center">
                    <div className="flex flex-wrap justify-center gap-2">
                      {termSides.map((sides, i) => (
                        <TumblingDie
                          key={i}
                          sides={sides}
                          finalValue={data.results[i] ?? 0}
                          isRevealing
                          palette={dicePalette(data.results[i] ?? 0, sides)}
                        />
                      ))}
                    </div>
                    <div
                      className={`mt-4 flex flex-col items-center ${
                        isNat20 ? "animate-crit-glow rounded-2xl px-8 py-3" : ""
                      }`}
                    >
                      <span
                        className={`font-bold tabular-nums ${
                          isNat20
                            ? "text-5xl text-amber-600"
                            : isNat1
                              ? "text-5xl text-rose-600 animate-fumble-shake"
                              : "text-5xl text-zinc-800"
                        }`}
                      >
                        {data.total}
                      </span>
                      <p className="mt-2 text-sm font-medium text-amber-800/90">{label}</p>
                    </div>
                    {isNat20 ? (
                      <p className="mt-4 text-lg font-bold text-amber-600">★ Critical! ★</p>
                    ) : isNat1 ? (
                      <p className="mt-4 text-lg font-bold text-rose-600">Crit Fail!!</p>
                    ) : null}
                  </div>
                );
              })()
            )}
          </div>
        </div>
      ) : null}

      <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <nav className="z-40 border-b border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <div className="min-w-0">
              {roomRenameEditing && canRenameRoom ? (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveRoomName();
                  }}
                >
                  <input
                    autoFocus
                    className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-lg font-semibold text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                    value={roomRenameInput}
                    maxLength={120}
                    onChange={(event) => setRoomRenameInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setRoomRenameEditing(false);
                        setRoomRenameError(null);
                      }
                    }}
                    disabled={roomRenameSaving}
                  />
                  <button
                    type="submit"
                    className="rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
                    disabled={roomRenameSaving}
                  >
                    {roomRenameSaving ? "…" : "Save"}
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-zinc-200 px-2.5 py-1 text-xs font-semibold text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    onClick={() => {
                      setRoomRenameEditing(false);
                      setRoomRenameError(null);
                    }}
                    disabled={roomRenameSaving}
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <div className="flex items-center gap-1.5">
                  <h1 className="truncate text-lg font-semibold text-zinc-900 dark:text-zinc-100">{room.name}</h1>
                  {canRenameRoom ? (
                    <button
                      type="button"
                      className="shrink-0 rounded-md p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                      onClick={() => {
                        setRoomRenameInput(room.name);
                        setRoomRenameError(null);
                        setRoomRenameEditing(true);
                      }}
                      title="Rename room"
                      aria-label="Rename room"
                    >
                      <svg
                        className="h-3.5 w-3.5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                      </svg>
                    </button>
                  ) : null}
                </div>
              )}
              {roomRenameError ? (
                <p className="mt-0.5 text-[11px] text-rose-600 dark:text-rose-400">{roomRenameError}</p>
              ) : null}
              <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                <span
                  className={`app-badge ${
                    room.sessionState === "active"
                      ? "app-badge--success"
                      : room.sessionState === "ended"
                        ? "app-badge--warning"
                        : ""
                  }`}
                >
                  {room.sessionState === "active"
                    ? "Live"
                    : room.sessionState === "ended"
                      ? "Ended"
                      : "Waiting"}
                </span>
                {canManageSession ? (
                  room.sessionState !== "active" ? (
                    <button
                      type="button"
                      className="inline-flex h-6 items-center rounded-full border border-zinc-200 px-2.5 text-[11px] font-semibold text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
                      onClick={() => {
                        void startSession().then(() => void refreshRoom());
                      }}
                    >
                      Start session
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="inline-flex h-6 items-center rounded-full border border-zinc-200 px-2.5 text-[11px] font-semibold text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
                      onClick={() => {
                        void endSession().then(() => void refreshRoom());
                      }}
                    >
                      End session
                    </button>
                  )
                ) : null}
              </div>
            </div>
            <div className="group relative shrink-0">
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-sm font-semibold tracking-wider text-zinc-800 transition hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:border-amber-500 dark:hover:bg-amber-950/50 dark:hover:text-amber-300"
                onClick={() => setInviteMenuOpen((prev) => !prev)}
                title="Share invite"
                aria-haspopup="menu"
                aria-expanded={inviteMenuOpen}
              >
                <span>{room.inviteCode}</span>
                <span className={`text-base ${inviteCopied ? "text-emerald-600" : ""}`}>
                  {inviteCopied ? "✓" : "📋"}
                </span>
              </button>
              {!inviteMenuOpen && !inviteCopied ? (
                <span className="pointer-events-none absolute -bottom-8 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded bg-zinc-800 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                  Share invite
                </span>
              ) : null}
              {inviteCopied ? (
                <span className="pointer-events-none absolute -bottom-8 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded bg-emerald-600 px-2 py-1 text-xs text-white">
                  {inviteCopied === "code" ? "Code copied" : "Link copied"}
                </span>
              ) : null}
              {inviteMenuOpen ? (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    aria-hidden
                    onClick={() => setInviteMenuOpen(false)}
                  />
                  <div
                    role="menu"
                    className="absolute left-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-800 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800"
                      onClick={handleCopyInviteCode}
                    >
                      <span aria-hidden>📋</span>
                      <span className="flex-1">Copy invite code</span>
                      <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                        {room.inviteCode}
                      </span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center gap-2 border-t border-zinc-200 px-3 py-2 text-left text-sm text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800"
                      onClick={handleCopyInviteLink}
                    >
                      <span aria-hidden>🔗</span>
                      <span className="flex-1">Copy invite link</span>
                    </button>
                  </div>
                </>
              ) : null}
            </div>
            {inviteCopyError ? <span className="shrink-0 text-xs text-amber-600">{inviteCopyError}</span> : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="relative group">
              <button
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                onClick={() => setParticipantsOpen((o) => !o)}
                title="Participants"
                aria-label="Participants"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </button>
              {!participantsOpen && (
                <span className="pointer-events-none absolute -bottom-8 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded bg-zinc-800 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                  Participants
                </span>
              )}
              {participantsOpen ? (
                <>
                  <div className="fixed inset-0 z-40" aria-hidden onClick={() => setParticipantsOpen(false)} />
                  <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-xl border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold">Participants</h3>
                      <button
                        className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                        onClick={() => void refreshParticipants()}
                        title="Refresh"
                      >
                        ↻
                      </button>
                    </div>
                    {gmAssignError ? <p className="mt-1 text-xs text-amber-600">{gmAssignError}</p> : null}
                    <div className="mt-2 max-h-64 space-y-1.5 overflow-y-auto">
                      {participants.length === 0 ? (
                        <p className="py-2 text-xs text-zinc-500">No participants yet.</p>
                      ) : (
                        participants.map((person) => {
                          const { label: lastSeenLabel, online } = formatLastSeen(person.lastSeen);
                          const isGm = person.id === room.gmId;
                          const isSelf = person.id === participantId;
                          const canAssign = (currentParticipant?.role === "admin" || isRoomAdmin) && !isGm;
                          const editingSelf = isSelf && renameOpen;
                          return (
                            <div key={person.id} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800">
                              <div className="min-w-0 flex-1">
                                {editingSelf ? (
                                  <form
                                    className="flex items-center gap-1"
                                    onSubmit={async (event) => {
                                      event.preventDefault();
                                      const ok = await renameSelf(renameInput);
                                      if (ok) setRenameOpen(false);
                                    }}
                                  >
                                    <input
                                      className="w-full rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
                                      value={renameInput}
                                      onChange={(e) => setRenameInput(e.target.value)}
                                      maxLength={40}
                                      autoFocus
                                    />
                                    <button
                                      type="submit"
                                      className="rounded bg-zinc-900 px-2 py-1 text-[10px] font-semibold text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
                                      disabled={renameSaving}
                                    >
                                      {renameSaving ? "…" : "Save"}
                                    </button>
                                    <button
                                      type="button"
                                      className="rounded px-2 py-1 text-[10px] font-semibold text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                                      onClick={() => {
                                        setRenameOpen(false);
                                        setRenameError(null);
                                      }}
                                    >
                                      Cancel
                                    </button>
                                  </form>
                                ) : (
                                  <>
                                    {isSelf ? (
                                      <button
                                        type="button"
                                        className="inline-flex items-center gap-1 rounded text-sm font-medium hover:underline"
                                        title="Click to rename yourself"
                                        onClick={() => {
                                          setRenameInput(person.name);
                                          setRenameError(null);
                                          setRenameOpen(true);
                                        }}
                                      >
                                        <span>{person.name}</span>
                                        <span className="text-[10px] text-zinc-400" aria-hidden>✎</span>
                                      </button>
                                    ) : (
                                      <span className="text-sm font-medium">{person.name}</span>
                                    )}
                                    <span className="ml-1.5 text-[10px] text-zinc-500">
                                      {person.role === "gm" ? "GM" : person.role === "admin" ? "Admin" : "Player"}
                                    </span>
                                    <span className={`ml-1.5 text-[10px] ${online ? "text-emerald-600" : "text-zinc-400"}`}>
                                      {online ? "●" : lastSeenLabel}
                                    </span>
                                    {isSelf ? (
                                      <span className="ml-1.5 text-[10px] text-zinc-500">(you)</span>
                                    ) : null}
                                  </>
                                )}
                                {isSelf && renameError ? (
                                  <p className="mt-1 text-[10px] text-rose-600">{renameError}</p>
                                ) : null}
                              </div>
                              <div className="flex shrink-0 gap-1">
                                {isSelf && !editingSelf ? (
                                  <button
                                    className="rounded border border-zinc-200 px-2 py-0.5 text-[10px] font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
                                    onClick={() => {
                                      setRenameInput(person.name);
                                      setRenameError(null);
                                      setRenameOpen(true);
                                    }}
                                    title="Change your display name"
                                  >
                                    ✎ Rename
                                  </button>
                                ) : null}
                                {canAssign && !editingSelf ? (
                                  <button
                                    className="rounded px-2 py-0.5 text-[10px] font-semibold text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/40"
                                    onClick={() => {
                                      assignGm(person.id);
                                      setParticipantsOpen(false);
                                    }}
                                  >
                                    Make GM
                                  </button>
                                ) : !editingSelf && isGm ? (
                                  <span className="text-[10px] text-amber-600 dark:text-amber-400">GM</span>
                                ) : null}
                                {canKick && person.id !== participantId && !editingSelf ? (
                                  <button
                                    className="rounded px-2 py-0.5 text-[10px] font-semibold text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
                                    onClick={() => kickParticipant(person.id)}
                                  >
                                    Kick
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </>
              ) : null}
            </div>
            <div className="group relative">
              <button
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 dark:border-rose-800/60 dark:text-rose-400 dark:hover:bg-rose-950/40"
                onClick={leaveRoom}
                title="Leave room"
                aria-label="Leave room"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              </button>
              <span className="pointer-events-none absolute -bottom-8 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded bg-zinc-800 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                Leave room
              </span>
            </div>
          </div>
        </div>
      </nav>

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-6">

        {invitePrompt && !participantId ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
            <p className="font-semibold dark:text-amber-100">Enter a display name to join</p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                className="w-full rounded-lg border border-amber-200 px-3 py-2 text-sm dark:border-amber-700 dark:bg-zinc-900 dark:text-zinc-100"
                placeholder="Display name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
              <button
                className="inline-flex h-10 items-center justify-center rounded-full bg-zinc-900 px-4 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                onClick={joinViaInvite}
              >
                Join
              </button>
            </div>
          </div>
        ) : null}

        <section className="grid gap-6 lg:grid-cols-[260px_1fr]">
          <aside className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-zinc-500">Channels</p>
              <button
                className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-zinc-200 text-sm font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                onClick={() => {
                  setChannelCreateOpen((prev) => !prev);
                  setChannelCreateError(null);
                }}
                aria-label="Add channel"
              >
                +
              </button>
            </div>
            {channelCreateOpen ? (
              <div className="mt-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-800">
                <select
                  className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
                  value={channelCreateType}
                  onChange={(event) => setChannelCreateType(event.target.value as "text" | "voice" | "dice")}
                >
                  <option value="text">Text channel</option>
                  <option value="voice">Voice channel</option>
                  <option value="dice">Dice channel</option>
                </select>
                <input
                  className="mt-2 w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
                  placeholder="Channel name"
                  value={channelCreateName}
                  onChange={(event) => setChannelCreateName(event.target.value)}
                />
                <div className="mt-2 flex gap-2">
                  <button
                    className="rounded-full bg-zinc-900 px-3 py-1 text-[11px] font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 dark:disabled:bg-zinc-700 dark:disabled:text-zinc-500"
                    onClick={createChannel}
                    disabled={channelCreating}
                  >
                    {channelCreating ? "Adding..." : "Add"}
                  </button>
                  <button
                    className="rounded-full border border-zinc-200 px-3 py-1 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    onClick={() => setChannelCreateOpen(false)}
                  >
                    Cancel
                  </button>
                </div>
                {channelCreateError ? (
                  <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">{channelCreateError}</p>
                ) : null}
              </div>
            ) : null}
            <div className="mt-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-400">Document</p>
              <button
                type="button"
                className={`mt-2 flex w-full items-center rounded-lg px-2 py-1.5 text-left text-sm ${
                  selectedChannelId === "__document__"
                    ? "bg-zinc-900 text-white dark:bg-zinc-700"
                    : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                }`}
                onClick={() => setSelectedChannelId("__document__")}
              >
                📄 Shared document
              </button>
            </div>
            <div className="mt-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-400">Text Channels</p>
              <div className="mt-2 space-y-1">
                {textChannels.map((channel) => (
                  <button
                    key={channel.id}
                    className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm ${
                      selectedChannel?.id === channel.id ? "bg-zinc-900 text-white dark:bg-zinc-700" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    }`}
                    onClick={() => {
                      setSelectedChannelId(channel.id);
                      setUnreadByChannel((prev) =>
                        (prev[channel.id] ?? 0) > 0 ? { ...prev, [channel.id]: 0 } : prev
                      );
                    }}
                  >
                    <span>#{channel.name}</span>
                    {(unreadByChannel[channel.id] ?? 0) > 0 ? (
                      <span
                        className={`inline-flex h-2 w-2 shrink-0 rounded-full ${
                          selectedChannel?.id === channel.id ? "bg-white" : "bg-zinc-900 dark:bg-zinc-100"
                        }`}
                        title={`${unreadByChannel[channel.id]} unread`}
                        aria-label={`${unreadByChannel[channel.id]} unread messages`}
                      />
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
            {diceChannels.length > 0 ? (
              <div className="mt-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-400">Dice</p>
                <div className="mt-2 space-y-1">
                  {diceChannels.map((channel) => (
                    <button
                      key={channel.id}
                      className={`flex w-full items-center rounded-lg px-2 py-1.5 text-left text-sm ${
                        selectedChannel?.id === channel.id ? "bg-zinc-900 text-white dark:bg-zinc-700" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      }`}
                      onClick={() => setSelectedChannelId(channel.id)}
                    >
                      🎲 {channel.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="mt-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-400">Voice Channels</p>
              <div className="mt-2 space-y-1">
                {voiceChannels.map((channel) => (
                  <div key={channel.id}>
                    <button
                      className={`flex w-full items-center rounded-lg px-2 py-1.5 text-left text-sm ${
                        selectedChannel?.id === channel.id ? "bg-zinc-900 text-white dark:bg-zinc-700" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      }`}
                      onClick={() => setSelectedChannelId(channel.id)}
                    >
                      🔊 {channel.name}
                    </button>
                    {(voiceMembersBySlug[channel.slug] ?? []).length > 0 ? (
                      <div className="ml-4 mt-1 space-y-1">
                        {(voiceMembersBySlug[channel.slug] ?? []).map((member) => (
                          <p key={member.id} className="text-[11px] text-zinc-500">
                            {member.name}
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
            {channelsError ? <p className="mt-3 text-xs text-amber-600">{channelsError}</p> : null}
          </aside>
          <div className="flex min-w-0 flex-col gap-6">
          {selectedChannelId === "__document__" && participantId ? (
            <CollaborativeDocument
              roomId={roomId}
              participantId={participantId}
              displayName={displayName || session?.user?.name || null}
            />
          ) : null}
          <div className={`rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900${
            selectedChannelId === "__document__" ? " hidden" : ""
          }`}>
            {selectedChannel?.type === "dice" ? (
              <div>
                <h3 className="text-base font-semibold">🎲 {selectedChannel.name}</h3>
                <p className="mt-1 text-xs text-zinc-500">Full roll history for this room</p>
                <div
                  ref={chatContainerRef}
                  className="mt-3 max-h-96 overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800"
                >
                  {rolls.length === 0 ? (
                    <p className="text-xs text-zinc-500">No rolls yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {rolls.map((roll) => {
                        const termSides = getTermSides(roll);
                        const hasNat20 = termSides.some((s, i) => s === 20 && (roll.results[i] ?? 0) === 20);
                        const hasNat1 = termSides.some((s, i) => s === 20 && (roll.results[i] ?? 0) === 1);
                        const nameLabel = roll.rollName
                          ? `${roll.rollName} · ${roll.participantName}`
                          : roll.participantName;
                        return (
                          <div
                            key={roll.id}
                            className={`flex items-center gap-3 rounded-xl border-2 bg-gradient-to-br from-white to-amber-50/30 p-3 shadow-sm transition hover:shadow-md ${
                              hasNat20 ? "border-amber-300 shadow-amber-100/50" : hasNat1 ? "border-rose-200" : "border-amber-200/60"
                            }`}
                          >
                            <p className="min-w-0 shrink truncate text-xs font-semibold text-zinc-800" title={nameLabel}>
                              {nameLabel}
                            </p>
                            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                              {termSides.map((sides, i) => (
                                <DieChip
                                  key={i}
                                  sides={sides}
                                  value={roll.results[i] ?? 0}
                                  size="md"
                                  dropped={getDroppedMask(roll)[i]}
                                />
                              ))}
                              <span className="shrink-0 text-lg font-bold tabular-nums text-zinc-800">
                                {roll.total}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : selectedChannel?.type === "text" ? (
              <div>
                <h3 className="text-base font-semibold">#{selectedChannel.name}</h3>
                <div
                  ref={chatContainerRef}
                  className="mt-3 h-64 overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800"
                  onScroll={(event) => {
                    const target = event.currentTarget;
                    const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
                    shouldStickToBottomRef.current = distanceToBottom < 24;
                  }}
                >
                  {chatMessages.length === 0 ? (
                    <p className="text-xs text-zinc-500">No messages yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {chatMessages.map((message) => (
                        <div key={message.id} className="rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800">
                          <p className="text-xs font-semibold">
                            {message.participant.name}
                            <span className="ml-2 text-[10px] uppercase text-zinc-400">{message.participant.role}</span>
                          </p>
                          {message.content ? (
                            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-zinc-800 dark:text-zinc-100">
                              {renderMessageContent(message.content)}
                            </p>
                          ) : null}
                          {message.imageDataUrl ? (
                            <a
                              href={message.imageDataUrl}
                              target="_blank"
                              rel="noreferrer"
                              className={`block ${message.content ? "mt-2" : "mt-1"}`}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={message.imageDataUrl}
                                alt={`Shared by ${message.participant.name}`}
                                className="max-h-80 max-w-full rounded-lg border border-zinc-200 object-contain dark:border-zinc-700"
                              />
                            </a>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="mt-3 space-y-2">
                  {chatImagePreview ? (
                    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-800">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="truncate text-xs font-medium text-zinc-500">
                          {chatImageName ?? "Selected image"}
                        </p>
                        <button
                          type="button"
                          className="text-xs font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                          onClick={clearSelectedChatImage}
                        >
                          Remove
                        </button>
                      </div>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={chatImagePreview}
                        alt={chatImageName ?? "Selected chat image"}
                        className="max-h-48 max-w-full rounded-lg border border-zinc-200 object-contain dark:border-zinc-700"
                      />
                    </div>
                  ) : null}
                  <div className="flex gap-2">
                    <input
                      className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                      value={chatInput}
                      placeholder={`Message #${selectedChannel.name} (paste image to attach)`}
                      onChange={(event) => setChatInput(event.target.value)}
                      onPaste={(event) => void handleChatPaste(event)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          void sendChatMessage();
                        }
                      }}
                    />
                    <input
                      ref={chatImageInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
                      className="hidden"
                      onChange={handleChatImageChange}
                    />
                    <button
                      type="button"
                      className="rounded-full border border-zinc-200 px-4 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-100 dark:hover:bg-zinc-800"
                      onClick={() => chatImageInputRef.current?.click()}
                    >
                      Image
                    </button>
                    <button
                      className="rounded-full bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 dark:disabled:bg-zinc-700 dark:disabled:text-zinc-400"
                      onClick={() => void sendChatMessage()}
                      disabled={chatSending || (!chatInput.trim() && !chatImagePreview)}
                    >
                      {chatSending ? "Sending..." : "Send"}
                    </button>
                  </div>
                </div>
                {chatError ? <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{chatError}</p> : null}
              </div>
            ) : (
              <div>
                <h3 className="text-base font-semibold">🔊 {activeVoiceChannel?.name ?? "voice"}</h3>
                <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                  Configure audio mode, then join this selected voice channel.
                </p>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                    Audio mode
                    <select
                      className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
                      value={audioMode}
                      onChange={(event) => setAudioMode(event.target.value as "always" | "ptt")}
                    >
                      <option value="always">Always on + Noise gate</option>
                      <option value="ptt">Push to talk</option>
                    </select>
                  </label>
                  <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                    Push-to-talk key
                    <select
                      className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
                      value={pttKeyCode}
                      onChange={(event) => setPttKeyCode(event.target.value)}
                    >
                      {PTT_KEY_OPTIONS.map((option) => (
                        <option key={option.code} value={option.code}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                    <span className="flex items-center justify-between">
                      <span>Noise threshold</span>
                      <span className="text-[10px] font-normal text-zinc-500 dark:text-zinc-400">
                        {audioMode === "ptt" ? "disabled in PTT" : `${noiseThreshold}`}
                      </span>
                    </span>
                    <input
                      type="range"
                      min={1}
                      max={50}
                      value={noiseThreshold}
                      disabled={audioMode !== "always"}
                      className="mt-2 w-full disabled:opacity-40"
                      onChange={(event) => setNoiseThreshold(Number(event.target.value))}
                    />
                    <span className="mt-1 block text-[10px] font-normal text-zinc-500 dark:text-zinc-400">
                      Higher = suppresses more background noise.
                    </span>
                  </label>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  {joinedInSelectedVoice ? (
                    <button
                      className="rounded-full bg-rose-500 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-all hover:bg-rose-400 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-900"
                      onClick={handleQuitCall}
                    >
                      Leave this channel
                    </button>
                  ) : (
                    <button
                      className="rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-all hover:bg-zinc-800 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 dark:focus-visible:ring-offset-zinc-900"
                      onClick={handleJoinCall}
                    >
                      {callJoined ? "Switch to this channel" : "Join this channel"}
                    </button>
                  )}
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {callJoined
                      ? joinedInSelectedVoice
                        ? "You are connected to this voice channel."
                        : `Currently connected in ${joinedVoiceSlug ?? "another channel"}.`
                      : "Not connected to voice yet."}
                  </span>
                </div>
                {callError ? (
                  <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">{callError}</p>
                ) : null}
                {callJoined ? (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <label className="group flex h-9 cursor-pointer items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50 focus-within:border-sky-500 focus-within:ring-2 focus-within:ring-sky-500/30 dark:border-zinc-700 dark:bg-zinc-800/70 dark:text-zinc-200 dark:hover:border-zinc-600 dark:hover:bg-zinc-800">
                      <AnimatedSwitch
                        checked={floatVideos}
                        onChange={(v) => {
                          setFloatVideos(v);
                          setFloatingVideoMinimized(false);
                          localStorage.setItem("aynfrp:floatVideos", v ? "1" : "0");
                        }}
                      />
                      <span>Float videos</span>
                    </label>
                    {(canManageSession || room?.backgroundMusicUrl) && (
                      <button
                        type="button"
                        className="inline-flex h-9 items-center rounded-full border border-zinc-200 bg-white px-4 text-xs font-semibold text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40 dark:border-zinc-700 dark:bg-zinc-800/70 dark:text-zinc-200 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
                        onClick={() => setMusicModuleOpen(true)}
                      >
                        Background music
                      </button>
                    )}
                    {callFrameReady ? (
                      <span className="inline-flex h-9 items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                        <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        Connected
                      </span>
                    ) : (
                      <span className="inline-flex h-9 items-center rounded-full border border-amber-500/20 bg-amber-500/10 px-3 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                        <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
                        Connecting...
                      </span>
                    )}
                  </div>
                ) : null}
              </div>
            )}
            {callToken ? (
              <>
                <div
                  className={`rounded-xl border border-zinc-200 overflow-hidden dark:border-zinc-700 ${
                    floatVideos && !floatingVideoMinimized ? "fixed z-50 shadow-xl floating-video-panel mt-0" : floatVideos && floatingVideoMinimized ? "h-0 overflow-hidden mt-0" : "mt-4"
                  }`}
                  style={
                    floatVideos && !floatingVideoMinimized
                      ? {
                          width: floatingVideoSize?.w ?? 420,
                          height: floatingVideoSize?.h ?? 280,
                          minWidth: 280,
                          minHeight: 200,
                          left:
                            floatingVideoPosition?.x ??
                            (typeof window !== "undefined"
                              ? Math.max(16, window.innerWidth - (floatingVideoSize?.w ?? 420) - 16)
                              : 16),
                          top: floatingVideoPosition?.y ?? 96,
                        }
                      : undefined
                  }
                >
                  {floatVideos && !floatingVideoMinimized && (
                    <div
                      className="absolute left-0 right-0 top-0 z-20 flex h-7 cursor-grab items-center justify-between border-b border-zinc-200/80 bg-zinc-100/90 px-2 transition-colors hover:bg-zinc-200/80 active:cursor-grabbing rounded-t-xl dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        const startX = e.clientX;
                        const startY = e.clientY;
                        const startLeft = floatingVideoPosition?.x ?? Math.max(16, window.innerWidth - (floatingVideoSize?.w ?? 420) - 16);
                        const startTop = floatingVideoPosition?.y ?? 96;
                        const lastPos = { x: startLeft, y: startTop };
                        const onMove = (e2: MouseEvent) => {
                          const dx = e2.clientX - startX;
                          const dy = e2.clientY - startY;
                          const w = floatingVideoSize?.w ?? 420;
                          const newX = Math.max(0, Math.min(window.innerWidth - w, startLeft + dx));
                          const newY = Math.max(0, Math.min(window.innerHeight - 48, startTop + dy));
                          lastPos.x = newX;
                          lastPos.y = newY;
                          setFloatingVideoPosition({ x: newX, y: newY });
                        };
                        const onUp = () => {
                          document.removeEventListener("mousemove", onMove);
                          document.removeEventListener("mouseup", onUp);
                          try {
                            localStorage.setItem("aynfrp:floatVideoPos", JSON.stringify(lastPos));
                          } catch {}
                        };
                        document.addEventListener("mousemove", onMove);
                        document.addEventListener("mouseup", onUp);
                      }}
                      title="Drag to move"
                    >
                      <span className="text-[10px] font-medium text-zinc-500 select-none dark:text-zinc-400">⋮⋮</span>
                      <button
                        type="button"
                        className="rounded p-1 text-zinc-500 hover:bg-zinc-300/80 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-600 dark:hover:text-zinc-100"
                        onClick={() => setFloatingVideoMinimized(true)}
                        title="Minimize video"
                        aria-label="Minimize video"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </button>
                    </div>
                  )}
                  {floatVideos && !floatingVideoMinimized && (
                    <div
                      className="absolute left-0 top-7 z-10 h-[calc(100%-1.75rem)] w-2 cursor-ew-resize bg-zinc-300/50 opacity-0 transition-opacity hover:opacity-100"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        const startX = e.clientX;
                        const startW = floatingVideoSize?.w ?? 420;
                        const startLeft =
                          floatingVideoPosition?.x ??
                          Math.max(16, window.innerWidth - startW - 16);
                        const onMove = (e2: MouseEvent) => {
                          const dx = startX - e2.clientX;
                          const newW = Math.max(280, Math.min(window.innerWidth - 32, startW + dx));
                          const actualDx = newW - startW;
                          const newX = Math.max(
                            0,
                            Math.min(window.innerWidth - newW, startLeft - actualDx)
                          );
                          setFloatingVideoSize((s) => ({ ...s, w: newW, h: s?.h ?? 280 }));
                          setFloatingVideoPosition((p) => ({ x: newX, y: p?.y ?? 96 }));
                        };
                        const onUp = () => {
                          document.removeEventListener("mousemove", onMove);
                          document.removeEventListener("mouseup", onUp);
                        };
                        document.addEventListener("mousemove", onMove);
                        document.addEventListener("mouseup", onUp);
                      }}
                      title="Drag to resize"
                    />
                  )}
                  {floatVideos && !floatingVideoMinimized && (
                    <div
                      className="absolute right-0 top-7 z-10 h-[calc(100%-1.75rem)] w-2 cursor-ew-resize bg-zinc-300/50 opacity-0 transition-opacity hover:opacity-100"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        const startX = e.clientX;
                        const startW = floatingVideoSize?.w ?? 420;
                        const startLeft =
                          floatingVideoPosition?.x ??
                          Math.max(16, window.innerWidth - startW - 16);
                        const onMove = (e2: MouseEvent) => {
                          const dx = e2.clientX - startX;
                          const maxW = window.innerWidth - startLeft - 16;
                          const newW = Math.max(280, Math.min(maxW, startW + dx));
                          setFloatingVideoSize((s) => ({ ...s, w: newW, h: s?.h ?? 280 }));
                        };
                        const onUp = () => {
                          document.removeEventListener("mousemove", onMove);
                          document.removeEventListener("mouseup", onUp);
                        };
                        document.addEventListener("mousemove", onMove);
                        document.addEventListener("mouseup", onUp);
                      }}
                      title="Drag to resize"
                    />
                  )}
                  {floatVideos && !floatingVideoMinimized && (
                    <div
                      className="absolute bottom-0 left-3 right-3 z-30 h-3 cursor-ns-resize bg-zinc-300/50 opacity-0 transition-opacity hover:opacity-100"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        const startY = e.clientY;
                        const startH = floatingVideoSize?.h ?? 280;
                        const onMove = (e2: MouseEvent) => {
                          const dy = e2.clientY - startY;
                          const newH = Math.max(200, Math.min(window.innerHeight - 100, startH + dy));
                          setFloatingVideoSize((s) => ({ ...s, w: s?.w ?? 420, h: newH }));
                        };
                        const onUp = () => {
                          document.removeEventListener("mousemove", onMove);
                          document.removeEventListener("mouseup", onUp);
                        };
                        document.addEventListener("mousemove", onMove);
                        document.addEventListener("mouseup", onUp);
                      }}
                      title="Drag to resize height"
                    />
                  )}
                  {floatVideos && !floatingVideoMinimized && (
                    <div
                      className="absolute bottom-0 right-0 z-40 h-3 w-3 cursor-nwse-resize bg-zinc-400/60 opacity-0 transition-opacity hover:opacity-100"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        const startX = e.clientX;
                        const startY = e.clientY;
                        const startW = floatingVideoSize?.w ?? 420;
                        const startH = floatingVideoSize?.h ?? 280;
                        const startLeft =
                          floatingVideoPosition?.x ??
                          Math.max(16, window.innerWidth - startW - 16);
                        const onMove = (e2: MouseEvent) => {
                          const dx = e2.clientX - startX;
                          const dy = e2.clientY - startY;
                          const maxW = window.innerWidth - startLeft - 16;
                          const newW = Math.max(280, Math.min(maxW, startW + dx));
                          const newH = Math.max(200, Math.min(window.innerHeight - 100, startH + dy));
                          setFloatingVideoSize({ w: newW, h: newH });
                        };
                        const onUp = () => {
                          document.removeEventListener("mousemove", onMove);
                          document.removeEventListener("mouseup", onUp);
                        };
                        document.addEventListener("mousemove", onMove);
                        document.addEventListener("mouseup", onUp);
                      }}
                      title="Drag to resize"
                    />
                  )}
                  {floatVideos && !floatingVideoMinimized && (
                    <div
                      className="absolute bottom-0 left-0 z-40 h-3 w-3 cursor-nesw-resize bg-zinc-400/60 opacity-0 transition-opacity hover:opacity-100"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        const startX = e.clientX;
                        const startY = e.clientY;
                        const startW = floatingVideoSize?.w ?? 420;
                        const startH = floatingVideoSize?.h ?? 280;
                        const startLeft =
                          floatingVideoPosition?.x ??
                          Math.max(16, window.innerWidth - startW - 16);
                        const onMove = (e2: MouseEvent) => {
                          const dx = startX - e2.clientX;
                          const dy = e2.clientY - startY;
                          const newW = Math.max(280, Math.min(window.innerWidth - 32, startW + dx));
                          const actualDx = newW - startW;
                          const newX = Math.max(
                            0,
                            Math.min(window.innerWidth - newW, startLeft - actualDx)
                          );
                          const newH = Math.max(200, Math.min(window.innerHeight - 100, startH + dy));
                          setFloatingVideoSize({ w: newW, h: newH });
                          setFloatingVideoPosition((p) => ({ x: newX, y: p?.y ?? 96 }));
                        };
                        const onUp = () => {
                          document.removeEventListener("mousemove", onMove);
                          document.removeEventListener("mouseup", onUp);
                        };
                        document.addEventListener("mousemove", onMove);
                        document.addEventListener("mouseup", onUp);
                      }}
                      title="Drag to resize"
                    />
                  )}
                  <div className={`w-full h-full bg-zinc-100 dark:bg-zinc-900 ${floatVideos ? "pt-7" : ""} ${!floatVideos ? "h-[70vh] min-h-[520px]" : ""}`} style={floatVideos ? { minHeight: 200 } : undefined}>
                    <LiveKitRoom
                      token={callToken}
                      serverUrl={LIVEKIT_URL}
                      connect
                      video
                      audio
                      data-lk-theme="default"
                      options={{ adaptiveStream: true, dynacast: true, webAudioMix: true }}
                      className="call-room h-full w-full"
                      onConnected={() => {
                        isSwitchingVoiceChannelRef.current = false;
                        setCallFrameReady(true);
                      }}
                      onDisconnected={() => {
                        if (!isSwitchingVoiceChannelRef.current) void handleQuitCall();
                      }}
                      onError={(liveKitError) => {
                        isSwitchingVoiceChannelRef.current = false;
                        setCallError(liveKitError.message);
                      }}
                    >
                      <ParticipantVolumeController participantVolumes={participantVolumes} />
                      <VoiceRuntimeControls
                        mode={audioMode}
                        pttKeyCode={pttKeyCode}
                        noiseThreshold={noiseThreshold}
                      />
                      {floatVideos && floatingVideoMinimized && (
                        <MinimizedCallBar onExpand={() => setFloatingVideoMinimized(false)} />
                      )}
                      {floatVideos ? <FloatingVideoConference /> : <VideoConference />}
                    </LiveKitRoom>
                  </div>
                </div>
                <div className="mt-4">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">
                    In selected voice channel
                  </h3>
                  <p className="mt-1 text-[11px] text-zinc-500">
                    Adjust each remote player between 0% and 200% to balance quiet and loud voices.
                  </p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {activeVoiceParticipants.length === 0 ? (
                      <p className="text-xs text-zinc-500">No one has joined this voice channel yet.</p>
                    ) : (
                      activeVoiceParticipants.map((person) => (
                        <div
                          key={person.id}
                          className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800"
                        >
                          <div className="flex items-center gap-3">
                            {person.camOn ? (
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-xs font-semibold text-white">
                                Video
                              </div>
                            ) : (
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs font-semibold text-zinc-700">
                                {person.name
                                  .split(" ")
                                  .map((chunk) => chunk[0])
                                  .join("")
                                  .slice(0, 2)
                                  .toUpperCase()}
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="truncate text-xs font-semibold">{person.name}</p>
                              <p className="text-[11px] text-zinc-500">
                                {person.camOn ? "Camera on" : "Camera off"} •{" "}
                                {person.micOn ? "Mic on" : "Mic off"}
                              </p>
                            </div>
                          </div>
                          {person.id === participantId ? (
                            <p className="mt-3 text-[11px] text-zinc-400">Your own volume is controlled by your device.</p>
                          ) : (
                            <div className="mt-3 space-y-1.5">
                              <div className="flex items-center gap-2">
                                <span className="shrink-0 text-[11px] font-medium text-zinc-500">
                                  Volume
                                </span>
                                <input
                                  type="range"
                                  min={PARTICIPANT_VOLUME_MIN * 100}
                                  max={PARTICIPANT_VOLUME_MAX * 100}
                                  step={PARTICIPANT_VOLUME_STEP * 100}
                                  value={participantVolumeToPercent(
                                    participantVolumes[person.id] ?? 1
                                  )}
                                  className="w-full"
                                  onChange={(event) =>
                                    updateParticipantVolume(person.id, Number(event.target.value))
                                  }
                                />
                                <span className="w-12 text-right text-[11px] font-semibold tabular-nums text-zinc-700 dark:text-zinc-200">
                                  {participantVolumeToPercent(participantVolumes[person.id] ?? 1)}%
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] text-zinc-400">
                                  Lower loud players, boost quiet ones.
                                </span>
                                {Math.abs((participantVolumes[person.id] ?? 1) - 1) > 0.001 ? (
                                  <button
                                    type="button"
                                    className="text-[10px] font-semibold text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                                    onClick={() => updateParticipantVolume(person.id, 100)}
                                  >
                                    Reset
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </>
            ) : null}
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 min-w-0">
            <h2 className="text-lg font-semibold">🎲 Dice</h2>
            <p className="mt-1 text-xs text-zinc-500">Quick rolls right where the action happens.</p>
            {previousRoll ? (
              <p className="mt-3 text-xs text-zinc-500">
                Previous: {previousRoll.participantName} → {previousRoll.total}
                {previousRoll.expression ? ` (${previousRoll.expression})` : ""}
              </p>
            ) : null}
            {lastRoll ? (
              <div className="dice-results-box mt-4 rounded-xl border-2 border-amber-200 bg-amber-50 p-4 text-center dark:border-amber-700/60 dark:bg-amber-950/40">
                <p className="text-xs font-medium text-amber-800 dark:text-amber-200">{lastRoll.participantName}</p>
                <p className="mt-1 text-4xl font-bold tabular-nums text-amber-900 dark:text-amber-100">
                  {lastRoll.total}
                </p>
                <p className="mt-1 flex flex-wrap justify-center gap-2 text-sm">
                  {getTermSides(lastRoll).map((sides, i) => (
                    <DieChip
                      key={i}
                      sides={sides}
                      value={lastRoll.results[i] ?? 0}
                      size="md"
                      dropped={getDroppedMask(lastRoll)[i]}
                    />
                  ))}
                </p>
              </div>
            ) : null}
            <div className="mt-6 space-y-4">
              <div className="rounded-xl border-2 border-amber-200/60 bg-amber-50/50 p-4 dark:border-amber-700/50 dark:bg-amber-950/30">
                <div className="flex items-center gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-700/80 dark:text-amber-300/80">
                    Ready to roll
                  </p>
                  <DiceHelpButton
                    open={diceHelpOpen}
                    onToggle={() => setDiceHelpOpen((v) => !v)}
                    onClose={() => setDiceHelpOpen(false)}
                  />
                </div>
                <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-amber-900 dark:text-amber-100">
                  {(diceExpression.trim() || "d20")}
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <input
                    className="min-w-[160px] rounded-lg border-2 border-amber-200/80 bg-white px-4 py-2.5 font-mono text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-amber-700/60 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                    value={diceExpression}
                    onChange={(e) => setDiceExpression(e.target.value)}
                    placeholder="d20, 2d6+3, 2rr2d20"
                  />
                  <button
                    className={`rounded-xl px-8 py-3 text-base font-bold text-white shadow-md transition ${rollingDice ? "animate-bounce bg-amber-500" : "bg-amber-600 hover:bg-amber-500 dark:bg-amber-500 dark:hover:bg-amber-400"}`}
                    onClick={() => rollDice()}
                    disabled={rollingDice}
                  >
                    {rollingDice ? "Rolling…" : "Roll"}
                  </button>
                  {namedRollInput !== null ? (
                    <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900">
                      <input
                        className="w-28 rounded border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                        placeholder="e.g. damage"
                        value={namedRollInput}
                        onChange={(e) => setNamedRollInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && saveNamedRoll(namedRollInput)}
                        autoFocus
                      />
                      <button
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 dark:bg-emerald-500 dark:hover:bg-emerald-400"
                        onClick={() => saveNamedRoll(namedRollInput)}
                      >
                        Save
                      </button>
                      <button
                        className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
                        onClick={() => setNamedRollInput(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="group relative">
                      <button
                        className="rounded-lg border-2 border-dashed border-zinc-300 px-4 py-2 text-xs font-medium text-zinc-600 hover:border-amber-300 hover:text-amber-700 dark:border-zinc-600 dark:text-zinc-300 dark:hover:border-amber-500 dark:hover:text-amber-300"
                        onClick={() => setNamedRollInput("")}
                        title="Save this roll with a name for quick access"
                      >
                        + Save as…
                      </button>
                      <span className="pointer-events-none absolute -bottom-9 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded bg-zinc-800 px-2 py-1.5 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100 dark:bg-zinc-700">
                        Name this roll (e.g. damage, perception) to use it with one click later
                      </span>
                    </div>
                  )}
                </div>
              </div>
              {Object.keys(namedRolls).length > 0 ? (
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    Saved rolls
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(namedRolls).map(([name, expr]) => (
                      <button
                        key={name}
                        className="group flex items-center gap-2 rounded-xl border-2 border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm font-medium transition hover:border-amber-300 hover:bg-amber-50 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-amber-500 dark:hover:bg-amber-950/40"
                        onClick={() => { setDiceExpression(expr); rollDice(expr, name); }}
                        title={`${name}: ${expr} — click to roll`}
                      >
                        <span className="text-zinc-800 dark:text-zinc-100">{name}</span>
                        <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">{expr}</span>
                        <span
                          className="ml-1 rounded-full p-1 text-zinc-400 opacity-0 transition hover:bg-zinc-200 hover:text-rose-600 group-hover:opacity-100 dark:text-zinc-500 dark:hover:bg-zinc-700 dark:hover:text-rose-400"
                          onClick={(e) => { e.stopPropagation(); removeNamedRoll(name); }}
                          title="Remove"
                        >
                          ×
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Quick:</span>
                {["d20", "adv", "dis", "4d6kh3", "2d6+3", "d100"].map((expr) => (
                  <button
                    key={expr}
                    className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-sm font-medium text-zinc-800 hover:border-amber-200 hover:bg-amber-50 hover:text-amber-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:border-amber-500 dark:hover:bg-amber-950/40 dark:hover:text-amber-300"
                    onClick={() => { setDiceExpression(expr); rollDice(expr); }}
                  >
                    {expr}
                  </button>
                ))}
                {canManageSession ? (
                  <button
                    className="ml-4 rounded-lg border border-rose-200 px-4 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 dark:border-rose-800/60 dark:text-rose-300 dark:hover:bg-rose-950/40"
                    onClick={clearRollLog}
                    title="Only GM/admin can clear"
                  >
                    Clear log
                  </button>
                ) : null}
              </div>
            </div>
            {diceError ? <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">{diceError}</p> : null}
            <p className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-400">
              Roll again if wrong — previous stays visible. Full history in 🎲 dice channel.
            </p>
            <div
              className="mt-3 space-y-3 overflow-y-auto rounded-lg border border-zinc-100 p-2 dark:border-zinc-800"
              style={{ height: diceLogHeight }}
            >
              {rolls.length === 0 ? (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">No rolls yet.</p>
              ) : (
                rolls.slice(0, 50).map((roll) => {
                  const termSides = getTermSides(roll);
                  const hasNat20 = termSides.some((s, i) => s === 20 && (roll.results[i] ?? 0) === 20);
                  const hasNat1 = termSides.some((s, i) => s === 20 && (roll.results[i] ?? 0) === 1);
                  const nameLabel = roll.rollName
                    ? `${roll.rollName} · ${roll.participantName}`
                    : roll.participantName;
                  return (
                    <div
                      key={roll.id}
                      className={`flex items-center gap-3 rounded-xl border-2 bg-gradient-to-br from-white to-amber-50/30 p-3 shadow-sm transition hover:shadow-md dark:from-zinc-900 dark:to-amber-950/20 ${
                        hasNat20
                          ? "border-amber-300 shadow-amber-100/50 dark:border-amber-500/70"
                          : hasNat1
                            ? "border-rose-200 dark:border-rose-800/60"
                            : "border-amber-200/60 dark:border-amber-700/40"
                      }`}
                    >
                      <p className="min-w-0 shrink truncate text-xs font-semibold text-zinc-800 dark:text-zinc-100" title={nameLabel}>
                        {nameLabel}
                      </p>
                      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                        {(() => {
                          const dm = getDroppedMask(roll);
                          return termSides.map((sides, i) => (
                            <DieChip
                              key={i}
                              sides={sides}
                              value={roll.results[i] ?? 0}
                              dropped={dm[i]}
                            />
                          ));
                        })()}
                        <span className="shrink-0 text-base font-bold tabular-nums text-zinc-800 dark:text-zinc-100">
                          {roll.total}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize dice history"
              onPointerDown={handleDiceLogResizeStart}
              onDoubleClick={() => {
                setDiceLogHeight(192);
                if (typeof window !== "undefined") {
                  try {
                    window.localStorage.removeItem("frp:dice-log:height");
                  } catch {
                    // Ignore storage errors.
                  }
                }
              }}
              title="Drag to resize — double-click to reset"
              className="mt-1 flex h-3 cursor-ns-resize select-none items-center justify-center rounded-full bg-zinc-100 transition hover:bg-amber-100 dark:bg-zinc-800 dark:hover:bg-amber-900/40"
            >
              <div className="pointer-events-none h-1 w-10 rounded bg-zinc-300 dark:bg-zinc-600" />
            </div>
          </div>

          <div className="min-w-0 rounded-2xl border-2 border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-5 shadow-md dark:border-amber-700/60 dark:from-amber-950/40 dark:to-orange-950/30">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <button
                type="button"
                onClick={() => setInitiativeExpanded((prev) => !prev)}
                className="group flex min-w-0 flex-1 items-start gap-3 rounded-lg p-1 text-left transition hover:bg-amber-100/40 dark:hover:bg-amber-900/30"
                aria-expanded={initiativeExpanded}
                aria-label={initiativeExpanded ? "Collapse initiative tracker" : "Expand initiative tracker"}
              >
                <span
                  className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-amber-300 bg-amber-100 text-amber-800 transition-transform dark:border-amber-600 dark:bg-amber-900/60 dark:text-amber-200 ${
                    initiativeExpanded ? "rotate-90" : ""
                  }`}
                  aria-hidden="true"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </span>
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-amber-900 dark:text-amber-100">
                    ⚔ Initiative tracker
                    {initiativeEntries.length > 0 ? (
                      <span className="ml-2 text-xs font-medium text-amber-800/80 dark:text-amber-200/80">
                        · Round {initiativeState.roundCount + 1} · Turn {initiativeState.turnCount}
                      </span>
                    ) : null}
                  </h2>
                  <p className="mt-0.5 text-xs text-amber-700/80 dark:text-amber-300/80">
                    {initiativeExpanded
                      ? "Roll to see who strikes first. GM rolls for monsters, you roll for you."
                      : initiativeEntries.length > 0
                        ? `${initiativeEntries.length} in combat — click to expand.`
                        : "Click to start combat and track turns."}
                  </p>
                </div>
              </button>
              {initiativeExpanded && initiativeEntries.length > 0 ? (
                <button
                  className="rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-emerald-500 dark:bg-emerald-500 dark:hover:bg-emerald-400"
                  onClick={nextTurn}
                  disabled={
                    initiativeEntries.filter((e) => e.isAlive !== false).length === 0 ||
                    (!canManageSession &&
                      initiativeEntries.find((e) => e.id === initiativeState.currentTurnEntryId)?.participantId !==
                        participantId)
                  }
                  title={
                    canManageSession
                      ? "Advance to next turn (GM can pass anytime)"
                      : "Pass to next (only when it's your turn)"
                  }
                >
                  Next turn
                </button>
              ) : null}
            </div>

            {initiativeExpanded ? (
              <div className="mt-4">
                {canManageSession ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      className="rounded-full bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-500 dark:bg-amber-500 dark:hover:bg-amber-400"
                      onClick={startInitiative}
                    >
                      Start initiative
                    </button>
                  </div>
                ) : null}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <div className="relative flex items-center gap-1.5">
                    <input
                      className="w-32 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 font-mono text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                      value={initiativeExpression}
                      onChange={(e) => setInitiativeExpression(e.target.value)}
                      placeholder="d20+2, adv"
                    />
                    <DiceHelpButton
                      open={initiativeHelpOpen}
                      onToggle={() => setInitiativeHelpOpen((v) => !v)}
                      onClose={() => setInitiativeHelpOpen(false)}
                    />
                  </div>
                  {canManageSession ? (
                    <>
                      <input
                        className="w-28 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                        placeholder="Creature name"
                        value={initiativeCreatureName}
                        onChange={(e) => setInitiativeCreatureName(e.target.value)}
                      />
                      <button
                        className="rounded-full bg-zinc-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 hover:bg-zinc-600 dark:bg-zinc-600 dark:hover:bg-zinc-500"
                        onClick={() => addInitiativeEntry(true, undefined, initiativeCreatureName)}
                        disabled={initiativeAdding || !initiativeCreatureName.trim()}
                      >
                        Add creature
                      </button>
                    </>
                  ) : null}
                  <button
                    className="rounded-full bg-zinc-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                    onClick={() => addInitiativeEntry(false)}
                    disabled={initiativeAdding}
                  >
                    Add me
                  </button>
                </div>
                {initiativeEntries.length > 0 ? (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <span className="flex items-center gap-1.5 text-sm font-bold text-amber-900 dark:text-amber-100">
                      {initiativeState.currentTurnEntryId ? (
                        <span className="rounded-full bg-amber-400/80 px-1.5 text-amber-900 dark:bg-amber-500 dark:text-amber-950" title="Current turn">⚔</span>
                      ) : null}
                      Round {initiativeState.roundCount + 1} · Turn {initiativeState.turnCount}
                    </span>
                    {canManageSession ? (
                      showTurnCountForm ? (
                        <span className="flex items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            className="w-14 rounded border border-zinc-200 bg-white px-2 py-0.5 text-xs text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                            placeholder="Turn #"
                            value={initiativeTurnCountInput}
                            onChange={(e) => setInitiativeTurnCountInput(e.target.value)}
                            onKeyDown={(e) =>
                              e.key === "Enter" && (() => {
                                const n = parseInt(initiativeTurnCountInput, 10);
                                if (!isNaN(n) && n >= 0) {
                                  setInitiativeTurnCount(n);
                                  setInitiativeTurnCountInput("");
                                  setShowTurnCountForm(false);
                                }
                              })()
                            }
                          />
                          <button
                            className="rounded border border-zinc-200 px-2 py-0.5 text-[10px] text-zinc-700 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
                            onClick={() => {
                              const n = parseInt(initiativeTurnCountInput, 10);
                              if (!isNaN(n) && n >= 0) {
                                setInitiativeTurnCount(n);
                                setInitiativeTurnCountInput("");
                                setShowTurnCountForm(false);
                              }
                            }}
                          >
                            Set
                          </button>
                          <button
                            className="rounded border border-zinc-200 px-2 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800"
                            onClick={() => setShowTurnCountForm(false)}
                          >
                            ×
                          </button>
                        </span>
                      ) : (
                        <button
                          className="rounded border border-zinc-200 px-2 py-0.5 text-[10px] text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                          onClick={() => setShowTurnCountForm(true)}
                        >
                          Set turn
                        </button>
                      )
                    ) : null}
                  </div>
                ) : null}
                {initiativeError ? <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{initiativeError}</p> : null}
                <div className="mt-4 space-y-1">
                  {initiativeEntries.length === 0 ? (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">No initiative yet.</p>
                  ) : (
                    initiativeEntries.map((e, i) => {
                      const isCurrentTurn = e.id === initiativeState.currentTurnEntryId;
                      const displayName = e.creatureName ?? e.participantName ?? "—";
                      const isDead = e.isAlive === false;
                      return (
                        <div
                          key={e.id}
                          className={`flex items-center justify-between gap-2 rounded-xl border-2 px-3 py-2.5 text-sm transition-all ${
                            isCurrentTurn
                              ? "border-amber-500 bg-gradient-to-r from-amber-100 to-yellow-100 shadow-md ring-2 ring-amber-300/50 dark:border-amber-400 dark:from-amber-900/60 dark:to-yellow-900/60 dark:ring-amber-500/40"
                              : "border-amber-200/80 bg-white/80 dark:border-amber-700/50 dark:bg-zinc-900/70"
                          } ${isDead ? "opacity-55 grayscale-[0.3]" : ""}`}
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-3">
                            <span className="flex shrink-0 items-center gap-1 font-bold text-amber-900 dark:text-amber-100">
                              {i + 1}.
                              {isCurrentTurn ? (
                                <span className="rounded bg-amber-400 p-0.5 text-amber-900 dark:bg-amber-500 dark:text-amber-950" title="Your turn!">⚔</span>
                              ) : null}
                              {displayName}
                              {isDead ? <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400" title="Dead">💀</span> : null}
                            </span>
                            <span className="flex shrink-0 items-center gap-1.5">
                              <span className="font-mono text-xs text-zinc-600 dark:text-zinc-400">{e.expression}</span>
                              {(e.results?.length ?? 0) > 0 ? (
                                <>
                                  {parseExpressionSides(e.expression).map((sides, idx) => (
                                    <DieChip key={idx} sides={sides} value={e.results![idx] ?? 0} />
                                  ))}
                                  <span className="font-mono text-sm font-bold tabular-nums text-amber-900 dark:text-amber-100">
                                    = {e.result}
                                  </span>
                                </>
                              ) : (
                                <span className="rounded-md bg-zinc-200/90 px-2 py-0.5 font-mono text-sm font-bold tabular-nums text-zinc-800 dark:bg-zinc-700/70 dark:text-zinc-100">
                                  {e.result}
                                </span>
                              )}
                            </span>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            {(canManageSession || e.participantId === participantId) ? (
                              <button
                                className="rounded-lg p-1.5 text-base transition hover:scale-110 hover:bg-zinc-200/80 dark:hover:bg-zinc-700/70"
                                onClick={() => toggleInitiativeAlive(e.id)}
                                title={isDead ? "Mark alive" : "Mark dead"}
                              >
                                {isDead ? <span title="Mark alive">❤️</span> : <span title="Mark dead">💀</span>}
                              </button>
                            ) : null}
                            {canManageSession ? (
                              <button
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-rose-100 hover:text-rose-600 dark:text-zinc-400 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
                                onClick={() => removeInitiativeEntry(e.id)}
                                title="Remove from initiative"
                                aria-label="Remove"
                              >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <line x1="18" y1="6" x2="6" y2="18" />
                                  <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                              </button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ) : null}
          </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-1">
          {currentParticipant ? (
            <CharacterSheetEditor
              roomId={roomId}
              participantId={currentParticipant.id}
              participantName={currentParticipant.name}
            />
          ) : null}
        </section>
      </main>

      <MusicPlayer
        backgroundMusicUrl={room?.backgroundMusicUrl ?? null}
        musicUrl={musicUrl}
        setMusicUrl={setMusicUrl}
        setBackgroundMusic={setBackgroundMusic}
        musicError={musicError}
        canManageSession={canManageSession}
        open={musicModuleOpen}
        onClose={() => setMusicModuleOpen(false)}
      />
    </div>
    </>
  );
}
