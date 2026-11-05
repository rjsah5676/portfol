"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { B02 } from "./b02";
import { DIRS, H, W, type Ctx, type Dir, type Room, type State } from "./types";

/*
 * 방탈출 (프로토) — 픽셀 방 4면 + 확대 장면 + 인벤토리. 진행은 전부 방 데이터(b02.tsx)대로, 저장은 localStorage.
 *  - 물건 클릭 → 말 / 확대 / 아이템 획득. 아이템을 고른 채로 물건 클릭 = 그 아이템 쓰기, 아이템끼리 고르면 = 겹치기
 *  - 힌트: 지금 막힌 퍼즐 하나만, 3단계까지
 *  - 탈출하면 보고서 (범인 · 상태 · 근거 2개) → 진엔딩 / 노멀엔딩
 */

const ROOM: Room = B02;
const KEY = `escape.${ROOM.id}`;

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

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const hintCount = (s: State) => Object.values(s.hint).reduce((a, b) => a + b, 0);

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

export default function EscapeApp() {
  const [s, setS] = useState<State>(fresh);
  const [msg, setMsg] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  /** 시계용 지금 시각 (렌더 중에 Date.now 를 부르지 않게) */
  const [now, setNow] = useState(0);
  const [hintOpen, setHintOpen] = useState(false);
  const [itemInfo, setItemInfo] = useState<string | null>(null);

  // 저장된 진행 불러오기 · 저장
  useEffect(() => {
    try {
      const v = localStorage.getItem(KEY);
      if (v) setS({ ...fresh(), ...(JSON.parse(v) as State), open: null });
    } catch {
      // 새로 시작
    }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      // 저장 안 되면 이번 창에서만
    }
  }, [s, loaded]);

  // 시계
  useEffect(() => {
    if (s.phase !== "play") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [s.phase]);

  // 탈출하면 잠깐 뒤 보고서로
  useEffect(() => {
    if (s.phase !== "play" || !ROOM.escaped(s)) return;
    const t = setTimeout(() => {
      setMsg("");
      setS((x) => ({ ...x, phase: "report", open: null, sel: null, t1: x.t1 ?? Date.now() }));
    }, 1600);
    return () => clearTimeout(t);
  }, [s]);

  const ctx: Ctx = useMemo(
    () => ({
      s,
      set: setS,
      say: setMsg,
      open: (id) => setS((x) => ({ ...x, open: id })),
      has: (i) => s.inv.includes(i),
      flag: (f) => !!s.flags[f],
      setFlag: (f, v = true) => setS((x) => (x.flags[f] === v ? x : { ...x, flags: { ...x.flags, [f]: v } })),
      give: (i) => setS((x) => (x.inv.includes(i) ? x : { ...x, inv: [...x.inv, i] })),
      take: (i) => setS((x) => ({ ...x, inv: x.inv.filter((y) => y !== i), sel: x.sel === i ? null : x.sel })),
    }),
    [s]
  );

  const wall = ROOM.walls[s.view];
  const paintWall = useCallback((g: CanvasRenderingContext2D) => wall.paint(g, s), [wall, s]);
  const uv = s.sel === "uv" && !!s.flags.uvOn;

  const turn = (k: number) => {
    const i = DIRS.indexOf(s.view);
    setS((x) => ({ ...x, view: DIRS[(i + k + 4) % 4] as Dir, open: null }));
    setMsg("");
  };

  const tapItem = (id: string) => {
    setItemInfo(null);
    if (!s.sel || s.sel === id) {
      setS((x) => ({ ...x, sel: x.sel === id ? null : id }));
      return;
    }
    const a = s.sel;
    if (!ROOM.combine(a, id, ctx)) setMsg(`${ROOM.items[a].name}와(과) ${ROOM.items[id].name}은(는) 같이 쓸 수 없을 것 같다.`);
    setS((x) => ({ ...x, sel: null }));
  };

  const current = ROOM.hints.find((h) => !h.done(s) && (h.ready?.(s) ?? true));

  if (!loaded) return null;

  // ── 도입 ──
  if (s.phase === "intro")
    return (
      <div className="mx-auto max-w-[760px] text-[#e9e4d8]">
        <div className="overflow-hidden rounded-xl border-4 border-[#2b2930] bg-black">
          {ROOM.introPaint && <Canvas paint={ROOM.introPaint} />}
        </div>
        <div className="mt-4 rounded-xl bg-[#1b1a20] p-4 text-[15px] leading-relaxed" style={{ fontFamily: "'Gowun Batang', serif" }}>
          {ROOM.intro}
        </div>
        <ul className="mt-3 space-y-1 text-[13px] text-[#a9a29a]">
          <li>· 물건을 누르면 살펴봐요. 좌우 화살표로 방을 돌아봐요.</li>
          <li>· 아이템을 고른 채로 물건을 누르면 그 아이템을 써요. 아이템끼리 고르면 겹쳐 봐요.</li>
          <li>· 찍어서 푸는 문제는 없어요. 방에 있는 기록들을 맞대어 보세요.</li>
        </ul>
        <button
          onClick={() => setS({ ...fresh(), phase: "play", t0: Date.now() })}
          className="mt-4 w-full rounded-xl bg-[#e9c46a] py-3 text-[16px] font-bold text-[#1d1a12]"
        >
          수색 시작
        </button>
      </div>
    );

  // ── 보고서 ──
  if (s.phase === "report") return <Report s={s} setS={setS} />;

  // ── 엔딩 ──
  if (s.phase === "end" && s.result) {
    const t = mmss((s.t1 ?? s.t0) - s.t0);
    const share = async () => {
      const text = `방탈출 「${ROOM.title}」 탈출 ${t} · 힌트 ${hintCount(s)} · ${s.result!.truth ? "진엔딩 🔎" : "노멀엔딩 🚪"}\nhttps://gunmo.my/games/escape`;
      try {
        if (navigator.share) await navigator.share({ text });
        else {
          await navigator.clipboard.writeText(text);
          setMsg("결과를 복사했어요.");
        }
      } catch {
        // 공유 취소
      }
    };
    return (
      <div className="mx-auto max-w-[620px] text-[#e9e4d8]">
        <div className="rounded-2xl border border-[#3a3326] bg-[#18171c] p-5">
          <p className="text-center text-[13px] tracking-[0.3em] text-[#b49b6a]">{s.result.truth ? "TRUE END" : "NORMAL END"}</p>
          <h2 className="mt-1 text-center text-[24px] font-black">{s.result.truth ? "진실에 닿았다" : "탈출은 했지만…"}</h2>
          <div className="mt-4 text-[15px] leading-relaxed" style={{ fontFamily: "'Gowun Batang', serif" }}>
            {s.result.truth ? ROOM.endings.truth : ROOM.endings.normal}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <Stat k="탈출 시간" v={t} />
            <Stat k="힌트" v={`${hintCount(s)}번`} />
            <Stat k="보고서" v={s.result.truth ? "정답" : "오답"} />
          </div>
          {msg && <p className="mt-2 text-center text-[13px] text-[#a9a29a]">{msg}</p>}
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
                setMsg("");
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

  // ── 플레이 ──
  const close = ROOM.closeups[s.open ?? ""];
  return (
    <div className="mx-auto max-w-[960px] text-[#e9e4d8]">
      {/* 위 줄 */}
      <div className="mb-2 flex items-center gap-2 text-[13px]">
        <span className="rounded-md bg-[#1b1a20] px-2.5 py-1 font-mono text-[15px]">⏱ {mmss(Math.max(now, s.t0) - s.t0)}</span>
        <span className="rounded-md bg-[#1b1a20] px-2.5 py-1">
          📍 {ROOM.title} · {wall.name}
        </span>
        {uv && <span className="rounded-md bg-[#3a2a5a] px-2.5 py-1 text-[#e1cfff]">🔦 UV 켜짐</span>}
        <button onClick={() => setHintOpen((v) => !v)} className="ml-auto rounded-md border border-[#5a4a2a] px-2.5 py-1 text-[#e9c46a]">
          💡 힌트 {hintCount(s) ? `(${hintCount(s)})` : ""}
        </button>
      </div>

      {hintOpen && (
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
                  {(s.hint[current.id] ?? 0) === 0 ? "힌트 보기" : "더 자세히"} (기록에 남아요)
                </button>
              )}
            </>
          ) : (
            <p>지금은 막힌 곳이 없어요. 방을 더 둘러보세요.</p>
          )}
        </div>
      )}

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
        <Canvas paint={paintWall} />
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
                  left: `${(sp.rect[0] / W) * 100}%`,
                  top: `${(sp.rect[1] / H) * 100}%`,
                  width: `${(sp.rect[2] / W) * 100}%`,
                  height: `${(sp.rect[3] / H) * 100}%`,
                }}
              >
                <span className="pointer-events-none absolute -top-6 left-1/2 hidden -translate-x-1/2 rounded bg-black/80 px-1.5 py-0.5 text-[11px] whitespace-nowrap text-white group-hover:block">
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
      </div>

      {/* 말 */}
      <p className="mt-2 min-h-[44px] rounded-lg bg-[#1b1a20] px-3 py-2 text-[14px] leading-snug" style={{ fontFamily: "'Gowun Batang', serif" }}>
        {msg || <span className="text-[#77716a]">물건을 눌러 살펴보세요.</span>}
      </p>

      {/* 인벤토리 */}
      <div className="mt-2 rounded-xl bg-[#1b1a20] p-2">
        <div className="flex flex-wrap gap-1.5">
          {s.inv.length === 0 && <p className="px-1 py-1.5 text-[13px] text-[#77716a]">가진 물건이 없어요.</p>}
          {s.inv.map((id) => {
            const it = ROOM.items[id];
            const on = s.sel === id;
            return (
              <button
                key={id}
                onClick={() => tapItem(id)}
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[14px] ${
                  on ? "border-[#e9c46a] bg-[#3a3120]" : "border-[#33313a] bg-[#24232a]"
                }`}
              >
                <span className="text-[18px]">{it.icon}</span>
                {it.name}
                {id === "uv" && s.flags.uvOn && <span className="text-[10px] text-[#cdb4ff]">ON</span>}
              </button>
            );
          })}
        </div>
        {s.sel && (
          <div className="mt-2 flex items-center gap-2 border-t border-[#2c2a31] pt-2 text-[13px]">
            <span className="text-[#e9c46a]">
              {ROOM.items[s.sel].icon} {ROOM.items[s.sel].name} 고름
            </span>
            <span className="text-[#8f8676]">— 물건을 누르면 쓰고, 다른 아이템을 누르면 겹쳐 봐요</span>
            <button
              onClick={() => {
                const it = ROOM.items[s.sel!];
                if (it.view) ctx.open(it.view);
                else setItemInfo(it.desc);
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

/** 탈출 후 보고서: 범인 · 서하의 상태 · 근거 2개 */
function Report({ s, setS }: { s: State; setS: (fn: (s: State) => State) => void }) {
  const R = ROOM.report;
  const [culprit, setCulprit] = useState("");
  const [status, setStatus] = useState("");
  const [ev, setEv] = useState<string[]>([]);
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

        <p className="mt-4 mb-1 font-bold">3. 결정적인 근거 두 개</p>
        <p className="mb-2 text-[12px] text-[#8f8676]">수색하면서 본 것만 고를 수 있어요.</p>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {R.evidence.map((e) => {
            const seen = e.seen(s);
            const on = ev.includes(e.id);
            return (
              <Opt
                key={e.id}
                on={on}
                disabled={!seen}
                onClick={() => setEv((v) => (on ? v.filter((x) => x !== e.id) : v.length < 2 ? [...v, e.id] : [v[1], e.id]))}
              >
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
