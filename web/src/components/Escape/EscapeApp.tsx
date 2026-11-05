"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { B02 } from "./b02";
import { DARKROOM } from "./darkroom";
import { DialogueBox, Loading, Notebook, SpecCard, useAssets, vsrc } from "./parts";
import { Report2, Payoffs, grade } from "./report2";
import { DIRS, H, W, type Ctx, type Dir, type Line, type Room, type State } from "./types";

/*
 * 방탈출 — 방 4면 + 확대 장면 + 인벤토리. 진행은 전부 방 데이터대로, 저장은 방마다 localStorage.
 *  - 물건 클릭 → 대사 / 확대 / 아이템 획득. 아이템을 고른 채로 물건 클릭 = 그 아이템 쓰기, 아이템끼리 고르면 = 겹치기
 *  - 대사 창 (이름표 · 글자 하나씩) + 진행에 묶인 장면 (Room.events)
 *  - 사건 노트 (Room.notebook): 질문 아래로 퍼즐 풀며 사실이 채워짐
 *  - 힌트: 지금 막힌 퍼즐 하나만, 3단계까지 (보고서 구간 포함)
 *  - 탈출하면 보고서 → 판정 · 떡밥 회수 → 엔딩
 */

const ROOMS: Room[] = [DARKROOM, B02];
/** 확대 장면 자리에 띄우는 도입 다시 보기 */
const INTRO = "__intro";

const fresh = (): State => ({
  view: "N",
  inv: [],
  flags: {},
  sel: null,
  open: null,
  t0: 0,
  t1: null,
  hint: {},
  phase: "intro",
  result: null,
});

export const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
export const hintCount = (s: State) => Object.values(s.hint).reduce((a, b) => a + b, 0);

function Canvas({ paint, className }: { paint: (g: CanvasRenderingContext2D) => void; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const g = ref.current?.getContext("2d");
    if (!g) return;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, W, H);
    paint(g);
  }, [paint]);
  return <canvas ref={ref} width={W} height={H} className={className} style={{ imageRendering: "pixelated", width: "100%", height: "auto", display: "block" }} />;
}

/** 방 고르기 → 그 방 플레이 */
export default function EscapeApp() {
  const [id, setId] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, string>>({});
  useEffect(() => {
    const q = new URLSearchParams(location.search).get("room");
    const v: Record<string, string> = {};
    for (const r of ROOMS) {
      try {
        const raw = localStorage.getItem(`escape.${r.id}`);
        if (!raw) continue;
        const st = JSON.parse(raw) as State;
        v[r.id] = st.phase === "end" ? "탈출 완료" : st.phase === "intro" ? "" : "이어하기";
      } catch {
        // 무시
      }
    }
    setSaved(v);
    if (q && ROOMS.some((r) => r.id === q)) setId(q);
  }, []);
  const pick = (v: string | null) => {
    setId(v);
    const u = new URL(location.href);
    if (v) u.searchParams.set("room", v);
    else u.searchParams.delete("room");
    history.replaceState(null, "", u);
  };
  const room = ROOMS.find((r) => r.id === id);
  if (room) return <Game key={room.id} room={room} onExit={() => pick(null)} />;
  return (
    <div className="mx-auto grid max-w-[860px] gap-3 text-[#e9e4d8] sm:grid-cols-2">
      {ROOMS.map((r) => (
        <button key={r.id} onClick={() => pick(r.id)} className="rounded-2xl border border-[#3a302a] bg-[#18151a] p-4 text-left transition hover:border-[#c0392b]">
          <p className="text-[12px] tracking-[0.2em] text-[#b49b6a]">{r.card.tag}</p>
          <p className="mt-1 text-[20px] font-black">
            {r.card.emoji} {r.title}
          </p>
          <p className="mt-1 text-[14px] leading-snug text-[#cfc8bb]" style={{ fontFamily: "'Gowun Batang', serif" }}>
            {r.card.blurb}
          </p>
          <p className="mt-2 text-[12px] text-[#a9a29a]">
            ⏱ {r.card.time} · 난도 {"★".repeat(r.card.level)} · 공포도 {"★".repeat(r.card.fear) || "없음"}
            {saved[r.id] && <span className="ml-2 rounded bg-[#3a2420] px-1.5 py-0.5 text-[#f3c7b8]">{saved[r.id]}</span>}
          </p>
        </button>
      ))}
    </div>
  );
}

function Game({ room: ROOM, onExit }: { room: Room; onExit: () => void }) {
  const KEY = `escape.${ROOM.id}`;
  const [s, setS] = useState<State>(fresh);
  const [loaded, setLoaded] = useState(false);
  /** 시계용 지금 시각 (렌더 중에 Date.now 를 부르지 않게) */
  const [now, setNow] = useState(0);
  const [hintOpen, setHintOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [itemInfo, setItemInfo] = useState<string | null>(null);
  /** 대사: 기다리는 줄 · 마지막 줄 · 지난 대사 */
  const [queue, setQueue] = useState<Line[]>([]);
  const [last, setLast] = useState<Line | null>(null);
  const [log, setLog] = useState<Line[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const assets = useAssets(ROOM.assets);

  /** 이야기 줄(talk · 장면)은 쌓고, 혼잣말(say)은 이전 혼잣말만 밀어냄 — 장면 대사가 다음 클릭에 묻히지 않게 */
  const pushLines = useCallback((lines: Line[], aside = false) => {
    if (!lines.length) return;
    setQueue((q) => (aside ? [...q.filter((l) => l.keep), ...lines] : [...q, ...lines.map((l) => ({ ...l, keep: true }))]));
    setLog((l) => [...l, ...lines].slice(-80));
  }, []);
  const nextLine = () => {
    if (queue[0]) setLast(queue[0]);
    setQueue((q) => q.slice(1));
  };
  const skipLines = () => {
    if (queue.length) setLast(queue[queue.length - 1]);
    setQueue([]);
  };

  // 저장된 진행 불러오기 · 저장
  useEffect(() => {
    try {
      const v = localStorage.getItem(KEY);
      if (v) setS({ ...fresh(), ...(JSON.parse(v) as State), open: null });
    } catch {
      // 새로 시작
    }
    setLoaded(true);
  }, [KEY]);
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      // 저장 안 되면 이번 창에서만
    }
  }, [s, loaded, KEY]);

  // 시계
  useEffect(() => {
    if (s.phase !== "play") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [s.phase]);

  const ctx: Ctx = useMemo(
    () => ({
      s,
      set: setS,
      say: (m) => pushLines([{ who: ROOM.me, text: m }], true),
      talk: (lines) => pushLines(lines),
      open: (id) => setS((x) => ({ ...x, open: id })),
      has: (i) => s.inv.includes(i),
      flag: (f) => !!s.flags[f],
      setFlag: (f, v = true) => setS((x) => (!!x.flags[f] === v ? x : { ...x, flags: { ...x.flags, [f]: v } })),
      give: (i) => setS((x) => (x.inv.includes(i) ? x : { ...x, inv: [...x.inv, i] })),
      take: (i) => setS((x) => ({ ...x, inv: x.inv.filter((y) => y !== i), sel: x.sel === i ? null : x.sel })),
    }),
    [s, ROOM.me, pushLines]
  );

  // 진행에 묶인 장면: 조건이 처음 맞는 순간 한 번
  useEffect(() => {
    if (s.phase !== "play" || !ROOM.events) return;
    const ev = ROOM.events.find((e) => !s.flags[`ev:${e.id}`] && e.when(s));
    if (!ev) return;
    setS((x) => ({ ...x, flags: { ...x.flags, [`ev:${ev.id}`]: true } }));
    pushLines(ev.lines);
    ev.run?.(ctx);
  }, [s, ROOM.events, pushLines, ctx]);

  // 노트에 사실이 새로 들어오면 잠깐 알림
  const factCount = ROOM.notebook ? ROOM.notebook.facts.filter((f) => f.got(s)).length : 0;
  const prevFacts = useRef<number | null>(null);
  useEffect(() => {
    if (!loaded || !ROOM.notebook) return;
    if (prevFacts.current !== null && factCount > prevFacts.current) {
      const f = ROOM.notebook.facts.filter((x) => x.got(s)).pop();
      setToast(`📒 노트에 적었다 (${factCount}/${ROOM.notebook.facts.length})${f ? ` — ${f.text}` : ""}`);
      const t = setTimeout(() => setToast(null), 3200);
      prevFacts.current = factCount;
      return () => clearTimeout(t);
    }
    prevFacts.current = factCount;
  }, [factCount, loaded, ROOM.notebook, s]);

  // 탈출하면 잠깐 뒤 보고서로
  const escaped = ROOM.escaped(s);
  useEffect(() => {
    if (s.phase !== "play" || !escaped || queue.length) return;
    const t = setTimeout(() => {
      setS((x) => ({ ...x, phase: "report", open: null, sel: null, t1: x.t1 ?? Date.now() }));
    }, 1600);
    return () => clearTimeout(t);
  }, [s.phase, escaped, queue.length]);

  const wall = ROOM.walls[s.view];
  const [vw, vh] = wall.size ?? [W, H];
  const variant = ROOM.variant?.(s) ?? "";
  const paintWall = useCallback((g: CanvasRenderingContext2D) => wall.paint?.(g, s), [wall, s]);
  const uv = s.sel === "uv" && !!s.flags.uvOn;

  const turn = (k: number) => {
    const i = DIRS.indexOf(s.view);
    setS((x) => ({ ...x, view: DIRS[(i + k + 4) % 4] as Dir, open: null }));
  };

  const tapItem = (id: string) => {
    setItemInfo(null);
    if (!s.sel || s.sel === id) {
      setS((x) => ({ ...x, sel: x.sel === id ? null : id }));
      return;
    }
    const a = s.sel;
    if (!ROOM.combine(a, id, ctx)) ctx.say(`${ROOM.items[a].name}와(과) ${ROOM.items[id].name}은(는) 같이 쓸 수 없을 것 같다.`);
    setS((x) => ({ ...x, sel: null }));
  };

  const current = ROOM.hints.find((h) => !h.report && !h.done(s) && (h.ready?.(s) ?? true));

  if (!loaded) return null;
  if (!assets.ready) return <Loading pct={assets.pct} title={ROOM.title} />;

  const back = (
    <button onClick={onExit} className="mb-3 text-[13px] text-[#a9a29a] hover:text-[#e9e4d8]">
      ← 방 목록
    </button>
  );
  const introArt = ROOM.introImg ? (
    <img src={ROOM.introImg} alt="" className="block w-full" />
  ) : ROOM.introPaint ? (
    <Canvas paint={ROOM.introPaint} />
  ) : null;

  // ── 도입 ──
  if (s.phase === "intro")
    return (
      <div className="mx-auto max-w-[760px] text-[#e9e4d8]">
        {back}
        <div className="overflow-hidden rounded-xl border-4 border-[#2b2930] bg-black">{introArt}</div>
        <div className="mt-3">
          <SpecCard room={ROOM} />
        </div>
        <div className="mt-3 rounded-xl bg-[#1b1a20] p-4 text-[15px] leading-relaxed" style={{ fontFamily: "'Gowun Batang', serif" }}>
          {ROOM.intro}
        </div>
        <ul className="mt-3 space-y-1 text-[13px] text-[#a9a29a]">
          <li>· 물건을 누르면 살펴봐요. 좌우 화살표로 방을 돌아봐요.</li>
          <li>· 아이템을 고른 채로 물건을 누르면 그 아이템을 써요. 아이템끼리 고르면 겹쳐 봐요.</li>
          <li>· 찍어서 푸는 문제는 없어요. 방에 있는 기록들을 맞대어 보세요.</li>
          {ROOM.notebook && <li>· 📒 사건 노트에 알아낸 사실이 쌓여요. 탈출한 뒤 보고서는 노트의 질문에 답하는 거예요.</li>}
        </ul>
        <button
          onClick={() => {
            setS({ ...fresh(), phase: "play", t0: Date.now() });
            setLog([]);
            setLast(null);
            setQueue([]);
            pushLines(ROOM.start ?? []);
          }}
          className="mt-4 w-full rounded-xl bg-[#e9c46a] py-3 text-[16px] font-bold text-[#1d1a12]"
        >
          수색 시작
        </button>
      </div>
    );

  // ── 보고서 ──
  if (s.phase === "report")
    return ROOM.report2 ? <Report2 room={ROOM} s={s} setS={setS} /> : <Report room={ROOM} s={s} setS={setS} />;

  // ── 엔딩 ──
  if (s.phase === "end" && s.result) {
    const t = mmss((s.t1 ?? s.t0) - s.t0);
    const g = ROOM.report2 ? grade(s) : null;
    const share = async () => {
      const text = `방탈출 「${ROOM.title}」 탈출 ${t} · 힌트 ${hintCount(s)}${g ? ` · 등급 ${g}` : ""} · ${s.result!.truth ? "진엔딩 🔎" : "노멀엔딩 🚪"}\nhttps://gunmo.my/games/escape?room=${ROOM.id}`;
      try {
        if (navigator.share) await navigator.share({ text });
        else {
          await navigator.clipboard.writeText(text);
          setShareMsg("결과를 복사했어요.");
        }
      } catch {
        // 공유 취소
      }
    };
    return (
      <div className="mx-auto max-w-[620px] text-[#e9e4d8]">
        {back}
        <div className="rounded-2xl border border-[#3a3326] bg-[#18171c] p-5">
          <p className="text-center text-[13px] tracking-[0.3em] text-[#b49b6a]">{s.result.truth ? "TRUE END" : "NORMAL END"}</p>
          <h2 className="mt-1 text-center text-[24px] font-black">{s.result.truth ? "진실에 닿았다" : "탈출은 했지만…"}</h2>
          <div className={`mt-4 grid gap-2 text-center ${g ? "grid-cols-4" : "grid-cols-3"}`}>
            <Stat k="탈출 시간" v={t} />
            <Stat k="힌트" v={`${hintCount(s)}번`} />
            {g ? <Stat k="보고서 오답" v={`${s.miss ?? 0}번`} /> : <Stat k="보고서" v={s.result.truth ? "정답" : "오답"} />}
            {g && <Stat k="등급" v={g} />}
          </div>
          {ROOM.report2 && s.result.truth && <Payoffs room={ROOM} />}
          <div className="mt-4 text-[15px] leading-relaxed" style={{ fontFamily: "'Gowun Batang', serif" }}>
            {s.result.truth ? ROOM.endings.truth : ROOM.endings.normal}
          </div>
          {shareMsg && <p className="mt-2 text-center text-[13px] text-[#a9a29a]">{shareMsg}</p>}
          <div className="mt-4 flex gap-2">
            <button onClick={share} className="flex-1 rounded-xl bg-[#e9c46a] py-2.5 font-bold text-[#1d1a12]">
              결과 공유
            </button>
            {!s.result.truth && (
              <button onClick={() => setS((x) => ({ ...x, phase: "report", result: null }))} className="flex-1 rounded-xl border border-[#3a3326] py-2.5">
                보고서 다시 쓰기
              </button>
            )}
            <button
              onClick={() => {
                setS(fresh());
                setQueue([]);
                setLast(null);
              }}
              className="flex-1 rounded-xl border border-[#3a3326] py-2.5"
            >
              처음부터
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── 플레이 (review = 탈출 뒤 현장 다시 보기) ──
  const review = s.phase === "review";
  // 사건 메모 = 도입 컷 다시 보기 (도입에만 나오는 단서를 기억력 싸움으로 만들지 않게)
  const close =
    s.open === INTRO
      ? {
          title: "사건 메모",
          render: () => (
            <div className="space-y-3">
              {introArt && <div className="mx-auto max-w-[520px] overflow-hidden rounded-lg border-2 border-[#2b2930]">{introArt}</div>}
              <div className="text-[15px] leading-relaxed" style={{ fontFamily: "'Gowun Batang', serif" }}>
                {ROOM.intro}
              </div>
            </div>
          ),
        }
      : ROOM.closeups[s.open ?? ""];
  const wallImg = wall.img ? vsrc(typeof wall.img === "function" ? wall.img(s) : wall.img, variant) : null;
  const facts = ROOM.notebook ? `${factCount}/${ROOM.notebook.facts.length}` : "";

  const stage = (
    <div>
      {/* 방 · 확대 장면 */}
      {close && (
        <div className="min-h-[300px] rounded-xl border-4 border-[#2b2930] bg-[#141318] p-3 sm:p-5">
          <div className="mb-3 flex items-center">
            <p className="text-[15px] font-bold text-[#e9c46a]">{close.title}</p>
            <button onClick={() => ctx.open(null)} className="ml-auto rounded-md bg-[#2b2a30] px-3 py-1 text-[13px]">
              ✕ 닫기
            </button>
          </div>
          {close.render(ctx)}
        </div>
      )}
      <div className={`relative overflow-hidden rounded-xl border-4 border-[#2b2930] bg-black ${close ? "hidden" : ""}`}>
        {wallImg ? (
                <img src={wallImg} alt={wall.name} className="block h-auto w-full select-none" draggable={false} />
        ) : (
          <Canvas paint={paintWall} />
        )}
        {wall.overlay?.(s)}
        {uv && <div className="pointer-events-none absolute inset-0 bg-[#4b2a8a]/25 mix-blend-screen" />}
        {!close &&
          wall.spots
            .filter((sp) => sp.show?.(s) ?? true)
            .map((sp) => (
              <button
                key={sp.id}
                title={sp.label}
                aria-label={sp.label}
                onClick={() => {
                  setItemInfo(null);
                  sp.click(ctx);
                }}
                className="group absolute rounded-[3px] outline-2 outline-offset-0 outline-transparent transition hover:bg-white/10 hover:outline-[#e9c46a]"
                style={{
                  left: `${(sp.rect[0] / vw) * 100}%`,
                  top: `${(sp.rect[1] / vh) * 100}%`,
                  width: `${(sp.rect[2] / vw) * 100}%`,
                  height: `${(sp.rect[3] / vh) * 100}%`,
                }}
              >
                <span className="pointer-events-none absolute -top-6 left-1/2 z-10 hidden -translate-x-1/2 rounded bg-black/80 px-1.5 py-0.5 text-[11px] whitespace-nowrap text-white group-hover:block">
                  {sp.label}
                </span>
              </button>
            ))}
        {!close && (
          <>
            <button onClick={() => turn(-1)} aria-label="왼쪽으로" className="absolute top-1/2 left-1 -translate-y-1/2 rounded-full bg-black/55 px-2.5 py-2 text-[18px] hover:bg-black/80">
              ◀
            </button>
            <button onClick={() => turn(1)} aria-label="오른쪽으로" className="absolute top-1/2 right-1 -translate-y-1/2 rounded-full bg-black/55 px-2.5 py-2 text-[18px] hover:bg-black/80">
              ▶
            </button>
          </>
        )}
        {toast && (
          <p className="pointer-events-none absolute right-2 bottom-2 left-2 rounded-lg bg-black/80 px-3 py-1.5 text-center text-[13px] text-[#f3e3c8]">{toast}</p>
        )}
      </div>

      <DialogueBox queue={queue} last={last} log={log} onNext={nextLine} onSkip={skipLines} placeholder="물건을 눌러 살펴보세요." />

      {/* 인벤토리 */}
      <div className="mt-1 rounded-xl bg-[#1b1a20] p-2">
        <Inventory room={ROOM} s={s} onTap={tapItem} />
        {s.sel && (
          <div className="mt-2 flex items-center gap-2 border-t border-[#2c2a31] pt-2 text-[13px]">
            <span className="text-[#e9c46a]">
              {ROOM.items[s.sel].icon} {ROOM.items[s.sel].name} 고름
            </span>
            <span className="hidden text-[#8f8676] sm:inline">— 물건을 누르면 쓰고, 다른 아이템을 누르면 겹쳐 봐요</span>
            <button
              onClick={() => {
                const it = ROOM.items[s.sel!];
                if (it.view) ctx.open(it.view);
                else setItemInfo(typeof it.desc === "function" ? it.desc(s) : it.desc);
              }}
              className="ml-auto rounded-md bg-[#2b2a30] px-2 py-1"
            >
              자세히
            </button>
          </div>
        )}
        {itemInfo && <p className="mt-1 px-1 text-[13px] text-[#cfc8bb]">{itemInfo}</p>}
      </div>
    </div>
  );

  return (
    <div className={`mx-auto text-[#e9e4d8] ${ROOM.notebook ? "max-w-[1180px]" : "max-w-[960px]"}`}>
      {/* 위 줄 */}
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]">
        <button onClick={onExit} className="rounded-md px-1.5 py-1 text-[#a9a29a] hover:text-[#e9e4d8]" aria-label="방 목록">
          ←
        </button>
        <span className="rounded-md bg-[#1b1a20] px-2.5 py-1 font-mono text-[15px]">⏱ {mmss((review ? (s.t1 ?? s.t0) : Math.max(now, s.t0)) - s.t0)}</span>
        {review && (
          <button onClick={() => setS((x) => ({ ...x, phase: "report", open: null, sel: null }))} className="rounded-md bg-[#e9c46a] px-2.5 py-1 font-bold text-[#1d1a12]">
            📝 보고서로 돌아가기
          </button>
        )}
        <span className="rounded-md bg-[#1b1a20] px-2.5 py-1">
          📍 {ROOM.title} · {wall.name}
        </span>
        {uv && <span className="rounded-md bg-[#3a2a5a] px-2.5 py-1 text-[#e1cfff]">🔦 UV 켜짐</span>}
        {ROOM.hud?.(ctx)}
        <span className="ml-auto" />
        {ROOM.notebook && (
          <button onClick={() => setNoteOpen((v) => !v)} className="rounded-md border border-[#5a3a33] px-2.5 py-1 text-[#f3c7b8] lg:hidden">
            📒 노트 {facts}
          </button>
        )}
        <button onClick={() => ctx.open(s.open === INTRO ? null : INTRO)} className="rounded-md border border-[#3a3842] px-2.5 py-1 text-[#cfc8bb]">
          📋 사건 메모
        </button>
        {!review && (
          <button onClick={() => setHintOpen((v) => !v)} className="rounded-md border border-[#5a4a2a] px-2.5 py-1 text-[#e9c46a]">
            💡 힌트 {hintCount(s) ? `(${hintCount(s)})` : ""}
          </button>
        )}
      </div>
      {review && (
        <p className="mb-2 rounded-lg bg-[#211d14] px-3 py-2 text-[13px] text-[#f0dca0]">
          🔍 현장을 다시 둘러보는 중이에요. 시간은 멈춰 있어요. 다 봤으면 &quot;보고서로 돌아가기&quot;.
        </p>
      )}
      {hintOpen && !review && <HintBox current={current} s={s} setS={setS} />}
      {ROOM.notebook && noteOpen && (
        <div className="mb-2 lg:hidden">
          <Notebook room={ROOM} s={s} />
        </div>
      )}
      {ROOM.notebook ? (
        <div className="grid gap-3 lg:grid-cols-[1fr_290px]">
          {stage}
          <div className="hidden lg:block">
            <Notebook room={ROOM} s={s} />
          </div>
        </div>
      ) : (
        stage
      )}
    </div>
  );
}

export function HintBox({ current, s, setS }: { current: Room["hints"][number] | undefined; s: State; setS: (fn: (s: State) => State) => void }) {
  return (
    <div className="mb-2 rounded-xl border border-[#5a4a2a] bg-[#211d14] p-3 text-[14px]">
      {current ? (
        <>
          <p className="mb-1 text-[12px] text-[#b49b6a]">지금 막힌 곳: {current.title}</p>
          {current.lines.slice(0, s.hint[current.id] ?? 0).map((l, i) => (
            <p key={i} className="text-[#f0dca0]">
              {i + 1}. {l}
            </p>
          ))}
          {(s.hint[current.id] ?? 0) < 3 && (
            <button
              onClick={() => setS((x) => ({ ...x, hint: { ...x.hint, [current.id]: (x.hint[current.id] ?? 0) + 1 } }))}
              className="mt-2 rounded-md bg-[#e9c46a] px-3 py-1 text-[13px] font-bold text-[#1d1a12]"
            >
              {(s.hint[current.id] ?? 0) === 0 ? "힌트 보기" : (s.hint[current.id] ?? 0) === 2 ? "답 보기" : "더 자세히"} (기록에 남아요)
            </button>
          )}
        </>
      ) : (
        <p>지금은 막힌 곳이 없어요. 방을 더 둘러보세요.</p>
      )}
    </div>
  );
}

/** 인벤토리: 도구 / 증거 칸 (kind 없는 방은 한 줄) */
function Inventory({ room, s, onTap }: { room: Room; s: State; onTap: (id: string) => void }) {
  const chip = (id: string) => {
    const it = room.items[id];
    const on = s.sel === id;
    const b = it.badge?.(s);
    return (
      <button
        key={id}
        onClick={() => onTap(id)}
        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[14px] ${on ? "border-[#e9c46a] bg-[#3a3120]" : "border-[#33313a] bg-[#24232a]"}`}
      >
        <span className="text-[18px]">{it.icon}</span>
        {it.name}
        {b && <span className={`text-[10px] ${b.on ? "text-[#cdb4ff]" : "text-[#8a8580]"}`}>{b.text}</span>}
      </button>
    );
  };
  const split = Object.values(room.items).some((i) => i.kind);
  if (!split)
    return (
      <div className="flex flex-wrap gap-1.5">
        {s.inv.length === 0 && <p className="px-1 py-1.5 text-[13px] text-[#77716a]">가진 물건이 없어요.</p>}
        {s.inv.map(chip)}
      </div>
    );
  const tools = s.inv.filter((i) => room.items[i].kind !== "evidence");
  const ev = s.inv.filter((i) => room.items[i].kind === "evidence");
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div>
        <p className="mb-1 px-1 text-[11px] tracking-wider text-[#8f8676]">🧰 도구 — 고른 채로 물건을 눌러 써요</p>
        <div className="flex flex-wrap gap-1.5">
          {tools.length ? tools.map(chip) : <p className="px-1 py-1.5 text-[13px] text-[#77716a]">없음</p>}
        </div>
      </div>
      <div>
        <p className="mb-1 px-1 text-[11px] tracking-wider text-[#8f8676]">🗂 증거 — 모아 두는 것. 보고서에 써요</p>
        <div className="flex flex-wrap gap-1.5">{ev.length ? ev.map(chip) : <p className="px-1 py-1.5 text-[13px] text-[#77716a]">없음</p>}</div>
      </div>
    </div>
  );
}

function Opt({ on, children, onClick, disabled }: { on: boolean; children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border px-3 py-2 text-left text-[14px] ${on ? "border-[#e9c46a] bg-[#3a3120]" : "border-[#33313a] bg-[#1f1e24]"} disabled:opacity-35`}
    >
      {children}
    </button>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg bg-[#0f0e12] py-2">
      <p className="text-[11px] text-[#8f8676]">{k}</p>
      <p className="text-[17px] font-black">{v}</p>
    </div>
  );
}

/** (1호 방식) 탈출 후 보고서: 범인 · 상태 · 근거 2개 */
function Report({ room: ROOM, s, setS }: { room: Room; s: State; setS: (fn: (s: State) => State) => void }) {
  const R = ROOM.report!;
  // 쓰다 만 보고서는 State(draft)에 둠 → 현장 다시 보러 갔다 와도 그대로
  const d = s.draft ?? { culprit: "", status: "", evidence: [] };
  const { culprit, status, evidence: ev } = d;
  const put = (p: Partial<typeof d>) => setS((x) => ({ ...x, draft: { ...(x.draft ?? { culprit: "", status: "", evidence: [] }), ...p } }));
  const setCulprit = (v: string) => put({ culprit: v });
  const setStatus = (v: string) => put({ status: v });
  const setEv = (f: (v: string[]) => string[]) => put({ evidence: f(ev) });
  const ready = culprit && status && ev.length === 2;
  const submit = () => {
    const good = ev.every((id) => R.evidence.find((e) => e.id === id)?.good);
    const truth = culprit === R.answer.culprit && status === R.answer.status && good;
    setS((x) => ({ ...x, phase: "end", result: { culprit, status, evidence: ev, truth } }));
  };
  return (
    <div className="mx-auto max-w-[620px] text-[#e9e4d8]">
      <div className="rounded-2xl border border-[#3a3326] bg-[#18171c] p-5">
        <p className="text-center text-[13px] tracking-[0.3em] text-[#b49b6a]">ESCAPED · {mmss((s.t1 ?? s.t0) - s.t0)}</p>
        <h2 className="mt-1 text-center text-[22px] font-black">수사 보고서</h2>
        <p className="mt-1 text-center text-[13px] text-[#a9a29a]">보일러실 뒤 계단으로 빠져나왔다. 무전으로 보고하기 전에 정리하자.</p>
        <button
          onClick={() => setS((x) => ({ ...x, phase: "review", open: null, sel: null }))}
          className="mx-auto mt-3 block rounded-lg border border-[#5a4a2a] px-4 py-1.5 text-[13px] text-[#e9c46a]"
        >
          🔍 현장 다시 둘러보기 (시간 안 흐름 · 쓰던 내용 그대로)
        </button>

        <p className="mt-5 mb-2 font-bold">1. 문을 밖에서 잠근 사람은?</p>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {R.culprits.map((o) => (
            <Opt key={o.id} on={culprit === o.id} onClick={() => setCulprit(o.id)}>
              {o.label}
            </Opt>
          ))}
        </div>

        <p className="mt-4 mb-2 font-bold">2. 서하는 지금?</p>
        <div className="grid gap-1.5 sm:grid-cols-3">
          {R.statuses.map((o) => (
            <Opt key={o.id} on={status === o.id} onClick={() => setStatus(o.id)}>
              {o.label}
            </Opt>
          ))}
        </div>

        <p className="mt-4 mb-1 font-bold">3. 1번에 고른 사람이 범인이라는 근거 두 개</p>
        <p className="mb-2 text-[12px] text-[#8f8676]">수색하면서 본 것만 고를 수 있어요. 다른 사람을 지우는 근거가 아니라, 그 사람을 직접 가리키는 근거로.</p>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {R.evidence.map((e) => {
            const seen = e.seen(s);
            const on = ev.includes(e.id);
            return (
              <Opt key={e.id} on={on} disabled={!seen} onClick={() => setEv((v) => (on ? v.filter((x) => x !== e.id) : v.length < 2 ? [...v, e.id] : [v[1], e.id]))}>
                {seen ? e.label : "??? (못 찾음)"}
              </Opt>
            );
          })}
        </div>

        <button onClick={submit} disabled={!ready} className="mt-5 w-full rounded-xl bg-[#e9c46a] py-3 font-bold text-[#1d1a12] disabled:opacity-40">
          보고하기
        </button>
      </div>
    </div>
  );
}
