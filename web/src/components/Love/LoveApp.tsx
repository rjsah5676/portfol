"use client";

/*
 * 올인 러브 (가제) — ANIME POKER 외전 미연시 · M1 프로토
 * 로딩(진행률) → 타이틀 → 이름 → 본편. 대본은 lib/love/script.ts, 실행기는 lib/love/engine.ts
 * 저장: localStorage (못 쓰는 환경이어도 게임은 그대로 돌아감)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BG, BG_FALLBACK, BGM, BGM_ONCE, BLINK_OK, ENDINGS, FACE_ICON, NAME, NAME_COLOR, SFX, STAND, TITLE, preloadList } from "@/lib/love/assets";
import { type GState, goScene, ignorePhone, initState, lineKey, miniDone, next, pick, run } from "@/lib/love/engine";
import { type ReactLine, idleLine, touchLine } from "@/lib/love/reactions";
import type { BgmId, CharKey, EndingId, Face, Opt, SfxId, Who } from "@/lib/love/types";
import { DealMini, StoryPoker, TellMini } from "./Minis";

// ---------- 저장소 (실패해도 조용히) ----------
const LS = {
  get(k: string): string | null {
    try {
      return window.localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      window.localStorage.setItem(k, v);
    } catch {}
  },
};
const KEY = { save: (n: string) => `love:save:${n}`, endings: "love:endings", seen: "love:seen", name: "love:name", mute: "love:mute" };
interface SaveData {
  s: GState;
  name: string;
  ts: number;
  label: string;
}
const readSave = (n: string): SaveData | null => {
  const t = LS.get(KEY.save(n));
  if (!t) return null;
  try {
    return JSON.parse(t) as SaveData;
  } catch {
    return null;
  }
};
const SLOTS = ["1", "2", "3", "4", "5", "6"];

// ---------- 소리 ----------
function useSound(muted: boolean) {
  const mute = useRef(muted);
  const bgmEl = useRef<HTMLAudioElement | null>(null);
  const cur = useRef<BgmId | null>(null);
  useEffect(() => {
    mute.current = muted;
    if (bgmEl.current) bgmEl.current.volume = muted ? 0 : 0.3;
  }, [muted]);
  const play = useCallback((id: SfxId) => {
    if (mute.current) return;
    const a = new Audio(SFX[id]);
    a.volume = 0.55;
    a.play().catch(() => {});
  }, []);
  const bgm = useCallback((id: BgmId | null) => {
    if (cur.current === id) return;
    cur.current = id;
    bgmEl.current?.pause();
    bgmEl.current = null;
    const url = id ? BGM[id] : null;
    if (!id || !url) return;
    const a = new Audio(url);
    a.loop = !BGM_ONCE.includes(id);
    a.volume = mute.current ? 0 : 0.3;
    bgmEl.current = a;
    // 자동 재생이 막히면(첫 화면) 첫 클릭 때 다시 시도
    a.play().catch(() => {
      const retry = () => {
        if (bgmEl.current === a) a.play().catch(() => {});
      };
      window.addEventListener("pointerdown", retry, { once: true });
      window.addEventListener("keydown", retry, { once: true });
    });
  }, []);
  return { play, bgm };
}

type Phase = "loading" | "title" | "name" | "game" | "gallery";
type Panel = null | "log" | "save" | "load";

export default function LoveApp() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [prog, setProg] = useState(0);
  const [s, setS] = useState<GState | null>(null);
  const [name, setName] = useState("한도윤");
  const [typed, setTyped] = useState(0);
  const [auto, setAuto] = useState(false);
  const [skip, setSkip] = useState(false);
  const [log, setLog] = useState<{ who: Who; text: string }[]>([]);
  const [panel, setPanel] = useState<Panel>(null);
  const [endings, setEndings] = useState<EndingId[]>([]);
  const [muted, setMuted] = useState(false);
  const [hideUi, setHideUi] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [phoneShown, setPhoneShown] = useState(0);
  /** 방치 · 터치 반응 (말풍선 + 잠깐 표정) */
  const [react, setReact] = useState<(ReactLine & { who: CharKey; n: number; seq: number }) | null>(null);
  const [touchHint, setTouchHint] = useState(false);
  const seen = useRef<Set<string>>(new Set());
  const wrap = useRef<HTMLDivElement>(null);
  const { play, bgm } = useSound(muted);

  const sub = useCallback((t: string) => t.replaceAll("{name}", name), [name]);
  const flash = (t: string) => {
    setToast(t);
    window.setTimeout(() => setToast(null), 1400);
  };

  // ---------- 로딩: 그림 · 소리 전부 받은 뒤 시작 ----------
  useEffect(() => {
    try {
      setEndings(JSON.parse(LS.get(KEY.endings) ?? "[]"));
      seen.current = new Set(JSON.parse(LS.get(KEY.seen) ?? "[]"));
    } catch {}
    const n = LS.get(KEY.name);
    if (n) setName(n);
    setMuted(LS.get(KEY.mute) === "1");
    const { img, audio } = preloadList();
    const total = img.length + audio.length;
    let done = 0;
    const tick = () => {
      done++;
      setProg(Math.round((done / total) * 100));
      if (done >= total) window.setTimeout(() => setPhase("title"), 250);
    };
    img.forEach((u) => {
      const im = new Image();
      im.onload = tick;
      im.onerror = tick;
      im.src = u;
    });
    audio.forEach((u) => {
      fetch(u).then(tick, tick);
    });
  }, []);

  // 사이트 퀵메뉴(≡) 버튼이 게임 오른쪽 아래 버튼(블러프다 · 레이즈 등)을 가려서 이 페이지에선 숨김
  useEffect(() => {
    const qm = document.querySelector<HTMLElement>("[data-quickmenu]");
    if (!qm) return;
    qm.style.display = "none";
    return () => {
      qm.style.display = "";
    };
  }, []);

  // ---------- 타이틀 · 이름 · 엔딩 수집 화면은 메인 테마 ----------
  useEffect(() => {
    if (phase === "title" || phase === "name" || phase === "gallery") bgm("title");
  }, [phase, bgm]);

  // ---------- 상태가 바뀔 때: 소리 · 백로그 · 타자 효과 초기화 ----------
  useEffect(() => {
    if (!s) return;
    s.fx.forEach(play);
    const b = s.block;
    // 스토리 포커 중엔 전용 곡, 배드 엔딩 카드엔 짧은 코다
    const endKind = b?.k === "ending" ? ENDINGS.find((e) => e.id === b.id)?.kind : null;
    bgm(b?.k === "mini" && b.step.kind === "poker" ? "spoker" : endKind === "bad" ? "badend" : s.disp.bgm);
    if (b?.k === "say") {
      setTyped(0);
      setLog((l) => [...l.slice(-199), { who: b.who, text: b.text }]);
    }
    if (b?.k === "phone") {
      setPhoneShown(0);
      play("phone");
    }
    if (b?.k === "goTitle") {
      bgm(null);
      setPhase("title");
    }
    if (b?.k === "ending") {
      window.setTimeout(() => play("stamp"), 4400);
      setEndings((e) => {
        if (e.includes(b.id)) return e;
        const n = [...e, b.id];
        LS.set(KEY.endings, JSON.stringify(n));
        return n;
      });
    }
    if (b && b.k !== "say") setSkip(false);
    // 선택지 직전 자동 저장 (최근 3개 돌려 씀) — 분기점이면 알림음
    if (b?.k === "choice" || b?.k === "free") {
      const a1 = readSave("a1");
      if (!a1 || a1.s.scene !== s.scene || a1.s.i !== s.i) {
        const a2 = LS.get(KEY.save("a2"));
        if (a2) LS.set(KEY.save("a3"), a2);
        if (a1) LS.set(KEY.save("a2"), JSON.stringify(a1));
        const data: SaveData = { s, name, ts: Date.now(), label: `${s.disp.day ? `DAY ${s.disp.day.d} · ${s.disp.day.slot}` : "프롤로그"}  ${b.k === "free" ? "자유 행동" : (b.prompt ?? "선택지").slice(0, 22)}` };
        LS.set(KEY.save("a1"), JSON.stringify(data));
      }
      if (b.big) play("heart");
    }
    // s.seq 로만 반응 (같은 상태 다시 그릴 때 소리 중복 X)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.seq]);

  const block = s?.block ?? null;
  const fullText = block?.k === "say" ? sub(block.text) : "";
  const typing = block?.k === "say" && typed < fullText.length;

  // 타자 효과
  useEffect(() => {
    if (!typing) return;
    if (skip) {
      setTyped(fullText.length);
      return;
    }
    const id = window.setInterval(() => setTyped((n) => Math.min(fullText.length, n + 1)), 24);
    return () => window.clearInterval(id);
  }, [typing, skip, fullText.length]);

  const markSeen = useCallback(() => {
    if (!s) return;
    seen.current.add(lineKey(s));
    LS.set(KEY.seen, JSON.stringify([...seen.current]));
  }, [s]);

  const advance = useCallback(() => {
    if (!s || panel) return;
    const b = s.block;
    if (!b) return;
    if (b.k === "say") {
      if (typed < sub(b.text).length) {
        setTyped(sub(b.text).length);
        return;
      }
      markSeen();
      play("click");
      setS(next(s));
    } else if (b.k === "day" || b.k === "title") {
      setS(next(s));
    }
  }, [s, panel, typed, sub, markSeen, play]);

  // 날짜 · 제목 카드는 잠깐 보여 주고 자동으로 넘어감
  useEffect(() => {
    if (block?.k !== "day" && block?.k !== "title") return;
    const id = window.setTimeout(advance, skip ? 200 : block.k === "day" ? 1500 : 2300);
    return () => window.clearTimeout(id);
  }, [block, advance, skip]);

  // 오토 · 스킵
  useEffect(() => {
    if (block?.k !== "say" || panel) return;
    if (skip) {
      if (!seen.current.has(lineKey(s!))) {
        setSkip(false);
        flash("읽지 않은 대사 — 스킵 멈춤");
        return;
      }
      const id = window.setTimeout(advance, 45);
      return () => window.clearTimeout(id);
    }
    if (auto && !typing) {
      const id = window.setTimeout(advance, 1100 + fullText.length * 38);
      return () => window.clearTimeout(id);
    }
  }, [block, skip, auto, typing, advance, panel, fullText.length, s]);

  // 메시지 말풍선 하나씩
  useEffect(() => {
    if (block?.k !== "phone") return;
    if (phoneShown >= block.step.msgs.length) return;
    const id = window.setTimeout(() => setPhoneShown((n) => n + 1), 650);
    return () => window.clearTimeout(id);
  }, [block, phoneShown]);

  // ---------- 살아 있는 스탠딩: 반응 ----------
  const showReact = useCallback(
    (who: CharKey, r: ReactLine, seq: number) => {
      setReact({ ...r, who, n: Date.now(), seq });
      if (r.heart) play("heart");
    },
    [play],
  );
  // 반응 말풍선은 잠깐만 (대사가 넘어가면 seq 가 달라져서 바로 안 보임)
  useEffect(() => {
    if (!react) return;
    const id = window.setTimeout(() => setReact(null), 2600);
    return () => window.clearTimeout(id);
  }, [react]);
  const liveReact = react && s && react.seq === s.seq ? react : null;
  // 방치: 대사를 다 띄워 둔 채 18초 그대로면 히로인이 먼저 말을 검 (한 대사에 한 번)
  useEffect(() => {
    if (phase !== "game" || !s || block?.k !== "say" || typing || panel || auto || skip || hideUi) return;
    const on: CharKey[] = (Object.keys(s.disp.chars) as CharKey[]).filter((k) => k !== "boss");
    if (!on.length) return;
    const who = on.includes(block.who as CharKey) ? (block.who as CharKey) : on[0];
    const id = window.setTimeout(() => showReact(who, idleLine(who, s.vars), s.seq), 18000);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s?.seq, typing, panel, auto, skip, hideUi, phase]);
  /** 화면 숨김(HIDE) 중 캐릭터를 누르면 반응 — 머리는 쓰다듬기, 나머지는 콕 */
  const touchAt = (x: number, y: number): boolean => {
    if (!s) return false;
    for (const el of document.elementsFromPoint(x, y)) {
      const w = (el as HTMLElement).closest?.("[data-who]") as HTMLElement | null;
      if (!w) continue;
      const who = w.dataset.who as CharKey;
      const r = w.getBoundingClientRect();
      // 그림 가장자리 투명한 곳은 빼고 가운데 몸통 쪽만
      if (Math.abs(x - (r.left + r.width / 2)) > r.width * 0.32) continue;
      const head = (y - r.top) / r.height < HEAD_Y + 0.03;
      showReact(who, touchLine(who, head ? "head" : "body", s.vars), s.seq);
      return true;
    }
    return false;
  };

  // 키보드: 스페이스 · 엔터 = 다음, Ctrl 누르는 동안 스킵, Esc = 창 닫기
  useEffect(() => {
    if (phase !== "game") return;
    const down = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanel(null);
      if (e.key === "Control") setSkip(true);
      if ((e.code === "Space" || e.code === "Enter") && !panel) {
        e.preventDefault();
        advance();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Control") setSkip(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [phase, advance, panel]);

  // ---------- 동작 ----------
  const newGame = () => {
    LS.set(KEY.name, name);
    setLog([]);
    setAuto(false);
    setSkip(false);
    // 개발 중에만: ?scene=d4 로 원하는 장면부터 테스트
    const dev = process.env.NODE_ENV !== "production" ? new URLSearchParams(window.location.search).get("scene") : null;
    setS(run(dev ? { ...initState(), scene: dev, i: 0 } : initState()));
    setPhase("game");
  };
  const choose = (o: Opt) => {
    if (!s) return;
    play("chip");
    markSeen();
    setS(pick(s, o));
  };
  const labelOf = (st: GState) => {
    const d = st.disp.day ? `DAY ${st.disp.day.d} · ${st.disp.day.slot}` : "프롤로그";
    const t = st.block?.k === "say" ? sub(st.block.text).slice(0, 26) : "";
    return `${d}  ${t}`;
  };
  const save = (n: string) => {
    if (!s) return;
    const data: SaveData = { s, name, ts: Date.now(), label: labelOf(s) };
    LS.set(KEY.save(n), JSON.stringify(data));
    flash(n === "q" ? "퀵세이브" : `${n}번에 저장`);
    setPanel(null);
  };
  const load = (n: string) => {
    const d = readSave(n);
    if (!d) return flash("저장된 게 없어요");
    setName(d.name);
    setLog([]);
    setS({ ...d.s, seq: d.s.seq + 1, fx: [] });
    setPhase("game");
    setPanel(null);
  };
  /** 직전 선택지로: 지금 선택지 앞이면 그 전 것, 아니면 가장 최근 자동 저장 */
  const backToChoice = () => {
    if (!s) return;
    const a1 = readSave("a1");
    const atChoice = (block?.k === "choice" || block?.k === "free") && a1 && a1.s.scene === s.scene && a1.s.i === s.i;
    const n = atChoice ? "a2" : "a1";
    if (!readSave(n)) return flash("돌아갈 선택지가 없어요");
    load(n);
    flash("직전 선택지로 돌아왔어요");
  };
  const latestSave = useMemo(() => {
    if (phase !== "title") return null;
    let best: { n: string; ts: number } | null = null;
    for (const n of [...SLOTS, "q"]) {
      const d = readSave(n);
      if (d && (!best || d.ts > best.ts)) best = { n, ts: d.ts };
    }
    return best?.n ?? null;
  }, [phase]);
  const toggleFull = () => {
    const el = wrap.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen?.().catch(() => {});
  };
  const toggleMute = () => {
    setMuted((m) => {
      LS.set(KEY.mute, m ? "0" : "1");
      return !m;
    });
  };

  // ---------- 그리기 ----------
  const disp = s?.disp;
  const chars = disp ? (Object.entries(disp.chars) as [CharKey, NonNullable<(typeof disp.chars)[CharKey]>][]) : [];
  const maxDist = chars.reduce((m, [, c]) => Math.max(m, c.dist), 0);
  const speaker = block?.k === "say" ? block.who : null;
  const ending = block?.k === "ending" ? ENDINGS.find((e) => e.id === block.id) : null;

  return (
    <div ref={wrap} className="lv-root">
      <div className="lv-stage" onClick={() => phase === "game" && !hideUi && advance()}>
        {/* ===== 로딩 ===== */}
        {phase === "loading" && (
          <div className="absolute inset-0 grid place-items-center bg-[#0b0806]">
            <div className="w-[46%] text-center">
              <div className="lv-logo text-[4.2cqw]">올인 러브</div>
              <div className="mt-[1.4cqw] h-[0.7cqw] overflow-hidden rounded-full bg-white/10">
                <div className="h-full bg-gradient-to-r from-[#c9a25a] to-[#ffd27a] transition-all" style={{ width: `${prog}%` }} />
              </div>
              <div className="mt-[0.8cqw] text-[1.3cqw] text-white/60">불러오는 중 {prog}%</div>
            </div>
          </div>
        )}

        {/* ===== 타이틀 ===== */}
        {(phase === "title" || phase === "name" || phase === "gallery") && (
          <div className="absolute inset-0">
            {/* 타이틀 키아트 (GPT 시안 그대로 — 캐릭터 둘 + 펍) */}
            <div
              className="absolute inset-0 bg-cover bg-center transition-[filter] duration-500"
              style={{ backgroundImage: `url("${TITLE.bg}")`, filter: phase !== "title" ? "blur(4px) brightness(.55)" : undefined }}
            />
            <div className="lv-title-sparks" />
            {phase === "title" && (
              <div className="absolute inset-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={TITLE.logo} alt="올인 러브" className="lv-title-logo" />
                <div className="absolute left-1/2 top-[47%] flex w-[21%] -translate-x-1/2 flex-col gap-[1.05cqw]">
                  <button className="lv-title-btn" onClick={() => setPhase("name")}>
                    <span className="lv-suit">♠</span>처음부터
                  </button>
                  <button className="lv-title-btn" disabled={!latestSave} onClick={() => latestSave && load(latestSave)}>
                    <span className="lv-suit text-[#e0505e]">♥</span>이어하기
                  </button>
                  <button className="lv-title-btn" onClick={() => setPanel("load")}>
                    <span className="lv-suit text-[#e0505e]">♦</span>불러오기
                  </button>
                  <button className="lv-title-btn" onClick={() => setPhase("gallery")}>
                    <span className="lv-suit">♣</span>엔딩 수집 <small className="ml-[0.4cqw] text-[1cqw] text-[#e9d9b0]/70">{endings.length}/{ENDINGS.length}</small>
                  </button>
                </div>
                <div className="absolute bottom-[2.2%] right-[2%] text-[1cqw] text-[#e9d9b0]/70">◇ M1 프로토 · Ver. 0.1</div>
              </div>
            )}
            {phase === "name" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-[1.2cqw]">
                <div className="text-[1.8cqw] text-white/85">주인공 이름</div>
                <input
                  value={name}
                  maxLength={6}
                  onChange={(e) => setName(e.target.value.trim() || "")}
                  onKeyDown={(e) => e.key === "Enter" && name && newGame()}
                  className="w-[24cqw] rounded-[0.6cqw] border border-[#c9a25a] bg-black/60 px-[1cqw] py-[0.6cqw] text-center text-[2cqw] text-white outline-none"
                />
                <div className="flex gap-[1cqw]">
                  <button className="lv-btn-gold" disabled={!name} onClick={newGame}>
                    시작
                  </button>
                  <button className="lv-btn-ghost" onClick={() => setPhase("title")}>
                    돌아가기
                  </button>
                </div>
              </div>
            )}
            {phase === "gallery" && <Gallery got={endings} onBack={() => setPhase("title")} />}
          </div>
        )}

        {/* ===== 본편 ===== */}
        {phase === "game" && s && disp && (
          <>
            <Bg id={disp.bg} blur={maxDist} />
            {chars.map(([k, c]) => {
              const pos = chars.length === 1 && c.dist > 0 ? "c" : c.pos;
              const face: Face = liveReact?.who === k ? liveReact.face : ((c.face as Face) ?? "base");
              // 말 꺼내는 순간: 동요 대사면 흔들림, 놀람 표정이면 폴짝 / 반응 때도 폴짝
              const fx =
                liveReact?.who === k
                  ? { kind: "hop" as const, n: liveReact.n }
                  : speaker === k && block?.k === "say" && (block.mood === "shake" || block.mood === "shout")
                    ? { kind: "shake" as const, n: s.seq }
                    : speaker === k && face === "surprise"
                      ? { kind: "hop" as const, n: s.seq }
                      : null;
              return <Sprite key={k} who={k} pos={pos} dist={c.dist} face={face} fxKind={fx?.kind} fxN={fx?.n ?? 0} dim={!!speaker && speaker !== k && chars.length > 1} />;
            })}
            {liveReact && disp.chars[liveReact.who] && (
              <ReactBubble x={POS_X[chars.length === 1 && disp.chars[liveReact.who]!.dist > 0 ? "c" : disp.chars[liveReact.who]!.pos]} dist={disp.chars[liveReact.who]!.dist} text={sub(liveReact.text)} />
            )}
            {disp.day && !hideUi && (
              <div className="lv-day">
                <span className="text-[#ffd27a]">♠</span> DAY {disp.day.d} · {disp.day.slot}
              </div>
            )}

            {/* 대사 */}
            {block?.k === "say" && !hideUi && (
              <Dialogue key={block.mood === "shake" || block.mood === "shout" ? s.seq : "box"} who={block.who} mood={block.mood} name={sub(NAME[block.who])} text={fullText.slice(0, typed)} done={!typing} />
            )}

            {/* 하단 버튼 */}
            {!hideUi && (block?.k === "say" || block?.k === "choice") && (
              <div className="lv-ctrl" onClick={(e) => e.stopPropagation()}>
                <Chip on={auto} onClick={() => setAuto((a) => !a)}>AUTO</Chip>
                <Chip on={skip} title="읽은 대사를 다음 선택지까지 넘겨요" onClick={() => setSkip((v) => !v)}>SKIP</Chip>
                <Chip title="직전 선택지로 돌아가기" onClick={backToChoice}>◀ 선택지</Chip>
                <Chip onClick={() => setPanel("log")}>LOG</Chip>
                <Chip onClick={() => setPanel("save")}>SAVE</Chip>
                <Chip onClick={() => setPanel("load")}>LOAD</Chip>
                <Chip onClick={() => save("q")}>Q.SAVE</Chip>
                <Chip onClick={() => load("q")}>Q.LOAD</Chip>
                <Chip
                  title="대사창을 숨기고 그림 보기 (캐릭터를 누르면 반응해요)"
                  onClick={() => {
                    setHideUi(true);
                    setTouchHint(true);
                  }}
                >
                  HIDE
                </Chip>
              </div>
            )}
            <div className="lv-top-right" onClick={(e) => e.stopPropagation()}>
              <Chip onClick={toggleMute}>{muted ? "🔇" : "♪"}</Chip>
              <Chip onClick={toggleFull}>⛶</Chip>
              <Chip
                onClick={() => {
                  bgm(null);
                  setPhase("title");
                }}
              >
                ≡
              </Chip>
            </div>
            {hideUi && (
              <div
                className="absolute inset-0 z-50"
                onClick={(e) => {
                  e.stopPropagation();
                  // 화면 숨김 중엔 그림 감상 + 터치 반응: 캐릭터를 누르면 반응, 빈 곳을 누르면 대사창 복귀
                  if (touchAt(e.clientX, e.clientY)) return setTouchHint(false);
                  setHideUi(false);
                }}
              >
                {touchHint && chars.some(([k]) => k !== "boss") && <div className="lv-touch-hint">캐릭터를 눌러 보세요 · 빈 곳을 누르면 돌아가요</div>}
              </div>
            )}

            {/* 선택지 */}
            {block?.k === "choice" && (
              <div className={`absolute inset-0 z-30 flex flex-col items-center justify-center gap-[1cqw] ${block.big ? "bg-black/55" : "bg-black/35"}`} onClick={(e) => e.stopPropagation()}>
                {block.big && <BranchBanner onSave={() => setPanel("save")} />}
                {block.prompt && <div className="mb-[0.5cqw] text-[1.6cqw] text-white/85 [text-shadow:0_2px_6px_#000]">{block.prompt}</div>}
                {block.opts.map((o) => (
                  <button key={o.text} className={`lv-choice ${o.secret ? "lv-choice-secret" : ""}`} onClick={() => choose(o)}>
                    {o.secret && <span className="mr-[0.6cqw] text-[#ffd27a]">★</span>}
                    {sub(o.text)}
                  </button>
                ))}
              </div>
            )}

            {/* 자유 슬롯 */}
            {block?.k === "free" && (
              <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/55" onClick={(e) => e.stopPropagation()}>
                {block.big && <BranchBanner onSave={() => setPanel("save")} />}
                <div className="mb-[1.5cqw] text-[2cqw] font-bold text-[#ffd27a]">{block.prompt}</div>
                <div className="flex gap-[1.5cqw]">
                  {block.opts.map((o) => (
                    <button key={o.text} className="lv-free" onClick={() => choose(o)}>
                      {sub(o.text)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 메시지 */}
            {block?.k === "phone" && (
              <div className="absolute inset-0 z-30 bg-black/40" onClick={(e) => e.stopPropagation()}>
                <div className="lv-phone">
                  <div className="flex items-center gap-[0.8cqw] border-b border-white/10 pb-[0.8cqw]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {FACE_ICON[block.step.from] && <img src={FACE_ICON[block.step.from]} alt="" className="h-[3cqw] w-[3cqw] rounded-full" />}
                    <b className="text-[1.5cqw]">{NAME[block.step.from]}</b>
                  </div>
                  <div className="flex flex-1 flex-col gap-[0.6cqw] overflow-hidden py-[1cqw]">
                    {block.step.msgs.slice(0, phoneShown).map((m) => (
                      <div key={m} className="lv-bubble">
                        {m}
                      </div>
                    ))}
                  </div>
                  {phoneShown >= block.step.msgs.length && (
                    <div className="flex flex-col gap-[0.5cqw]">
                      {block.step.replies.map((o) => (
                        <button key={o.text} className="lv-reply" onClick={() => choose(o)}>
                          {o.text}
                        </button>
                      ))}
                      <button className="lv-reply opacity-60" onClick={() => setS(ignorePhone(s, block.step.ignore))}>
                        (읽고 답장 안 하기)
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 미니게임 */}
            {block?.k === "mini" && (
              <div onClick={(e) => e.stopPropagation()}>
                {block.step.kind === "deal" ? (
                  <DealMini play={play} onDone={(n) => setS(miniDone(s, block.step.key, n))} />
                ) : block.step.kind === "poker" ? (
                  <StoryPoker spec={block.step.poker} play={play} onDone={(n, eff) => setS(miniDone(s, block.step.key, n, eff))} />
                ) : (
                  <TellMini tell={block.step.tell} onDone={(n) => setS(miniDone(s, block.step.key, n))} />
                )}
              </div>
            )}

            {/* 날짜 · 제목 카드 */}
            {block?.k === "day" && (
              <div className="lv-daycard">
                <div className="text-[6cqw] font-black tracking-widest text-white">DAY {block.d}</div>
                <div className="text-[2cqw] text-[#ffd27a]">{block.slot}</div>
              </div>
            )}
            {block?.k === "title" && (
              <div className="absolute inset-0 z-40 grid place-items-center bg-black">
                <div className="lv-fadein text-center">
                  <div className="text-[4.5cqw] font-black text-white">{block.text}</div>
                  {block.sub && <div className="mt-[0.6cqw] text-[1.6cqw] text-white/60">{block.sub}</div>}
                </div>
              </div>
            )}

            {/* 엔딩 */}
            {ending && (
              <div className="lv-end-wrap absolute inset-0 z-40 grid place-items-center" onClick={(e) => e.stopPropagation()}>
                <div className={`lv-end lv-k-${ending.kind}`}>
                  <div className="lv-end-a text-[1.2cqw] tracking-[0.6em] text-white/55" style={{ animationDelay: "0.9s" }}>
                    ENDING {String(ending.no).padStart(2, "0")} / {ENDINGS.length}
                  </div>
                  <div className="lv-end-a lv-end-title mt-[0.8cqw] text-[4.6cqw] font-black" style={{ animationDelay: "1.7s" }}>
                    {ending.title}
                  </div>
                  <div className="lv-end-line" style={{ animationDelay: "2.8s" }} />
                  <div className="lv-end-a mt-[1cqw] text-[1.7cqw] text-white/85" style={{ animationDelay: "3.3s" }}>
                    {ending.copy}
                  </div>
                  {ending.kind === "bad" && (
                    <div className="lv-end-a mt-[1.2cqw] text-[1.15cqw] text-white/45" style={{ animationDelay: "4.1s" }}>
                      다음엔 — {ending.hint}
                    </div>
                  )}
                  <div className="lv-end-stamp" style={{ animationDelay: "4.4s" }}>
                    수집 {endings.length} / {ENDINGS.length}
                  </div>
                  <div className="lv-end-a mt-[2.4cqw] flex justify-center gap-[1cqw]" style={{ animationDelay: "5.2s" }}>
                    {ending.review && (
                      <button className="lv-btn-gold" onClick={() => setS(goScene(s, ending.review!))}>
                        마감 후 반성회
                      </button>
                    )}
                    <button
                      className="lv-btn-ghost"
                      onClick={() => {
                        bgm(null);
                        setPhase("title");
                      }}
                    >
                      타이틀로
                    </button>
                  </div>
                </div>
              </div>
            )}
            {block?.k === "end" && (
              <div className="lv-end-wrap absolute inset-0 z-40 grid place-items-center" onClick={(e) => e.stopPropagation()}>
                <div className="lv-end lv-k-good">
                  <div className="lv-end-a text-[1.2cqw] tracking-[0.6em] text-white/55" style={{ animationDelay: "0.9s" }}>
                    TO BE CONTINUED
                  </div>
                  <div className="lv-end-a lv-end-title mt-[0.8cqw] text-[4cqw] font-black" style={{ animationDelay: "1.7s" }}>
                    {block.text}
                  </div>
                  <div className="lv-end-line" style={{ animationDelay: "2.8s" }} />
                  {block.sub && (
                    <div className="lv-end-a mt-[1cqw] text-[1.5cqw] text-white/75" style={{ animationDelay: "3.3s" }}>
                      {block.sub}
                    </div>
                  )}
                  <div className="lv-end-a mt-[2.4cqw] flex justify-center gap-[1cqw]" style={{ animationDelay: "4.4s" }}>
                    <button
                      className="lv-btn-gold"
                      onClick={() => {
                        bgm(null);
                        setPhase("title");
                      }}
                    >
                      타이틀로
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ===== 백로그 · 저장 · 불러오기 ===== */}
        {panel && (
          <div className="absolute inset-0 z-[60] flex flex-col bg-black/85 p-[2.5cqw]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-[1.2cqw] flex items-center justify-between">
              <b className="text-[2cqw] text-[#ffd27a]">{panel === "log" ? "지난 대사" : panel === "save" ? "저장" : "불러오기"}</b>
              <button className="lv-btn-ghost" onClick={() => setPanel(null)}>
                닫기
              </button>
            </div>
            {panel === "log" ? (
              <div className="flex-1 space-y-[0.8cqw] overflow-y-auto pr-[1cqw]">
                {log.map((l, i) => (
                  <div key={i} className="text-[1.45cqw] leading-relaxed">
                    {l.who !== "narr" && <b style={{ color: NAME_COLOR[l.who] }}>{sub(NAME[l.who])} </b>}
                    <span className={l.who === "narr" ? "text-white/70" : "text-white"}>{sub(l.text)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid flex-1 grid-cols-3 gap-[1cqw] overflow-y-auto">
                {[...SLOTS, "q", ...(panel === "load" ? ["a1", "a2", "a3"] : [])].map((n) => {
                  const d = readSave(n);
                  const can = panel === "save" ? n !== "q" && phase === "game" : !!d;
                  return (
                    <button key={n} disabled={!can} className={`lv-slot ${n.startsWith("a") ? "lv-slot-auto" : ""}`} onClick={() => (panel === "save" ? save(n) : load(n))}>
                      <div className="text-[1.2cqw] text-[#ffd27a]">{n === "q" ? "QUICK" : n.startsWith("a") ? `자동 · 선택지 ${n.slice(1)}` : `SLOT ${n}`}</div>
                      <div className="mt-[0.4cqw] text-[1.25cqw] text-white/85">{d ? d.label : "비어 있음"}</div>
                      {d && <div className="mt-[0.3cqw] text-[1cqw] text-white/45">{new Date(d.ts).toLocaleString("ko-KR")}</div>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {toast && <div className="lv-toast">{toast}</div>}
      </div>
      <div className="lv-rotate">가로로 돌려 주세요</div>
    </div>
  );
}

// ---------- 부품 ----------
function Bg({ id, blur }: { id: keyof typeof BG; blur: number }) {
  const u = BG[id];
  return (
    <div
      className="absolute inset-0 bg-cover bg-center transition-[filter] duration-700"
      style={{
        ...(u ? { backgroundImage: `url("${u}")` } : { background: BG_FALLBACK[id] }),
        filter: blur ? `blur(${blur * 3}px) brightness(${1 - blur * 0.13})` : undefined,
        transform: blur ? "scale(1.04)" : undefined,
      }}
    />
  );
}

const DIST_H = [168, 235, 360];
const DIST_TOP = [3, -1, -9];
const POS_X = { l: 28, c: 50, r: 72 };
/** 머리 위치 (스탠딩 높이 대비 비율) — 반응 말풍선 · 쓰다듬기 판정 */
const HEAD_Y = 0.17;

/**
 * 살아 있는 스탠딩: 숨쉬기 · 표정 갈아 끼우기(얼굴만 다른 같은 크기 그림을 겹쳐서 페이드) · 눈 깜빡임 ·
 * 놀람 폴짝 · 동요 흔들림. 거리 3단계는 위치 · 크기 전환
 */
function Sprite({
  who,
  pos,
  dist,
  dim,
  face,
  fxKind,
  fxN,
}: {
  who: CharKey;
  pos: "l" | "c" | "r";
  dist: 0 | 1 | 2;
  dim: boolean;
  face: Face;
  fxKind?: "hop" | "shake";
  /** 바뀔 때마다 fxKind 애니메이션 한 번 */
  fxN: number;
}) {
  const set = STAND[who];
  const body = useRef<HTMLDivElement>(null);
  const [blink, setBlink] = useState(false);
  const canBlink = !!set.blink && BLINK_OK.includes(face);

  // 눈 깜빡임: 2.6~6초마다, 가끔 두 번
  useEffect(() => {
    if (!canBlink) return;
    let t = 0;
    const loop = () => {
      t = window.setTimeout(
        () => {
          setBlink(true);
          window.setTimeout(() => setBlink(false), 110);
          if (Math.random() < 0.22) {
            window.setTimeout(() => setBlink(true), 260);
            window.setTimeout(() => setBlink(false), 370);
          }
          loop();
        },
        2600 + Math.random() * 3400,
      );
    };
    loop();
    return () => window.clearTimeout(t);
  }, [canBlink]);

  // 폴짝 · 흔들림 (다시 그리지 않고 애니메이션만)
  useEffect(() => {
    const el = body.current;
    if (!fxKind || !el?.animate) return;
    if (fxKind === "hop")
      el.animate([{ transform: "translateY(0)" }, { transform: "translateY(-1.6%)" }, { transform: "translateY(0)" }, { transform: "translateY(-0.5%)" }, { transform: "translateY(0)" }], { duration: 420, easing: "ease-out" });
    else
      el.animate(
        [{ transform: "translateX(0)" }, { transform: "translateX(-0.9%)" }, { transform: "translateX(0.9%)" }, { transform: "translateX(-0.6%)" }, { transform: "translateX(0.4%)" }, { transform: "translateX(0)" }],
        { duration: 380, easing: "linear" },
      );
    // fxN 이 바뀔 때만 (같은 대사에서 다시 그려질 땐 안 움직임)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fxN]);

  return (
    <div
      className="absolute"
      style={{
        left: `${POS_X[pos]}%`,
        top: `${DIST_TOP[dist]}%`,
        height: `${DIST_H[dist]}%`,
        transform: "translateX(-50%)",
        transition: "left .6s cubic-bezier(.2,.8,.2,1), top .6s cubic-bezier(.2,.8,.2,1), height .6s cubic-bezier(.2,.8,.2,1), filter .3s",
        filter: dim ? "brightness(.62)" : undefined,
      }}
    >
      <div ref={body} className="h-full">
        {set.base ? (
          <div className="lv-breathe relative h-full" data-who={who}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={set.base} alt={NAME[who]} draggable={false} className="h-full w-auto max-w-none" />
            {(Object.entries(set.faces) as [Face, string][]).map(([f, u]) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={f} src={u} alt="" draggable={false} className="lv-face" style={{ opacity: face === f ? 1 : 0 }} />
            ))}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {set.blink && <img src={set.blink} alt="" draggable={false} className="lv-face lv-face-blink" style={{ opacity: canBlink && blink ? 1 : 0 }} />}
          </div>
        ) : (
          <div className="lv-breathe flex h-full w-[22cqw] items-start justify-center rounded-t-full bg-gradient-to-b from-[#3a2c1e] to-transparent pt-[6cqw] text-[2cqw] text-[#e0b46a]/80">
            {NAME[who]}
          </div>
        )}
      </div>
    </div>
  );
}

/** 반응 말풍선 (방치 · 터치) — 캐릭터 머리 옆 */
function ReactBubble({ x, dist, text }: { x: number; dist: 0 | 1 | 2; text: string }) {
  const right = x <= 50;
  return (
    <div
      className="lv-react"
      style={{
        left: right ? `${x + [9, 12, 17][dist]}%` : undefined,
        right: right ? undefined : `${100 - x + [9, 12, 17][dist]}%`,
        top: `${[DIST_TOP[0] + DIST_H[0] * HEAD_Y * 0.55, 10, 14][dist]}%`,
      }}
    >
      {text}
    </div>
  );
}

function Dialogue({ who, mood, name, text, done }: { who: Who; mood: string; name: string; text: string; done: boolean }) {
  if (mood === "bare") {
    return (
      <div className="pointer-events-none absolute inset-x-[10%] bottom-[10%] z-20 text-center text-[2.4cqw] font-semibold leading-relaxed text-white [text-shadow:0_2px_10px_#000,0_0_24px_#000]">
        {text}
      </div>
    );
  }
  const narr = who === "narr";
  return (
    <div className={`lv-box ${mood === "whisper" ? "lv-box-whisper" : ""} ${mood === "heart" ? "lv-box-heart" : ""} ${mood === "shake" || mood === "shout" ? "lv-box-jolt" : ""}`}>
      {!narr && (
        <div className="lv-name" style={{ color: NAME_COLOR[who] }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {FACE_ICON[who] && <img src={FACE_ICON[who]} alt="" className="h-[2.4cqw] w-[2.4cqw] rounded-full" />}
          <span className="text-[#ffd27a]">♠</span> {name}
        </div>
      )}
      <div
        className={`lv-text ${narr ? "italic text-white/85" : ""} ${mood === "whisper" ? "lv-t-whisper" : ""} ${mood === "shake" ? "lv-t-shake" : ""} ${mood === "shout" ? "lv-t-shout" : ""} ${mood === "think" ? "text-[#cfc6b0]" : ""} ${mood === "heart" ? "lv-t-heart" : ""}`}
      >
        {mood === "think" ? `(${text}${done ? ")" : ""}` : text}
        {done && <span className="lv-next">◆</span>}
      </div>
    </div>
  );
}

function Chip({ children, onClick, on, title }: { children: React.ReactNode; onClick: () => void; on?: boolean; title?: string }) {
  return (
    <button className={`lv-chip ${on ? "lv-chip-on" : ""}`} onClick={onClick} title={title}>
      {children}
    </button>
  );
}

/** 큰 분기점 알림 — 잘 나가는 미연시들처럼 "여기서 저장해 두라"는 신호를 눈에 띄게 */
function BranchBanner({ onSave }: { onSave: () => void }) {
  return (
    <div className="lv-branch">
      <div className="text-[1.05cqw] tracking-[0.5em] text-[#ffd27a]">◆ 분기점 ◆</div>
      <div className="mt-[0.3cqw] text-[1.25cqw] text-white/85">이 선택에 따라 이야기가 갈려요. 선택 직전은 자동 저장됐어요.</div>
      <button className="lv-branch-save" onClick={onSave}>
        ♠ 지금 슬롯에 저장
      </button>
    </div>
  );
}

function Gallery({ got, onBack }: { got: EndingId[]; onBack: () => void }) {
  return (
    <div className="absolute inset-0 flex flex-col p-[2.5cqw]">
      <div className="mb-[1.2cqw] flex items-center justify-between">
        <b className="text-[2.2cqw] text-[#ffd27a]">
          엔딩 수집 {got.length} / {ENDINGS.length}
        </b>
        <button className="lv-btn-ghost" onClick={onBack}>
          돌아가기
        </button>
      </div>
      <div className="grid flex-1 grid-cols-6 gap-[0.8cqw]">
        {ENDINGS.map((e) => {
          const ok = got.includes(e.id);
          return (
            <div key={e.id} className={`lv-cell lv-k-${e.kind} ${ok ? "" : "lv-cell-locked"}`}>
              <div className="text-[0.95cqw] text-white/50">#{e.no}</div>
              <div className="mt-[0.3cqw] text-[1.3cqw] font-bold">{ok ? e.title : "???"}</div>
              <div className="mt-[0.3cqw] text-[0.95cqw] text-white/60">{ok ? e.copy : `조건: ${e.hint}`}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
