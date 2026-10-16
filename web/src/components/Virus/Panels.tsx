"use client";

import { useRef, useState, type ReactNode } from "react";
import type { GuideDoc } from "@/components/GuideView";
import {
  ACH,
  BAL,
  EVOLUTION,
  MAX_STAGE,
  ROSTER,
  APEX,
  apexCount,
  exportSave,
  fmt,
  fmtBytes,
  fmtTime,
  importSave,
  PRIMITIVES,
  MOD_ORDER,
  type Save,
} from "@/lib/virus/logic";
import { VirusSprite } from "./VirusSprite";
import { PagedList } from "./FitPages";

export interface VirusSettings {
  /** 피해 숫자 띄우기 */
  numbers: boolean;
  /** 글리치·번쩍임 같은 화면 효과 */
  effects: boolean;
  /** 배경음악 크기 0~1 */
  bgm: number;
  /** 효과음 크기 0~1 (타격 · 익스플로잇 · 보스) */
  sfx: number;
  /** 배경음악 끔 (오른쪽 위 버튼 · M 키) · 효과음 끔 (그 옆 버튼 · N 키) */
  bgmMute: boolean;
  sfxMute: boolean;
  /** 글자 크게 (모든 글자 1.15배) */
  big: boolean;
  /** 착용한 스킨 (lib/virus/skins.ts id — 가진 것만 보임, 빈 값 = 기본) */
  skin: string;
}

export const DEFAULT_SETTINGS: VirusSettings = {
  numbers: true,
  effects: true,
  bgm: 0.7,
  sfx: 0.8,
  bgmMute: false,
  sfxMute: false,
  big: false,
  skin: "",
};
export const SETTINGS_KEY = "virus-idle-settings";

const KR = "font-['Nanum_Gothic',sans-serif]";

/** 게임 화면 안에 뜨는 창 (터미널 창 모양) */
export function Window({
  title,
  onClose,
  children,
  wide = false,
  fill = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  /** 높이를 정해 둔 창 — 안의 목록이 칸에 맞춰 페이지를 나눔 */
  fill?: boolean;
}) {
  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-3 backdrop-blur-[2px]"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`virus-pop flex max-h-full w-full flex-col overflow-hidden rounded-2xl border border-emerald-400/30 bg-[#08100b] shadow-[0_0_40px_rgba(74,222,128,0.15)] ${
          wide ? "max-w-2xl" : "max-w-sm"
        } ${fill ? "h-[min(100%,560px)]" : ""}`}
      >
        <div className="flex items-center gap-2 border-b border-emerald-400/20 bg-emerald-400/10 px-4 py-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[#f87171]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#fbbf24]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#4ade80]" />
          <span className="ml-2 font-mono vt-sm text-emerald-200/80">{title}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="ml-auto font-mono vt-base text-white/75 hover:text-white"
          >
            ✕
          </button>
        </div>
        <div
          data-fit="window"
          className={`flex min-h-0 flex-1 flex-col overflow-hidden p-3 sm:p-4 ${KR}`}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/** 메뉴 버튼 한 줄 */
export function MenuButton({
  label,
  sub,
  onClick,
  danger = false,
}: {
  label: string;
  sub?: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-colors ${
        danger
          ? "border-rose-400/30 text-rose-200 hover:bg-rose-400/10"
          : "border-white/10 text-white hover:border-emerald-300/60 hover:bg-emerald-400/10"
      }`}
    >
      <span className="vt-base font-bold">{label}</span>
      {sub && <span className="vt-sm text-white/70">{sub}</span>}
    </button>
  );
}

function Toggle({
  label,
  desc,
  on,
  onChange,
}: {
  label: string;
  desc: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-white/10 px-3 py-2.5">
      <span>
        <span className="block vt-base font-bold text-white">{label}</span>
        <span className="block vt-sm text-white/70">{desc}</span>
      </span>
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-emerald-400"
      />
    </label>
  );
}

function Slider({
  label,
  value,
  shown,
  desc,
  onChange,
}: {
  label: string;
  value: number;
  shown: string;
  desc: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block rounded-lg border border-white/15 px-3 py-2">
      <span className="mb-1 flex items-center justify-between">
        <span className="vt-base font-bold text-white">{label}</span>
        <span className="vt-sm font-mono text-white/90">{shown}</span>
      </span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-emerald-400"
      />
      <span className="vt-sm mt-0.5 block text-white/75">{desc}</span>
    </label>
  );
}

export function SettingsPanel({
  settings,
  onChange,
  onWipe,
}: {
  settings: VirusSettings;
  onChange: (s: VirusSettings) => void;
  onWipe: () => void;
}) {
  return (
    <PagedList
      className="vw-list flex flex-col gap-2"
      items={[
        <Slider
          key="bgm"
          label="배경음악"
          value={settings.bgm}
          shown={settings.bgmMute ? "꺼짐" : `${Math.round(settings.bgm * 100)}`}
          desc="테마곡 「Controlled Wider Passage」 · 🔊 버튼이나 M 키로 끄고 켜요"
          onChange={(v) => onChange({ ...settings, bgm: v, bgmMute: false })}
        />,
        <Slider
          key="sfx"
          label="효과음"
          value={settings.sfx}
          shown={
            settings.sfxMute || settings.sfx === 0 ? "꺼짐" : `${Math.round(settings.sfx * 100)}`
          }
          desc="타격 · 익스플로잇 · 보스 등장 · 격퇴 · 실패 · 🔔 버튼이나 N 키로 끄고 켜요"
          onChange={(v) => onChange({ ...settings, sfx: v, sfxMute: false })}
        />,
        <Toggle
          key="big"
          label="글자 크게"
          desc="게임 안 모든 글자를 1.15배로"
          on={settings.big}
          onChange={(v) => onChange({ ...settings, big: v })}
        />,
        <Toggle
          key="numbers"
          label="피해 숫자 표시"
          desc="코드가 닿을 때 피해량을 띄워요"
          on={settings.numbers}
          onChange={(v) => onChange({ ...settings, numbers: v })}
        />,
        <Toggle
          key="effects"
          label="화면 효과"
          desc="글리치·번쩍임·코드 비 같은 움직임"
          on={settings.effects}
          onChange={(v) => onChange({ ...settings, effects: v })}
        />,
        <div key="wipe" className="flex flex-col gap-1">
          <MenuButton label="저장 데이터 지우기" sub="되돌릴 수 없어요" danger onClick={onWipe} />
          <span className="vt-sm text-white/75">
            진행은 이 브라우저에 자동 저장돼요 (5초마다 · 창을 닫거나 다른 탭으로 갈 때)
          </span>
        </div>,
      ]}
    />
  );
}

/**
 * 바이러스 도감 — 원시 바이러스 2종 + 바이러스 10종. 만난 바이러스(최고 스테이지가 합류 스테이지를 넘음)만 내용이 열리고,
 * 코드 모듈은 컴파일한 버전을 보여 줌
 */
export function ArchivePanel({ s }: { s: Save }) {
  const list = [
    ...PRIMITIVES.map((p) => ({ ...p, prim: true as const, i: -1, join: 1 })),
    ...MOD_ORDER.map((i) => ({ ...ROSTER[i], prim: false as const, i })),
  ];
  const seen = (k: number) => list[k].prim || list[k].join < s.best;
  const [sel, setSel] = useState(0);
  const v = list[sel];
  const met = seen(sel);
  const lv = v.prim ? 0 : s.mods[v.i];
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap justify-center gap-1.5">
        {list.map((r, k) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setSel(k)}
            aria-label={seen(k) ? r.name : `스테이지 ${r.join}에 합류하는 바이러스`}
            aria-pressed={sel === k}
            className={`rounded-lg border p-1 transition-colors ${
              sel === k
                ? "border-emerald-300/80 bg-emerald-400/15"
                : r.prim
                  ? "border-dashed border-white/25 hover:border-white/50"
                  : "border-white/15 hover:border-white/40"
            }`}
          >
            <span className={`block ${seen(k) ? "" : "opacity-30 grayscale"}`}>
              <VirusSprite seed={r.id} color={r.color} size={30} />
            </span>
          </button>
        ))}
      </div>
      <div
        className="flex min-h-0 flex-1 gap-3 overflow-hidden rounded-xl border p-3"
        style={{
          borderColor: met ? `${v.color}66` : "rgba(255,255,255,0.15)",
          background: met ? `${v.color}10` : "transparent",
        }}
      >
        <div className={`shrink-0 ${met ? "" : "opacity-30 grayscale"}`}>
          <VirusSprite seed={v.id} color={v.color} size={56} />
        </div>
        <div className="min-w-0">
          <div className="vt-base font-bold" style={{ color: met ? v.color : "#ffffffcc" }}>
            {met ? v.name : "??????"}
            <span className="vt-sm ml-2 font-mono font-normal text-white/75">
              {met ? v.year : "????"} · {v.prim ? "원시 바이러스" : `스테이지 ${v.join} 합류`}
            </span>
          </div>
          {met ? (
            <>
              <p className="vt-sm mt-1 leading-relaxed text-white/90">{v.desc}</p>
              <p className="vt-sm mt-1.5 text-white/90">
                {v.prim
                  ? "빼앗을 코드가 없는 장난 프로그램 — 잡아도 코드 조각은 없고 데이터만 줘요"
                  : lv
                    ? `${v.icon} ${v.module} v${lv} · ${v.cur(lv)} — ${v.effect}`
                    : `${v.icon} ${v.module} — ${v.effect} (조각을 모아 컴파일하면 열려요)`}
              </p>
            </>
          ) : (
            <p className="vt-sm mt-1 text-white/90">
              스테이지 {v.join}에 이 네트워크로 합류하는 바이러스예요. 만나면 기록이 열려요.
            </p>
          )}
        </div>
      </div>
      <p className="vt-xs text-center text-white/75">
        만난 바이러스 {list.filter((_, k) => seen(k)).length}/{list.length} · 컴파일한 모듈{" "}
        {s.mods.filter((m) => m > 0).length}/{ROSTER.length} · 게임 속 수치는 지어낸 것이고, 설명은
        실제 사건을 짧게 요약했어요
      </p>
    </div>
  );
}

/** 기록 창 — 업적 (달성 · 진행 막대, 새 업적은 맨 앞에 NEW) / 통계 (누적 기록) */
export function RecordsPanel({ s, fresh = [] }: { s: Save; fresh?: string[] }) {
  const [view, setView] = useState<"ach" | "stats">("ach");
  const got = new Set(s.ach);
  const isNew = new Set(fresh);
  const list = [...ACH.filter((d) => isNew.has(d.id)), ...ACH.filter((d) => !isNew.has(d.id))];
  const tabBtn = (k: "ach" | "stats", label: string) => (
    <button
      type="button"
      onClick={() => setView(k)}
      aria-pressed={view === k}
      className={`vt-sm rounded-lg border px-2.5 py-1 font-bold transition-colors ${
        view === k
          ? "border-emerald-300/80 bg-emerald-400/15 text-emerald-100"
          : "border-white/15 text-white/75 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
  const rows: [string, string][] = [
    ["⌛ 게임 화면에서 보낸 시간", fmtTime(s.rec.play)],
    ["💾 훔친 데이터 (누적)", fmtBytes(s.lifetime)],
    ["📂 감염시킨 파일", fmt(s.rec.files)],
    ["🧬 컴파일한 모듈", `${s.mods.filter((m) => m > 0).length}/${ROSTER.length}`],
    ["☠️ 격퇴한 보스", fmt(s.rec.bosses)],
    ["🛡️ 처치한 상위 보스", fmt(s.rec.apexes)],
    ["☢️ KILLSWITCH 격퇴", fmt(s.clears)],
    ["🏎️ KILLSWITCH 최단 기록", s.rec.bestFinal ? `${s.rec.bestFinal.toFixed(1)}초` : "-"],
    ["🚫 보스에게 차단당함", fmt(s.rec.fails)],
    ["😰 1초 이하 남기고 격퇴", fmt(s.rec.clutch)],
    ["💥 가장 큰 한 방", fmtBytes(s.rec.maxHit)],
    ["🔧 산 업그레이드 레벨", fmt(s.rec.ups)],
    ["🎲 랜덤 강화 (잭팟)", `${fmt(s.rec.rands)} (${fmt(s.rec.jackpots)})`],
    ["🧬 최고 진화 단계", EVOLUTION[s.rec.evo]?.name ?? "-"],
    ["🗺️ 최고 스테이지", String(Math.min(s.best, MAX_STAGE))],
    ["☣️ 변이", fmt(s.formats)],
    ["🔑 루트 권한", fmt(s.root)],
    ["🛡️ 우회 기술", `${apexCount(s.apexBest)}/${APEX.length}`],
    ["😴 가장 오래 비운 시간", fmtTime(s.rec.offMax)],
    ["🖥️ 비운 동안 훔친 데이터", fmtBytes(s.rec.offData)],
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        {tabBtn("ach", `🏅 업적 ${s.ach.length}/${ACH.length}`)}
        {tabBtn("stats", "📊 통계")}
        <span className="vt-sm ml-auto text-right text-amber-200">
          업적 보너스 피해 +{Math.round(BAL.achDmg * 100 * s.ach.length)}%
          <span className="vt-xs block text-sky-200/90">
            💎 GP는 위 [업적] 버튼에서 받아요 (로그인)
          </span>
        </span>
      </div>
      {view === "ach" ? (
        <PagedList
          key="ach"
          className="grid grid-cols-1 gap-1.5 sm:grid-cols-2"
          items={list.map((d) => {
            const done = got.has(d.id);
            const [cur, goal] = d.prog(s);
            const show = (n: number) => (d.bytes ? fmtBytes(n) : fmt(n));
            return (
              <div
                key={d.id}
                className={`flex items-center gap-2.5 rounded-lg border px-2.5 py-1.5 ${
                  done ? "border-amber-300/50 bg-amber-300/[0.08]" : "border-white/10"
                }`}
              >
                <span className={`text-xl ${done ? "" : "opacity-40 grayscale"}`} aria-hidden>
                  {d.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`vt-sm block truncate font-bold ${done ? "text-amber-100" : "text-white/90"}`}
                  >
                    {isNew.has(d.id) && (
                      <span className="vt-xs mr-1 rounded bg-rose-700 px-1 font-mono text-white">
                        NEW
                      </span>
                    )}
                    {d.name}
                    {done && <span className="ml-1 text-emerald-300">✓</span>}
                    <span className="vt-xs ml-1.5 font-mono font-normal text-sky-200/90">
                      💎{d.reward.toLocaleString("ko-KR")}
                    </span>
                  </span>
                  <span className="vt-xs block truncate text-white/75">{d.desc}</span>
                  {!done && goal > 1 && (
                    <span className="mt-0.5 flex items-center gap-1.5">
                      <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
                        <span
                          className="block h-full rounded-full bg-emerald-400/80"
                          style={{ width: `${Math.min(100, (Math.max(0, cur) / goal) * 100)}%` }}
                        />
                      </span>
                      <span className="vt-xs font-mono text-white/75 tabular-nums">
                        {show(Math.max(0, Math.min(cur, goal)))}/{show(goal)}
                      </span>
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        />
      ) : (
        <PagedList
          key="stats"
          className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2"
          items={rows.map(([k, v]) => (
            <div
              key={k}
              className="vt-sm flex items-center justify-between gap-3 border-b border-white/10 py-1"
            >
              <span className="truncate text-white/80">{k}</span>
              <span className="shrink-0 font-mono font-bold text-white tabular-nums">{v}</span>
            </div>
          ))}
        />
      )}
    </div>
  );
}

/** 세이브 백업 — 지금 진행을 글자로 복사 · 파일로 저장, 붙여 넣거나 파일을 골라 불러오기 */
export function BackupPanel({
  s,
  onImport,
}: {
  s: Save;
  /** 알아본 저장본 — 확인은 부모가 받음 */
  onImport: (next: Save) => void;
}) {
  // 창을 연 때의 진행 (게임은 계속 돌아가서 매 틱 바뀌면 고른 글자가 풀림)
  const [code] = useState(() => exportSave(s));
  const [paste, setPaste] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const copy = () => {
    if (!navigator.clipboard) {
      setMsg({ ok: false, text: "복사가 막혔어요. 위 글자를 직접 골라 복사하세요." });
      return;
    }
    navigator.clipboard
      .writeText(code)
      .then(() => setMsg({ ok: true, text: "복사했어요. 메모장 등에 붙여 넣어 보관하세요." }))
      .catch(() => setMsg({ ok: false, text: "복사가 막혔어요. 위 글자를 직접 골라 복사하세요." }));
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([code], { type: "text/plain" }));
    const a = document.createElement("a");
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    a.href = url;
    a.download = `virus-idle-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const tryImport = (text: string) => {
    const next = importSave(text);
    if (!next) {
      setMsg({
        ok: false,
        text: "알아볼 수 없는 백업이에요. VIRUS1. 로 시작하는 글자가 전부 있어야 해요.",
      });
      return;
    }
    setMsg(null);
    onImport(next);
  };
  const btn =
    "vt-sm shrink-0 rounded-lg border px-3 py-1.5 font-bold transition-colors disabled:opacity-40";
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5">
      <div className="flex flex-col gap-1.5">
        <span className="vt-base font-bold text-white">📤 내보내기</span>
        <textarea
          readOnly
          value={code}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="백업 글자"
          className="vt-xs h-14 w-full resize-none overflow-hidden rounded-lg border border-white/15 bg-black/40 p-2 font-mono break-all text-white/80"
        />
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={copy}
            className={`${btn} border-emerald-300/50 bg-emerald-400/15 text-emerald-100 hover:bg-emerald-400/25`}
          >
            📋 복사
          </button>
          <button
            type="button"
            onClick={download}
            className={`${btn} border-white/20 text-white/90 hover:border-white/50`}
          >
            💾 파일로 저장
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="vt-base font-bold text-white">📥 불러오기</span>
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder="VIRUS1. 로 시작하는 백업 글자를 붙여 넣으세요"
          aria-label="불러올 백업 글자"
          className="vt-xs h-14 w-full resize-none overflow-hidden rounded-lg border border-white/15 bg-black/40 p-2 font-mono break-all text-white/90 placeholder:text-white/60"
        />
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => tryImport(paste)}
            disabled={!paste.trim()}
            className={`${btn} border-amber-300/50 bg-amber-300/15 text-amber-100 enabled:hover:bg-amber-300/25`}
          >
            불러오기
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className={`${btn} border-white/20 text-white/90 hover:border-white/50`}
          >
            📁 파일 고르기
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.json,text/plain,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) f.text().then(tryImport);
            }}
          />
        </div>
      </div>
      {msg && (
        <p className={`vt-sm ${msg.ok ? "text-emerald-200" : "text-rose-200"}`} role="status">
          {msg.text}
        </p>
      )}
      <p className="vt-xs text-white/75">
        불러오면 지금 진행이 백업 내용으로 바뀌어요. 비운 시간 수익은 불러온 때부터 다시 세요.
      </p>
    </div>
  );
}

/** 패치노트 — 새 버전을 맨 위에 */
export const PATCH_NOTES: { ver: string; date: string; items: string[] }[] = [
  {
    ver: "v1.4",
    date: "2026.10.17",
    items: [
      "💎 사이트 GP 연결 (로그인): 위 막대 💎 버튼의 GP 상점 창 — 디펜스와 같은 모델로 패키지(일일 보급 · 신입 해커 · 주간 보급 · 커널 꾸러미 · 스테이지 500 · 1000 돌파 꾸러미, 재화샵 값의 3~6배) · 재화샵(커널 코어 1,000 · 시간 가속 1시간 500) · 커널 코어 → GP(주 2번). 산 것은 바로 받아요",
      "⏩ 시간 가속: 받으면 진행 막대로 그 시간만큼 바로 진행 (100% 효율, 한 번에 최대 48시간)",
      "🛠️ 편의성: 루트 권한으로는 진행 조건을 넘으면 (프로파일러 스테이지 50 · 크론잡 100 · 크론 데몬 200 · 자동 컴파일러 300 · 우회 키 최적 배분 400 · 커널 프로파일러 500), 사이트 GP로는 조건 없이 바로 (500 · 1,000 · 3,000 · 2,000 · 1,500 · 1,500) — GP로 산 것은 계정에 남아 새 게임 · 다른 기기에서도 열려 있음",
      "🎨 꾸미기 스킨 (능력 변화 없음): 🧊 프로스트 · 🔥 인페르노 3,000 · 👑 골드 루트킷 5,000 · 🌈 글리치 RGB 8,000 · 🕳️ 보이드(「보이드 꾸러미」 전용) — 내 바이러스 · 날아가는 코드의 색과 글자가 바뀜, GP 상점 「꾸미기」에서 착용",
      "🏅 업적 하나로: 게임 안 업적 37개를 사이트 업적으로 옮김 — 달성하면 지금처럼 피해 +2%, 위 [업적]에서 GP도 (합계 36,200) · 일일 미션 3개 (파일 3,000개 · 보스 30마리 · 변이 1번) — 로그인하면 기록을 1분마다 서버에 보고",
      "🔔 효과음만 끄는 버튼 (배경음악 버튼 옆 · N 키)",
      "🔌 부트 선점 아이콘을 전원으로 (부팅)",
      "☢️ KILLSWITCH 스테이지 분리: 스테이지 1000의 상위 보스를 잡으면 따로 된 KILLSWITCH 스테이지로 — 파일 없이 최종 보스만, 지면 그 스테이지 파일부터",
      "♾️ 무한 모드 (다음 패치까지): 버전마다 체력 ×2 (버전이 오를수록 증가율도 ×1.05씩) · 잡을 때마다 「각인」 모든 피해 ×1.5 (영구) · 지면 「패치 분석」 다음 도전 피해 ×1.1씩 (잡으면 처음으로) · 버전 하나 = 루트 권한 스테이지 20개 · 10버전마다 커널 코어 +5 · 사이트 업적 「인터넷의 종말 · 계속」(10버전마다 1,500 GP) · 이정표 스킨 ☢️ 킬스위치(v10) · 🕷️ 제로데이(v20) · ⬛ 엔드 오브 라인(v30)",
      "🧹 UI 개편: 업그레이드 카드 2줄 · ▲ / 🎲 버튼 같은 크기, 코드 모듈 · 우회 기술은 2칸(넓으면 5칸) 작은 카드, 페이지 넘김 줄임, 모듈 오버클럭 · 커널 패치 설명 보강",
    ],
  },
  {
    ver: "v1.3",
    date: "2026.10.15",
    items: [
      "🧬 진화 개편: 넘은 최고 스테이지로 100스테이지마다 한 단계 (11단계 · 변이해도 유지), 단계마다 추가 효과가 쌓임 — 웜(데이터 ×1.25) · 트로이(보스 시간 +5초) · 군체(발사 속도 ×1.15) · 봇넷(오프라인 효율 +10%p) · 변이체(루트 권한 ×1.25) · 폴리모프(랜덤 강화 -20%) · 하이브(조각 · 키 ×1.5) · 오버마인드(익스플로잇 확률 +10%p) · 싱귤래리티(보스 피해 ×1.5) · 아포칼립스(모든 피해 ×2). 진화 이름에 마우스를 올리면 효과 목록",
      "🔁 자동 업그레이드 로그: 크론 데몬이 올린 업그레이드를 전투 화면 왼쪽 아래(보스 시간 줄 위)에 잠깐 (최대 2줄)",
      "적 보안 등급 최소 1 B",
      "밸런스: 진화 효과만큼 후반 보안 등급 증가를 조금 올림 — 최적으로 1000까지 약 8시간 유지",
    ],
  },
  {
    ver: "v1.2",
    date: "2026.10.15",
    items: [
      "🔢 숫자 규모 개편: 후반에 피해 · 보안 등급 · 데이터가 10^60을 넘어 단위가 지나치게 커지던 것 — 진행 배율(보안 등급 증가 · 피해 · 데이터 · 업그레이드 가격 증가 · 우회 기술 · 루트 권한 보너스 …)을 줄여 스테이지 1000에서 초당 피해가 약 YB (100 ≈ KB · 300 ≈ GB · 500 ≈ TB · 800 ≈ ZB). 업그레이드 레벨 · 모듈 · 우회 기술 버전 수와 진행 속도(최적으로 1000까지 약 8시간)는 그대로",
      "예전 저장본: 데이터 · 조각 · 우회 키를 새 규모로 줄여서 옮김 (레벨 · 버전 · 루트 권한은 그대로)",
    ],
  },
  {
    ver: "v1.1",
    date: "2026.10.15",
    items: [
      "🖥️ 자리를 비운 동안: 탭을 가렸거나 · 절전 · 창을 닫았다 돌아오면 비운 시간을 진행 막대로 한꺼번에 실행하고, 얻은 것(스테이지 · 데이터 · 보스 · 조각 · 키 · 자동 변이)을 보여 주고 수령",
      "🔑 우회 키 공용화: 어느 상위 보스를 잡아도 같은 우회 키가 모이고, 원하는 우회 기술에 ▲로 컴파일 (컴파일 막대는 다음 버전이 가장 싼 것부터 고르게) — 예전 상위 보스별 키는 합쳐서 옮김",
      "💎 GP: 사이트 가상 재화 (지금은 임시로 모두 1,000,000) — 루트 상점 편의성은 루트 권한 또는 GP로 살 수 있고(루트 권한 1 = 10GP), 살 때 재화를 고름",
      "🛒 루트 상점: 「🗝️ 우회 키 최적 배분」(효율 순으로 배분) 추가 · 편의성 가격 인하(프로파일러 20 · 크론잡 40 · 크론 데몬 100 · 커널 프로파일러 150)",
      "🧩 커널 권한: 빠른 재감염 I · II · 보스 지정 삭제(산 코어는 돌려줌) · 「📈 루트 권한 자동 투자」 추가(효율 강화를 효율 순으로 자동 구매 — 편의성을 모두 가져야 열림) — 자동 재도전 → 장기 잠복 → 자동 변이 → 모듈 오버클럭 → 커널 패치",
      "⏱ 크론 데몬: 효율 1등을 곧 살 수 있으면 데이터를 모아 두고, 아니면 추천 1등(랜덤 강화 포함)을 삼 — 한동안 안 사서 꺼진 것처럼 보이거나 추천을 살 돈이 있는데 안 사던 것",
      "📦 코드 모듈: 🎯 약점 분석은 공격한 시간만큼 쌓임(초당) · 🚪 백도어 이월 → 백도어 침투(다음 적 체력이 깎인 채로, 보스는 절반) · 💣 DDoS 상한을 낮춰 피해 쏠림 완화",
      "🛡️ 우회 기술: 샌드박스 탈출 · 관제 우회는 상한이 있는 배율로 (후반에 보스가 파일보다 빨리 잡히던 것) · 익스플로잇 확률이 상한에 다가가 못 오른 만큼은 익스플로잇 피해로",
      "밸런스: 파일 보안 등급 ×0.5(보스가 스테이지의 벽) · 100스테이지 뒤 보안 등급 증가가 점점 완만해져 100스테이지마다 비슷한 시간 — 최적으로 하면 1000까지 약 8시간",
      "보스 등장 · 격퇴 연출은 상위 · 최종 보스와 처음 잡는 바이러스만 (나머지는 멈추지 않고 효과음만)",
      "화면: 피해 · 체력 · 조각 · 키를 바이트 단위로 · 5자리 코드 투사체, 부트 선점 첫 발은 크게 · 🎯 스테이지 이동 칸 · 컴파일할 수 있으면 모듈 · 우회 탭에 점 · 모듈 효과창 5칸 × 2줄",
    ],
  },
  {
    ver: "v1.0",
    date: "2026.10.14",
    items: [
      "🌐 스테이지 100 → 1000: 101부터 다크넷 · 국방망 · 위성 통신망 · 전력망 · 국제 결제망 · 해저 케이블 · 양자 연구소 · 궤도 정거장 · 글로벌 코어 (10스테이지마다 구역). 최종 보스 KILLSWITCH는 스테이지 1000에서 — 잡을 때마다 다음 버전은 체력 ×1.5",
      "🦠 보스 개편: 스테이지 1~10은 원시 바이러스 Creeper · Elk Cloner (데이터만), 유명 바이러스는 11 Morris Worm · 25 CIH · 40 Mydoom · 60 Brain · 100 Melissa · 200 Stuxnet · 300 Conficker · 450 WannaCry · 600 Zeus · 800 ILOVEYOU에 NEW로 합류, 그 뒤 보스는 해금된 바이러스 중 무작위",
      "📦 코드 모듈 = 공격에 붙는 효과: 🥾 부트 선점(첫 발 강타) · 🪱 자가 복제(추가 발사) · 💌 러브레터 미끼(명중마다 데이터) · 🔥 BIOS 과열(점화) · 📜 매크로 연사(몇 발마다 +2발) · 🚪 백도어 이월(남은 피해를 다음 적에게) · 🎯 약점 분석(맞힐수록 피해 중첩) · 🔓 취약점 노출(익스플로잇 뒤 피해 증가) · 🔐 암호화 잠금(보스 시간 연장) · 💣 DDoS 폭격(몇 초마다 일제 사격)",
      "🧬 코드 조각 컴파일: 보스를 잡으면 그 바이러스의 조각 (보스 체력에 비례 · 처음 가는 스테이지 ×3), 모이면 화면 아래 컴파일 막대(F) · 코드 모듈 탭 ▲로 열고 버전업 — 합류한 바이러스를 처음 잡으면 바로 열리고 첫 버전부터 효과가 큼. 처음 열면 소개 창, 루트 상점 「자동 컴파일러」",
      "🛡️ 우회 기술 = 예전 코드 모듈의 능력치 (파일 보안 등급 · 피해 · 보스 보안 등급 · 데이터 · 익스플로잇 피해 · 보스 피해 · 오프라인 효율 · 익스플로잇 확률 · 발사 속도 · 업그레이드 비용). 상위 보스를 처음 잡으면 v1, 다시 잡으면 우회 키(체력에 비례)를 모아 컴파일 — 「우회 기술」 탭",
      "👀 효과가 잘 보이게: me.exe 아래 모듈 HUD (효과가 터진 모듈이 반짝) · 자가 복제 발 보라 · 매크로 연사 발 초록 · 🔥 점화 피해 · 💣 DDoS 일제 사격과 화면 번쩍 · 🥾 BOOT · 🔐 +초 · 🔓 노출 · 🎯 중첩 표시, 피해 숫자는 틱마다 가장 큰 한 방만",
      "🧩 커널 권한: 100스테이지마다 처음 넘으면 · KILLSWITCH를 잡으면 커널 코어 — 루트 상점 「커널」에서 위에서부터 차례로: 🔁 자동 재도전 → 🌙 장기 잠복(오프라인 48시간) → 🚀 빠른 재감염 I(변이 시작 최대 101) → ☣️ 자동 변이 → 📡 보스 지정 → 🚀 빠른 재감염 II(최대 151) → 🧬 모듈 오버클럭(상한 ×1.1) → 🩹 커널 패치(반복)",
      "🔁 스테이지 고르기(◀ ▶ — 이번 회차에 오른 곳까지) · 반복 (조각 · 키는 보스 체력에 비례해 낮은 스테이지에선 아주 조금)",
      "🎨 보스 · 상위 보스마다 고유한 그림: 유령(Creeper) · 엘크 뿔 플로피(Elk Cloner) · 뇌(Brain) · 똬리 튼 웜(Morris) · 불타는 BIOS 칩(CIH) · 매크로 문서(Melissa) · 하트 편지(ILOVEYOU) · 봇넷(Mydoom) · 번개 금화(Zeus) · 원심분리기(Stuxnet) · 촉수 열쇠 구멍(Conficker) · 우는 자물쇠(WannaCry) / 십자 방패 · 불타는 성벽 · 눈 가득한 구체 · 머리 셋 뱀 · 창살 우리 · 관제 건물 · 조준경 · 이빨 상자 · 바다뱀 · 피라미드 눈 · 방사능 차단 레버",
      "🏅 업적 37개 (하나마다 피해 +2%) · 기록 창(업적 · 통계) — 새 업적이 생기면 위 막대 🏅 버튼에 ❗",
      "💾 세이브 백업: 진행을 글자로 복사하거나 파일로 저장하고, 다른 브라우저 · 기기에서 불러오기",
      "밸런스: 101부터 루트 권한이 스테이지마다 더 빠르게 늘고, 변이 시작은 최대 51 (커널 권한으로 101 · 151), 마지막 구역은 보안 등급 증가가 완만 — 최적으로 하면 1000까지 약 43시간",
      "큰 숫자 단위 Qa · Qi · Sx · Sp · Oc · No · Dc · 업그레이드 탭이 폰에서 옆으로 넘치거나 PC에서 아래가 잘리던 것 고침",
      "v0.4 저장본: 스테이지 100에서 최종 보스를 기다리던 진행은 101부터 이어서, 만난 바이러스의 모듈 · 잡은 상위 보스의 우회 기술은 v1로, 커널 코어로 산 상품은 코어로 돌려줌",
    ],
  },
  {
    ver: "v0.4",
    date: "2026.10.12",
    items: [
      "최종 보스 KILLSWITCH를 잡을 때마다 🧩 커널 코어 +1 (변이해도 남음) — 다음 KILLSWITCH(v2, v3…)는 체력 ×1.5",
      "상위 보스에게서 얻는 특성을 「우회 기술」 탭으로 따로 모음 (코드 모듈 탭은 바이러스 모듈 10종만) · 모듈 크게 보기에서 다음 버전 효과를 줄을 바꿔 표시",
      "진화 알림이 너무 오래 떠 있던 것 — 3.2초 → 1.8초, 끝에 서서히 사라짐",
      "일반 화면을 전체화면과 같은 모습으로: 모니터와 같은 비율 · 같은 배치로 그리고, 틀이 클수록 글자 · 버튼까지 함께 커짐 (일반 화면 최대 폭 960px → 1280px, 창 높이 안에 맞춤)",
      "좁은 가로 화면에서 탭 줄이 잘리던 것 — 탭 간격을 줄이고, 그래도 모자라면 오른쪽 버튼만 다음 줄로",
      "루트 상점에 🧩 커널 분류 (첫 격퇴 뒤 열림, 코어로 삼 · 가격 = 레벨 + 1 코어): 커널 패치(피해 ×1.25) · 권한 상승(루트 권한 획득 +20% — 다시 변이할 수 있게 됨) · 데이터 압축(데이터 ×1.5) · 인터럽트 지연(보스 제한 시간 +5초, 최대 3)",
    ],
  },
  {
    ver: "v0.3",
    date: "2026.10.12",
    items: [
      "상위 보스: 10스테이지마다 보스를 잡으면 그 네트워크의 보안 시스템 10종(Sentinel 백신 · Bastion 방화벽 · Argus 침입 탐지 · Hydra 스팸 필터 · Warden 샌드박스 · SOC 관제 센터 · Tracker EDR · Mimic 허니팟 · Leviathan 패킷 검사 · Oracle AI)이 나와요. 체력 보스의 2배 · 45초 · 데이터 5배",
      "상위 보스를 처음 잡으면 영구 특성 (서명 위조 · 포트 스캔 · 로그 삭제 · 스팸 폭탄 · 샌드박스 탈출 · 관제 우회 · 프로세스 은닉 · 미끼 역이용 · 암호화 터널 · 자가 학습) — 변이해도 남고, 코드 모듈 탭에서 볼 수 있어요",
      "상위 보스를 잡을 때마다 내 바이러스 외형이 하나씩 바뀌어요 (회로 링 → 안테나 → 외피 → 촉수 → 결정 가시 → 왕관 → 잔상 → 날개 → 궤도 링 → 오라 · 세 번째 눈)",
      "코드 모듈 탭에 지금까지 쌓인 수치를 표시 (레벨이 올라도 수치가 그대로 보이던 것) · 모듈 · 특성을 누르면 크게 보기",
      "보스 · 상위 보스 격퇴 알림을 팝업 대신 우측 상단에 잠깐 뜨는 알림으로",
      "스테이지는 100까지: 스테이지 100의 상위 보스(Oracle)를 잡으면 최종 보스 ☢️ KILLSWITCH(글로벌 차단 스위치)가 나와요 — 체력 상위 보스의 3배 · 60초. 잡은 뒤에도 스테이지 100에서 계속 반복해서 잡을 수 있어요",
      "극초반을 더 빠르게: 첫 40스테이지쯤까지 파일 보안 등급이 낮고 데이터를 더 줌 — 잘 고르면 스테이지 30까지 약 5분",
      "밸런스: 루트 권한 공식을 완만하게 (최고 스테이지 기준 3제곱 → 2.17제곱) · 루트 권한 1당 피해 +10% → +3% · 스테이지마다 보안 등급 ×1.17 → ×1.18 — 잘 골라도 최종 보스까지 약 2시간",
      "코드 모듈 탭 · 내 바이러스 옆 개수를 모듈 10 + 특성 10 = 20개 기준으로",
      "「시스템 포맷」 이름을 「☣️ 변이」로 — 바이러스가 지금 몸을 버리고 새 변종으로 다시 퍼짐",
      "포맷 · 새 게임 · 데이터 지우기를 누르면 전체화면이 풀리던 것 — 브라우저 확인 창 대신 게임 안 확인 창",
      "루트 상점을 ⚔️ 효율 강화(루트킷 · 데이터 마이닝 · 폴리모픽 엔진)와 🛠️ 편의성(프로파일러 · 크론잡 · 크론 데몬 · 커널 프로파일러)으로 나눔",
      "골든 이미지 삭제 (쓴 루트 권한은 돌려줌) — 대신 변이하면 최고 스테이지의 절반을 10 단위로 내린 다음 스테이지부터 시작 (예: 68 → 31)",
    ],
  },
  {
    ver: "v0.2",
    date: "2026.10.12",
    items: [
      "루트 권한 상점: 포맷으로 받은 루트 권한으로 루트킷(피해) · 데이터 마이닝(데이터) · 폴리모픽 엔진(랜덤 강화 3레벨 확률) · 프로파일러(업그레이드 추천) · 크론잡(⚡ 최적 업그레이드) · 크론 데몬(자동 실행)을 사요. 써도 루트 권한 피해 보너스는 줄지 않아요",
      "프로파일러 (루트 상점): 사면 업그레이드 탭에서 데이터를 쓴 만큼 초당 피해가 가장 많이 오르는 업그레이드 · 랜덤 강화를 ★ 추천으로 표시하고, 각각 DPS가 몇 % 오르는지 보여 줌",
      "업그레이드 ×1 · ×10 · MAX 한꺼번에 사기",
      "크론잡 (프로파일러를 사면 열림): ⚡ 최적 업그레이드 버튼 · C 키 — 가진 데이터를 모두 써서 초당 피해가 가장 많이 오르는 조합으로 한 번에 업그레이드",
      "크론 데몬 (크론잡을 사면 열림): 켜 두면 1초마다 최적 업그레이드를 자동으로",
      "커널 프로파일러 (크론 데몬을 사면 열림): 루트 상점에서 루트킷 · 데이터 마이닝 · 폴리모픽 엔진 중 루트 권한 대비 DPS가 가장 많이 오르는 것을 ★ 추천, 각각 오르는 수치도 표시",
      "스크롤바 없는 화면: 칸에 다 안 들어가면 ◀ 1/2 ▶ 페이지로 · 글자를 더 크고 또렷하게, 설정에 「글자 크게」",
      "다른 탭에 켜 둔 동안 진행이 10배쯤 느려지던 것 — 실제로 흐른 시간만큼 계산 (가려진 동안은 보스 연출 없이 바로 진행)",
      "패치노트 창 추가",
      "200스테이지 근처에서 멈추던 후반 정체를 뒤로 밀었어요 (시뮬레이션: 72시간에 최고 202 → 309)",
    ],
  },
  {
    ver: "v0.1",
    date: "2026.10.12",
    items: [
      "첫 공개: 내 바이러스(me.exe)를 키워 파일을 감염시키고, 실제로 유명했던 바이러스 10종을 잡아먹어 코드 모듈로 진화",
      "업그레이드(페이로드 · 오버클럭 · 익스플로잇)와 랜덤 강화(불안정 페이로드 · 클럭 스파이크 · 익스플로잇 체인)",
      "진화 4단계(시드 · 웜 · 군체 · 오버마인드) · 시스템 포맷(루트 권한) · 오프라인 수익",
      "테마곡 · 효과음 · 보스 등장 · 격퇴 · 실패 연출, 전체화면 · 폰 화면",
    ],
  },
];

export function PatchNotesPanel() {
  const [sel, setSel] = useState(0);
  const n = PATCH_NOTES[sel];
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        {PATCH_NOTES.map((x, i) => (
          <button
            key={x.ver}
            type="button"
            onClick={() => setSel(i)}
            aria-pressed={sel === i}
            className={`vt-sm rounded-lg border px-2.5 py-1 font-mono font-bold transition-colors ${
              sel === i
                ? "border-emerald-300/80 bg-emerald-400/15 text-emerald-100"
                : "border-white/15 text-white/75 hover:text-white"
            }`}
          >
            {x.ver}
            {i === 0 && <span className="ml-1 text-emerald-300">NEW</span>}
          </button>
        ))}
        <span className="vt-sm ml-auto font-mono text-white/75">{n.date}</span>
      </div>
      <PagedList
        key={n.ver}
        className="flex flex-col gap-1.5"
        items={n.items.map((it) => (
          <p key={it} className="vt-sm flex gap-2 leading-relaxed text-white/90">
            <span className="text-emerald-300">•</span>
            <span>{it}</span>
          </p>
        ))}
      />
    </div>
  );
}

/** 게임 방법 — 사이트 공통 가이드 내용을 칸에 맞춰 페이지로 */
export function PagedGuide({ doc }: { doc: GuideDoc }) {
  const items: ReactNode[] = [
    <p key="lead" className="vt-base leading-relaxed text-white/90">
      {doc.lead}
    </p>,
  ];
  if (doc.facts)
    items.push(
      <div key="facts" className="flex flex-wrap gap-1.5">
        {doc.facts.map((f) => (
          <span
            key={f}
            className="vt-sm rounded-full border border-emerald-300/40 bg-emerald-400/10 px-2.5 py-0.5 text-white/90"
          >
            {f}
          </span>
        ))}
      </div>
    );
  for (const sec of doc.sections) {
    items.push(
      <h3 key={`h-${sec.title}`} className="vt-base mt-1 font-bold text-white">
        {sec.icon} {sec.title}
      </h3>
    );
    sec.items.forEach((it, i) =>
      items.push(
        <p key={`${sec.title}-${i}`} className="vt-sm flex gap-2 leading-relaxed text-white/90">
          <span className="text-emerald-300">•</span>
          <span>{it}</span>
        </p>
      )
    );
  }
  return <PagedList className="flex flex-col gap-1.5" items={items} />;
}
