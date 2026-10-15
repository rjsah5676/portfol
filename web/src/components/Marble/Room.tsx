"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { CHAR, GRADE_COLOR, ITEM, power, type Loadout } from "@/lib/marble/data";
import { MAPS, MAP_IDS, type MapId } from "@/lib/marble/maps";
import type { RoomWire } from "@/lib/marble/wire";
import { marble } from "@/realtime/marble";
import { serverNow } from "@/lib/api/socket";
import { getPrefs, onPrefs, setPrefs, sfx } from "./audio";
import { Btn, GradeTag, Icon, PCOLOR, Stars, Win } from "./pixel";
import { useStage } from "./Stage";
import Token from "./Token";

/*
 * 대기실 — 자리(최대 4) · 준비 · 방장 설정(맵 · 인원 · 바로 입장 허용 · AI 입장 허용 · AI 넣고 빼기) · 채팅.
 * 모두 준비되면 3초 뒤 시작 (AI 는 늘 준비).
 */

export const MAP_ART: Record<MapId, { bg: string; icon: string }> = {
  town: { bg: "#bfe8ff", icon: "house" },
  cross: { bg: "#ffe9c4", icon: "warp" },
  orgel: { bg: "#ffe1f0", icon: "note" },
};

export function WaitRoom({ room, me, onLeave }: { room: RoomWire; me: string; onLeave(): void }) {
  const mine = room.seats.find((s) => s?.uid === me);
  const owner = room.owner === me;
  const m = MAPS[room.map];
  const [, tick] = useState(0);
  useEffect(() => {
    if (!room.startAt) return;
    const id = setInterval(() => tick((x) => x + 1), 200);
    return () => clearInterval(id);
  }, [room.startAt]);
  const count = room.startAt ? Math.max(0, Math.ceil((room.startAt - serverNow()) / 1000)) : 0;
  const opt = (o: Parameters<typeof marble.opts>[1]) => void marble.opts(room.id, o).catch((e) => alert((e as Error).message));
  return (
    <div className="mb-sky absolute inset-0">
      <div className="absolute top-[10px] left-[12px] flex items-center gap-2">
        <Btn className="h-[34px] px-3 text-[13px]" onClick={onLeave}>
          <Icon n="back" size={12} /> 나가기
        </Btn>
        <div className="mb-wood px-3 py-1.5">
          <b className="mb-title mb-out text-[17px] text-white">{room.name}</b>
          {room.locked && <Icon n="lock" size={13} className="ml-1.5" />}
        </div>
      </div>
      <div className="absolute top-[10px] right-[12px]">
        <RoomTools room={room} me={me} onLeave={onLeave} />
      </div>

      {/* 자리 */}
      <div className="absolute top-[64px] left-[12px] grid w-[640px] grid-cols-2 gap-3">
        {room.seats.map((s, i) => (
          <div key={i} className="mb-box flex h-[196px] gap-2 p-2" style={{ "--bg": s ? "#fffaf0" : "#f1e6cc" } as CSSProperties}>
            {s ? (
              <>
                <div className="mb-grass relative flex w-[120px] shrink-0 items-end justify-center pb-3" style={{ boxShadow: "0 0 0 2px #232a4d" }}>
                  <Token sprite={CHAR[s.lo.char.id]?.sprite ?? "kai"} h={110} />
                  <div className="absolute top-1 left-1 h-[10px] w-[18px]" style={{ background: PCOLOR[i], boxShadow: "0 0 0 2px #232a4d" }} />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1 text-[12px]">
                  <div className="flex items-center gap-1">
                    {s.bot && <Icon n="bot" size={13} />}
                    {room.owner && s.uid === room.owner && <Icon n="crown" size={13} />}
                    <b className="truncate text-[15px]">{s.name}</b>
                  </div>
                  <LoadoutLine lo={s.lo} />
                  <div className="mt-auto flex items-center gap-1.5">
                    {s.ready ? (
                      <span className="mb-chip text-[12px] font-bold" style={{ "--c": "#4fd1b5" } as CSSProperties}>
                        <Icon n="check" size={10} /> 준비
                      </span>
                    ) : (
                      <span className="mb-chip text-[12px]">기다리는 중</span>
                    )}
                    {s.bot && owner && (
                      <Btn className="h-[24px] px-2 text-[11px]" onClick={() => opt({ kickBot: i })}>
                        AI 빼기
                      </Btn>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-[13px] text-[var(--mute)]">
                빈 자리
                {owner && room.bots && (
                  <Btn tone="mint" className="h-[30px] px-3 text-[12px]" onClick={() => opt({ addBot: true })}>
                    <Icon n="bot" size={12} /> AI 넣기
                  </Btn>
                )}
                {!room.bots && <span className="text-[11px]">AI 입장 꺼짐</span>}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 방 설정 · 시작 */}
      <div className="absolute top-[64px] right-[12px] flex w-[346px] flex-col gap-3">
        <Win title="방 설정">
          <div className="flex flex-col gap-2 p-3 text-[13px]">
            <div className="grid grid-cols-3 gap-1.5">
              {MAP_IDS.map((id) => (
                <Btn
                  key={id}
                  tone={room.map === id ? "gold" : "paper"}
                  className="h-[52px] flex-col gap-0.5 px-1 text-[12px]"
                  disabled={!owner}
                  onClick={() => opt({ map: id })}
                  title={MAPS[id].desc}
                >
                  <Icon n={MAP_ART[id].icon} size={18} />
                  <b>{MAPS[id].name}</b>
                </Btn>
              ))}
            </div>
            <p className="text-[11px] leading-[15px] text-[var(--mute)]">{m.desc}</p>
            <div className="flex items-center gap-1.5">
              <span className="w-[52px]">인원</span>
              {[2, 3, 4].map((n) => (
                <Btn key={n} tone={room.max === n ? "gold" : "paper"} className="h-[28px] w-[40px] text-[13px]" disabled={!owner} onClick={() => opt({ max: n })}>
                  {n}
                </Btn>
              ))}
              <span className="ml-1 text-[11px] text-[var(--mute)]">{room.max === 2 ? "1:1" : `${room.max}인`}</span>
            </div>
            <Toggle label="바로 입장 허용" on={room.quick} disabled={!owner} onChange={(v) => opt({ quick: v })} hint="끄면 링크 · 목록으로만 들어와요 (친구 방)" />
            <Toggle label="AI 입장 허용" on={room.bots} disabled={!owner || !room.quick} onChange={(v) => opt({ bots: v })} hint="바로 입장을 허용한 방에만 AI 가 들어와요" />
          </div>
        </Win>
        <div className="flex flex-col items-stretch gap-2">
          {room.startAt ? (
            <div className="mb-box py-3 text-center">
              <b className="mb-title text-[20px]">{count}초 뒤 시작!</b>
            </div>
          ) : (
            <p className="text-center text-[12px] text-[var(--mute)]">{room.seats.filter(Boolean).length < 2 ? "두 명 이상이면 시작해요" : "모두 준비하면 3초 뒤 시작"}</p>
          )}
          {mine && (
            <Btn
              tone={mine.ready ? "paper" : "gold"}
              className="h-[54px] text-[20px] font-bold"
              onClick={() => {
                sfx("ready");
                void marble.ready(room.id, !mine.ready);
              }}
              silent
            >
              {mine.ready ? "준비 취소" : "준비!"}
            </Btn>
          )}
        </div>
      </div>
    </div>
  );
}

function Toggle({ label, on, disabled, onChange, hint }: { label: string; on: boolean; disabled?: boolean; onChange(v: boolean): void; hint?: string }) {
  return (
    <button type="button" disabled={disabled} onClick={() => onChange(!on)} className="flex items-center gap-2 text-left disabled:opacity-60" title={hint}>
      <span className="relative h-[18px] w-[34px] shrink-0" style={{ background: on ? "#4fd1b5" : "#e0d3b8", boxShadow: "0 0 0 2px #232a4d" }}>
        <span className="absolute top-[2px] h-[14px] w-[14px] bg-white" style={{ left: on ? 18 : 2, boxShadow: "0 0 0 2px #232a4d" }} />
      </span>
      <span className="text-[13px]">{label}</span>
    </button>
  );
}

export function LoadoutLine({ lo }: { lo: Loadout }) {
  const c = CHAR[lo.char.id];
  return (
    <div className="flex flex-col gap-1">
      {c && (
        <div className="flex items-center gap-1">
          <GradeTag g={c.grade} />
          <b className="truncate">{c.title}</b>
          <Stars lv={lo.char.lv} size={9} />
        </div>
      )}
      {c && (
        <div className="text-[11px] leading-[14px] text-[var(--ink2)]">
          <b>{c.passive.name}</b> {c.passive.desc(power(c.grade, lo.char.lv))}
        </div>
      )}
      <div className="flex flex-wrap gap-1 text-[11px]">
        {[lo.dice, lo.buddy].map((gr, k) => {
          const it = gr ? ITEM[gr.id] : null;
          return it ? (
            <span key={k} className="mb-chip" style={{ "--c": GRADE_COLOR[it.grade] + "55" } as CSSProperties} title={it.desc(power(it.grade, gr!.lv))}>
              {it.name} +{gr!.lv}
            </span>
          ) : (
            <span key={k} className="mb-chip text-[var(--mute)]">
              {k === 0 ? "주사위 없음" : "동행 없음"}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** 위 오른쪽 도구: 채팅 · 소리 · 전체화면 (판 중이면 나가기도) */
export function RoomTools({ room, me, onLeave, inGame, vertical }: { room: RoomWire; me: string; onLeave(): void; inGame?: boolean; vertical?: boolean }) {
  const [chat, setChat] = useState(false);
  const [unread, setUnread] = useState(0);
  const seen = useRef(room.chat.length);
  useEffect(() => {
    if (chat) {
      seen.current = room.chat.length;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 채팅 창을 열면 안 읽은 수를 0으로
      setUnread(0);
    } else setUnread(Math.max(0, room.chat.length - seen.current));
  }, [room.chat.length, chat]);
  const [askLeave, setAskLeave] = useState(false);
  return (
    <div className={`relative flex items-center gap-1.5 ${vertical ? "flex-col" : ""}`}>
      <Btn className="relative h-[34px] w-[38px]" onClick={() => setChat((c) => !c)} title="채팅">
        <Icon n="chat" size={16} />
        {unread > 0 && <span className="absolute -top-2 -right-2 min-w-[16px] bg-[#ff5d5d] px-1 text-[11px] leading-[16px] text-white" style={{ boxShadow: "0 0 0 2px #232a4d" }}>{unread}</span>}
      </Btn>
      <SoundButton side={vertical} />
      <FsButton />
      {inGame && (
        <Btn className="h-[34px] px-2 text-[12px]" onClick={() => setAskLeave(true)}>
          나가기
        </Btn>
      )}
      {chat && <ChatBox room={room} me={me} side={vertical} />}
      {askLeave && (
        <div className={`mb-box absolute z-50 w-[230px] p-3 text-[12px] ${vertical ? "top-[120px] left-[48px]" : "top-[44px] right-0"}`}>
          판 도중에 나가면 그 자리는 AI 가 이어서 하고 <b>진 것으로</b> 쳐요.
          <div className="mt-2 flex justify-end gap-1.5">
            <Btn className="h-[28px] px-3" onClick={() => setAskLeave(false)}>
              계속하기
            </Btn>
            <Btn tone="red" className="h-[28px] px-3" onClick={onLeave}>
              나가기
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}

function ChatBox({ room, me, side }: { room: RoomWire; me: string; side?: boolean }) {
  const [text, setText] = useState("");
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.scrollTo({ top: 1e6 });
  }, [room.chat.length]);
  const can = room.seats.some((s) => s?.uid === me);
  return (
    <div className={`mb-box absolute z-50 flex w-[260px] flex-col ${side ? "top-0 left-[48px]" : "top-[44px] right-0"}`}>
      <div ref={list} className="mb-scroll h-[160px] overflow-y-auto px-2 py-1.5 text-[12px] leading-[16px]">
        {room.chat.map((c, i) => (
          <div key={i} className="break-all">
            <b style={{ color: c.bot ? "#6b4a32" : "#232a4d" }}>{c.name}</b> {c.text}
          </div>
        ))}
        {!room.chat.length && <div className="text-[var(--mute)]">인사해 보세요</div>}
      </div>
      {can && (
        <form
          className="flex gap-1 p-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            const t = text.trim();
            if (!t) return;
            setText("");
            void marble.chat(room.id, t).catch(() => {});
          }}
        >
          <input
            value={text}
            maxLength={60}
            onChange={(e) => setText(e.target.value)}
            className="mb-inset min-w-0 flex-1 px-2 py-1 text-[12px] outline-none"
            placeholder="말하기"
            onKeyDown={(e) => e.stopPropagation()}
          />
          <Btn className="h-[28px] px-2 text-[12px]" type="submit">
            보내기
          </Btn>
        </form>
      )}
    </div>
  );
}

export function FsButton() {
  const st = useStage();
  return (
    <Btn className="h-[34px] w-[38px]" onClick={st.toggleFs} title={st.fs ? "전체화면 끄기" : "전체화면"}>
      <Icon n={st.fs ? "unfull" : "full"} size={15} />
    </Btn>
  );
}

export function SoundButton({ up = false, side = false }: { up?: boolean; side?: boolean }) {
  const [p, setP] = useState(getPrefs);
  useEffect(() => onPrefs(setP), []);
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Btn className="h-[34px] w-[38px]" onClick={() => setOpen((o) => !o)} title="소리">
        <Icon n={p.mute ? "mute" : "speaker"} size={15} />
      </Btn>
      {open && (
        <div className={`mb-box absolute z-50 w-[220px] p-3 text-[12px] ${side ? "top-0 left-[48px]" : up ? "bottom-[44px] left-0" : "top-[44px] right-0"}`} onPointerLeave={() => setOpen(false)}>
          {(["bgm", "sfx"] as const).map((k) => (
            <label key={k} className="mb-2 flex items-center gap-2">
              <span className="w-[44px]">{k === "bgm" ? "배경음" : "효과음"}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={p[k]}
                onChange={(e) => {
                  setPrefs({ [k]: Number(e.target.value), mute: false });
                  if (k === "sfx") sfx("click");
                }}
                className="flex-1 accent-[#c98b4f]"
              />
            </label>
          ))}
          <Btn tone={p.mute ? "red" : "paper"} className="h-[28px] w-full text-[12px]" onClick={() => setPrefs({ mute: !p.mute })}>
            {p.mute ? "소리 켜기" : "모두 끄기"}
          </Btn>
        </div>
      )}
    </div>
  );
}
