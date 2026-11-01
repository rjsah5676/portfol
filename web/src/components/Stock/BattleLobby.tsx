"use client";

import { useEffect, useState } from "react";
import { BATTLE } from "@/lib/stock/battle";
import { BOT_LEVELS, BOT_STYLES, BOT_STYLE_IDS, type BotLevel, type BotStyle } from "@/lib/stock/bots";
import type { BLobbyRow, BRoomWire } from "@/lib/stock/types";
import { addBot, createRoom, joinRoom, kickSeat, quickRoom, roomChat, roomSettings, setBot, startRoom, subscribeLobby } from "@/realtime/stock";
import { Avatar, Btn, C, Empty, NUM, Sheet, TopBar, WalletChip } from "./ui";

/*
 * 트레이딩 홀 로비 (방 목록 · 만들기 · 빠른 입장) 와 대기실 (자리 8칸 · 봇 추가/삭제 · 성격 · 난이도 · 시작).
 */

export function Lobby({
  total,
  onBack,
  onJoined,
  onRecords,
  toast,
}: {
  total: number | null;
  onBack: () => void;
  onJoined: (id: string) => void;
  onRecords: () => void;
  toast: (t: string, tone?: "plain" | "up" | "down" | "warn") => void;
}) {
  const [list, setList] = useState<BLobbyRow[] | null>(null);
  const [make, setMake] = useState(false);
  const [pwFor, setPwFor] = useState<BLobbyRow | null>(null);
  useEffect(() => subscribeLobby(setList), []);
  const join = async (r: BLobbyRow, password?: string) => {
    try {
      const res = await joinRoom(r.id, password);
      onJoined(res.id);
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === "NEED_PASSWORD") setPwFor(r);
      else toast(err.message, "warn");
    }
  };
  const quick = async () => {
    try {
      onJoined((await quickRoom()).id);
    } catch (e) {
      toast((e as Error).message, "warn");
    }
  };
  return (
    <div className="flex h-full flex-col">
      <TopBar
        onBack={onBack}
        title="트레이딩 홀"
        right={
          <>
            <Btn className="h-[28px] px-[10px] text-[12px]" onClick={onRecords}>
              📊 내 전적
            </Btn>
            <WalletChip value={total} label="총자산 (대전 돈과는 따로)" />
          </>
        }
      >
        <span className="text-[11px]" style={{ color: C.mute }}>
          모두 1억 · 종목 10개 · 7분 · 10초마다 시세 변동
        </span>
      </TopBar>
      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1 overflow-y-auto p-[10px]">
          {list === null ? (
            <Empty>방 목록을 불러오는 중…</Empty>
          ) : !list.length ? (
            <Empty>
              열린 방이 없어요.
              <br />
              방을 만들고 봇과 바로 시작해 보세요.
            </Empty>
          ) : (
            <div className="grid grid-cols-2 gap-[8px]">
              {list.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => void join(r)}
                  disabled={r.phase === "play"}
                  className="flex cursor-pointer items-center gap-[8px] rounded-[10px] px-[10px] py-[8px] text-left disabled:cursor-default disabled:opacity-60"
                  style={{ background: C.panel2, border: `1px solid ${C.line}` }}
                >
                  {r.host && <Avatar look={r.host.look} size={34} />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-bold">
                      {r.locked && "🔒 "}
                      {r.title}
                    </div>
                    <div className={`text-[11px] ${NUM}`} style={{ color: C.mute }}>
                      #{r.id} · {r.count}/{r.max}명 (사람 {r.humans})
                    </div>
                  </div>
                  <span className="rounded-full px-[8px] py-[2px] text-[10px] font-bold" style={r.phase === "play" ? { background: C.upBg, color: "#fff" } : { background: C.chip, color: C.gold }}>
                    {r.phase === "play" ? "대전 중" : "대기"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex w-[230px] flex-col gap-[8px] p-[12px]" style={{ background: C.panel, borderLeft: `1px solid ${C.line}` }}>
          <Btn tone="gold" className="h-[52px] text-[15px]" onClick={() => void quick()}>
            ⚡ 빠른 입장
          </Btn>
          <Btn className="h-[46px] text-[14px]" onClick={() => setMake(true)}>
            ＋ 방 만들기
          </Btn>
          <div className="mt-[6px] text-[11px] leading-relaxed" style={{ color: C.mute }}>
            <b style={{ color: C.text }}>규칙</b>
            <br />· 처음 30초는 사 두는 시간
            <br />· 그 뒤 10초마다 전 종목 시세가 바뀜
            <br />· 1주 살 때마다 +1%, 팔 때마다 −1% (내 주문이 시세를 움직임)
            <br />· 끝나면 들고 있는 주식을 그 시세로 판 돈까지 합쳐 1등
          </div>
        </div>
      </div>
      {make && <MakeRoom onClose={() => setMake(false)} onMade={onJoined} toast={toast} />}
      {pwFor && <PwSheet onClose={() => setPwFor(null)} onSubmit={(pw) => (setPwFor(null), void join(pwFor, pw))} />}
    </div>
  );
}

function MakeRoom({ onClose, onMade, toast }: { onClose: () => void; onMade: (id: string) => void; toast: (t: string, tone?: "warn") => void }) {
  const [title, setTitle] = useState("");
  const [max, setMax] = useState(6);
  const [bots, setBots] = useState(3);
  const [level, setLevel] = useState<BotLevel>(1);
  const [pw, setPw] = useState("");
  const [pub, setPub] = useState(true);
  const go = async () => {
    try {
      const r = await createRoom({ title, max, bots: Math.min(bots, max - 1), level, password: pw, pub });
      onMade(r.id);
    } catch (e) {
      toast((e as Error).message, "warn");
    }
  };
  return (
    <Sheet title="방 만들기" onClose={onClose} width={440}>
      <div className="flex flex-col gap-[10px] p-[14px] text-[12px]">
        <label className="flex items-center gap-[8px]">
          <span className="w-[70px]" style={{ color: C.mute }}>
            방 이름
          </span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={20} placeholder="비우면 「내 이름의 방」" className="h-[32px] flex-1 rounded-[8px] px-[8px] outline-none" style={{ background: C.bg, border: `1px solid ${C.line}`, color: C.text }} />
        </label>
        <Choice label="인원" value={max} options={[2, 3, 4, 5, 6, 7, 8].map((n) => [n, `${n}`])} onChange={(n) => (setMax(n), setBots((b) => Math.min(b, n - 1)))} />
        <Choice label="봇" value={bots} options={Array.from({ length: max }, (_, i) => [i, `${i}`])} onChange={setBots} />
        <Choice label="봇 난이도" value={level} options={([0, 1, 2] as BotLevel[]).map((l) => [l, BOT_LEVELS[l].name])} onChange={(l) => setLevel(l as BotLevel)} />
        <Choice label="공개" value={pub ? 1 : 0} options={[[1, "공개"], [0, "비공개"]]} onChange={(v) => setPub(!!v)} />
        <label className="flex items-center gap-[8px]">
          <span className="w-[70px]" style={{ color: C.mute }}>
            비밀번호
          </span>
          <input value={pw} onChange={(e) => setPw(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" placeholder="숫자 4자리 (선택)" className="h-[32px] w-[140px] rounded-[8px] px-[8px] outline-none" style={{ background: C.bg, border: `1px solid ${C.line}`, color: C.text }} />
        </label>
        <Btn tone="gold" className="mt-[4px] h-[44px] text-[14px]" onClick={() => void go()}>
          만들기
        </Btn>
      </div>
    </Sheet>
  );
}

function Choice<T extends number>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="flex items-center gap-[8px]">
      <span className="w-[70px] shrink-0" style={{ color: C.mute }}>
        {label}
      </span>
      <div className="flex flex-wrap gap-[4px]">
        {options.map(([v, t]) => (
          <Btn key={v} active={v === value} className="h-[30px] min-w-[34px] px-[8px] text-[12px]" onClick={() => onChange(v)}>
            {t}
          </Btn>
        ))}
      </div>
    </div>
  );
}

function PwSheet({ onClose, onSubmit }: { onClose: () => void; onSubmit: (pw: string) => void }) {
  const [pw, setPw] = useState("");
  return (
    <Sheet title="비밀번호" onClose={onClose} width={300}>
      <div className="flex gap-[8px] p-[14px]">
        <input autoFocus value={pw} onChange={(e) => setPw(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" className="h-[40px] flex-1 rounded-[8px] px-[10px] text-[16px] outline-none" style={{ background: C.bg, border: `1px solid ${C.line}`, color: C.text }} />
        <Btn tone="gold" className="h-[40px] px-[14px]" onClick={() => onSubmit(pw)}>
          입장
        </Btn>
      </div>
    </Sheet>
  );
}

// ───────────── 대기실 ─────────────

export function Room({
  room,
  myUid,
  onLeave,
  onLastResult,
  toast,
}: {
  room: BRoomWire;
  myUid: string;
  onLeave: () => void;
  onLastResult: (() => void) | null;
  toast: (t: string, tone?: "warn") => void;
}) {
  const host = room.hostUid === myUid;
  const [edit, setEdit] = useState<number | null>(null);
  const [chat, setChat] = useState("");
  const [addStyle, setAddStyle] = useState<BotStyle | "random">("random");
  const [addLevel, setAddLevel] = useState<BotLevel>(1);
  const safe = (p: Promise<unknown>) => void p.catch((e) => toast((e as Error).message, "warn"));
  const filled = room.seats.filter(Boolean).length;
  const editing = edit !== null ? room.seats[edit] : null;
  return (
    <div className="flex h-full flex-col">
      <TopBar
        onBack={onLeave}
        title={
          <>
            {room.locked && "🔒"} {room.title} <span className={`text-[12px] font-medium ${NUM}`} style={{ color: C.mute }}>#{room.id}</span>
          </>
        }
        right={
          <>
            {onLastResult && (
              <Btn className="h-[28px] px-[10px] text-[12px]" onClick={onLastResult}>
                지난 판 결과
              </Btn>
            )}
            {host && (
              <Btn className="h-[28px] px-[10px] text-[12px]" onClick={() => safe(roomSettings(room.id, { pub: !room.pub }))}>
                {room.pub ? "공개" : "비공개"}
              </Btn>
            )}
          </>
        }
      >
        <span className={`text-[12px] ${NUM}`} style={{ color: C.mute }}>
          {filled}/{room.max}명
        </span>
      </TopBar>
      <div className="flex min-h-0 flex-1">
        <div className="grid flex-1 grid-cols-4 grid-rows-2 gap-[8px] p-[10px]">
          {room.seats.map((s, i) => (
            <div key={i} className="relative flex flex-col items-center justify-center gap-[4px] rounded-[12px] p-[6px] text-center" style={{ background: s ? C.panel2 : "transparent", border: `1px ${s ? "solid" : "dashed"} ${s?.uid === room.hostUid ? C.gold : C.line}` }}>
              {s ? (
                <>
                  <Avatar look={s.look} size={48} ring={s.uid === myUid ? C.gold : undefined} />
                  <div className="max-w-full truncate text-[12px] font-bold">
                    {s.uid === room.hostUid && "👑 "}
                    {s.nick}
                  </div>
                  <div className="text-[10px]" style={{ color: s.bot ? C.gold : C.mute }}>
                    {s.bot ? `봇 · ${BOT_STYLES[s.bot.style].name} · ${BOT_LEVELS[s.bot.level].name}` : s.away ? "연결 끊김" : s.uid === myUid ? "나" : "참가자"}
                  </div>
                  {host && s.uid !== myUid && (
                    <div className="flex gap-[4px]">
                      {s.bot && (
                        <Btn className="h-[22px] px-[6px] text-[10px]" onClick={() => setEdit(i)}>
                          바꾸기
                        </Btn>
                      )}
                      <Btn tone="ghost" className="h-[22px] px-[6px] text-[10px]" onClick={() => safe(kickSeat(room.id, i))}>
                        {s.bot ? "빼기" : "내보내기"}
                      </Btn>
                    </div>
                  )}
                </>
              ) : host ? (
                <Btn tone="ghost" className="h-[30px] px-[10px] text-[11px]" onClick={() => safe(addBot(room.id, addStyle, addLevel))}>
                  ＋ 봇
                </Btn>
              ) : (
                <span className="text-[11px]" style={{ color: C.mute }}>
                  빈 자리
                </span>
              )}
            </div>
          ))}
        </div>
        <div className="flex w-[240px] flex-col gap-[8px] p-[10px]" style={{ background: C.panel, borderLeft: `1px solid ${C.line}` }}>
          {host ? (
            <>
              <div className="text-[11px]" style={{ color: C.mute }}>
                새 봇: 성격 · 난이도
              </div>
              <div className="flex flex-wrap gap-[4px]">
                {(["random", ...BOT_STYLE_IDS] as const).map((st) => (
                  <Btn key={st} active={addStyle === st} className="h-[26px] px-[7px] text-[11px]" onClick={() => setAddStyle(st)} title={st === "random" ? "아무 성격" : BOT_STYLES[st].blurb}>
                    {st === "random" ? "랜덤" : BOT_STYLES[st].name}
                  </Btn>
                ))}
              </div>
              <div className="flex gap-[4px]">
                {([0, 1, 2] as BotLevel[]).map((l) => (
                  <Btn key={l} active={addLevel === l} className="h-[26px] flex-1 text-[11px]" onClick={() => setAddLevel(l)}>
                    {BOT_LEVELS[l].name}
                  </Btn>
                ))}
              </div>
              <Btn className="h-[34px] text-[12px]" disabled={filled >= room.max} onClick={() => safe(addBot(room.id, addStyle, addLevel))}>
                ＋ 봇 앉히기
              </Btn>
              <Btn tone="gold" className="h-[48px] text-[15px]" disabled={filled < BATTLE.minPlayers} onClick={() => safe(startRoom(room.id))}>
                ▶ 시작 ({filled}명)
              </Btn>
            </>
          ) : (
            <div className="rounded-[10px] p-[10px] text-center text-[12px]" style={{ background: C.panel2, color: C.mute }}>
              방장이 시작하길 기다리는 중…
            </div>
          )}
          {/* 채팅 */}
          <div className="flex min-h-0 flex-1 flex-col justify-end gap-[2px] overflow-hidden rounded-[8px] p-[6px] text-[11px]" style={{ background: C.bg }}>
            {room.chat.slice(-8).map((m, k) => (
              <div key={k} className="leading-snug" style={{ color: m.sys ? C.mute : C.text }}>
                {!m.sys && <b style={{ color: C.gold }}>{m.nick} </b>}
                {m.text}
              </div>
            ))}
          </div>
          <form
            className="flex gap-[4px]"
            onSubmit={(e) => {
              e.preventDefault();
              const t = chat.trim();
              if (!t) return;
              setChat("");
              safe(roomChat(room.id, t));
            }}
          >
            <input value={chat} onChange={(e) => setChat(e.target.value)} maxLength={60} placeholder="채팅" className="h-[30px] min-w-0 flex-1 rounded-[6px] px-[6px] text-[12px] outline-none" style={{ background: C.bg, border: `1px solid ${C.line}`, color: C.text }} />
            <Btn className="h-[30px] px-[8px] text-[11px]" type="submit">
              보내기
            </Btn>
          </form>
        </div>
      </div>
      {editing?.bot && edit !== null && (
        <Sheet title={`${editing.nick} 바꾸기`} onClose={() => setEdit(null)} width={360}>
          <div className="flex flex-col gap-[8px] p-[14px]">
            {BOT_STYLE_IDS.map((st) => (
              <Btn key={st} active={editing.bot!.style === st} className="h-[40px] justify-start px-[10px] text-left text-[12px]" onClick={() => safe(setBot(room.id, edit, { style: st }))}>
                <b>{BOT_STYLES[st].name}</b>
                <span className="ml-[6px] text-[11px] font-normal" style={{ color: C.mute }}>
                  {BOT_STYLES[st].blurb}
                </span>
              </Btn>
            ))}
            <div className="flex gap-[4px]">
              {([0, 1, 2] as BotLevel[]).map((l) => (
                <Btn key={l} active={editing.bot!.level === l} className="h-[34px] flex-1 text-[12px]" onClick={() => safe(setBot(room.id, edit, { level: l }))}>
                  {BOT_LEVELS[l].name}
                </Btn>
              ))}
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}
