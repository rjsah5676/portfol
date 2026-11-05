"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/api/http";
import { ApiError } from "@/lib/api/errors";

/*
 * 예/아니오 추리 — 플레이 화면. 판 상태는 서버(/api/mystery-proto)가 들고 있고 화면은 그리기만.
 *  - 목록: 표지 카드 2열 · 이어하기 띠
 *  - PC: [사건 카드 · 진행] [질문 로그 + 입력] [수사 노트(판정별 자동 분류) + 단서]
 *  - 폰: 접히는 사건 머리 · 로그 · 하단 고정 입력 + 단서/노트/제출 단추 → 위아래 왕복 스크롤 없음
 *  - 단서 · 노트 · 정답 제출 · 진상은 시트(폰은 아래에서, PC는 가운데)
 *  - 판정마다 🚩 (오판 신고 → 서버에 모아서 사실 목록 보강)
 * 색은 포커보다 한 단계 어둡게(사건 파일 느낌): 바탕 #07080C · 패널 #0E1015 / #13161E · 금색 #D9B25F
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

/* ── 색 · 글꼴 ── */
const GOLD = "#D9B25F";
const font = "font-['Nanum_Gothic',sans-serif]";
const mono = "font-mono tracking-wider";
const display = "font-['Black_Han_Sans',sans-serif]";
const panel = "rounded-2xl border border-white/[0.07] bg-[#0E1015]";
const panel2 = "rounded-xl border border-white/[0.06] bg-[#13161E]";
const btnGold = "rounded-xl bg-[#D9B25F] text-[#15110A] font-bold hover:bg-[#E9C879] disabled:opacity-40 disabled:hover:bg-[#D9B25F]";
const btnGhost = "rounded-xl border border-white/10 bg-white/[0.04] text-white/80 hover:bg-white/[0.08] disabled:opacity-40";

/** 판정 표시. KEY 는 도장처럼 */
const BADGE: Record<Verdict, { label: string; short: string; cls: string; note?: string }> = {
  YES: { label: "네", short: "네", cls: "bg-[#5FD3A0]/10 text-[#7FE3B6] ring-[#5FD3A0]/30" },
  KEY_YES: { label: "네, 그렇습니다", short: "네!", cls: "bg-[#5FD3A0] text-[#07201A] ring-[#5FD3A0]" },
  NO: { label: "아니오", short: "아니오", cls: "bg-[#E0657A]/10 text-[#F0919F] ring-[#E0657A]/30" },
  KEY_NO: { label: "아니오, 그렇지 않습니다", short: "아니오!", cls: "bg-[#E0657A] text-white ring-[#E0657A]" },
  UNKNOWN: { label: "알 수 없음", short: "?", cls: "bg-[#D9B25F]/10 text-[#E9C879] ring-[#D9B25F]/30", note: "진상만으로는 정할 수 없는 내용이에요." },
  UNRELATED: { label: "상관없음", short: "무관", cls: "bg-white/[0.05] text-white/50 ring-white/10", note: "사건을 푸는 데 상관없는 방향이에요." },
  SPLIT: { label: "나눠서 물어보세요", short: "나눠서", cls: "bg-[#F2C14E]/10 text-[#F2C14E] ring-[#F2C14E]/40", note: "참과 거짓이 섞여 있어요. 한 번에 하나씩. (차감 안 됨)" },
  INVALID: { label: "반려", short: "반려", cls: "bg-white/[0.03] text-white/35 ring-white/10", note: "예/아니오로 답할 수 있는 질문만 받아요. (차감 안 됨)" },
};
const isKey = (v: Verdict) => v === "KEY_YES" || v === "KEY_NO";

const STATUS_LABEL: Record<FailStatus, string> = {
  missing: "아직 언급하지 않았어요",
  insufficient: "언급은 했지만 설명이 부족해요",
  wrong: "진상과 다르게 썼어요",
};

const LEVEL_CLS: Record<string, string> = {
  쉬움: "bg-[#5FD3A0]/15 text-[#7FE3B6]",
  보통: "bg-[#D9B25F]/15 text-[#E9C879]",
  어려움: "bg-[#E0657A]/15 text-[#F0919F]",
};

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

function LevelPill({ level, candidate }: { level: string; candidate?: boolean }) {
  return (
    <>
      <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${LEVEL_CLS[level] ?? "bg-white/10 text-white/70"}`}>{level}</span>
      {candidate && <span className="rounded-md bg-amber-400/20 px-1.5 py-0.5 text-[11px] font-bold text-amber-200">후보</span>}
    </>
  );
}

function Bar({ value, max, color = GOLD }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.07]">
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

function Stat({ label, value, max, color, hint }: { label: string; value: number; max: number; color?: string; hint?: string }) {
  return (
    <div>
      <div className={`${mono} flex items-baseline justify-between text-[10px] text-white/40`}>
        <span>{label}</span>
        <span>
          <b className="text-sm text-white">{value}</b>
          <span className="text-white/30">/{max}</span>
          {hint && <span className="ml-1.5 text-white/30">{hint}</span>}
        </span>
      </div>
      <div className="mt-1">
        <Bar value={value} max={max} color={color} />
      </div>
    </div>
  );
}

function Cover({ src, className = "" }: { src?: string; className?: string }) {
  if (src) return <img src={src} alt="" draggable={false} className={`block w-full object-cover ${className}`} />;
  return (
    <div className={`flex w-full items-center justify-center bg-[radial-gradient(circle_at_30%_20%,#1B1F2A,#0A0B10)] ${className}`}>
      <span className={`${display} text-5xl text-white/10`}>?</span>
    </div>
  );
}

function VerdictChip({ v, big }: { v: Verdict; big?: boolean }) {
  const b = BADGE[v];
  if (isKey(v))
    return (
      <span
        className={`${display} inline-flex -rotate-2 items-center gap-1 rounded-md px-2.5 py-1 text-sm tracking-wide ring-2 ring-offset-2 ring-offset-[#0E1015] ${b.cls}`}
      >
        <span className="text-[10px] opacity-70">핵심</span>
        {b.label}
      </span>
    );
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 ring-1 ${big ? "text-sm" : "text-xs"} ${b.cls}`}>{b.label}</span>;
}

/** 시트: 폰은 아래에서 올라오고, PC 는 가운데 창. 바깥 · Esc 로 닫힘 */
function Sheet({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-[2px] sm:items-center sm:p-4" onClick={onClose}>
      <div
        className={`${font} max-h-[88dvh] w-full ${wide ? "max-w-[720px]" : "max-w-[560px]"} overflow-y-auto rounded-t-2xl border border-white/10 bg-[#0E1015] p-5 text-white shadow-[0_-10px_60px_rgba(0,0,0,.6)] sm:rounded-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className={`${mono} text-[11px] text-[#D9B25F]`}>{title}</h3>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-white/40 hover:bg-white/10 hover:text-white" aria-label="닫기">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** 입장 비밀번호 (테스트 기간) */
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
    <div className={`${font} mx-auto max-w-[420px] py-10 text-white`}>
      <div className={`${panel} overflow-hidden`}>
        <div className="relative flex h-32 items-center justify-center bg-[radial-gradient(circle_at_50%_0%,#2A2416,#0E1015_70%)]">
          <span className={`${display} -rotate-6 rounded-md border-[3px] border-[#E0657A]/80 px-3 py-1 text-2xl tracking-widest text-[#E0657A]/80`}>
            CLASSIFIED
          </span>
        </div>
        <form
          className="p-5"
          onSubmit={(e) => {
            e.preventDefault();
            void go();
          }}
        >
          <p className={`${mono} text-[10px] text-[#D9B25F]`}>RESTRICTED · 테스트 중</p>
          <h2 className="mt-1 text-lg font-bold">관계자 외 열람 금지</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-white/55">지금은 초대받은 분들만 들어올 수 있어요. 받은 입장 비밀번호를 넣어 주세요.</p>
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoFocus
            autoComplete="off"
            placeholder="입장 비밀번호"
            className="mt-4 w-full rounded-xl border border-white/10 bg-[#13161E] px-3.5 py-3 text-[16px] text-white placeholder:text-white/25 focus:border-[#D9B25F]/60 focus:outline-none"
          />
          {err && <p className="mt-2 text-xs text-rose-300">{err}</p>}
          <button disabled={busy || !pw.trim()} className={`${btnGold} mt-3 w-full py-3 text-sm`}>
            {busy ? "확인 중…" : "입장"}
          </button>
        </form>
      </div>
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
  return (
    <div className={`${panel2} mb-5 flex flex-wrap items-center gap-2 px-3 py-2.5 text-xs`}>
      <span className={`${mono} text-[10px] text-[#D9B25F]`}>ADMIN · 플레이 기록</span>
      <select value={caseId} onChange={(e) => setCaseId(e.target.value)} className="rounded-lg border border-white/10 bg-[#0E1015] px-2 py-1.5 text-white/80">
        <option value="">전체 사건</option>
        {cases.map((c) => (
          <option key={c.id} value={c.id}>
            {c.title}
          </option>
        ))}
      </select>
      <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-lg border border-white/10 bg-[#0E1015] px-2 py-1.5 text-white/80">
        {[1, 7, 30, 365].map((d) => (
          <option key={d} value={d}>
            최근 {d}일
          </option>
        ))}
      </select>
      <button onClick={() => void pull("download")} className={`${btnGhost} px-3 py-1.5`}>
        JSON 받기
      </button>
      <button onClick={() => void pull("copy")} className={`${btnGhost} px-3 py-1.5`}>
        복사
      </button>
      {msg && <span className="text-white/45">{msg}</span>}
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
        // 하던 판이 있으면 "이어하기" 띠로 (바로 들어가지 않음 — 목록을 먼저 보여 줌)
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
      if (scroll) window.scrollTo({ top: Math.max(0, top - stuck - (mobile ? 6 : 12)) });
      setBoxH(mobile ? Math.max(360, Math.round(vh - stuck - 12)) : Math.max(560, Math.min(960, Math.round(vh - stuck - 24))));
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

  // 새 질문이 오면 로그 맨 아래로
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
      requestAnimationFrame(() => inputRef.current?.focus());
    } catch (e) {
      setError(errText(e));
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

  // ── 입장 가림막 ──
  if (locked !== false) {
    if (locked === null) return <p className={`${font} py-20 text-center text-sm text-white/40`}>사건 파일을 꺼내는 중…</p>;
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

  // ── 사건 목록 ──
  if (!view) {
    return (
      <div className={`${font} mx-auto max-w-[920px] text-white`}>
        {admin && <AdminBar cases={cases ?? []} />}
        {!enabled && (
          <p className="mb-4 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-200">
            판정관이 꺼져 있어요. 잠시 뒤 다시 들어와 주세요.
          </p>
        )}
        {error && <p className="mb-4 text-sm text-rose-300">{error}</p>}

        {resume && (
          <button
            onClick={() => enter(resume)}
            className={`${panel} mb-5 flex w-full items-center gap-4 p-3 text-left transition hover:border-[#D9B25F]/50`}
          >
            <div className="h-14 w-20 shrink-0 overflow-hidden rounded-lg">
              <Cover src={resume.case.cover} className="h-full" />
            </div>
            <div className="min-w-0 flex-1">
              <div className={`${mono} text-[10px] text-[#D9B25F]`}>CONTINUE · 하던 사건</div>
              <div className="truncate font-bold">{resume.case.title}</div>
              <div className="text-xs text-white/45">
                질문 {resume.used}/{resume.case.questionLimit} · 단서 {resume.clues.length}/{resume.case.clueCount}
              </div>
            </div>
            <span className={`${btnGold} shrink-0 px-4 py-2 text-sm`}>이어하기</span>
          </button>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {(cases ?? []).map((c, i) => (
            <button
              key={c.id}
              disabled={!enabled}
              onClick={() => start(c.id)}
              className={`${panel} group overflow-hidden text-left transition hover:-translate-y-0.5 hover:border-[#D9B25F]/50 disabled:opacity-40`}
            >
              <div className="relative">
                <Cover src={c.cover} className="aspect-[3/2]" />
                <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#0E1015] to-transparent" />
                <div className="absolute top-2.5 left-2.5 flex gap-1.5">
                  <LevelPill level={c.level} candidate={c.candidate} />
                </div>
                <span className={`${mono} absolute top-2.5 right-2.5 rounded-md bg-black/50 px-1.5 py-0.5 text-[10px] text-white/70`}>
                  CASE #{String(i + 1).padStart(2, "0")}
                </span>
              </div>
              <div className="px-4 pt-1 pb-4">
                <div className="text-lg font-bold group-hover:text-[#E9C879]">{c.title}</div>
                <p className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-white/65">{c.prompt}</p>
                <div className={`${mono} mt-3 flex gap-3 text-[10px] text-white/35`}>
                  <span>
                    질문 <b className="text-white/70">{c.questionLimit}</b>
                  </span>
                  <span>
                    단서 <b className="text-white/70">{c.clueCount}</b>
                  </span>
                  <span>
                    정답 <b className="text-white/70">{c.rubricCount}</b>
                    {c.bonusCount > 0 && <span className="text-white/30"> +{c.bonusCount}</span>}
                  </span>
                </div>
              </div>
            </button>
          ))}
          {!cases && !error && <p className="text-sm text-white/40">사건 파일을 꺼내는 중…</p>}
        </div>

        <div className={`${mono} mt-8 flex flex-wrap items-center gap-x-3 gap-y-2 text-[10px] text-white/35`}>
          <span>판정</span>
          {(["YES", "NO", "UNKNOWN", "UNRELATED"] as Verdict[]).map((v) => (
            <VerdictChip key={v} v={v} />
          ))}
          <span className="text-white/25">· 핵심을 짚으면 큰 도장 · 판정이 이상하면 🚩</span>
        </div>
      </div>
    );
  }

  // ── 플레이 ──
  const c = view.case;
  const done = view.status !== "playing";
  const outOfQuestions = view.used >= c.questionLimit;
  const submitsLeft = c.submitLimit - view.submissions.length;
  const last = view.submissions.at(-1);
  const keyHits = view.questions.filter((q) => isKey(q.verdict)).length;

  const caseCard = (
    <div className={`${panel} overflow-hidden`}>
      <button className="block w-full text-left lg:pointer-events-none" onClick={() => setExpanded((x) => !x)}>
        {/* 표지: PC 는 항상, 폰은 펼쳤을 때만 */}
        <div className={`${expanded ? "" : "hidden lg:block"}`}>
          <Cover src={c.cover} className="aspect-[3/2]" />
        </div>
        <div className="p-3 sm:p-4">
          <div className="flex items-center gap-2">
            <LevelPill level={c.level} candidate={c.candidate} />
            <span className={`${mono} text-[10px] text-white/30`}>CONFIDENTIAL</span>
            <span className={`${mono} ml-auto text-[10px] text-white/40 lg:hidden`}>{expanded ? "접기 ▲" : "문제 보기 ▼"}</span>
          </div>
          <div className="mt-1.5 text-base font-bold sm:text-lg">{c.title}</div>
          <p className={`mt-1.5 text-sm leading-relaxed text-white/80 ${expanded ? "" : "line-clamp-1 lg:line-clamp-none"}`}>{c.prompt}</p>
        </div>
      </button>
      <div className="grid grid-cols-3 gap-3 border-t border-white/[0.06] px-3 py-3 sm:px-4 lg:grid-cols-1 lg:gap-3">
        <Stat label="질문" value={view.used} max={c.questionLimit} />
        <Stat label="단서" value={view.clues.length} max={c.clueCount} color="#9FB7FF" hint={view.nextClueAt !== null ? `다음 ${view.nextClueAt}문` : undefined} />
        <Stat label="제출" value={view.submissions.length} max={c.submitLimit} color="#E0657A" />
      </div>
      <p className={`${mono} hidden border-t border-white/[0.06] px-4 py-2.5 text-[10px] text-white/35 lg:block`}>
        핵심 도장 {keyHits} · 정답 항목 {c.rubricCount}
        {c.bonusCount > 0 && ` · 보너스 ${c.bonusCount}`}
      </p>
    </div>
  );

  const openClues = () => {
    setNewClue(false);
    setSheet("clues");
  };

  /** 단서 · 제출 · 포기 (PC 는 사건 카드 아래, 폰은 입력창 아래) */
  const actions = (
    <div className="grid grid-cols-3 gap-2 lg:grid-cols-1">
      <button onClick={openClues} className={`${btnGhost} relative py-2.5 text-sm`}>
        단서 <span className="text-white/50">{view.clues.length}</span>
        {newClue && <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-[#D9B25F] shadow-[0_0_8px_#D9B25F]" />}
      </button>
      <button onClick={() => setSheet("notes")} className={`${btnGhost} py-2.5 text-sm lg:hidden`}>
        노트 <span className="text-white/50">{notes.yes.length + notes.no.length}</span>
      </button>
      {done ? (
        <button onClick={() => setSheet("truth")} className={`${btnGold} py-2.5 text-sm`}>
          진상 보기
        </button>
      ) : (
        <button onClick={() => setSheet("submit")} className={`${btnGold} py-2.5 text-sm`}>
          정답 제출 <span className="opacity-60">{submitsLeft}</span>
        </button>
      )}
      <button onClick={done ? leave : giveUp} className={`${btnGhost} hidden py-2.5 text-sm text-white/50 lg:block`}>
        {done ? "다른 사건" : "포기"}
      </button>
    </div>
  );

  const noteBlock = (title: string, items: { i: number; text: string; key?: boolean }[], cls: string) => (
    <div>
      <div className={`${mono} mb-1.5 flex items-center justify-between text-[10px] ${cls}`}>
        <span>{title}</span>
        <span className="opacity-60">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-white/20">—</p>
      ) : (
        <ul className="space-y-1">
          {items.map((it) => (
            <li key={it.i} className={`flex gap-1.5 text-xs leading-snug ${it.key ? "font-bold text-white" : "text-white/70"}`}>
              <span className={`${mono} shrink-0 text-[10px] text-white/25`}>{String(it.i + 1).padStart(2, "0")}</span>
              <span>
                {it.key && <span className="mr-1 text-[#D9B25F]">★</span>}
                {it.text}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  /** 수사 노트 — 판정별 자동 정리 */
  const notesBody = (
    <div className="space-y-4">
      {noteBlock("확정 · 그렇다", notes.yes, "text-[#7FE3B6]")}
      {noteBlock("확정 · 아니다", notes.no, "text-[#F0919F]")}
      {noteBlock("미확정 · 알 수 없음", notes.unknown, "text-[#E9C879]")}
      {noteBlock("기각 · 상관없음", notes.unrelated, "text-white/40")}
    </div>
  );

  return (
    <div
      ref={boxRef}
      style={{ height: boxH ?? undefined }}
      className={`${font} mx-auto flex h-[calc(100dvh-10rem)] max-w-[1180px] flex-col gap-2 text-white lg:grid lg:grid-cols-[300px_minmax(0,1fr)_260px] lg:gap-4`}
    >
      <style>{"html.mp-playing .quick-menu-fab{display:none}"}</style>

      {/* 왼쪽(PC) / 위(폰): 사건 */}
      <div className="flex shrink-0 flex-col gap-2 lg:min-h-0 lg:gap-3 lg:overflow-y-auto">
        <div className="flex items-center justify-between px-0.5">
          <button onClick={leave} className={`${mono} text-[11px] text-white/40 hover:text-white/80`}>
            ← 사건 목록
          </button>
          <span className={`${mono} text-[10px] text-white/25`}>YES / NO CASE FILE</span>
        </div>
        {caseCard}
        <div className="hidden lg:block">{actions}</div>
      </div>

      {/* 가운데: 질문 로그 + 입력 */}
      <div className={`${panel} flex min-h-0 flex-1 flex-col`}>
        <div ref={logRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-2 sm:px-3">
          {view.questions.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <div className={`${display} text-4xl text-white/10`}>?</div>
              <p className="text-sm text-white/50">예/아니오로 답할 수 있는 질문을 던져 보세요.</p>
              <p className="text-xs leading-relaxed text-white/30">
                누가 · 왜 · 어떻게 같은 의문사 질문은 반려돼요.
                <br />
                예) 범죄가 있나요? · 두 사람은 아는 사이인가요? · 시간이 중요한가요?
              </p>
            </div>
          )}
          {view.questions.map((q, i) => {
            const b = BADGE[q.verdict];
            const key = isKey(q.verdict);
            const dead = q.verdict === "INVALID";
            return (
              <div
                key={i}
                className={`group rounded-xl px-2.5 py-2 ${key ? "my-1 bg-white/[0.05] ring-1 ring-white/[0.08]" : ""}`}
              >
                <div className="flex items-start gap-2">
                  <span className={`${mono} w-6 shrink-0 pt-0.5 text-right text-[10px] text-white/25`}>{dead ? "·" : String(i + 1).padStart(2, "0")}</span>
                  <p className={`min-w-0 flex-1 text-[15px] leading-relaxed ${dead ? "text-white/35 line-through" : "text-white/90"}`}>{q.text}</p>
                  <button
                    onClick={() => flag(i)}
                    disabled={flagged.has(i)}
                    title="판정이 이상해요"
                    className={`shrink-0 text-xs transition ${flagged.has(i) ? "opacity-100" : "opacity-25 hover:opacity-90 lg:opacity-0 lg:group-hover:opacity-60"}`}
                  >
                    {flagged.has(i) ? "🚩✓" : "🚩"}
                  </button>
                </div>
                <div className={`mt-1.5 flex flex-wrap items-center gap-2 pl-8 ${key ? "py-1" : ""}`}>
                  <VerdictChip v={q.verdict} />
                  {b.note && <span className="text-[11px] text-white/35">{b.note}</span>}
                </div>
              </div>
            );
          })}
          {asking && (
            <p className={`${mono} flex items-center gap-2 py-2 pl-8 text-[11px] text-white/40`}>
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#D9B25F]" />
              판정관이 사실을 확인하는 중…
            </p>
          )}
        </div>

        <div className="border-t border-white/[0.06] p-2 sm:p-3">
          {error && <p className="mb-2 px-1 text-xs text-rose-300">{error}</p>}
          {done ? (
            <div className="flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2.5 text-sm">
              <span className="text-white/60">{view.status === "solved" ? "사건 해결! 진상을 확인해 보세요." : "포기한 사건이에요."}</span>
              <button onClick={() => setSheet("truth")} className="font-bold text-[#E9C879]">
                진상 →
              </button>
            </div>
          ) : outOfQuestions ? (
            <p className="rounded-xl bg-white/[0.04] px-3 py-2.5 text-center text-sm text-white/60">질문을 다 썼어요. 정답을 제출하거나 포기하세요.</p>
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
                placeholder={`예/아니오 질문 · ${c.questionLimit - view.used}개 남음`}
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-[#13161E] px-3.5 py-2.5 text-[16px] text-white placeholder:text-white/25 focus:border-[#D9B25F]/60 focus:outline-none disabled:opacity-60"
              />
              <button disabled={asking || !draft.trim()} className={`${btnGold} shrink-0 px-5 text-sm`}>
                질문
              </button>
            </form>
          )}
          <div className="mt-2 lg:hidden">{actions}</div>
        </div>
      </div>

      {/* 오른쪽(PC): 수사 노트 */}
      <div className={`${panel} hidden min-h-0 flex-col lg:flex`}>
        <div className={`${mono} flex items-center justify-between border-b border-white/[0.06] px-4 py-3 text-[11px] text-[#D9B25F]`}>
          <span>NOTES · 수사 노트</span>
          <span className="text-white/30">자동 정리</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{notesBody}</div>
        {!done && (
          <button onClick={giveUp} className={`${mono} border-t border-white/[0.06] py-2.5 text-[10px] text-white/30 hover:text-white/60`}>
            포기하고 진상 보기
          </button>
        )}
      </div>

      {/* 단서 */}
      <Sheet open={sheet === "clues"} onClose={() => setSheet(null)} title={newClue ? "NEW EVIDENCE · 새 단서가 공개됐어요" : "EVIDENCE · 단서"} wide>
        {view.clues.length === 0 ? (
          <p className="text-sm text-white/50">
            아직 공개된 단서가 없어요.{view.nextClueAt !== null && ` 질문 ${view.nextClueAt}개째에 첫 단서가 열려요.`}
          </p>
        ) : (
          <ol className="space-y-4">
            {view.clues.map((cl, i) => (
              <li key={cl.id} className={`${panel2} overflow-hidden`}>
                {cl.image && <img src={cl.image} alt="" className="block w-full" />}
                <div className="p-3">
                  <div className={`${mono} text-[10px] text-[#D9B25F]`}>단서 {i + 1}</div>
                  <p className="mt-1 text-sm leading-relaxed text-white/85">{cl.body}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
        {view.nextClueAt !== null && view.clues.length > 0 && <p className="mt-3 text-xs text-white/40">다음 단서는 질문 {view.nextClueAt}개째에 열려요.</p>}
      </Sheet>

      {/* 노트 (폰) */}
      <Sheet open={sheet === "notes"} onClose={() => setSheet(null)} title="NOTES · 수사 노트">
        {notesBody}
        {/* 폰엔 포기 단추가 따로 없어서 여기 */}
        {!done && (
          <button onClick={giveUp} className={`${btnGhost} mt-6 w-full py-2.5 text-xs text-white/45`}>
            포기하고 진상 보기
          </button>
        )}
      </Sheet>

      {/* 정답 제출 */}
      <Sheet open={sheet === "submit"} onClose={() => setSheet(null)} title={`SUBMIT · 남은 제출 ${submitsLeft}회`}>
        <p className="text-sm leading-relaxed text-white/60">
          알아낸 전말을 적어 주세요. 핵심 <b className="text-white/85">{c.rubricCount}가지</b>를 모두 맞히면 해결이에요.
          {c.bonusCount > 0 && ` 세부 사항 ${c.bonusCount}가지는 보너스.`} 말투는 상관없어요.
        </p>
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          maxLength={1500}
          rows={6}
          placeholder="누가 · 무엇을 · 왜 · 어떻게 — 아는 만큼만 써도 채점돼요"
          className="mt-3 w-full resize-none rounded-xl border border-white/10 bg-[#13161E] p-3 text-[16px] leading-relaxed text-white placeholder:text-white/25 focus:border-[#D9B25F]/60 focus:outline-none"
        />
        <div className={`${mono} mt-1 text-right text-[10px] text-white/30`}>{answer.length}/1500</div>
        {error && <p className="mt-1 text-xs text-rose-300">{error}</p>}
        <button onClick={submit} disabled={submitting || submitsLeft <= 0 || answer.trim().length < 10} className={`${btnGold} mt-2 w-full py-3 text-sm`}>
          {submitting ? "채점 중…" : submitsLeft <= 0 ? "제출 기회를 다 썼어요" : "제출하기"}
        </button>

        {last && (
          <div className={`${panel2} mt-5 p-3`}>
            <div className="flex items-baseline justify-between">
              <span className={`${mono} text-[10px] text-white/40`}>최근 채점 · {view.submissions.length}번째</span>
              <span className="text-sm">
                인정 <b className={last.passed === last.total ? "text-[#7FE3B6]" : "text-[#E9C879]"}>{last.passed}</b>
                <span className="text-white/40">/{last.total}</span>
                {last.bonusTotal > 0 && (
                  <span className="ml-2 text-xs text-white/45">
                    보너스 {last.bonus.length}/{last.bonusTotal}
                  </span>
                )}
              </span>
            </div>
            <div className="mt-2">
              <Bar value={last.passed} max={last.total} color={last.passed === last.total ? "#5FD3A0" : GOLD} />
            </div>
            {last.bonus.length > 0 && <p className="mt-2 text-xs text-white/50">세부 사항 인정: {last.bonus.join(" · ")}</p>}
            {last.failed.length > 0 && (
              <ul className="mt-2 space-y-1">
                {last.failed.map((f, i) => (
                  <li key={i} className="text-sm text-white/75">
                    · <b>{f.label}</b> <span className="text-white/45">— {STATUS_LABEL[f.status]}</span>
                  </li>
                ))}
              </ul>
            )}
            {last.same && <p className="mt-2 text-xs text-amber-200/80">지난번과 인정 범위가 같아요. 다른 방향을 더 물어보는 게 나을 수 있어요.</p>}
          </div>
        )}
        {view.submissions.length > 1 && (
          <p className={`${mono} mt-2 text-[10px] text-white/35`}>
            지난 제출 {view.submissions.slice(0, -1).map((s) => `${s.passed}/${s.total}${s.bonusTotal > 0 ? `(+${s.bonus.length})` : ""}`).join(" → ")}
          </p>
        )}
      </Sheet>

      {/* 진상 */}
      <Sheet open={sheet === "truth" && done} onClose={() => setSheet(null)} title={view.status === "solved" ? "CASE CLOSED" : "UNSOLVED · 진상"} wide>
        <div className="flex items-center gap-4">
          <span
            className={`${display} -rotate-3 rounded-lg border-[3px] px-3 py-1 text-2xl tracking-wide ${view.status === "solved" ? "border-[#5FD3A0] text-[#5FD3A0]" : "border-[#E0657A] text-[#E0657A]"}`}
          >
            {view.status === "solved" ? "사건 해결" : "미해결"}
          </span>
          <div className={`${mono} flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-white/50`}>
            <span>질문 {view.stats.questions}</span>
            <span>도장 {keyHits}</span>
            <span>제출 {view.stats.submissions}</span>
            <span>단서 {view.clues.length}</span>
            <span>{fmtTime(view.stats.ms)}</span>
          </div>
        </div>
        {c.cover && (
          <div className="mt-4 overflow-hidden rounded-xl">
            <Cover src={c.cover} className="aspect-[3/2]" />
          </div>
        )}
        <h4 className="mt-4 text-lg font-bold">{c.title}</h4>
        <p className="mt-2 text-[15px] leading-relaxed whitespace-pre-line text-white/85">{view.truth}</p>
        {last && last.bonus.length > 0 && <p className="mt-3 text-xs text-white/50">보너스 인정: {last.bonus.join(" · ")}</p>}
        {c.credit && <p className={`${mono} mt-3 text-[10px] text-white/35`}>{c.credit}</p>}
        <button onClick={leave} className={`${btnGold} mt-5 w-full py-3 text-sm`}>
          다른 사건 하기
        </button>
      </Sheet>
    </div>
  );
}
