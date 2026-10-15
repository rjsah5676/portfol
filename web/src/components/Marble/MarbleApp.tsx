"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import NickForm from "@/components/Account/NickForm";
import { useAuth } from "@/lib/AuthContext";
import { CHAR, ITEM } from "@/lib/marble/data";
import { MAPS, MAP_IDS, type MapId } from "@/lib/marble/maps";
import type { LobbyRoom, ProfileWire, RoomWire } from "@/lib/marble/wire";
import { marble, watchLobby, watchRoom } from "@/realtime/marble";
import { playBgm, sfx } from "./audio";
import Bag, { Shop } from "./Bag";
import Gacha, { ItemIcon } from "./Gacha";
import GameView from "./GameView";
import { Btn, Cur, GradeTag, Icon, Stars, Win } from "./pixel";
import { FsButton, LoadoutLine, MAP_ART, SoundButton, WaitRoom } from "./Room";
import Stage from "./Stage";
import Token from "./Token";

/*
 * PIXEL MARBLE 몸통 — 무대(Stage) 안에서 메뉴 → 바로 시작 / 방 목록 → 대기실 → 판, 뽑기 · 가방 · 상점.
 * 회원 전용 (판 · 성장은 서버에). 처음엔 캐릭터 · 아이템 10연차 티켓을 한 장씩 받음.
 */

type Screen = { k: "menu" } | { k: "lobby" } | { k: "room"; id: string } | { k: "gacha" } | { k: "bag" } | { k: "shop" };

export default function MarbleApp() {
  return (
    <Stage>
      <App />
    </Stage>
  );
}

function App() {
  const { loading, account, profile, login } = useAuth();
  const member = !!profile;
  const me = account?.uid ?? "";
  const [screen, setScreen] = useState<Screen>({ k: "menu" });
  const [prof, setProf] = useState<ProfileWire | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 로그아웃하면 프로필을 비움
    if (!member) return setProf(null);
    void marble.profile().then(setProf, (e) => setNote((e as Error).message));
  }, [member]);
  // 새로고침 뒤: 진행 중인 판이 있으면 바로 그 방으로
  useEffect(() => {
    if (!member) return;
    void marble.mine().then((r) => r && setScreen({ k: "room", id: r.id }), () => {});
  }, [member]);
  useEffect(() => {
    if (screen.k === "menu" || screen.k === "lobby" || screen.k === "bag" || screen.k === "shop") playBgm("lobby");
  }, [screen.k]);
  const reload = () => void marble.profile().then(setProf, () => {});

  const go = async (f: () => Promise<{ id: string }>) => {
    setNote("");
    try {
      const { id } = await f();
      sfx("join");
      setScreen({ k: "room", id });
    } catch (e) {
      sfx("deny");
      const err = e as Error & { code?: string };
      setNote(err.message);
      if (err.code === "NO_CHAR") setScreen({ k: "gacha" });
    }
  };

  if (screen.k === "room")
    return (
      <RoomScreen
        id={screen.id}
        me={me}
        onLeave={() => {
          void marble.leave(screen.id).catch(() => {});
          setScreen({ k: "menu" });
          reload();
        }}
        onGone={() => {
          setScreen({ k: "menu" });
          reload();
        }}
      />
    );
  if (screen.k === "gacha" && prof) return <Gacha prof={prof} onProf={setProf} onBack={() => setScreen({ k: "menu" })} />;
  if (screen.k === "bag" && prof) return <Bag prof={prof} onProf={setProf} onBack={() => setScreen({ k: "menu" })} />;
  if (screen.k === "shop" && prof) return <Shop prof={prof} onProf={setProf} onBack={() => setScreen({ k: "menu" })} />;
  if (screen.k === "lobby") return <Lobby me={me} onBack={() => setScreen({ k: "menu" })} onGo={go} />;
  return (
    <Menu
      loading={loading}
      member={member}
      account={!!account}
      nick={profile?.nick ?? null}
      prof={prof}
      note={note}
      onLogin={login}
      onQuick={(map) => void go(() => marble.quick(map ? { map, max: 2 } : { max: 2 }))}
      onLobby={() => setScreen({ k: "lobby" })}
      onGacha={() => setScreen({ k: "gacha" })}
      onBag={() => setScreen({ k: "bag" })}
      onShop={() => setScreen({ k: "shop" })}
    />
  );
}

/* ───────────── 메뉴 ───────────── */

function Menu(p: {
  loading: boolean;
  member: boolean;
  account: boolean;
  nick: string | null;
  prof: ProfileWire | null;
  note: string;
  onLogin(): void;
  onQuick(map?: MapId): void;
  onLobby(): void;
  onGacha(): void;
  onBag(): void;
  onShop(): void;
}) {
  const pr = p.prof;
  const [map, setMap] = useState<MapId | undefined>(undefined);
  const charId = pr?.load.char ?? null;
  const c = charId ? CHAR[charId] : null;
  const hasChar = !!pr && Object.keys(pr.chars).length > 0;
  const tickets = pr ? pr.tickets.char + pr.tickets.item : 0;
  return (
    <div className="mb-sky absolute inset-0 overflow-hidden">
      {/* 언덕 · 길 */}
      <div className="absolute right-[-60px] bottom-[-80px] h-[300px] w-[620px] bg-[#7fcf6a]" style={{ clipPath: "ellipse(50% 50% at 50% 60%)", boxShadow: "inset 0 6px 0 0 #a3e08e" }} />
      <div className="absolute bottom-0 left-0 h-[70px] w-full bg-[repeating-linear-gradient(90deg,#e8c98a_0_40px,#e0bd78_40px_80px)]" style={{ boxShadow: "0 -4px 0 0 #232a4d" }} />

      {/* 제목 */}
      <div className="absolute top-[34px] left-[56px]">
        <p className="mb-out text-[13px] font-bold tracking-[0.4em] text-white">PIXEL FIGHT 외전</p>
        <h1 className="mb-title mb-out mt-1 text-[64px] leading-[1] text-white" style={{ color: "#ffc94a" }}>
          PIXEL
          <br />
          MARBLE
        </h1>
        <p className="mb-box mt-3 max-w-[400px] px-3 py-2 text-[13px] leading-[19px]">주사위를 굴려 픽셀 동네를 돌며 땅을 사고, 짓고, 인수해요. 캐릭터 스킬 · 장착 아이템으로 판을 뒤집는 보드게임!</p>
      </div>

      {/* 내 캐릭터 */}
      <div className="absolute right-[90px] bottom-[86px] flex flex-col items-center">
        {c ? (
          <>
            <div className="mb-bob">
              <Token sprite={c.sprite} h={170} anim="idle" face={-1} />
            </div>
            <div className="mb-box mt-3 flex items-center gap-1.5 px-3 py-1 text-[13px]">
              <GradeTag g={c.grade} />
              <b>{c.title}</b>
              <Stars lv={pr!.chars[c.id]?.lv ?? 0} size={10} />
            </div>
            <div className="mt-2 flex gap-2">
              {(["dice", "buddy"] as const).map((s) => {
                const id = pr!.load[s];
                return id && ITEM[id] ? <ItemIcon key={s} id={id} size={40} /> : <div key={s} className="mb-inset flex h-[40px] w-[40px] items-center justify-center text-[10px] text-[var(--mute)]">{s === "dice" ? "주사위" : "동행"}</div>;
              })}
            </div>
          </>
        ) : (
          <div className="flex items-end gap-1 opacity-90">
            {["kai", "igna", "lily", "ivan"].map((s, i) => (
              <div key={s} className="mb-bob" style={{ animationDelay: `${i * 0.25}s` }}>
                <Token sprite={s} h={110} face={-1} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 재화 */}
      {pr && (
        <div className="mb-box absolute top-[16px] right-[16px] z-30 flex items-center gap-3 px-3 py-1.5 text-[13px]">
          <span title="별사탕 — 뽑기"><Cur k="star" n={pr.stars} /></span>
          <span title="부품 — 아이템 강화"><Cur k="parts" n={pr.parts} /></span>
          <span title="GP — 사이트 포인트"><Cur k="gp" n={pr.gp} /></span>
          <span className="text-[12px] text-[var(--mute)]">
            {pr.wins}승 / {pr.games}판
          </span>
        </div>
      )}

      {/* 버튼 */}
      <div className="absolute top-[262px] left-[56px] flex w-[380px] flex-col gap-3">
        {p.member && pr && !hasChar ? (
          <Btn tone="pink" className="mb-glow h-[64px] text-[20px] font-bold" style={{ "--g": "#ff7fa8" } as CSSProperties} onClick={p.onGacha}>
            <Icon n="ticket" size={20} /> 첫 캐릭터 뽑기 (무료 티켓)
          </Btn>
        ) : (
          <Btn tone="gold" className="h-[64px] flex-col gap-0 text-[22px] font-bold" disabled={!p.member} onClick={() => p.onQuick(map)}>
            <span className="mb-title">바로 시작</span>
            <span className="text-[12px] font-normal">1:1 · 사람이 없으면 AI 가 와요</span>
          </Btn>
        )}
        <div className="flex gap-1.5">
          <Btn tone={!map ? "mint" : "paper"} className="h-[30px] px-2 text-[12px]" onClick={() => setMap(undefined)} disabled={!p.member}>
            아무 맵
          </Btn>
          {MAP_IDS.map((id) => (
            <Btn key={id} tone={map === id ? "mint" : "paper"} className="h-[30px] flex-1 px-1 text-[12px]" onClick={() => setMap(id)} disabled={!p.member} title={MAPS[id].desc}>
              <Icon n={MAP_ART[id].icon} size={12} /> {MAPS[id].name}
            </Btn>
          ))}
        </div>
        <div className="grid grid-cols-4 gap-2">
          <Btn tone="sky" className="h-[48px] px-1 text-[14px] font-bold" disabled={!p.member} onClick={p.onLobby}>
            방 목록
          </Btn>
          <Btn tone="pink" className="relative h-[48px] px-1 text-[14px] font-bold" disabled={!p.member || !pr} onClick={p.onGacha}>
            뽑기
            {tickets > 0 && <span className="mb-blink absolute -top-2 -right-2 min-w-[18px] bg-[#ff5d5d] px-1 text-[11px] leading-[18px] text-white" style={{ boxShadow: "0 0 0 2px #232a4d" }}>{tickets}</span>}
          </Btn>
          <Btn className="h-[48px] px-1 text-[14px] font-bold" disabled={!p.member || !pr} onClick={p.onBag}>
            가방
          </Btn>
          <Btn tone="wood" className="h-[48px] px-1 text-[14px] font-bold" disabled={!p.member || !pr} onClick={p.onShop}>
            상점
          </Btn>
        </div>
        <div className="mb-box px-3 py-2 text-[12px]">
          {p.loading ? (
            <span className="mb-blink">로그인 확인 중…</span>
          ) : p.member ? (
            <>
              <b>{p.nick}</b> 님 · {pr?.winToday ? "오늘 첫 승 보너스 받음" : "오늘 첫 승리하면 별사탕 +100"}
            </>
          ) : p.account ? (
            <NickForm submitLabel="별명 정하기" />
          ) : (
            <button type="button" onClick={p.onLogin} className="underline underline-offset-4">
              로그인하면 플레이할 수 있어요 (회원 전용)
            </button>
          )}
        </div>
        {p.note && <p className="mb-out text-[12px] text-white">{p.note}</p>}
      </div>

      <div className="absolute bottom-[16px] left-[56px] z-30 flex items-center gap-2">
        <SoundButton up />
        <FsButton />
        <span className="mb-out ml-2 text-[11px] text-white">BETA · 밸런스 m1</span>
      </div>
    </div>
  );
}

/* ───────────── 방 목록 ───────────── */

function Lobby({ me, onBack, onGo }: { me: string; onBack(): void; onGo(f: () => Promise<{ id: string }>): Promise<void> }) {
  const [rooms, setRooms] = useState<LobbyRoom[] | null>(null);
  const [make, setMake] = useState(false);
  const [pw, setPw] = useState<{ id: string; v: string } | null>(null);
  useEffect(() => watchLobby(setRooms), []);
  void me;
  return (
    <div className="mb-dots absolute inset-0">
      <div className="absolute top-[10px] left-[12px] flex items-center gap-2">
        <Btn className="h-[34px] px-3 text-[13px]" onClick={onBack}>
          <Icon n="back" size={12} /> 돌아가기
        </Btn>
        <div className="mb-wood px-3 py-1.5">
          <b className="mb-title mb-out text-[17px] text-white">방 목록</b>
        </div>
      </div>
      <div className="absolute top-[10px] right-[12px] flex gap-2">
        <Btn tone="gold" className="h-[34px] px-4 text-[14px] font-bold" onClick={() => setMake(true)}>
          방 만들기
        </Btn>
        <SoundButton />
        <FsButton />
      </div>
      <div className="mb-box mb-scroll absolute top-[60px] left-[12px] h-[500px] w-[1000px] overflow-y-auto p-3" style={{ "--bg": "#fffaf0" } as CSSProperties}>
        {!rooms ? (
          <p className="p-4 text-[13px]">불러오는 중…</p>
        ) : !rooms.length ? (
          <p className="p-4 text-[13px]">열린 방이 없어요. 방을 만들거나 메뉴의 「바로 시작」을 눌러 주세요.</p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {rooms.map((r) => (
              <button
                key={r.id}
                type="button"
                disabled={r.phase !== "wait" || r.players >= r.max}
                onClick={() => (r.locked ? setPw({ id: r.id, v: "" }) : void onGo(() => marble.join(r.id)))}
                className="mb-box flex h-[96px] items-center gap-3 px-3 text-left disabled:opacity-60"
                style={{ "--bg": MAP_ART[r.map].bg } as CSSProperties}
              >
                <Icon n={MAP_ART[r.map].icon} size={34} />
                <div className="min-w-0 flex-1">
                  <b className="block truncate text-[14px]">
                    {r.locked && <Icon n="lock" size={11} />} {r.name}
                  </b>
                  <span className="text-[12px]">
                    {MAPS[r.map].name} · {r.players}/{r.max}명
                  </span>
                  <div className="mt-1 flex gap-1 text-[10px]">
                    <span className="mb-chip" style={{ "--c": r.phase === "wait" ? "#bff0e4" : "#ffd6d6" } as CSSProperties}>
                      {r.phase === "wait" ? "대기" : r.phase === "play" ? "게임 중" : "끝"}
                    </span>
                    {r.bots && <span className="mb-chip"><Icon n="bot" size={9} /> AI</span>}
                    {!r.quick && <span className="mb-chip">친구 방</span>}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      {make && <MakeRoom onClose={() => setMake(false)} onMake={(o) => void onGo(() => marble.create(o))} />}
      {pw && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[rgba(35,42,77,0.4)]">
          <Win title="비밀번호" onClose={() => setPw(null)} className="w-[300px]">
            <form
              className="flex gap-2 p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void onGo(() => marble.join(pw.id, pw.v));
              }}
            >
              <input autoFocus value={pw.v} onChange={(e) => setPw({ ...pw, v: e.target.value })} className="mb-inset min-w-0 flex-1 px-2 py-1.5 text-[13px] outline-none" maxLength={20} onKeyDown={(e) => e.stopPropagation()} />
              <Btn tone="gold" type="submit" className="h-[34px] px-3 text-[13px]">
                입장
              </Btn>
            </form>
          </Win>
        </div>
      )}
    </div>
  );
}

function MakeRoom({ onClose, onMake }: { onClose(): void; onMake(o: { name: string; map: MapId; max: number; quick: boolean; bots: boolean; pw: string }): void }) {
  const [o, setO] = useState({ name: "", map: "town" as MapId, max: 2, quick: true, bots: true, pw: "" });
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-[rgba(35,42,77,0.4)]">
      <Win title="방 만들기" onClose={onClose} className="w-[420px]">
        <div className="flex flex-col gap-2.5 p-3 text-[13px]">
          <input value={o.name} onChange={(e) => setO({ ...o, name: e.target.value })} placeholder="방 이름 (비우면 내 별명의 마블)" maxLength={20} className="mb-inset px-2 py-1.5 outline-none" onKeyDown={(e) => e.stopPropagation()} />
          <div className="grid grid-cols-3 gap-1.5">
            {MAP_IDS.map((id) => (
              <Btn key={id} tone={o.map === id ? "gold" : "paper"} className="h-[46px] flex-col gap-0 text-[12px]" onClick={() => setO({ ...o, map: id })}>
                <Icon n={MAP_ART[id].icon} size={16} />
                {MAPS[id].name}
              </Btn>
            ))}
          </div>
          <p className="text-[11px] text-[var(--mute)]">{MAPS[o.map].desc}</p>
          <div className="flex items-center gap-1.5">
            <span className="w-[44px]">인원</span>
            {[2, 3, 4].map((n) => (
              <Btn key={n} tone={o.max === n ? "gold" : "paper"} className="h-[28px] w-[40px]" onClick={() => setO({ ...o, max: n })}>
                {n}
              </Btn>
            ))}
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={o.quick} onChange={(e) => setO({ ...o, quick: e.target.checked, bots: e.target.checked && o.bots })} className="accent-[#c98b4f]" />
            바로 입장 허용 <span className="text-[11px] text-[var(--mute)]">(끄면 친구 방)</span>
          </label>
          <label className={`flex items-center gap-2 ${o.quick ? "" : "opacity-50"}`}>
            <input type="checkbox" checked={o.bots} disabled={!o.quick} onChange={(e) => setO({ ...o, bots: e.target.checked })} className="accent-[#c98b4f]" />
            AI 입장 허용 <span className="text-[11px] text-[var(--mute)]">(바로 입장 허용일 때만)</span>
          </label>
          <input value={o.pw} onChange={(e) => setO({ ...o, pw: e.target.value })} placeholder="비밀번호 (선택)" maxLength={20} className="mb-inset px-2 py-1.5 outline-none" onKeyDown={(e) => e.stopPropagation()} />
          <Btn tone="gold" className="h-[42px] text-[15px] font-bold" onClick={() => onMake(o)}>
            만들기
          </Btn>
        </div>
      </Win>
    </div>
  );
}

/* ───────────── 방 ───────────── */

function RoomScreen({ id, me, onLeave, onGone }: { id: string; me: string; onLeave(): void; onGone(): void }) {
  const [room, setRoom] = useState<RoomWire | null>(null);
  const gone = useRef(onGone);
  useEffect(() => {
    gone.current = onGone;
  }, [onGone]);
  useEffect(() => watchRoom(id, setRoom, () => gone.current()), [id]);
  const phase = room?.phase;
  const rmap = room?.map;
  useEffect(() => {
    if (!phase || !rmap) return;
    playBgm(phase === "wait" ? "lobby" : rmap);
  }, [phase, rmap]);
  // 들어온 적 없는 방(목록에서 구경)이면 자리 잡기 — 이미 앉아 있으면 그대로
  useEffect(() => {
    void marble.join(id).catch(() => {});
  }, [id]);
  if (!room) return <div className="mb-sky absolute inset-0 flex items-center justify-center text-[14px]">방에 들어가는 중…</div>;
  if ((room.phase === "play" || room.phase === "end") && room.game) return <GameView key={room.game.seed} room={room} me={me} onLeave={onLeave} />;
  return <WaitRoom room={room} me={me} onLeave={onLeave} />;
}

export { LoadoutLine };
