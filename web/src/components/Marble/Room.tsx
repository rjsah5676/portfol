"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { CHAR, GRADE_COLOR, ITEM, power, type Loadout } from "@/lib/marble/data";
import { MAPS, MAP_IDS, type MapId } from "@/lib/marble/maps";
import type { RoomWire } from "@/lib/marble/wire";
import { marble } from "@/realtime/marble";
import { serverNow } from "@/lib/api/socket";
import { getPrefs, onPrefs, setPrefs, sfx } from "./audio";
import { CURSOR_IDS, applyCursor, cursorName, cursorPreview, getCursor, setCursor } from "./cursor";
import { Btn, GradeTag, Icon, PCOLOR, Stars } from "./pixel";
import { useStage } from "./Stage";
import { CharHero, ItemBadge, XBtn, XChip, XGrade, XPanel } from "./ui";

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
  const kicked = !!room.kicked?.includes(me);
  const leave = useRef(onLeave);
  useEffect(() => {
    leave.current = onLeave;
  }, [onLeave]);
  useEffect(() => {
    if (!kicked) return;
    alert("방장이 방에서 내보냈어요.");
    leave.current();
  }, [kicked]);
  const count = room.startAt ? Math.max(0, Math.ceil((room.startAt - serverNow()) / 1000)) : 0;
  const opt = (o: Parameters<typeof marble.opts>[1]) => void marble.opts(room.id, o).catch((e) => alert((e as Error).message));
  const seats = room.seats.length <= 2 ? "grid-cols-2" : "grid-cols-2";
  return (
    <div className="mbx absolute inset-0 overflow-hidden" style={{ background: "#120d33" }}>
      {/* 배경: 고른 맵 그림을 흐리게 */}
      <img src={`/marble/bg/${room.map}.webp`} alt="" className="absolute inset-0 h-full w-full scale-105 object-cover opacity-60 blur-[3px]" />
      <div className="absolute inset-0 bg-gradient-to-b from-[#120d33cc] via-[#120d3388] to-[#120d33ee]" />

      {/* 위 막대 */}
      <div className="absolute inset-x-0 top-0 z-[40] flex h-[52px] items-center gap-2 border-b border-white/10 bg-black/25 px-4 backdrop-blur">
        <XBtn className="h-[34px] px-3 text-[13px]" onClick={onLeave}>
          ‹ 나가기
        </XBtn>
        <b className="ml-1 truncate text-[17px]">{room.name}</b>
        {room.locked && <XChip color="#ffffff22">🔒 비밀방</XChip>}
        <XChip color="#ffd65a" text="#3a2500">
          {m.name}
        </XChip>
        <XChip>{room.max === 2 ? "1:1" : `${room.max}인`}</XChip>
        <div className="ml-auto">
          <RoomTools room={room} me={me} onLeave={onLeave} glass />
        </div>
      </div>

      {/* 자리 */}
      <div className={`absolute top-[64px] left-[14px] grid w-[632px] ${seats} gap-3`}>
        {room.seats.map((s, i) => {
          const c = s ? CHAR[s.lo.char.id] : null;
          const isMe = s?.uid === me;
          const hi = c && (c.grade === "SSR" || c.grade === "UR");
          return (
            <div
              key={i}
              className={`mbx-panel relative flex h-[238px] overflow-hidden ${isMe ? "ring-[3px] ring-[#ffd65a]" : ""}`}
              style={hi ? { boxShadow: `0 0 0 2px ${c!.grade === "UR" ? "#ff9ad5" : "#ffd257"}, 0 0 24px ${c!.grade === "UR" ? "rgba(255,140,220,0.55)" : "rgba(255,196,60,0.5)"}` } : undefined}
            >
              {s && c ? (
                <>
                  <CharHero id={c.id} className="h-full w-[132px] shrink-0">
                    <span className="absolute top-2 left-2 h-[12px] w-[22px] rounded-sm ring-2 ring-white/80" style={{ background: PCOLOR[i] }} />
                  </CharHero>
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3 text-[12px]">
                    <div className="flex items-center gap-1.5">
                      {isMe && <XChip color="#ff5f8f">나</XChip>}
                      {s.bot && <XChip color="#ffffff22">AI</XChip>}
                      {room.owner && s.uid === room.owner && <span title="방장">👑</span>}
                      <b className="truncate text-[16px]">{s.name}</b>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <XGrade g={c.grade} />
                      <span className="truncate text-white/85">{c.title}</span>
                      <Stars lv={s.lo.char.lv} size={9} />
                    </div>
                    <p className="line-clamp-3 leading-[16px] text-white/75">
                      <b className="text-[#ffe08a]">{c.passive.name}</b> {c.passive.desc(power(c.grade, s.lo.char.lv))}
                    </p>
                    <div className="flex items-center gap-1.5">
                      <ItemBadge slot="dice" item={s.lo.dice ?? null} size={34} />
                      <ItemBadge slot="buddy" item={s.lo.buddy ?? null} size={34} />
                    </div>
                    <div className="mt-auto flex items-center gap-1.5">
                      {s.ready ? (
                        <XChip color="#2fc3a0">✓ 준비</XChip>
                      ) : (
                        <XChip color="#ffffff22" text="#ffffffcc">
                          기다리는 중
                        </XChip>
                      )}
                      {owner && !isMe && (
                        <XBtn tone="dark" className="ml-auto h-[24px] px-2 text-[11px] text-[#ff9aa8]" onClick={() => (s.bot || confirm(`${s.name} 님을 강퇴할까요?`)) && opt({ kick: i })}>
                          강퇴
                        </XBtn>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 text-[13px] text-white/60">
                  <span className="text-[34px] opacity-40">+</span>
                  빈 자리
                  {owner && room.bots && (
                    <XBtn tone="mint" className="h-[32px] px-3 text-[12px]" onClick={() => opt({ addBot: true })}>
                      AI 넣기
                    </XBtn>
                  )}
                  {!room.bots && <span className="text-[11px]">AI 입장 꺼짐</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 방 설정 · 시작 */}
      <div className="absolute top-[64px] right-[14px] flex w-[350px] flex-col gap-3">
        <XPanel title="방 설정" right={!owner && <span className="text-[11px] text-white/55">방장만 바꿀 수 있어요</span>}>
          <div className="flex flex-col gap-2.5 p-3 text-[13px]">
            <div className="relative h-[150px] overflow-hidden rounded-xl ring-1 ring-white/15">
              <img src={`/marble/bg/map-${room.map}.webp`} alt={`${m.name} 미리보기`} className="h-full w-full object-cover" />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2.5 pt-6 pb-1.5">
                <b className="text-[14px]">{m.name}</b>
                <p className="text-[10px] leading-[13px] text-white/80">{m.desc}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {MAP_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  disabled={!owner}
                  onClick={() => opt({ map: id })}
                  className={`relative h-[46px] overflow-hidden rounded-lg text-[11px] font-bold disabled:cursor-default ${room.map === id ? "ring-2 ring-[#ffd65a]" : "opacity-75 ring-1 ring-white/15 hover:opacity-100"}`}
                  title={MAPS[id].desc}
                >
                  <img src={`/marble/bg/map-${id}.webp`} alt="" className="absolute inset-0 h-full w-full object-cover" />
                  <span className="absolute inset-x-0 bottom-0 bg-black/60 py-[1px]">{MAPS[id].name}</span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-[44px] text-white/70">인원</span>
              {[2, 3, 4].map((n) => (
                <XBtn key={n} tone={room.max === n ? "gold" : "glass"} className="h-[30px] w-[42px] text-[13px]" disabled={!owner} onClick={() => opt({ max: n })}>
                  {n}
                </XBtn>
              ))}
            </div>
            <Toggle label="바로 입장 허용" on={room.quick} disabled={!owner} onChange={(v) => opt({ quick: v })} hint="끄면 링크 · 목록으로만 들어와요 (친구 방)" />
            <Toggle label="AI 입장 허용" on={room.bots} disabled={!owner || !room.quick} onChange={(v) => opt({ bots: v })} hint="바로 입장을 허용한 방에만 AI 가 들어와요" />
          </div>
        </XPanel>
        {room.startAt ? (
          <div className="mbx-panel py-3 text-center">
            <b className="text-[22px] text-[#ffd65a]">{count}초 뒤 시작!</b>
          </div>
        ) : (
          <p className="text-center text-[12px] text-white/60">{room.seats.filter(Boolean).length < 2 ? "두 명 이상이면 시작해요" : "모두 준비하면 3초 뒤 시작"}</p>
        )}
        {mine && (
          <XBtn
            tone={mine.ready ? "glass" : "gold"}
            className="h-[56px] text-[20px]"
            onClick={() => {
              sfx("ready");
              void marble.ready(room.id, !mine.ready);
            }}
            silent
          >
            {mine.ready ? "준비 취소" : "준비!"}
          </XBtn>
        )}
      </div>
    </div>
  );
}

function Toggle({ label, on, disabled, onChange, hint }: { label: string; on: boolean; disabled?: boolean; onChange(v: boolean): void; hint?: string }) {
  return (
    <button type="button" disabled={disabled} onClick={() => onChange(!on)} className="flex items-center gap-2 text-left disabled:opacity-60" title={hint}>
      <span className={`relative h-[20px] w-[36px] shrink-0 rounded-full transition ${on ? "bg-[#2fc3a0]" : "bg-white/20"}`}>
        <span className="absolute top-[2px] h-[16px] w-[16px] rounded-full bg-white shadow transition-all" style={{ left: on ? 18 : 2 }} />
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
export function RoomTools({ room, me, onLeave, inGame, vertical, glass = false }: { room: RoomWire; me: string; onLeave(): void; inGame?: boolean; vertical?: boolean; glass?: boolean }) {
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
      <Btn className={glass ? "relative h-[34px] w-[38px] !rounded-xl !border !border-white/15 !bg-white/10 !shadow-none hover:!bg-white/20 mbx-iconwhite" : "relative h-[34px] w-[38px]"} onClick={() => setChat((c) => !c)} title="채팅">
        <Icon n="chat" size={16} />
        {unread > 0 && <span className="absolute top-[1px] right-[1px] z-10 min-w-[16px] bg-[#ff5d5d] px-1 text-[11px] leading-[16px] text-white" style={{ boxShadow: "0 0 0 2px #232a4d" }}>{unread}</span>}
      </Btn>
      <SoundButton side={vertical} glass={glass} />
      <FsButton glass={glass} />
      {inGame && (
        <Btn className="h-[34px] px-2 text-[12px]" onClick={() => setAskLeave(true)}>
          나가기
        </Btn>
      )}
      {chat && <ChatBox room={room} me={me} side={vertical} />}
      {askLeave && (
        <div className={`mbx-modal absolute z-50 w-[230px] p-3 text-[12px] ${vertical ? "top-[120px] left-[48px]" : "top-[44px] right-0"}`}>
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
    <div className={`mbx absolute z-50 flex w-[270px] flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#1b1650]/95 text-white shadow-[0_12px_30px_rgba(0,0,0,0.5)] backdrop-blur ${side ? "top-0 left-[48px]" : "top-[44px] right-0"}`}>
      <div ref={list} className="h-[170px] overflow-y-auto px-3 py-2 text-[12.5px] leading-[18px]">
        {room.chat.map((c, i) => (
          <div key={i} className="break-all text-white/90">
            <b style={{ color: c.bot ? "#9fb3d8" : "#ffd65a" }}>{c.name}</b> {c.text}
          </div>
        ))}
        {!room.chat.length && <div className="text-white/45">인사해 보세요</div>}
      </div>
      {can && (
        <form
          className="flex gap-1.5 border-t border-white/10 p-2"
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
            className="mbx-input min-w-0 flex-1 !h-[32px] text-[12.5px]"
            placeholder="말하기"
            onKeyDown={(e) => e.stopPropagation()}
          />
          <button type="submit" className="h-[32px] rounded-lg bg-gradient-to-b from-[#ffe27a] to-[#f5a524] px-3 text-[12.5px] font-bold text-[#3a2500]">
            보내기
          </button>
        </form>
      )}
    </div>
  );
}

export function FsButton({ glass = false }: { glass?: boolean }) {
  const st = useStage();
  return (
    <Btn className={glass ? "h-[34px] w-[38px] !rounded-xl !border !border-white/15 !bg-white/10 !shadow-none hover:!bg-white/20 mbx-iconwhite" : "h-[34px] w-[38px]"} onClick={st.toggleFs} title={st.fs ? "전체화면 끄기" : "전체화면"}>
      <Icon n={st.fs ? "unfull" : "full"} size={15} />
    </Btn>
  );
}

export function SoundButton({ up = false, side = false, glass = false }: { up?: boolean; side?: boolean; glass?: boolean }) {
  const [p, setP] = useState(getPrefs);
  useEffect(() => onPrefs(setP), []);
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState("");
  useEffect(() => {
    const c = getCursor();
    applyCursor(c);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 저장된 커서를 처음 한 번 읽기
    setCur(c);
  }, []);
  return (
    <div className="relative">
      <Btn className={glass ? "h-[34px] w-[38px] !rounded-xl !border !border-white/15 !bg-white/10 !shadow-none hover:!bg-white/20 mbx-iconwhite" : "h-[34px] w-[38px]"} onClick={() => setOpen((o) => !o)} title="설정 (소리 · 커서)">
        {/* 매끈한 톱니바퀴 */}
        <svg viewBox="0 0 24 24" width={19} height={19} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </Btn>
      {open && (
        <div className={`mbx-modal absolute z-50 w-[230px] rounded-2xl p-3 text-[12px] text-white ${side ? "top-0 left-[48px]" : up ? "bottom-[44px] left-0" : "top-[44px] right-0"}`} style={{ background: "linear-gradient(180deg, rgba(48,40,122,0.98), rgba(24,19,68,0.98))", boxShadow: "0 0 0 1.5px rgba(255,255,255,0.2), 0 0 0 4px rgba(255,210,90,0.22), 0 18px 44px rgba(0,0,0,0.5)" }} onPointerLeave={() => setOpen(false)}>
          <div className="mb-2 text-[13px] font-black text-[#ffe08a]">설정</div>
          {(["bgm", "sfx"] as const).map((k) => (
            <label key={k} className="mb-2 flex items-center gap-2">
              <span className="w-[44px] font-bold text-white/90">{k === "bgm" ? "배경음" : "효과음"}</span>
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
          <div className="mt-3 mb-1 font-bold text-white/90">커서</div>
          <div className="grid grid-cols-5 gap-1">
            {CURSOR_IDS.map((id) => (
              <button
                key={id || "def"}
                type="button"
                title={cursorName(id)}
                onClick={() => {
                  setCursor(id);
                  setCur(id);
                  sfx("click");
                }}
                className="flex h-[34px] items-center justify-center rounded-md bg-white text-[#232a4d]"
                style={{ boxShadow: cur === id ? "0 0 0 2px #232a4d, inset 0 0 0 2px #ffd84d" : "0 0 0 1px #9fb3c8" }}
              >
                {id !== "system" ? <img src={cursorPreview(id)} alt="" width={24} height={24} /> : <span className="text-[10px]">기본</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
