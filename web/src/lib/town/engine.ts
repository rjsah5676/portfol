/*
 * TABLE TOWN 엔진 — 마을(옆 시점 거리) → 대기실 → 원카드(4인, 봇 3) → 결과.
 * React 는 무대(Stage)만 잡고, 안쪽은 이 파일이 DOM 을 직접 그림 (1280 × 720 디자인, 무대가 통째로 키우고 줄임).
 * 그림은 assets.ts 의 ART 에 주소가 있으면 그 그림, 없으면 코드로 그린 임시 모양.
 */
import { BGM, SFX, SFX_B, allSound, createSound, type BgmId, type SfxId } from "./sound";
import { ART, SIGN, SIGN2, allArt, type CharId, type Face, type GameId, type LookId, type UiIcon } from "./assets";
import { CHARS, GACHA, GAMES, REWARD, loadProfile, ownKey, rollGacha, saveProfile, type Profile, type Pull } from "./data";
import { MODES, playable as ocPlayable, type Card, type GameMode, type OCEvent, type OCState, type OCView } from "./onecard";
import { errCode, errText, type TownHost, type TownNet } from "./net";
import { GLYPHS } from "./glyphs";

export const DW = 1280;
export const DH = 720;

type Screen = "loading" | "title" | "lobby" | "town" | "room" | "game" | "gacha";

const SU = ["♠", "♥", "♦", "♣"];
const rl = (r: number) => ({ 11: "J", 12: "Q", 13: "K", 14: "A" })[r as 11] ?? String(r);
const isRed = (c: Card) => c.s === 1 || c.s === 2;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(a: readonly T[]) => a[(Math.random() * a.length) | 0];
const FACE_EMOJI: Record<Face, string> = { idle: "🙂", happy: "😄", sad: "😭", smug: "😈", panic: "😳", win: "🥳" };

const ICON_FALLBACK: Record<UiIcon, string> = {
  coin: "🪙",
  shop: "🎁",
  char: "👗",
  mission: "📜",
  mail: "✉",
  settings: "⚙",
  chat: "💬",
  list: "🎴",
  emote: "☺",
  sort: "🂠",
};
const icon = (k: UiIcon, cls = "") =>
  ART.icon[k] ? `<img class="tt-ico ${cls}" src="${ART.icon[k]}" alt="" draggable="false">` : `<span class="tt-ico ${cls}">${ICON_FALLBACK[k]}</span>`;

/** 화살표: 글자(›, ←) 대신 둥근 끝 SVG */
const CHEV = `<svg class="tt-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4.5 16.5 12 9 19.5"/></svg>`;
const BACK = `<svg class="tt-home" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 11.2 12 4l8.5 7.2V20a1 1 0 0 1-1 1h-5v-6h-5v6h-5a1 1 0 0 1-1-1z"/></svg>`;

const TEMPLATE = `
<div class="tt-screen tt-loading" data-s="loading">
  <div class="tt-load-in">
    <div class="tt-logo">${ART.logo ? `<img src="${ART.logo}" alt="TABLE TOWN">` : "TABLE TOWN"}</div>
    <div class="tt-bar"><i></i></div>
    <p class="tt-ltxt">마을 준비 중… 0%</p>
  </div>
</div>

<div class="tt-screen tt-town" data-s="town" hidden>
  <div class="tt-sky"></div>
  <div class="tt-hills"></div>
  <div class="tt-world"></div>
  <div class="tt-ui tt-prof" role="button" tabindex="0"><div class="tt-prof-avw"><div class="tt-av tt-prof-av"></div><span class="tt-lvb"></span></div><div class="tt-prof-info"><div class="tt-prof-nm"></div><div class="tt-xp"><i></i></div></div></div>
  <div class="tt-ui tt-money tt-money-town"></div>
  <div class="tt-ui tt-panel tt-minimap"></div>
  <button class="tt-ui tt-panel tt-sq tt-mail" type="button" aria-label="우편함" data-soon="우편함">${icon("mail")}</button>
  <button class="tt-ui tt-panel tt-sq tt-set" type="button" aria-label="설정">${icon("settings")}</button>
  <div class="tt-ui tt-leftcol">
    <button class="tt-colbtn tt-panel tt-open-shop" type="button">${icon("shop")}뽑기<i class="tt-badge"></i></button>
    <button class="tt-colbtn tt-panel tt-open-char" type="button">${icon("char")}캐릭터</button>
    <button class="tt-colbtn tt-panel tt-open-skin" type="button"><span class="tt-ico tt-ico-skin">👗</span>스킨</button>
    <button class="tt-colbtn tt-panel" type="button" data-soon="미션">${icon("mission")}미션</button>
  </div>
  <button class="tt-ui tt-panel tt-sq tt-chat" type="button" aria-label="채팅" data-soon="채팅">${icon("chat")}<i class="tt-badge"></i></button>
  <div class="tt-ui tt-pad" aria-label="이동">
    <button class="tt-arr tt-au" type="button" aria-label="위">▲</button>
    <button class="tt-arr tt-al" type="button" aria-label="왼쪽">◀</button>
    <button class="tt-arr tt-ar" type="button" aria-label="오른쪽">▶</button>
    <button class="tt-arr tt-ad" type="button" aria-label="아래">▼</button>
  </div>
  <button class="tt-ui tt-quick tt-tolobby" type="button">${icon("list")}<b>게임 로비</b></button>
</div>

<div class="tt-screen tt-title" data-s="title" hidden>
  <div class="tt-title-in">
    <h1 class="tt-tlogo">${ART.logo ? `<img src="${ART.logo}" alt="TABLE TOWN">` : "TABLE TOWN"}</h1>
    <p class="tt-tsub">캐릭터와 함께하는 온라인 원카드</p>
    <div class="tt-tbtns">
      <button type="button" class="tt-cs-go pink tt-tlogin">로그인하고 시작<i>›</i></button>
      <button type="button" class="tt-cs-go blue tt-tguest">게스트로 플레이<i>›</i></button>
      <small class="tt-tnote">게스트는 코인 · 코스튬이 이 기기에만 저장돼요</small>
    </div>
  </div>
</div>

<div class="tt-screen tt-lobby" data-s="lobby" hidden>
  <div class="tt-lobby-bg"></div>
  <button class="tt-backbtn tt-lback" type="button">${BACK}<span>마을로</span></button>
  <div class="tt-lplate"><span class="tt-lgame">원카드</span></div>
  <div class="tt-ui tt-money tt-money-lobby"></div>
  <nav class="tt-ltabs"></nav>
  <section class="tt-lpanel">
    <header><b class="tt-lh">방 목록</b><div class="tt-lfil"><button type="button" class="on" data-f="all">전체</button><button type="button" data-f="wait"><i class="dot g"></i>대기 중</button><button type="button" data-f="free"><i class="dot b"></i>빈 자리 있음</button></div><label class="tt-lsearch"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg><input type="text" inputmode="numeric" maxlength="4" placeholder="방 번호로 검색" aria-label="방 번호로 검색"></label><button type="button" class="tt-lrefresh" aria-label="새로고침"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg></button></header>
    <div class="tt-lrooms"></div>
  </section>
  <div class="tt-lacts">
    <button type="button" class="tt-cs-go pink tt-lmake"><b>＋</b>방 만들기</button>
    <button type="button" class="tt-lquick"><span>⚡ 빠른 입장</span><small>빈 자리 있는 방으로 바로</small></button>
  </div>
</div>

<div class="tt-screen tt-room" data-s="room" hidden>
  <div class="tt-room-bg"></div>
  <button class="tt-backbtn tt-panel" type="button">${BACK}<span>마을로</span></button>
  <div class="tt-roomtitle"><div class="tt-t">원카드 대기실</div><button type="button" class="tt-n tt-roomcopy" data-nosfx aria-label="방 번호 복사"><span class="tt-roomno"></span><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="12" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/></svg></button></div>
  <div class="tt-ui tt-money tt-money-room"></div>
  <div class="tt-rcount" aria-label="인원"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.8 3.2-6 6.5-6s5.9 2.2 6.5 6z"/><circle cx="17" cy="9" r="2.8"/><path d="M15.5 14.3c2.9-.4 5.3 1.4 6 4.7h-4.4"/></svg><b>1/4</b></div>
  <div class="tt-rtable"></div>
  <div class="tt-rseats"></div>
  <div class="tt-panel tt-rinfo">
    <div class="tt-rtabs" role="tablist"><button type="button" class="on" data-rt="info">게임 정보</button><button type="button" data-rt="set">방 설정</button></div>
    <div class="tt-rpage" data-rp="info">
      <h3>원카드 <small><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4.4 4-7 8-7s7.2 2.6 8 7z"/></svg>2~4명</small><small><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2" fill="none" stroke="#2a1d48" stroke-width="2.2" stroke-linecap="round"/></svg>5분</small></h3>
      <ol>
        <li>바닥 카드와 <b>무늬나 숫자</b>가 같은 카드를 내요. 먼저 다 털면 1등!</li>
        <li>공격 카드: <b>2</b>는 +2장, <b>A</b>는 +3장, <b>조커</b>는 +5장. 같은 숫자나 더 센 공격으로 받아칠 수 있어요.</li>
        <li><b>7</b> 무늬 바꾸기 · <b>J</b> 건너뛰기 · <b>Q</b> 방향 반대 · <b>K</b> 한 장 더</li>
        <li>1장 남으면 「원카드!」를 눌러요. 남이 안 누르면 내가 잡을 수 있어요.</li>
      </ol>
      <div class="tt-rowx"><span>순위 보상</span><div class="tt-rewards">${REWARD.map((v, i) => `<span class="r${i + 1}"><b>${i === 0 ? "🏆" : `${i + 1}등`}</b>${icon("coin")}${v}</span>`).join("")}</div></div>
    </div>
    <div class="tt-rpage tt-rset" data-rp="set" hidden>
      <div class="tt-rowx"><span>모드</span><div class="tt-modes" data-k="mode"><button type="button" data-v="normal">일반 판</button><button type="button" data-v="fast">빠른 판</button></div></div>
      <div class="tt-rowx"><span>인원</span><div class="tt-modes" data-k="max"><button type="button" data-v="2">2명</button><button type="button" data-v="3">3명</button><button type="button" data-v="4">4명</button></div></div>
      <div class="tt-rowx"><span>봇 난이도</span><div class="tt-modes" data-k="level"><button type="button" data-v="0">초급</button><button type="button" data-v="1">중급</button><button type="button" data-v="2">고급</button></div></div>
      <div class="tt-rowx"><span>방 공개</span><div class="tt-modes" data-k="pub"><button type="button" data-v="1">공개</button><button type="button" data-v="0">비공개</button></div></div>
      <div class="tt-rowx"><span>바로 입장 허용</span><button type="button" class="tt-tog" data-k="autoJoin" aria-label="바로 입장 허용"><i></i></button><small>끄면 방장이 수락해야 들어와요</small></div>
      <div class="tt-rowx"><span>빈자리 봇 채우기</span><button type="button" class="tt-tog" data-k="botFill" aria-label="빈자리 봇 채우기"><i></i></button><small>시작할 때 빈자리에 봇이 앉아요</small></div>
      <p class="tt-rnote"></p>
    </div>
  </div>
  <form class="tt-rchat"><input type="text" maxlength="40" placeholder="메시지를 입력하세요…" aria-label="채팅 입력"><button type="submit" aria-label="보내기">😊</button></form>
  <div class="tt-rbar"><button type="button" class="tt-rb-inv"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/></svg>초대하기</button><button type="button" class="tt-rb-bot"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.8 3.2-6 6.5-6s5.9 2.2 6.5 6z"/><circle cx="17" cy="9" r="2.8"/><path d="M15.5 14.3c2.9-.4 5.3 1.4 6 4.7h-4.4"/></svg>봇 채우기</button><button type="button" class="tt-rb-seat"><b>+</b>자리 추가</button></div>
  <button class="tt-start" type="button"><span>게임 시작</span><i>▶</i></button>
</div>

<div class="tt-screen tt-game" data-s="game" hidden>
  <div class="tt-game-bg"></div>
  <div class="tt-felt"></div>
  <svg class="tt-dir" viewBox="0 0 1280 720" aria-hidden="true">
    <ellipse class="rail" cx="607" cy="395" rx="300" ry="142"/>
    <g class="chev">${Array.from({ length: 6 }, () => `<path d="M-17 -15 L15 0 L-17 15 L-9 0 Z"/>`).join("")}</g>
  </svg>
  <div class="tt-gtl"><button class="tt-gbtn tt-sqb tt-pause" type="button" aria-label="메뉴"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14"/></svg></button><button class="tt-gbtn tt-rulesbtn" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 5.5c2.8-1 5.6-.8 8.5 1 2.9-1.8 5.7-2 8.5-1V19c-2.8-1-5.6-.8-8.5 1-2.9-1.8-5.7-2-8.5-1z"/><path d="M12 6.5V20"/></svg>규칙</button></div>
  <div class="tt-gturn"><span class="tt-gturn-av tt-av"></span><b class="tt-gturn-tx"></b><span class="tt-gclock"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 1.5M9.5 2.8h5"/></svg><b></b></span></div>
  <div class="tt-gtr"><button class="tt-gbtn tt-gchatbtn" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>채팅</button><button class="tt-gbtn tt-emobtn" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5c1.8 2 5.2 2 7 0M9 9.5h.01M15 9.5h.01"/></svg>이모티콘</button></div>
  <div class="tt-opps"></div>
  <div class="tt-center">
    <div class="tt-pilewrap tt-drawwrap"><div class="tt-stack tt-drawstack"></div><span class="tt-drawcnt"></span></div>
    <div class="tt-pilewrap tt-topwrap"><div class="tt-atkb" hidden></div><div class="tt-stack tt-top"></div></div>
    <div class="tt-suitc"><small>지금 무늬</small><b></b><span></span></div>
  </div>
  <div class="tt-hand"></div>
  <div class="tt-gme"><span class="tt-nexttag">다음</span><div class="tt-gme-ring"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46"/></svg><div class="tt-av tt-gme-av"></div><img class="frame" src="${ART.game.frameBig}" alt="" draggable="false"></div><div class="tt-gme-plate"><b class="tt-gme-nm"></b><i class="star"></i><span class="tt-gme-cnt"></span></div></div>
  <button class="tt-gbtn tt-sortbtn" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16M3.5 16.5 7 20l3.5-3.5M17 20V4M13.5 7.5 17 4l3.5 3.5"/></svg><span>무늬순</span></button>
  <div class="tt-gbtns">
    <button class="tt-one" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10v4h3l6 4V6L6 10zM16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"/></svg><span>원카드!</span></button>
    <button class="tt-draw" type="button"><span>카드 받기</span></button>
  </div>
  <aside class="tt-rules" hidden>
    <header><b>📖 원카드 규칙</b><button type="button" class="tt-rules-x" aria-label="닫기">✕</button></header>
    <p class="lead">바닥 카드와 <b>무늬나 숫자</b>가 같은 카드를 내요.<br><em>먼저 패를 다 털면 1등!</em></p>
    <ul>
      <li><i class="c red">2</i><b>공격 +2</b><small>다음 사람이 2장 받기</small></li>
      <li><i class="c red">A</i><b>공격 +3</b><small>다음 사람이 3장 받기</small></li>
      <li><i class="c jk">🃏</i><b>공격 +5</b><small>조커 · 아무 때나 낼 수 있음</small></li>
      <li><i class="c">7</i><b>무늬 바꾸기</b><small>원하는 무늬로</small></li>
      <li><i class="c">J</i><b>건너뛰기</b><small>다음 사람 차례를 건너뜀</small></li>
      <li><i class="c">Q</i><b>방향 반대</b><small>도는 방향이 바뀜</small></li>
      <li><i class="c">K</i><b>한 장 더</b><small>내 차례가 한 번 더</small></li>
    </ul>
    <p class="tip">공격은 <b>같은 숫자</b>나 같은 무늬의 <b>더 센 공격</b>(2 &lt; A &lt; 조커)으로 받아칠 수 있어요. 못 막으면 쌓인 만큼 받아요.</p>
    <p class="tip one"><span>원카드!</span>1장 남으면 바로 눌러요. 남이 먼저 누르면 1장 더 받아요.</p>
    <p class="tip">카드가 <b>20장</b>이 되면 파산이에요.</p>
  </aside>
  <form class="tt-gchat" hidden><input type="text" maxlength="60" placeholder="메시지를 입력하세요…" aria-label="채팅 입력"><button type="submit">보내기</button></form>
  <div class="tt-gemo" hidden></div>
</div>
<div class="tt-screen tt-gacha" data-s="gacha" hidden>
  <div class="tt-gbg"></div>
  <div class="tt-gfeat"><div class="tt-gped"></div><div class="tt-gfeat-art"></div><div class="tt-pick">PICK UP</div><div class="tt-gfeat-name"><b></b><small></small></div></div>
  <div class="tt-gmachine"></div>
  <button class="tt-backbtn tt-panel tt-gback" type="button">${BACK}<span>마을로</span></button>
  <div class="tt-gtitle-big">코스튬 뽑기</div>
  <div class="tt-ui tt-money tt-money-gacha"></div>
  <div class="tt-panel tt-gpanel">
    <div class="tt-gbanner"><span>☾ ${GACHA.banner}</span></div>
    <div class="tt-gsub">특별한 코스튬을 만나 보세요!</div>
    <div class="tt-gcards"></div>
    <div class="tt-gpity" title="${GACHA.pity}회 안에 픽업 코스튬 확정"><span>천장</span><div class="tt-gpity-bar"><i></i></div><span><b class="tt-gpity-n"></b>/${GACHA.pity}</span></div><div class="tt-gdone">✓ 이미 가진 코스튬이에요 · 다른 픽업을 골라 보세요</div>
  </div>
  <div class="tt-gpull">
      <button class="tt-g1" type="button"><i class="shine"></i><b>1회 뽑기</b><span>${icon("coin", "tt-coin")}${GACHA.cost1}</span></button>
      <button class="tt-g10" type="button"><i class="shine"></i><em>10% 할인!</em><b>10회 뽑기</b><span>${icon("coin", "tt-coin")}${GACHA.cost10.toLocaleString()}</span></button>
  </div>
  <button class="tt-ginfo" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>확률 정보</button>
  <div class="tt-gstage" hidden></div>
</div>
<div class="tt-toast"></div>
`;

export interface TownOpts {
  /** 사이트 로그인 상태 · 서버 연결 (없으면 연습용으로 서버 없이) */
  host?: TownHost;
}

export function mountTown(root: HTMLElement, opts: TownOpts = {}): () => void {
  root.innerHTML = TEMPLATE;
  const $ = <T extends HTMLElement = HTMLElement>(s: string) => root.querySelector(s) as T;
  const $$ = (s: string, el: ParentNode = root) => Array.from(el.querySelectorAll<HTMLElement>(s));
  let alive = true;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.delete(t);
      if (alive) fn();
    }, ms);
    timers.add(t);
    return t;
  };
  const sleep = (ms: number) => new Promise<void>((r) => later(r, ms));

  const H = opts.host;
  const NET: TownNet | null = H?.net ?? null;
  /** 별명을 정한 회원이면 별명 (코인 · 코스튬은 서버에) — 아니면 게스트 (이 기기에) */
  let member: string | null = H?.member ?? null;
  const isAdmin = () => !!H?.admin;
  const guestProfile = () => loadProfile();
  const memberProfile = (nick: string): Profile => ({ nick, char: "haru", look: "base", coins: 0, owned: [], pity: 0, games: 0 });
  let ME: Profile = member ? memberProfile(member) : guestProfile();
  // 소리: 첫 터치에 풀림 · 화면마다 BGM · 버튼은 기본 딸깍
  const S = createSound();
  const sfx = (id: SfxId, o?: { rate?: number; vol?: number }) => S.sfx(id, o);
  const BGM_OF: Partial<Record<Screen, BgmId>> = { town: "town", room: "room", game: "game", gacha: "gacha" };
  const onFirst = () => S.unlock();
  root.addEventListener("pointerdown", onFirst, { capture: true });
  window.addEventListener("keydown", onFirst);
  const onBtnClick = (e: Event) => {
    const b = (e.target as HTMLElement).closest("button");
    if (!b || b.disabled || b.dataset.nosfx !== undefined) return;
    if (b.closest(".tt-hand, .tt-gpull, .tt-gstage")) return; // 카드 · 뽑기는 따로 소리
    if (b.matches(".tt-x, .tt-backbtn")) sfx("tab", { rate: 0.85 });
    else if (b.matches("[data-rt], .tt-cpick, .tt-gcard")) sfx("tab");
    else sfx("click");
  };
  root.addEventListener("click", onBtnClick, { capture: true });
  const save = () => {
    if (!member) saveProfile(ME);
  };
  let CUR: Screen = "loading";
  const scale = () => root.getBoundingClientRect().width / DW || 1;

  function show(s: Screen) {
    // 시작 화면은 마을 풍경 위에 띄움 (마을은 흐리게 · 캐릭터 없이)
    for (const el of $$(".tt-screen")) el.hidden = !(el.dataset.s === s || (s === "title" && el.dataset.s === "town"));
    root.classList.toggle("titling", s === "title");
    CUR = s;
    S.bgm(BGM_OF[s] ?? (s === "title" ? "town" : s === "lobby" ? "room" : null));
  }
  let toastT: ReturnType<typeof setTimeout> | undefined;
  function toast(t: string, ms = 1700) {
    const el = $(".tt-toast");
    el.textContent = t;
    el.style.top = CUR === "game" ? "455px" : "96px";
    el.style.opacity = "1";
    if (toastT) clearTimeout(toastT);
    toastT = later(() => (el.style.opacity = "0"), ms);
  }
  const bindSoon = (scope: ParentNode) =>
    $$("[data-soon]", scope).forEach((b) => (b.onclick = () => toast(`${b.dataset.soon}은(는) 아직 준비 중이에요`)));
  bindSoon(root);

  // ---------- 캐릭터 그리기 ----------
  const lookOf = (c: CharId, l: LookId) => {
    const d = CHARS[c];
    return { hair: d.looks[l].hair ?? d.hair, body: d.looks[l].body ?? d.body };
  };
  // 코스튬 그림이 아직 없으면 기본 모습 그림으로 (작은 몸 · 얼굴만)
  const artOf = (c: CharId, l: LookId) => ({ ...ART.char[c]?.base, ...ART.char[c]?.[l] });
  /** 마을용: 걷기 · 대기 프레임 그림이 있으면 프레임 애니메이션, 없으면 한 장짜리 SD */
  function sdTownHTML(c: CharId, l: LookId) {
    const an = ART.char[c]?.[l]?.anim;
    if (an) return `<div class="tt-sd tt-sd-anim" data-c="${c}" data-l="${l}"><i style="background-image:url(${an.idle})"></i></div>`;
    return sdHTML(c, l);
  }
  function sdHTML(c: CharId, l: LookId, flip = false) {
    const art = artOf(c, l).sd;
    if (art) return `<div class="tt-sd tt-sd-art ${flip ? "flip" : ""}"><img src="${art}" alt="" draggable="false"></div>`;
    const k = lookOf(c, l);
    return `<div class="tt-sd ${flip ? "flip" : ""}"><div class="body" style="background:${k.body}"></div><div class="legs"></div><div class="hair" style="background:${k.hair}"></div><div class="face"></div></div>`;
  }
  function faceHTML(c: CharId, l: LookId, f: Face = "idle") {
    const a = artOf(c, l);
    const src = a?.bust?.[f] ?? a?.face;
    if (src) return `<img src="${src}" alt="" draggable="false">`;
    return FACE_EMOJI[f];
  }
  const avBg = (c: CharId, l: LookId) => `background:${lookOf(c, l).hair}`;

  // ---------- 돈 ----------
  function refreshMoney() {
    const html = `<div class="tt-m">${icon("coin", "tt-coin")}<b>${ME.coins.toLocaleString()}</b><button type="button" class="tt-mplus" aria-label="코인 얻는 법">+</button></div>`;
    for (const sel of [".tt-money-town", ".tt-money-room", ".tt-money-lobby"]) {
      $(sel).innerHTML = html;
      $(sel).querySelector<HTMLElement>(".tt-mplus")!.onclick = () => toast("코인은 게임에서 이기면 모여요!");
    }
    $(".tt-prof-nm").textContent = ME.nick === "나" ? CHARS[ME.char].name : ME.nick;
    const games = ME.games ?? 0;
    $(".tt-lvb").textContent = `Lv. ${1 + Math.floor(games / 5)}`;
    root.querySelector<HTMLElement>(".tt-xp i")!.style.width = `${((games % 5) / 5) * 100}%`;
    const av = $(".tt-prof-av");
    av.setAttribute("style", avBg(ME.char, ME.look));
    av.innerHTML = faceHTML(ME.char, ME.look);
  }

  // ---------- 오버레이 ----------
  function overlay(html: string, into: HTMLElement = root) {
    const ov = document.createElement("div");
    ov.className = "tt-ov";
    ov.innerHTML = `<div class="tt-panel">${html}</div>`;
    into.appendChild(ov);
    sfx("open");
    return ov;
  }

  // =================== 마을 ===================
  const BW = 300,
    GAP = 80,
    X0 = 170;
  const WORLD = X0 + GAMES.length * (BW + GAP) + 120;
  const doorX = (i: number) => X0 + i * (BW + GAP) + BW / 2;
  const Y_MIN = 548,
    Y_MAX = ART.front ? 626 : 660;
  interface Npc {
    char: CharId;
    look: LookId;
    nick: string;
    x: number;
    y: number;
    tx: number;
    wait: number;
    flip: boolean;
    sayT: number;
  }
  const T = {
    x: doorX(1),
    y: 590,
    tx: null as number | null,
    ty: 0,
    cam: 0,
    keys: {} as Record<string, boolean>,
    hold: { x: 0, y: 0 },
    drag: -1,
    dust: 0,
    face: 1,
    near: -1,
    raf: 0,
    last: 0,
    npcs: [] as Npc[],
  };

  function buildTown() {
    const sky = $(".tt-sky");
    if (ART.sky) sky.style.backgroundImage = `url(${ART.sky})`;
    const hills = $(".tt-hills");
    let h = "";
    if (!ART.sky) {
      hills.style.width = WORLD * 0.35 + DW + "px";
      for (let i = 0; i < 14; i++) {
        const w = rnd(380, 620);
        h += `<div class="tt-hill ${i % 2 ? "b" : ""}" style="left:${i * 200 - 100}px;top:${rnd(300, 380)}px;width:${w}px;height:${w * 0.55}px"></div>`;
      }
      for (let i = 0; i < 8; i++)
        h += `<div class="tt-cloud" style="left:${i * 260 + rnd(0, 80)}px;top:${rnd(60, 200)}px;width:${rnd(90, 160)}px;height:${rnd(28, 40)}px"></div>`;
    }
    hills.innerHTML = h;
    const world = $(".tt-world");
    world.style.width = WORLD + "px";
    let w = ART.ground
      ? `<div class="tt-ground art" style="background-image:url(${ART.ground})"></div>`
      : '<div class="tt-ground"></div>';
    if (ART.front) w += `<div class="tt-front" style="background-image:url(${ART.front})"></div>`;
    GAMES.forEach((g, i) => {
      const x = X0 + i * (BW + GAP);
      const art = ART.bld[g.id];
      if (art) {
        const sg = SIGN[g.id];
        w += `<div class="tt-bld-art ${g.open ? "open" : "closed"}" style="left:${doorX(i)}px"><img src="${art}" alt="${g.name}" draggable="false">${
          sg ? `<div class="tt-bsign" style="left:${sg.x * 100}%;top:${sg.y * 100}%;width:${sg.w * 100}%;height:${sg.h * 100}%;--n:${g.name.replace(/ /g, "").length}"><span>${g.name}</span></div>` : ""
        }${SIGN2[g.id] ? `<div class="tt-bsign han" style="left:${SIGN2[g.id]!.x * 100}%;top:${SIGN2[g.id]!.y * 100}%;width:${SIGN2[g.id]!.w * 100}%;--n:1"><span>${SIGN2[g.id]!.text}</span></div>` : ""}</div>`;
      }
      else
        w += `<div class="tt-bld ${g.open ? "open" : "closed"}" style="left:${x}px;color:${g.color}">
        <div class="roof" style="background:${g.color}"></div><div class="body"></div>
        <div class="win" style="left:30px"></div><div class="win" style="right:30px"></div>
        <div class="sign"><span>${g.ic}</span>${g.name}</div><div class="door"></div></div>`;
      if (!g.open) w += `<div class="tt-soon" style="left:${doorX(i)}px">준비 중</div>`;
      const lx = x + BW + GAP / 2;
      w += ART.props.lamp
        ? `<img class="tt-lamp-art" src="${ART.props.lamp}" style="left:${lx - 30}px" alt="" draggable="false">`
        : `<div class="tt-lamp" style="left:${lx - 5}px"></div>`;
    });
    w += `<div class="tt-ent tt-pl"><div class="tt-shadow"></div><div class="tt-sdwrap"></div><div class="tt-tag me"><i></i><span class="tt-mynick"></span></div></div>`;
    T.npcs = [
      { char: "ruru", look: "base", nick: "루루", x: doorX(1) - 220, y: 575, tx: 0, wait: rnd(1, 3), flip: false, sayT: 0 },
      { char: "haru", look: "cos1", nick: "마법하루", x: doorX(3) + 60, y: 610, tx: 0, wait: rnd(1, 3), flip: false, sayT: 0 },
    ];
    T.npcs.forEach((n, i) => {
      n.tx = n.x;
      w += `<div class="tt-ent tt-npc" data-i="${i}"><div class="tt-shadow"></div>${sdTownHTML(n.char, n.look)}<div class="tt-tag">${n.nick}</div><div class="tt-say" hidden></div></div>`;
    });
    w += `<button class="tt-enter" type="button" hidden>입장</button>`;
    world.innerHTML = w;
    $$(".tt-npc").forEach((el) => {
      el.onpointerdown = (e) => {
        e.stopPropagation();
        npcTalk(+el.dataset.i!, true);
      };
    });
    $(".tt-enter").onpointerdown = (e) => {
      e.stopPropagation();
      tryEnter();
    };
    // 건물을 눌러도 들어감 (열린 건물은 바로 로비, 공사 중이면 안내)
    $$(".tt-bld-art img, .tt-bld").forEach((el, i) => {
      el.onpointerdown = (e) => {
        e.stopPropagation();
        const g = GAMES[i];
        if (!g.open) return toast(`${g.name}은(는) 아직 공사 중이에요`);
        openLobby(g.id);
      };
    });
    $(".tt-minimap").innerHTML =
      GAMES.map(
        (g, i) =>
          `<button class="tt-mic ${g.open ? "" : "off"}" type="button" data-i="${i}">${ART.bld[g.id] ? `<img src="/town/bld/thumb/${g.id}.webp" alt="" draggable="false">` : `<span class="e">${g.ic}</span>`}<span class="n">${g.name}</span></button>`,
      ).join("") + '<i class="tt-mdot"></i>';
    $$(".tt-mic").forEach((b) => (b.onclick = () => teleport(+b.dataset.i!)));
    refreshPlayerSd();
  }
  function refreshPlayerSd() {
    $(".tt-pl .tt-sdwrap").innerHTML = sdTownHTML(ME.char, ME.look);
    $(".tt-mynick").textContent = ME.nick === "나" ? CHARS[ME.char].name : ME.nick;
  }
  function teleport(i: number) {
    T.x = doorX(i);
    T.y = 590;
    T.tx = null;
    T.face = 1;
    toast(`${GAMES[i].name} 앞으로 이동`, 1000);
  }
  function npcTalk(i: number, click: boolean) {
    const n = T.npcs[i];
    const el = $(`.tt-npc[data-i="${i}"] .tt-say`);
    n.sayT = click ? 5 : 3;
    el.hidden = false;
    const line = pick(CHARS[n.char].lines.town);
    el.dataset.c = n.char;
    el.innerHTML = `<b class="nm">${n.nick}</b><span class="tx">${line}</span>${click ? '<button type="button">같이 하기</button>' : ""}`;
    el.classList.remove("pop");
    void el.offsetWidth;
    el.classList.add("pop");
    const b = el.querySelector("button");
    if (b)
      b.onpointerdown = (e) => {
        e.stopPropagation();
        LB.game = "onecard";
        void quickJoin();
      };
  }
  function tryEnter() {
    if (T.near < 0) return;
    const g = GAMES[T.near];
    if (!g.open) return toast(`${g.name}은(는) 아직 공사 중이에요`);
    openLobby(g.id);
  }
  // 바닥을 누르면 그쪽으로, 누른 채로 끌면 계속 따라감 (마우스 · 손가락 둘 다)
  const aimAt = (e: PointerEvent) => {
    const r = root.getBoundingClientRect(),
      k = scale();
    const sx = (e.clientX - r.left) / k,
      sy = (e.clientY - r.top) / k;
    T.tx = Math.max(60, Math.min(WORLD - 60, sx + T.cam));
    T.ty = Math.max(Y_MIN, Math.min(Y_MAX, sy));
  };
  const onStageDown = (e: PointerEvent) => {
    if (CUR !== "town") return;
    const t = e.target as HTMLElement;
    if (t.closest(".tt-ui,button,.tt-ent,.tt-ov")) return;
    const r = root.getBoundingClientRect();
    if ((e.clientY - r.top) / scale() < 300) return;
    T.drag = e.pointerId;
    aimAt(e);
  };
  const onStageMove = (e: PointerEvent) => {
    if (T.drag === e.pointerId && CUR === "town") aimAt(e);
  };
  const onStageUp = (e: PointerEvent) => {
    if (T.drag === e.pointerId) T.drag = -1;
  };
  root.addEventListener("pointerdown", onStageDown);
  window.addEventListener("pointermove", onStageMove);
  window.addEventListener("pointerup", onStageUp);
  window.addEventListener("pointercancel", onStageUp);
  const onKeyDown = (e: KeyboardEvent) => {
    if (!alive) return;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    const k = e.key.toLowerCase();
    if (CUR === "town" && ["arrowleft", "arrowright", "arrowup", "arrowdown"].includes(k)) e.preventDefault();
    T.keys[k] = true;
    if (CUR === "town" && (e.key === "Enter" || e.key === " ") && !root.querySelector(".tt-ov")) {
      e.preventDefault();
      tryEnter();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    T.keys[e.key.toLowerCase()] = false;
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  // 폰 이동 패드 (상하좌우, 누르고 있는 동안 이동)
  function holdBtn(el: HTMLElement, dx: number, dy: number) {
    const on = (e: Event) => {
      e.preventDefault();
      if (dx) T.hold.x = dx;
      if (dy) T.hold.y = dy;
      T.tx = null;
    };
    const off = () => {
      if (dx && T.hold.x === dx) T.hold.x = 0;
      if (dy && T.hold.y === dy) T.hold.y = 0;
    };
    el.addEventListener("pointerdown", on);
    el.addEventListener("pointerup", off);
    el.addEventListener("pointerleave", off);
    el.addEventListener("pointercancel", off);
  }
  holdBtn($(".tt-al"), -1, 0);
  holdBtn($(".tt-ar"), 1, 0);
  holdBtn($(".tt-au"), 0, -1);
  holdBtn($(".tt-ad"), 0, 1);
  $(".tt-tolobby").onclick = () => {
    const g = GAMES[Math.max(0, T.near)];
    openLobby(g?.open ? g.id : "onecard");
  };
  // 캐릭터 화면: 풀버전 일러(배경 붙여서) 크게 + 가진 모습 고르기
  // 캐릭터 선택 · 스킨 화면 (GPT 시안 mock-char-skin-v1 그대로): 왼쪽 큰 일러 + 소개, 오른쪽 카드 목록 + 큰 버튼
  const csBase = (title: string, kind: "char" | "skin") => {
    const ov = document.createElement("div");
    ov.className = `tt-cs tt-cs-${kind}`;
    ov.innerHTML = `<div class="tt-cs-bg"></div><div class="tt-cs-art"></div><button type="button" class="tt-backbtn tt-cs-back">${BACK}<span>뒤로</span></button><div class="tt-cs-title">${title}</div><div class="tt-cs-intro"></div><div class="tt-cs-panel"><div class="tt-cs-cards"></div><div class="tt-cs-info"></div><div class="tt-cs-btns"></div></div>`;
    root.appendChild(ov);
    sfx("open");
    ov.querySelector<HTMLElement>(".tt-cs-back")!.onclick = () => ov.remove();
    return ov;
  };
  const tagsHTML = (t: string[] = []) => t.map((x) => `<span>${x}</span>`).join("");
  const csArt = (ov: HTMLElement, c: CharId, l: LookId) => {
    const a = artOf(c, l);
    const bg = ART.char[c]?.[l]?.bg ?? ART.fullBg;
    const bgEl = ov.querySelector<HTMLElement>(".tt-cs-bg")!;
    bgEl.style.backgroundImage = bg ? `url(${bg})` : "";
    const art = ov.querySelector<HTMLElement>(".tt-cs-art")!;
    if (art.dataset.k !== `${c}:${l}`) {
      art.dataset.k = `${c}:${l}`;
      art.innerHTML = a.full ? `<img src="${a.full}" alt="" draggable="false">` : sdHTML(c, l);
      art.classList.remove("in");
      void art.offsetWidth;
      art.classList.add("in");
    }
  };
  const openChar = () => {
    let sel: CharId = ME.char;
    const ov = csBase("캐릭터 선택", "char");
    const draw = () => {
      const d = CHARS[sel];
      csArt(ov, sel, "base");
      ov.querySelector(".tt-cs-intro")!.innerHTML = `<h2>${d.name}<i>★</i></h2><q>${d.quote}</q><div class="tt-tags">${tagsHTML(d.tags)}</div><p>${d.desc}</p>`;
      ov.querySelector(".tt-cs-cards")!.innerHTML =
        Object.values(CHARS)
          .map((c) => `<button type="button" class="tt-cs-card ${c.id === sel ? "on" : ""}" data-c="${c.id}"><span class="pic" style="${avBg(c.id, "base")}">${faceHTML(c.id, "base", "happy")}</span><b>${c.name}</b>${c.id === ME.char ? '<em>선택 중</em>' : ""}</button>`)
          .join("") + [0, 1].map(() => `<div class="tt-cs-card lock"><span class="pic">🔒</span><b>준비 중</b><small>???</small></div>`).join("");
      ov.querySelector(".tt-cs-info")!.innerHTML = `<h3>${d.name}<span class="tt-tags">${tagsHTML(d.tags)}</span></h3><p>${d.desc}</p>`;
      const mine = sel === ME.char;
      ov.querySelector(".tt-cs-btns")!.innerHTML = `<button type="button" class="tt-cs-go pink" ${mine ? "disabled" : ""}>${mine ? "선택 중인 캐릭터" : "이 캐릭터로 하기<i>›</i>"}</button><button type="button" class="tt-cs-go blue tt-cs-toskin">👕 스킨 보기</button>`;
      $$(".tt-cs-card[data-c]", ov).forEach((b) => (b.onclick = () => ((sel = b.dataset.c as CharId), draw())));
      const go = ov.querySelector<HTMLButtonElement>(".tt-cs-go.pink")!;
      go.onclick = async () => {
        // 고른 캐릭터의 장착 스킨: 가진 코스튬이 없으면 기본
        const l: LookId = ME.look !== "base" && ME.owned.includes(`${sel}:${ME.look}`) ? ME.look : "base";
        try {
          await setLook(sel, l);
        } catch (e) {
          return toast(errText(e));
        }
        refreshMoney();
        refreshPlayerSd();
        toast(`${d.name}(으)로 바꿨어요`);
        draw();
      };
      ov.querySelector<HTMLElement>(".tt-cs-toskin")!.onclick = () => {
        ov.remove();
        openSkins(sel);
      };
    };
    draw();
  };
  const openSkins = (forChar: CharId = ME.char) => {
    let selL: LookId = forChar === ME.char ? ME.look : "base";
    const ov = csBase(`<span class="ic">👕</span>스킨 (코스튬)`, "skin");
    const draw = () => {
      const d = CHARS[forChar];
      const L = d.looks[selL];
      csArt(ov, forChar, selL);
      const own = selL === "base" || ME.owned.includes(`${forChar}:${selL}`);
      ov.querySelector(".tt-cs-intro")!.innerHTML = `<h2>${selL === "base" ? `${d.name}` : L.name}</h2><q>${L.quote ?? d.quote}</q><div class="tt-tags">${tagsHTML(L.tags ?? d.tags)}</div><p>${L.desc ?? d.desc}</p>`;
      ov.querySelector(".tt-cs-cards")!.innerHTML =
        (Object.keys(d.looks) as LookId[])
          .map((l) => {
            const has = l === "base" || ME.owned.includes(`${forChar}:${l}`);
            const wearing = forChar === ME.char && ME.look === l;
            return `<button type="button" class="tt-cs-card skin ${l === selL ? "on" : ""} ${has ? "" : "locked"}" data-l="${l}" style="${bgOf(forChar, l) ? `--bg:url(${bgOf(forChar, l)})` : ""}"><span class="pic" style="${avBg(forChar, l)}">${faceHTML(forChar, l, "happy")}${has ? "" : "<i>🔒</i>"}</span><b>${l === "base" ? "기본 의상" : d.looks[l].name.replace(d.name, "").trim() || d.looks[l].name}</b>${wearing ? "<em>착용 중</em>" : has ? "" : "<small>🔒 뽑기에서 획득</small>"}</button>`;
          })
          .join("") + `<div class="tt-cs-card skin lock"><span class="pic">🔒</span><b>???</b><small>곧 추가</small></div>`;
      ov.querySelector(".tt-cs-info")!.innerHTML = `<h3>${L.name}<span class="tt-tags">${tagsHTML(L.tags ?? d.tags)}</span></h3><p>${L.desc ?? d.desc}</p>`;
      const wearing = forChar === ME.char && ME.look === selL;
      ov.querySelector(".tt-cs-btns")!.innerHTML = own
        ? `<button type="button" class="tt-cs-go pink" ${wearing ? "disabled" : ""}>${wearing ? "착용 중" : "장착 하기"}</button><button type="button" class="tt-cs-go blue tt-cs-gacha">🎁 뽑기 하러 가기</button>`
        : `<button type="button" class="tt-cs-go pink" disabled>🔒 미보유</button><button type="button" class="tt-cs-go blue tt-cs-gacha">🎁 뽑기 하러 가기</button>`;
      $$(".tt-cs-card[data-l]", ov).forEach((b) => (b.onclick = () => ((selL = b.dataset.l as LookId), draw())));
      const go = ov.querySelector<HTMLButtonElement>(".tt-cs-go.pink")!;
      if (own)
        go.onclick = async () => {
          try {
            await setLook(forChar, selL);
          } catch (e) {
            return toast(errText(e));
          }
          refreshMoney();
          refreshPlayerSd();
          toast(`${L.name === "기본 의상" ? d.name : L.name} 장착!`);
          draw();
        };
      ov.querySelector<HTMLElement>(".tt-cs-gacha")!.onclick = () => {
        ov.remove();
        const i = GACHA.pool.findIndex((p) => p.char === forChar && p.look === selL);
        if (i >= 0) gFeat = i;
        ($(".tt-open-shop") as HTMLElement).click();
      };
    };
    draw();
  };
  // 설정: 관리자면 코인 · 천장 · 보유 코스튬을 바로 바꿀 수 있음
  const soundHTML = () =>
    `<div class="tt-snd">
      <label><span>배경음악</span><input type="range" min="0" max="100" value="${Math.round(S.pref.bgm * 100)}" data-snd="bgm"></label>
      <label><span>효과음</span><input type="range" min="0" max="100" value="${Math.round(S.pref.sfx * 100)}" data-snd="sfx"></label>
      <label class="chk"><input type="checkbox" data-snd="mute" ${S.pref.mute ? "checked" : ""}>소리 끄기</label>
    </div>`;
  const bindSound = (ov: HTMLElement) =>
    $$("[data-snd]", ov).forEach((el) => {
      const i = el as HTMLInputElement;
      i.oninput = () => {
        if (i.dataset.snd === "mute") S.setPref({ mute: i.checked });
        else S.setPref({ [i.dataset.snd!]: +i.value / 100 });
        if (i.dataset.snd === "sfx") sfx("click");
      };
    });
  // 관리자: 모든 소리를 하나씩 들어보기 (BGM · 효과음)
  const soundListHTML = () =>
    `<div class="tt-sndlist">${[
      ...Object.entries(BGM).map(([k, u]) => [`BGM · ${k}`, u] as const),
      ...Object.entries(SFX).flatMap(([k, u]) => [[`효과음 · ${k} A`, u] as const, [`효과음 · ${k} B`, SFX_B[k as SfxId]] as const]),
    ]
      .map(([n, u]) => `<button type="button" data-nosfx ${u ? `data-play="${u}"` : "disabled"}>▶ ${n}</button>`)
      .join("")}</div>`;
  let previewA: HTMLAudioElement | null = null;
  const bindSoundList = (ov: HTMLElement) =>
    $$("[data-play]", ov).forEach(
      (b) =>
        (b.onclick = () => {
          previewA?.pause();
          previewA = S.preview(b.dataset.play!);
        }),
    );
  $(".tt-set").onclick = () => {
    if (!isAdmin()) {
      const ov = overlay(`<h2>설정</h2>${soundHTML()}<div class="tt-row"><button type="button" class="pri tt-x">닫기</button></div>`);
      bindSound(ov);
      ov.querySelector<HTMLElement>(".tt-x")!.onclick = () => ov.remove();
      return;
    }
    const looks = Object.values(CHARS).flatMap((c) =>
      (Object.keys(c.looks) as LookId[]).filter((l) => l !== "base").map((l) => ({ c: c.id, l, name: c.looks[l].name })),
    );
    const ov = overlay(
      `<h2>관리자 설정</h2><p class="tt-adm-sub">${member ? "내 계정의 TABLE TOWN 정보가 바뀌어요." : "이 기기의 TABLE TOWN 정보만 바뀌어요."}</p>
      ${soundHTML()}
      <div class="tt-adm">
        <label>코인<input id="tt-adm-coins" type="number" min="0" step="100" value="${ME.coins}"></label>
        <div class="tt-adm-quick">${[1000, 10000, 100000].map((v) => `<button type="button" data-add="${v}">+${v.toLocaleString()}</button>`).join("")}</div>
        <label>천장<input id="tt-adm-pity" type="number" min="0" max="${GACHA.pity}" value="${ME.pity}"></label>
        <div class="tt-adm-own">${looks
          .map((x) => `<label class="chk"><input type="checkbox" data-k="${x.c}:${x.l}" ${ME.owned.includes(`${x.c}:${x.l}`) ? "checked" : ""}>${x.name} 보유</label>`)
          .join("")}</div>
      </div>
      <details class="tt-adm-snd"><summary>소리 전부 들어보기</summary>${soundListHTML()}</details>
      <div class="tt-row"><button type="button" class="tt-adm-reset">초기화</button><button type="button" class="tt-x">닫기</button><button type="button" class="pri tt-adm-save">저장</button></div>`,
      root.querySelector<HTMLElement>(".tt-screen:not([hidden])") ?? root,
    );
    ov.classList.add("adm");
    bindSound(ov);
    bindSoundList(ov);
    const coins = ov.querySelector<HTMLInputElement>("#tt-adm-coins")!;
    $$("[data-add]", ov).forEach((b) => (b.onclick = () => (coins.value = String((+coins.value || 0) + +b.dataset.add!))));
    ov.querySelector<HTMLElement>(".tt-x")!.onclick = () => ov.remove();
    ov.querySelector<HTMLElement>(".tt-adm-save")!.onclick = () => {
      ME.coins = Math.max(0, Math.floor(+coins.value || 0));
      ME.pity = Math.max(0, Math.min(GACHA.pity, Math.floor(+ov.querySelector<HTMLInputElement>("#tt-adm-pity")!.value || 0)));
      ME.owned = $$("input[data-k]", ov)
        .filter((i) => (i as HTMLInputElement).checked)
        .map((i) => i.dataset.k!);
      if (ME.look !== "base" && !ME.owned.includes(`${ME.char}:${ME.look}`)) ME.look = "base";
      save();
      if (member && NET) void NET.rpc("town.adminSet", { coins: ME.coins, pity: ME.pity, owned: ME.owned }).then(syncMe, (e) => toast(errText(e)));
      refreshMoneyAll();
      refreshPlayerSd();
      if (CUR === "gacha") renderGacha();
      ov.remove();
      toast("저장했어요");
    };
    ov.querySelector<HTMLElement>(".tt-adm-reset")!.onclick = () => {
      ME.coins = 1000;
      ME.pity = 0;
      ME.owned = [];
      ME.look = "base";
      save();
      if (member && NET) void NET.rpc("town.adminSet", { coins: 1000, pity: 0, owned: [] }).then(syncMe, (e) => toast(errText(e)));
      refreshMoneyAll();
      refreshPlayerSd();
      if (CUR === "gacha") renderGacha();
      ov.remove();
      toast("초기화했어요");
    };
  };
  $(".tt-open-char").onclick = openChar;
  $(".tt-open-skin").onclick = () => openSkins();
  $(".tt-prof").onclick = openChar;
  $(".tt-open-shop").onclick = () => openGacha();

  // 원근(아래로 올수록 크게) + 몸 움직임: 서 있으면 숨쉬기, 걸으면 통통 튀며 좌우로 뒤뚱 (그림자는 바닥에 그대로)
  const walkState = new WeakMap<HTMLElement, { x: number; y: number; d: number }>();
  const IDLE_SEQ: [number, number][] = [
    [0, 1500],
    [1, 800],
    [0, 900],
    [2, 160],
    [0, 1100],
    [3, 1000],
  ];
  const IDLE_LOOP = IDLE_SEQ.reduce((a, [, d]) => a + d, 0);
  function placeEnt(el: HTMLElement, x: number, y: number, moving: boolean, t: number, flip: boolean) {
    const s = 0.86 + ((y - Y_MIN) / (Y_MAX - Y_MIN)) * 0.26;
    el.style.left = x - 40 + "px";
    el.style.top = y - 110 + "px";
    el.style.zIndex = String(Math.round(y));
    el.style.transform = `scale(${s})`;
    const body = el.querySelector<HTMLElement>(".tt-sd");
    const sh = el.querySelector<HTMLElement>(".tt-shadow");
    const fx = flip ? -1 : 1;
    if (body?.classList.contains("tt-sd-anim")) {
      // 그림 프레임: 걷기 4장(130ms씩) · 대기 4장(숨쉬기 → 몸짓 → 깜빡 → 미소, 약 5초 한 바퀴)
      const an = ART.char[body.dataset.c as CharId]?.[body.dataset.l as LookId]?.anim;
      if (!an) return;
      const i = body.firstElementChild as HTMLElement;
      let src: string, fr: number;
      // 걸은 거리만큼 프레임을 넘김 → 발이 바닥에 붙어 있는 느낌 (미끄러지지 않게)
      const ruru = body.dataset.c === "ruru";
      const st = walkState.get(el) ?? { x, y, d: 0 };
      st.d += Math.hypot(x - st.x, (y - st.y) * 1.6);
      st.x = x;
      st.y = y;
      walkState.set(el, st);
      let lift = 0;
      if (moving) {
        src = flip ? an.walkL : an.walkR;
        // 한 프레임 = 반 걸음. 그림 자체에 다리 움직임이 있으니 몸 들썩임은 아주 작게, 걸음에 맞춰 천천히
        const stride = ruru ? 40 : 46;
        fr = Math.floor(st.d / stride) % 4;
        lift = Math.abs(Math.sin((st.d / stride) * Math.PI)) * (ruru ? 2 : 1.2);
      } else {
        src = an.idle;
        let k = t % IDLE_LOOP;
        fr = 0;
        for (const [f, d] of IDLE_SEQ) {
          if (k < d) {
            fr = f;
            break;
          }
          k -= d;
        }
      }
      if (i.dataset.src !== src) {
        i.dataset.src = src;
        i.style.backgroundImage = `url(${src})`;
      }
      i.style.backgroundPositionX = `${fr * 33.3333}%`;
      body.style.transform = `translateY(${-lift}px)`;
      if (sh) sh.style.transform = `translateX(-50%) scale(${1 - lift * 0.03})`;
      return;
    }
    if (body) {
      if (moving) {
        const ph = t / 95;
        const up = Math.abs(Math.sin(ph));
        const lift = up * 9;
        const tilt = Math.sin(ph) * 5 + 3 * fx;
        const sq = 1 - (1 - up) * 0.06;
        body.style.transform = `translateY(${-lift}px) rotate(${tilt}deg) scale(${fx * (2 - sq)},${sq})`;
        if (sh) sh.style.transform = `translateX(-50%) scale(${1 - up * 0.25})`;
      } else {
        const br = Math.sin(t / 650);
        body.style.transform = `rotate(${Math.sin(t / 1700) * 0.8}deg) scale(${fx * (1 - br * 0.006)},${1 + br * 0.014})`;
        if (sh) sh.style.transform = "translateX(-50%)";
      }
    }
  }
  function puff(x: number, y: number) {
    const d = document.createElement("i");
    d.className = "tt-dust";
    d.style.left = x - 8 + Math.random() * 16 + "px";
    d.style.top = y - 10 + "px";
    d.style.zIndex = String(Math.round(y) - 1);
    $(".tt-world").appendChild(d);
    later(() => d.remove(), 520);
  }
  function townLoop(t: number) {
    if (!alive || CUR !== "town") {
      T.raf = 0;
      return;
    }
    const dt = Math.min(0.05, (t - (T.last || t)) / 1000);
    T.last = t;
    const k = T.keys;
    let vx = 0,
      vy = 0;
    if (k.arrowleft || k.a) vx = -1;
    if (k.arrowright || k.d) vx = 1;
    if (k.arrowup || k.w) vy = -1;
    if (k.arrowdown || k.s) vy = 1;
    if (T.hold.x) vx = T.hold.x;
    if (T.hold.y) vy = T.hold.y;
    if (vx || vy) T.tx = null;
    if (T.tx !== null) {
      const dx = T.tx - T.x,
        dy = T.ty - T.y,
        d = Math.hypot(dx, dy);
      if (d < 6) T.tx = null;
      else {
        vx = dx / d;
        vy = dy / d;
      }
    }
    T.x = Math.max(60, Math.min(WORLD - 60, T.x + vx * 300 * dt));
    T.y = Math.max(Y_MIN, Math.min(Y_MAX, T.y + vy * 165 * dt));
    if (vx) T.face = vx > 0 ? 1 : -1;
    T.cam = Math.max(0, Math.min(WORLD - DW, T.x - DW / 2));
    $(".tt-world").style.transform = `translateX(${-T.cam}px)`;
    $(".tt-hills").style.transform = `translateX(${-T.cam * 0.35}px)`;
    if (ART.sky) $(".tt-sky").style.backgroundPositionX = `${-T.cam * 0.25}px`;
    const moving = !!(vx || vy);
    placeEnt($(".tt-pl"), T.x, T.y, moving, t, T.face < 0);
    if (moving && t - T.dust > 260) {
      T.dust = t;
      puff(T.x, T.y);
    }
    T.npcs.forEach((n, i) => {
      let m = false;
      if (n.wait > 0) n.wait -= dt;
      else {
        const dx = n.tx - n.x;
        if (Math.abs(dx) < 4) {
          n.wait = rnd(2, 5);
          n.tx = Math.max(80, Math.min(WORLD - 80, n.x + rnd(-320, 320)));
        } else {
          n.x += Math.sign(dx) * 90 * dt;
          n.flip = dx < 0;
          m = true;
        }
      }
      const el = $(`.tt-npc[data-i="${i}"]`);
      placeEnt(el, n.x, n.y, m, t + i * 300, n.flip);
      if (n.sayT > 0) {
        n.sayT -= dt;
        if (n.sayT <= 0) el.querySelector<HTMLElement>(".tt-say")!.hidden = true;
      } else if (Math.random() < dt * 0.06) npcTalk(i, false);
    });
    let near = -1;
    GAMES.forEach((_, i) => {
      if (Math.abs(T.x - doorX(i)) < 80 && T.y < Y_MIN + 70) near = i;
    });
    T.near = near;
    const eb = $(".tt-enter");
    if (near >= 0) {
      eb.hidden = false;
      eb.style.left = doorX(near) + "px";
      const label = GAMES[near].open ? `${GAMES[near].name} 입장` : "공사 중";
      if (eb.dataset.l !== label) {
        eb.dataset.l = label;
        eb.innerHTML = `<span>${label}</span>`;
        eb.classList.toggle("closed", !GAMES[near].open);
      }
    } else eb.hidden = true;
    const ics = $$(".tt-mic");
    let cl = 0,
      cd = 1e9;
    GAMES.forEach((_, i) => {
      const d = Math.abs(T.x - doorX(i));
      if (d < cd) {
        cd = d;
        cl = i;
      }
    });
    ics.forEach((b, i) => b.classList.toggle("here", i === cl));
    const a = ics[0].offsetLeft + ics[0].offsetWidth / 2,
      b = ics[ics.length - 1].offsetLeft + ics[ics.length - 1].offsetWidth / 2;
    $(".tt-mdot").style.left = a + (b - a) * ((T.x - doorX(0)) / (doorX(GAMES.length - 1) - doorX(0))) + "px";
    T.raf = requestAnimationFrame(townLoop);
  }
  function goTown() {
    show("town");
    refreshMoney();
    if (!T.raf) {
      T.last = 0;
      T.raf = requestAnimationFrame(townLoop);
    }
  }

  // =================== 온라인: 내 정보 · 방 · 판 ===================
  type SeatW = { uid: string | null; bot: boolean; nick: string; char: CharId; look: LookId; member: boolean; away: boolean };
  type ResultW = { order: number[]; out: number[]; left: number[]; gain: number[]; at: number };
  interface RoomW {
    id: string;
    game: string;
    title: string;
    hostUid: string;
    max: number;
    mode: GameMode;
    pub: boolean;
    locked: boolean;
    autoJoin: boolean;
    botFill: boolean;
    level: number;
    phase: "wait" | "play";
    seats: (SeatW | null)[];
    knock: { uid: string; nick: string; char: CharId; look: LookId }[];
    result: ResultW | null;
    chat: { seat: number; nick: string; text: string; ts: number; sys?: boolean }[];
  }
  interface GameMsg {
    v: OCView;
    map: number[];
    ev: OCEvent[];
  }
  interface LobbyRoom {
    id: string;
    title: string;
    host: { nick: string; char: CharId; look: LookId } | null;
    count: number;
    humans: number;
    max: number;
    mode: GameMode;
    locked: boolean;
    autoJoin: boolean;
    level: number;
    phase: "wait" | "play";
    createdAt: number;
  }
  const plainNick = (n: string) => n.replace(/^◦/, "");
  const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  const nm = (n: string) => esc(plainNick(n));
  const myUid = () => NET?.uid() ?? null;
  const me = () => ({ nick: ME.nick === "나" ? "" : ME.nick, char: ME.char, look: ME.look });
  const CROWN = `<svg class="tt-crown" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8l4.5 3.5L12 5l4.5 6.5L21 8l-2 10H5z"/></svg>`;

  /** 회원: 서버의 내 정보로 맞춤 */
  async function syncMe() {
    if (!member || !NET) return;
    try {
      const p = await NET.rpc<{ coins: number; owned: string[]; pity: number; char: CharId; look: LookId; games: number } | null>("town.me");
      if (!p) return;
      Object.assign(ME, p, { nick: member });
      refreshMoneyAll();
      refreshPlayerSd();
      if (CUR === "gacha") renderGacha();
    } catch {}
  }
  /** 내 모습 바꾸기: 회원은 서버에, 게스트는 기기에 · 앉아 있는 방에도 알림 */
  async function setLook(c: CharId, l: LookId) {
    if (member && NET) {
      const p = await NET.rpc<{ char: CharId; look: LookId }>("town.setLook", { char: c, look: l });
      ME.char = p.char;
      ME.look = p.look;
    } else {
      ME.char = c;
      ME.look = l;
      save();
    }
    if (RM.id && RM.room?.phase === "wait") void NET?.rpc("town.look", { id: RM.id, ...me() }).catch(() => {});
  }

  // ---------- 로비 ----------
  const LB = { game: "onecard" as GameId, unsub: null as null | (() => void), rooms: [] as LobbyRoom[], filter: "all", q: "" };
  function openLobby(game: GameId = LB.game) {
    const g = GAMES.find((x) => x.id === game);
    if (!g?.open) return toast(`${g?.name ?? "그 게임"}은(는) 아직 준비 중이에요`);
    LB.game = game;
    leaveRoomQuiet();
    show("lobby");
    refreshMoneyAll();
    $(".tt-lobby-bg").style.backgroundImage = ART.room ? `url(${ART.room})` : "";
    $(".tt-lgame").textContent = g.name;
    $(".tt-ltabs").innerHTML = GAMES.map(
      (x) =>
        `<button type="button" data-g="${x.id}" class="${x.id === game ? "on" : ""} ${x.open ? "" : "off"}">${ART.bld[x.id] ? `<img src="/town/bld/thumb/${x.id}.webp" alt="" draggable="false">` : `<span>${x.ic}</span>`}<b>${x.name}</b>${x.open ? "" : "<small>준비 중</small>"}</button>`,
    ).join("");
    $$(".tt-ltabs button").forEach((b) => (b.onclick = () => openLobby(b.dataset.g as GameId)));
    LB.unsub?.();
    LB.rooms = [];
    renderLobby(true);
    if (!NET) return;
    let got = false;
    later(() => {
      if (!got && CUR === "lobby" && LB.game === game)
        $(".tt-lrooms").innerHTML = `<div class="tt-lempty">서버에 연결하는 중이에요…<br><small>잠시 뒤에도 안 되면 새로고침 버튼을 눌러 주세요</small></div>`;
    }, 6000);
    LB.unsub = NET.subscribe<LobbyRoom[]>("town.lobby", { game }, {
      onSnapshot: (d) => ((got = true), (LB.rooms = d ?? []), renderLobby()),
      onEvent: (t, d) => t === "list" && ((LB.rooms = (d as LobbyRoom[]) ?? []), renderLobby()),
      onError: () => renderLobby(),
    });
  }
  function closeLobby() {
    LB.unsub?.();
    LB.unsub = null;
  }
  function renderLobby(loading = false) {
    const list = LB.rooms.filter(
      (r) => (LB.filter === "wait" ? r.phase === "wait" : LB.filter === "free" ? r.phase === "wait" && r.humans < r.max : true) && (!LB.q || r.id.includes(LB.q)),
    );
    const box = $(".tt-lrooms");
    if (!list.length) {
      box.innerHTML = `<div class="tt-lempty">${loading ? "방 목록을 불러오는 중…" : LB.rooms.length ? "조건에 맞는 방이 없어요" : "아직 열린 방이 없어요<br><small>방을 만들거나 빠른 입장으로 바로 시작해요!</small>"}</div>`;
      return;
    }
    box.innerHTML = list
      .map((r) => {
        const h = r.host;
        return `<button type="button" class="tt-lroom ${r.phase}" data-id="${r.id}"><span class="r1"><span class="no">#${r.id}</span><b class="ttl">${esc(r.title)}</b>${r.locked ? '<i class="lock" title="비공개 방">🔒</i>' : ""}</span>
          <span class="r2"><span class="host"><span class="tt-av" style="${h ? avBg(h.char, h.look) : ""}">${h ? faceHTML(h.char, h.look) : ""}</span>${CROWN}<em>${h ? nm(h.nick) : "-"}</em></span><span class="st ${r.phase}">${r.phase === "wait" ? "대기 중" : "게임 중"}</span><span class="cnt"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4.4 4-7 8-7s7.2 2.6 8 7z"/></svg>${r.humans}/${r.max}</span><span class="md ${r.mode}">${MODES[r.mode].name}</span></span></button>`;
      })
      .join("");
    $$(".tt-lroom", box).forEach((b) => (b.onclick = () => void joinRoom(b.dataset.id!, LB.rooms.find((x) => x.id === b.dataset.id)?.locked)));
  }
  $$(".tt-lfil button").forEach(
    (b) =>
      (b.onclick = () => {
        LB.filter = b.dataset.f!;
        $$(".tt-lfil button").forEach((x) => x.classList.toggle("on", x === b));
        renderLobby();
      }),
  );
  ($(".tt-lsearch input") as HTMLInputElement).oninput = (e) => {
    LB.q = (e.target as HTMLInputElement).value.replace(/\D/g, "");
    renderLobby();
  };
  $(".tt-lrefresh").onclick = () => {
    $(".tt-lrefresh").classList.remove("spin");
    void $(".tt-lrefresh").offsetWidth;
    $(".tt-lrefresh").classList.add("spin");
    openLobby(LB.game);
  };
  $(".tt-lback").onclick = () => {
    closeLobby();
    goTown();
  };
  $(".tt-lquick").onclick = () => void quickJoin();
  $(".tt-lmake").onclick = () => openMake();

  /** 비밀번호 묻기 (숫자 4자리) */
  function askPw(): Promise<string | null> {
    return new Promise((res) => {
      const ov = overlay(
        `<h2>비밀번호</h2><p>비공개 방이에요. 숫자 4자리를 입력해 주세요.</p><input class="tt-pwin" type="password" inputmode="numeric" maxlength="4" autocomplete="off"><div class="tt-row"><button type="button" class="tt-x">취소</button><button type="button" class="pri tt-ok">들어가기</button></div>`,
      );
      const inp = ov.querySelector<HTMLInputElement>(".tt-pwin")!;
      inp.focus();
      const done = (v: string | null) => (ov.remove(), res(v));
      ov.querySelector<HTMLElement>(".tt-x")!.onclick = () => done(null);
      ov.querySelector<HTMLElement>(".tt-ok")!.onclick = () => done(inp.value);
      inp.onkeydown = (e) => e.key === "Enter" && done(inp.value);
    });
  }
  async function needNet(): Promise<boolean> {
    if (!NET) {
      toast("서버에 연결할 수 없어요");
      return false;
    }
    try {
      if (!member) await NET.ensureGuest();
      return true;
    } catch {
      toast("접속에 실패했어요. 잠시 후 다시 시도해 주세요.");
      return false;
    }
  }
  async function joinRoom(id: string, locked = false, pw?: string) {
    if (!(await needNet())) return;
    try {
      if (locked && pw === undefined) {
        const v = await askPw();
        if (v === null) return;
        pw = v;
      }
      const r = await NET!.rpc<{ id: string; seat: number; knock?: boolean }>("town.join", { id, ...me(), ...(pw ? { password: pw } : {}) });
      enterRoomOnline(r.id, !!r.knock);
    } catch (e) {
      if (errCode(e) === "NEED_PASSWORD") return void joinRoom(id, true);
      toast(errText(e));
    }
  }
  async function quickJoin() {
    if (!(await needNet())) return;
    try {
      const r = await NET!.rpc<{ id: string; seat: number; made: boolean }>("town.quick", { ...me(), game: LB.game });
      if (r.made) toast("빈 자리 있는 방이 없어서 새 방을 만들었어요");
      enterRoomOnline(r.id);
    } catch (e) {
      toast(errText(e));
    }
  }

  /** 방 만들기 창 (시안 mock-lobby-v1 아래 칸) */
  function openMake() {
    const o = { title: "", mode: "normal" as GameMode, max: 4, pub: true, password: "", autoJoin: true, botFill: true, level: 1 };
    const ov = overlay(
      `<div class="tt-make"><div class="tt-mk-plate">방 만들기</div><button type="button" class="tt-mk-x tt-x" aria-label="닫기">✕</button>
      <div class="tt-mk-row"><span>방 제목</span><label class="tt-mk-in"><input class="mk-title" maxlength="20" placeholder="방 제목을 입력하세요 (최대 20자)"><small class="mk-len">0/20</small></label></div>
      <div class="tt-mk-row"><span>게임 모드</span><div class="tt-mk-seg" data-k="mode"><button type="button" data-v="normal">일반 판</button><button type="button" data-v="fast">⚡ 빠른 판</button></div><small class="tt-mk-help">일반 7장 · 15초 / 빠른 5장 · 9초</small></div>
      <div class="tt-mk-row"><span>최대 인원</span><div class="tt-mk-seg" data-k="max"><button type="button" data-v="2">2명</button><button type="button" data-v="3">3명</button><button type="button" data-v="4">4명</button></div></div>
      <div class="tt-mk-row"><span>봇 난이도</span><div class="tt-mk-seg" data-k="level"><button type="button" data-v="0">초급</button><button type="button" data-v="1">중급</button><button type="button" data-v="2">고급</button></div></div>
      <div class="tt-mk-row"><span>방 공개 설정</span><div class="tt-mk-seg" data-k="pub"><button type="button" data-v="1">🌐 공개 방</button><button type="button" data-v="0">🔒 비공개 방</button></div><label class="tt-mk-in pw"><input class="mk-pw" inputmode="numeric" maxlength="4" placeholder="비밀번호 4자리"></label></div>
      <div class="tt-mk-row"><span>바로 입장 허용</span><button type="button" class="tt-tog" data-k="autoJoin"><i></i></button><small>끄면 방장이 수락해야 들어올 수 있어요</small></div>
      <div class="tt-mk-row"><span>빈 자리 봇 채우기</span><button type="button" class="tt-tog" data-k="botFill"><i></i></button><small>인원이 모자라면 봇이 채워요</small></div>
      <div class="tt-mk-btns"><button type="button" class="tt-mk-cancel tt-x">취소</button><button type="button" class="tt-cs-go pink tt-mk-go">방 만들기</button></div></div>`,
      $(".tt-lobby"),
    );
    ov.classList.add("mk");
    const paint = () => {
      $$(".tt-mk-seg", ov).forEach((g) => {
        const k = g.dataset.k as "mode" | "max" | "pub" | "level";
        const cur = k === "pub" ? (o.pub ? "1" : "0") : String(o[k]);
        $$("button", g).forEach((b) => b.classList.toggle("on", b.dataset.v === cur));
      });
      $$(".tt-tog", ov).forEach((t) => t.classList.toggle("on", !!o[t.dataset.k as "autoJoin" | "botFill"]));
      ov.querySelector<HTMLElement>(".tt-mk-in.pw")!.classList.toggle("off", o.pub);
    };
    $$(".tt-mk-seg button", ov).forEach(
      (b) =>
        (b.onclick = () => {
          const k = b.parentElement!.dataset.k!;
          if (k === "mode") o.mode = b.dataset.v as GameMode;
          else if (k === "pub") o.pub = b.dataset.v === "1";
          else (o as Record<string, unknown>)[k] = +b.dataset.v!;
          paint();
        }),
    );
    $$(".tt-tog", ov).forEach((t) => (t.onclick = () => ((o[t.dataset.k as "autoJoin" | "botFill"] = !o[t.dataset.k as "autoJoin" | "botFill"]), paint())));
    const ti = ov.querySelector<HTMLInputElement>(".mk-title")!;
    ti.oninput = () => (ov.querySelector(".mk-len")!.textContent = `${ti.value.length}/20`);
    $$(".tt-x", ov).forEach((b) => (b.onclick = () => ov.remove()));
    ov.querySelector<HTMLElement>(".tt-mk-go")!.onclick = async () => {
      o.title = ti.value;
      o.password = o.pub ? "" : ov.querySelector<HTMLInputElement>(".mk-pw")!.value.trim();
      if (!o.pub && !/^\d{4}$/.test(o.password)) return toast("비공개 방은 숫자 4자리 비밀번호가 필요해요");
      if (!(await needNet())) return;
      try {
        const r = await NET!.rpc<{ id: string }>("town.create", { ...me(), game: LB.game, ...o });
        ov.remove();
        enterRoomOnline(r.id);
      } catch (e) {
        toast(errText(e));
      }
    };
    paint();
  }

  // ---------- 대기실 ----------
  const RM = {
    id: "",
    room: null as RoomW | null,
    unsub: null as null | (() => void),
    knock: false,
    game: null as GameMsg | null,
    shownResult: 0,
    /** 결과 창을 띄우는 중 (대기실로 바로 넘어가지 않게) */
    resPending: false,
  };
  const mySeat = () => (RM.room ? RM.room.seats.findIndex((s) => !!s && s.uid === myUid()) : -1);
  const amHost = () => !!RM.room && RM.room.hostUid === myUid();
  /** 자리 번호 → 대기실 그림 위치 (나는 항상 앞 왼쪽) */
  const ART_POS: Record<number, number[]> = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };
  const posOf = (seat: number) => {
    const r = RM.room!;
    const base = Math.max(0, mySeat());
    return ART_POS[r.max][(seat - base + r.max) % r.max];
  };
  function leaveRoomQuiet() {
    RM.unsub?.();
    RM.unsub = null;
    if (RM.id && NET) void NET.rpc("town.leave", { id: RM.id }).catch(() => {});
    RM.id = "";
    RM.room = null;
    RM.game = null;
    GV = null;
    root.querySelector(".tt-knockov")?.remove();
  }
  function enterRoomOnline(id: string, knock = false) {
    closeLobby();
    RM.unsub?.();
    RM.id = id;
    RM.room = null;
    RM.game = null;
    RM.knock = knock;
    RM.shownResult = Date.now();
    GV = null;
    sfx("enter");
    $(".tt-room-bg").style.backgroundImage = ART.room ? `url(${ART.room})` : "";
    root.querySelector(".tt-ov")?.remove();
    show("room");
    refreshMoneyAll();
    if (knock) showKnockWait();
    RM.unsub = NET!.subscribe<{ room: RoomW | null; game: GameMsg | null }>("town.room", { id }, {
      onSnapshot: (d) => {
        if (!d?.room) return roomGone("없어진 방이에요");
        onRoom(d.room);
        if (d.game) onGame(d.game);
      },
      onEvent: (t, d) => {
        if (t === "room") return d ? onRoom(d as RoomW) : roomGone("방이 닫혔어요");
        if (t === "game") return onGame(d as GameMsg);
        if (t === "chat") return onChat(d as RoomW["chat"][number]);
        if (t === "emote") return onEmote(d as { seat: number; text: string });
        if (t === "kicked" && (d as { uid: string }).uid === myUid()) return roomGone("방장이 방에서 내보냈어요", false);
        if (t === "denied" && (d as { uid: string }).uid === myUid()) return roomGone("방장이 입장을 거절했어요", false);
      },
      onError: () => roomGone("방에 들어갈 수 없어요"),
    });
  }
  function roomGone(msg: string, leave = true) {
    if (!RM.id) return;
    if (!leave) RM.id = "";
    toast(msg, 2200);
    leaveRoomQuiet();
    root.querySelector(".tt-ov")?.remove();
    openLobby(LB.game);
  }
  function showKnockWait() {
    root.querySelector(".tt-knockov")?.remove();
    const ov = overlay(`<h2>입장 요청</h2><p>방장이 수락하면 들어가요…</p><div class="tt-row"><button type="button" class="tt-x">취소</button></div>`, $(".tt-room"));
    ov.classList.add("tt-knockov");
    ov.querySelector<HTMLElement>(".tt-x")!.onclick = () => roomGone("입장 요청을 취소했어요");
  }

  function onRoom(r: RoomW) {
    const prev = RM.room;
    RM.room = r;
    const seat = mySeat();
    if (RM.knock && seat >= 0) {
      RM.knock = false;
      root.querySelector(".tt-knockov")?.remove();
      toast("방장이 수락했어요!");
    }
    if (prev && prev.hostUid !== r.hostUid && r.hostUid === myUid()) toast("이제 내가 방장이에요 👑");
    // 판이 끝남 → 결과
    if (r.result && r.result.at > RM.shownResult) {
      RM.shownResult = r.result.at;
      showResult(r);
    }
    if (r.phase === "play" && seat >= 0 && CUR !== "game" && RM.game) {
      GV = RM.game.v;
      showGame();
    }
    if (r.phase === "wait" && CUR === "game" && !RM.resPending) show("room");
    if (CUR === "room") renderRoomOnline();
    renderKnocks();
  }

  function renderKnocks() {
    const r = RM.room;
    root.querySelector(".tt-knocks")?.remove();
    if (!r || !amHost() || !r.knock.length) return;
    const el = document.createElement("div");
    el.className = "tt-knocks";
    el.innerHTML = r.knock
      .map(
        (k) =>
          `<div class="tt-knock"><span class="tt-av" style="${avBg(k.char, k.look)}">${faceHTML(k.char, k.look)}</span><b>${nm(k.nick)}</b><span>님이 들어오고 싶어해요</span><button type="button" class="no" data-u="${esc(k.uid)}">거절</button><button type="button" class="ok" data-u="${esc(k.uid)}">수락</button></div>`,
      )
      .join("");
    $(".tt-room").appendChild(el);
    $$("button", el).forEach(
      (b) => (b.onclick = () => void NET!.rpc("town.approve", { id: r.id, uid: b.dataset.u, ok: b.classList.contains("ok") }).catch((e) => toast(errText(e)))),
    );
  }

  const SEATS = [
    { cx: 200, bottom: 676, h: 334, back: true, tag: { x: 20, y: 300 } }, // 0 나: 앞 왼쪽 (뒷모습, 테이블로 손 뻗음)
    { cx: 292, bottom: 392, h: 248, back: false, tag: { x: 160, y: 118 } }, // 1 뒤 왼쪽 (턱 괴기)
    { cx: 566, bottom: 402, h: 248, back: false, tag: { x: 470, y: 128 } }, // 2 뒤 오른쪽 (손 흔들기)
    { cx: 704, bottom: 662, h: 322, back: true, tag: { x: 606, y: 300 } }, // 3 앞 오른쪽 (옆으로 앉아 테이블 봄)
  ];
  const seatArt = (c: CharId, l: LookId, i: number) => artOf(c, l).seat?.[i];
  const LV_NAME = ["초급", "중급", "고급"];
  function renderRoomOnline() {
    const r = RM.room;
    if (!r) return;
    const host = amHost();
    const mine = mySeat();
    $(".tt-roomtitle .tt-t").textContent = r.title;
    $(".tt-roomno").textContent = `방 번호 ${r.id}`;
    $(".tt-room-bg").style.backgroundImage = `url(${ART.roomEmpty ?? ART.room})`;
    let h = ART.roomTable ? `<img class="tt-rtab" src="${ART.roomTable}" alt="" draggable="false">` : "";
    if (ART.cardBack) h += `<div class="tt-rdeck">${[0, 1, 2, 3].map((k) => `<img src="${ART.cardBack}" alt="" style="--k:${k}">`).join("")}</div>`;
    r.seats.forEach((s, i) => {
      const p = posOf(i);
      const S0 = SEATS[p];
      const z = S0.back ? 30 : 10;
      if (s) {
        const src = seatArt(s.char, s.look, p);
        if (src) h += `<img class="tt-rseatimg" src="${src}" alt="" draggable="false" style="left:${S0.cx}px;top:${S0.bottom - S0.h}px;height:${S0.h}px;z-index:${z}">`;
        const isHost = s.uid === r.hostUid,
          isMe = i === mine;
        const badge = s.bot ? `<span class="tt-botb">BOT</span>` : isMe ? `<span class="tt-meb"><i></i></span>` : "";
        const sub = s.bot ? `봇 · ${LV_NAME[r.level]}` : s.away ? "자리 비움" : isHost ? "방장" : "준비 완료";
        h += `<div class="tt-rtag ${isHost ? "host" : ""} ${isMe ? "me" : ""}" data-seat="${i}" style="left:${SEATS[p].tag.x}px;top:${SEATS[p].tag.y}px">${isHost ? `<span class="tt-hostcrown">${CROWN}</span>` : ""}<div class="tt-av" style="${avBg(s.char, s.look)}">${faceHTML(s.char, s.look)}</div><div><div class="tt-nm">${nm(s.nick)}${badge}</div><div class="tt-ready ${s.away ? "away" : ""}">${s.bot || s.away ? "" : "✔ "}${sub}</div></div>${host && !isMe && r.phase === "wait" ? `<button type="button" class="tt-kick" data-seat="${i}" aria-label="내보내기" title="내보내기">✕</button>` : ""}</div>`;
      } else {
        h += `<div class="tt-rghost" style="left:${S0.cx - 70}px;top:${S0.bottom - 150}px;z-index:${z}">빈 자리${host ? `<button type="button" class="tt-ghostbot" data-seat="${i}">+ 봇</button>` : ""}</div>`;
      }
    });
    $(".tt-rseats").innerHTML = h;
    $(".tt-rcount b").textContent = `${r.seats.filter(Boolean).length}/${r.max}`;
    $$(".tt-kick").forEach(
      (b) =>
        (b.onclick = () => {
          const s = r.seats[+b.dataset.seat!];
          if (!s) return;
          const ov = overlay(
            `<h2>내보내기</h2><p><b>${nm(s.nick)}</b>${s.bot ? " 봇을 자리에서 뺄까요?" : "님을 방에서 내보낼까요?<br><small>내보낸 사람은 이 방에 다시 못 들어와요.</small>"}</p><div class="tt-row"><button type="button" class="tt-x">취소</button><button type="button" class="pri tt-ok">내보내기</button></div>`,
          );
          ov.querySelector<HTMLElement>(".tt-x")!.onclick = () => ov.remove();
          ov.querySelector<HTMLElement>(".tt-ok")!.onclick = () => {
            ov.remove();
            void NET!.rpc("town.kick", { id: r.id, seat: +b.dataset.seat! }).catch((e) => toast(errText(e)));
          };
        }),
    );
    $$(".tt-ghostbot").forEach((b) => (b.onclick = () => void NET!.rpc("town.addBot", { id: r.id }).then(() => sfx("botJoin"), (e) => toast(errText(e)))));
    // 정보 · 설정
    $(".tt-rpage[data-rp=info] h3").innerHTML = `원카드 <small>${MODES[r.mode].name}</small><small>${MODES[r.mode].hand}장 · ${MODES[r.mode].turnMs / 1000}초</small><small>봇 ${LV_NAME[r.level]}</small>`;
    const set = $(".tt-rset");
    set.classList.toggle("ro", !host);
    $$(".tt-modes", set).forEach((g) => {
      const k = g.dataset.k!;
      const cur = k === "pub" ? (r.pub ? "1" : "0") : String((r as unknown as Record<string, unknown>)[k]);
      $$("button", g).forEach((b) => {
        b.classList.toggle("on", b.dataset.v === cur);
        (b as HTMLButtonElement).disabled = !host;
      });
    });
    $$(".tt-tog", set).forEach((t) => {
      t.classList.toggle("on", !!(r as unknown as Record<string, unknown>)[t.dataset.k!]);
      (t as HTMLButtonElement).disabled = !host;
    });
    set.querySelector<HTMLElement>(".tt-rnote")!.textContent = host ? "" : "방장만 바꿀 수 있어요";
    ($(".tt-rb-bot") as HTMLButtonElement).disabled = !host || !r.seats.includes(null);
    ($(".tt-rb-seat") as HTMLButtonElement).disabled = !host || r.max >= 4;
    const st = $<HTMLButtonElement>(".tt-start");
    st.disabled = !host;
    st.classList.toggle("wait", !host);
    st.querySelector("span")!.textContent = host ? "게임 시작" : "방장이 시작해요";
  }
  const sendSet = (patch: Record<string, unknown>) => {
    if (!RM.room || !amHost()) return;
    void NET!.rpc("town.settings", { id: RM.room.id, ...patch }).catch((e) => toast(errText(e)));
  };
  $$(".tt-rset .tt-modes button").forEach(
    (b) =>
      (b.onclick = async () => {
        const k = b.parentElement!.dataset.k!;
        if (k === "pub") {
          if (b.dataset.v === "1") return sendSet({ pub: true, password: "" });
          const ov = overlay(
            `<h2>비공개 방</h2><p>비밀번호 숫자 4자리를 정해 주세요.</p><input class="tt-pwin" inputmode="numeric" maxlength="4" autocomplete="off"><div class="tt-row"><button type="button" class="tt-x">취소</button><button type="button" class="pri tt-ok">확인</button></div>`,
          );
          const inp = ov.querySelector<HTMLInputElement>(".tt-pwin")!;
          inp.focus();
          ov.querySelector<HTMLElement>(".tt-x")!.onclick = () => ov.remove();
          ov.querySelector<HTMLElement>(".tt-ok")!.onclick = () => {
            if (!/^\d{4}$/.test(inp.value)) return toast("숫자 4자리로 정해 주세요");
            ov.remove();
            sendSet({ pub: false, password: inp.value });
          };
          return;
        }
        sendSet({ [k]: k === "mode" ? b.dataset.v : +b.dataset.v! });
      }),
  );
  $$(".tt-rset .tt-tog").forEach((t) => (t.onclick = () => sendSet({ [t.dataset.k!]: !t.classList.contains("on") })));
  $(".tt-rb-bot").onclick = () => RM.room && void NET!.rpc("town.addBot", { id: RM.room.id }).then(() => sfx("botJoin"), (e) => toast(errText(e)));
  $(".tt-rb-seat").onclick = () => RM.room && sendSet({ max: Math.min(4, RM.room.max + 1) });
  $(".tt-rb-inv").onclick = () => {
    if (!RM.room) return;
    const url = `${location.origin}/games/town/?room=${RM.room.id}`;
    navigator.clipboard?.writeText(url).then(
      () => toast("초대 링크를 복사했어요"),
      () => toast(url),
    );
  };
  $(".tt-roomcopy").onclick = () => {
    if (!RM.room) return;
    const no = RM.room.id;
    navigator.clipboard?.writeText(no).then(
      () => toast(`방 번호 ${no} 복사했어요`),
      () => toast(`방 번호 ${no}`),
    );
  };
  root.querySelector<HTMLElement>(".tt-room .tt-backbtn")!.onclick = () => {
    leaveRoomQuiet();
    openLobby(LB.game);
  };
  $$("[data-rt]").forEach(
    (b) =>
      (b.onclick = () => {
        $$("[data-rt]").forEach((x) => x.classList.toggle("on", x === b));
        $$("[data-rp]").forEach((x) => (x.hidden = x.dataset.rp !== b.dataset.rt));
      }),
  );
  ($(".tt-rchat") as HTMLFormElement).onsubmit = (e) => {
    e.preventDefault();
    const inp = $(".tt-rchat input") as HTMLInputElement;
    const msg = inp.value.trim();
    inp.value = "";
    inp.blur();
    if (msg && RM.room) void NET!.rpc("town.chat", { id: RM.room.id, text: msg }).catch((er) => toast(errText(er)));
  };
  function onChat(m: RoomW["chat"][number]) {
    if (m.sys) return void (CUR === "room" && toast(m.text, 1500));
    sfx("chat", { rate: m.seat === mySeat() ? 1 : 1.12 });
    if (CUR === "game") return bubbleSeat(m.seat, m.text, 2600);
    const tag = root.querySelector<HTMLElement>(`.tt-rtag[data-seat="${m.seat}"]`);
    if (!tag) return;
    tag.querySelector(".tt-rbub")?.remove();
    const bub = document.createElement("div");
    bub.className = "tt-rbub";
    bub.dataset.c = RM.room?.seats[m.seat]?.char ?? "haru";
    bub.textContent = m.text;
    tag.appendChild(bub);
    later(() => bub.remove(), 3500);
  }
  function onEmote(d: { seat: number; text: string }) {
    if (CUR === "game") bubbleSeat(d.seat, d.text, 1500);
    else onChat({ seat: d.seat, nick: "", text: d.text, ts: 0 });
  }
  $(".tt-start").onclick = () => {
    if (!RM.room || !amHost()) return;
    void NET!.rpc("town.start", { id: RM.room.id }).catch((e) => toast(errText(e)));
  };

  // =================== 원카드 (서버가 진행 · 화면은 그리기만) ===================
  let GV: OCView | null = null;
  let sortMode: "suit" | "rank" = "suit";
  /** 판 자리(pi) → 방 자리 */
  const seatOfPi = (pi: number) => RM.game?.map[pi] ?? pi;
  const seatInfo = (pi: number) => RM.room?.seats[seatOfPi(pi)] ?? null;
  /** 보는 사람 기준 상대 위치: 0 나 · 1 왼쪽 · 2 위 · 3 오른쪽 */
  const relPos = (pi: number) => {
    const v = GV!;
    const base = v.me >= 0 ? v.me : 0;
    const d = (pi - base + v.n) % v.n;
    if (d === 0) return 0;
    if (v.n === 2) return 2;
    if (v.n === 3) return d === 1 ? 1 : 3;
    return d;
  };
  const OPP_XY: Record<number, { x: number; y: number }> = { 1: { x: 52, y: 196 }, 2: { x: 478, y: 72 }, 3: { x: 968, y: 196 } };
  // 카드 앞면 (SVG 100×140): 포커 카드처럼 왼쪽 세로줄에 큰 숫자 + 무늬, 그림은 큰 무늬 하나
  const FACE_PATH = [
    "M50 3C40 22 8 38 8 60c0 14 10 23 22 23 7 0 13-3 17-9-1 12-5 20-13 24h32c-8-4-12-12-13-24 4 6 10 9 17 9 12 0 22-9 22-23C92 38 60 22 50 3z",
    "M50 93C21 71 5 55 5 34 5 18 17 7 31 7c9 0 15 8 19 17 4-9 10-17 19-17 14 0 26 11 26 27 0 21-16 37-45 59z",
    "M50 2 88 50 50 98 12 50z",
    "M50 6a19 19 0 1 1 0 38 19 19 0 0 1 0-38zM27 39a19 19 0 1 1 0 38 19 19 0 0 1 0-38zM73 39a19 19 0 1 1 0 38 19 19 0 0 1 0-38zM50 44a12 12 0 1 1 0 24 12 12 0 0 1 0-24zM46 60c0 15-4 26-12 35h32c-8-9-12-20-12-35z",
  ];
  const SUIT_NORM = [96 / 95, 96 / 86, 1, 96 / 89];
  const SUIT_SX = [1, 0.87, 1.15, 1];
  const pipSVG = (st: number, x: number, y: number, size: number) => {
    const k = (size / 100) * SUIT_NORM[st];
    return `<path d="${FACE_PATH[st]}" transform="translate(${x} ${y}) scale(${k * SUIT_SX[st]} ${k}) translate(-50 -50)"/>`;
  };
  function faceSVG(c: Card) {
    const st = c.s;
    // 그림은 예전처럼 큰 무늬 하나 (오른쪽 아래) — 숫자 · 작은 무늬는 왼쪽 세로줄
    const mid = pipSVG(st, 63, 90, st === 1 ? 56 : 62);
    const r = rl(c.r);
    const idx = r === "10" ? `<g transform="translate(15 0) scale(.86 1) translate(-15 0)"><text x="15" y="37" text-anchor="middle" class="idx">10</text></g>` : `<text x="15" y="37" text-anchor="middle" class="idx">${r}</text>`;
    return `<svg viewBox="0 0 100 140" class="tt-face" fill="currentColor" aria-hidden="true">${mid}${idx}${pipSVG(st, 15, 54, 24)}</svg>`;
  }
  function cardHTML(c: Card, cls = "", style = "") {
    if (c.jk)
      return ART.joker
        ? `<div class="tt-c jk art ${cls}" style="${style}" data-id="${c.id}"><img class="tt-jkfull" src="${ART.joker}" alt="" draggable="false"><span class="r">JOKER</span></div>`
        : `<div class="tt-c jk ${cls}" style="${style}" data-id="${c.id}"><span class="r">JOKER</span><span class="s2">🤡</span></div>`;
    return `<div class="tt-c pk ${isRed(c) ? "red" : ""} ${cls}" style="${style}" data-id="${c.id}">${faceSVG(c)}</div>`;
  }
  const backHTML = (cls = "") =>
    ART.cardBack ? `<div class="tt-back tt-back-art ${cls}"><img src="${ART.cardBack}" alt="" draggable="false"></div>` : `<div class="tt-back ${cls}"></div>`;

  function showGame() {
    $(".tt-game-bg").style.backgroundImage = ART.room ? `url(${ART.room})` : "";
    $(".tt-drawstack").innerHTML = backHTML("tt-big") + backHTML("tt-big") + backHTML("tt-big");
    root.querySelector(".tt-game .tt-ov.result")?.remove();
    show("game");
    buildOpps();
    renderGame();
    startClock();
    if (myTurn()) later(() => banner("내 차례!", "mine"), 700);
  }
  function buildOpps() {
    const v = GV;
    if (!v) return;
    let h = "";
    for (let pi = 0; pi < v.n; pi++) {
      const rp = relPos(pi);
      if (rp === 0) continue;
      const s = seatInfo(pi);
      const { x, y } = OPP_XY[rp];
      h += `<div class="tt-opp p${rp}" data-p="${pi}" style="left:${x}px;top:${y}px"><div class="tt-oring"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46"/></svg><div class="tt-av" style="${s ? avBg(s.char, s.look) : ""}"></div><img class="frame" src="${ART.game.frameSm}" alt="" draggable="false"></div><div class="tt-oinfo"><div class="tt-onm">${s ? nm(s.nick) : "?"}${s?.bot ? '<span class="tt-botb">BOT</span>' : ""}${s && s.uid === RM.room?.hostUid ? `<span class="tt-hostcrown sm">${CROWN}</span>` : ""}</div><div class="tt-ocnt"><b></b>장</div></div><div class="tt-ofan"></div><span class="tt-one1" hidden>1장!</span><span class="tt-nexttag">다음</span></div>`;
    }
    $(".tt-opps").innerHTML = h;
    const s0 = v.me >= 0 ? seatInfo(v.me) : null;
    $(".tt-gme-nm").textContent = s0 ? plainNick(s0.nick) || "나" : "관전 중";
    const av = $(".tt-gme-av");
    if (s0) {
      av.setAttribute("style", avBg(s0.char, s0.look));
      av.innerHTML = faceHTML(s0.char, s0.look);
    }
  }
  function sortHand(h: Card[]) {
    return sortMode === "suit"
      ? h.sort((a, b) => (a.jk ? 9 : a.s) - (b.jk ? 9 : b.s) || a.r - b.r)
      : h.sort((a, b) => a.r - b.r || (a.jk ? 9 : a.s) - (b.jk ? 9 : b.s));
  }
  /** 낼 수 있는 카드 (서버와 같은 규칙) */
  const canPlay = (c: Card) => {
    const v = GV!;
    const st = { pending: v.pending, atk: v.atk, free: v.free, suit: v.suit, pile: [v.top] } as unknown as OCState;
    return ocPlayable(st, c);
  };
  const myTurn = () => !!GV && GV.me >= 0 && GV.turn === GV.me && !GV.over;
  /** 지금 차례 다음 사람 (진행 방향을 한눈에) */
  const nextPi = (v: OCView) => {
    let t = v.turn;
    for (let k = 0; k < v.n; k++) {
      t = (t + v.dir + v.n) % v.n;
      if (!v.out[t]) return t;
    }
    return -1;
  };
  let animBusy = false;
  function renderGame() {
    const v = GV;
    if (!v || CUR !== "game") return;
    for (let pi = 0; pi < v.n; pi++) {
      const el = root.querySelector<HTMLElement>(`.tt-opp[data-p="${pi}"]`);
      if (!el) continue;
      const n = v.counts[pi];
      el.classList.toggle("turn", v.turn === pi && !v.over);
      el.classList.toggle("next", !v.over && nextPi(v) === pi && v.turn !== pi);
      el.classList.toggle("out", v.out[pi]);
      el.querySelector(".tt-ocnt b")!.textContent = v.out[pi] ? "파산 " : String(n);
      el.querySelector<HTMLElement>(".tt-one1")!.hidden = n !== 1 || v.out[pi];
      const s = seatInfo(pi);
      const av = el.querySelector(".tt-av")!;
      if (s && av.getAttribute("data-f") !== `${s.char}${s.look}`) {
        av.setAttribute("data-f", `${s.char}${s.look}`);
        av.innerHTML = faceHTML(s.char, s.look);
      }
      const k = Math.min(n, 9);
      el.querySelector(".tt-ofan")!.innerHTML = Array.from({ length: k }, (_, i) => `<div style="--i:${i};--k:${k}">${backHTML("tt-sm")}</div>`).join("");
    }
    const top = v.top;
    $(".tt-top").innerHTML = cardHTML(top, "static big");
    const atk = $(".tt-atkb");
    atk.hidden = v.pending <= 0;
    atk.textContent = `공격 +${v.pending}`;
    const sb = root.querySelector<HTMLElement>(".tt-suitc b")!;
    sb.textContent = v.free ? "★" : SU[v.suit];
    sb.className = v.free ? "free" : v.suit === 1 || v.suit === 2 ? "red" : "";
    root.querySelector(".tt-suitc span")!.textContent = v.free ? "아무 무늬" : SUIT_NAME[v.suit];
    $(".tt-drawcnt").textContent = String(v.drawLeft);
    root.querySelector(".tt-dir")!.classList.toggle("rev", v.dir < 0);
    // 차례 띠
    const tp = seatInfo(v.turn);
    const mine = myTurn();
    const band = $(".tt-gturn");
    band.classList.toggle("mine", mine);
    band.classList.toggle("atk", v.pending > 0);
    $(".tt-gturn-tx").textContent = v.over ? "게임 끝" : mine ? (v.pending > 0 ? `공격 +${v.pending}! 막거나 받기` : "내 차례!") : `${tp ? plainNick(tp.nick) : "?"} 차례`;
    const tav = $(".tt-gturn-av");
    if (tp) {
      tav.setAttribute("style", avBg(tp.char, tp.look));
      if (tav.getAttribute("data-f") !== `${tp.char}${tp.look}`) {
        tav.setAttribute("data-f", `${tp.char}${tp.look}`);
        tav.innerHTML = faceHTML(tp.char, tp.look);
      }
    }
    // 나
    $(".tt-gme").classList.toggle("turn", mine);
    $(".tt-gme").classList.toggle("next", !v.over && v.me >= 0 && nextPi(v) === v.me && !mine);
    $(".tt-game").classList.toggle("myturn", mine);
    $(".tt-gme").classList.toggle("one", v.me >= 0 && v.counts[v.me] === 1);
    $(".tt-gme-cnt").textContent = v.me >= 0 ? (v.out[v.me] ? "파산" : `${v.counts[v.me]}장`) : "";
    // 손패
    const hand = sortHand([...(v.hand ?? [])]);
    const n = hand.length,
      W = 720,
      cw = 104,
      sp = n > 1 ? Math.min(72, (W - cw) / (n - 1)) : 0,
      start = (W - (cw + sp * (n - 1))) / 2;
    $(".tt-hand").innerHTML = hand
      .map((c, i) => {
        const can = mine && !animBusy && canPlay(c),
          dim = mine && !can;
        const mid = (n - 1) / 2,
          ang = (i - mid) * Math.min(3, 26 / Math.max(n, 1)),
          dy = Math.abs(i - mid) ** 2 * Math.min(1.4, 12 / Math.max(n, 1));
        return cardHTML(c, (can ? "can" : "") + (dim ? " dim" : ""), `left:${start + i * sp}px;top:${34 + dy}px;transform:rotate(${ang}deg) translateY(${can ? -26 : 0}px);z-index:${i}`);
      })
      .join("");
    $$(".tt-hand .tt-c.can").forEach((el) => (el.onclick = () => meClick(+el.dataset.id!)));
    const db = $<HTMLButtonElement>(".tt-draw");
    db.disabled = !mine || animBusy;
    db.classList.toggle("atk", v.pending > 0);
    db.querySelector("span")!.textContent = v.pending > 0 ? `${v.pending}장 받기` : "카드 받기";
    const ob = $<HTMLButtonElement>(".tt-one");
    const live = !!(v.one && !v.one.called && !v.out[v.me]);
    ob.classList.toggle("live", live);
    ob.disabled = !live;
    ob.querySelector("span")!.textContent = live && v.one!.pi !== v.me ? `${plainNick(seatInfo(v.one!.pi)?.nick ?? "")} 잡기!` : "원카드!";
    root.querySelector(".tt-sortbtn span")!.textContent = sortMode === "suit" ? "무늬순" : "숫자순";
  }
  const SUIT_NAME = ["스페이드", "하트", "다이아", "클로버"];

  // 차례 시계: 누구 차례든 띠의 초 + 얼굴 둘레 링이 줄어듦 (차례가 바뀌면 다시 꽉 참)
  let clockRaf = 0;
  let ringDir = 0;
  function startClock() {
    cancelAnimationFrame(clockRaf);
    const tick = () => {
      if (!alive || CUR !== "game" || !GV) return void (clockRaf = 0);
      const v = GV;
      const total = (RM.room ? MODES[RM.room.mode].turnMs : 15000) || 15000;
      const left = Math.max(0, v.deadline - (NET?.now() ?? Date.now()));
      const k = v.over ? 0 : Math.min(1, left / total);
      root.querySelector(".tt-gclock b")!.textContent = v.over ? "-" : String(Math.ceil(left / 1000));
      $(".tt-gclock").classList.toggle("hurry", !v.over && left < 4000);
      const off = String(289 * (1 - k));
      for (const c of $$(".tt-oring circle, .tt-gme-ring circle")) c.style.strokeDashoffset = off;
      // 진행 방향 고리: 화살표 몇 개만 제자리에 (움직이지 않음) — 방향이 바뀔 때만 뒤집힘 (시계 방향 = 나 → 왼쪽 → 위 → 오른쪽)
      if (ringDir === v.dir) return void (clockRaf = requestAnimationFrame(tick));
      ringDir = v.dir;
      $$(".tt-dir .chev path").forEach((p, i, all) => {
        const t = (i / all.length + 1 / 12) * Math.PI * 2;
        const x = 607 + 300 * Math.cos(t),
          y = 395 + 142 * Math.sin(t);
        let ang = (Math.atan2(142 * Math.cos(t), -300 * Math.sin(t)) * 180) / Math.PI;
        if (v.dir < 0) ang += 180;
        p.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${ang.toFixed(1)})`);
      });
      clockRaf = requestAnimationFrame(tick);
    };
    clockRaf = requestAnimationFrame(tick);
  }

  function meClick(id: number) {
    const v = GV;
    if (!v || !myTurn() || animBusy) return;
    const c = v.hand?.find((x) => x.id === id);
    if (!c || !canPlay(c)) return;
    if (c.r === 7 && !c.jk && v.pending === 0) {
      const ov = document.createElement("div");
      ov.className = "tt-suitpick";
      ov.innerHTML = `<div class="tt-panel"><h3>무늬를 골라 주세요</h3><div class="opts">${SU.map((s, i) => `<button type="button" class="${i === 1 || i === 2 ? "red" : ""}" data-s="${i}">${s}<small>${SUIT_NAME[i]}</small></button>`).join("")}</div></div>`;
      $(".tt-game").appendChild(ov);
      $$("button", ov).forEach(
        (b) =>
          (b.onclick = () => {
            ov.remove();
            sendPlay(c, +b.dataset.s!);
          }),
      );
      return;
    }
    sendPlay(c);
  }
  function sendPlay(c: Card, suit?: number) {
    const v = GV!;
    // 바로 손에서 뺀 것처럼 보이게 (서버 응답을 기다리지 않음)
    root.querySelector(`.tt-hand .tt-c[data-id="${c.id}"]`)?.classList.add("going");
    void NET!.rpc<{ ok: boolean }>("town.play", { id: RM.id, seq: v.seq, card: c.id, suit }).then(
      (r) => !r.ok && renderGame(),
      (e) => (toast(errText(e)), renderGame()),
    );
  }
  $(".tt-draw").onclick = () => {
    const v = GV;
    if (!v || !myTurn() || animBusy) return;
    $<HTMLButtonElement>(".tt-draw").disabled = true;
    void NET!.rpc("town.draw", { id: RM.id, seq: v.seq }).catch((e) => (toast(errText(e)), renderGame()));
  };
  $(".tt-one").onclick = () => void NET!.rpc("town.one", { id: RM.id }).catch(() => {});
  $(".tt-sortbtn").onclick = () => {
    sortMode = sortMode === "suit" ? "rank" : "suit";
    renderGame();
  };
  // 규칙 패널 (열고 닫기)
  $(".tt-rulesbtn").onclick = () => {
    const r = $(".tt-rules");
    r.hidden = !r.hidden;
    $(".tt-rulesbtn").classList.toggle("on", !r.hidden);
  };
  $(".tt-rules-x").onclick = () => {
    $(".tt-rules").hidden = true;
    $(".tt-rulesbtn").classList.remove("on");
  };
  // 채팅 · 이모티콘
  $(".tt-gchatbtn").onclick = () => {
    const f = $(".tt-gchat");
    f.hidden = !f.hidden;
    if (!f.hidden) f.querySelector("input")!.focus();
  };
  ($(".tt-gchat") as HTMLFormElement).onsubmit = (e) => {
    e.preventDefault();
    const inp = $(".tt-gchat input") as HTMLInputElement;
    const msg = inp.value.trim();
    inp.value = "";
    $(".tt-gchat").hidden = true;
    if (msg && RM.id) void NET!.rpc("town.chat", { id: RM.id, text: msg }).catch((er) => toast(errText(er)));
  };
  const EMOTES = ["좋아요!", "헉…!", "ㅋㅋㅋ", "화이팅!", "미안~", "고마워!"];
  $(".tt-emobtn").onclick = () => {
    const box = $(".tt-gemo");
    box.hidden = !box.hidden;
    box.innerHTML = EMOTES.map((t, i) => `<button type="button" data-e="${i}">${t}</button>`).join("");
    $$("button", box).forEach(
      (b) =>
        (b.onclick = () => {
          box.hidden = true;
          if (RM.id) void NET!.rpc("town.emote", { id: RM.id, e: +b.dataset.e! }).catch(() => {});
        }),
    );
  };
  $(".tt-pause").onclick = () => {
    const ov = overlay(
      `<h2>메뉴</h2><p>지금 나가면 이번 판 보상은 없어요.<br><small>남은 판은 자동으로 진행돼요.</small></p><div class="tt-row"><button type="button" class="tt-pquit">나가기</button><button class="pri tt-pgo" type="button">계속하기</button></div>`,
      $(".tt-game"),
    );
    ov.querySelector<HTMLElement>(".tt-pgo")!.onclick = () => ov.remove();
    ov.querySelector<HTMLElement>(".tt-pquit")!.onclick = () => {
      ov.remove();
      leaveRoomQuiet();
      openLobby(LB.game);
    };
  };

  // 말풍선 · 연출 위치 (보는 사람 기준)
  const relAnchor = (rp: number) => (rp === 0 ? { x: 210, y: 440 } : rp === 1 ? { x: 70, y: 150 } : rp === 2 ? { x: 700, y: 170 } : { x: 1010, y: 150 });
  const relCard = (rp: number) => (rp === 0 ? { x: 560, y: 560 } : rp === 1 ? { x: 230, y: 250 } : rp === 2 ? { x: 600, y: 120 } : { x: 960, y: 250 });
  function bubbleSeat(seat: number, text: string, ms = 1600) {
    if (!GV || !RM.game) return;
    const pi = RM.game.map.indexOf(seat);
    if (pi < 0) return;
    bubblePi(pi, text, ms);
  }
  function bubblePi(pi: number, text: string, ms = 1600) {
    const a = relAnchor(relPos(pi));
    const el = document.createElement("div");
    el.className = "tt-bub";
    el.textContent = text;
    el.style.left = a.x + "px";
    el.style.top = a.y + "px";
    $(".tt-game").appendChild(el);
    later(() => el.remove(), ms);
  }
  const stagePt = (el: Element) => {
    const r = el.getBoundingClientRect(),
      s = root.getBoundingClientRect(),
      k = scale();
    return { x: (r.left - s.left) / k, y: (r.top - s.top) / k };
  };
  async function fly(from: { x: number; y: number }, to: { x: number; y: number }, html: string, ms = 300) {
    const el = document.createElement("div");
    el.className = "tt-fly";
    el.style.transitionDuration = `${ms}ms`;
    el.innerHTML = html;
    el.style.left = from.x + "px";
    el.style.top = from.y + "px";
    $(".tt-game").appendChild(el);
    el.getBoundingClientRect();
    el.style.left = to.x + "px";
    el.style.top = to.y + "px";
    await sleep(ms);
    el.remove();
  }

  /** 화면 가운데 큰 글씨 (내 차례 · 방향 반대) */
  function banner(text: string, kind: string) {
    root.querySelector(".tt-gbanner")?.remove();
    const el = document.createElement("div");
    el.className = `tt-gbanner ${kind}`;
    el.innerHTML = `<b>${text}</b>`;
    $(".tt-game").appendChild(el);
    later(() => el.remove(), 1300);
  }
  /** 서버가 보낸 판 소식: 사건마다 연출하고 마지막 상태로 그림 (순서대로 하나씩) */
  let gameQ: Promise<void> = Promise.resolve();
  function onGame(m: GameMsg) {
    RM.game = m;
    gameQ = gameQ.then(() => playGameMsg(m)).catch(() => {});
  }
  async function playGameMsg(m: GameMsg) {
    if (!alive || !RM.id) return;
    const first = !GV || GV.seq > m.v.seq + 5 || m.ev.length === 0;
    const prev = GV;
    if (CUR !== "game" && RM.room?.phase === "play" && m.v.me >= 0) {
      GV = m.v;
      showGame();
      if (!prev) for (let k = 0; k < 6; k++) later(() => sfx("deal", { rate: 0.95 + Math.random() * 0.1 }), k * 90);
      return;
    }
    if (CUR !== "game") {
      GV = m.v;
      return;
    }
    if (first) {
      GV = m.v;
      buildOpps();
      renderGame();
      return;
    }
    animBusy = true;
    for (const e of m.ev) await playEvent(e, m);
    animBusy = false;
    const turnChanged = GV?.turn !== m.v.turn || GV?.seq !== m.v.seq;
    GV = m.v;
    renderGame();
    if (turnChanged && myTurn()) {
      sfx("myTurn");
      banner("내 차례!", "mine");
    }
  }
  async function playEvent(e: OCEvent, m: GameMsg) {
    const v = GV!;
    const rp = (pi: number) => relPos(pi);
    const s = (pi: number) => seatInfo(pi);
    switch (e.t) {
      case "play": {
        const from = e.pi === v.me ? (() => {
          const el = root.querySelector(`.tt-hand .tt-c[data-id="${e.card.id}"]`);
          return el ? stagePt(el) : relCard(0);
        })() : relCard(rp(e.pi));
        if (e.pi === v.me && v.hand) v.hand = v.hand.filter((c) => c.id !== e.card.id);
        v.counts[e.pi] = Math.max(0, v.counts[e.pi] - 1);
        renderGame();
        sfx("play", { rate: 0.94 + Math.random() * 0.12 });
        await fly(from, stagePt($(".tt-top")), cardHTML(e.card, "static big"), 300);
        v.top = e.card;
        if (e.card.jk || e.card.r === 2 || e.card.r === 14) {
          sfx("attack");
          const ln = s(e.pi) && !s(e.pi)!.uid ? CHARS[s(e.pi)!.char].lines.atk : null;
          if (ln && e.pi !== v.me) bubblePi(e.pi, pick(ln));
        } else if ([7, 11, 12, 13].includes(e.card.r)) sfx("special");
        if (e.suit !== undefined) bubblePi(e.pi, `${SU[e.suit]} ${SUIT_NAME[e.suit]}로!`, 1300);
        renderGame();
        return;
      }
      case "draw": {
        const to = e.pi === v.me ? { x: 560, y: 600 } : relCard(rp(e.pi));
        const n = Math.min(e.n, 5);
        for (let k = 0; k < n; k++) {
          sfx("draw", { rate: 0.95 + Math.random() * 0.1 });
          await fly(stagePt($(".tt-drawstack")), to, backHTML("tt-big"), 220);
        }
        if (e.atk && e.n >= 3) {
          const si = s(e.pi);
          if (e.pi === v.me) toast(`${e.n}장 받았다…`);
          else if (si && !si.uid) bubblePi(e.pi, pick(CHARS[si.char].lines.hit));
        }
        return;
      }
      case "shuffle":
        toast("더미를 다시 섞었어요", 900);
        return;
      case "skip":
        bubblePi(e.pi, "건너뜀!", 1100);
        await sleep(200);
        return;
      case "reverse": {
        banner("방향 반대!", "rev");
        const d = $(".tt-dir");
        d.classList.remove("spin");
        void d.offsetWidth;
        d.classList.add("spin");
        await sleep(200);
        return;
      }
      case "again":
        bubblePi(e.pi, "한 장 더!", 1000);
        return;
      case "one":
        if (e.pi === v.me) toast("1장 남았어요! 「원카드!」를 눌러요", 1600);
        return;
      case "oneCall":
        sfx("oneCall");
        bubblePi(e.pi, "원카드!");
        return;
      case "caught": {
        sfx("caught");
        const si = s(e.pi);
        toast(e.pi === v.me ? `${plainNick(s(e.by)?.nick ?? "")}에게 잡혔어요! +1장` : `${plainNick(s(e.by)?.nick ?? "")}이(가) ${plainNick(si?.nick ?? "")}을(를) 잡았다! +1장`);
        if (si && !si.uid) bubblePi(e.pi, pick(CHARS[si.char].lines.caught));
        await sleep(250);
        return;
      }
      case "oneMiss":
        toast(e.pi === v.me ? "원카드를 안 외쳤어요! +1장" : `${plainNick(s(e.pi)?.nick ?? "")} 원카드 못 외침! +1장`);
        return;
      case "bust":
        toast(`${e.pi === v.me ? "내가" : plainNick(s(e.pi)?.nick ?? "")} 파산! (20장)`, 1800);
        await sleep(400);
        return;
      case "timeout":
        if (e.pi === v.me) toast("시간 초과! 카드를 받았어요");
        return;
      case "end": {
        const wi = e.order[0];
        const si = s(wi);
        S.duck(3200);
        sfx(wi === v.me ? "win" : "lose");
        if (si && !si.uid && wi !== v.me) bubblePi(wi, pick(CHARS[si.char].lines.win), 2000);
        void m;
        return;
      }
    }
  }

  function showResult(r: RoomW) {
    const res = r.result!;
    RM.resPending = true;
    const ms = mySeat();
    const rank = res.order.indexOf(ms) + 1;
    const gain = ms >= 0 ? (res.gain[ms] ?? 0) : 0;
    // 코인: 회원은 서버가 넣어 줌(다시 받아옴), 게스트는 이 기기에
    if (ms >= 0) {
      if (member) void syncMe();
      else {
        ME.coins += gain;
        ME.games = (ME.games ?? 0) + 1;
        save();
        refreshMoneyAll();
      }
      if (gain) later(() => sfx("coin"), 1300);
    }
    later(() => {
      if (!RM.room) return void (RM.resPending = false);
      const host = r.hostUid;
      const ov = overlay(
        `<h2>${rank === 1 ? "1등! 🎉" : rank > 0 ? `${rank}등` : "게임 끝"}</h2>${ms >= 0 ? `<p class="tt-gain">${icon("coin", "tt-coin")} +${gain.toLocaleString()}</p>` : ""}
      <div class="tt-rank">${res.order
        .map((seat, k) => {
          const p = r.seats[seat] ?? RM.room?.seats[seat];
          const out = res.out.includes(seat);
          return `<div class="${seat === ms ? "me" : ""}"><span class="pos">${k + 1}</span><div class="tt-av" style="${p ? avBg(p.char, p.look) : ""}">${p ? faceHTML(p.char, p.look, k === 0 ? "win" : out ? "sad" : "idle") : ""}</div><b>${p ? nm(p.nick) : "나간 사람"}${p?.uid === host ? CROWN : ""}</b><span class="left">${out ? "파산" : k === 0 ? "완주" : `${res.left[seat]}장 남음`}</span><span class="gn">+${(res.gain[seat] ?? 0).toLocaleString()}</span></div>`;
        })
        .join("")}</div>
      <div class="tt-row"><button type="button" class="tt-rlobby">나가기</button><button class="pri tt-rroom" type="button">대기실로</button></div>`,
        CUR === "game" ? $(".tt-game") : $(".tt-room"),
      );
      ov.classList.add("result");
      ov.querySelector<HTMLElement>(".tt-rlobby")!.onclick = () => {
        ov.remove();
        RM.resPending = false;
        leaveRoomQuiet();
        openLobby(LB.game);
      };
      ov.querySelector<HTMLElement>(".tt-rroom")!.onclick = () => {
        ov.remove();
        RM.resPending = false;
        GV = null;
        show("room");
        renderRoomOnline();
        renderKnocks();
      };
    }, CUR === "game" ? 1300 : 0);
  }

  // =================== 코스튬 뽑기 ===================
  // 그림이 아직 없을 때 대신 그리는 캡슐 (금 = 코스튬, 파랑 = 꽝)
  const capHTML = (gold: boolean, cls = "") => {
    const src = gold ? ART.gacha.capGold : ART.gacha.capBlue;
    return src
      ? `<img class="tt-cap ${cls}" src="${src}" alt="" draggable="false">`
      : `<div class="tt-cap tt-cap-css ${gold ? "gold" : "blue"} ${cls}"><b>★</b></div>`;
  };
  const cosName = (c: CharId, l: LookId) => CHARS[c].looks[l].name;
  let gFeat = 0;
  let gShown = -1;
  const bgOf = (c: CharId, l: LookId) => ART.char[c]?.[l]?.bg ?? ART.fullBg;
  function renderGacha() {
    refreshMoneyAll();
    const feat = GACHA.pool[gFeat];
    const fa = ART.char[feat.char]?.[feat.look]?.full;
    const fe = $(".tt-gfeat-art");
    // 픽업을 바꿨을 때만 등장 연출 (같은 걸 다시 누르거나 화면 갱신 때는 그대로)
    if (gShown !== gFeat) {
      gShown = gFeat;
      fe.classList.remove("swap");
      void fe.offsetWidth;
      fe.classList.add("swap");
      fe.innerHTML = fa ? `<img src="${fa}" alt="" draggable="false">` : sdHTML(feat.char, feat.look);
    }
    $(".tt-gfeat-name b").textContent = cosName(feat.char, feat.look);
    $(".tt-gfeat-name small").textContent = CHARS[feat.char].looks[feat.look].tag ?? "";
    $(".tt-gmachine").innerHTML = ART.gacha.machine
      ? `<img src="${ART.gacha.machine}" alt="" draggable="false">`
      : `<div class="tt-mach-css"><div class="globe">${Array.from({ length: 9 }, (_, i) => capHTML(i % 3 === 0)).join("")}</div><div class="body"><i></i></div></div>`;
    $(".tt-gcards").innerHTML = GACHA.pool
      .map((p, i) => {
        const full = ART.char[p.char]?.[p.look]?.full;
        const bg = bgOf(p.char, p.look);
        const own = ME.owned.includes(ownKey(p.char, p.look));
        return `<button type="button" class="tt-gcard ${own ? "own" : ""} ${i === gFeat ? "on" : ""}" data-i="${i}" style="${bg ? `background-image:url(${bg})` : ""}"><div class="pic">${full ? `<img src="${full}" alt="" draggable="false">` : ""}</div><span class="pk">PICK UP</span>${own ? '<span class="ownb">보유</span>' : ""}<div class="ft"><b>${cosName(p.char, p.look)}</b></div></button>`;
      })
      .join("");
    $$(".tt-gcard").forEach(
      (b) =>
        (b.onclick = () => {
          if (gFeat === +b.dataset.i!) return;
          gFeat = +b.dataset.i!;
          renderGacha();
        }),
    );
    $(".tt-gpity-n").textContent = String(ME.pity);
    root.querySelector<HTMLElement>(".tt-gpity-bar i")!.style.width = `${(ME.pity / GACHA.pity) * 100}%`;
    const done = !unownedPool().length;
    $<HTMLButtonElement>(".tt-g1").disabled = done || ME.coins < GACHA.cost1;
    $<HTMLButtonElement>(".tt-g10").disabled = done || ME.coins < GACHA.cost10;
    $(".tt-gpanel").classList.toggle("done", done);
  }
  function refreshMoneyAll() {
    refreshMoney();
    $(".tt-money-gacha").innerHTML = $(".tt-money-town").innerHTML;
  }
  function openGacha() {
    show("gacha");
    $(".tt-gbg").style.backgroundImage = ART.gacha.bg ? `url(${ART.gacha.bg})` : "";
    renderGacha();
  }
  $(".tt-gback").onclick = goTown;
  $(".tt-ginfo").onclick = () => {
    const feat = GACHA.pool[gFeat];
    const ov = overlay(
      `<h2>확률 정보</h2><p>· 지금 고른 픽업: 「${cosName(feat.char, feat.look)}」 ${(GACHA.rate * 100).toFixed(1)}%<br>· 꽝 (코인 +${GACHA.lucky}) ${(100 - GACHA.rate * 100).toFixed(1)}%<br>· 코스튬 없이 ${GACHA.pity}회째 뽑으면 고른 픽업 코스튬 확정 (천장)<br>· 이미 가진 픽업은 뽑을 수 없어요 · 천장은 픽업끼리 같이 쌓여요</p><div class="tt-row"><button type="button" class="pri">확인</button></div>`,
      $(".tt-gacha"),
    );
    ov.querySelector<HTMLElement>("button")!.onclick = () => ov.remove();
  };
  // 이미 가진 코스튬은 안 나옴: 고른 픽업 코스튬 하나만 나오고, 이미 가졌으면 그 픽업은 뽑기 불가
  const unownedPool = () => [GACHA.pool[gFeat]].filter((p) => !ME.owned.includes(ownKey(p.char, p.look)));
  let gBusy = false;
  async function pull(n: 1 | 10) {
    const cost = n === 1 ? GACHA.cost1 : GACHA.cost10;
    if (gBusy) return;
    if (!unownedPool().length) return toast("이미 가진 코스튬이에요 · 다른 픽업을 골라 주세요");
    if (ME.coins < cost) return toast("코인이 부족해요 · 게임하고 모아 와요!");
    gBusy = true;
    let res: Pull[];
    if (member && NET) {
      // 회원: 서버가 뽑음 (코인 · 천장 · 코스튬이 서버에)
      try {
        const r = await NET.rpc<{ pulls: Pull[]; me: Partial<Profile> }>("town.gacha", { feat: gFeat, n });
        res = r.pulls;
        Object.assign(ME, r.me);
      } catch (e) {
        gBusy = false;
        return toast(errText(e));
      }
    } else {
      const r = rollGacha(ME, gFeat, n);
      if (typeof r === "string") {
        gBusy = false;
        return toast(r);
      }
      res = r;
      save();
    }
    refreshMoneyAll();
    const next = await playDraw(res);
    gBusy = false;
    renderGacha();
    if (next === "again") void pull(n);
  }
  $(".tt-g1").onclick = () => void pull(1);
  $(".tt-g10").onclick = () => void pull(10);

  // 연출: ① 기계 손잡이 → 캡슐 떨어져 튐 (TAP!) ② 누르면 금빛/파란빛으로 깨짐 ③ 코스튬이면 크게 공개
  async function playDraw(res: Pull[]): Promise<"again" | "ok"> {
    const st = $(".tt-gstage");
    st.hidden = false;
    st.className = "tt-gstage";
    let skip = false;
    const gold = res.some((r) => r.kind === "cos");
    const tapWait = () =>
      new Promise<void>((ok) => {
        const go = () => {
          st.removeEventListener("pointerdown", go);
          ok();
        };
        st.addEventListener("pointerdown", go);
      });
    // ① 떨어짐
    st.innerHTML = `<div class="tt-gdark"></div>${res.length === 1 && ART.gacha.pedestal ? `<img class="tt-gpedimg" src="${ART.gacha.pedestal}" alt="">` : ""}<div class="tt-gdrop">${res.length === 1 ? capHTML(res[0].kind === "cos", "big") : res.map((r) => capHTML(r.kind === "cos", "small")).join("")}</div><div class="tt-gtap">TAP!</div><button class="tt-gskip" type="button"><span>건너뛰기</span>${CHEV}</button>`;
    st.querySelector<HTMLElement>(".tt-gskip")!.onpointerdown = (e) => {
      e.stopPropagation();
      skip = true;
      st.dispatchEvent(new Event("pointerdown"));
    };
    st.classList.toggle("multi", res.length > 1);
    $(".tt-gmachine").classList.add("shake");
    sfx("crank");
    later(() => sfx("capDrop"), 700);
    if (res.length === 1) later(() => sfx("capShake"), 1900);
    later(() => $(".tt-gmachine").classList.remove("shake"), 700);
    await sleep(80);
    st.classList.add("drop");
    await Promise.race([tapWait(), sleep(9000)]);
    // ② 깨짐
    if (!skip) {
      st.classList.add(gold ? "crack-gold" : "crack");
      sfx(gold ? "crackGold" : "crack");
      if (gold) {
        S.duck(4500, 0.35);
        later(() => sfx("pillar"), 200);
      }
      st.querySelector(".tt-gtap")?.remove();
      const burst = document.createElement("div");
      burst.className = `tt-gburst ${gold ? "gold" : ""}`;
      burst.innerHTML = Array.from({ length: 18 }, (_, i) => `<i style="--a:${i * 20}deg;--d:${120 + Math.random() * 180}px"></i>`).join("");
      st.appendChild(burst);
      // 스토리보드 ③: 금 캡슐이 갈라지며 빛기둥 · 빛줄기
      if (gold && ART.gacha.pillar) {
        const lt = document.createElement("div");
        lt.className = "tt-gcrackfx";
        lt.innerHTML = `${ART.gacha.rays ? `<img class="tt-gfx rays" src="${ART.gacha.rays}" alt="">` : ""}<img class="tt-gfx pillar" src="${ART.gacha.pillar}" alt="">`;
        st.appendChild(lt);
      }
      // 1회 뽑기 금 캡슐: 위아래로 쪼개지며 큰 반짝이
      if (gold && res.length === 1 && ART.gacha.capTop && ART.gacha.capBottom) {
        const sp = document.createElement("div");
        sp.className = "tt-gsplit";
        sp.innerHTML = `<img class="t" src="${ART.gacha.capTop}" alt=""><img class="b" src="${ART.gacha.capBottom}" alt="">${ART.gacha.spark ? `<img class="s" src="${ART.gacha.spark}" alt="">` : ""}`;
        st.appendChild(sp);
      }
      await sleep(gold ? 1300 : 700);
    }
    // ③ 코스튬이 나왔으면 먼저 한 벌씩 크게 공개 → ④ 그다음 결과 (10회는 전체 결과판)
    const cos = res.filter((r): r is Extract<Pull, { kind: "cos" }> => r.kind === "cos");
    let next: "again" | "ok" = "ok";
    for (let i = 0; i < cos.length; i++) {
      const last = res.length === 1;
      const r = await reveal(cos[i].char, cos[i].look, false, last ? 1 : 0);
      if (last) next = r;
    }
    const againBtn = (k: 1 | 10) =>
      `<button class="tt-gagain" type="button">${icon("coin")}<span>${k === 1 ? "한 번 더" : "10회 더"}<small>${(k === 1 ? GACHA.cost1 : GACHA.cost10).toLocaleString()}</small></span></button>`;
    const waitBtns = () =>
      new Promise<"again" | "ok">((ok) => {
        st.querySelector<HTMLElement>(".tt-gagain")!.onclick = () => ok("again");
        st.querySelector<HTMLElement>(".tt-gok")!.onclick = () => ok("ok");
      });
    if (res.length > 1) {
      st.className = "tt-gstage result";
      st.innerHTML = `<div class="tt-gdark"></div><div class="tt-gres-title">뽑기 결과<small>코스튬 ${cos.length}벌 · 꽝 ${res.length - cos.length}개 · 천장 ${ME.pity} / ${GACHA.pity}</small></div><div class="tt-gres10">${res
        .map((r, i) =>
          r.kind === "cos"
            ? `<div class="it gold" style="--i:${i}"><div class="pic" style="background-image:url(${bgOf(r.char, r.look) ?? ""})">${
                artOf(r.char, r.look).sd ? `<img src="${artOf(r.char, r.look).sd}" alt="">` : faceHTML(r.char, r.look, "happy")
              }</div><b>${cosName(r.char, r.look)}</b><small>NEW!</small></div>`
            : `<div class="it" style="--i:${i}"><div class="pic">${capHTML(false, "mini")}</div><b>꽝</b><small>코인 +${GACHA.lucky}</small></div>`,
        )
        .join("")}</div><div class="tt-gres-btns">${againBtn(10)}<button class="pri tt-gok" type="button">확인</button></div>`;
      next = await waitBtns();
    } else if (!cos.length) {
      st.className = "tt-gstage result";
      sfx("miss");
      st.innerHTML = `<div class="tt-gdark"></div><div class="tt-glose">${capHTML(false, "big")}<b>꽝!</b><p>코인 +${GACHA.lucky} 돌려받았어요 · 천장 ${ME.pity} / ${GACHA.pity}</p><div class="tt-gres-btns in">${againBtn(1)}<button class="pri tt-gok" type="button">확인</button></div></div>`;
      next = await waitBtns();
    }
    st.hidden = true;
    st.innerHTML = "";
    return next;
  }
  // 공개 연출 (GPT 스토리보드 ④~⑥): 빛기둥 · 마법진 → 빛 속 실루엣 → 섬광과 함께 공개 + 배경 → 이름 판 · NEW 도장 · 버튼
  // 화면을 누르면 바로 마지막 장면으로. againN: 1회 뽑기 마지막이면 1(한 번 더), 10회 중간 공개면 0(다음)
  async function reveal(c: CharId, l: LookId, dup: boolean, againN: 0 | 1 | 10): Promise<"again" | "ok"> {
    const st = $(".tt-gstage");
    const full = ART.char[c]?.[l]?.full;
    const rb = bgOf(c, l);
    const fx = ART.gacha;
    const fxImg = (k: keyof typeof fx, cls: string) => (fx[k] ? `<img class="tt-gfx ${cls}" src="${fx[k]}" alt="" draggable="false">` : "");
    const sparks = Array.from(
      { length: 26 },
      (_, i) => `<i style="--x:${(Math.random() * 100).toFixed(1)}%;--s:${(0.4 + Math.random() * 0.9).toFixed(2)};--d:${(Math.random() * 2.4).toFixed(2)}s;--k:${i % 3}"></i>`,
    ).join("");
    const wearing = ME.char === c && ME.look === l;
    st.className = "tt-gstage reveal";
    st.innerHTML = `${rb ? `<div class="tt-grbg" style="background-image:url(${rb})"></div>` : ""}<div class="tt-gdark"></div>${
      fx.rays ? fxImg("rays", "rays") : '<div class="tt-grays"></div>'
    }${fxImg("sparkle", "sparkle")}${fxImg("circle", "circle")}${fxImg("pillar", "pillar")}${fxImg("ribbon", "ribbon")}<div class="tt-gsparks">${sparks}</div><div class="tt-grev">${
      full ? `<img class="sil" src="${full}" alt="" draggable="false"><img class="col" src="${full}" alt="" draggable="false">` : sdHTML(c, l)
    }</div>${fxImg("flare", "flare")}<div class="tt-gflash"></div><div class="tt-gstamp ${dup ? "dup" : ""}">${fx.stamp ? `<img src="${fx.stamp}" alt="">` : ""}<b>${dup ? "중복" : "NEW!"}</b></div><div class="tt-gplaque"${
      fx.plaque ? ` style="background-image:url(${fx.plaque})"` : ""
    }><small>코스튬 획득</small><b>${cosName(c, l)}</b>${dup ? `<em>이미 가진 코스튬 · 코인 +${GACHA.dupRefund.toLocaleString()}</em>` : ""}</div><div class="tt-grev-btns">${
      wearing ? "" : '<button class="tt-gwear" type="button">바로 장착</button>'
    }${againN ? `<button class="tt-gagain" type="button">${icon("coin")}<span>${againN === 1 ? "한 번 더" : "10회 더"}<small>${(againN === 1 ? GACHA.cost1 : GACHA.cost10).toLocaleString()}</small></span></button>` : ""}<button class="tt-gok" type="button">${againN ? "확인" : "다음"}</button></div>`;
    const steps: [string, number][] = [
      ["ph1", 60],
      ["ph2", 1000],
      ["ph3", 1100],
      ["ph4", 900],
    ];
    let skip = false;
    st.onpointerdown = (e) => {
      if ((e.target as HTMLElement).closest("button")) return;
      skip = true;
    };
    for (const [cls, ms] of steps) {
      if (!skip) {
        const t0 = performance.now();
        while (!skip && performance.now() - t0 < ms) await sleep(30);
      }
      st.classList.add(cls);
      if (cls === "ph3") sfx("reveal");
      if (cls === "ph4") sfx("stamp");
    }
    if (skip) st.classList.add("ph1", "ph2", "ph3", "ph4", "skipped");
    st.onpointerdown = null;
    return new Promise<"again" | "ok">((ok) => {
      const wear = st.querySelector<HTMLElement>(".tt-gwear");
      if (wear)
        wear.onclick = () => {
          ME.char = c;
          ME.look = l;
          save();
          refreshMoney();
          refreshPlayerSd();
          toast(`${cosName(c, l)} 장착!`);
          wear.remove();
        };
      const ag = st.querySelector<HTMLElement>(".tt-gagain");
      if (ag) ag.onclick = () => ok("again");
      st.querySelector<HTMLElement>(".tt-gok")!.onclick = () => ok("ok");
    });
  }

  // =================== 시작 화면 (로그인 안 했을 때) · 게스트 닉네임 ===================
  let INVITE: string | null = null;
  try {
    INVITE = new URLSearchParams(location.search).get("room")?.match(/^\d{4}$/)?.[0] ?? null;
  } catch {}
  function openTitle() {
    show("title");
    // 마을 풍경: 원카드 건물 쪽으로 카메라
    const cam = Math.max(0, Math.min(WORLD - DW, doorX(1) - DW / 2));
    $(".tt-world").style.transform = `translateX(${-cam}px)`;
    $(".tt-hills").style.transform = `translateX(${-cam * 0.35}px)`;
    if (ART.sky) $(".tt-sky").style.backgroundPositionX = `${-cam * 0.25}px`;
    updateTitle();
  }
  function updateTitle() {
    const wait = !!H?.loading;
    $<HTMLButtonElement>(".tt-tlogin").disabled = wait || !H;
    $(".tt-tlogin").firstChild!.textContent = wait ? "로그인 확인 중…" : "로그인하고 시작";
  }
  $(".tt-tlogin").onclick = () => H?.login();
  $(".tt-tguest").onclick = () => openNick();
  const NICK_A = ["반짝", "말랑", "새콤", "포근", "용감한", "졸린", "행운의", "몽글", "씩씩한", "달콤"];
  const NICK_B = ["토끼", "고양이", "별사탕", "마카롱", "펭귄", "다람쥐", "카드왕", "젤리", "판다", "푸딩"];
  const randNick = () => pick(NICK_A) + pick(NICK_B);
  const NICK_RE = /^[가-힣a-zA-Z0-9_]{2,10}$/;
  function openNick() {
    let sel: CharId = ME.char;
    const ov = overlay(
      `<div class="tt-nick"><div class="tt-mk-plate">닉네임 정하기</div><button type="button" class="tt-mk-x tt-x" aria-label="닫기">✕</button>
      <div class="tt-nick-l"><p>함께할 캐릭터를 골라 주세요!</p><div class="tt-nick-chars">${Object.values(CHARS)
        .map((c) => `<button type="button" class="tt-cs-card" data-c="${c.id}"><span class="pic" style="${avBg(c.id, "base")}">${faceHTML(c.id, "base", "happy")}</span><b>${c.name}</b></button>`)
        .join("")}</div></div>
      <div class="tt-nick-r"><p>닉네임을 입력해 주세요</p><div class="tt-nick-in"><input maxlength="10" placeholder="2~10자까지 입력하세요" value="${ME.nick === "나" ? "" : esc(ME.nick)}"><button type="button" class="tt-dice" aria-label="랜덤 닉네임" title="랜덤 닉네임">🎲</button></div><div class="tt-nick-help"><span>욕설 · 운영자 사칭 닉네임은 안 돼요</span><b class="len">0/10</b></div>
      <button type="button" class="tt-cs-go pink tt-nick-go">마을로 출발!<i>›</i></button></div></div>`,
    );
    ov.classList.add("nick");
    const inp = ov.querySelector<HTMLInputElement>("input")!;
    const len = () => (ov.querySelector(".len")!.textContent = `${inp.value.length}/10`);
    const paint = () => $$(".tt-nick-chars .tt-cs-card", ov).forEach((b) => b.classList.toggle("on", b.dataset.c === sel));
    $$(".tt-nick-chars .tt-cs-card", ov).forEach((b) => (b.onclick = () => ((sel = b.dataset.c as CharId), paint())));
    inp.oninput = len;
    ov.querySelector<HTMLElement>(".tt-dice")!.onclick = () => {
      inp.value = randNick();
      len();
    };
    ov.querySelector<HTMLElement>(".tt-x")!.onclick = () => ov.remove();
    const go = async () => {
      const v = inp.value.trim();
      if (!NICK_RE.test(v)) return toast("닉네임은 한글 · 영문 · 숫자 2~10자예요");
      const btn = ov.querySelector<HTMLButtonElement>(".tt-nick-go")!;
      btn.disabled = true;
      try {
        await NET?.ensureGuest();
      } catch {
        btn.disabled = false;
        return toast("접속에 실패했어요. 잠시 후 다시 시도해 주세요.");
      }
      ME.nick = v;
      if (ME.char !== sel) {
        ME.char = sel;
        if (ME.look !== "base" && !ME.owned.includes(ownKey(sel, ME.look))) ME.look = "base";
      }
      save();
      ov.remove();
      enterTown();
    };
    ov.querySelector<HTMLElement>(".tt-nick-go")!.onclick = () => void go();
    inp.onkeydown = (e) => e.key === "Enter" && void go();
    paint();
    len();
    if (!inp.value) inp.focus();
  }
  function enterTown() {
    refreshPlayerSd();
    goTown();
    if (INVITE) {
      const id = INVITE;
      INVITE = null;
      void joinRoom(id);
    }
  }
  // 사이트 로그인 상태가 바뀜 (TownApp)
  if (H)
    H.changed = () => {
      const was = member;
      member = H.member;
      if (member && member !== was) {
        ME = memberProfile(member);
        void syncMe();
        if (CUR === "title") {
          toast(`${member}님 환영해요!`);
          enterTown();
        }
      } else if (!member && was) {
        leaveRoomQuiet();
        closeLobby();
        ME = guestProfile();
        refreshMoneyAll();
        refreshPlayerSd();
        if (CUR !== "loading") openTitle();
      }
      if (CUR === "title") updateTitle();
    };

  // =================== 로딩: 그림을 다 받고 열기 ===================
  void (async () => {
    buildTown();
    const urls = allArt();
    const snds = allSound();
    const bar = root.querySelector<HTMLElement>(".tt-bar i")!,
      tx = $(".tt-ltxt");
    let done = 0;
    const total = urls.length + snds.length + 1;
    const step = () => {
      done++;
      const p = Math.round((done / total) * 100);
      bar.style.width = p + "%";
      tx.textContent = `마을 준비 중… ${p}%`;
    };
    await Promise.all([
      ...urls.map(
        (u) =>
          new Promise<void>((res) => {
            const im = new Image();
            im.onload = im.onerror = () => {
              step();
              res();
            };
            im.src = u;
            void im.decode?.().catch(() => {});
          }),
      ),
      ...snds.map((u) => S.preload(u).then(step)),
      // 한글 글꼴은 글자 묶음별로 늦게 받아져서(구글 폰트) 처음 보일 때 다른 글꼴로 깨져 보임 → 화면에 쓰는 글자를 미리 다 받음
      Promise.race([Promise.all([document.fonts?.ready, document.fonts?.load?.("20px Jua", GLYPHS)]).catch(() => {}), sleep(5000)]).then(step),
    ]);
    if (!alive) return;
    bar.style.width = "100%";
    tx.textContent = "마을 준비 완료 100%";
    await sleep(250);
    // 로그인 확인이 끝날 때까지 잠깐 기다림 (회원이면 바로 마을, 아니면 시작 화면)
    for (let k = 0; k < 40 && H?.loading; k++) await sleep(100);
    if (!alive) return;
    member = H?.member ?? null;
    if (member) {
      ME = memberProfile(member);
      await syncMe();
      enterTown();
    } else if (!H) enterTown();
    else openTitle();
  })();

  return () => {
    alive = false;
    if (T.raf) cancelAnimationFrame(T.raf);
    for (const t of timers) clearTimeout(t);
    timers.clear();
    cancelAnimationFrame(clockRaf);
    LB.unsub?.();
    RM.unsub?.();
    if (RM.id && NET) void NET.rpc("town.leave", { id: RM.id }).catch(() => {});
    if (H) H.changed = undefined;
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keydown", onFirst);
    root.removeEventListener("pointerdown", onFirst, { capture: true });
    previewA?.pause();
    S.stop();
    window.removeEventListener("keyup", onKeyUp);
    root.removeEventListener("pointerdown", onStageDown);
    root.removeEventListener("click", onBtnClick, { capture: true });
    window.removeEventListener("pointermove", onStageMove);
    window.removeEventListener("pointerup", onStageUp);
    window.removeEventListener("pointercancel", onStageUp);
    root.innerHTML = "";
  };
}
