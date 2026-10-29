"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { DIFF_NAME, type Diff } from "@/lib/baseball/ai";
import { DH, DW, useStage } from "./Stage";
import { FIELD_VIEW, setFieldView } from "./view";
import { Match, loadSave, type MatchCfg, type Save, type UiState } from "./match";
import { isMuted, setMuted } from "./sfx";
import { ACCENT, Btn, MenuBg, Modal, font, useSpaceConfirm } from "./ui";
import CareerMode from "./Career";
import { SPEEDS, cancelDirect, finishBond, finishDirect, loadSpeed, saveSpeed } from "./careerStore";
import { CLUB_DEFS, charById, clubDefById, faceUrl } from "@/lib/baseball/data";
import { buildTeam, findGhosts, veloKmh, ghostTeam, gradeOf, teamRating, type Club, type Ghost } from "@/lib/baseball/club";
import { makeRng } from "@/lib/baseball/rng";
import { clutchOf } from "@/lib/baseball/game";
import { CHANCE } from "@/lib/baseball/careerGame";
import { createClub, loadClub, recordOnline, saveClub } from "./clubStore";
import ClubScreen from "./Club";
import { Emblem, GradeChip } from "./clubUi";
import Online from "./Online";
import Shop from "./Shop";
import TeamPick from "./TeamPick";
import { useAuth } from "@/lib/AuthContext";
import { CloudSync, type Conflict } from "./cloudSave";

/** 개발 서버에서만 주소 옵션 (?admin=1) */
const devAdmin = () => process.env.NODE_ENV !== "production" && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("admin") === "1";
const TEST_LV = [0, 300, 500, 700, 900] as const;

/*
 * 픽셀 프로야구 — 메뉴 · 경기 화면(캔버스) · 조작 버튼.
 * 경기 로직 · 그리기는 match.ts, 규칙은 lib/baseball.
 */

type Screen = "title" | "setup" | "derby" | "howto" | "play" | "career" | "pick" | "club" | "online" | "shop";

/**
 * 클라우드 세이브: 로그인했으면 서버 저장과 먼저 맞춘 뒤 화면을 띄움 (게스트는 바로).
 * 서버 것을 받아 덮어쓰면 화면을 새로 그려서 저장을 다시 읽게 함.
 */
export default function BaseballApp() {
  const auth = useAuth();
  const uid = auth.account?.uid ?? null;
  const [ready, setReady] = useState(false);
  const [gen, setGen] = useState(0);
  const [conflict, setConflict] = useState<(Conflict & { done: (p: "local" | "remote") => void }) | null>(null);
  useEffect(() => {
    if (auth.loading) return;
    if (!uid) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 게스트는 맞출 것 없음
      setReady(true);
      return;
    }
    const cs = new CloudSync(uid, {
      applied: () => setGen((g) => g + 1),
      conflict: (c) => new Promise((done) => setConflict({ ...c, done })),
    });
    let alive = true;
    void cs.start().finally(() => alive && setReady(true));
    return () => {
      alive = false;
      cs.stop();
    };
  }, [uid, auth.loading]);
  return (
    <div className={`relative h-full w-full overflow-hidden bg-[#0b0e1c] text-white ${font.body}`} style={{ width: DW, height: DH }}>
      {/* 충돌 창은 위에 띄우기만 (예전엔 경기 · 장면 중에 뜨면 화면이 통째로 내려가 진행이 날아감) */}
      {ready ? (
        <BaseballMain key={gen} />
      ) : (
        <MenuBg>
          <div className={`${font.title} flex h-full items-center justify-center text-[22px] text-white/60`}>{conflict ? "" : "저장 불러오는 중…"}</div>
        </MenuBg>
      )}
      {conflict && (
        <Modal w={620}>
          <div className={`${font.title} text-[24px]`}>어느 저장으로 할까요?</div>
          <p className="mt-1 text-[13px] text-white/60">이 기기와 계정에 서로 다른 진행이 있어요. 고른 쪽으로 맞추고, 다른 쪽은 지워져요.</p>
          <div className="mt-4 grid grid-cols-2 gap-3 text-left">
            {(
              [
                ["local", "📱 이 기기", conflict.local, "#7ad7ff"],
                ["remote", `☁️ 계정 (${new Date(conflict.remoteAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 저장)`, conflict.remote, ACCENT],
              ] as const
            ).map(([k, title, lines, col]) => (
              <Btn
                key={k}
                color={col}
                className="flex flex-col items-start gap-1 px-4 py-3"
                onClick={() => {
                  conflict.done(k);
                  setConflict(null);
                }}
              >
                <span className={`${font.title} text-[17px]`}>{title}</span>
                {lines.map((l) => (
                  <span key={l} className="text-[12.5px] font-normal opacity-85">
                    {l}
                  </span>
                ))}
              </Btn>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

function BaseballMain() {
  // 스페이스 = 지금 화면의 확인 · 계속 버튼
  useSpaceConfirm();
  const [screen, setScreen] = useState<Screen>("title");
  const [save, setSave] = useState<Save>({ pt: 0, derbyBest: 0, games: 0, wins: 0 });
  const [diff, setDiff] = useState<Diff>(0);
  const [innings, setInnings] = useState(3);
  const [home, setHome] = useState(true);
  /** 연습 경기: 한쪽만 직접 (공격만 · 수비만), 없으면 둘 다 */
  const [only, setOnly] = useState<"bat" | "pit" | undefined>(undefined);
  const [cfg, setCfg] = useState<MatchCfg | null>(null);
  const [run, setRun] = useState(0);
  /** 내 구단 (없으면 첫 방문 → 구단 고르기) */
  const [club, setClub] = useState<Club | null>(null);
  const [ghosts, setGhosts] = useState<Ghost[] | null>(null);
  /** 지금 경기의 온라인 상대 (없으면 연습 · 더비) */
  const [foe, setFoe] = useState<Ghost | null>(null);
  const [overNote, setOverNote] = useState<string | null>(null);
  // 관리자 테스트: 상대 투수 구속 · 변화 고정 (0 = 원래 값)
  const auth = useAuth();
  const isAdmin = auth.admin || devAdmin();
  const [tVelo, setTVelo] = useState(0);
  const [tBrk, setTBrk] = useState(0);
  const testPit = isAdmin && (tVelo || tBrk) ? { velo: tVelo || undefined, brk: tBrk || undefined } : undefined;
  const testRows = isAdmin && (
    <div className="flex flex-col gap-1.5 rounded-lg border border-[#ff6b6b]/40 bg-[#ff6b6b]/[0.06] px-3 py-2">
      <span className="text-[11px] font-bold text-[#ff8a8a]">관리자 테스트 · 상대 투수 전원</span>
      {([["구속", tVelo, setTVelo], ["변화", tBrk, setTBrk]] as const).map(([label, v, set]) => (
        <Row key={label} label={label}>
          {TEST_LV.map((n) => (
            <Btn key={n} active={v === n} className="px-3 py-1 text-[13px]" onClick={() => set(n)}>
              {n ? (label === "구속" ? `${n} (${veloKmh(n)}km)` : n) : "원래"}
            </Btn>
          ))}
        </Row>
      ))}
    </div>
  );
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 브라우저 저장값
    setSave(loadSave());
    const c = loadClub();
    setClub(c);
    // (처음 들어오면 구단 고르기부터 띄우던 것 → 타이틀 먼저. 구단은 온라인 · 구단 관리 들어갈 때 고름)
  }, [screen]);

  const start = (c: MatchCfg) => {
    // 온라인 상대 · 결과 줄은 그 판에만 (더비 · 육성 · 연습 경기 결과가 대전 기록에 들어가던 문제)
    setFoe(null);
    setOverNote(null);
    setCfg({ speed: loadSpeed(), ...c });
    setRun((n) => n + 1);
    setScreen("play");
  };
  const changeClub = (c: Club) => {
    saveClub(c);
    setClub(c);
  };
  /** 온라인(기록) 대전 시작 — 구단은 저장된 최신으로 */
  const playOnline = (g: Ghost, inn: number, userHome: boolean) => {
    const c = loadClub();
    if (!c) return;
    // 난이도(공 속도)는 중급 고정 — 상대 강함은 상대 구단 능력치로만
    start({ mode: "game", diff: 1, innings: inn, userHome, teams: { mine: buildTeam(c), cpu: g.team } });
    setFoe(g);
  };
  /** 연습 경기: 구단이 있으면 우리 팀 = 내 구단, 상대 = 비슷한 전력 AI 구단 */
  const playPractice = () => {
    setFoe(null);
    setOverNote(null);
    const c = loadClub();
    if (!c) return start({ mode: "game", diff, innings, userHome: home, only, testPit });
    const rng = makeRng();
    const def = rng.pick(CLUB_DEFS.filter((d) => d.id !== c.teamId));
    start({ mode: "game", diff, innings, userHome: home, teams: { mine: buildTeam(c), cpu: ghostTeam(def, teamRating(c), rng) }, only, testPit });
  };

  return (
    <div className={`relative h-full w-full overflow-hidden bg-[#0b0e1c] text-white ${font.body}`} style={{ width: DW, height: DH }}>
      {screen === "play" && cfg ? (
        <Play
          key={run}
          cfg={cfg}
          onExit={() => setScreen(cfg.career || cfg.bond ? "career" : foe ? "online" : "title")}
          onAgain={() => (foe ? setScreen("online") : cfg.teams ? playPractice() : start({ ...cfg, seed: undefined }))}
          online={!!foe}
          onAbandon={
            foe
              ? (mm) => {
                  // 온라인: 공을 하나라도 던진 뒤 나가면 패배로 기록 (지고 있을 때 도망 방지)
                  if (mm.ui.over || !mm.s.sides.some((sd) => sd.pit.some((pp) => pp.pitches > 0))) return;
                  recordOnline(foe, false, `${mm.s.score[0]}:${mm.s.score[1]}`);
                  const c = loadClub();
                  setGhosts(c ? findGhosts(c) : null);
                }
              : undefined
          }
          note={overNote}
          onOver={
            foe
              ? (win, score) => {
                  const d = recordOnline(foe, win, score);
                  const c = loadClub();
                  setOverNote(`대전 점수 ${d >= 0 ? `+${d}` : d} → ${c?.record.rating ?? "-"} · ${c ? `${c.record.w}승 ${c.record.l}패` : ""}`);
                  // 로비로 돌아가면 새 상대 3팀
                  setGhosts(c ? findGhosts(c) : null);
                }
              : undefined
          }
          onCareerDone={(mm) => {
            if (cfg.bond) {
              finishBond(mm.bondSt.pts);
              setScreen("career");
              return;
            }
            const s = mm.s;
            const me = s.opts.userHome ? 1 : 0;
            finishDirect(
              { line: s.sides[me].bat[cfg.career!.myIdx], win: s.winner < 0 ? null : s.winner === me, missionPt: s.pt, missions: mm.missionsOk, direct: true, clutch: clutchOf(s, me, cfg.career!.myIdx), sb: s.me?.sb ?? 0, cs: s.me?.cs ?? 0, df: s.me?.df ?? 0 },
              mm.myPAs,
              `${s.opts.away.short} ${s.score[0]} : ${s.score[1]} ${s.opts.home.short}`
            );
            setScreen("career");
          }}
        />
      ) : screen === "career" ? (
        <CareerMode onExit={() => setScreen("title")} onPlay={start} />
      ) : screen === "club" && club ? (
        <MenuBg>
          <ClubScreen club={club} coin={save.pt} onChange={changeClub} onBack={() => setScreen("title")} />
        </MenuBg>
      ) : screen === "online" && club ? (
        <MenuBg>
          <Online club={club} coin={save.pt} ghosts={ghosts} setGhosts={setGhosts} onPlay={playOnline} onBack={() => setScreen("title")} onManage={() => setScreen("club")} />
        </MenuBg>
      ) : (
        <MenuBg>
          {screen === "pick" && (
            <TeamPick
              onPick={(id) => {
                setClub(createClub(id));
                setScreen("title");
              }}
              onLater={() => setScreen("title")}
            />
          )}

          {screen === "shop" && <Shop coin={save.pt} onBack={() => setScreen("title")} />}

          {screen === "title" && (
            <div className="flex h-full flex-col items-center justify-center gap-4">
              {/* 내 구단 (오른쪽 위) */}
              {club ? (
                <button
                  type="button"
                  onClick={() => setScreen("club")}
                  className="absolute top-4 right-4 flex cursor-pointer items-center gap-2 rounded-xl border border-white/15 bg-black/35 py-1.5 pr-3 pl-1.5 text-left hover:border-white/40"
                >
                  <Emblem def={clubDefById(club.teamId)} size={36} />
                  <span>
                    <span className={`${font.title} block text-[15px] leading-tight`}>{clubDefById(club.teamId).name}</span>
                    <span className="flex items-center gap-1 text-[11px] text-white/60">
                      팀 평점 <GradeChip g={gradeOf(teamRating(club))} /> <b className="font-mono text-white/85">{teamRating(club)}</b>
                    </span>
                  </span>
                </button>
              ) : (
                <Btn className="absolute top-4 right-4 px-3 py-1.5 text-[13px]" color="#7dff9a" onClick={() => setScreen("pick")}>
                  내 구단 고르기
                </Btn>
              )}
              <div className="text-center">
                <div className={`${font.title} text-[60px] leading-none tracking-wide`} style={{ color: ACCENT, textShadow: "0 5px 0 #000, 0 0 30px rgba(255,138,61,0.5)" }}>
                  픽셀 프로야구
                </div>
                <div className="mt-2 text-[14px] text-white/60">타이밍 한 방 — 친구들과 같이 크는 야구</div>
              </div>
              <div className="flex gap-3">
                <Btn className={`${font.title} w-[330px] py-3.5 text-[28px]`} onClick={() => setScreen("career")}>
                  육성 모드
                  <span className="block font-['Nanum_Gothic'] text-[12px] font-normal opacity-80">나만의 선수를 키워서 명예의 전당으로</span>
                </Btn>
                <Btn className={`${font.title} w-[330px] py-3.5 text-[28px]`} color="#7dff9a" onClick={() => setScreen(club ? "online" : "pick")}>
                  온라인 대전
                  <span className="block font-['Nanum_Gothic'] text-[12px] font-normal opacity-80">내 구단으로 다른 구단과 한판 · 알파</span>
                </Btn>
              </div>
              <div className="flex gap-3">
                <Btn className={`${font.title} w-[159px] py-3 text-[21px]`} color="#ff8ad1" onClick={() => setScreen(club ? "club" : "pick")}>
                  구단 관리
                </Btn>
                <Btn className={`${font.title} w-[159px] py-3 text-[21px]`} color="#7ad7ff" onClick={() => setScreen("setup")}>
                  연습 경기
                </Btn>
                <Btn className={`${font.title} w-[159px] py-3 text-[21px]`} color="#ffd23f" onClick={() => setScreen("derby")}>
                  홈런 더비
                </Btn>
                {/* 상점은 아직 전부 준비 중이라 숨김 (알파) */}
              </div>
              <Btn className="w-[160px] py-2 text-sm" color="#7ad7ff" onClick={() => setScreen("howto")}>
                조작법
              </Btn>
              {(save.games > 0 || save.pt > 0 || save.derbyBest > 0 || !!club) && (
                <div className="font-mono text-[13px] text-white/50">
                  코인 {save.pt.toLocaleString()} · {save.games}경기 {save.wins}승 · 더비 최고 {save.derbyBest.toLocaleString()}m
                  {club && ` · 대전 ${club.record.w}승 ${club.record.l}패 · ${club.record.rating}점`}
                </div>
              )}
            </div>
          )}

          {screen === "setup" && (
            <div className="flex h-full flex-col gap-3 px-8 py-5">
              <div className="flex items-center justify-between">
                <span className={`${font.title} text-[28px]`} style={{ color: ACCENT }}>
                  경기 설정
                </span>
                <Btn className="px-4 py-1.5 text-sm" color="#8b93b8" onClick={() => setScreen("title")}>
                  ← 뒤로
                </Btn>
              </div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <Row label="봇 난이도">
                  {([0, 1, 2] as Diff[]).map((d) => (
                    <Btn key={d} active={diff === d} className="px-4 py-1.5 text-sm" onClick={() => setDiff(d)}>
                      {DIFF_NAME[d]}
                    </Btn>
                  ))}
                </Row>
                <Row label="이닝">
                  {[3, 6, 9].map((n) => (
                    <Btn key={n} active={innings === n} className="px-4 py-1.5 text-sm" onClick={() => setInnings(n)}>
                      {n}회
                    </Btn>
                  ))}
                </Row>
                <Row label="직접 할 것">
                  {([[undefined, "공격 · 수비 둘 다"], ["bat", "공격만 · 타격"], ["pit", "수비만 · 투구"]] as const).map(([v, label]) => (
                    <Btn key={label} active={only === v} className="px-4 py-1.5 text-sm" onClick={() => setOnly(v)}>
                      {label}
                    </Btn>
                  ))}
                </Row>
                <Row label="홈 / 원정">
                  <Btn active={!home} className="px-4 py-1.5 text-sm" onClick={() => setHome(false)}>
                    원정 · 먼저 공격
                  </Btn>
                  <Btn active={home} className="px-4 py-1.5 text-sm" onClick={() => setHome(true)}>
                    홈 · 먼저 수비
                  </Btn>
                </Row>
              </div>
              <p className="text-[12px] text-white/50">
                {diff === 0 ? "초급: 공이 느리고 봇이 순함" : diff === 1 ? "중급: 보통 속도" : "고급: 빠름 · 봇이 잘 치고 잘 던짐"}
              </p>
              {club ? (
                <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <Emblem def={clubDefById(club.teamId)} size={44} />
                  <div className="text-[13px] leading-relaxed text-white/75">
                    우리 팀 = 내 구단 <b style={{ color: clubDefById(club.teamId).color }}>{clubDefById(club.teamId).name}</b> (팀 평점 {teamRating(club)}) · 지금 타선 · 선발 그대로
                    <br />
                    상대 = 비슷한 전력의 AI 구단 · 연습 경기는 대전 점수에 안 들어가요
                  </div>
                  <Btn className="ml-auto px-3 py-1.5 text-[13px]" color="#ff8ad1" onClick={() => setScreen("club")}>
                    구단 관리
                  </Btn>
                </div>
              ) : (
                <p className="text-[12px] text-white/45">내 구단을 고르면 우리 팀이 내 구단 선수들로 바뀌어요</p>
              )}
              {testRows}
              <div className="mt-auto flex items-center justify-end">
                <Btn className={`${font.title} px-10 py-2.5 text-xl`} onClick={playPractice}>
                  PLAY BALL
                </Btn>
              </div>
            </div>
          )}

          {screen === "derby" && (
            <div className="flex h-full flex-col gap-4 px-8 py-6">
              <div className="flex items-center justify-between">
                <span className={`${font.title} text-[28px]`} style={{ color: "#ffd23f" }}>
                  홈런 더비
                </span>
                <Btn className="px-4 py-1.5 text-sm" color="#8b93b8" onClick={() => setScreen("title")}>
                  ← 뒤로
                </Btn>
              </div>
              <p className="text-[13px] leading-relaxed text-white/70">
                홈런이 아니면 전부 아웃 · 스트라이크를 그냥 보내도 아웃 · 아웃 10개까지 비거리 합계.
                <br />
                가운데 담장 너머 <b className="text-[#ffd23f]">GOLD 보드</b>를 넘기면 +300m.
              </p>
              <Row label="봇 난이도">
                {([0, 1, 2] as Diff[]).map((d) => (
                  <Btn key={d} active={diff === d} className="px-4 py-1.5 text-sm" onClick={() => setDiff(d)}>
                    {DIFF_NAME[d]}
                  </Btn>
                ))}
              </Row>
              {testRows}
              <div className="mt-auto flex justify-end">
                <Btn className={`${font.title} px-10 py-2.5 text-xl`} color="#ffd23f" onClick={() => start({ mode: "derby", diff, innings: 1, userHome: true, testPit })}>
                  시작
                </Btn>
              </div>
            </div>
          )}

          {screen === "howto" && (
            <div className="flex h-full flex-col gap-3 px-10 py-6">
              <div className="flex items-center justify-between">
                <span className={`${font.title} text-[28px]`} style={{ color: "#7ad7ff" }}>
                  조작법
                </span>
                <Btn className="px-4 py-1.5 text-sm" color="#8b93b8" onClick={() => setScreen("title")}>
                  ← 뒤로
                </Btn>
              </div>
              <div className="grid grid-cols-2 gap-4 text-[13.5px] leading-relaxed text-white/80">
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <div className={`${font.title} mb-2 text-lg text-[#ffd23f]`}>타격</div>
                  <p>공이 홈플레이트에 닿는 순간에 맞춰 <Key>Space</Key> · 마우스 클릭 · 폰은 <b>스윙 버튼</b>.</p>
                  <p>빠르면 당겨 치고, 늦으면 밀어 쳐요. 가운데 맞추면 <b className="text-[#ffd23f]">PERFECT</b>.</p>
                  <p>
                    <Key>방향키</Key> · <Key>WASD</Key> · 폰은 <b>이동 패드</b>로 <b className="text-[#ffbe5a]">주황 상자</b>를 옮겨요 — 공이 날아오는 동안에도. <b className="text-[#6ab8ff]">파란 원</b>이 지금 공이 존 어디쯤인지 보여 줘요. 원을 따라가 상자 안에 넣고 치면 정타.
                  </p>
                  <p>존 밖 공은 휘두르면 빗맞아요 — 참으면 볼넷.</p>
                  <p><Key>B</Key> 번트 자세 · <Key>K</Key> 필살타법 — 공이 날아올 때 스윙 대신 누르면 그 자리에서 특별한 스윙 — 인연에서 배운 선수만 · 경기당 1번, 마스터하면 2번 · 앞으로 보내야 씀</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <div className={`${font.title} mb-2 text-lg text-[#7ad7ff]`}>투구</div>
                  <p>① 구종 <Key>1</Key>~<Key>4</Key> ② 코스: 존을 누르거나 끌기 · <Key>←↑↓→</Key></p>
                  <p>③ <Key>Space</Key>/던지기 → 게이지가 오르내림 → 다시 눌러 멈추기.</p>
                  <p><b className="text-[#ffd23f]">MAX</b> 근처면 빠르고 날카로운 공, 너무 낮으면 <b className="text-[#ff7a7a]">실투</b>(한가운데로 밋밋).</p>
                  <p>지치면 게이지가 빨라져요 → <b>교체</b> 버튼.</p>
                </div>
                <div className="col-span-2 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <div className={`${font.title} mb-2 text-lg text-[#FF8A3D]`}>그 밖에</div>
                  <p>수비 · 주루는 자동 — 타구 속도 · 각도 · 수비 위치 · 주자 발로 판정. 필드 화면은 터치하면 빨리감기.</p>
                  <p>돌발미션: 감독 · 주장 · 선배가 갑자기 미션을 줘요. 성공하면 보상.</p>
                  <p>인연 대결의 마구는 궤적이 정해져 있어요 — 컷인에 나오는 힌트대로 치면 칠 수 있어요.</p>
                </div>
              </div>
            </div>
          )}
        </MenuBg>
      )}
    </div>
  );
}

function Key({ children }: { children: ReactNode }) {
  return <kbd className="mx-0.5 rounded border border-white/25 border-b-[3px] bg-white/[0.08] px-1.5 font-mono text-[11px]">{children}</kbd>;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-[84px] text-[13px] font-bold text-white/70">{label}</span>
      {children}
    </div>
  );
}

// ───────────── 경기 화면 ─────────────
function Play({
  cfg,
  onExit,
  onAgain,
  onCareerDone,
  onOver,
  note,
  online,
  onAbandon,
}: {
  cfg: MatchCfg;
  onExit: () => void;
  onAgain: () => void;
  onCareerDone: (m: Match) => void;
  /** 경기 끝 (한 번) — 온라인 대전 기록 */
  onOver?: (win: boolean | null, score: string) => void;
  /** 결과 창에 덧붙일 줄 */
  note?: string | null;
  /** 온라인 대전 (다시 하기 대신 새 상대 · 나가면 패배) */
  online?: boolean;
  /** 경기 도중 나감 (온라인 패배 기록) */
  onAbandon?: (m: Match) => void;
}) {
  const { k, fs, canFs, toggleFs } = useStage();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const matchRef = useRef<Match | null>(null);
  const [m, setM] = useState<Match | null>(null);
  const [ui, setUi] = useState<UiState | null>(null);
  const [menu, setMenu] = useState(false);
  const [bullpen, setBullpen] = useState(false);
  const [muted, setMute] = useState(isMuted());
  // 캔버스 해상도 상한 (느린 기기면 자동으로 낮춤)
  // 느린 기기에서 낮춘 해상도 상한은 다음 경기에도 이어서 (예전엔 경기마다 2배로 돌아가 초반 몇 초씩 버벅임)
  const [qCap, setQCap] = useState(() => sessionQCap);
  const qCapRef = useRef(sessionQCap);
  // 터치 화면에서만 스윙 · 번트 버튼 · 이동 패드 (PC 는 단축키: Space · B · 방향키)
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(any-pointer: coarse)");
    const on = () => setTouch(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const down = useRef(false);
  const overDone = useRef(false);
  useEffect(() => {
    if (!ui?.over || overDone.current || !m) return;
    overDone.current = true;
    onOver?.(ui.over.win, `${ui.over.score[0]}:${ui.over.score[1]}`);
  }, [ui?.over, m, onOver]);

  useEffect(() => {
    const m = new Match(cfg, setUi);
    matchRef.current = m;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 처음 상태
    setUi(m.ui);
    setM(m);
    // 개발 중 자동 테스트용 (배포 빌드엔 안 들어감)
    if (process.env.NODE_ENV !== "production") Object.assign(window, { __pxb: m, __pxbChance: CHANCE });
    let raf = 0;
    let last = performance.now();
    // 느린 기기: 프레임이 계속 늦으면(평균 22ms 넘게 1.5초) 캔버스 해상도를 한 단계씩 낮춤 (2 → 1.75 → … → 1)
    let ema = 16;
    let slowFor = 0;
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      if (dt < 0.25 && !document.hidden) {
        ema = ema * 0.92 + dt * 1000 * 0.08;
        slowFor = ema > 22 ? slowFor + dt : 0;
        if (slowFor > 1.5 && qCapRef.current > 1) {
          qCapRef.current = Math.max(1, qCapRef.current - 0.25);
          slowFor = 0;
          ema = 16;
          setQCap(qCapRef.current);
          sessionQCap = qCapRef.current;
        }
      }
      m.update(dt);
      const cv = canvasRef.current;
      if (cv) {
        const ctx = cv.getContext("2d");
        if (ctx) {
          const q = cv.width / DW;
          ctx.setTransform(q, 0, 0, q, 0, 0);
          ctx.imageSmoothingEnabled = true;
          m.draw(ctx, q);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [cfg]);

  // 캔버스 해상도 = 화면 픽셀
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !k) return;
    // 해상도 상한 2배 (3배면 1440p 전체화면에서 3072×1728 — 내장 그래픽에서 프레임이 떨어짐) · 느리면 qCap 이 더 낮아짐
    const q = Math.min(qCap, Math.max(1, k * (window.devicePixelRatio || 1)));
    cv.width = Math.round(DW * q);
    cv.height = Math.round(DH * q);
  }, [k, qCap]);

  const toDesign = useCallback((e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * DW, y: ((e.clientY - r.top) / r.height) * DH };
  }, []);

  // 키보드
  useEffect(() => {
    // 타자 이동 (컨택존): 누르고 있는 방향키 · WASD
    const held = new Set<string>();
    const DIRS: Record<string, [number, number]> = { arrowleft: [-1, 0], a: [-1, 0], arrowright: [1, 0], d: [1, 0], arrowup: [0, 1], w: [0, 1], arrowdown: [0, -1], s: [0, -1] };
    const pushMove = () => {
      const m = matchRef.current;
      if (!m) return;
      let x = 0;
      let y = 0;
      for (const k of held) {
        x += DIRS[k][0];
        y += DIRS[k][1];
      }
      m.setBatMove(x, y);
    };
    const onUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (held.delete(k)) pushMove();
    };
    const onKey = (e: KeyboardEvent) => {
      const m = matchRef.current;
      if (!m) return;
      // 경기 중엔 스페이스 · 방향키로 페이지가 스크롤되지 않게 — 꾹 누름(반복) · 일시정지 중에도 (예전엔 그때 스크롤됐음)
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (!typing && (e.key === " " || e.key.startsWith("Arrow"))) e.preventDefault();
      const k0 = e.key.toLowerCase();
      if (DIRS[k0] && m.ui.userBat && !m.paused) {
        e.preventDefault();
        if (!held.has(k0)) {
          held.add(k0);
          pushMove();
        }
        return;
      }
      if (e.repeat) return;
      if (e.key === "Escape") {
        setMenu((v) => {
          m.setPaused(!v);
          return !v;
        });
        return;
      }
      if (m.paused) return;
      const k = e.key.toLowerCase();
      if (m.phase === "chance") {
        if (k === " " || k === "j" || k === "enter") m.chanceKey();
        else if (k === "n") m.chooseSteal(false);
        return;
      }
      if (k === " " || k === "j" || k === "enter") {
        e.preventDefault();
        if (m.ui.userBat) m.pressSwing();
        else if (m.phase === "field") m.skipField();
        else m.pressThrow();
      } else if (k === "b") m.toggleBunt();
      else if (k === "k" || k === "m") m.toggleSpecial();
      else if (["1", "2", "3", "4"].includes(k)) m.selectKind(Number(k) - 1);
      else if (k === "arrowleft" || k === "a") (e.preventDefault(), m.moveAim(-1, 0));
      else if (k === "arrowright" || k === "d") (e.preventDefault(), m.moveAim(1, 0));
      else if (k === "arrowup" || k === "w") (e.preventDefault(), m.moveAim(0, 1));
      else if (k === "arrowdown" || k === "s") (e.preventDefault(), m.moveAim(0, -1));
      else if (k === "f") m.toggleFast();
      else if (k === "v") setFieldView(!FIELD_VIEW.persp);
    };
    const onBlur = () => {
      held.clear();
      pushMove();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const pause = (v: boolean) => {
    setMenu(v);
    m?.setPaused(v);
  };

  return (
    <div className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        width={DW}
        height={DH}
        className="absolute inset-0 block"
        style={{ width: DW, height: DH, touchAction: "none" }}
        onPointerDown={(e) => {
          const mm = matchRef.current;
          if (!mm) return;
          down.current = true;
          const p = toDesign(e);
          if (mm.phase === "aim" && !mm.ui.userBat) mm.aimAt(p.x, p.y);
          else mm.tap(p.x, p.y, !touch);
        }}
        onPointerMove={(e) => {
          const mm = matchRef.current;
          if (!mm || !down.current || mm.phase !== "aim" || mm.ui.userBat) return;
          const p = toDesign(e);
          mm.aimAt(p.x, p.y);
        }}
        onPointerUp={() => {
          down.current = false;
        }}
      />

      {ui && !ui.over && (
        <>
          {/* 오른쪽 조작 칸 (필드 화면 · 결과 문구 동안은 숨김) */}
          <div
            className="absolute top-[112px] right-3 flex w-[164px] flex-col items-stretch gap-2 transition-opacity"
            style={{ opacity: ["field", "result", "change", "contact", "intro", "recap", "mission", "chance"].includes(ui.phase) ? 0 : 1, pointerEvents: ["field", "result", "change", "contact", "intro", "recap", "mission", "chance"].includes(ui.phase) ? "none" : undefined }}
          >
            {ui.userBat && (
              <>
                {touch && ui.mode !== "derby" && (
                  <button
                    type="button"
                    disabled={!(ui.phase === "ready" || ui.phase === "windup")}
                    onClick={() => m?.toggleBunt()}
                    className={`${font.title} flex h-[52px] items-center justify-center gap-2 rounded-2xl border-2 text-[22px] text-white transition disabled:opacity-40 ${ui.bunt ? "border-[#7ad7ff] bg-[#1d4f8a] shadow-[0_0_14px_#7ad7ff99]" : "border-[#3d7fd8] bg-gradient-to-b from-[#16294f] to-[#0b1530]"}`}
                  >
                    <img src="/baseball/ui/bunt.webp" alt="" className="h-[26px] w-auto" draggable={false} />
                    번트
                    <span className="font-['Nanum_Gothic'] text-[11px] font-normal opacity-60">B</span>
                  </button>
                )}
                {touch && ui.spHero && ui.spChar && <SpecialBtn ui={ui} round onPress={() => m?.toggleSpecial()} />}
                {/* 터치: 스윙은 이 버튼으로만 · 엄지가 편하게 화면 가운데 쪽 아래로 조금 */}
                {touch && (
                  <div className="transition-opacity duration-200" style={{ transform: "translate(-34px, 56px)", opacity: ui.cards ? 0.35 : 1, pointerEvents: ui.cards ? "none" : undefined }}>
                    <RoundBtn img="/baseball/ui/swing.webp" imgDown="/baseball/ui/swing-down.webp" label="스윙" disabled={!ui.canSwing} onClick={() => m?.pressSwing()} />
                  </div>
                )}
              </>
            )}
            {!ui.userBat && (
              <>
                <div className="grid grid-cols-2 gap-1.5">
                  {ui.kinds.map((kd, i) => (
                    <Btn key={kd.id} active={ui.kind === i} disabled={!ui.aiming} className="py-1.5 text-[13px]" color="#7ad7ff" onClick={() => m?.selectKind(i)}>
                      <span className="block text-[10px] font-normal opacity-60">{i + 1}</span>
                      {kd.name}
                    </Btn>
                  ))}
                </div>
                {ui.spHero && (
                  <Btn active={ui.spArmed} disabled={!(ui.aiming || ui.gauging) || (ui.spLeft <= 0 && !ui.spArmed)} className={`${font.title} py-1.5 text-[14px] leading-tight`} color="#ff5fb4" onClick={() => m?.toggleSpecial()}>
                    마구 ({ui.spLeft})<span className="block text-[11px] font-normal opacity-80">{ui.spName} · M</span>
                  </Btn>
                )}
                <RoundBtn
                  img="/baseball/ui/throw.webp"
                  label={ui.gauging ? "STOP!" : "던지기"}
                  sub="Space"
                  size={136}
                  hot={ui.gauging}
                  disabled={!(ui.aiming || ui.gauging)}
                  onClick={() => m?.pressThrow()}
                />
                {ui.mode === "game" && (
                  <Btn disabled={!ui.aiming} className="py-1.5 text-[13px]" color="#8b93b8" onClick={() => setBullpen(true)}>
                    투수 교체
                  </Btn>
                )}
              </>
            )}
          </div>

          {/* 필살타법 (PC): 타자 반대쪽 아래 — 컷인이 나오는 쪽 */}
          {!touch && ui.userBat && ui.spHero && ui.spChar && !["field", "result", "change", "intro", "recap", "mission"].includes(ui.phase) && (
            <div className="absolute bottom-4 transition-opacity duration-200" style={{ ...(ui.lefty ? { left: 16 } : { right: 16 }), opacity: ui.cards ? 0 : 1, pointerEvents: ui.cards ? "none" : undefined }}>
              <SpecialBtn ui={ui} onPress={() => m?.toggleSpecial()} />
            </div>
          )}

          {/* 타자 이동 패드 (터치) — 투구 전에 끌어서 타자 · 컨택존 옮기기 */}
          {touch && ui.userBat && !["field", "result", "change", "recap", "mission"].includes(ui.phase) && <MovePad active={ui.canMove} onMove={(x, y) => m?.setBatMove(x, y)} />}

          {/* 아래: 메뉴 · 빨리감기 (필드 화면에선 홈플레이트를 안 가리게 오른쪽 위로) */}
          {ui.fieldPlaying && (
            <div className="absolute top-[112px] right-3 flex flex-col items-end gap-2">
              <Btn active={ui.fast} className="px-3 py-1.5 text-[13px]" color="#7dff9a" onClick={() => m?.toggleFast()}>
                ▶▶ 빨리
              </Btn>
              <Btn className="px-3 py-1.5 text-[13px]" color="#7dff9a" onClick={() => m?.skipField()}>
                건너뛰기
              </Btn>
              {/* 비교용: 탑뷰 ↔ 3/4 시점 (다음 타구부터가 아니라 바로) */}
              <Btn className="px-3 py-1.5 text-[13px]" color="#7ad7ff" onClick={() => setFieldView(!FIELD_VIEW.persp)}>
                시점 바꾸기 · V
              </Btn>
            </div>
          )}
          {/* 육성 도루 찬스: 뛴다 / 그대로 (그림은 캔버스) */}
          {ui.chance?.kind === "steal" && (
            <div className="absolute top-[330px] left-1/2 z-10 flex -translate-x-1/2 gap-3">
              <Btn className={`${font.title} w-[200px] py-3 text-[24px]`} color="#ffcf3a" active onClick={() => m?.chooseSteal(true)}>
                도루! <span className="font-['Nanum_Gothic'] text-[11px] font-normal opacity-60">Space</span>
              </Btn>
              <Btn className={`${font.title} w-[160px] py-3 text-[20px]`} color="#8b93b8" onClick={() => m?.chooseSteal(false)}>
                그대로 <span className="font-['Nanum_Gothic'] text-[11px] font-normal opacity-60">N</span>
              </Btn>
            </div>
          )}
          {/* 헤더 (맨 위 가운데): 배속 · 메뉴 · 전체화면 */}
          {/* (경기 요약 화면에선 점수표를 가리지 않게 오른쪽 아래로) */}
          <div className={`absolute flex gap-1.5 ${ui.phase === "recap" ? "right-4 bottom-[6px]" : "top-[14px] left-1/2 -translate-x-1/2"}`}>
            <Btn
              className={`${touch ? "px-4 py-2 text-[16px]" : "px-3 py-1 text-[13px]"} font-mono`}
              color="#7dff9a"
              onClick={() => {
                const i = SPEEDS.indexOf(ui.speed as (typeof SPEEDS)[number]);
                const v = SPEEDS[(i + 1) % SPEEDS.length];
                saveSpeed(v);
                m?.setSpeed(v);
              }}
            >
              배속 ×{ui.speed}
            </Btn>
            {ui.career && (
              <Btn className={touch ? "px-4 py-2 text-[16px]" : "px-3 py-1.5 text-[13px]"} color={ui.career.next ? "#ffd23f" : "#8b93b8"} active={!!ui.career.next} onClick={() => pause(true)}>
                {ui.career.next ? `다음 타석부터 ${ui.career.next === "auto" ? "자동" : ui.career.next === "highlight" ? "하이라이트" : "직접"}` : ui.career.mode === "highlight" ? "하이라이트 중" : "직접 출전 중"}
              </Btn>
            )}
            <Btn className={touch ? "px-4 py-2 text-[16px]" : "px-3 py-1 text-[13px]"} color="#8b93b8" onClick={() => pause(true)}>
              ❚❚ 메뉴
            </Btn>
            {canFs && (
              <Btn className={touch ? "px-4 py-2 text-[16px]" : "px-3 py-1 text-[13px]"} color="#8b93b8" onClick={toggleFs}>
                {fs ? "창 모드" : "⛶"}
              </Btn>
            )}
          </div>
        </>
      )}

      {bullpen && ui && (
        <Modal>
          <div className={`${font.title} mb-3 text-2xl`}>투수 교체</div>
          <div className="flex flex-col gap-2">
            {ui.bullpen.map((p) => (
              <Btn
                key={p.idx}
                disabled={p.used || p.cur}
                className="flex items-center justify-between px-4 py-2 text-left text-[14px]"
                color={p.hero ? "#ff5fb4" : "#7ad7ff"}
                onClick={() => {
                  m?.changePitcherTo(p.idx);
                  setBullpen(false);
                }}
              >
                <span>
                  {p.hero && "★ "}
                  {p.name}
                </span>
                <span className="text-[12px] font-normal opacity-70">{p.cur ? "던지는 중" : p.used ? "강판" : p.role}</span>
              </Btn>
            ))}
          </div>
          <Btn space className="mt-3 w-full py-2 text-sm" color="#8b93b8" onClick={() => setBullpen(false)}>
            닫기
          </Btn>
        </Modal>
      )}

      {menu && (
        <Modal>
          <div className={`${font.title} mb-4 text-3xl`}>일시정지</div>
          <div className="flex flex-col gap-2">
            <Btn space className="py-2.5 text-lg" onClick={() => pause(false)}>
              계속하기
            </Btn>
            {ui?.career && (
              <div className="rounded-xl border border-white/10 bg-black/30 p-2">
                <div className="mb-1.5 text-[12px] text-white/60">남은 타석 진행 방식 — 지금 타석이 끝난 다음부터 적용</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {(["direct", "highlight", "auto"] as const).map((k) => {
                    const cur = ui.career!.mode === k && !ui.career!.next;
                    const next = ui.career!.next === k;
                    return (
                      <Btn key={k} active={cur || next} color={k === "auto" ? "#7ad7ff" : next ? "#ffd23f" : ACCENT} className="px-1 py-1.5 text-[12px] leading-tight" onClick={() => m?.setAfterMode(k)}>
                        {k === "direct" ? "직접" : k === "highlight" ? "하이라이트" : "끝까지 자동"}
                        <span className="block text-[10px] font-normal opacity-75">{cur ? "지금" : next ? "다음 타석부터" : k === "auto" ? "남은 타석 스킵" : "찬스만 직접"}</span>
                      </Btn>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="flex items-center justify-center gap-1">
              <span className="mr-1 text-[12px] text-white/60">배속</span>
              {SPEEDS.map((v) => (
                <Btn
                  key={v}
                  active={ui?.speed === v}
                  color="#7dff9a"
                  className="px-2 py-1 font-mono text-[12px]"
                  onClick={() => {
                    saveSpeed(v);
                    m?.setSpeed(v);
                  }}
                >
                  ×{v}
                </Btn>
              ))}
            </div>
            <Btn
              className="py-2 text-sm"
              color="#7ad7ff"
              onClick={() => {
                setMuted(!muted);
                setMute(!muted);
              }}
            >
              소리 {muted ? "켜기" : "끄기"}
            </Btn>
            {cfg.career && ui?.canCancel && (
              <Btn
                className="py-2 text-sm"
                color="#ffd23f"
                onClick={() => {
                  cancelDirect();
                  onExit();
                }}
              >
                ↩ 경기 시작 취소 — 육성 화면으로
              </Btn>
            )}
            <Btn
              className="py-2 text-sm"
              color="#ff7a7a"
              onClick={() => {
                if (cfg.career && !cfg.bond && m) {
                  // 친 건 그대로 · 남은 경기만 자동
                  m.autoRest();
                  onCareerDone(m);
                  return;
                }
                if (m) onAbandon?.(m);
                onExit();
              }}
            >
              {cfg.career ? "나가기 — 남은 경기는 자동" : cfg.bond ? "나가기 — 다음에 다시 도전" : online ? "나가기 — 던진 공이 있으면 패배" : "메뉴로 나가기"}
            </Btn>
          </div>
        </Modal>
      )}

      {ui?.over && (
        <Modal wide>
          {ui.over.bond ? (
            <>
              <div className={`${font.title} text-[44px]`} style={{ color: ui.over.win ? "#ffd23f" : "#ff7a7a" }}>
                {ui.over.win ? "승리!" : "아쉽다…"}
              </div>
              <div className="font-mono text-2xl">
                {ui.over.bond.pts} / {ui.over.bond.need}점
              </div>
              <div className="mt-1 text-[14px] text-white/70">{ui.over.win ? "인연이 한 걸음 깊어졌다" : "다음에 만나면 다시 도전할 수 있어요"}</div>
            </>
          ) : ui.over.derby ? (
            <>
              <div className={`${font.title} text-[40px] text-[#ffd23f]`}>{ui.over.derby.dist.toLocaleString()}m</div>
              <div className="mt-1 text-white/70">
                홈런 {ui.over.derby.hr}개 · 최고 기록 {ui.over.derby.best.toLocaleString()}m
              </div>
            </>
          ) : (
            <>
              <div className={`${font.title} text-[44px]`} style={{ color: ui.over.win ? "#ffd23f" : ui.over.win === null ? "#fff" : "#ff7a7a" }}>
                {ui.over.win ? "승리!" : ui.over.win === null ? "무승부" : "패배"}
              </div>
              <div className="font-mono text-2xl">
                {m?.s.opts.away.short} {ui.over.score[0]} : {ui.over.score[1]} {m?.s.opts.home.short}
              </div>
              {m && <LineScore m={m} />}
              {ui.over.mvp && <div className="mt-2 text-[14px] text-white/80">{cfg.career ? `오늘 내 기록 · ${ui.over.mvp}` : `MVP · ${ui.over.mvp}`}</div>}
            </>
          )}
          {cfg.career || cfg.bond ? (
            <div className="mt-4 flex justify-center">
              <Btn space className={`${font.title} px-10 py-3 text-xl`} onClick={() => m && onCareerDone(m)}>
                육성 화면으로
              </Btn>
            </div>
          ) : (
          <>
          <div className="mt-2 text-[15px] text-[#ffd23f]">+{ui.over.pt} 코인</div>
          {note && <div className="mt-1 text-[14px] font-bold text-[#7dff9a]">{note}</div>}
          <div className="mt-4 flex justify-center gap-3">
            <Btn space className="px-6 py-2.5 text-lg" onClick={onAgain}>
              {online ? "새 상대 찾기" : "다시 하기"}
            </Btn>
            <Btn className="px-6 py-2.5 text-lg" color="#8b93b8" onClick={onExit}>
              메뉴로
            </Btn>
          </div>
          </>
          )}
        </Modal>
      )}
    </div>
  );
}

function LineScore({ m }: { m: Match }) {
  const s = m.s;
  const n = Math.max(s.opts.innings, s.line[0].length, s.line[1].length);
  const cols = Array.from({ length: n }, (_, i) => i);
  return (
    <table className="mx-auto mt-3 border-collapse font-mono text-[13px]">
      <thead>
        <tr className="text-white/50">
          <th className="px-2 text-left font-normal" />
          {cols.map((i) => (
            <th key={i} className="w-6 font-normal">
              {i + 1}
            </th>
          ))}
          <th className="px-2 font-normal">R</th>
          <th className="px-2 font-normal">H</th>
        </tr>
      </thead>
      <tbody>
        {[0, 1].map((t) => (
          <tr key={t}>
            <td className="px-2 text-left font-bold" style={{ color: t ? s.opts.home.color : s.opts.away.color }}>
              {t ? s.opts.home.short : s.opts.away.short}
            </td>
            {cols.map((i) => (
              <td key={i} className="text-center text-white/85">
                {s.line[t][i] ?? (t === 1 && i === n - 1 && s.winner === 1 ? "X" : "")}
              </td>
            ))}
            <td className="px-2 text-center font-bold">{s.score[t]}</td>
            <td className="px-2 text-center text-white/70">{s.sides[t].hits}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 타자 이동 패드: 가운데 원을 끌면 그 방향으로 (화면 위 = 위). 손 떼면 멈춤 */
/** 둥근 그림 버튼 (스윙 · 던지기) — GPT 그림 위에 글자, 누르면 살짝 눌림 */
/**
 * 필살타법 버튼 — 캐릭터 얼굴 + 퍼스널 컬러 링. 공이 날아오는 동안만 불이 들어오고 누르면 그 자리에서 특별한 스윙.
 * round: 터치용 동그라미 (스윙 버튼 위) · 아니면 PC 칩 (K 키)
 */
function SpecialBtn({ ui, round, onPress }: { ui: UiState; round?: boolean; onPress: () => void }) {
  const ch = charById(ui.spChar!);
  const left = ui.mode === "derby" && !ui.career ? 99 : ui.spLeft;
  const used = left <= 0;
  const now = ui.spNow;
  const state = used ? "사용함" : now ? "지금!" : "공이 오면";
  const ring = used ? "#555" : ch.color;
  const face = (sz: number) => (
    <span
      className={`relative block shrink-0 rounded-full p-[3px] ${now ? "animate-spin" : ""}`}
      style={{
        animationDuration: "1.1s",
        width: sz,
        height: sz,
        background: now ? `conic-gradient(from 0deg, ${ring}, #fff, ${ring}, #fff, ${ring})` : ring,
        boxShadow: now ? `0 0 18px ${ring}, 0 0 4px #fff` : "0 2px 6px rgba(0,0,0,0.5)",
      }}
    >
      <img
        src={faceUrl(ch.id)}
        alt=""
        draggable={false}
        className={`block h-full w-full rounded-full bg-[#120b1e] object-cover ${now ? "animate-spin" : ""}`}
        style={{ filter: used ? "grayscale(1) brightness(0.6)" : undefined, animationDuration: "1.1s", animationDirection: "reverse" }}
      />
    </span>
  );
  if (round)
    return (
      <button type="button" disabled={used} onClick={onPress} className="relative mx-auto flex select-none flex-col items-center gap-0.5 transition-transform active:scale-95">
        {face(84)}
        <span className={`${font.title} text-[15px] leading-none`} style={{ color: used ? "#999" : ch.color, WebkitTextStroke: "1px rgba(0,0,0,0.8)", paintOrder: "stroke" }}>
          {ch.swing.name}
        </span>
        <span className="text-[10px] text-white/60">필살타법 · {state}</span>
      </button>
    );
  return (
    <button
      type="button"
      disabled={used}
      onClick={onPress}
      className="flex select-none items-center gap-2.5 rounded-2xl border-2 py-1.5 pr-3 pl-1.5 text-left transition-[transform,box-shadow] active:scale-95"
      style={{
        borderColor: used ? "rgba(255,255,255,0.15)" : ring,
        background: used ? "rgba(10,8,18,0.75)" : `linear-gradient(100deg, ${ring}55, rgba(10,8,18,0.88) 60%)`,
        boxShadow: now ? `0 0 22px ${ring}aa` : undefined,
        transform: now ? "scale(1.05)" : undefined,
      }}
    >
      {face(52)}
      <span className="flex flex-col leading-tight">
        <span className="text-[11px] text-white/65">필살타법 · {used ? "사용함" : ui.mode === "derby" && !ui.career ? "무제한" : `${left}번`}</span>
        <span className={`${font.title} text-[19px]`} style={{ color: used ? "#888" : ch.color, WebkitTextStroke: "1px rgba(0,0,0,0.7)", paintOrder: "stroke" }}>
          {ch.swing.name}
        </span>
      </span>
      <span className="ml-1 flex flex-col items-center gap-0.5">
        <span
          className="grid h-8 w-8 place-items-center rounded-lg border-b-4 text-[16px] font-black"
          style={{ background: now ? "#fff" : "rgba(255,255,255,0.12)", color: now ? "#120b1e" : "#fff", borderColor: now ? ring : "rgba(0,0,0,0.5)" }}
        >
          K
        </span>
        <span className="text-[10px] font-bold whitespace-nowrap" style={{ color: now ? "#fff" : "rgba(255,255,255,0.5)" }}>
          {state}
        </span>
      </span>
    </button>
  );
}

function RoundBtn({ img, imgDown, label, sub, onClick, disabled, hot, size = 150 }: { img: string; imgDown?: string; label: string; sub?: string; onClick: () => void; disabled?: boolean; hot?: boolean; size?: number }) {
  const [down, setDown] = useState(false);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      onPointerDown={() => setDown(true)}
      onPointerUp={() => setDown(false)}
      onPointerLeave={() => setDown(false)}
      className="relative mx-auto block select-none transition-[transform,filter,opacity] duration-75 disabled:opacity-45 disabled:saturate-50"
      style={{ width: size, height: size, transform: down ? "scale(0.94)" : hot ? "scale(1.04)" : undefined, filter: hot ? "drop-shadow(0 0 14px #ffd23f)" : undefined }}
    >
      <img src={down && imgDown ? imgDown : img} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full object-contain" />
      <span
        className={`${font.title} pointer-events-none absolute inset-x-0 text-center text-white`}
        style={{ bottom: size * 0.2, fontSize: size * 0.2, WebkitTextStroke: "1.5px rgba(70,25,0,0.9)", paintOrder: "stroke", textShadow: "0 2px 4px rgba(0,0,0,0.5)" }}
      >
        {label}
      </span>
      {sub && <span className="pointer-events-none absolute inset-x-0 -bottom-4 text-center font-['Nanum_Gothic'] text-[10.5px] text-white/60">{sub}</span>}
    </button>
  );
}

function MovePad({ active, onMove }: { active: boolean; onMove: (x: number, y: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const R = 56;
  const move = (e: { clientX: number; clientY: number }) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const k = r.width / (R * 2 + 24);
    let dx = (e.clientX - (r.left + r.width / 2)) / k;
    let dy = (e.clientY - (r.top + r.height / 2)) / k;
    const l = Math.hypot(dx, dy);
    if (l > R) {
      dx = (dx / l) * R;
      dy = (dy / l) * R;
    }
    setKnob({ x: dx, y: dy });
    // 가운데 살짝은 안 움직임 (손 떨림)
    const n = Math.hypot(dx, dy) / R;
    onMove(n < 0.18 ? 0 : dx / R, n < 0.18 ? 0 : -dy / R);
  };
  const end = () => {
    setKnob({ x: 0, y: 0 });
    onMove(0, 0);
  };
  // 공이 출발해 패드가 꺼지거나 화면이 바뀌면 입력을 꼭 풀어 줌 (다음 공 때 타자가 혼자 미끄러지지 않게)
  const endRef = useRef(end);
  useEffect(() => {
    endRef.current = end;
  });
  useEffect(() => {
    if (!active) endRef.current();
  }, [active]);
  useEffect(() => () => endRef.current(), []);
  return (
    <div
      ref={ref}
      className="absolute left-4 select-none rounded-full transition-opacity"
      style={{ bottom: 162, width: R * 2 + 24, height: R * 2 + 24, opacity: active ? 1 : 0.4, touchAction: "none", pointerEvents: active ? undefined : "none", backgroundImage: "url(/baseball/ui/pad.webp)", backgroundSize: "100% 100%" }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e);
      }}
      onPointerMove={(e) => {
        if (e.buttons || e.pointerType === "touch") move(e);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
    >
      <img
        src="/baseball/ui/knob.webp"
        alt=""
        draggable={false}
        className="pointer-events-none absolute top-1/2 left-1/2"
        style={{ width: 52, height: 52, transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }}
      />
      <div className="pointer-events-none absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-white/55">타자 이동 · 방향키</div>
    </div>
  );
}

/** 이번 접속 동안의 캔버스 해상도 상한 (Play 가 다시 열려도 유지) */
let sessionQCap = 2;
