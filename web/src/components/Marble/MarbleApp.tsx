"use client";

import { useEffect, useRef, useState } from "react";
import NickForm from "@/components/Account/NickForm";
import { useAuth } from "@/lib/AuthContext";
import { CHAR, power } from "@/lib/marble/data";
import { MAPS, MAP_IDS, type MapId } from "@/lib/marble/maps";
import type { LobbyRoom, ProfileWire, RoomWire } from "@/lib/marble/wire";
import { marble, watchLobby, watchRoom } from "@/realtime/marble";
import { playBgm, sfx, stopBgm } from "./audio";
import Bag, { Shop } from "./Bag";
import Gacha from "./Gacha";
import GameView from "./GameView";
import { applyCursor } from "./cursor";
import { GuideDot, useMapGuide } from "./MapGuide";
import { Cur, Stars } from "./pixel";
import { FsButton, LoadoutLine, SoundButton, WaitRoom } from "./Room";
import Stage from "./Stage";
import { CharHero, ItemBadge, LivingPixels, XBtn, XChip, XGrade, XPanel } from "./ui";

/*
 * DICE TOWN 몸통 — 무대(Stage) 안에서 메뉴 → 바로 시작 / 방 목록 → 대기실 → 판, 뽑기 · 가방 · 상점.
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
  const { loading, account, profile, login, admin } = useAuth();
  const member = !!profile;
  const me = account?.uid ?? "";
  const [screen, setScreen] = useState<Screen>({ k: "menu" });
  const [prof, setProf] = useState<ProfileWire | null>(null);
  const [note, setNote] = useState("");
  const [making, setMaking] = useState(false);
  // 저장된(처음엔 다이스 화살표) 커서를 바로 씀 · 게임 화면을 떠나면 배경음 끔
  useEffect(() => {
    applyCursor();
    return () => stopBgm();
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 로그아웃하면 프로필을 비움
    if (!member) return setProf(null);
    void marble.profile().then(
      (p) => {
        setProf(p);
        if (p.passGot) setNote(`일일 패스: 별사탕 ${p.passGot.stars} · 부품 ${p.passGot.parts} 받았어요!`);
      },
      (e) => setNote((e as Error).message)
    );
  }, [member]);
  // 새로고침 뒤: 진행 중인 판이 있으면 바로 그 방으로
  useEffect(() => {
    if (!member) return;
    void marble.mine().then((r) => r && setScreen({ k: "room", id: r.id }), () => {});
  }, [member]);
  useEffect(() => {
    if (screen.k === "menu" || screen.k === "lobby" || screen.k === "bag" || screen.k === "shop") playBgm("lobby");
  }, [screen.k]);
  const reload = () =>
    void marble.profile().then((p) => {
      setProf(p);
      if (p.passGot) setNote(`일일 패스: 별사탕 ${p.passGot.stars} · 부품 ${p.passGot.parts} 받았어요!`);
    }, () => {});

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
  if (screen.k === "shop" && prof) return <Shop prof={prof} onProf={setProf} onBack={() => setScreen({ k: "menu" })} admin={admin} />;
  if (screen.k === "lobby") return <Lobby me={me} onBack={() => setScreen({ k: "menu" })} onGo={go} />;
  return (
    <>
    <Menu
      loading={loading}
      member={member}
      account={!!account}
      nick={profile?.nick ?? null}
      prof={prof}
      note={note}
      onLogin={login}
      onQuick={(map) => void go(() => marble.quick(map ? { map } : {}))}
      onLobby={() => setScreen({ k: "lobby" })}
      onMake={() => setMaking(true)}
      onJoin={(r) => (r.locked ? setScreen({ k: "lobby" }) : void go(() => marble.join(r.id)))}
      onGacha={() => setScreen({ k: "gacha" })}
      onBag={() => setScreen({ k: "bag" })}
      onShop={() => setScreen({ k: "shop" })}
    />
    {making && <MakeRoom onClose={() => setMaking(false)} onMake={(o) => void go(() => marble.create(o))} />}
    </>
  );
}

/* ───────────── 메뉴 (애니메 포커 대기실처럼: 위 막대 · 왼쪽 큰 캐릭터 · 가운데 맵 · 오른쪽 열린 방 + 살아 있는 도트) ───────────── */

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
  onMake(): void;
  onJoin(r: LobbyRoom): void;
  onGacha(): void;
  onBag(): void;
  onShop(): void;
}) {
  const pr = p.prof;
  const [map, setMap] = useState<MapId | undefined>(undefined);
  const [rooms, setRooms] = useState<LobbyRoom[] | null>(null);
  useEffect(() => watchLobby(setRooms), []);
  const charId = pr?.load.char && pr.chars[pr.load.char] ? pr.load.char : pr ? (Object.keys(pr.chars)[0] ?? null) : null;
  const c = charId ? CHAR[charId] : null;
  const hasChar = !!pr && Object.keys(pr.chars).length > 0;
  const tickets = pr ? pr.tickets.char + pr.tickets.item : 0;
  const lv = c && pr ? (pr.chars[c.id]?.lv ?? 0) : 0;
  const gear = (s: "dice" | "buddy") => {
    const id = pr?.load[s];
    return id && pr?.items[id] ? { id, lv: pr.items[id].lv } : null;
  };
  // 오른쪽 아래 도트 친구들: 내 캐릭터 + 가진 높은 등급 몇
  const friends = [c?.sprite ?? "kai", ...(pr ? Object.keys(pr.chars) : ["igna", "lily", "ivan"]).filter((id) => id !== c?.id && CHAR[id]).sort((x, y) => GRADE_RANK[CHAR[y].grade] - GRADE_RANK[CHAR[x].grade]).slice(0, 3).map((id) => CHAR[id].sprite)];
  const open = (rooms ?? []).filter((r) => r.phase === "wait");
  const guide = useMapGuide();
  return (
    <div className="mbx absolute inset-0 overflow-hidden" style={{ background: "radial-gradient(120% 90% at 20% 0%, #4b3bb5 0%, #241a63 45%, #120d33 100%)" }}>
      <img key={map ?? "any"} src={map ? `/marble/bg/center-${map}.webp` : "/marble/art/banner-ur.webp"} alt="" className="mbx-fade absolute inset-0 h-full w-full object-cover opacity-[0.22] blur-[2px]" />

      {/* 위 막대 */}
      <div className="absolute inset-x-0 top-0 z-[40] flex h-[52px] items-center gap-2 border-b border-white/10 bg-black/25 px-4 backdrop-blur">
        <div className="flex items-baseline gap-2">
          <b className="text-[20px] font-black tracking-tight text-[#ffd65a]" style={{ textShadow: "0 2px 0 #8a4b00" }}>
            DICE TOWN
          </b>
          <XChip color="#ff5f8f">BETA</XChip>
          <span className="text-[11px] text-white/60">픽셀파이트 세계관 보드게임</span>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {pr && (
            <div className="mr-1 flex items-center gap-3 rounded-full border border-white/15 bg-black/30 px-3 py-1 text-[13px]">
              <span title="별사탕 — 뽑기"><Cur k="star" n={pr.stars} size={14} /></span>
              <span title="부품 — 아이템 강화"><Cur k="parts" n={pr.parts} size={14} /></span>
              <span title="GP — 사이트 포인트"><Cur k="gp" n={pr.gp} size={14} /></span>
            </div>
          )}
          <XBtn tone="pink" className="relative h-[34px] px-3 text-[13px]" disabled={!p.member || !pr} onClick={p.onGacha}>
            뽑기
            {tickets > 0 && <span className="absolute -top-1.5 -right-1.5 min-w-[18px] rounded-full bg-[#ff3b5c] px-1 text-[11px] leading-[18px] text-white ring-2 ring-[#120d33]">{tickets}</span>}
          </XBtn>
          <XBtn className="h-[34px] px-3 text-[13px]" disabled={!p.member || !pr} onClick={p.onBag}>
            가방
          </XBtn>
          <XBtn tone="gold" className="h-[34px] px-3 text-[13px]" disabled={!p.member || !pr} onClick={p.onShop}>
            상점
          </XBtn>
          <SoundButton glass />
          <FsButton glass />
        </div>
      </div>

      {/* 왼쪽: 내 캐릭터 크게 */}
      <XPanel className="absolute top-[64px] left-[14px] h-[498px] w-[300px]">
        {c ? (
          <>
            <CharHero id={c.id} className="h-[330px] w-full">
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#120d33] via-[#120d33cc] to-transparent px-3 pt-8 pb-2">
                <div className="flex items-center gap-1.5">
                  <XGrade g={c.grade} />
                  <span className="text-[12px] text-white/80">{c.title}</span>
                  <Stars lv={lv} size={10} />
                </div>
                <b className="text-[26px] leading-[30px] font-black">{c.name}</b>
              </div>
            </CharHero>
            <div className="flex flex-1 flex-col gap-2 p-3 text-[12px]">
              <p className="leading-[16px] text-white/85">
                <b className="text-[#ffe08a]">{c.passive.name}</b> {c.passive.desc(power(c.grade, lv))}
              </p>
              <p className="leading-[16px] text-white/85">
                <b className="text-[#9fe7ff]">{c.active.name}</b> {c.active.desc(power(c.grade, lv))}
              </p>
              <div className="mt-auto flex items-center gap-2">
                <ItemBadge slot="dice" item={gear("dice")} up />
                <ItemBadge slot="buddy" item={gear("buddy")} up />
                <XBtn className="ml-auto h-[34px] px-3 text-[12px]" onClick={p.onBag} disabled={!pr}>
                  바꾸기
                </XBtn>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center">
            <img src="/marble/art/banner-ur.webp" alt="" className="h-[180px] w-full rounded-xl object-cover" />
            <b className="text-[16px]">아직 캐릭터가 없어요</b>
            <p className="text-[12px] text-white/70">처음엔 캐릭터 · 아이템 10연차 티켓을 한 장씩 드려요</p>
            {p.member && pr && (
              <XBtn tone="pink" className="h-[46px] w-full text-[16px]" onClick={p.onGacha}>
                첫 캐릭터 뽑기 (무료)
              </XBtn>
            )}
          </div>
        )}
      </XPanel>

      {/* 가운데: 맵 고르기 · 바로 시작 */}
      <div className="absolute top-[64px] left-[326px] flex h-[498px] w-[386px] flex-col gap-3">
        <XPanel title="맵 고르기" right={<span className="text-[11px] text-white/60">바로 시작할 때 이 맵으로</span>}>
          <div className="grid grid-cols-2 gap-2 p-2.5">
            {([undefined, ...MAP_IDS] as (MapId | undefined)[]).map((id) => {
              const on = map === id;
              return (
                <button
                  key={id ?? "any"}
                  type="button"
                  disabled={!p.member}
                  onClick={() => {
                    sfx("click");
                    setMap(id);
                  }}
                  className={`group relative h-[118px] overflow-hidden rounded-xl text-left transition ${on ? "ring-[3px] ring-[#ffd65a]" : "ring-1 ring-white/15 hover:ring-white/40"}`}
                >
                  {id ? (
                    <img src={`/marble/bg/map-${id}.webp`} alt="" className="absolute inset-0 h-full w-full object-cover transition group-hover:scale-105" />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#ff9ad5] via-[#8fb4ff] to-[#8ff0d0] text-[44px] font-black text-white/90">?</div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-2 pt-5 pb-1.5">
                    <b className="text-[14px]">{id ? MAPS[id].name : "아무 맵"}</b>
                    <p className="truncate text-[10px] text-white/75">{id ? MAPS[id].desc : "세 맵 중 무작위"}</p>
                  </div>
                  {on && <span className="absolute top-1.5 left-1.5 rounded-full bg-[#ffd65a] px-2 text-[10px] leading-[18px] font-black text-[#3a2500]">선택</span>}
                  {id && <GuideDot className="absolute top-1.5 right-1.5" onOpen={() => guide.show(id)} />}
                </button>
              );
            })}
          </div>
        </XPanel>
        <div className="flex gap-2">
          <XBtn tone="gold" className="h-[68px] flex-1 flex-col gap-0 text-[22px]" disabled={!p.member || !hasChar} onClick={() => p.onQuick(map)} silent>
            바로 시작
            <span className="text-[11px] font-semibold opacity-80">열린 방 아무 데나 · 2~4인 · 빈자리는 AI</span>
          </XBtn>
          <XBtn className="h-[68px] w-[96px] flex-col gap-0 text-[15px]" disabled={!p.member || !hasChar} onClick={p.onMake}>
            방 만들기
          </XBtn>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-[12px] text-white/85">
          {p.loading ? (
            <span>로그인 확인 중…</span>
          ) : p.member ? (
            <>
              <b className="text-white">{p.nick}</b> 님 · {pr?.winToday ? "오늘 첫 승 보너스 받음 ✓" : "오늘 첫 승리하면 별사탕 +100"} · {pr?.wins ?? 0}승 / {pr?.games ?? 0}판
              {pr?.pass && <span className="ml-1 text-[#ffd65a]">· 일일 패스 {pr.pass.left}일</span>}
            </>
          ) : p.account ? (
            <NickForm submitLabel="별명 정하기" />
          ) : (
            <button type="button" onClick={p.onLogin} className="underline underline-offset-4">
              로그인하면 플레이할 수 있어요 (회원 전용)
            </button>
          )}
        </div>
        {p.note && <p className="text-[12px] text-[#ffd65a]">{p.note}</p>}
      </div>

      {/* 오른쪽: 열린 방 + 살아 있는 도트 */}
      <XPanel className="absolute top-[64px] right-[14px] h-[300px] w-[284px]" title="열린 방" right={<button type="button" onClick={p.onLobby} className="text-[11px] text-white/70 underline-offset-2 hover:underline">전체 보기 ›</button>}>
        <div className="mb-scroll flex-1 overflow-y-auto p-2">
          {!rooms ? (
            <p className="p-3 text-[12px] text-white/60">불러오는 중…</p>
          ) : !open.length ? (
            <p className="p-3 text-[12px] leading-[18px] text-white/60">기다리는 방이 없어요. 「바로 시작」을 누르면 새 방이 열려요.</p>
          ) : (
            open.slice(0, 12).map((r) => (
              <div key={r.id} className="mb-1.5 flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-1.5">
                <img src={`/marble/bg/map-${r.map}.webp`} alt="" className="h-[38px] w-[62px] rounded-lg object-cover" />
                <div className="min-w-0 flex-1">
                  <b className="block truncate text-[12px]">{r.name}</b>
                  <span className="text-[10px] text-white/65">
                    {MAPS[r.map].name} · {r.players}/{r.max}명{r.bots ? " · AI" : ""}
                  </span>
                </div>
                <XBtn tone="mint" className="h-[28px] px-2.5 text-[11px]" disabled={!p.member || !hasChar || r.players >= r.max} onClick={() => p.onJoin(r)}>
                  입장
                </XBtn>
              </div>
            ))
          )}
        </div>
      </XPanel>
      <LivingPixels sprites={friends} bg={`/marble/bg/${map ?? "town"}.webp`} className="absolute right-[14px] bottom-[14px] h-[186px] w-[284px]" />
      {guide.node}
    </div>
  );
}

const GRADE_RANK = { R: 0, SR: 1, SSR: 2, UR: 3 } as const;

/* ───────────── 방 목록 ───────────── */

function Lobby({ me, onBack, onGo }: { me: string; onBack(): void; onGo(f: () => Promise<{ id: string }>): Promise<void> }) {
  const [rooms, setRooms] = useState<LobbyRoom[] | null>(null);
  const [make, setMake] = useState(false);
  const [pw, setPw] = useState<{ id: string; v: string } | null>(null);
  useEffect(() => watchLobby(setRooms), []);
  void me;
  return (
    <div className="mbx absolute inset-0 overflow-hidden" style={{ background: "radial-gradient(circle at 50% 0%, #2f2a75, #120d33 70%)" }}>
      <div className="absolute inset-x-0 top-0 z-[30] flex h-[52px] items-center gap-2 border-b border-white/10 bg-black/25 px-3 backdrop-blur">
        <XBtn className="h-[34px] px-3 text-[13px]" onClick={onBack}>
          ‹ 돌아가기
        </XBtn>
        <b className="ml-1 text-[19px] font-black text-white">방 목록</b>
        <span className="text-[12px] text-white/50">{rooms ? `${rooms.length}개` : ""}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <XBtn tone="gold" className="h-[34px] px-4 text-[14px]" onClick={() => setMake(true)}>
            ＋ 방 만들기
          </XBtn>
          <SoundButton glass />
          <FsButton glass />
        </div>
      </div>
      <div className="mbx-hscroll absolute top-[64px] right-[12px] bottom-[12px] left-[12px] overflow-y-auto">
        {!rooms ? (
          <p className="p-4 text-[13px] text-white/60">불러오는 중…</p>
        ) : !rooms.length ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-white/60">
            <p className="text-[14px]">열린 방이 없어요</p>
            <XBtn tone="gold" className="h-[40px] px-5 text-[14px]" onClick={() => setMake(true)}>
              첫 방 만들기
            </XBtn>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {rooms.map((r) => {
              const open = r.phase === "wait" && r.players < r.max;
              return (
                <button
                  key={r.id}
                  type="button"
                  disabled={!open}
                  onClick={() => (r.locked ? setPw({ id: r.id, v: "" }) : void onGo(() => marble.join(r.id)))}
                  className="group relative h-[150px] overflow-hidden rounded-2xl text-left ring-1 ring-white/15 transition hover:-translate-y-[2px] hover:ring-[#ffd23a] disabled:opacity-55 disabled:hover:translate-y-0 disabled:hover:ring-white/15"
                >
                  <img src={`/marble/bg/map-${r.map}.webp`} alt="" className="absolute inset-0 h-full w-full object-cover transition group-hover:scale-[1.04]" />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0c0a28]/95 via-[#0c0a28]/40 to-transparent" />
                  <div className="absolute top-[8px] left-[8px] flex gap-1">
                    <XChip color={r.phase === "wait" ? "#2fc3a0" : "#ff5f8f"}>{r.phase === "wait" ? "대기 중" : r.phase === "play" ? "게임 중" : "끝"}</XChip>
                    {r.bots && <XChip color="#ffffff30">AI</XChip>}
                    {!r.quick && <XChip color="#ffffff30">친구 방</XChip>}
                    {r.locked && <XChip color="#ffffff30">🔒</XChip>}
                  </div>
                  <div className="absolute inset-x-[12px] bottom-[10px]">
                    <b className="block truncate text-[16px] text-white">{r.name}</b>
                    <div className="mt-0.5 flex items-center gap-2 text-[12px] text-white/75">
                      <span>{MAPS[r.map].name}</span>
                      <span className="ml-auto flex gap-[3px]">
                        {Array.from({ length: r.max }, (_, i) => (
                          <span key={i} className={`h-[9px] w-[9px] rounded-full ${i < r.players ? "bg-[#ffd23a]" : "bg-white/25"}`} />
                        ))}
                      </span>
                      <span className="font-bold text-white">
                        {r.players}/{r.max}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
      {make && <MakeRoom onClose={() => setMake(false)} onMake={(o) => void onGo(() => marble.create(o))} />}
      {pw && (
        <Modal title="비밀번호" onClose={() => setPw(null)} w={320}>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void onGo(() => marble.join(pw.id, pw.v));
            }}
          >
            <input autoFocus value={pw.v} onChange={(e) => setPw({ ...pw, v: e.target.value })} className="mbx-input min-w-0 flex-1" maxLength={20} onKeyDown={(e) => e.stopPropagation()} />
            <XBtn tone="gold" type="submit" className="h-[38px] px-4 text-[13px]">
              입장
            </XBtn>
          </form>
        </Modal>
      )}
    </div>
  );
}

/** 매끈한 창 (어두운 유리) */
function Modal({ title, onClose, w, children }: { title: string; onClose(): void; w: number; children: React.ReactNode }) {
  return (
    <div className="mbx absolute inset-0 z-50 flex items-center justify-center bg-[rgba(10,8,30,0.6)] backdrop-blur-[2px]" onClick={onClose}>
      <div className="mbx-pop overflow-hidden rounded-2xl border border-white/15 bg-[#1b1650]/95 shadow-[0_20px_50px_rgba(0,0,0,0.5)]" style={{ width: w }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center border-b border-white/10 px-4 py-3">
          <b className="text-[16px] text-white">{title}</b>
          <button type="button" onClick={onClose} className="ml-auto flex h-[28px] w-[28px] items-center justify-center rounded-full bg-white/10 text-[16px] text-white/80 hover:bg-white/20" aria-label="닫기">
            ×
          </button>
        </div>
        <div className="p-4 text-[13px] text-white">{children}</div>
      </div>
    </div>
  );
}

function Switch({ on, disabled, onChange, label, sub }: { on: boolean; disabled?: boolean; onChange(v: boolean): void; label: string; sub: string }) {
  return (
    <button type="button" disabled={disabled} onClick={() => onChange(!on)} className="flex items-center gap-2.5 text-left disabled:opacity-45">
      <span className={`relative h-[22px] w-[40px] rounded-full transition ${on ? "bg-[#2fc3a0]" : "bg-white/20"}`}>
        <span className={`absolute top-[3px] h-[16px] w-[16px] rounded-full bg-white shadow transition-all ${on ? "left-[21px]" : "left-[3px]"}`} />
      </span>
      <span className="text-[13px] text-white">
        {label} <span className="text-[11px] text-white/50">{sub}</span>
      </span>
    </button>
  );
}

function MakeRoom({ onClose, onMake }: { onClose(): void; onMake(o: { name: string; map: MapId; max: number; quick: boolean; bots: boolean; pw: string }): void }) {
  const [o, setO] = useState({ name: "", map: "town" as MapId, max: 2, quick: true, bots: true, pw: "" });
  return (
    <Modal title="방 만들기" onClose={onClose} w={560}>
      <div className="flex flex-col gap-3">
        <input value={o.name} onChange={(e) => setO({ ...o, name: e.target.value })} placeholder="방 이름 (비우면 내 별명의 마블)" maxLength={20} className="mbx-input" onKeyDown={(e) => e.stopPropagation()} />
        <div className="grid grid-cols-3 gap-2">
          {MAP_IDS.map((id) => (
            <button key={id} type="button" onClick={() => setO({ ...o, map: id })} className={`relative h-[92px] overflow-hidden rounded-xl text-left transition ${o.map === id ? "ring-[3px] ring-[#ffd23a]" : "opacity-75 ring-1 ring-white/15 hover:opacity-100"}`}>
              <img src={`/marble/bg/map-${id}.webp`} alt="" className="absolute inset-0 h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
              <b className="absolute bottom-[6px] left-[8px] text-[13px] text-white">{MAPS[id].name}</b>
              {o.map === id && <span className="absolute top-[6px] right-[6px] rounded-full bg-[#ffd23a] px-1.5 text-[10px] leading-[16px] font-black text-[#3a2500]">선택</span>}
            </button>
          ))}
        </div>
        <p className="text-[12px] leading-[17px] text-white/60">{MAPS[o.map].desc}</p>
        <div className="flex items-center gap-2">
          <span className="w-[44px] text-white/80">인원</span>
          {[2, 3, 4].map((n) => (
            <XBtn key={n} tone={o.max === n ? "gold" : "glass"} className="h-[32px] w-[48px] text-[14px]" onClick={() => setO({ ...o, max: n })}>
              {n}
            </XBtn>
          ))}
        </div>
        <Switch on={o.quick} onChange={(v) => setO({ ...o, quick: v, bots: v && o.bots })} label="바로 입장 허용" sub="(끄면 친구 방)" />
        <Switch on={o.bots} disabled={!o.quick} onChange={(v) => setO({ ...o, bots: v })} label="AI 입장 허용" sub="(바로 입장 허용일 때만)" />
        <input value={o.pw} onChange={(e) => setO({ ...o, pw: e.target.value })} placeholder="비밀번호 (선택)" maxLength={20} className="mbx-input" onKeyDown={(e) => e.stopPropagation()} />
        <XBtn tone="gold" className="h-[46px] text-[16px]" onClick={() => onMake(o)}>
          방 만들기
        </XBtn>
      </div>
    </Modal>
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
    // 끝나면 결과 화면이 승리 음악 · 패배 효과음을 맡음
    if (!phase || !rmap || phase === "end") return;
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
