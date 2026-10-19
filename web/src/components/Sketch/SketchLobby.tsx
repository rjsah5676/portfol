"use client";

import { useEffect, useRef, useState } from "react";
import { plainName } from "@/components/Nick";
import { DailyMissionList, useDailyReady } from "@/components/Points/DailyMissions";
import { avatarOf } from "@/lib/sketch/assets";
import { FAKE_LAPS, MODE_LIST, MODES, type GameMode } from "@/lib/sketch/modes";
import { CUSTOM_MAX, parseCustomWords, TOPICS } from "@/lib/sketch/words";
import { playBgm, playSfx } from "@/lib/sketch/sfx";
import {
  cleanupEmptyRoom,
  createRoom,
  serverNow,
  subscribeLobby,
  type LobbyRoom,
  type TurnMode,
} from "@/realtime/sketch";
import { Avatar, Doodles, Icon, Logo, Mascot, Who } from "./Art";
import { Dialog, FsButton, nextKey, SoundButton, tap, useStage } from "./stage";

/** 직접 입력 범위 (서버 규칙과 같게) */
const TIME_MIN = 40;
const TIME_MAX = 300;
const ROUNDS_MIN = 1;
const ROUNDS_MAX = 10;

const PRESETS = [
  { id: "fast", label: "⚡ 빠르게", drawTime: 60, rounds: 1, desc: "60초 · 한 사람당 1번" },
  { id: "basic", label: "🎨 기본", drawTime: 80, rounds: 2, desc: "80초 · 한 사람당 2번" },
  { id: "slow", label: "☕ 느긋하게", drawTime: 120, rounds: 3, desc: "120초 · 한 사람당 3번" },
] as const;

const PHASE: Record<string, { t: string; c: string }> = {
  waiting: { t: "대기 중", c: "var(--mint)" },
  choosing: { t: "게임 중 · 참가 가능", c: "var(--orange)" },
  drawing: { t: "게임 중 · 참가 가능", c: "var(--orange)" },
  reveal: { t: "게임 중 · 참가 가능", c: "var(--orange)" },
  ended: { t: "게임 끝", c: "var(--ink3)" },
};

/** 빠른 시작으로 들어갈 방: 비번 없고 자리 있는 방 중 대기실 → 사람 많은 순 */
function pickQuick(rooms: LobbyRoom[]): LobbyRoom | null {
  const open = rooms.filter(
    (r) => !r.locked && r.count < r.max && r.count > 0 && r.phase !== "ended"
  );
  open.sort(
    (a, b) => Number(b.phase === "waiting") - Number(a.phase === "waiting") || b.count - a.count
  );
  return open[0] ?? null;
}

export default function SketchLobby({
  uid,
  nick,
  member,
  onNick,
  onEnter,
  onTitle,
}: {
  uid: string;
  nick: string;
  member: boolean;
  onNick: (n: string) => void;
  onEnter: (roomId: string) => void;
  onTitle: () => void;
}) {
  const { o } = useStage();
  const [rooms, setRooms] = useState<LobbyRoom[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [quickBusy, setQuickBusy] = useState(false);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [editNick, setEditNick] = useState(false);
  const [toast, setToast] = useState<{ t: string; k: number } | null>(null);
  const [missions, setMissions] = useState(false);
  // 받을 수 있는 일일 미션 수 (창을 닫으면 다시 셈)
  const ready = useDailyReady("sketch", missions);

  useEffect(() => playBgm("bgm-lobby"), []);

  // 아무도 없는 방 정리 — 1분 넘은 방만, 세션당 한 번씩 확인 (접속자가 있으면 서버가 안 지움)
  const checked = useRef(new Set<string>());
  useEffect(
    () =>
      subscribeLobby((list) => {
        // 아무도 없는 방은 목록에서 숨김 (나간 방이 남아 보이지 않게 — 서버가 곧 정리함)
        setRooms(list.filter((r) => r.count > 0));
        for (const r of list) {
          if (checked.current.has(r.id) || serverNow() - r.createdAt < 60_000) continue;
          checked.current.add(r.id);
          cleanupEmptyRoom(r.id);
        }
      }),
    []
  );

  const quick = async () => {
    const r = rooms && pickQuick(rooms);
    if (r) return onEnter(r.id);
    // 들어갈 방이 없으면 기본 설정으로 새 방
    setQuickBusy(true);
    try {
      const id = await createRoom(uid, nick, {
        name: "",
        max: 8,
        turnMode: "winner",
        drawTime: 80,
        rounds: 2,
        hints: true,
        password: "",
      });
      onEnter(id);
    } catch {
      playSfx("sfx-error");
      setToast({ t: "방을 만들지 못했어요. 잠시 후 다시 해 주세요", k: nextKey() });
      setQuickBusy(false);
    }
  };

  const shown = (rooms ?? []).filter((r) => !onlyOpen || (r.count < r.max && r.phase !== "ended"));
  const openCount = (rooms ?? []).filter((r) => r.count < r.max && r.phase !== "ended").length;
  const quickTarget = rooms ? pickQuick(rooms) : null;
  const v = o === "v";

  const me = (
    <div className="sk-card-soft flex items-center gap-2.5 py-1.5 pr-3 pl-1.5">
      <Avatar idx={avatarOf(uid)} size={v ? 36 : 40} />
      <div className="min-w-0">
        <div className="max-w-[9em] truncate text-[15px] font-extrabold">
          <Who name={nick} />
        </div>
        <button
          type="button"
          onClick={tap(() => (member ? onNick("") : setEditNick(true)))}
          className="text-[11.5px] text-[var(--sky)] underline-offset-2 hover:underline"
        >
          {member ? "별명 바꾸기 (내 정보)" : "이름 바꾸기"}
        </button>
      </div>
    </div>
  );

  const actions = (
    <div className={`flex ${v ? "gap-2" : "flex-col gap-3"}`}>
      <button
        type="button"
        disabled={quickBusy || rooms === null}
        onClick={tap(quick, "sfx-pick")}
        className={`sk-btn sk-btn-sun relative flex-1 flex-col ${v ? "py-3 text-[22px]" : "py-5 text-[32px]"}`}
      >
        <span className="flex items-center gap-1.5">
          <Icon name="bolt" size={v ? 20 : 28} /> 빠른 시작
        </span>
        <span
          className={`max-w-full truncate font-['Nanum_Gothic',sans-serif] font-bold text-[var(--ink2)] ${v ? "text-[11px]" : "text-[13px]"}`}
        >
          {quickBusy
            ? "방 만드는 중…"
            : quickTarget
              ? `「${plainName(quickTarget.name)}」 ${quickTarget.count}/${quickTarget.max}명`
              : "새 방을 바로 만들어요"}
        </span>
      </button>
      <button
        type="button"
        onClick={tap(() => setCreating(true), "sfx-open")}
        className={`sk-btn sk-btn-coral flex-1 flex-col ${v ? "py-3 text-[22px]" : "py-5 text-[32px]"}`}
      >
        <span className="flex items-center gap-1.5">
          <Icon name="plus" size={v ? 20 : 28} /> 방 만들기
        </span>
        <span
          className={`font-['Nanum_Gothic',sans-serif] font-bold text-white/90 ${v ? "text-[11px]" : "text-[13px]"}`}
        >
          시간 · 인원 · 비밀번호
        </span>
      </button>
    </div>
  );

  const list =
    rooms === null ? (
      <div className="flex flex-1 items-center justify-center">
        <p className="sk-hand text-[20px] text-[var(--ink3)]">방 목록 불러오는 중…</p>
      </div>
    ) : shown.length === 0 ? (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
        <Mascot pose="sleep" size={v ? 100 : 130} />
        <p className="sk-hand text-[22px]">
          {rooms.length ? "들어갈 수 있는 방이 없어요" : "아직 열린 방이 없어요"}
        </p>
        <p className="text-[13px] text-[var(--ink2)]">
          <b>빠른 시작</b>을 누르면 바로 방이 생기고, 초대 링크로 친구를 부를 수 있어요
        </p>
      </div>
    ) : (
      <ul
        className={`sk-scroll grid min-h-0 flex-1 content-start gap-3 overflow-y-auto p-1 pr-2 pb-3 ${v ? "grid-cols-1" : "grid-cols-2"}`}
      >
        {shown.map((r, i) => {
          const full = r.count >= r.max;
          const ph = PHASE[r.phase] ?? PHASE.waiting;
          return (
            <li
              key={r.id}
              className="sk-rise"
              style={{ animationDelay: `${Math.min(i, 10) * 0.03}s` }}
            >
              <button
                type="button"
                disabled={full}
                onClick={() => onEnter(r.id)}
                className="sk-room flex w-full items-center gap-3 px-3.5 py-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    {r.locked && (
                      <Icon name="lock" size={15} className="shrink-0 text-[var(--coral)]" />
                    )}
                    <span className="truncate text-[15.5px] font-extrabold">
                      {plainName(r.name)}
                    </span>
                  </span>
                  <span className="mt-1 flex items-center gap-2 text-[12px] text-[var(--ink2)]">
                    <span
                      className="inline-flex items-center gap-1 font-bold"
                      style={{ color: ph.c }}
                    >
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ background: ph.c }}
                      />
                      {full ? "꽉 찼어요" : ph.t}
                    </span>
                    <span className="truncate">
                      ·{" "}
                      {!r.mode || r.mode === "classic"
                        ? r.turnMode === "winner"
                          ? "맞힌 사람이 다음"
                          : "입장 순서대로"
                        : MODES[r.mode]
                          ? `${MODES[r.mode].emoji} ${MODES[r.mode].name}`
                          : ""}
                    </span>
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span
                    className={`sk-hand text-[24px] leading-none ${full ? "text-[var(--coral)]" : ""}`}
                  >
                    {r.count}
                    <span className="text-[16px] text-[var(--ink3)]">/{r.max}</span>
                  </span>
                  <span className="flex gap-[3px]">
                    {Array.from({ length: r.max }, (_, k) => (
                      <span
                        key={k}
                        className="h-[7px] w-[7px] rounded-full border-[1.5px] border-[var(--ink)]"
                        style={{ background: k < r.count ? "var(--sun)" : "transparent" }}
                      />
                    ))}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    );

  const listHead = (
    <div className="flex items-center justify-between gap-2 pb-2">
      <h2 className="sk-hand text-[26px] leading-none">
        열린 방 <span className="text-[var(--coral)]">{rooms?.length ?? 0}</span>
        <span className="ml-1.5 text-[16px] text-[var(--ink3)]">· 자리 있는 방 {openCount}</span>
      </h2>
      <button
        type="button"
        data-on={onlyOpen}
        onClick={tap(() => setOnlyOpen((x) => !x))}
        className="sk-chip shrink-0 text-[14px]"
      >
        {onlyOpen ? "✓ " : ""}자리 있는 방만
      </button>
    </div>
  );

  return (
    <div className="relative flex h-full flex-col">
      <Doodles
        items={[
          [2, 84, 44, -10],
          [94, 86, 40, 12],
          [55, 3, 30, 6],
        ]}
        className="opacity-60"
      />
      {/* 머리 */}
      <div className={`relative flex items-center gap-3 ${v ? "px-3 pt-3" : "px-8 pt-5"}`}>
        <button
          type="button"
          onClick={tap(onTitle)}
          title="타이틀로"
          className="shrink-0 cursor-pointer"
        >
          <Logo size={v ? 0.42 : 0.62} />
        </button>
        <div className="flex-1" />
        {!v && me}
        <button
          type="button"
          onClick={tap(() => setMissions(true), "sfx-open")}
          title="오늘의 미션 · 매일 GP"
          className={`sk-btn relative ${ready ? "sk-btn-sun" : ""} ${v ? "px-2.5 text-[15px]" : "text-[18px]"}`}
        >
          📅 {v ? "미션" : "오늘의 미션"}
          {ready > 0 && (
            <span className="absolute -top-2 -right-2 grid h-5 min-w-5 place-items-center rounded-full border-2 border-[var(--ink)] bg-[var(--coral)] px-1 text-[11px] font-extrabold text-white">
              {ready}
            </span>
          )}
        </button>
        <SoundButton />
        <FsButton />
      </div>

      {v ? (
        <div className="relative flex min-h-0 flex-1 flex-col gap-3 px-3 pt-3">
          {me}
          {actions}
          <div className="flex min-h-0 flex-1 flex-col">
            {listHead}
            {list}
          </div>
        </div>
      ) : (
        <div className="relative grid min-h-0 flex-1 grid-cols-[330px_1fr] gap-8 px-8 pt-6 pb-6">
          <div className="flex flex-col gap-4">
            {actions}
            <div
              className="sk-note relative mt-auto flex items-end gap-2 p-3.5"
              style={{ rotate: "-1.5deg" }}
            >
              <div className="flex-1 text-[13px] leading-relaxed">
                <b className="sk-hand block text-[19px]">이렇게 놀아요</b>
                <b>방 만들기</b>에서 모드를 골라요 — 🎨 그림 맞히기 · 🕵️ 가짜 화가 · 📞 그림 릴레이.{" "}
                <b>초대 링크</b>로 온 친구는 비밀번호 없이 바로 입장!
              </div>
              <Mascot pose="idle" size={92} />
            </div>
          </div>
          <div className="flex min-h-0 flex-col">
            {listHead}
            {list}
          </div>
        </div>
      )}

      {creating && (
        <CreateDialog
          uid={uid}
          nick={nick}
          onClose={() => setCreating(false)}
          onCreated={onEnter}
        />
      )}
      {editNick && (
        <NickDialog
          nick={plainName(nick)}
          onClose={() => setEditNick(false)}
          onSave={(n) => {
            onNick(n);
            setEditNick(false);
          }}
        />
      )}
      {missions && (
        <Dialog
          onClose={() => setMissions(false)}
          title="📅 오늘의 미션"
          className="w-[min(460px,100%)]"
        >
          <div className="sk-scroll mx-4 mb-4 min-h-0 overflow-y-auto rounded-xl bg-[#2B2D42] p-3 text-white">
            <DailyMissionList game="sketch" accent="#FF6B6B" />
          </div>
        </Dialog>
      )}
      {toast && (
        <div key={toast.k} className="sk-toast sk-card bottom-6 px-4 py-2 text-[14px] font-bold">
          {toast.t}
        </div>
      )}
    </div>
  );
}

function NickDialog({
  nick,
  onClose,
  onSave,
}: {
  nick: string;
  onClose: () => void;
  onSave: (n: string) => void;
}) {
  const [n, setN] = useState(nick);
  const save = () => {
    if (!n.trim()) return;
    playSfx("sfx-pick");
    onSave(n.trim());
  };
  return (
    <Dialog onClose={onClose} title="이름 바꾸기" className="w-[min(380px,100%)]">
      <div className="flex flex-col gap-3 px-5 pt-2 pb-5">
        <input
          autoFocus
          value={n}
          maxLength={10}
          onChange={(e) => setN(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && save()}
          className="sk-input text-center text-[17px]"
        />
        <button
          type="button"
          onClick={save}
          disabled={!n.trim()}
          className="sk-btn sk-btn-mint py-2.5 text-[22px]"
        >
          바꾸기
        </button>
      </div>
    </Dialog>
  );
}

/** 고르기 버튼 옆 직접 입력칸 — 칸을 벗어나면 범위 안으로 맞춤 */
function NumInput({
  value,
  min,
  max,
  unit,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const [focus, setFocus] = useState(false);
  const commit = (raw: string) => {
    const n = Math.round(Number(raw));
    const v = Number.isFinite(n) && raw.trim() ? Math.min(max, Math.max(min, n)) : value;
    onChange(v);
    setText(String(v));
  };
  return (
    <span className="inline-flex items-center gap-1 text-[13px] text-[var(--ink2)]">
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        aria-label={`직접 입력 (${min}~${max}${unit})`}
        value={focus ? text : String(value)}
        onFocus={() => {
          setFocus(true);
          setText(String(value));
        }}
        onChange={(e) => {
          setText(e.target.value);
          const n = Math.round(Number(e.target.value));
          if (e.target.value.trim() && Number.isFinite(n) && n >= min && n <= max) onChange(n);
        }}
        onBlur={(e) => {
          setFocus(false);
          commit(e.target.value);
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        className="sk-input w-16 px-2 py-1 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      {unit}
      <span className="text-[var(--ink3)]">
        ({min}~{max})
      </span>
    </span>
  );
}

function CreateDialog({
  uid,
  nick,
  onClose,
  onCreated,
}: {
  uid: string;
  nick: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { o } = useStage();
  const [mode, setMode] = useState<GameMode>("classic");
  const [challenge, setChallenge] = useState(true);
  const [topics, setTopics] = useState<string[]>([]);
  const [customText, setCustomText] = useState("");
  const [customOnly, setCustomOnly] = useState(false);
  const customWords = parseCustomWords(customText);
  const [name, setName] = useState("");
  const [max, setMax] = useState(8);
  const [turnMode, setTurnMode] = useState<TurnMode>("winner");
  const [drawTime, setDrawTime] = useState(80);
  const [rounds, setRounds] = useState(2);
  const [hints, setHints] = useState(true);
  const [password, setPassword] = useState("");
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** 직접 정하기를 눌렀거나, 정한 값이 준비된 3개와 다르면 직접 정하기 */
  const [custom, setCustom] = useState(false);
  const matched = PRESETS.find((p) => p.drawTime === drawTime && p.rounds === rounds)?.id ?? "";
  const preset = custom || !matched ? "custom" : matched;

  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const id = await createRoom(uid, nick, {
        name,
        max: Math.max(MODES[mode].min, max),
        turnMode,
        drawTime: mode === "classic" ? drawTime : mode === "fake" ? 80 : modeTime,
        rounds: mode === "fake" ? fakeGames : rounds,
        hints,
        password,
        mode,
        challenge,
        topics,
        custom: customWords,
        customOnly: customOnly && customWords.length > 0,
        laps,
      });
      playSfx("jingle-start");
      onCreated(id);
    } catch (e) {
      console.error(e);
      playSfx("sfx-error");
      setError("방을 만들지 못했어요. 잠시 후 다시 시도해 주세요.");
      setBusy(false);
    }
  };

  const [fakeGames, setFakeGames] = useState(3);
  const [laps, setLaps] = useState(FAKE_LAPS);
  const [modeTime, setModeTime] = useState(90);
  const label = (t: string) => <div className="sk-hand mb-1.5 text-[18px] leading-none">{t}</div>;
  const wordsBox = (
    <div className="grid gap-3">
      <div>
        <div className="mb-1 text-[13.5px] font-bold">
          주제 고르기 <span className="text-[11.5px] text-[var(--ink3)]">(안 고르면 전체)</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TOPICS.map((t) => (
            <button
              key={t}
              type="button"
              data-on={topics.includes(t)}
              onClick={tap(() =>
                setTopics((l) => (l.includes(t) ? l.filter((x) => x !== t) : [...l, t]))
              )}
              className="sk-chip text-[13.5px]"
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1 text-[13.5px] font-bold">
          우리끼리 제시어{" "}
          <span className="text-[11.5px] text-[var(--ink3)]">
            쉼표나 줄바꿈으로 나눠요 · 최대 {CUSTOM_MAX}개
          </span>
        </div>
        <textarea
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          rows={2}
          maxLength={1500}
          placeholder="예: 우리 팀장님, 회식, 탕비실, 월요일 아침"
          className="sk-input w-full resize-none text-[14px]"
        />
        <div className="mt-1 flex items-center justify-between gap-2 text-[12px] font-bold text-[var(--ink2)]">
          <span>{customWords.length}개</span>
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={customOnly}
              disabled={!customWords.length}
              onChange={(e) => {
                playSfx("sfx-click");
                setCustomOnly(e.target.checked);
              }}
              className="h-4 w-4 accent-[#FF6B6B]"
            />
            우리끼리 제시어만 쓰기
          </label>
        </div>
      </div>
    </div>
  );
  return (
    <Dialog onClose={onClose} title="방 만들기" className={o === "v" ? "w-full" : "w-[620px]"}>
      <div className="sk-scroll flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pt-2 pb-5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={20}
          placeholder={`방 이름 (비우면 「${plainName(nick)}의 방」)`}
          aria-label="방 이름"
          className="sk-input text-[16px]"
        />
        <div>
          {label("게임 모드")}
          <div className="grid grid-cols-3 gap-2">
            {MODE_LIST.map((m) => (
              <button
                key={m}
                type="button"
                onClick={tap(() => setMode(m), "sfx-pick")}
                className={`sk-btn flex-col gap-1 px-1.5 py-2.5 text-[18px] whitespace-normal ${mode === m ? "sk-btn-sun" : ""}`}
              >
                <span className="text-[26px] leading-none">{MODES[m].emoji}</span>
                {MODES[m].name}
                <span className="font-['Nanum_Gothic',sans-serif] text-[10.5px] leading-snug font-bold break-keep text-[var(--ink2)]">
                  {MODES[m].short}
                </span>
                <span className="font-['Nanum_Gothic',sans-serif] text-[10px] font-bold text-[var(--ink3)]">
                  {MODES[m].min}명부터
                </span>
              </button>
            ))}
          </div>
        </div>
        {mode === "fake" && (
          <div>
            {label("몇 판 할까요?")}
            <div className="flex flex-wrap gap-1.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  data-on={fakeGames === n}
                  onClick={tap(() => setFakeGames(n))}
                  className="sk-chip min-w-[3em] text-[15px]"
                >
                  {n}판
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11.5px] text-[var(--ink3)]">
              판마다 제시어와 가짜 화가가 새로 정해져요 · 한 획 {25}초
            </p>
            <div className="mt-3">{label("몇 바퀴 그릴까요?")}</div>
            <div className="flex flex-wrap gap-1.5">
              {[2, 3, 4, 5, 6].map((n) => (
                <button
                  key={n}
                  type="button"
                  data-on={laps === n}
                  onClick={tap(() => setLaps(n))}
                  className="sk-chip min-w-[3em] text-[15px]"
                >
                  {n}바퀴
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11.5px] text-[var(--ink3)]">
              한 바퀴 = 모두 한 획씩 · 많을수록 그림이 자세해져요
            </p>
          </div>
        )}
        {mode === "relay" && (
          <div>
            {label("그리는 시간")}
            <div className="flex flex-wrap gap-1.5">
              {[60, 90, 120, 150].map((n) => (
                <button
                  key={n}
                  type="button"
                  data-on={modeTime === n}
                  onClick={tap(() => setModeTime(n))}
                  className="sk-chip min-w-[3.4em] text-[15px]"
                >
                  {n}초
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11.5px] text-[var(--ink3)]">
              인원수만큼 이어 가요 (최대 8단계) · 글은 50초
            </p>
          </div>
        )}
        {mode === "classic" && (
          <div>
            {label("게임 길이")}
            <div className={`grid gap-2 ${o === "v" ? "grid-cols-2" : "grid-cols-4"}`}>
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={tap(() => {
                    setCustom(false);
                    setDrawTime(p.drawTime);
                    setRounds(p.rounds);
                  })}
                  className={`sk-btn flex-col gap-1 px-1 py-2.5 text-[19px] ${preset === p.id ? "sk-btn-sun" : ""}`}
                >
                  {p.label}
                  <span className="font-['Nanum_Gothic',sans-serif] text-[10.5px] font-bold whitespace-normal text-[var(--ink2)]">
                    {p.desc}
                  </span>
                </button>
              ))}
              <button
                type="button"
                onClick={tap(() => setCustom(true))}
                className={`sk-btn flex-col gap-1 px-1 py-2.5 text-[19px] ${preset === "custom" ? "sk-btn-sun" : ""}`}
              >
                ✏️ 직접
                <span className="font-['Nanum_Gothic',sans-serif] text-[10.5px] font-bold whitespace-normal text-[var(--ink2)]">
                  {preset === "custom" ? `${drawTime}초 · ${rounds}번` : "시간 · 횟수 정하기"}
                </span>
              </button>
            </div>
            {preset === "custom" && (
              <div className="sk-rise sk-card-soft mt-3 grid gap-3 p-3.5">
                <div>
                  <div className="mb-1 flex items-baseline justify-between">
                    <span className="sk-hand text-[17px]">그리는 시간</span>
                    <NumInput
                      value={drawTime}
                      min={TIME_MIN}
                      max={TIME_MAX}
                      unit="초"
                      onChange={setDrawTime}
                    />
                  </div>
                  <input
                    type="range"
                    min={TIME_MIN}
                    max={TIME_MAX}
                    step={5}
                    value={drawTime}
                    aria-label="그리는 시간"
                    onChange={(e) => setDrawTime(Number(e.target.value))}
                    className="w-full accent-[#FF6B6B]"
                  />
                  <div className="flex justify-between text-[11px] font-bold text-[var(--ink3)]">
                    <span>{TIME_MIN}초</span>
                    <span>{TIME_MAX}초</span>
                  </div>
                </div>
                <div>
                  <div className="mb-1 flex items-baseline justify-between">
                    <span className="sk-hand text-[17px]">한 사람당 그리는 횟수</span>
                    <NumInput
                      value={rounds}
                      min={ROUNDS_MIN}
                      max={ROUNDS_MAX}
                      unit="번"
                      onChange={setRounds}
                    />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        data-on={rounds === n}
                        onClick={tap(() => setRounds(n))}
                        className="sk-chip min-w-[3em] text-[15px]"
                      >
                        {n}번
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        {mode === "classic" && (
          <div>
            {label("다음에 그릴 사람")}
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["winner", "🏃 처음 맞힌 사람", "제일 먼저 맞히면 다음에 그려요"],
                  ["order", "🔁 들어온 순서대로", "돌아가면서 한 번씩 그려요"],
                ] as const
              ).map(([m, t, d]) => (
                <button
                  key={m}
                  type="button"
                  onClick={tap(() => setTurnMode(m))}
                  className={`sk-btn flex-col gap-1 px-1 py-2.5 text-[18px] ${turnMode === m ? "sk-btn-sun" : ""}`}
                >
                  {t}
                  <span className="font-['Nanum_Gothic',sans-serif] text-[10.5px] font-bold whitespace-normal text-[var(--ink2)]">
                    {d}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div>
          {label("최대 인원")}
          <div className="flex flex-wrap gap-1.5">
            {[2, 3, 4, 5, 6, 7, 8]
              .filter((n) => n >= MODES[mode].min)
              .map((n) => (
                <button
                  key={n}
                  type="button"
                  data-on={Math.max(MODES[mode].min, max) === n}
                  onClick={tap(() => setMax(n))}
                  className="sk-chip min-w-[2.6em] text-[16px]"
                >
                  {n}
                </button>
              ))}
          </div>
        </div>
        <label className="flex flex-col">
          {label("비밀번호 (비우면 공개방)")}
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            maxLength={20}
            placeholder="친구끼리만 하려면 입력"
            aria-label="비밀번호"
            className="sk-input text-[15px]"
          />
          <span className="mt-1 text-[11.5px] text-[var(--ink3)]">
            초대 링크로 들어온 친구는 비밀번호 없이 들어와요
          </span>
        </label>
        {(mode === "classic" || mode === "fake") && (
          <button
            type="button"
            onClick={tap(() => setMore((x) => !x))}
            className="sk-hand cursor-pointer self-start text-[17px] text-[var(--sky)]"
          >
            {more
              ? "▾ 자세한 설정 접기"
              : mode === "classic"
                ? "▸ 자세한 설정 (힌트 · 깜짝 챌린지 · 주제 · 우리끼리 제시어)"
                : mode === "fake"
                  ? "▸ 자세한 설정 (주제 · 우리끼리 제시어)"
                  : null}
          </button>
        )}
        {more && mode === "fake" && <div className="sk-rise">{wordsBox}</div>}
        {more && mode === "classic" && (
          <div className="sk-rise grid gap-4">
            <label className="flex cursor-pointer items-center gap-2 text-[14px] font-bold">
              <input
                type="checkbox"
                checked={challenge}
                onChange={(e) => {
                  playSfx("sfx-click");
                  setChallenge(e.target.checked);
                }}
                className="h-4 w-4 accent-[#FF6B6B]"
              />
              🎭 깜짝 챌린지 (가끔 한붓그리기 · 눈 가리고 · 검정 한 색, 점수 ×1.5)
            </label>
            {wordsBox}
            <label className="flex cursor-pointer items-center gap-2 text-[14px] font-bold">
              <input
                type="checkbox"
                checked={hints}
                onChange={(e) => {
                  playSfx("sfx-click");
                  setHints(e.target.checked);
                }}
                className="h-4 w-4 accent-[#FF6B6B]"
              />
              시간이 지나면 힌트 보여 주기 (첫 글자 → 초성)
            </label>
          </div>
        )}
        {error && <p className="text-[13px] font-bold text-[var(--coral)]">{error}</p>}
        <button
          type="button"
          disabled={busy}
          onClick={create}
          className="sk-btn sk-btn-coral mt-1 py-3 text-[26px]"
        >
          {busy ? "만드는 중…" : "방 만들고 들어가기"}
        </button>
      </div>
    </Dialog>
  );
}
