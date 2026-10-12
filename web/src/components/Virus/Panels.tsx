"use client";

import { useState, type ReactNode } from "react";
import type { GuideDoc } from "@/components/GuideView";
import { ROSTER, moduleLevels } from "@/lib/virus/logic";
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
                📦 {v.module} v{lv} · {v.cur(lv)} (버전마다 {v.effect})
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

/** 패치노트 — 새 버전을 맨 위에 */
export const PATCH_NOTES: { ver: string; date: string; items: string[] }[] = [
  {
    ver: "v0.4",
    date: "2026.10.12",
    items: [
      "최종 보스 KILLSWITCH를 잡을 때마다 🧩 커널 코어 +1 (변이해도 남음) — 다음 KILLSWITCH(v2, v3…)는 체력 ×1.5",
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
