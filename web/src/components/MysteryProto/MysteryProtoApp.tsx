"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/api/http";
import { ApiError } from "@/lib/api/errors";

/*
 * 추리게임(예/아니오) — 플레이 화면. 판 상태는 서버(/api/mystery-proto)가 들고 있고 화면은 그리기만.
 * 탐정 사무소 책상 컨셉 (스타일은 css/mystery.css, mq- 접두사):
 *  - 목록: 코르크판에 압정으로 박힌 사건 쪽지 + 폴라로이드 표지, 하던 사건은 포스트잇
 *  - PC: [마닐라 폴더(표지 · 문제 · 진행)] [심문 기록 줄노트 + 입력] [스프링 수사 노트(자동 정리)]
 *  - 폰: 접히는 폴더 머리 · 줄노트 · 하단 입력 + 단서/노트/보고서 단추 → 위아래 왕복 스크롤 없음
 *  - 사진은 전부 눌러서 크게 보기 (확대 · 핀치)
 *  - 판정은 고무도장, 큰 도장은 처음 짚은 중요한 사실 · 흔한 오답에만
 *  - 판정마다 🚩 (오판 신고 → 서버에 모아서 사실 목록 보강)
 */

type Verdict = "YES" | "KEY_YES" | "NO" | "KEY_NO" | "UNKNOWN" | "UNRELATED" | "SPLIT" | "INVALID";
type FailStatus = "missing" | "insufficient" | "wrong";

interface PublicCase {
  id: string;
  title: string;
  level: string;
  prompt: string;
  questionLimit: number;
  submitLimit: number;
  clueCount: number;
  rubricCount: number;
  bonusCount: number;
  credit?: string;
  /** 표지 삽화 */
  cover?: string;
  /** 단서가 열리는 질문 수 (진행 막대 눈금) */
  clueAt?: number[];
  /** 후보 사건 (관리자 · 개발 모드에만 뜸) */
  candidate?: boolean;
}

interface View {
  id: string;
  case: PublicCase;
  questions: { text: string; verdict: Verdict }[];
  used: number;
  clues: { id: string; body: string; image?: string }[];
  nextClueAt: number | null;
  submissions: { passed: number; total: number; failed: { label: string; status: FailStatus }[]; bonus: string[]; bonusTotal: number; same: boolean }[];
  status: "playing" | "solved" | "gave_up";
  truth: string | null;
  stats: { questions: number; submissions: number; ms: number };
}

/** 판정 도장. tone = 잉크색 (mq-stamp.yes/no/maybe/dim) */
const STAMP: Record<Verdict, { label: string; tone: "yes" | "no" | "maybe" | "dim"; note?: string }> = {
  YES: { label: "네", tone: "yes" },
  KEY_YES: { label: "네, 그렇습니다", tone: "yes" },
  NO: { label: "아니오", tone: "no" },
  KEY_NO: { label: "아니오, 그렇지 않습니다", tone: "no" },
  UNKNOWN: { label: "알 수 없음", tone: "maybe", note: "진상만으로는 정할 수 없는 내용이에요." },
  UNRELATED: { label: "상관없음", tone: "dim", note: "사건을 푸는 데 상관없는 방향이에요." },
  SPLIT: { label: "나눠서 물어보세요", tone: "maybe", note: "참과 거짓이 섞여 있어요. 한 번에 하나씩. (차감 안 됨)" },
  INVALID: { label: "반려", tone: "dim", note: "예/아니오로 답할 수 있는 질문만 받아요. (차감 안 됨)" },
};
const isKey = (v: Verdict) => v === "KEY_YES" || v === "KEY_NO";

const STATUS_LABEL: Record<FailStatus, string> = {
  missing: "아직 언급하지 않았어요",
  insufficient: "언급은 했지만 설명이 부족해요",
  wrong: "진상과 다르게 썼어요",
};

/** 난이도 → 도장 잉크 */
const LEVEL_TONE: Record<string, "yes" | "maybe" | "no"> = { 쉬움: "yes", 보통: "maybe", 어려움: "no" };
/** 목록 쪽지 기울기 · 압정 색 (사건마다 조금씩 다르게) */
const TILT = [-1.4, 0.9, -0.6, 1.3, -1.1, 0.5];
const PIN = ["", "blue", "green", "gold"];

const STORE = "mysteryProto.play";
const GATE_STORE = "mysteryProto.gate";
const readGate = () => {
  try {
    return localStorage.getItem(GATE_STORE) ?? "";
  } catch {
    return "";
  }
};
const writeGate = (v: string) => {
  try {
    localStorage.setItem(GATE_STORE, v);
  } catch {
    // 저장 안 되면 이번 창에서만
  }
};
let gateMem = "";

/** 이 게임 API 호출: 로그인 토큰(관리자 확인) + 입장 비밀번호를 늘 같이 보냄 */
function call<T>(path: string, opts: { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number } = {}) {
  const gate = gateMem || readGate();
  return api<T>(`/api/mystery-proto${path}`, { ...opts, auth: true, headers: gate ? { "x-mystery-gate": gate } : undefined });
}
const isGateError = (e: unknown) => e instanceof ApiError && e.code === "GATE";

const save = (id: string | null) => {
  try {
    if (id) localStorage.setItem(STORE, id);
    else localStorage.removeItem(STORE);
  } catch {
    // 저장 안 돼도 판은 진행
  }
};
const load = () => {
  try {
    return localStorage.getItem(STORE);
  } catch {
    return null;
  }
};

const errText = (e: unknown) => (e instanceof ApiError ? e.message : "요청에 실패했어요.");
const fmtTime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}분 ${String(s % 60).padStart(2, "0")}초`;
};

/* ── 작은 부품 ── */

/** 사진 확대: 누르면 화면 가득, 한 번 더 누르면 2배(누른 곳 기준), 폰은 손가락으로도 확대 */
function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const [zoomed, setZoomed] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div ref={box} className="mq-lightbox" onClick={() => (zoomed ? setZoomed(false) : onClose())}>
      <img
        src={src}
        alt=""
        draggable={false}
        onClick={(e) => {
          e.stopPropagation();
          if (zoomed) return setZoomed(false);
          // 누른 자리가 화면 가운데 오도록 2배로
          const r = e.currentTarget.getBoundingClientRect();
          const fx = (e.clientX - r.left) / r.width;
          const fy = (e.clientY - r.top) / r.height;
          setZoomed(true);
          requestAnimationFrame(() => {
            const el = box.current;
            if (!el) return;
            el.scrollTo({ left: fx * el.scrollWidth - el.clientWidth / 2, top: fy * el.scrollHeight - el.clientHeight / 2 });
          });
        }}
        className={zoomed ? "m-auto max-w-none cursor-zoom-out" : "max-h-[92dvh] max-w-[96vw] cursor-zoom-in rounded-sm shadow-2xl"}
        style={zoomed ? { width: "min(3000px, max(200vw, 1800px))" } : undefined}
      />
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="fixed top-3 right-3 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-xl text-white"
        aria-label="닫기"
      >
        ✕
      </button>
      {!zoomed && <p className="mq-hand pointer-events-none fixed bottom-4 left-0 w-full text-center text-sm text-white/60">사진을 누르면 더 크게 · 바깥을 누르면 닫혀요</p>}
    </div>
  );
}

/** 누르면 확대되는 사진. 없으면 빈 사진틀 */
function Photo({ src, onZoom, className = "" }: { src?: string; onZoom: (src: string) => void; className?: string }) {
  if (!src)
    return (
      <div className={`flex items-center justify-center bg-[radial-gradient(circle_at_30%_25%,#5b4a3a,#2b2018)] ${className}`}>
        <span className="mq-pen text-6xl text-[#f4ead2]/25">?</span>
      </div>
    );
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      onClick={(e) => {
        e.stopPropagation();
        onZoom(src);
      }}
      className={`mq-zoomable block object-cover ${className}`}
    />
  );
}

function Stamp({ v, big }: { v: Verdict; big?: boolean }) {
  const s = STAMP[v];
  return <span className={`mq-stamp ${s.tone} ${big || isKey(v) ? "big" : ""}`}>{s.label}</span>;
}

function LevelStamp({ level }: { level: string }) {
  return <span className={`mq-stamp ${LEVEL_TONE[level] ?? "dim"}`} style={{ fontSize: 18, rotate: "-6deg" }}>{level}</span>;
}

/** 시트: 종이 한 장. 폰은 아래에서 올라오고 PC 는 가운데. 바깥 · Esc 로 닫힘 */
function Sheet({ open, onClose, title, children, wide, lined }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; lined?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="mq mq-sheet-back" onClick={onClose}>
      <div
        className={`${lined ? "mq-lined" : "mq-paper"} max-h-[90dvh] w-full ${wide ? "max-w-[760px]" : "max-w-[580px]"} overflow-y-auto rounded-t-xl p-5 sm:rounded-md sm:p-6`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 className="mq-pen text-[30px] leading-none text-[var(--ink)]">{title}</h3>
          <button onClick={onClose} className="mq-btn mq-btn-paper -mt-1 min-h-0 px-2.5 py-1 text-base" aria-label="닫기">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** 입장 비밀번호 (테스트 기간) — 기밀 봉투 */
function Gate({ onPass }: { onPass: (pw: string) => void }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!pw.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api("/api/mystery-proto/gate", { method: "POST", body: { password: pw.trim() } });
      onPass(pw.trim());
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mq mq-desk mx-auto max-w-[920px] px-4 py-12">
      <form
        className="mq-manila mx-auto max-w-[420px] -rotate-1 px-6 pt-10 pb-7"
        onSubmit={(e) => {
          e.preventDefault();
          void go();
        }}
      >
        <span className="mq-clip" />
        <div className="absolute top-5 right-5">
          <span className="mq-stamp no big">기밀</span>
        </div>
        <p className="mq-type text-[11px] text-[var(--ink3)]">CONFIDENTIAL · 테스트 중</p>
        <h2 className="mq-pen mt-1 text-[38px] leading-none">관계자 외 열람 금지</h2>
        <p className="mq-hand mt-3 text-[19px] leading-snug text-[var(--ink2)]">지금은 초대받은 분들만 들어올 수 있어요. 받은 입장 비밀번호를 적어 주세요.</p>
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          autoFocus
          autoComplete="off"
          placeholder="입장 비밀번호"
          className="mq-input mt-5"
        />
        {err && <p className="mq-hand mt-2 text-[17px] text-[var(--no)]">{err}</p>}
        <button disabled={busy || !pw.trim()} className="mq-btn mq-btn-wine mt-4 w-full text-base">
          {busy ? "확인 중…" : "사무소 들어가기"}
        </button>
      </form>
    </div>
  );
}

/** 관리자 띠: 플레이 기록 뽑기 (JSON 내려받기 · 복사) — Claude 에게 붙여 주면 분석 */
function AdminBar({ cases }: { cases: PublicCase[] }) {
  const [caseId, setCaseId] = useState("");
  const [days, setDays] = useState(7);
  const [msg, setMsg] = useState<string | null>(null);
  const pull = async (mode: "download" | "copy") => {
    setMsg("불러오는 중…");
    try {
      const qs = new URLSearchParams({ days: String(days), limit: "2000", ...(caseId ? { case: caseId } : {}) });
      const r = await call<{ count: number; plays: unknown[] }>(`/plays?${qs}`);
      const text = JSON.stringify(r.plays, null, 1);
      if (mode === "copy") {
        await navigator.clipboard.writeText(text);
        setMsg(`${r.count}판 복사됨`);
      } else {
        const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = `mystery-plays-${caseId || "all"}-${days}d-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        setMsg(`${r.count}판 내려받음`);
      }
    } catch (e) {
      setMsg(errText(e));
    }
  };
  const sel = "rounded-md border border-[rgba(90,65,40,.4)] bg-[#fffaf0] px-2 py-1.5 text-sm";
  return (
    <div className="mq-paper mb-6 flex flex-wrap items-center gap-2 px-3 py-2.5 text-sm">
      <span className="mq-type text-[11px] text-[var(--wine)]">ADMIN · 플레이 기록</span>
      <select value={caseId} onChange={(e) => setCaseId(e.target.value)} className={sel}>
        <option value="">전체 사건</option>
        {cases.map((c) => (
          <option key={c.id} value={c.id}>
            {c.title}
          </option>
        ))}
      </select>
      <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={sel}>
        {[1, 7, 30, 365].map((d) => (
          <option key={d} value={d}>
            최근 {d}일
          </option>
        ))}
      </select>
      <button onClick={() => void pull("download")} className="mq-btn mq-btn-wood min-h-0 px-3 py-1.5 text-sm">
        JSON 받기
      </button>
      <button onClick={() => void pull("copy")} className="mq-btn mq-btn-wood min-h-0 px-3 py-1.5 text-sm">
        복사
      </button>
      {msg && <span className="text-[var(--ink3)]">{msg}</span>}
    </div>
  );
}

/* ── 본체 ── */

export default function MysteryProtoApp() {
  const [cases, setCases] = useState<PublicCase[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [view, setView] = useState<View | null>(null);
  const [resume, setResume] = useState<View | null>(null);
  const [draft, setDraft] = useState("");
  const [answer, setAnswer] = useState("");
  const [asking, setAsking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | "clues" | "notes" | "submit" | "truth">(null);
  const [newClue, setNewClue] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [flagged, setFlagged] = useState<Set<number>>(new Set());
  const [zoom, setZoom] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [boxH, setBoxH] = useState<number | null>(null);
  /** 입장 가림막: null = 확인 중, true = 비밀번호 필요, false = 통과 */
  const [locked, setLocked] = useState<boolean | null>(null);
  const [admin, setAdmin] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    // 목록부터 — 가림막에 걸리면 비밀번호 화면. 로그인돼 있으면 토큰을 같이 보냄(관리자면 비밀번호 없이 + 후보 사건까지)
    call<{ enabled: boolean; admin?: boolean; cases: PublicCase[] }>("/cases")
      .then((r) => {
        setLocked(false);
        setCases(r.cases);
        setEnabled(r.enabled);
        setAdmin(!!r.admin);
        // 하던 판이 있으면 "이어하기" 쪽지로 (바로 들어가지 않음 — 목록을 먼저 보여 줌)
        const saved = load();
        if (saved)
          call<View>(`/play/${saved}`)
            .then((v) => (v.status === "playing" ? setResume(v) : save(null)))
            .catch(() => save(null));
        // ?case=<id> 로 오면 그 사건을 바로 시작 (공유 링크용). 하던 판이 있으면 목록에서 고르게 둠
        const want = new URLSearchParams(window.location.search).get("case");
        if (want && !saved)
          call<View>("/start", { method: "POST", body: { caseId: want } })
            .then((v) => {
              setView(v);
              save(v.id);
            })
            .catch((e) => setError(errText(e)));
      })
      .catch((e) => {
        if (isGateError(e)) setLocked(true);
        else {
          setLocked(false);
          setError(errText(e));
        }
      });
  }, [tick]);

  // 사이트 머리말 아래 남은 화면 높이를 꽉 채움 (스크롤 왕복 없이 입력창 · 버튼이 늘 보이게)
  const playing = !!view;
  useEffect(() => {
    if (!playing) return;
    // 사이트 빠른 메뉴 단추가 질문 단추를 가려서 판 중엔 숨김
    document.documentElement.classList.add("mp-playing");
    const fit = (scroll: boolean) => {
      const el = boxRef.current;
      if (!el) return;
      const vh = window.visualViewport?.height ?? window.innerHeight;
      const top = el.getBoundingClientRect().top + window.scrollY;
      // 머리말은 위로 밀어 내고 판이 화면을 꽉 채움 (위에 붙어 있는 메뉴 줄 높이만큼은 비움)
      const stuck = ["site-header", "site-nav"]
        .map((id) => document.getElementById(id))
        .filter((n): n is HTMLElement => !!n && ["sticky", "fixed"].includes(getComputedStyle(n).position))
        .reduce((m, n) => Math.max(m, (parseFloat(getComputedStyle(n).top) || 0) + n.getBoundingClientRect().height), 0);
      const mobile = window.innerWidth < 1024;
      if (scroll) window.scrollTo({ top: Math.max(0, top - stuck - (mobile ? 4 : 10)) });
      setBoxH(mobile ? Math.max(380, Math.round(vh - stuck - 8)) : Math.max(600, Math.min(1000, Math.round(vh - stuck - 20))));
    };
    const onResize = () => fit(false);
    fit(true);
    // 머리말 그림 · 글꼴이 늦게 자리 잡으면 위치가 밀리니 조금 뒤 한 번 더 맞춤
    const t1 = setTimeout(() => fit(true), 350);
    const t2 = setTimeout(() => fit(true), 1200);
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      document.documentElement.classList.remove("mp-playing");
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, [playing]);

  // 새 질문이 오면 기록 맨 아래로
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [view?.questions.length]);

  const enter = (v: View) => {
    setView(v);
    setResume(null);
    setFlagged(new Set());
    setDraft("");
    setAnswer("");
    setExpanded(false);
    setSheet(null);
    setError(null);
    save(v.id);
  };

  const start = async (caseId: string) => {
    setError(null);
    try {
      enter(await call<View>("/start", { method: "POST", body: { caseId } }));
    } catch (e) {
      setError(errText(e));
    }
  };

  const ask = useCallback(async () => {
    const q = draft.trim();
    if (!view || !q || asking) return;
    setAsking(true);
    setError(null);
    try {
      const r = await call<{ verdict: Verdict; view: View }>("/ask", {
        method: "POST",
        body: { id: view.id, question: q },
        timeoutMs: 60_000,
      });
      if (r.view.clues.length > view.clues.length) {
        setNewClue(true);
        setSheet("clues");
      }
      setView(r.view);
      setDraft("");
      // 폰에서 키보드가 내려가지 않게 바로 다시 포커스
      requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    } catch (e) {
      if (isGateError(e)) setLocked(true);
      else setError(errText(e));
    } finally {
      setAsking(false);
    }
  }, [draft, view, asking]);

  const submit = async () => {
    if (!view || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const v = await call<View>("/submit", { method: "POST", body: { id: view.id, answer }, timeoutMs: 90_000 });
      setView(v);
      if (v.status === "solved") setSheet("truth");
    } catch (e) {
      setError(errText(e));
    } finally {
      setSubmitting(false);
    }
  };

  const giveUp = async () => {
    if (!view || !confirm("포기하면 진상이 공개되고 이 판은 끝나요. 포기할까요?")) return;
    try {
      setView(await call<View>("/give-up", { method: "POST", body: { id: view.id } }));
      setSheet("truth");
    } catch (e) {
      setError(errText(e));
    }
  };

  const flag = async (index: number) => {
    if (!view || flagged.has(index)) return;
    const note = prompt("이 판정이 왜 이상한가요? (비워도 돼요)", "");
    if (note === null) return;
    try {
      await call("/flag", { method: "POST", body: { id: view.id, index, note } });
      setFlagged((s) => new Set(s).add(index));
    } catch (e) {
      setError(errText(e));
    }
  };

  const leave = () => {
    save(null);
    setView(null);
    setSheet(null);
    setError(null);
  };

  // 수사 노트: 판정별로 자동 분류 (반려 · 나눠서는 뺌)
  const notes = useMemo(() => {
    const g = { yes: [] as { i: number; text: string; key: boolean }[], no: [] as { i: number; text: string; key: boolean }[], unknown: [] as { i: number; text: string }[], unrelated: [] as { i: number; text: string }[] };
    view?.questions.forEach((q, i) => {
      if (q.verdict === "YES" || q.verdict === "KEY_YES") g.yes.push({ i, text: q.text, key: q.verdict === "KEY_YES" });
      else if (q.verdict === "NO" || q.verdict === "KEY_NO") g.no.push({ i, text: q.text, key: q.verdict === "KEY_NO" });
      else if (q.verdict === "UNKNOWN") g.unknown.push({ i, text: q.text });
      else if (q.verdict === "UNRELATED") g.unrelated.push({ i, text: q.text });
    });
    return g;
  }, [view?.questions]);

  const lightbox = zoom && <Lightbox src={zoom} onClose={() => setZoom(null)} />;

  // ── 입장 가림막 ──
  if (locked !== false) {
    if (locked === null)
      return (
        <div className="mq mq-desk mx-auto max-w-[1180px] py-24 text-center">
          <p className="mq-hand text-xl text-[#f4ead2]/70">사건 파일을 꺼내는 중…</p>
        </div>
      );
    return (
      <Gate
        onPass={(pw) => {
          gateMem = pw;
          writeGate(pw);
          setLocked(null);
          setTick((t) => t + 1);
        }}
      />
    );
  }

  // ── 사건 목록: 코르크판 ──
  if (!view) {
    return (
      <div className="mq mq-desk mx-auto max-w-[1180px] sm:p-5">
        {admin && <AdminBar cases={cases ?? []} />}
        <div className="mq-cork">
          {/* 게시판 머리 */}
          <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
            <div className="mq-paper relative -rotate-1 px-5 pt-4 pb-3">
              <span className="mq-pin" />
              <p className="mq-type text-[11px] text-[var(--ink3)]">DETECTIVE OFFICE · 사건 의뢰</p>
              <h2 className="mq-pen text-[34px] leading-none sm:text-[42px]">해결을 기다리는 사건들</h2>
              <p className="mq-hand mt-1 text-[18px] text-[var(--ink2)]">예 · 아니오로만 묻고, 전말을 맞혀 주세요.</p>
            </div>
            {resume && (
              <button onClick={() => enter(resume)} className="mq-postit w-[220px] rotate-2 px-4 pt-5 pb-4 text-left transition hover:rotate-0">
                <span className="mq-tape" />
                <p className="mq-hand text-[15px] text-[var(--ink2)]">하던 사건이 있어요</p>
                <p className="mq-pen text-[28px] leading-none">{resume.case.title}</p>
                <p className="mq-hand mt-1 text-[15px] text-[var(--ink2)]">
                  질문 {resume.used}/{resume.case.questionLimit} · 단서 {resume.clues.length}/{resume.case.clueCount}
                </p>
                <span className="mq-btn mq-btn-wine mt-2 min-h-0 px-3 py-1.5 text-sm">이어서 수사 →</span>
              </button>
            )}
          </div>

          {!enabled && (
            <p className="mq-paper mq-hand mb-6 px-4 py-3 text-[18px] text-[var(--no)]">판정관이 자리를 비웠어요. 잠시 뒤 다시 들어와 주세요.</p>
          )}
          {error && <p className="mq-paper mq-hand mb-6 px-4 py-3 text-[18px] text-[var(--no)]">{error}</p>}

          {/* 압정 박힌 사건 쪽지들 */}
          <div className="grid gap-x-6 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
            {(cases ?? []).map((c, i) => (
              <button
                key={c.id}
                disabled={!enabled}
                onClick={() => start(c.id)}
                className="mq-paper group relative px-4 pt-5 pb-4 text-left transition duration-200 hover:z-10 hover:scale-[1.02] hover:rotate-0 disabled:opacity-50"
                style={{ rotate: `${TILT[i % TILT.length]}deg` }}
              >
                <span className={`mq-pin ${PIN[i % PIN.length]}`} />
                <div className="mq-polaroid relative mx-auto -mt-1 w-[94%]" style={{ rotate: `${-TILT[i % TILT.length] * 0.8}deg` }}>
                  <Photo src={c.cover} onZoom={setZoom} className="aspect-[3/2] w-full" />
                </div>
                <div className="mt-3 flex items-start justify-between gap-2">
                  <h3 className="mq-pen text-[32px] leading-none group-hover:text-[var(--wine)]">{c.title}</h3>
                  <LevelStamp level={c.level} />
                </div>
                {c.candidate && <span className="mq-type text-[11px] text-[var(--wine)]">후보 사건 (관리자에게만 보임)</span>}
                <p className="mq-hand mt-2 line-clamp-4 text-[19px] leading-snug text-[var(--ink)]">{c.prompt}</p>
                <p className="mq-type mt-3 border-t border-dashed border-[var(--line)] pt-2 text-[11px] text-[var(--ink3)]">
                  CASE #{String(i + 1).padStart(2, "0")} · 질문 {c.questionLimit} · 단서 {c.clueCount} · 핵심 {c.rubricCount}
                  {c.bonusCount > 0 && ` +${c.bonusCount}`}
                </p>
              </button>
            ))}
            {!cases && !error && <p className="mq-hand text-xl text-[#3a2718]">사건 파일을 꺼내는 중…</p>}
          </div>

          {/* 판정 도장 견본 */}
          <div className="mq-paper mt-10 flex max-w-[640px] -rotate-[0.6deg] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <span className="mq-type text-[11px] text-[var(--ink3)]">판정 도장</span>
            {(["YES", "NO", "UNKNOWN", "UNRELATED"] as Verdict[]).map((v) => (
              <Stamp key={v} v={v} />
            ))}
            <span className="mq-hand text-[16px] text-[var(--ink2)]">중요한 걸 처음 짚으면 큰 도장 · 판정이 이상하면 🚩</span>
          </div>
        </div>
        {lightbox}
      </div>
    );
  }

  // ── 플레이: 책상 위 ──
  const c = view.case;
  const done = view.status !== "playing";
  const outOfQuestions = view.used >= c.questionLimit;
  const submitsLeft = c.submitLimit - view.submissions.length;
  const last = view.submissions.at(-1);
  const keyHits = view.questions.filter((q) => isKey(q.verdict)).length;
  const openClues = () => {
    setNewClue(false);
    setSheet("clues");
  };

  /** 진행: 질문 막대(단서 압정) · 다음 단서 · 남은 제출(봉랍) */
  const progress = (
    <div className="space-y-1.5 lg:space-y-2.5">
      <div>
        <div className="flex items-baseline justify-between">
          <span className="mq-hand text-[16px] text-[var(--ink2)] lg:text-[17px]">질문</span>
          <span className="mq-type text-[13px]">
            <b className="text-[17px]">{view.used}</b>
            <span className="text-[var(--ink3)]"> / {c.questionLimit}</span>
          </span>
        </div>
        <div className="mq-track mt-1.5">
          <i style={{ width: `${Math.min(100, (view.used / c.questionLimit) * 100)}%` }} />
          {(c.clueAt ?? []).map((at, i) => (
            <span
              key={i}
              title={`단서 ${i + 1} · ${at}문`}
              className={`mq-pin blue ${view.used >= at || done ? "" : "opacity-40 grayscale"}`}
              style={{ left: `calc(${(at / c.questionLimit) * 100}% - 8px)`, top: -4, width: 16, height: 16 }}
            />
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <button onClick={openClues} className="min-w-0 text-left">
          {view.nextClueAt !== null ? (
            <span className="mq-hand text-[17px] leading-tight lg:text-[18px]">
              다음 단서까지 <b className="mq-pen text-[24px] text-[var(--navy)] lg:text-[28px]">{view.nextClueAt - view.used}</b>문
            </span>
          ) : (
            <span className="mq-hand text-[18px]">단서 모두 공개</span>
          )}
          <span className="mq-type block text-[11px] text-[var(--ink3)]">
            단서 {view.clues.length}/{c.clueCount} 열림
          </span>
        </button>
        <div className="shrink-0 text-right">
          <div className="flex justify-end gap-1">
            {Array.from({ length: c.submitLimit }, (_, i) => (
              <span key={i} className={`mq-seal ${i < submitsLeft ? "" : "used"}`} />
            ))}
          </div>
          <span className="mq-type mt-1 block text-[11px] text-[var(--ink3)]">남은 보고 {submitsLeft}</span>
        </div>
      </div>
    </div>
  );

  /** 왼쪽(PC) / 위(폰): 마닐라 폴더 */
  const folder = (
    <div className="mq-manila px-3 pt-4 pb-3 sm:px-4">
      <span className="mq-clip hidden lg:block" />
      {/* 폰: 접힌 머리 (작은 사진 + 제목) */}
      <div className="flex items-start gap-3 lg:hidden">
        {c.cover && (
          <div className="mq-polaroid w-[84px] shrink-0 -rotate-2 !p-1 !pb-3">
            <Photo src={c.cover} onZoom={setZoom} className="aspect-[3/2] w-full" />
          </div>
        )}
        <button className="min-w-0 flex-1 text-left" onClick={() => setExpanded((x) => !x)}>
          <div className="flex items-center gap-2">
            <h2 className="mq-pen truncate text-[28px] leading-none">{c.title}</h2>
            <LevelStamp level={c.level} />
          </div>
          <p className={`mq-hand mt-1 text-[17px] leading-snug ${expanded ? "" : "line-clamp-2"}`}>{c.prompt}</p>
          <span className="mq-type text-[10px] text-[var(--ink3)]">{expanded ? "접기 ▲" : "문제 전체 보기 ▼"}</span>
        </button>
      </div>
      {expanded && c.cover && (
        <div className="mq-polaroid mt-3 lg:hidden">
          <Photo src={c.cover} onZoom={setZoom} className="aspect-[3/2] w-full" />
        </div>
      )}
      {/* PC: 큰 사진 + 문제 */}
      <div className="hidden lg:block">
        <div className="mq-polaroid relative mx-auto mt-1 rotate-[-1.2deg]">
          <span className="mq-tape" />
          <Photo src={c.cover} onZoom={setZoom} className="aspect-[3/2] w-full" />
          <span className="mq-hand absolute right-2 bottom-0.5 text-[13px] text-[var(--ink3)]">🔍 눌러서 크게</span>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <h2 className="mq-pen text-[38px] leading-none">{c.title}</h2>
          <LevelStamp level={c.level} />
          {c.candidate && <span className="mq-type text-[10px] text-[var(--wine)]">후보</span>}
        </div>
        <p className="mq-hand mt-2 text-[20px] leading-snug">{c.prompt}</p>
      </div>
      <div className="mt-3 border-t border-dashed border-[rgba(90,65,40,.45)] pt-3">{progress}</div>
      <p className="mq-type mt-3 hidden text-[11px] text-[var(--ink2)] lg:block">
        큰 도장 {keyHits} · 핵심 {c.rubricCount}가지{c.bonusCount > 0 && ` · 보너스 ${c.bonusCount}`}
      </p>
    </div>
  );

  /** 단서 · 노트 · 보고서 · 포기 */
  const actions = (
    <div className="grid grid-cols-3 gap-2 lg:grid-cols-2">
      <button onClick={openClues} className="mq-btn mq-btn-wood relative">
        🔎 단서 {view.clues.length}
        {newClue && <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-[#ffd36b] shadow-[0_0_10px_#ffd36b]" />}
      </button>
      <button onClick={() => setSheet("notes")} className="mq-btn mq-btn-wood lg:hidden">
        📒 노트 {notes.yes.length + notes.no.length}
      </button>
      {done ? (
        <button onClick={() => setSheet("truth")} className="mq-btn mq-btn-wine">
          진상 보기
        </button>
      ) : (
        <button onClick={() => setSheet("submit")} className="mq-btn mq-btn-wine">
          <span className="lg:hidden">보고서</span>
          <span className="hidden lg:inline">보고서 제출</span>
        </button>
      )}
      <button onClick={done ? leave : giveUp} className="mq-btn mq-btn-paper hidden text-sm lg:col-span-2 lg:flex">
        {done ? "다른 사건" : "포기하고 진상 보기"}
      </button>
    </div>
  );

  const noteBlock = (mark: string, title: string, items: { i: number; text: string; key?: boolean }[], color: string) => (
    <div>
      <div className="flex items-baseline justify-between">
        <h4 className="mq-pen text-[26px] leading-none" style={{ color }}>
          {mark} {title}
        </h4>
        <span className="mq-type text-[11px] text-[var(--ink3)]">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="mq-hand mt-0.5 text-[17px] text-[var(--ink3)]">…</p>
      ) : (
        <ul className="mt-0.5">
          {items.map((it) => (
            <li key={it.i} className="mq-hand flex gap-1.5 text-[18px] leading-[32px]">
              <span className="mq-type w-6 shrink-0 text-[11px] leading-[32px] text-[var(--ink3)]">{String(it.i + 1).padStart(2, "0")}</span>
              <span className={it.key ? "font-bold underline decoration-[var(--wine2)] decoration-2 underline-offset-4" : ""}>{it.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  /** 수사 노트 — 판정별 자동 정리 */
  const notesBody = (
    <div className="space-y-3">
      {noteBlock("✔", "그렇다", notes.yes, "var(--yes)")}
      {noteBlock("✘", "아니다", notes.no, "var(--no)")}
      {noteBlock("?", "모르겠다", notes.unknown, "var(--maybe)")}
      {noteBlock("—", "상관없다", notes.unrelated, "var(--ink3)")}
    </div>
  );

  return (
    <div
      ref={boxRef}
      style={{ height: boxH ?? undefined }}
      className="mq mq-desk mx-auto flex h-[calc(100dvh-10rem)] max-w-[1240px] flex-col gap-2.5 !p-2 sm:!p-3 lg:grid lg:grid-cols-[380px_minmax(0,1fr)_290px] lg:gap-4 lg:!p-4"
    >
      <style>{"html.mp-playing .quick-menu-fab{display:none}"}</style>

      {/* 왼쪽(PC) / 위(폰): 폴더 */}
      <div className="flex shrink-0 flex-col gap-2.5 lg:min-h-0 lg:gap-3 lg:overflow-y-auto lg:pt-3 lg:pr-1">
        <button onClick={leave} className="mq-hand self-start text-[17px] text-[#f4ead2]/75 hover:text-[#f4ead2]">
          ← 사건 게시판으로
        </button>
        {folder}
      </div>

      {/* 가운데: 심문 기록 (줄노트) */}
      <div className="mq-lined flex min-h-0 flex-1 flex-col">
        <div className="flex items-baseline justify-between border-b border-[rgba(90,65,40,.25)] py-2 pr-3 pl-12">
          <h3 className="mq-pen text-[28px] leading-none">심문 기록</h3>
          <span className="mq-type text-[11px] text-[var(--ink3)]">질문 {c.questionLimit - view.used}개 남음</span>
        </div>
        <div ref={logRef} className="min-h-0 flex-1 overflow-y-auto pt-1 pr-3 pb-3 pl-2">
          {view.questions.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 pl-10 text-center">
              <p className="mq-pen text-[30px] leading-none text-[var(--ink2)]">무엇이든 물어보세요</p>
              <p className="mq-hand text-[18px] leading-snug text-[var(--ink2)]">
                단, 예 · 아니오로 답할 수 있게.
                <br />
                누가 · 왜 · 어떻게로 물으면 반려돼요.
              </p>
              <p className="mq-hand text-[16px] text-[var(--ink3)]">예) 범죄가 있나요? · 두 사람은 아는 사이인가요?</p>
            </div>
          )}
          {view.questions.map((q, i) => {
            const s = STAMP[q.verdict];
            const dead = q.verdict === "INVALID";
            return (
              <div key={i} className="group flex gap-2 py-1">
                <span className="mq-type w-8 shrink-0 pt-1.5 text-right text-[11px] text-[var(--ink3)]">{dead ? "·" : String(i + 1).padStart(2, "0")}</span>
                <div className="min-w-0 flex-1 pl-2">
                  <div className="flex items-start gap-2">
                    <p className={`mq-hand min-w-0 flex-1 text-[21px] leading-[32px] ${dead ? "text-[var(--ink3)] line-through" : ""}`}>{q.text}</p>
                    <button
                      onClick={() => flag(i)}
                      disabled={flagged.has(i)}
                      title="판정이 이상해요"
                      className={`shrink-0 pt-1 text-sm transition ${flagged.has(i) ? "opacity-100" : "opacity-30 hover:opacity-90 lg:opacity-0 lg:group-hover:opacity-60"}`}
                    >
                      {flagged.has(i) ? "🚩✓" : "🚩"}
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-1">
                    <Stamp v={q.verdict} />
                    {s.note && <span className="mq-hand text-[15px] text-[var(--ink3)]">{s.note}</span>}
                  </div>
                </div>
              </div>
            );
          })}
          {asking && <p className="mq-hand animate-pulse py-2 pl-12 text-[18px] text-[var(--ink2)]">판정관이 사실을 확인하는 중…</p>}
        </div>

        <div className="border-t border-[rgba(90,65,40,.3)] bg-[rgba(234,220,184,.55)] p-2 sm:p-3">
          {error && <p className="mq-hand mb-1.5 px-1 text-[16px] text-[var(--no)]">{error}</p>}
          {done ? (
            <div className="flex items-center justify-between gap-3 px-1">
              <span className="mq-hand text-[18px]">{view.status === "solved" ? "사건 해결! 진상을 확인해 보세요." : "덮어 둔 사건이에요."}</span>
              <button onClick={() => setSheet("truth")} className="mq-btn mq-btn-wine min-h-0 px-3 py-2 text-sm">
                진상 →
              </button>
            </div>
          ) : outOfQuestions ? (
            <p className="mq-hand px-1 text-center text-[18px]">질문을 다 썼어요. 보고서를 내거나 포기하세요.</p>
          ) : (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                ask();
              }}
            >
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={120}
                disabled={asking}
                autoComplete="off"
                enterKeyHint="send"
                placeholder="예 · 아니오로 답할 수 있는 질문"
                className="mq-input min-w-0 flex-1 disabled:opacity-60"
              />
              <button disabled={asking || !draft.trim()} className="mq-btn mq-btn-wine shrink-0 px-5">
                묻기
              </button>
            </form>
          )}
          <div className="mt-2 lg:hidden">{actions}</div>
        </div>
      </div>

      {/* 오른쪽(PC): 스프링 수사 노트 */}
      <div className="mq-lined mq-spiral hidden min-h-0 flex-col lg:flex">
        <div className="flex items-baseline justify-between pr-3 pb-1 pl-12">
          <h3 className="mq-pen text-[28px] leading-none text-[var(--wine)]">수사 노트</h3>
          <span className="mq-type text-[10px] text-[var(--ink3)]">자동 정리</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pr-3 pb-3 pl-12">{notesBody}</div>
        <div className="border-t border-[rgba(90,65,40,.3)] bg-[rgba(234,220,184,.55)] p-3">{actions}</div>
      </div>

      {/* 단서: 사진 · 쪽지 */}
      <Sheet open={sheet === "clues"} onClose={() => setSheet(null)} title={newClue ? "새 단서가 도착했어요" : "단서"} wide>
        {view.clues.length === 0 ? (
          <p className="mq-hand text-[19px] text-[var(--ink2)]">
            아직 도착한 단서가 없어요.{view.nextClueAt !== null && ` 질문 ${view.nextClueAt}개째에 첫 단서가 와요.`}
          </p>
        ) : (
          <ol className="space-y-7 pt-2">
            {view.clues.map((cl, i) => (
              <li key={cl.id} className="mq-paper relative px-3 pt-5 pb-3" style={{ rotate: `${i % 2 ? 0.6 : -0.6}deg` }}>
                <span className={`mq-pin ${PIN[(i + 1) % PIN.length]}`} />
                <p className="mq-type text-[11px] text-[var(--wine)]">단서 {i + 1}</p>
                {cl.image && (
                  <div className="mq-polaroid mt-2">
                    <Photo src={cl.image} onZoom={setZoom} className="w-full !object-contain" />
                  </div>
                )}
                <p className="mq-hand mt-2 text-[19px] leading-snug">{cl.body}</p>
              </li>
            ))}
          </ol>
        )}
        {view.nextClueAt !== null && view.clues.length > 0 && <p className="mq-hand mt-4 text-[17px] text-[var(--ink2)]">다음 단서는 질문 {view.nextClueAt}개째에 와요.</p>}
      </Sheet>

      {/* 노트 (폰) */}
      <Sheet open={sheet === "notes"} onClose={() => setSheet(null)} title="수사 노트" lined>
        <div className="pl-8">{notesBody}</div>
        {!done && (
          <button onClick={giveUp} className="mq-btn mq-btn-paper mt-6 w-full text-sm">
            포기하고 진상 보기
          </button>
        )}
      </Sheet>

      {/* 수사 보고서 (정답 제출) */}
      <Sheet open={sheet === "submit"} onClose={() => setSheet(null)} title={`수사 보고서 · 남은 제출 ${submitsLeft}`}>
        <p className="mq-hand text-[18px] leading-snug text-[var(--ink2)]">
          알아낸 전말을 적어 주세요. 핵심 <b className="text-[var(--ink)]">{c.rubricCount}가지</b>를 모두 맞히면 해결이에요.
          {c.bonusCount > 0 && ` 세부 사항 ${c.bonusCount}가지는 보너스.`} 말투는 상관없어요.
        </p>
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          maxLength={1500}
          rows={7}
          placeholder="누가 · 무엇을 · 왜 · 어떻게 — 아는 만큼만 써도 채점돼요"
          className="mq-input mt-3 resize-none"
          style={{ background: "repeating-linear-gradient(180deg, #fffaf0 0 31px, rgba(80,120,170,.2) 31px 32px)", lineHeight: "32px" }}
        />
        <div className="mq-type mt-1 text-right text-[11px] text-[var(--ink3)]">{answer.length}/1500</div>
        {error && <p className="mq-hand mt-1 text-[16px] text-[var(--no)]">{error}</p>}
        <button onClick={submit} disabled={submitting || submitsLeft <= 0 || answer.trim().length < 10} className="mq-btn mq-btn-wine mt-2 w-full">
          {submitting ? "채점 중…" : submitsLeft <= 0 ? "제출 기회를 다 썼어요" : "보고서 제출"}
        </button>

        {last && (
          <div className="mq-paper relative mt-6 px-4 pt-4 pb-3">
            <div className="flex items-center justify-between gap-3">
              <span className="mq-type text-[11px] text-[var(--ink3)]">{view.submissions.length}번째 보고서 검토</span>
              <span className={`mq-stamp big ${last.passed === last.total ? "yes" : "maybe"}`}>
                인정 {last.passed}/{last.total}
              </span>
            </div>
            {last.bonusTotal > 0 && (
              <p className="mq-hand mt-2 text-[17px] text-[var(--ink2)]">
                보너스 {last.bonus.length}/{last.bonusTotal}
                {last.bonus.length > 0 && ` — ${last.bonus.join(" · ")}`}
              </p>
            )}
            {last.failed.length > 0 && (
              <ul className="mt-2 space-y-0.5">
                {last.failed.map((f, i) => (
                  <li key={i} className="mq-hand text-[18px]">
                    ✘ <b>{f.label}</b> <span className="text-[var(--ink3)]">— {STATUS_LABEL[f.status]}</span>
                  </li>
                ))}
              </ul>
            )}
            {last.same && <p className="mq-hand mt-2 text-[16px] text-[var(--maybe)]">지난번과 인정 범위가 같아요. 다른 방향을 더 물어보는 게 나을 수 있어요.</p>}
          </div>
        )}
        {view.submissions.length > 1 && (
          <p className="mq-type mt-2 text-[11px] text-[var(--ink3)]">
            지난 보고서 {view.submissions.slice(0, -1).map((s) => `${s.passed}/${s.total}${s.bonusTotal > 0 ? `(+${s.bonus.length})` : ""}`).join(" → ")}
          </p>
        )}
      </Sheet>

      {/* 진상 */}
      <Sheet open={sheet === "truth" && done} onClose={() => setSheet(null)} title={c.title} wide>
        <div className="flex flex-wrap items-center gap-4">
          <span className={`mq-stamp big ${view.status === "solved" ? "yes" : "no"}`} style={{ fontSize: 34 }}>
            {view.status === "solved" ? "사건 해결" : "미해결"}
          </span>
          <div className="mq-type flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-[var(--ink2)]">
            <span>질문 {view.stats.questions}</span>
            <span>큰 도장 {keyHits}</span>
            <span>보고서 {view.stats.submissions}</span>
            <span>단서 {view.clues.length}</span>
            <span>{fmtTime(view.stats.ms)}</span>
          </div>
        </div>
        {c.cover && (
          <div className="mq-polaroid mt-5 rotate-[-0.8deg]">
            <Photo src={c.cover} onZoom={setZoom} className="aspect-[3/2] w-full" />
          </div>
        )}
        <h4 className="mq-pen mt-5 text-[30px] leading-none text-[var(--wine)]">사건의 전말</h4>
        <p className="mt-2 text-[16px] leading-[1.85] whitespace-pre-line">{view.truth}</p>
        {last && last.bonus.length > 0 && <p className="mq-hand mt-3 text-[17px] text-[var(--ink2)]">보너스 인정: {last.bonus.join(" · ")}</p>}
        {c.credit && <p className="mq-type mt-3 text-[11px] text-[var(--ink3)]">{c.credit}</p>}
        <button onClick={leave} className="mq-btn mq-btn-wine mt-6 w-full">
          다른 사건 맡기
        </button>
      </Sheet>

      {lightbox}
    </div>
  );
}
