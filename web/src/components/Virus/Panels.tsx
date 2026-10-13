"use client";

import { useRef, useState, type ReactNode } from "react";
import type { GuideDoc } from "@/components/GuideView";
import {
  ACH,
  BAL,
  CHAL,
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
  moduleLevels,
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
  /** 배경음악 끔 (오른쪽 위 버튼 · M 키) */
  bgmMute: boolean;
  /** 글자 크게 (모든 글자 1.15배) */
  big: boolean;
}

export const DEFAULT_SETTINGS: VirusSettings = {
  numbers: true,
  effects: true,
  bgm: 0.7,
  sfx: 0.8,
  bgmMute: false,
  big: false,
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
          shown={settings.sfx > 0 ? `${Math.round(settings.sfx * 100)}` : "꺼짐"}
          desc="타격 · 익스플로잇 · 보스 등장 · 격퇴 · 실패"
          onChange={(v) => onChange({ ...settings, sfx: v })}
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

/** 바이러스 도감 — 위 아이콘을 누르면 그 바이러스의 기록 (격퇴한 보스만 내용이 열림) */
export function ArchivePanel({ best }: { best: number }) {
  const mods = moduleLevels(best);
  const [sel, setSel] = useState(0);
  const v = ROSTER[sel];
  const lv = mods[sel];
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap justify-center gap-1.5">
        {ROSTER.map((r, i) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setSel(i)}
            aria-label={mods[i] ? r.name : `스테이지 ${i + 1}의 보스`}
            aria-pressed={sel === i}
            className={`rounded-lg border p-1 transition-colors ${
              sel === i
                ? "border-emerald-300/80 bg-emerald-400/15"
                : "border-white/15 hover:border-white/40"
            }`}
          >
            <span className={`block ${mods[i] ? "" : "opacity-30 grayscale"}`}>
              <VirusSprite seed={r.id} color={r.color} size={30} />
            </span>
          </button>
        ))}
      </div>
      <div
        className="flex min-h-0 flex-1 gap-3 overflow-hidden rounded-xl border p-3"
        style={{
          borderColor: lv ? `${v.color}66` : "rgba(255,255,255,0.15)",
          background: lv ? `${v.color}10` : "transparent",
        }}
      >
        <div className={`shrink-0 ${lv ? "" : "opacity-30 grayscale"}`}>
          <VirusSprite seed={v.id} color={v.color} size={56} />
        </div>
        <div className="min-w-0">
          <div className="vt-base font-bold" style={{ color: lv ? v.color : "#ffffffcc" }}>
            {lv ? v.name : "??????"}
            <span className="vt-sm ml-2 font-mono font-normal text-white/75">
              {lv ? v.year : "????"} · {sel + 1}/{ROSTER.length}
            </span>
          </div>
          {lv ? (
            <>
              <p className="vt-sm mt-1 leading-relaxed text-white/90">{v.desc}</p>
              <p className="vt-sm mt-1.5 text-white/90">
                📦 {v.module} v{lv} · {v.cur(lv)} — {v.effect}
              </p>
            </>
          ) : (
            <p className="vt-sm mt-1 text-white/90">
              스테이지 {sel + 1}의 보스예요. 격퇴하면 기록이 열려요.
            </p>
          )}
        </div>
      </div>
      <p className="vt-xs text-center text-white/75">
        모은 기록 {mods.filter((m) => m > 0).length}/{ROSTER.length} · 게임 속 수치는 지어낸 것이고,
        설명은 실제 사건을 짧게 요약했어요
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
    ["🔗 연쇄 감염", fmt(s.rec.chains)],
    ["☠️ 격퇴한 보스", fmt(s.rec.bosses)],
    ["🛡️ 처치한 상위 보스", fmt(s.rec.apexes)],
    ["☢️ KILLSWITCH 격퇴", fmt(s.clears)],
    ["🏎️ KILLSWITCH 최단 기록", s.rec.bestFinal ? `${s.rec.bestFinal.toFixed(1)}초` : "-"],
    ["🚫 보스에게 차단당함", fmt(s.rec.fails)],
    ["😰 1초 이하 남기고 격퇴", fmt(s.rec.clutch)],
    ["💥 가장 큰 한 방", fmt(s.rec.maxHit)],
    ["🔧 산 업그레이드 레벨", fmt(s.rec.ups)],
    ["🎲 랜덤 강화 (잭팟)", `${fmt(s.rec.rands)} (${fmt(s.rec.jackpots)})`],
    ["🧬 최고 진화 단계", EVOLUTION[s.rec.evo]?.name ?? "-"],
    ["🗺️ 최고 스테이지", String(Math.min(s.best, MAX_STAGE))],
    ["☣️ 변이 (챌린지 포함)", fmt(s.formats)],
    ["🎯 끝낸 챌린지", `${s.chalDone.length}/${CHAL.length}`],
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
        <span className="vt-sm ml-auto text-amber-200">
          업적 보너스 피해 +{Math.round(BAL.achDmg * 100 * s.ach.length)}%
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
    ver: "v0.6",
    date: "2026.10.14",
    items: [
      "스테이지 상한 100 → 1000: 101부터 다크넷 · 국방망 · 위성 통신망 · 전력망 · 국제 결제망 · 해저 케이블 · 양자 연구소 · 궤도 정거장 · 글로벌 코어 (10스테이지마다 구역). 최종 보스 KILLSWITCH는 스테이지 1000에서",
      "📦 코드 모듈 개편 — 능력치 대신 공격에 붙는 효과: 🥾 부트 선점(첫 발 강타) · 🪱 자가 복제(추가 발사) · 💌 러브레터 미끼(명중마다 데이터) · 🔥 BIOS 과열(점화) · 📜 매크로 연사(몇 발마다 +2발) · 🚪 백도어 이월(남은 피해를 다음 적에게) · 🎯 약점 분석(맞힐수록 피해 중첩) · 🔓 취약점 노출(익스플로잇 뒤 4초 피해 증가) · 🔐 암호화 잠금(보스 시간 연장) · 💣 DDoS 폭격(몇 초마다 일제 사격). 버전이 오를수록 상한에 가까워짐",
      "🛡️ 우회 기술 개편 — 예전 코드 모듈의 능력치를 이어받음 (서명 위조: 파일 보안 등급 · 포트 스캔: 피해 · 로그 삭제: 보스 보안 등급 + 5초 · 스팸 폭탄: 데이터 · 샌드박스 탈출: 익스플로잇 피해 · 관제 우회: 보스 피해 · 프로세스 은닉: 오프라인 효율 · 미끼 역이용: 익스플로잇 확률 + 루트 ×1.25 · 암호화 터널: 발사 속도 · 자가 학습: 업그레이드 비용). 처음 잡으면 열리고 버전은 최고 스테이지로 오름",
      "🧩 100스테이지마다 처음 넘으면 커널 코어 +1 · 챌린지 변이는 스테이지 100 돌파 뒤 열림 · 모듈 세트 단계 v3 · v10 · v30 · v100 (4단계)",
      "밸런스: 101부터 루트 권한이 스테이지마다 ×1.03씩 더 늘어남 · 변이 시작 스테이지는 최대 51 (깊은 곳에서 업그레이드 없이 다시 시작하면 막히던 것)",
      "업적 5개 추가 (스테이지 200 · 300 · 500 · 700 · 1000 돌파), 루트 권한 · 데이터 업적 기준을 후반에 맞춤 (39개)",
      "큰 숫자 표시: T 다음에 Qa · Qi · Sx · Sp · Oc · No · Dc (예전엔 T를 넘으면 단위 없이 지수가 잘못 보였음)",
      "v0.5 저장본: 스테이지 100에서 최종 보스를 기다리던 진행은 101부터 이어서",
    ],
  },
  {
    ver: "v0.5",
    date: "2026.10.13",
    items: [
      "🏅 업적 34개 — 진행 · 변이 · 누적 · 도전 기록. 하나마다 피해 +2% (변이해도 남음). 새 업적이 생기면 위 막대 🏅 버튼에 ❗ — 누르면 기록 창에 NEW 표시로 맨 앞에",
      "📊 기록 창 (메뉴 · 시작 화면): 업적 진행 막대와 통계 — 플레이 시간 · 감염시킨 파일 · 격퇴한 보스 · KILLSWITCH 최단 기록 · 가장 큰 한 방 · 가장 오래 비운 시간 등",
      "💾 세이브 백업: 진행을 글자로 복사하거나 파일로 저장하고, 다른 브라우저 · 기기에서 붙여 넣거나 파일을 골라 불러오기",
      "🧩 모듈 세트 4종: 같은 계열 모듈이 모두 v3 · v6 · v10이면 단계가 오름 — 📧 메일 폭탄(데이터 ×1.2 → ×2) · 🪱 자가 전파(연쇄 감염 10% → 30%) · 💽 시스템 파괴(보스 피해 ×1.2 → ×2) · 🕵️ 국가급 작전(보스 시간 +3 → +10초). 코드 모듈 탭에서 확인",
      "🔗 연쇄 감염: 파일을 감염시키면 그 확률로 다음 파일도 바로 감염 (데이터도 한 번 더 · 비운 동안 수익에도 반영)",
      "🎯 챌린지 변이 5종 (KILLSWITCH 첫 격퇴 뒤, 변이 탭): 스테이지 1부터 제약을 걸고 목표까지 — 🐌 단일 스레드 → 90 · ⏱️ 제로데이 → 99 · 🧱 모듈 봉인 → 55 · 🔒 업그레이드 봉인 → 95 · 🚫 루트 차단 → 95. 성공하면 영구 보상(발사 속도 ×1.2 · 보스 시간 +5초 · 피해 ×1.5 · 랜덤 강화 ×0.85 · 루트 권한 1당 +1%p) + 🧩 커널 코어 1개",
      "밸런스 시뮬레이터: 크론 데몬을 사려고 루트 권한을 모아 두는 플레이어로 · 세트 · 연쇄 감염 · 업적 · 챌린지까지 계산",
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
