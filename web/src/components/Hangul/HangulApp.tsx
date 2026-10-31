"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { prepareRuns } from "@/lib/api/rankRun";
import { ApiError } from "@/lib/api/errors";
import {
  addByIds,
  addPunct,
  autoPair,
  best,
  pieces,
  bindWord,
  CAP,
  combine,
  CONS_SLOTS,
  VOWEL_SLOTS,
  draw,
  DRAW_EVERY,
  finishSentence,
  fromLine,
  lineCells,
  lineText,
  load,
  makeWord,
  say,
  LOAD_MAX,
  newGame,
  dropSentence,
  linkBonus,
  links,
  moveSentence,
  POS_STYLE,
  READ_SEC,
  score,
  SHELF_ID,
  writingPower,
  discard,
  setPath,
  statsOf,
  step,
  toLine,
  type Game,
  type Sentence,
  type Zone,
} from "@/lib/hangul/game";
import {
  gradeOf,
  HANGUL_WAVE_PTS,
  hangulLen,
  LINE_MAX,
  PUNCTS,
  withEnd,
  type Judge,
  type Morph,
} from "@/lib/hangul/judge";
import { shown } from "@/lib/hangul/jamo";
import {
  beginHangul,
  getHangulRanking,
  judgeLine,
  likedHangul,
  likeHangul,
  reportHangul,
  submitHangul,
  suggestLine,
  type HangulRanking,
  type HangulSort,
  type Suggestion,
} from "@/firestore/hangulRankings";
import { drawField } from "./draw";
import { shareCard } from "./shareCard";

/*
 * 니들이 한글을 알아? — 아무 말이나 이어 붙여 먹물을 막는 무한 디펜스 (프로토)
 * 진행은 lib/hangul/game.ts, 문장 판정은 서버(형태소 분석기 Kiwi)
 */

const TAG: [RegExp, string][] = [
  [/^NNB/, "의존명사"],
  [/^NN/, "명사"],
  [/^NP/, "대명사"],
  [/^NR/, "수사"],
  [/^VV/, "동사"],
  [/^VA/, "형용사"],
  [/^VX/, "보조용언"],
  [/^VCP/, "이다"],
  [/^VCN/, "아니다"],
  [/^MM/, "관형사"],
  [/^MA/, "부사"],
  [/^IC/, "감탄사"],
  [/^J/, "조사"],
  [/^EP/, "시제"],
  [/^EF/, "끝맺음"],
  [/^EC/, "이음"],
  [/^ET/, "바꿈"],
  [/^XS/, "꼬리"],
  [/^XP/, "머리"],
  [/^XR/, "어근"],
];
const tagName = (m: Morph) => (m.k ? (TAG.find(([re]) => re.test(m.t))?.[1] ?? m.t) : "모르는 말");

const NAME_KEY = "hangul-name";
const SECRET_KEY = "hangul-secret";
const ago = (d: Date | null) => {
  if (!d) return "";
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return "방금";
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}일 전`;
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
};
const fmt = (n: number) => Math.round(n).toLocaleString("ko-KR");

export default function HangulApp() {
  const [g, setG] = useState<Game>(newGame);
  const [, setTick] = useState(0);
  const [phase, setPhase] = useState<"ready" | "play" | "over">("ready");
  const [sel, setSel] = useState<{ z: Zone; i: number } | null>(null);
  const [wordBusy, setWordBusy] = useState(false);
  const [selling, setSelling] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [judge, setJudge] = useState<Judge | null>(null);
  const [judgeErr, setJudgeErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<Sentence | null>(null);
  const [ranks, setRanks] = useState<HangulRanking[] | null>(null);
  // 이름 칸은 판이 끝나야 그려서 서버 렌더와 어긋날 일 없음
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem(NAME_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [sent, setSent] = useState<"idle" | "sending" | "done" | "fail">("idle");
  // 시크릿 등록 (익명) — 고른 걸 기억해 둠
  const [secret, setSecret] = useState(() => {
    try {
      return localStorage.getItem(SECRET_KEY) === "1";
    } catch {
      return false;
    }
  });
  // 랭킹 창 (열려 있는 동안 판은 멈춤)
  const [rankOpen, setRankOpen] = useState(false);
  const [rankSort, setRankSort] = useState<HangulSort>("top");
  // 👍 웃겨요: 내가 누른 기록 · 누르는 중인 기록
  const [liked, setLiked] = useState<Set<string>>(() => new Set());
  const [liking, setLiking] = useState<string | null>(null);
  // 사전에 없는 말 신고한 줄 (같은 줄은 한 번만)
  const [reported, setReported] = useState<Set<string>>(() => new Set());
  const [sharing, setSharing] = useState(false);
  const [rankMsg, setRankMsg] = useState<string | null>(null);
  const [sugs, setSugs] = useState<{
    line: string;
    list: (Suggestion & { ids: number[] })[];
  } | null>(null);
  const [sugBusy, setSugBusy] = useState(false);

  const fieldRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const posRef = useRef(new Map<number, { x: number; y: number }>());
  const shelfRef = useRef<HTMLDivElement>(null);
  // 새 문장이 글 끝에 붙으면 목록을 맨 아래로
  const shelfLen = g.shelf.length;
  useEffect(() => {
    const el = shelfRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shelfLen]);
  const speedRef = useRef(1);
  const phaseRef = useRef(phase);
  const pauseRef = useRef(false);
  useEffect(() => {
    speedRef.current = speed;
    phaseRef.current = phase;
    pauseRef.current = rankOpen;
  }, [speed, phase, rankOpen]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  // 랭킹 · 이름
  const loadRanks = useCallback((sort: HangulSort) => {
    getHangulRanking(50, sort)
      .then((rs) => {
        setRanks(rs);
        likedHangul(rs.map((r) => r.id))
          .then(setLiked)
          .catch(() => {});
      })
      .catch(() => setRanks([]));
  }, []);
  useEffect(() => {
    prepareRuns();
  }, []);
  const toggleLike = async (r: HangulRanking) => {
    if (liking) return;
    const on = !liked.has(r.id);
    setLiking(r.id);
    try {
      const n = await likeHangul(r.id, on);
      setLiked((s) => {
        const t = new Set(s);
        if (on) t.add(r.id);
        else t.delete(r.id);
        return t;
      });
      setRanks((rs) => rs?.map((x) => (x.id === r.id ? { ...x, likes: n } : x)) ?? rs);
    } catch (e) {
      setRankMsg(
        e instanceof ApiError && e.code === "OWN_RECORD"
          ? "내 문장에는 누를 수 없어요"
          : "누르지 못했어요"
      );
      setTimeout(() => setRankMsg(null), 2000);
    } finally {
      setLiking(null);
    }
  };
  const share = async (c: Parameters<typeof shareCard>[0]) => {
    if (sharing) return;
    setSharing(true);
    try {
      await shareCard(c);
    } catch {
      /* 공유 취소 · 실패는 조용히 */
    } finally {
      setSharing(false);
    }
  };
  const openRanks = (sort: HangulSort = rankSort) => {
    setRankSort(sort);
    setRanks(null);
    setRankOpen(true);
    loadRanks(sort);
  };
  useEffect(() => {
    if (!rankOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setRankOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rankOpen]);

  // 판 크기 → 캔버스 · 둘레 길
  useEffect(() => {
    const field = fieldRef.current,
      cv = canvasRef.current;
    if (!field || !cv) return;
    const fit = () => {
      const r = field.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      cv.width = Math.round(r.width * dpr);
      cv.height = Math.round(r.height * dpr);
      setPath(g, { x: 16, y: 16, w: r.width - 32, h: r.height - 32 });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(field);
    return () => ro.disconnect();
  }, [g]);

  // 칸 위치 (쏘는 선의 출발점) — 화면이 다시 그려질 때마다
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    const base = field.getBoundingClientRect();
    const m = posRef.current;
    m.clear();
    field.querySelectorAll<HTMLElement>("[data-uid]").forEach((el) => {
      const r = el.getBoundingClientRect();
      m.set(Number(el.dataset.uid), {
        x: r.left - base.left + r.width / 2,
        y: r.top - base.top + r.height / 2,
      });
    });
  });

  // 진행 · 그리기
  useEffect(() => {
    // 개발 중 점검용 (콘솔에서 판 상태 보기)
    if (process.env.NODE_ENV !== "production")
      (window as unknown as { __hangul?: Game }).__hangul = g;
    let raf = 0,
      last = performance.now(),
      ui = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (phaseRef.current === "play" && !pauseRef.current) {
        for (let k = 0; k < speedRef.current; k++) step(g, dt);
        if (g.over) setPhase("over");
      }
      const cv = canvasRef.current;
      const cx = cv?.getContext("2d");
      if (cv && cx) {
        const dpr = window.devicePixelRatio || 1;
        cx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawField(cx, g, cv.width / dpr, cv.height / dpr, posRef.current);
      }
      if ((ui += dt) > 0.1) {
        ui = 0;
        refresh();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [g, refresh]);

  // 문장칸이 바뀌면 서버에 읽어 달라고 함
  const text = lineText(g);
  useEffect(() => {
    if (!text) return;
    let alive = true;
    judgeLine(text)
      .then((j) => alive && (setJudge(j), setJudgeErr(null)))
      .catch((e) => {
        if (!alive) return;
        setJudge(null);
        setJudgeErr(
          e instanceof ApiError && e.code === "JUDGE_OFF"
            ? "판정 서버에 모델이 없어요 (server 에서 npm run kiwi:model)"
            : "판정 서버에 연결할 수 없어요"
        );
      });
    return () => {
      alive = false;
    };
  }, [text]);
  const j = judge && judge.text === text ? judge : null;

  const start = () => {
    const ng = newGame();
    // 처음엔 자모 한 줌을 쥐고 시작 (newGame 안에서 하면 서버 렌더와 무작위가 어긋나서 여기서)
    draw(ng, 20);
    setG(ng);
    setSel(null);
    setSelling(false);
    setJudge(null);
    setSent("idle");
    setPhase("play");
    beginHangul();
  };

  const onSlot = (z: Zone, i: number) => {
    if (phase !== "play") return;
    const u = g.zones[z][i];
    if (selling) {
      if (u) discard(g, z, i);
      return refresh();
    }
    if (sel) {
      // 같은 칸을 또 누르면: 쌓인 것끼리 합치기(ㄱ×2 → ㄲ, ㆍ×2 → ㆍㆍ), 안 되면 선택 취소
      if (sel.z === z && sel.i === i) {
        if (combine(g, z, i, z, i)) refresh();
        return setSel(null);
      }
      if (combine(g, sel.z, sel.i, z, i)) {
        setSel(null);
        return refresh();
      }
      setSel(u?.kind === "j" ? { z, i } : null);
      return refresh();
    }
    if (!u) return;
    if (u.kind === "j") return setSel({ z, i });
    toLine(g, z, i);
    refresh();
  };

  const onBind = () => {
    if (j && bindWord(g, j)) refresh();
  };
  const onFinish = () => {
    if (!j) return;
    const s = finishSentence(g, j);
    if (!s) return;
    setFlash(s);
    window.setTimeout(() => setFlash((f) => (f === s ? null : f)), 2600);
    refresh();
  };
  const askSuggest = async () => {
    const ps = pieces(g);
    if (!ps.length) return;
    const line = text;
    setSugBusy(true);
    try {
      const list = await suggestLine(
        line,
        ps.map((u) => u.text)
      );
      setSugs({ line, list: list.map((s) => ({ ...s, ids: s.add.map((i) => ps[i].id) })) });
    } catch {
      setSugs({ line, list: [] });
    } finally {
      setSugBusy(false);
    }
  };
  /**
   * 낱말 짝짓기(무지성): 글자칸 글자들로 서버 '뭐 되지?'를 돌려 낱말이 되는 걸 찾아 바로 단어칸으로 — 더 안 나올 때까지
   * 고유명사(루드 · 오드 같은 것)는 건너뜀
   */
  const autoWord = async () => {
    setWordBusy(true);
    let made = 0;
    try {
      for (let round = 0; round < 8; round++) {
        const syl = g.zones.s.filter((u): u is NonNullable<typeof u> => !!u);
        if (syl.length < 2 || !g.zones.w.includes(null)) break;
        const list = await suggestLine(
          "",
          syl.map((u) => u.text)
        );
        const pick = list.find((s) => !s.sentence && s.word && !s.rare);
        if (
          !pick?.word ||
          !makeWord(
            g,
            pick.add.map((i) => syl[i].id),
            pick.text,
            pick.word
          )
        )
          break;
        made++;
        refresh();
      }
    } catch {
      // 판정 서버가 없으면 아래 안내로
    } finally {
      setWordBusy(false);
    }
    say(
      g,
      made
        ? `낱말 ${made}개를 만들었어요`
        : !g.zones.w.includes(null)
          ? "단어칸이 꽉 찼어요"
          : "글자칸 글자로 만들 낱말이 안 보여요"
    );
    refresh();
  };
  const applySug = (ids: number[]) => {
    addByIds(g, ids);
    setSugs(null);
    refresh();
  };
  const popLine = (k?: number) => {
    fromLine(g, k ?? g.line.length - 1);
    refresh();
  };
  const clearLine = () => {
    for (let k = g.line.length - 1; k >= 0; k--) fromLine(g, k);
    refresh();
  };

  const submit = async () => {
    const b = best(g);
    const nm = name.trim() || "익명";
    setSent("sending");
    try {
      if (!secret) localStorage.setItem(NAME_KEY, nm);
      localStorage.setItem(SECRET_KEY, secret ? "1" : "0");
    } catch {}
    try {
      await submitHangul({
        name: secret ? "익명" : nm,
        score: score(g),
        wave: g.wave,
        best: b?.text ?? "",
        bestPts: b?.points ?? 0,
        secret,
      });
      setSent("done");
    } catch {
      setSent("fail");
    }
  };

  const ld = load(g);
  const cells = lineCells(g);
  const lk = links(g);
  const selU = sel ? g.zones[sel.z][sel.i] : null;
  const note =
    g.note && g.t - g.note.at < 2.5
      ? g.note.text
      : selU?.kind === "j"
        ? `「${shown(selU.text)}」 골랐어요 — 다음에 누르는 자모 · 글자와 누른 순서대로 합쳐요${(selU.n ?? 1) > 1 ? " (같은 칸을 또 누르면 둘끼리)" : ""}`
        : null;
  const unknown = j?.morphs.filter((m) => !m.k) ?? [];
  const endsLikeSentence = !!j && j.morphs.length >= 2 && j.morphs[j.morphs.length - 1].t === "EF";
  // "이거 말 되는데?" — 사전에 없는 말이 있거나 외계어로 판정됐을 때만
  const canReport = !!j && !j.sentence && (unknown.length > 0 || (endsLikeSentence && !j.word));
  const report = () => {
    if (!j || reported.has(j.text)) return;
    setReported((s) => new Set(s).add(j.text));
    reportHangul(j.text).catch(() => {});
  };
  const lineMsg = !text
    ? "글자칸 · 단어칸의 글자를 누르면 여기 이어 붙어요"
    : judgeErr
      ? judgeErr
      : !j
        ? "읽는 중…"
        : j.sentence
          ? `문장이 됐어요! [${gradeOf(j.nat)?.name}] 「${withEnd(j.spaced || j.text)}」 완성하면 +${fmt(j.points)}점`
          : unknown.length
            ? `「${unknown.map((m) => m.f).join(", ")}」 — 사전에 없는 말이에요`
            : endsLikeSentence && !j.word
              ? `외계어예요 (말맛 ${j.nat}) — 사람이 쓰는 말처럼 이어 보세요`
              : j.word
                ? `낱말 「${j.text}」(${j.word}) — 묶으면 단어칸에서 ${POS_STYLE[j.word]?.desc ?? "싸워요"}`
                : "아직 문장이 아니에요 — ~다 · ~요 · ~네 로 끝을 맺거나, ~님 · ~야 로 불러 보세요";
  const bestNow = best(g);

  const slot = (z: Zone, i: number) => {
    const u = g.zones[z][i];
    const on = sel?.z === z && sel.i === i;
    const st = u ? statsOf(g, u) : null;
    const len = u ? [...u.text].length : 0;
    // 자음칸 · 모음칸의 고정 자리는 비어 있어도 그 자리 글자를 흐리게 보여 줌 (자판처럼)
    const ph = z === "c" ? CONS_SLOTS[i] : z === "v" ? VOWEL_SLOTS[i] : undefined;
    return (
      <button
        key={i}
        type="button"
        className={`hg-slot hg-${z}${u ? "" : " is-empty"}${on ? " is-on" : ""}${selling && u ? " is-sell" : ""}`}
        data-uid={u?.id}
        onClick={() => onSlot(z, i)}
        aria-label={u ? u.text : "빈 칸"}
        style={st && "color" in st && u?.kind === "w" ? { color: st.color } : undefined}
      >
        {!u && ph && (
          <span className={`hg-glyph is-ph${shown(ph) !== ph ? " is-dot" : ""}`}>{shown(ph)}</span>
        )}
        {u && (
          <>
            <span
              className={`hg-glyph${u.kind === "j" && shown(u.text) !== u.text ? " is-dot" : ""}`}
              style={len > 2 ? { fontSize: `${Math.max(11, 26 - len * 3.2)}px` } : undefined}
            >
              {u.kind === "j" ? shown(u.text) : u.text}
            </span>
            {u.kind === "w" && <span className="hg-pos">{u.pos}</span>}
            {u.kind === "j" && (u.n ?? 1) > 1 && <span className="hg-n">×{u.n}</span>}
          </>
        )}
      </button>
    );
  };
  const zone = (z: Zone, title: string, cls = "") => (
    <section className={`hg-zone ${cls}`}>
      <h3>{title}</h3>
      <div className={`hg-grid hg-grid-${z}`}>
        {Array.from({ length: CAP[z] }, (_, i) => slot(z, i))}
      </div>
    </section>
  );

  return (
    <div className="hg-root">
      <header className="hg-head">
        <h1>니들이 한글을 알아?</h1>
        <p>아무 말이나 지껄여서 먹물을 막아라 · 프로토</p>
        <button type="button" className="hg-rankbtn" onClick={() => openRanks()}>
          🏆 랭킹
        </button>
      </header>

      <div className="hg-hud">
        <div>
          <span>웨이브</span>
          <b>{g.wave}</b>
        </div>
        <div className={ld >= LOAD_MAX * 0.7 ? "is-warn" : ""}>
          <span>먹물</span>
          <b>
            {ld}/{LOAD_MAX}
          </b>
        </div>
        <div>
          <span>점수</span>
          <b>{fmt(score(g))}</b>
        </div>
        <div>
          <span>기세</span>
          <b>×{g.power.toFixed(2)}</b>
        </div>
      </div>

      <div className="hg-field" ref={fieldRef}>
        <canvas ref={canvasRef} className="hg-canvas" aria-hidden />
        <div className="hg-panel">
          <section className="hg-line">
            <h3>
              원고지{" "}
              <small>
                {hangulLen(text)}/{LINE_MAX}
              </small>
            </h3>
            <div className="hg-paper" role="list">
              {Array.from(
                { length: Math.max(LINE_MAX, Math.ceil(cells.length / 15) * 15) },
                (_, k) => {
                  const c = cells[k];
                  return (
                    <button
                      key={k}
                      type="button"
                      role="listitem"
                      className={`hg-cell${c ? (c.k % 2 ? " is-b" : " is-a") : ""}`}
                      onClick={() => c && popLine(c.k)}
                      disabled={!c}
                    >
                      {c?.ch}
                    </button>
                  );
                }
              )}
            </div>
            <div className="hg-morphs">
              {j?.morphs.map((m, k) => (
                <span key={k} className={m.k ? "" : "is-unk"}>
                  {m.f}
                  <small>{tagName(m)}</small>
                </span>
              ))}
            </div>
            <p className={`hg-msg${j?.sentence ? " is-ok" : ""}`}>
              {lineMsg}
              {canReport && (
                <button
                  type="button"
                  className="hg-report"
                  onClick={report}
                  disabled={reported.has(j.text)}
                >
                  {reported.has(j.text) ? "신고했어요 ✓ 사전에 넣어 볼게요" : "🙋 이거 말 되는데?"}
                </button>
              )}
            </p>
            <div className="hg-sugs">
              <button
                type="button"
                className="hg-ask"
                onClick={askSuggest}
                disabled={sugBusy || phase !== "play" || !pieces(g).length}
              >
                {sugBusy ? "찾는 중…" : text ? "뒤에 뭐 붙이지?" : "뭐 되지?"}
              </button>
              {sugs &&
                sugs.line === text &&
                (sugs.list.length ? (
                  sugs.list.map((s) => (
                    <button
                      key={s.text}
                      type="button"
                      className={s.sentence ? "is-sent" : ""}
                      onClick={() => applySug(s.ids)}
                    >
                      {s.text}
                      <small>{s.sentence ? `문장 +${fmt(s.points)}` : s.word}</small>
                    </button>
                  ))
                ) : (
                  <span className="hg-dim">
                    가진 글자로는 안 보여요 — 자모가 더 들어오면 다시 눌러 보세요
                  </span>
                ))}
            </div>
            <div className="hg-punct">
              <span>부호</span>
              {PUNCTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => (addPunct(g, p), refresh())}
                  disabled={!g.line.length || phase !== "play"}
                >
                  {p}
                </button>
              ))}
              <small>띄어쓰기는 완성할 때 알아서</small>
            </div>
            <div className="hg-line-btns">
              <button type="button" onClick={() => popLine()} disabled={!g.line.length}>
                하나 빼기
              </button>
              <button type="button" onClick={clearLine} disabled={!g.line.length}>
                비우기
              </button>
              <button type="button" onClick={onBind} disabled={!j?.word || phase !== "play"}>
                낱말로 묶기
              </button>
              <button
                type="button"
                className="hg-go"
                onClick={onFinish}
                disabled={!j?.sentence || phase !== "play"}
              >
                문장 완성!
              </button>
            </div>
            {/* 문장칸 = 글: 완성한 문장이 끝없이 쌓이고(스크롤) 순서를 바꿀 수 있음. 글 전체가 READ_SEC 초마다 낭독 */}
            <div className="hg-shelf" data-uid={SHELF_ID}>
              <h3>
                문장칸 · 글{" "}
                <small>
                  {g.shelf.length}문장 · 낭독 {fmt(writingPower(g) * g.power)} · 이음 +
                  {fmt(linkBonus(g))}점
                </small>
              </h3>
              <i
                className="hg-sbar"
                style={{
                  transform: `scaleX(${g.shelf.length ? 1 - Math.max(0, Math.min(1, g.readCd)) : 0})`,
                }}
              />
              <div className="hg-shelf-list" ref={shelfRef}>
                {!g.shelf.length && (
                  <p className="hg-dim">
                    완성한 문장이 여기 차례로 쌓여 한 편의 글이 돼요. 앞뒤가 이어지면 이음 점수!
                  </p>
                )}
                {g.shelf.map((u, k) => (
                  <div key={u.id}>
                    {k > 0 && (
                      <p className={`hg-link l${lk[k - 1].level}`}>
                        <span>
                          {lk[k - 1].level === 2 ? "●●" : lk[k - 1].level === 1 ? "●○" : "○○"}
                        </span>
                        {lk[k - 1].why.length ? lk[k - 1].why.join(" · ") : "안 이어짐"}
                      </p>
                    )}
                    <div className="hg-sent">
                      <span className={`hg-sgrade g-${(u.grade ?? "").replace(" ", "")}`}>
                        {u.grade}
                      </span>
                      <span className="hg-stext">{u.spaced ?? withEnd(u.text)}</span>
                      <b>{fmt(u.points ?? 0)}</b>
                      <span className="hg-sact">
                        <button
                          type="button"
                          onClick={() => (moveSentence(g, k, -1), refresh())}
                          disabled={k === 0}
                          aria-label="위로"
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          onClick={() => (moveSentence(g, k, 1), refresh())}
                          disabled={k === g.shelf.length - 1}
                          aria-label="아래로"
                        >
                          ▼
                        </button>
                        <button
                          type="button"
                          onClick={() => (dropSentence(g, k), refresh())}
                          aria-label="글에서 빼기"
                        >
                          ✕
                        </button>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
          <div className="hg-right">
            {zone("w", "단어칸")}
            {zone("s", "글자칸")}
            <div className="hg-jamo">
              {zone("c", "자음칸")}
              {zone("v", "모음칸 · 천지인")}
            </div>
          </div>
        </div>

        {flash && (
          <div className="hg-flash" aria-live="polite">
            <span className={`hg-grade g-${flash.grade.replace(" ", "")}`}>{flash.grade}</span>
            <p>{flash.spaced}</p>
            <b>+{fmt(flash.points)}</b>
          </div>
        )}

        {phase === "ready" && (
          <div className="hg-over">
            <div className="hg-card">
              <h2>니들이 한글을 알아?</h2>
              <p>
                자모를 뽑아 글자를 만들고, 글자를 이어 붙여 <b>아무 문장</b>이나 만드세요.
                <br />
                「~다 · ~요 · ~네」로 끝나면 문장 완성 — 길수록 점수가 확 커져요.
                <br />
                먹물 얼룩이 {LOAD_MAX}마리 쌓이면 끝. 웨이브는 끝없이.
              </p>
              <button type="button" className="hg-go" onClick={start}>
                시작
              </button>
            </div>
          </div>
        )}
        {phase === "over" && (
          <div className="hg-over">
            <div className="hg-card">
              <h2>먹물에 덮였어요</h2>
              <p>
                {g.wave}웨이브 · 문장 {g.sentences.length}개 · 점수 <b>{fmt(score(g))}</b>
                <br />
                <small>
                  (문장 점수 {fmt(g.points)} + 이음 {fmt(linkBonus(g))} + 웨이브 {g.wave} ×{" "}
                  {HANGUL_WAVE_PTS})
                </small>
              </p>
              {bestNow ? (
                <blockquote className="hg-best">
                  {bestNow.spaced}
                  <small>대표글 · {fmt(bestNow.points)}점</small>
                  <button
                    type="button"
                    className="hg-sharebtn"
                    disabled={sharing}
                    onClick={() =>
                      share({
                        text: withEnd(bestNow.spaced),
                        grade: bestNow.grade,
                        line1: `이 문장 ${fmt(bestNow.points)}점`,
                        line2: `${g.wave}웨이브 · 문장 ${g.sentences.length}개 · 총 ${fmt(score(g))}점`,
                      })
                    }
                  >
                    {sharing ? "만드는 중…" : "🖼 카드로 자랑하기"}
                  </button>
                </blockquote>
              ) : (
                <p className="hg-dim">완성한 문장이 없어요</p>
              )}
              <div className="hg-submit">
                <input
                  value={secret ? "" : name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={10}
                  disabled={secret || sent === "done"}
                  placeholder={secret ? "🕶 익명으로 올라가요" : "이름 (로그인하면 별명)"}
                />
                <button
                  type="button"
                  onClick={submit}
                  disabled={sent === "sending" || sent === "done"}
                >
                  {sent === "done" ? "등록됨" : sent === "sending" ? "등록 중…" : "랭킹 등록"}
                </button>
              </div>
              <label className="hg-secret">
                <input
                  type="checkbox"
                  checked={secret}
                  onChange={(e) => setSecret(e.target.checked)}
                  disabled={sent === "done"}
                />
                🕶 시크릿 — 이름 · 별명 없이 「익명」으로 올리기
              </label>
              {sent === "fail" && <p className="hg-dim">등록하지 못했어요</p>}
              {sent === "done" && (
                <button type="button" className="hg-linkbtn" onClick={() => openRanks("new")}>
                  올라간 문장 보러 가기 →
                </button>
              )}
              <button type="button" className="hg-go" onClick={start}>
                다시 하기
              </button>
            </div>
          </div>
        )}
      </div>

      <p className="hg-note">{note}</p>

      <div className="hg-ctrl">
        <button type="button" onClick={() => (autoPair(g), refresh())} disabled={phase !== "play"}>
          글자 짝짓기<small>자음+모음 → 글자</small>
        </button>
        <button type="button" onClick={autoWord} disabled={phase !== "play" || wordBusy}>
          {wordBusy ? "찾는 중…" : "낱말 짝짓기"}
          <small>글자+글자 → 낱말</small>
        </button>
        <button type="button" onClick={() => setSpeed((s) => (s === 1 ? 2 : s === 2 ? 3 : 1))}>
          배속<small>×{speed}</small>
        </button>
        {/* 버리기 모드: 켜면 누르는 칸을 버려요 (말 안 되는 낱말 정리용) */}
        <button
          type="button"
          className={selling ? "is-on" : undefined}
          onClick={() => (setSelling((s) => !s), setSel(null))}
          disabled={phase !== "play"}
        >
          🗑 버리기<small>{selling ? "누르는 칸 버림 · 끄기" : "꺼짐"}</small>
        </button>
      </div>

      <details className="hg-help">
        <summary>어떻게 하나요</summary>
        <ul>
          <li>자모를 누르고 다른 자모를 누르면 합쳐요: 자음+모음 → 글자 · ㄱ×2 칸을 두 번 → ㄲ</li>
          <li>
            모음은 천지인(ㆍ ㅡ ㅣ)으로, 누른 순서대로: ㅣ→ㆍ = ㅏ · ㆍ→ㅣ = ㅓ · ㆍ→ㅡ = ㅗ · ㅡ→ㆍ
            = ㅜ · 점 하나 더: ㅏ→ㆍ = ㅑ · ㅓ→ㆍ = ㅕ · ㅗ→ㆍ = ㅛ · ㅜ→ㆍ = ㅠ (ㆍ칸을 두 번 눌러
            ㆍㆍ 를 만든 뒤 ㆍㆍ→ㅣ = ㅕ 도 됨) · ㅏ→ㅣ = ㅐ · ㅓ→ㅣ = ㅔ
          </li>
          <li>
            자모를 누르고 글자를 누르면: 받침(가+ㄱ → 각) · 겹받침(업+ㅅ → 없, 일+ㄱ → 읽) · 모음
            바꾸기(기+ㆍ → 가, 그+ㆍ → 구, 가+ㅣ → 개)
          </li>
          <li>자모는 {DRAW_EVERY}초마다 하나씩 저절로 들어와요 (뽑기 · 엽전 없음)</li>
          <li>말 안 되는 낱말 · 안 쓰는 글자는 단어칸 위 [버리기]를 켜고 누르면 치워져요</li>
          <li>
            같은 자모는 한 칸에 쌓여요(×n). [글자 짝짓기]는 재료로 모음을 알아서 만들어 글자까지,
            [낱말 짝짓기]는 글자칸 글자로 되는 낱말을 찾아 단어칸까지 만들어 줘요
          </li>
          <li>글자 · 낱말을 누르면 원고지에 이어 붙어요. 원고지 칸을 누르면 다시 빠져요</li>
          <li>
            원고지가 낱말 하나면 [낱말로 묶기] → 단어칸에서 품사대로 싸워요 (명사 강타 · 동사 범위 ·
            형용사 감속 · 부사 연사 · 감탄사 기절)
          </li>
          <li>
            종결어미로 끝나면 [문장 완성!] → 화면 전체 공격 + 점수 + 기세(모든 피해) 영구 상승.
            문장은 문장칸에 차례로 쌓여 한 편의 글이 되고, 글 전체가 {READ_SEC}초마다 낭독해요
          </li>
          <li>
            문장칸에서 ▲▼ 로 순서를 바꿀 수 있어요. 앞뒤 문장이 이어지면 이음 점수: 이음말로
            시작(그래서 · 근데 · 그리고) · 가리키는 말(그거 · 거기 · 그때) · 앞 문장의 말을 다시
            씀(술 → 술은) — 한 쌍에 최대 ●● 두 개
          </li>
          <li>
            띄어쓰기는 필요 없어요. 욕도 문장이에요. 부르는 말(선생님 · 철수야)이나
            감탄사(여보세요)도 문장
          </li>
        </ul>
      </details>

      {/* 랭킹: 문장이 주인공 — 대표글을 크게, 누가 · 몇 점은 작게. 사이트 메뉴 버튼보다 위에 뜨게 body 로 (색 · 글꼴은 hg-root 그대로) */}
      {rankOpen &&
        createPortal(
          <div className="hg-root hg-portal">
            <div
              className="hg-rankpop"
              role="dialog"
              aria-modal="true"
              aria-label="랭킹"
              onClick={() => setRankOpen(false)}
            >
              <section className="hg-ranks" onClick={(e) => e.stopPropagation()}>
                <header>
                  <h2>명예의 전당</h2>
                  <div className="hg-rtabs" role="tablist">
                    {(["top", "fun", "new"] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        role="tab"
                        aria-selected={rankSort === s}
                        className={rankSort === s ? "is-on" : ""}
                        onClick={() => openRanks(s)}
                      >
                        {s === "top" ? "점수순" : s === "fun" ? "😂 웃긴순" : "방금 올라온"}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="hg-rclose"
                    onClick={() => setRankOpen(false)}
                    aria-label="닫기"
                  >
                    ✕
                  </button>
                </header>
                {phase === "play" && <p className="hg-dim hg-rpause">보는 동안 판은 멈춰 있어요</p>}
                {rankMsg && <p className="hg-rmsg">{rankMsg}</p>}
                {!ranks ? (
                  <p className="hg-dim">불러오는 중…</p>
                ) : !ranks.length ? (
                  <p className="hg-dim">
                    {rankSort === "fun"
                      ? "아직 👍 받은 문장이 없어요 — 「방금 올라온」에서 웃긴 문장에 👍 를 눌러 주세요"
                      : "아직 기록이 없어요"}
                  </p>
                ) : (
                  <ol>
                    {ranks.map((r, k) => (
                      <li
                        key={r.id}
                        className={rankSort !== "new" && k < 3 ? `is-top t${k + 1}` : ""}
                      >
                        {rankSort !== "new" && <span className="hg-rk">{k + 1}</span>}
                        {r.best ? (
                          <blockquote className="hg-rq">
                            {withEnd(r.bestSpaced || r.best)}
                          </blockquote>
                        ) : (
                          <p className="hg-rq is-none">완성한 문장 없이 버텼어요</p>
                        )}
                        <p className="hg-rn">
                          <span>
                            {r.secret ? "🕶 익명" : r.member ? r.name : `${r.name} (손님)`}
                          </span>
                          <span>
                            <b>{fmt(r.score)}</b>점 · {r.wave}웨이브
                            {r.bestPts ? ` · 이 문장 ${fmt(r.bestPts)}점` : ""}
                          </span>
                          <span>{ago(r.createdAt)}</span>
                        </p>
                        {r.best && (
                          <p className="hg-ract">
                            <button
                              type="button"
                              className={liked.has(r.id) ? "is-on" : ""}
                              aria-pressed={liked.has(r.id)}
                              disabled={liking === r.id}
                              onClick={() => toggleLike(r)}
                            >
                              👍 웃겨요 <b>{r.likes ?? 0}</b>
                            </button>
                            <button
                              type="button"
                              disabled={sharing}
                              onClick={() =>
                                share({
                                  text: withEnd(r.bestSpaced || r.best),
                                  line1: `이 문장 ${fmt(r.bestPts)}점`,
                                  line2: `${r.secret ? "익명" : r.name} · ${r.wave}웨이브 · 총 ${fmt(r.score)}점`,
                                })
                              }
                            >
                              🖼 카드
                            </button>
                          </p>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
