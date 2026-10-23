"use client";

/*
 * 그림 에셋 보기 (/games/love?review=assets, 메뉴엔 없음)
 * CG · 배경 · 스탠딩(옷 · 표정) · 타이틀 그림 전부 + 어느 장면에서 나오는지 (대본을 훑어서 셈)
 * 표정은 그 옷에 그림이 없으면 가까운 표정(FACE_NEAR)으로 대신 나오는데, 대신 나오는 것도 같이 표시
 */
import { useMemo, useState } from "react";
import { BG, CG, CG_ORDER, FACE_NEAR, NAME, OUTFITS, STAND, TITLE, type StandSet } from "@/lib/love/assets";
import { SCENES } from "@/lib/love/script";
import type { CharKey, Face, Outfit } from "@/lib/love/types";

interface Use {
  scene: string;
  i: number;
  /** 그 자리 근처 대사 (어떤 상황인지) */
  line: string;
  /** 원래 원한 표정 (대신 나온 경우) */
  want?: Face;
}
type Key = string; // "cg:y_closet" · "bg:pub" · "st:yeonseo:base:smile"

const lineNear = (steps: (typeof SCENES)[string], i: number): string => {
  for (let j = i; j < Math.min(steps.length, i + 6); j++) {
    const s = steps[j];
    if (s.t === "say") return `${s.who === "me" ? "나" : (NAME[s.who as keyof typeof NAME] ?? "")}: ${s.text}`;
  }
  for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
    const s = steps[j];
    if (s.t === "say") return s.text;
  }
  return "";
};

const setOf = (who: CharKey, outfit: Outfit | "base"): StandSet | undefined =>
  outfit === "base" ? STAND[who] : (OUTFITS[who]?.[outfit as Outfit] ?? STAND[who]);

/** 실제로 화면에 나오는 표정 (그림 없으면 가까운 것, 그래도 없으면 기본) */
const resolve = (set: StandSet | undefined, want: Face | undefined): Face | "base" => {
  if (!set || !want || want === ("neutral" as Face)) return "base";
  if (set.faces[want]) return want;
  for (const f of FACE_NEAR[want] ?? []) if (set.faces[f]) return f;
  return "base";
};

function scan(): Map<Key, Use[]> {
  const m = new Map<Key, Use[]>();
  const add = (k: Key, u: Use) => {
    const a = m.get(k);
    if (a) a.push(u);
    else m.set(k, [u]);
  };
  for (const [scene, steps] of Object.entries(SCENES)) {
    const outfit: Partial<Record<CharKey, Outfit | "base">> = {};
    steps.forEach((s, i) => {
      const u = () => ({ scene, i, line: lineNear(steps, i) });
      if (s.t === "bg" && s.id !== "black") add(`bg:${s.id}`, u());
      else if (s.t === "cg" && s.id) add(`cg:${s.id}`, u());
      else if (s.t === "outfit") outfit[s.who] = s.id === ("default" as Outfit) ? "base" : s.id;
      else if ((s.t === "show" || s.t === "face" || s.t === "say") && "who" in s) {
        const who = s.who as CharKey;
        if (!STAND[who]) return;
        const want = (s as { face?: Face }).face;
        if (s.t === "say" && !want) return;
        const of = outfit[who] ?? "base";
        const set = setOf(who, of);
        const ofKey = set === STAND[who] ? "base" : of;
        const got = resolve(set, want);
        add(`st:${who}:${ofKey}:${got}`, { ...u(), want: want && want !== got ? want : undefined });
      }
    });
  }
  return m;
}

const FACE_KO: Record<string, string> = {
  base: "기본",
  smile: "미소",
  away: "시선 피함",
  cold: "차가움",
  surprise: "놀람",
  sad: "슬픔",
  blush: "발그레",
  cry: "울음",
  laugh: "웃음",
  angry: "화남",
  pout: "삐짐",
  smug: "의기양양",
  wink: "윙크",
};
const OUTFIT_KO: Record<string, string> = { base: "기본 옷", tshirt: "티셔츠", knit: "니트", bare: "맨손" };

interface Item {
  key: Key;
  src: string;
  title: string;
  sub?: string;
  tall?: boolean;
}

export default function AssetReview({ onBack }: { onBack: () => void }) {
  const uses = useMemo(() => scan(), []);
  const [tab, setTab] = useState<"cg" | "stand" | "bg" | "ui">("cg");
  const [open, setOpen] = useState<Item | null>(null);

  const groups = useMemo(() => {
    const cg: Item[] = CG_ORDER.map((k) => ({ key: `cg:${k}`, src: CG[k].src, title: CG[k].title, sub: k }));
    const bg: Item[] = Object.entries(BG)
      .filter(([, v]) => v)
      .map(([k, v]) => ({ key: `bg:${k}`, src: v as string, title: k }));
    const stand: { head: string; items: Item[] }[] = [];
    for (const who of Object.keys(STAND) as CharKey[]) {
      const sets: [string, StandSet][] = [["base", STAND[who]], ...Object.entries(OUTFITS[who] ?? {})] as [string, StandSet][];
      for (const [of, set] of sets) {
        const items: Item[] = [];
        if (set.base) items.push({ key: `st:${who}:${of}:base`, src: set.base, title: FACE_KO.base, tall: true });
        for (const [f, src] of Object.entries(set.faces))
          if (src) items.push({ key: `st:${who}:${of}:${f}`, src, title: FACE_KO[f] ?? f, sub: f, tall: true });
        stand.push({ head: `${NAME[who]} · ${OUTFIT_KO[of] ?? of}`, items });
      }
    }
    const ui: Item[] = [
      { key: "ui:title", src: TITLE.bg, title: "타이틀 배경" },
      { key: "ui:logo", src: TITLE.logo, title: "타이틀 로고" },
    ];
    return { cg, bg, stand, ui };
  }, []);

  const count = (k: Key) => uses.get(k)?.length ?? 0;

  const card = (it: Item) => {
    const n = count(it.key);
    return (
      <button
        key={it.key}
        onClick={() => setOpen(it)}
        className="group flex flex-col overflow-hidden rounded-[0.5cqw] border border-white/10 bg-white/[0.04] text-left hover:border-[#ffd27a]/60"
      >
        <div className={`relative w-full ${it.tall ? "aspect-[2/3] bg-[#2a2a2a]" : "aspect-video bg-black"}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={it.src} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-contain" />
        </div>
        <div className="flex items-center gap-[0.5cqw] px-[0.6cqw] py-[0.4cqw]">
          <span className="flex-1 truncate text-[1.05cqw] text-white/90">{it.title}</span>
          <span className={`text-[0.95cqw] ${n ? "text-[#ffd27a]" : it.key.startsWith("ui:") ? "text-white/40" : "text-[#ff8a8a]"}`}>
            {it.key.startsWith("ui:") ? "타이틀" : n ? `${n}곳` : "안 나옴"}
          </span>
        </div>
      </button>
    );
  };

  const TABS = [
    ["cg", `CG ${groups.cg.length}`],
    ["stand", `스탠딩 ${groups.stand.reduce((n, g) => n + g.items.length, 0)}`],
    ["bg", `배경 ${groups.bg.length}`],
    ["ui", "타이틀"],
  ] as const;

  const list = open ? (uses.get(open.key) ?? []) : [];

  return (
    <div className="absolute inset-0 flex flex-col bg-[#0b0806]/95 text-[1.2cqw] text-white/85">
      <div className="flex items-center gap-[1cqw] border-b border-white/10 px-[2cqw] py-[1cqw]">
        <div className="lv-logo text-[2cqw]">그림 에셋</div>
        <div className="flex gap-[0.4cqw]">
          {TABS.map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`rounded-full border px-[1cqw] py-[0.3cqw] text-[1.05cqw] ${tab === k ? "border-[#ffd27a] bg-[#ffd27a]/15 text-[#ffd27a]" : "border-white/15 text-white/60 hover:text-white"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex-1 text-[1cqw] text-white/45">눌러서 크게 · 어느 장면에서 나오는지 · 숫자 = 나오는 곳 수</div>
        <button className="lv-btn-ghost text-[1.1cqw]" onClick={onBack}>
          닫기
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-[2cqw] py-[1.2cqw]">
        {tab === "stand" ? (
          groups.stand.map((g) => (
            <div key={g.head} className="mb-[1.6cqw]">
              <div className="mb-[0.6cqw] text-[1.3cqw] font-bold text-[#e9d9b0]">{g.head}</div>
              <div className="grid grid-cols-8 gap-[0.8cqw]">{g.items.map(card)}</div>
            </div>
          ))
        ) : (
          <div className={`grid gap-[1cqw] ${tab === "ui" ? "grid-cols-2" : "grid-cols-4"}`}>
            {(tab === "cg" ? groups.cg : tab === "bg" ? groups.bg : groups.ui).map(card)}
          </div>
        )}
      </div>
      {open && (
        <div className="absolute inset-0 z-10 flex bg-black/85" onClick={() => setOpen(null)}>
          <div className="flex flex-[3] items-center justify-center p-[2cqw]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={open.src}
              alt=""
              className="max-h-full max-w-full object-contain"
              style={open.tall ? { background: "#2a2a2a" } : undefined}
            />
          </div>
          <div className="flex flex-[2] flex-col overflow-hidden border-l border-white/10 bg-[#0b0806] p-[1.6cqw]" onClick={(e) => e.stopPropagation()}>
            <div className="text-[1.6cqw] font-bold text-[#ffd27a]">{open.title}</div>
            <div className="mb-[0.8cqw] break-all text-[0.95cqw] text-white/40">{open.src}</div>
            <div className="mb-[0.6cqw] text-[1.05cqw] text-white/60">
              {list.length ? `나오는 곳 ${list.length}` : open.key.startsWith("ui:") ? "타이틀 화면" : "대본에서 안 나옴"}
            </div>
            <ul className="flex-1 space-y-[0.6cqw] overflow-y-auto pr-[0.5cqw]">
              {list.map((u, k) => (
                <li key={k} className="rounded-[0.4cqw] bg-white/[0.04] px-[0.8cqw] py-[0.5cqw]">
                  <div className="text-[0.95cqw] text-[#e9d9b0]">
                    {u.scene} · {u.i}번째
                    {u.want && <span className="ml-[0.5cqw] text-[#ff8a8a]">({FACE_KO[u.want] ?? u.want} 대신)</span>}
                  </div>
                  <div className="text-[1.05cqw] leading-[1.5] text-white/85">{u.line || "—"}</div>
                </li>
              ))}
            </ul>
            <button className="lv-btn-ghost mt-[1cqw] self-end text-[1.1cqw]" onClick={() => setOpen(null)}>
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
