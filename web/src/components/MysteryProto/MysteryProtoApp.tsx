"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/api/http";
import { ApiError } from "@/lib/api/errors";

/*
 * 예/아니오 추리 (프로토) — 게임성 확인용 최소 화면. 판 상태는 서버(/api/mystery-proto)가 들고 있고 화면은 그리기만.
 *  - 모바일: 위 사건 미니 헤더(탭하면 펼침) · 가운데 질문 로그만 스크롤 · 아래 입력창 고정 → 위아래 왕복 스크롤 없음
 *  - PC: 왼쪽 사건 카드 · 오른쪽 로그 + 입력
 *  - 단서 · 정답 제출 · 진상은 바텀시트
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
  /** 후보 사건 (관리자 · 개발 모드에만 뜸) */
  candidate?: boolean;
}

interface View {
  id: string;
  case: PublicCase;
  questions: { text: string; verdict: Verdict }[];
  used: number;
  clues: { id: string; body: string }[];
  nextClueAt: number | null;
  submissions: { passed: number; total: number; failed: { label: string; status: FailStatus }[]; bonus: string[]; bonusTotal: number; same: boolean }[];
  status: "playing" | "solved" | "gave_up";
  truth: string | null;
  stats: { questions: number; submissions: number; ms: number };
}

const BADGE: Record<Verdict, { label: string; cls: string; note?: string }> = {
  YES: { label: "네", cls: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/40" },
  KEY_YES: { label: "네, 그렇습니다", cls: "bg-emerald-400 text-[#0B1A12] ring-emerald-300 font-bold" },
  NO: { label: "아니오", cls: "bg-rose-500/15 text-rose-300 ring-rose-400/40" },
  KEY_NO: { label: "아니오, 그렇지 않습니다", cls: "bg-rose-500 text-white ring-rose-300 font-bold" },
  UNKNOWN: { label: "알 수 없음", cls: "bg-amber-400/15 text-amber-200 ring-amber-300/40", note: "진상만으로는 정할 수 없는 내용이에요." },
  UNRELATED: { label: "상관없음", cls: "bg-slate-400/15 text-slate-300 ring-slate-300/30", note: "사건을 푸는 데 상관없는 방향이에요." },
  SPLIT: { label: "나눠서 물어보세요", cls: "bg-yellow-300/10 text-yellow-200 ring-yellow-300/50", note: "참과 거짓이 섞여 있어요. 한 번에 하나씩 물어보세요. (차감 안 됨)" },
  INVALID: { label: "반려", cls: "bg-white/5 text-white/40 ring-white/15", note: "예/아니오로 답할 수 있는 질문만 받아요. (차감 안 됨)" },
};

const STATUS_LABEL: Record<FailStatus, string> = {
  missing: "아직 언급하지 않았어요",
  insufficient: "언급은 했지만 설명이 부족해요",
  wrong: "진상과 다르게 썼어요",
};

const font = "font-['Nanum_Gothic',sans-serif]";
const mono = "font-mono tracking-wider";
const STORE = "mysteryProto.play";

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

function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <div
        className={`${font} max-h-[85dvh] w-full max-w-[560px] overflow-y-auto rounded-t-2xl border border-white/10 bg-[#14171F] p-5 text-white sm:rounded-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className={`${mono} text-xs text-[#C9A15B]`}>{title}</h3>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-white/50 hover:bg-white/10" aria-label="닫기">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function MysteryProtoApp() {
  const [cases, setCases] = useState<PublicCase[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [view, setView] = useState<View | null>(null);
  const [draft, setDraft] = useState("");
  const [answer, setAnswer] = useState("");
  const [asking, setAsking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | "clues" | "submit" | "truth">(null);
  const [newClue, setNewClue] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [flagged, setFlagged] = useState<Set<number>>(new Set());
  const logRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxH, setBoxH] = useState<number | null>(null);

  useEffect(() => {
    // 로그인돼 있으면 토큰을 같이 보냄 — 관리자면 후보 사건까지 목록에
    api<{ enabled: boolean; cases: PublicCase[] }>("/api/mystery-proto/cases", { auth: true })
      .then((r) => {
        setCases(r.cases);
        setEnabled(r.enabled);
      })
      .catch((e) => setError(errText(e)));
    const saved = load();
    if (saved)
      api<View>(`/api/mystery-proto/play/${saved}`)
        .then(setView)
        .catch(() => save(null));
  }, []);

  // 사이트 머리말 아래 남은 화면 높이를 꽉 채움 (스크롤 왕복 없이 입력창 · 버튼이 늘 보이게)
  const playing = !!view;
  useEffect(() => {
    if (!playing) return;
    // 사이트 빠른 메뉴 단추가 질문 단추를 가려서 판 중엔 숨김 (사건 파일 게임과 같은 방식)
    document.documentElement.classList.add("mp-playing");
    const fit = (scroll: boolean) => {
      const el = boxRef.current;
      if (!el) return;
      const vh = window.visualViewport?.height ?? window.innerHeight;
      const top = el.getBoundingClientRect().top + window.scrollY;
      if (window.innerWidth < 1024) {
        // 모바일: 머리말은 위로 밀어 내고 판이 화면을 꽉 채움 (위에 붙어 있는 메뉴 줄 높이만큼은 비움)
        const stuck = ["site-header", "site-nav"]
          .map((id) => document.getElementById(id))
          .filter((n): n is HTMLElement => !!n && ["sticky", "fixed"].includes(getComputedStyle(n).position))
          .reduce((m, n) => Math.max(m, (parseFloat(getComputedStyle(n).top) || 0) + n.getBoundingClientRect().height), 0);
        if (scroll) window.scrollTo({ top: Math.max(0, top - stuck - 6) });
        setBoxH(Math.max(360, Math.round(vh - stuck - 12)));
      } else {
        setBoxH(Math.max(480, Math.min(860, Math.round(vh - top - 12))));
      }
    };
    const onResize = () => fit(false);
    fit(true);
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    return () => {
      document.documentElement.classList.remove("mp-playing");
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, [playing]);

  // 새 질문이 오면 로그 맨 아래로
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [view?.questions.length]);

  const start = async (caseId: string) => {
    setError(null);
    try {
      const v = await api<View>("/api/mystery-proto/start", { method: "POST", body: { caseId } });
      setView(v);
      setFlagged(new Set());
      setDraft("");
      setAnswer("");
      setExpanded(false);
      save(v.id);
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
      const r = await api<{ verdict: Verdict; view: View }>("/api/mystery-proto/ask", {
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
      const v = await api<View>("/api/mystery-proto/submit", {
        method: "POST",
        body: { id: view.id, answer },
        timeoutMs: 90_000,
      });
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
      setView(await api<View>("/api/mystery-proto/give-up", { method: "POST", body: { id: view.id } }));
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
      await api("/api/mystery-proto/flag", { method: "POST", body: { id: view.id, index, note } });
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

  // ── 사건 고르기 ──
  if (!view) {
    return (
      <div className={`${font} mx-auto max-w-[720px] text-white`}>
        <p className={`${mono} text-[11px] text-[#C9A15B]`}>PROTOTYPE · YES / NO CASE FILES</p>
        <h1 className="mt-1 text-2xl font-bold">예/아니오 추리</h1>
        <p className="mt-2 text-sm leading-relaxed text-white/60">
          짧은 사건 하나가 주어집니다. 예/아니오로 답할 수 있는 질문을 던져 진상을 좁히고, 알아낸 전말을 적어 제출하세요.
          판정이 이상하면 🚩를 눌러 주세요.
        </p>
        {!enabled && (
          <p className="mt-4 rounded-lg border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-200">
            판정관이 꺼져 있어요. server/.env 에 GEMINI_API_KEY 또는 GROQ_API_KEY 를 넣고 서버를 다시 켜 주세요.
          </p>
        )}
        {error && <p className="mt-4 text-sm text-rose-300">{error}</p>}
        <div className="mt-6 grid gap-3">
          {(cases ?? []).map((c, i) => (
            <button
              key={c.id}
              disabled={!enabled}
              onClick={() => start(c.id)}
              className="group rounded-xl border border-white/10 bg-[#14171F] p-4 text-left transition hover:border-[#C9A15B]/60 disabled:opacity-40"
            >
              <div className={`${mono} flex items-center gap-2 text-[11px] text-white/40`}>
                <span>CASE #{String(i + 1).padStart(2, "0")}</span>
                <span className="rounded bg-white/10 px-1.5 py-0.5 text-white/70">{c.level}</span>
                {c.candidate && <span className="rounded bg-amber-400/20 px-1.5 py-0.5 text-amber-200">후보</span>}
                <span>질문 {c.questionLimit} · 단서 {c.clueCount}</span>
              </div>
              <div className="mt-1.5 text-lg font-bold group-hover:text-[#E9C98B]">{c.title}</div>
              <p className="mt-1 text-sm leading-relaxed text-white/70">{c.prompt}</p>
            </button>
          ))}
          {!cases && !error && <p className="text-sm text-white/40">불러오는 중…</p>}
        </div>
      </div>
    );
  }

  const c = view.case;
  const done = view.status !== "playing";
  const outOfQuestions = view.used >= c.questionLimit;
  const submitsLeft = c.submitLimit - view.submissions.length;
  const last = view.submissions.at(-1);

  const caseCard = (
    <div className="rounded-xl border border-white/10 bg-[#14171F] p-3 sm:p-4">
      <button className="block w-full text-left lg:pointer-events-none" onClick={() => setExpanded((x) => !x)}>
        <div className={`${mono} flex items-center gap-2 text-[10px] text-white/40`}>
          <span className="text-[#C9A15B]">CONFIDENTIAL</span>
          <span className="rounded bg-white/10 px-1.5 py-0.5 text-white/70">{c.level}</span>
          {c.candidate && <span className="rounded bg-amber-400/20 px-1.5 py-0.5 text-amber-200">후보</span>}
          <span className="ml-auto lg:hidden">{expanded ? "접기 ▲" : "펼치기 ▼"}</span>
        </div>
        <div className="mt-1 font-bold">{c.title}</div>
        <p className={`mt-1 text-sm leading-relaxed text-white/80 ${expanded ? "" : "line-clamp-2 lg:line-clamp-none"}`}>{c.prompt}</p>
      </button>
      <div className={`${mono} mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-white/50`}>
        <span>
          질문 <b className="text-white">{view.used}</b>/{c.questionLimit}
        </span>
        <span>
          단서 <b className="text-white">{view.clues.length}</b>/{c.clueCount}
          {view.nextClueAt !== null && ` · 다음 ${view.nextClueAt}문`}
        </span>
        <span>
          제출 <b className="text-white">{view.submissions.length}</b>/{c.submitLimit}
        </span>
      </div>
      <p className="mt-2 hidden text-xs text-white/40 lg:block">전말의 핵심 {c.rubricCount}가지를 모두 맞혀야 해결이에요.</p>
    </div>
  );

  const actions = (
    <div className="grid grid-cols-3 gap-2">
      <button
        onClick={() => {
          setNewClue(false);
          setSheet("clues");
        }}
        className="relative rounded-lg border border-white/10 bg-white/5 py-2 text-sm hover:bg-white/10"
      >
        단서 {view.clues.length}
        {newClue && <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-[#C9A15B]" />}
      </button>
      {done ? (
        <button onClick={() => setSheet("truth")} className="rounded-lg bg-[#C9A15B] py-2 text-sm font-bold text-[#1A1408]">
          진상 보기
        </button>
      ) : (
        <button onClick={() => setSheet("submit")} className="rounded-lg bg-[#C9A15B] py-2 text-sm font-bold text-[#1A1408]">
          정답 제출
        </button>
      )}
      {done ? (
        <button onClick={leave} className="rounded-lg border border-white/10 bg-white/5 py-2 text-sm hover:bg-white/10">
          다른 사건
        </button>
      ) : (
        <button onClick={giveUp} className="rounded-lg border border-white/10 bg-white/5 py-2 text-sm text-white/60 hover:bg-white/10">
          포기
        </button>
      )}
    </div>
  );

  return (
    <div
      ref={boxRef}
      style={{ height: boxH ?? undefined }}
      className={`${font} mx-auto flex h-[calc(100dvh-10rem)] max-w-[1040px] flex-col gap-2 text-white lg:grid lg:grid-cols-[360px_1fr] lg:gap-4`}>
      <style>{"html.mp-playing .quick-menu-fab{display:none}"}</style>
      {/* 왼쪽(PC) / 위(모바일): 사건 */}
      <div className="flex shrink-0 flex-col gap-2 lg:gap-3">
        <div className="flex items-center justify-between">
          <button onClick={leave} className="text-xs text-white/40 hover:text-white/70">
            ← 사건 목록
          </button>
          <span className={`${mono} text-[10px] text-white/30`}>PROTOTYPE</span>
        </div>
        {caseCard}
        <div className="hidden lg:block">{actions}</div>
      </div>

      {/* 오른쪽(PC) / 가운데(모바일): 질문 로그 + 입력 */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 rounded-xl border border-white/10 bg-[#0F1218] p-2 sm:p-3">
        <div ref={logRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
          {view.questions.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-white/40">
              <p>예/아니오로 답할 수 있는 질문을 던져 보세요.</p>
              <p className="text-xs">예) 누가 다쳤나요? · 범인이 있나요? · 상자 안에 뭔가 들어 있었나요?</p>
            </div>
          )}
          {view.questions.map((q, i) => {
            const b = BADGE[q.verdict];
            const key = q.verdict === "KEY_YES" || q.verdict === "KEY_NO";
            return (
              <div key={i} className={`rounded-lg px-3 py-2 ${key ? "bg-white/[0.06] ring-1 ring-white/10" : ""}`}>
                <div className="flex items-start gap-2">
                  <span className={`${mono} w-6 shrink-0 pt-0.5 text-right text-[10px] text-white/25`}>{i + 1}</span>
                  <p className={`min-w-0 flex-1 text-sm leading-relaxed ${q.verdict === "INVALID" ? "text-white/40 line-through" : "text-white/90"}`}>
                    {q.text}
                  </p>
                  <button
                    onClick={() => flag(i)}
                    disabled={flagged.has(i)}
                    title="판정이 이상해요"
                    className={`shrink-0 text-xs ${flagged.has(i) ? "opacity-100" : "opacity-30 hover:opacity-80"}`}
                  >
                    {flagged.has(i) ? "🚩✓" : "🚩"}
                  </button>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 pl-8">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs ring-1 ${b.cls}`}>
                    {key && "★ "}
                    {b.label}
                  </span>
                  {b.note && <span className="text-[11px] text-white/40">{b.note}</span>}
                </div>
              </div>
            );
          })}
          {asking && <p className="pl-8 text-xs text-white/40">판정 중…</p>}
        </div>

        {error && <p className="px-1 text-xs text-rose-300">{error}</p>}

        {done ? (
          <p className="rounded-lg bg-white/5 px-3 py-2.5 text-center text-sm text-white/60">
            {view.status === "solved" ? "사건 해결! 진상을 확인해 보세요." : "포기한 사건이에요."}
          </p>
        ) : outOfQuestions ? (
          <p className="rounded-lg bg-white/5 px-3 py-2.5 text-center text-sm text-white/60">질문을 다 썼어요. 정답을 제출하거나 포기하세요.</p>
        ) : (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              ask();
            }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={120}
              disabled={asking}
              placeholder="예/아니오로 답할 수 있는 질문"
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#14171F] px-3 py-2.5 text-[16px] text-white placeholder:text-white/30 focus:border-[#C9A15B]/60 focus:outline-none"
            />
            <button
              disabled={asking || !draft.trim()}
              className="shrink-0 rounded-lg bg-white/10 px-4 text-sm font-bold hover:bg-white/15 disabled:opacity-40"
            >
              질문
            </button>
          </form>
        )}
        <div className="lg:hidden">{actions}</div>
      </div>

      {/* 단서 */}
      <Sheet open={sheet === "clues"} onClose={() => setSheet(null)} title={newClue ? "NEW EVIDENCE · 새 단서가 공개됐어요" : "EVIDENCE · 단서"}>
        {view.clues.length === 0 ? (
          <p className="text-sm text-white/50">아직 공개된 단서가 없어요.{view.nextClueAt !== null && ` 질문 ${view.nextClueAt}개째에 첫 단서가 열려요.`}</p>
        ) : (
          <ol className="space-y-3">
            {view.clues.map((cl, i) => (
              <li key={cl.id} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <div className={`${mono} text-[10px] text-[#C9A15B]`}>단서 {i + 1}</div>
                <p className="mt-1 text-sm leading-relaxed text-white/85">{cl.body}</p>
              </li>
            ))}
          </ol>
        )}
        {view.nextClueAt !== null && view.clues.length > 0 && <p className="mt-3 text-xs text-white/40">다음 단서는 질문 {view.nextClueAt}개째에 열려요.</p>}
      </Sheet>

      {/* 정답 제출 */}
      <Sheet open={sheet === "submit"} onClose={() => setSheet(null)} title={`SUBMIT · 남은 제출 ${submitsLeft}회`}>
        <p className="text-sm text-white/60">알아낸 전말을 자유롭게 적어 주세요. 핵심 {c.rubricCount}가지를 모두 맞히면 해결이에요.{c.bonusCount > 0 ? ` 세부 사항 ${c.bonusCount}가지는 보너스예요.` : ""}</p>
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          maxLength={1500}
          rows={6}
          placeholder="누가, 무엇을, 왜, 어떻게…"
          className="mt-3 w-full resize-none rounded-lg border border-white/10 bg-[#0F1218] p-3 text-[16px] leading-relaxed text-white placeholder:text-white/30 focus:border-[#C9A15B]/60 focus:outline-none"
        />
        <div className="mt-1 text-right text-[11px] text-white/30">{answer.length}/1500</div>
        {error && <p className="mt-1 text-xs text-rose-300">{error}</p>}
        <button
          onClick={submit}
          disabled={submitting || submitsLeft <= 0 || answer.trim().length < 10}
          className="mt-2 w-full rounded-lg bg-[#C9A15B] py-2.5 text-sm font-bold text-[#1A1408] disabled:opacity-40"
        >
          {submitting ? "채점 중…" : submitsLeft <= 0 ? "제출 기회를 다 썼어요" : "제출하기"}
        </button>

        {last && (
          <div className="mt-5 rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-baseline justify-between">
              <span className={`${mono} text-[10px] text-white/40`}>최근 채점 · {view.submissions.length}번째 제출</span>
              <span className="text-sm">
                인정 <b className={last.passed === last.total ? "text-emerald-300" : "text-[#E9C98B]"}>{last.passed}</b>/{last.total}
                {last.bonusTotal > 0 && (
                  <span className="ml-2 text-xs text-white/45">
                    보너스 {last.bonus.length}/{last.bonusTotal}
                  </span>
                )}
              </span>
            </div>
            {last.bonus.length > 0 && (
              <p className="mt-2 text-xs text-white/50">세부 사항 인정: {last.bonus.join(" · ")}</p>
            )}
            {last.failed.length > 0 && (
              <ul className="mt-2 space-y-1">
                {last.failed.map((f, i) => (
                  <li key={i} className="text-sm text-white/75">
                    · <b>{f.label}</b> <span className="text-white/45">— {STATUS_LABEL[f.status]}</span>
                  </li>
                ))}
              </ul>
            )}
            {last.same && <p className="mt-2 text-xs text-amber-200/80">지난번과 인정 범위가 같아요. 같은 가설을 다듬는 중일 수 있어요.</p>}
          </div>
        )}
        {view.submissions.length > 1 && (
          <p className="mt-2 text-[11px] text-white/35">
            지난 제출: {view.submissions.slice(0, -1).map((s) => `${s.passed}/${s.total}${s.bonusTotal > 0 ? `(+${s.bonus.length})` : ""}`).join(" → ")}
          </p>
        )}
      </Sheet>

      {/* 진상 */}
      <Sheet open={sheet === "truth" && done} onClose={() => setSheet(null)} title={view.status === "solved" ? "CASE CLOSED · 사건 해결" : "TRUTH · 진상"}>
        <div className={`${mono} flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/50`}>
          <span>질문 {view.stats.questions}</span>
          <span>제출 {view.stats.submissions}</span>
          <span>{fmtTime(view.stats.ms)}</span>
          <span>단서 {view.clues.length}</span>
        </div>
        <p className="mt-3 text-sm leading-relaxed whitespace-pre-line text-white/85">{view.truth}</p>
        {c.credit && <p className={`${mono} mt-3 text-[11px] text-white/35`}>{c.credit}</p>}
        <button onClick={leave} className="mt-5 w-full rounded-lg border border-white/10 bg-white/5 py-2.5 text-sm hover:bg-white/10">
          다른 사건 하기
        </button>
      </Sheet>
    </div>
  );
}
