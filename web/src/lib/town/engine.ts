/*
 * TABLE TOWN 엔진 — 마을(옆 시점 거리) → 대기실 → 원카드(4인, 봇 3) → 결과.
 * React 는 무대(Stage)만 잡고, 안쪽은 이 파일이 DOM 을 직접 그림 (1280 × 720 디자인, 무대가 통째로 키우고 줄임).
 * 그림은 assets.ts 의 ART 에 주소가 있으면 그 그림, 없으면 코드로 그린 임시 모양.
 */
import { BGM, SFX, SFX_B, allSound, createSound, type BgmId, type SfxId } from "./sound";
import { ART, SIGN, SIGN2, allArt, type CharId, type Face, type LookId, type UiIcon } from "./assets";
import { BOT_POOL, CHARS, GACHA, GAMES, REWARD, loadProfile, saveProfile, type BotSeat, type BotStyle, type Profile } from "./data";

export const DW = 1280;
export const DH = 720;

type Screen = "loading" | "town" | "room" | "game" | "gacha";

interface Card {
  id: number;
  r: number;
  s: number;
  jk?: boolean;
}

interface Player {
  char: CharId;
  look: LookId;
  nick: string;
  bot: boolean;
  style: BotStyle;
  miss: number;
  hand: Card[];
  out: boolean;
  face: Face;
  faceT: ReturnType<typeof setTimeout> | undefined;
}

interface GameState {
  P: Player[];
  turn: number;
  dir: 1 | -1;
  pile: Card[];
  draw: Card[];
  suit: number;
  free: boolean;
  pending: number;
  atk: number;
  one: { pi: number; called: boolean; id: number } | null;
  over: boolean;
  sort: "suit" | "rank";
  busy: boolean;
  tid: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const SU = ["♠", "♥", "♦", "♣"];
const rl = (r: number) => ({ 11: "J", 12: "Q", 13: "K", 14: "A" })[r as 11] ?? String(r);
const isRed = (c: Card) => c.s === 1 || c.s === 2;
const strength = (c: Card) => (c.jk ? 3 : c.r === 14 ? 2 : c.r === 2 ? 1 : 0);
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
    <button class="tt-colbtn tt-panel" type="button" data-soon="미션">${icon("mission")}미션</button>
  </div>
  <button class="tt-ui tt-panel tt-sq tt-chat" type="button" aria-label="채팅" data-soon="채팅">${icon("chat")}<i class="tt-badge"></i></button>
  <div class="tt-ui tt-pad" aria-label="이동">
    <button class="tt-arr tt-au" type="button" aria-label="위">▲</button>
    <button class="tt-arr tt-al" type="button" aria-label="왼쪽">◀</button>
    <button class="tt-arr tt-ar" type="button" aria-label="오른쪽">▶</button>
    <button class="tt-arr tt-ad" type="button" aria-label="아래">▼</button>
  </div>
  <button class="tt-ui tt-gamelist" type="button">${icon("list")}<b>게임 목록</b><i>${CHEV}</i></button>
  <button class="tt-ui tt-quick" type="button">${icon("sort")}<b>빠른 게임</b><i>${CHEV}</i></button>
</div>

<div class="tt-screen tt-room" data-s="room" hidden>
  <div class="tt-room-bg"></div>
  <button class="tt-backbtn tt-panel" type="button">${BACK}<span>마을로</span></button>
  <div class="tt-panel tt-roomtitle"><div class="tt-t">원카드 대기실</div><div class="tt-n"><span class="tt-roomno"></span><button type="button" class="tt-roomlist">방 목록</button></div></div>
  <div class="tt-ui tt-money tt-money-room"></div>
  <div class="tt-rcount" aria-label="인원">👥 <b>1/4</b></div>
  <div class="tt-rtable"></div>
  <div class="tt-rseats"></div>
  <div class="tt-panel tt-rinfo">
    <div class="tt-rtabs" role="tablist"><button type="button" class="on" data-rt="info">게임 정보</button><button type="button" data-rt="set">방 설정</button></div>
    <div class="tt-rpage" data-rp="info">
      <h3>원카드 <small>2~4명 · 약 5분</small></h3>
      <ol>
        <li>바닥 카드와 <b>무늬나 숫자</b>가 같은 카드를 내요. 먼저 다 털면 1등!</li>
        <li>공격 카드: <b>2</b>는 +2장, <b>A</b>는 +3장, <b>조커</b>는 +5장. 같은 숫자나 더 센 공격으로 받아칠 수 있어요.</li>
        <li><b>7</b> 무늬 바꾸기 · <b>J</b> 건너뛰기 · <b>Q</b> 방향 반대 · <b>K</b> 한 장 더</li>
        <li>1장 남으면 「원카드!」를 눌러요. 남이 안 누르면 내가 잡을 수 있어요.</li>
      </ol>
      <div class="tt-rowx"><span>순위 보상</span><div class="tt-rewards">${REWARD.map((v, i) => `<span><b>${i + 1}등</b>${icon("coin")}${v}</span>`).join("")}</div></div>
    </div>
    <div class="tt-rpage" data-rp="set" hidden>
      <div class="tt-rowx"><span>모드</span><div class="tt-modes"><button class="on" type="button">일반 판</button><button type="button" disabled>빠른 판</button></div></div>
      <div class="tt-rowx"><span>인원</span><b class="tt-rval">4명</b></div>
      <div class="tt-rowx"><span>방 공개</span><div class="tt-modes"><button class="on" type="button" data-pub="1">공개</button><button type="button" data-pub="0">비공개</button></div></div>
      <div class="tt-rowx"><span>초대하기</span><button type="button" class="tt-rinvite">🔗 초대 링크 복사</button></div>
      <p class="tt-rnote">빈자리가 있으면 게임 시작 때 봇이 자동으로 앉아요.</p>
    </div>
  </div>
  <form class="tt-rchat"><input type="text" maxlength="40" placeholder="대기실에 한마디…" aria-label="채팅 입력"><button type="submit">${icon("chat")}</button></form>
  <button class="tt-start" type="button"><span>게임 시작</span><i>${CHEV}</i></button>
</div>

<div class="tt-screen tt-game" data-s="game" hidden>
  <div class="tt-game-bg"></div>
  <div class="tt-felt"></div>
  <div class="tt-gtop"><button class="tt-panel tt-sq tt-pause" type="button" aria-label="메뉴">❚❚</button><div class="tt-panel tt-gtitle"><div class="tt-t">원카드</div><div class="tt-s">4인전 · 일반 판</div></div></div>
  <button class="tt-panel tt-sq tt-gchat" type="button" data-soon="채팅" aria-label="채팅">${icon("chat")}</button>
  <svg class="tt-dir" viewBox="0 0 600 240" aria-hidden="true"><defs><marker id="tt-ah" viewBox="0 0 10 10" markerWidth="3" markerHeight="3" refX="5" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#fff"/></marker></defs>
    <path d="M90,170 A220,95 0 0 1 300,30" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" marker-end="url(#tt-ah)"/>
    <path d="M510,70 A220,95 0 0 1 300,210" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" marker-end="url(#tt-ah)"/></svg>
  <div class="tt-seats"></div>
  <div class="tt-panel tt-turn"><div class="tt-tx"></div><div class="tt-sub"></div><div class="tt-tbar"><i></i></div></div>
  <div class="tt-center">
    <div class="tt-pilewrap"><div class="tt-stack tt-drawstack"><div class="tt-back tt-big"></div></div><span class="tt-drawcnt"></span></div>
    <div class="tt-pilewrap"><div class="tt-stack tt-top"></div><span>바닥 카드</span></div>
    <div class="tt-suitc"><div><small>지금 무늬</small><b></b></div></div>
  </div>
  <div class="tt-hand"></div>
  <div class="tt-gbtns">
    <button class="tt-draw" type="button">카드 받기</button>
    <button class="tt-one" type="button">원카드!</button>
    <div class="tt-gsmall"><button class="tt-panel tt-sortbtn" type="button">${icon("sort")}카드 정렬</button><button class="tt-panel tt-emobtn" type="button">${icon("emote")}감정표현</button></div>
  </div>
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
    <div class="tt-gpity"><div class="tt-gpity-row"><span>천장</span><b class="tt-gpity-n"></b><span>/ ${GACHA.pity}</span><i>🎁</i></div><div class="tt-gpity-bar"><i></i></div><small>${GACHA.pity}회 안에 코스튬 확정! · 가진 코스튬은 안 나와요</small></div><div class="tt-gdone">🎉 이 배너 코스튬을 전부 모았어요</div>
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
  /** 사이트 관리자면 설정에서 코인 · 천장 · 보유 코스튬 등을 바꿀 수 있음 */
  admin?: boolean;
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

  const ME: Profile = loadProfile();
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
    if (b.matches(".tt-x, .tt-backbtn")) sfx("close");
    else if (b.matches("[data-rt], .tt-cpick, .tt-gcard")) sfx("tab");
    else sfx("click");
  };
  root.addEventListener("click", onBtnClick, { capture: true });
  const save = () => saveProfile(ME);
  let CUR: Screen = "loading";
  const scale = () => root.getBoundingClientRect().width / DW || 1;

  function show(s: Screen) {
    for (const el of $$(".tt-screen")) el.hidden = el.dataset.s !== s;
    CUR = s;
    S.bgm(BGM_OF[s] ?? null);
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
    for (const sel of [".tt-money-town", ".tt-money-room"]) {
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
    w += `<div class="tt-ent tt-pl"><div class="tt-shadow"></div><div class="tt-sdwrap"></div><div class="tt-tag me"><i></i>나</div></div>`;
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
        enterRoom();
      };
  }
  function tryEnter() {
    if (T.near < 0) return;
    const g = GAMES[T.near];
    if (!g.open) return toast(`${g.name}은(는) 아직 공사 중이에요`);
    enterRoom();
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
  $(".tt-quick").onclick = () => enterRoom();
  $(".tt-gamelist").onclick = () => {
    const ov = overlay(
      `<h2>게임 목록</h2><div class="tt-glist">${GAMES.map(
        (g, i) =>
          `<button type="button" data-i="${i}" class="${g.open ? "open" : ""}" ${g.open ? "" : "disabled"}>${ART.bld[g.id] ? `<img src="/town/bld/thumb/${g.id}.webp" alt="" draggable="false">` : `<span>${g.ic}</span>`}<div><b>${g.name}</b><small>${g.open ? "지금 바로 입장" : "준비 중"}</small></div>${g.open ? `<i>${CHEV}</i>` : ""}</button>`,
      ).join("")}</div><div class="tt-row"><button type="button" class="tt-x">닫기</button></div>`,
    );
    ov.querySelector<HTMLElement>(".tt-x")!.onclick = () => ov.remove();
    $$(".tt-glist button", ov).forEach(
      (b) =>
        (b.onclick = () => {
          ov.remove();
          enterRoom();
        }),
    );
  };
  // 캐릭터 화면: 풀버전 일러(배경 붙여서) 크게 + 가진 모습 고르기
  const fullHTML = (c: CharId, l: LookId) => {
    const a = ART.char[c]?.[l];
    const bg = a?.bg ?? ART.fullBg;
    const k = lookOf(c, l);
    return `<div class="tt-full" style="${bg ? `background-image:url(${bg})` : `background:linear-gradient(160deg,${k.hair}55,#26304f)`}">${
      a?.full ? `<img src="${a.full}" alt="" draggable="false">` : `<div class="tt-full-ph">${sdHTML(c, l)}<small>풀버전 일러 자리</small></div>`
    }</div>`;
  };
  const openChar = () => {
    let selC: CharId = ME.char,
      selL: LookId = ME.look;
    const ov = overlay(`<div class="tt-charscr"><div class="tt-charview"></div><div class="tt-charside"><h2></h2><p class="tt-charsub"></p><div class="tt-cgrid"></div><div class="tt-row"><button type="button" class="tt-x">닫기</button><button type="button" class="pri tt-use">장착</button></div></div></div>`);
    ov.classList.add("wide");
    const draw = () => {
      ov.querySelector(".tt-charview")!.innerHTML = fullHTML(selC, selL);
      ov.querySelector("h2")!.textContent = CHARS[selC].name;
      const own = selL === "base" || ME.owned.includes(`${selC}:${selL}`);
      ov.querySelector(".tt-charsub")!.textContent = `${CHARS[selC].looks[selL].name}${own ? "" : " · 뽑기에서 얻을 수 있어요"}`;
      const use = ov.querySelector<HTMLButtonElement>(".tt-use")!;
      use.disabled = !own || (selC === ME.char && selL === ME.look);
      use.textContent = selC === ME.char && selL === ME.look ? "장착 중" : own ? "장착" : "뽑기 하러 가기";
      use.disabled = selC === ME.char && selL === ME.look;
      const opts: string[] = [];
      for (const c of Object.values(CHARS))
        for (const l of Object.keys(c.looks) as LookId[]) {
          const has = l === "base" || ME.owned.includes(`${c.id}:${l}`);
          opts.push(
            `<button type="button" class="tt-cpick ${selC === c.id && selL === l ? "on" : ""} ${has ? "" : "locked"} ${ME.char === c.id && ME.look === l ? "using" : ""}" data-c="${c.id}" data-l="${l}"><span class="tt-cpimg" style="${(artOf(c.id, l).bg ?? ART.fullBg) ? `background-image:url(${artOf(c.id, l).bg ?? ART.fullBg})` : ""}">${artOf(c.id, l).sd ? `<img src="${artOf(c.id, l).sd}" alt="" draggable="false">` : faceHTML(c.id, l)}${has ? "" : "<i>🔒</i>"}</span><b>${l === "base" ? c.name : c.looks[l].name}</b><small>${l === "base" ? "기본" : has ? "코스튬" : "뽑기에서 획득"}</small></button>`,
          );
        }
      ov.querySelector(".tt-cgrid")!.innerHTML = opts.join("");
      $$(".tt-cpick", ov).forEach(
        (b) =>
          (b.onclick = () => {
            selC = b.dataset.c as CharId;
            selL = b.dataset.l as LookId;
            draw();
          }),
      );
    };
    draw();
    ov.querySelector<HTMLElement>(".tt-x")!.onclick = () => ov.remove();
    ov.querySelector<HTMLElement>(".tt-use")!.onclick = () => {
      if (!(selL === "base" || ME.owned.includes(`${selC}:${selL}`))) {
        ov.remove();
        return ($(".tt-open-shop") as HTMLElement).click();
      }
      ME.char = selC;
      ME.look = selL;
      save();
      refreshMoney();
      refreshPlayerSd();
      draw();
    };
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
    if (!opts.admin) {
      const ov = overlay(`<h2>설정</h2>${soundHTML()}<div class="tt-row"><button type="button" class="pri tt-x">닫기</button></div>`);
      bindSound(ov);
      ov.querySelector<HTMLElement>(".tt-x")!.onclick = () => ov.remove();
      return;
    }
    const looks = Object.values(CHARS).flatMap((c) =>
      (Object.keys(c.looks) as LookId[]).filter((l) => l !== "base").map((l) => ({ c: c.id, l, name: c.looks[l].name })),
    );
    const ov = overlay(
      `<h2>관리자 설정</h2><p class="tt-adm-sub">이 기기의 TABLE TOWN 정보만 바뀌어요.</p>
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
      <div class="tt-row"><button type="button" class="tt-adm-reset">처음 상태로</button><button type="button" class="tt-x">닫기</button><button type="button" class="pri tt-adm-save">저장</button></div>`,
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
      refreshMoneyAll();
      refreshPlayerSd();
      if (CUR === "gacha") renderGacha();
      ov.remove();
      toast("처음 상태로 돌렸어요");
    };
  };
  $(".tt-open-char").onclick = openChar;
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
      eb.textContent = GAMES[near].open ? "입장" : "공사 중";
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

  // =================== 대기실 ===================
  const R = { seats: [] as (BotSeat | null)[], no: 0 };
  function pickBots(n: number): BotSeat[] {
    // 내 모습과 똑같은 봇은 빼고 고름
    const pool = BOT_POOL.filter((b) => !(b.char === ME.char && b.look === ME.look));
    return pool.sort(() => Math.random() - 0.5).slice(0, n);
  }
  function enterRoom() {
    sfx("enter");
    const bots = pickBots(3);
    R.seats = [null, bots[0], bots[1], null];
    R.no = 1000 + ((Math.random() * 9000) | 0);
    $(".tt-room-bg").style.backgroundImage = ART.room ? `url(${ART.room})` : "";
    $(".tt-rtable").hidden = !!ART.room;
    root.querySelector(".tt-ov")?.remove();
    show("room");
    refreshMoney();
    renderRoom();
  }
  // 앉은 그림이 다 있으면: 테이블 없는 방 → 뒷자리(정면) → 테이블 → 앞자리(뒷모습) 순서로 겹쳐서 진짜 테이블에 둘러앉은 느낌
  // 자리마다 위치 · 크기를 따로 (한 폭의 그림처럼): 앞 두 자리는 테이블 가장자리에 걸쳐 앉음
  const SEATS = [
    { cx: 200, bottom: 676, h: 334, back: true, tag: { x: 20, y: 300 } }, // 0 나: 앞 왼쪽 (뒷모습, 테이블로 손 뻗음)
    { cx: 292, bottom: 392, h: 248, back: false, tag: { x: 160, y: 118 } }, // 1 뒤 왼쪽 (턱 괴기)
    { cx: 566, bottom: 402, h: 248, back: false, tag: { x: 470, y: 128 } }, // 2 뒤 오른쪽 (손 흔들기)
    { cx: 704, bottom: 662, h: 322, back: true, tag: { x: 606, y: 300 } }, // 3 앞 오른쪽 (옆으로 앉아 테이블 봄)
  ];
  const seatArt = (c: CharId, l: LookId, i: number) => artOf(c, l).seat?.[i];
  function renderRoomSeated(): boolean {
    const ok = ART.roomEmpty && ART.roomTable && [0, 1, 2, 3].every((i) => {
      const c = i === 0 ? ME.char : R.seats[i]?.char;
      const l = i === 0 ? ME.look : R.seats[i]?.look;
      return !c || !!seatArt(c, l!, i);
    });
    if (!ok) return false;
    $(".tt-room-bg").style.backgroundImage = `url(${ART.roomEmpty})`;
    let h = `<img class="tt-rtab" src="${ART.roomTable}" alt="" draggable="false">`;
    if (ART.cardBack) h += `<div class="tt-rdeck">${[0, 1, 2, 3].map((k) => `<img src="${ART.cardBack}" alt="" style="--k:${k}">`).join("")}</div>`;
    SEATS.forEach((S, i) => {
      const b = R.seats[i];
      const c = i === 0 ? ME.char : b?.char;
      const l = i === 0 ? ME.look : b?.look;
      const z = S.back ? 30 : 10;
      if (c && l) {
        const src = seatArt(c, l, i)!;
        h += `<img class="tt-rseatimg" src="${src}" alt="" draggable="false" style="left:${S.cx}px;top:${S.bottom - S.h}px;height:${S.h}px;z-index:${z}">`;
        const nm = i === 0 ? CHARS[ME.char].name : b!.nick;
        h += `<div class="tt-rtag" style="left:${S.tag.x}px;top:${S.tag.y}px"><div class="tt-av" style="${avBg(c, l)}">${faceHTML(c, l)}</div><div><div class="tt-nm">${nm}${i ? '<span class="tt-botb">BOT</span>' : ' <span class="tt-meb">나</span>'}</div><div class="tt-ready">✔ 준비 완료</div></div></div>`;
      } else {
        h += `<div class="tt-rempty" style="left:${S.cx - 100}px;top:${S.back ? 600 : 250}px;z-index:45"><div class="tt-empty">빈 자리</div><div class="tt-rbtns"><button class="tt-sbtn" type="button" data-inv>+ 초대</button><button class="tt-sbtn dark" type="button" data-bot="${i}">봇 채우기</button></div></div>`;
      }
    });
    $(".tt-rseats").innerHTML = h;
    $(".tt-rcount b").textContent = `${1 + R.seats.slice(1).filter(Boolean).length}/4`;
    return true;
  }
  function renderRoom() {
    $(".tt-roomno").textContent = `방 번호 ${R.no}`;
    $(".tt-rtable").hidden = !!ART.room;
    if (renderRoomSeated()) return bindRoomBtns();
    $(".tt-room-bg").style.backgroundImage = ART.room ? `url(${ART.room})` : "";
    const pos = ART.room
      ? [
          [70, 440],
          [120, 150],
          [470, 150],
          [560, 440],
        ]
      : [
          [110, 452],
          [150, 140],
          [470, 140],
          [520, 452],
        ];
    $(".tt-rseats").innerHTML = [0, 1, 2, 3]
      .map((i) => {
        const [x, y] = pos[i];
        const b = R.seats[i];
        if (i > 0 && !b)
          return `<div class="tt-rseat" style="left:${x}px;top:${y}px"><div class="tt-empty">빈 자리</div><div class="tt-rbtns"><button class="tt-sbtn" type="button" data-inv>+ 초대</button><button class="tt-sbtn dark" type="button" data-bot="${i}">🤖 봇 채우기</button></div></div>`;
        const c = i === 0 ? ME.char : b!.char,
          l = i === 0 ? ME.look : b!.look;
        const nm = i === 0 ? CHARS[ME.char].name : b!.nick;
        return `<div class="tt-rseat" style="left:${x}px;top:${y}px"><div class="tt-rcard tt-panel"><div class="tt-av" style="${avBg(c, l)}">${faceHTML(c, l)}</div><div><div class="tt-nm">${nm}${i ? '<span class="tt-botb">BOT</span>' : ' <span class="tt-meb">나</span>'}</div><div class="tt-ready">✔ 준비 완료</div></div></div><div class="tt-rsd">${sdHTML(c, l, i === 2 || i === 3)}</div></div>`;
      })
      .join("");
    bindRoomBtns();
  }
  function bindRoomBtns() {
    $$("[data-inv]", $(".tt-rseats")).forEach((b) => (b.onclick = () => toast("초대 링크는 곧 열려요")));
    $$("[data-bot]", $(".tt-rseats")).forEach(
      (b) =>
        (b.onclick = () => {
          const used = R.seats.filter(Boolean) as BotSeat[];
          const free = BOT_POOL.filter((x) => !used.includes(x) && !(x.char === ME.char && x.look === ME.look));
          R.seats[+b.dataset.bot!] = free[0] ?? BOT_POOL[0];
          sfx("botJoin");
          renderRoom();
        }),
    );
  }
  $(".tt-backbtn").onclick = goTown;
  $(".tt-roomlist").onclick = () => {
    const ov = overlay(`<h2>방 목록</h2><p>지금 열린 다른 방이 없어요.<br>여기서 바로 시작하면 빈자리는 봇이 채워줘요.</p><div class="tt-row"><button class="pri" type="button">여기서 시작</button></div>`);
    ov.querySelector<HTMLElement>("button")!.onclick = () => ov.remove();
  };
  $(".tt-rinvite").onclick = () => {
    const url = `${location.origin}/games/town/?room=${R.no}`;
    navigator.clipboard?.writeText(url).then(
      () => toast("초대 링크를 복사했어요"),
      () => toast(url),
    );
  };
  $$("[data-rt]").forEach(
    (b) =>
      (b.onclick = () => {
        $$("[data-rt]").forEach((x) => x.classList.toggle("on", x === b));
        $$("[data-rp]").forEach((x) => (x.hidden = x.dataset.rp !== b.dataset.rt));
      }),
  );
  $$("[data-pub]").forEach(
    (b) =>
      (b.onclick = () => {
        $$("[data-pub]").forEach((x) => x.classList.toggle("on", x === b));
        toast(b.dataset.pub === "1" ? "누구나 들어올 수 있어요" : "초대한 사람만 들어올 수 있어요");
      }),
  );
  ($(".tt-rchat") as HTMLFormElement).onsubmit = (e) => {
    e.preventDefault();
    const inp = $(".tt-rchat input") as HTMLInputElement;
    const msg = inp.value.trim();
    inp.value = "";
    inp.blur();
    if (!msg) return;
    const tag = $(".tt-rtag");
    if (!tag) return;
    tag.querySelector(".tt-rbub")?.remove();
    const bub = document.createElement("div");
    bub.className = "tt-rbub";
    bub.dataset.c = ME.char;
    sfx("chat");
    bub.textContent = msg;
    tag.appendChild(bub);
    setTimeout(() => bub.remove(), 3500);
    // 봇 하나가 가끔 대꾸
    const bi = [1, 2, 3].filter((i) => R.seats[i]);
    if (bi.length && Math.random() < 0.7) {
      const i = bi[(Math.random() * bi.length) | 0];
      const b = R.seats[i]!;
      setTimeout(() => {
        const t = $$(".tt-rtag")[bi.indexOf(i) + 1] ?? null;
        if (!t || !$(".tt-room").offsetParent) return;
        t.querySelector(".tt-rbub")?.remove();
        const r = document.createElement("div");
        r.className = "tt-rbub";
        r.dataset.c = b.char;
        sfx("chat", { rate: 1.12 });
        r.textContent = pick(CHARS[b.char].lines.town);
        t.appendChild(r);
        setTimeout(() => r.remove(), 3000);
      }, 900);
    }
  };
  $(".tt-start").onclick = () => {
    if (R.seats.slice(1).includes(null)) {
      const used = R.seats.filter(Boolean) as BotSeat[];
      const free = BOT_POOL.filter((x) => !used.includes(x) && !(x.char === ME.char && x.look === ME.look));
      R.seats = R.seats.map((s, i) => (i === 0 ? null : s ?? free.shift() ?? BOT_POOL[0]));
      startGame();
      return toast("빈자리는 봇으로 채웠어요");
    }
    startGame();
  };

  // =================== 원카드 ===================
  let CID = 0;
  function buildDeck(): Card[] {
    const d: Card[] = [];
    for (let s = 0; s < 4; s++) for (let r = 2; r <= 14; r++) d.push({ id: ++CID, r, s });
    d.push({ id: ++CID, jk: true, r: 99, s: -1 }, { id: ++CID, jk: true, r: 99, s: -1 });
    for (let i = d.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
  }
  function cardHTML(c: Card, cls = "", style = "") {
    if (c.jk)
      return ART.joker
        ? `<div class="tt-c jk art ${cls}" style="${style}" data-id="${c.id}"><img class="tt-jkfull" src="${ART.joker}" alt="" draggable="false"><span class="r">JOKER</span></div>`
        : `<div class="tt-c jk ${cls}" style="${style}" data-id="${c.id}"><span class="r">JOKER</span><span class="s2">🤡</span></div>`;
    return `<div class="tt-c ${isRed(c) ? "red" : ""} ${cls}" style="${style}" data-id="${c.id}"><span class="r">${rl(c.r)}</span><span class="s1">${SU[c.s]}</span><span class="s2">${SU[c.s]}</span></div>`;
  }
  const backHTML = (cls = "") =>
    ART.cardBack ? `<div class="tt-back tt-back-art ${cls}"><img src="${ART.cardBack}" alt="" draggable="false"></div>` : `<div class="tt-back ${cls}"></div>`;

  let G: GameState | null = null;
  const SEATPOS = [null, { x: 30, y: 120 }, { x: 522, y: 16 }, { x: 1014, y: 120 }];
  function startGame() {
    const deck = buildDeck();
    const mk = (b: BotSeat | null): Player =>
      b
        ? { char: b.char, look: b.look, nick: b.nick, bot: true, style: b.style, miss: b.miss, hand: [], out: false, face: "idle", faceT: undefined }
        : { char: ME.char, look: ME.look, nick: "나", bot: false, style: "normal", miss: 0, hand: [], out: false, face: "idle", faceT: undefined };
    G = {
      P: R.seats.map(mk),
      turn: 0,
      dir: 1,
      pile: [],
      draw: deck,
      suit: 0,
      free: false,
      pending: 0,
      atk: 0,
      one: null,
      over: false,
      sort: "suit",
      busy: false,
      tid: 0,
      timer: null,
    };
    for (let n = 0; n < 7; n++) for (const p of G.P) p.hand.push(G.draw.pop()!);
    let top: Card | null = null;
    while (!top) {
      top = G.draw.pop()!;
      if (top.jk || [2, 7, 11, 12, 13, 14].includes(top.r)) {
        G.draw.unshift(top);
        top = null;
      }
    }
    G.pile.push(top);
    G.suit = top.s;
    $(".tt-game-bg").style.backgroundImage = ART.room ? `url(${ART.room})` : "";
    $(".tt-drawstack").innerHTML = backHTML("tt-big");
    show("game");
    buildSeats();
    render();
    for (let k = 0; k < 6; k++) later(() => sfx("deal", { rate: 0.95 + Math.random() * 0.1 }), k * 90);
    beginTurn();
  }
  function buildSeats() {
    const g = G!;
    let h = "";
    g.P.forEach((p, i) => {
      const st = i === 0 ? "left:16px;top:560px" : `left:${SEATPOS[i]!.x}px;top:${SEATPOS[i]!.y}px`;
      h += `<div class="tt-seat tt-panel" data-p="${i}" style="${st}"><div class="tt-av" style="${avBg(p.char, p.look)}"></div><div><div class="tt-nm">${i ? p.nick : "나"}${i ? '<span class="tt-botb">BOT</span>' : ""}</div><div class="tt-cnt"><i></i><span></span>장</div></div></div>`;
      if (i) h += `<div class="tt-mini" data-p="${i}" style="left:${SEATPOS[i]!.x + 44}px;top:${SEATPOS[i]!.y + 94}px"></div>`;
    });
    $(".tt-seats").innerHTML = h;
  }
  function playable(c: Card) {
    const g = G!;
    const top = g.pile[g.pile.length - 1];
    if (g.pending > 0) {
      const t = strength(c);
      if (!t) return false;
      if (c.jk) return true;
      if (t === g.atk) return top.jk ? false : c.r === top.r;
      return t > g.atk && c.s === g.suit;
    }
    if (c.jk || g.free) return true;
    return c.s === g.suit || (!top.jk && c.r === top.r);
  }
  function nextIdx(from: number, steps: number) {
    const g = G!;
    let t = from;
    for (let k = 0; k < steps; k++) {
      do t = (t + g.dir + 4) % 4;
      while (g.P[t].out);
    }
    return t;
  }
  const active = () => G!.P.filter((p) => !p.out);
  function sortHand(h: Card[]) {
    return G!.sort === "suit"
      ? h.sort((a, b) => (a.jk ? 9 : a.s) - (b.jk ? 9 : b.s) || a.r - b.r)
      : h.sort((a, b) => a.r - b.r || a.s - b.s);
  }

  function render() {
    const g = G;
    if (!g) return;
    const me = g.P[0],
      myTurn = g.turn === 0 && !g.over;
    g.P.forEach((p, i) => {
      const s = $(`.tt-seat[data-p="${i}"]`);
      s.classList.toggle("turn", g.turn === i && !g.over);
      s.classList.toggle("one", p.hand.length === 1 && !p.out);
      s.classList.toggle("out", p.out);
      s.querySelector(".tt-cnt span")!.textContent = p.out ? "파산 " : String(p.hand.length);
      const av = s.querySelector(".tt-av")!;
      const fk = `${p.char}${p.look}${p.face}`;
      if (av.getAttribute("data-f") !== fk) {
        av.setAttribute("data-f", fk);
        av.innerHTML = faceHTML(p.char, p.look, p.face);
      }
      if (i) {
        const n = Math.min(p.hand.length, 10);
        $(`.tt-mini[data-p="${i}"]`).innerHTML = Array.from({ length: n }, (_, k) => `<div style="left:${k * 12}px">${backHTML("tt-sm")}</div>`).join("");
      }
    });
    const top = g.pile[g.pile.length - 1];
    $(".tt-top").innerHTML = cardHTML(top, "static");
    const sb = root.querySelector<HTMLElement>(".tt-suitc b")!;
    sb.textContent = g.free ? "★" : SU[g.suit];
    sb.style.color = g.free ? "var(--tt-gold)" : g.suit === 1 || g.suit === 2 ? "#ff7d8f" : "#fff";
    root.querySelector(".tt-suitc small")!.textContent = g.free ? "아무 카드나" : "지금 무늬";
    $(".tt-drawcnt").textContent = `뽑는 더미 ${g.draw.length}`;
    root.querySelector(".tt-dir")!.classList.toggle("rev", g.dir < 0);
    const tp = g.P[g.turn];
    $(".tt-turn").classList.toggle("atk", g.pending > 0);
    $(".tt-turn .tt-tx").textContent = g.over
      ? "게임 끝"
      : myTurn
        ? g.pending > 0
          ? `공격 +${g.pending} 받을 차례!`
          : "내 차례 · 카드를 내세요"
        : `${tp.nick} 차례`;
    $(".tt-turn .tt-sub").textContent =
      g.pending > 0 ? (myTurn ? "더 센 공격이나 같은 숫자로 받아칠 수 있어" : `공격 +${g.pending} 누적 중`) : "";
    sortHand(me.hand);
    const n = me.hand.length,
      Wd = 780,
      cw = 88,
      sp = n > 1 ? Math.min(64, (Wd - cw) / (n - 1)) : 0,
      start = (Wd - (cw + sp * (n - 1))) / 2;
    $(".tt-hand").innerHTML = me.hand
      .map((c, i) => {
        const can = myTurn && !g.busy && playable(c),
          dim = myTurn && !can;
        const mid = (n - 1) / 2,
          ang = (i - mid) * Math.min(3.2, 30 / Math.max(n, 1)),
          dy = Math.abs(i - mid) ** 2 * Math.min(1.6, 14 / Math.max(n, 1));
        return cardHTML(
          c,
          (can ? "can" : "") + (dim ? " dim" : ""),
          `left:${start + i * sp}px;top:${40 + dy}px;transform:rotate(${ang}deg) translateY(${can ? -28 : 0}px);z-index:${i}`,
        );
      })
      .join("");
    $$(".tt-hand .tt-c.can").forEach((el) => (el.onclick = () => meClick(+el.dataset.id!)));
    const db = $<HTMLButtonElement>(".tt-draw");
    db.disabled = !myTurn || g.busy;
    db.classList.toggle("atk", g.pending > 0);
    db.textContent = g.pending > 0 ? `${g.pending}장 받기` : "카드 받기";
    const ob = $(".tt-one");
    const live = !!(g.one && !g.one.called);
    ob.classList.toggle("live", live);
    ob.textContent = live && g.one!.pi !== 0 ? `${g.P[g.one!.pi].nick} 잡기!` : "원카드!";
  }
  function bubble(i: number, text: string, ms = 1600) {
    const anchor = i === 0 ? { x: 110, y: 530 } : i === 2 ? { x: 790, y: 40 } : i === 1 ? { x: 70, y: 84 } : { x: 1060, y: 84 };
    const el = document.createElement("div");
    el.className = "tt-bub";
    el.textContent = text;
    el.style.left = anchor.x + "px";
    el.style.top = anchor.y + "px";
    $(".tt-game").appendChild(el);
    later(() => el.remove(), ms);
  }
  function setFace(i: number, f: Face, ms = 1800) {
    const g = G!;
    const p = g.P[i];
    p.face = f;
    if (p.faceT) clearTimeout(p.faceT);
    p.faceT = later(() => {
      if (!G) return;
      p.face = p.hand.length === 1 ? "smug" : "idle";
      render();
    }, ms);
    render();
  }
  const stagePt = (el: Element) => {
    const r = el.getBoundingClientRect(),
      s = root.getBoundingClientRect(),
      k = scale();
    return { x: (r.left - s.left) / k, y: (r.top - s.top) / k };
  };
  const seatPt = (i: number) => (i === 0 ? { x: 420, y: 560 } : i === 2 ? { x: 600, y: 60 } : i === 1 ? { x: 120, y: 200 } : { x: 1080, y: 200 });
  async function fly(from: { x: number; y: number }, to: { x: number; y: number }, html: string) {
    const el = document.createElement("div");
    el.className = "tt-fly";
    el.innerHTML = html;
    el.style.left = from.x + "px";
    el.style.top = from.y + "px";
    $(".tt-game").appendChild(el);
    el.getBoundingClientRect();
    el.style.left = to.x + "px";
    el.style.top = to.y + "px";
    await sleep(330);
    el.remove();
  }
  const topPt = () => stagePt($(".tt-top"));
  const drawPt = () => stagePt($(".tt-drawstack"));
  const clearTimer = () => {
    if (G?.timer) clearTimeout(G.timer);
    if (G) G.timer = null;
  };

  function beginTurn() {
    const g = G;
    if (!g || g.over) return;
    g.tid++;
    render();
    const p = g.P[g.turn];
    if (p.bot) return void botTurn(g.tid);
    sfx("myTurn");
    const bar = root.querySelector<HTMLElement>(".tt-tbar i")!;
    bar.style.transition = "none";
    bar.style.width = "100%";
    bar.getBoundingClientRect();
    bar.style.transition = "width 15s linear";
    bar.style.width = "0%";
    clearTimer();
    const id = g.tid;
    g.timer = later(() => {
      if (G && G.tid === id && G.turn === 0 && !G.busy) {
        toast("시간 초과!");
        void takeOrDraw(0);
      }
    }, 15000);
  }
  function meClick(id: number) {
    const g = G;
    if (!g || g.turn !== 0 || g.busy || g.over) return;
    const c = g.P[0].hand.find((x) => x.id === id);
    if (!c || !playable(c)) return;
    if (c.r === 7 && !c.jk && g.pending === 0) {
      const ov = document.createElement("div");
      ov.className = "tt-suitpick";
      ov.innerHTML = `<div class="tt-panel"><h3>무늬를 골라</h3><div class="opts">${SU.map((s, i) => `<button type="button" class="${i === 1 || i === 2 ? "red" : ""}" data-s="${i}">${s}</button>`).join("")}</div></div>`;
      $(".tt-game").appendChild(ov);
      $$("button", ov).forEach(
        (b) =>
          (b.onclick = () => {
            ov.remove();
            void doPlay(0, c, +b.dataset.s!);
          }),
      );
      return;
    }
    void doPlay(0, c);
  }
  async function doPlay(pi: number, c: Card, suit?: number) {
    const g = G;
    if (!g || g.over) return;
    clearTimer();
    g.busy = true;
    const p = g.P[pi];
    let from;
    if (pi === 0) {
      const el = root.querySelector(`.tt-hand .tt-c[data-id="${c.id}"]`);
      from = el ? stagePt(el) : seatPt(0);
    } else from = seatPt(pi);
    p.hand = p.hand.filter((x) => x !== c);
    render();
    sfx("play", { rate: 0.94 + Math.random() * 0.12 });
    await fly(from, topPt(), cardHTML(c, "static"));
    if (G !== g) return;
    g.pile.push(c);
    if (c.jk || c.r === 2 || c.r === 14) sfx("attack");
    else if ([7, 11, 12, 13].includes(c.r)) sfx("special");
    if (c.jk) {
      g.pending += 5;
      g.atk = 3;
      g.free = true;
    } else {
      g.free = false;
      g.suit = c.s;
      if (c.r === 2) {
        g.pending += 2;
        g.atk = 1;
      } else if (c.r === 14) {
        g.pending += 3;
        g.atk = 2;
      }
      if (c.r === 7 && g.pending === 0 && suit !== undefined) g.suit = suit;
    }
    if (strength(c) && pi > 0) {
      setFace(pi, "smug");
      bubble(pi, pick(CHARS[p.char].lines.atk));
    }
    g.busy = false;
    if (p.hand.length === 0) return endGame(pi);
    if (p.hand.length === 1) openOne(pi);
    if (c.r === 11 && !c.jk) {
      bubble(nextIdx(pi, 1), "건너뜀!", 1100);
      g.turn = nextIdx(pi, 2);
    } else if (c.r === 12 && !c.jk) {
      g.dir = g.dir === 1 ? -1 : 1;
      toast("방향 반대!", 900);
      g.turn = nextIdx(pi, 1);
    } else if (c.r === 13 && !c.jk) {
      if (pi) bubble(pi, "한 장 더!", 1000);
      g.turn = pi;
    } else g.turn = nextIdx(pi, 1);
    beginTurn();
  }
  async function giveCards(pi: number, n: number) {
    const g = G!;
    for (let k = 0; k < n; k++) {
      if (!g.draw.length) {
        const top = g.pile.pop()!;
        g.draw = g.pile.sort(() => Math.random() - 0.5);
        g.pile = [top];
        toast("더미를 다시 섞었어요", 900);
      }
      if (!g.draw.length) break;
      const c = g.draw.pop()!;
      if (n <= 6 || k < 3) {
        sfx("draw", { rate: 0.95 + Math.random() * 0.1 });
        await fly(drawPt(), seatPt(pi), backHTML("tt-big"));
      }
      if (G !== g) return;
      g.P[pi].hand.push(c);
      render();
    }
  }
  async function takeOrDraw(pi: number) {
    const g = G;
    if (!g || g.over) return;
    clearTimer();
    g.busy = true;
    const n = g.pending > 0 ? g.pending : 1,
      wasAtk = g.pending > 0;
    g.pending = 0;
    g.atk = 0;
    if (g.one && g.one.pi === pi) g.one = null;
    await giveCards(pi, n);
    if (G !== g) return;
    g.busy = false;
    const p = g.P[pi];
    if (wasAtk && n >= 3) {
      setFace(pi, "sad", 2200);
      if (pi) bubble(pi, pick(CHARS[p.char].lines.hit));
      else toast(`${n}장 받았다…`);
    }
    if (p.hand.length >= 20) {
      p.out = true;
      toast(`${pi ? p.nick : "내가"} 파산! (20장)`, 1800);
      g.draw.unshift(...p.hand);
      p.hand = [];
      if (pi === 0) return endGame(-1);
      if (active().length === 1) return endGame(g.P.indexOf(active()[0]));
    }
    g.turn = nextIdx(pi, 1);
    beginTurn();
  }
  $(".tt-draw").onclick = () => {
    if (G && G.turn === 0 && !G.busy && !G.over) void takeOrDraw(0);
  };
  root.querySelector<HTMLElement>(".tt-sortbtn")!.onclick = () => {
    if (!G) return;
    G.sort = G.sort === "suit" ? "rank" : "suit";
    toast(G.sort === "suit" ? "무늬별 정렬" : "숫자별 정렬", 800);
    render();
  };
  root.querySelector<HTMLElement>(".tt-emobtn")!.onclick = () => {
    if (G) bubble(0, pick(["좋아요!", "헉…!", "ㅋㅋㅋ", "화이팅!"]), 1400);
  };

  let ONEID = 0;
  function openOne(pi: number) {
    const g = G!;
    const id = ++ONEID;
    g.one = { pi, called: false, id };
    render();
    if (pi > 0 && Math.random() > g.P[pi].miss)
      later(() => {
        if (G === g && g.one && g.one.id === id && !g.one.called) {
          g.one.called = true;
          setFace(pi, "smug");
          sfx("oneCall");
          bubble(pi, "원카드!");
          render();
        }
      }, rnd(500, 1900));
    later(async () => {
      if (G !== g || g.over || !g.one || g.one.id !== id) return;
      const o = g.one;
      g.one = null;
      render();
      if (o.called) return;
      if (o.pi === 0) {
        toast("원카드를 안 외쳤어요! +1장");
        await giveCards(0, 1);
      } else if (Math.random() < 0.6) {
        bubble(o.pi, pick(CHARS[g.P[o.pi].char].lines.caught));
        setFace(o.pi, "panic");
        await giveCards(o.pi, 1);
      }
    }, 2700);
  }
  $(".tt-one").onclick = async () => {
    const g = G;
    if (!g || !g.one || g.one.called) return;
    const o = g.one;
    if (o.pi === 0) {
      o.called = true;
      sfx("oneCall");
      bubble(0, "원카드!");
      render();
      return;
    }
    g.one = null;
    sfx("caught");
    toast(`${g.P[o.pi].nick}을(를) 잡았다! +1장`);
    bubble(o.pi, pick(CHARS[g.P[o.pi].char].lines.caught));
    setFace(o.pi, "panic");
    await giveCards(o.pi, 1);
  };

  async function botTurn(id: number) {
    await sleep(rnd(850, 1400));
    const g = G;
    if (!g || g.over || g.tid !== id) return;
    const pi = g.turn,
      p = g.P[pi],
      style = p.style;
    const cards = p.hand.filter(playable);
    if (!cards.length) return takeOrDraw(pi);
    if (g.pending > 0) {
      cards.sort((a, b) => strength(a) - strength(b));
      return doPlay(pi, cards[0]);
    }
    const nxt = g.P[nextIdx(pi, 1)],
      danger = nxt.hand.length <= 2 || p.hand.length <= 3;
    const cnt = [0, 0, 0, 0];
    p.hand.forEach((c) => {
      if (!c.jk) cnt[c.s]++;
    });
    let best = cards[0],
      bs = -1e9;
    for (const c of cards) {
      let s = c.jk ? 0 : cnt[c.s] + rnd(0, 1.5);
      const atk = strength(c);
      if (atk) {
        if (style === "aggro") s += 5;
        else if (style === "saver") s += danger ? 6 : -6;
        else s += danger ? 3 : 0;
      }
      if (c.jk && style !== "aggro" && !danger) s -= 6;
      if ((c.r === 11 || c.r === 12) && !c.jk) s += nxt.hand.length <= 3 ? 3 : 0;
      if (c.r === 13 && !c.jk) s += p.hand.some((x) => x !== c && !x.jk && (x.s === c.s || x.r === 13)) ? 2 : -2;
      if (c.r === 7 && !c.jk) s += cards.length === 1 ? 2 : -1;
      if (s > bs) {
        bs = s;
        best = c;
      }
    }
    let suit: number | undefined;
    if (best.r === 7 && !best.jk) {
      const cc = [0, 0, 0, 0];
      p.hand.filter((x) => x !== best && !x.jk).forEach((x) => cc[x.s]++);
      suit = cc.indexOf(Math.max(...cc));
    }
    return doPlay(pi, best, suit);
  }

  function endGame(wi: number) {
    const g = G;
    if (!g || g.over) return;
    g.over = true;
    clearTimer();
    g.one = null;
    render();
    const order = [...g.P.keys()].sort((a, b) => {
      const pa = g.P[a],
        pb = g.P[b];
      if (a === wi) return -1;
      if (b === wi) return 1;
      if (pa.out !== pb.out) return pa.out ? 1 : -1;
      return pa.hand.length - pb.hand.length;
    });
    const myRank = order.indexOf(0) + 1;
    const gain = g.P[0].out ? 0 : REWARD[myRank - 1];
    ME.coins += gain;
    ME.games = (ME.games ?? 0) + 1;
    save();
    S.duck(3200);
    sfx(myRank === 1 ? "win" : "lose");
    if (gain) later(() => sfx("coin"), 1300);
    if (wi > 0) {
      setFace(wi, "win", 5000);
      bubble(wi, pick(CHARS[g.P[wi].char].lines.win), 2000);
    } else if (wi === 0) setFace(0, "win", 5000);
    later(() => {
      const ov = overlay(
        `<h2>${myRank === 1 ? "1등! 🎉" : `${myRank}등`}</h2><p class="tt-gain">${icon("coin", "tt-coin")} +${gain.toLocaleString()}</p>
      <div class="tt-rank">${order
        .map((i, k) => {
          const p = g.P[i];
          return `<div class="${i === 0 ? "me" : ""}"><span class="pos">${k + 1}</span><div class="tt-av" style="${avBg(p.char, p.look)}">${faceHTML(p.char, p.look, k === 0 ? "win" : p.out ? "sad" : "idle")}</div><b>${i ? p.nick : "나"}</b><span class="left">${p.out ? "파산" : k === 0 ? "완주" : `${p.hand.length}장 남음`}</span></div>`;
        })
        .join("")}</div>
      <div class="tt-row"><button type="button" class="tt-rtown">마을로</button><button class="pri tt-ragain" type="button">한 판 더</button></div>`,
        $(".tt-game"),
      );
      ov.querySelector<HTMLElement>(".tt-rtown")!.onclick = () => {
        ov.remove();
        G = null;
        goTown();
      };
      ov.querySelector<HTMLElement>(".tt-ragain")!.onclick = () => {
        ov.remove();
        G = null;
        enterRoom();
      };
    }, 1400);
  }
  $(".tt-pause").onclick = () => {
    const ov = overlay(
      `<h2>메뉴</h2><p>지금 나가면 이번 판 보상은 없어요.</p><div class="tt-row"><button type="button" class="tt-pquit">나가기</button><button class="pri tt-pgo" type="button">계속하기</button></div>`,
      $(".tt-game"),
    );
    ov.querySelector<HTMLElement>(".tt-pgo")!.onclick = () => ov.remove();
    ov.querySelector<HTMLElement>(".tt-pquit")!.onclick = () => {
      ov.remove();
      if (G && !G.over) {
        G.over = true;
        clearTimer();
      }
      G = null;
      goTown();
    };
  };

  // =================== 코스튬 뽑기 ===================
  // 그림이 아직 없을 때 대신 그리는 캡슐 (금 = 코스튬, 파랑 = 꽝)
  const capHTML = (gold: boolean, cls = "") => {
    const src = gold ? ART.gacha.capGold : ART.gacha.capBlue;
    return src
      ? `<img class="tt-cap ${cls}" src="${src}" alt="" draggable="false">`
      : `<div class="tt-cap tt-cap-css ${gold ? "gold" : "blue"} ${cls}"><b>★</b></div>`;
  };
  const cosName = (c: CharId, l: LookId) => CHARS[c].looks[l].name;
  const ownKey = (c: CharId, l: LookId) => `${c}:${l}`;
  let gFeat = 0;
  const bgOf = (c: CharId, l: LookId) => ART.char[c]?.[l]?.bg ?? ART.fullBg;
  function renderGacha() {
    refreshMoneyAll();
    const feat = GACHA.pool[gFeat];
    const fa = ART.char[feat.char]?.[feat.look]?.full;
    const fe = $(".tt-gfeat-art");
    fe.classList.remove("swap");
    void fe.offsetWidth;
    fe.classList.add("swap");
    fe.innerHTML = fa ? `<img src="${fa}" alt="" draggable="false">` : sdHTML(feat.char, feat.look);
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
    const per = ((GACHA.rate / GACHA.pool.length) * 100).toFixed(1);
    const ov = overlay(
      `<h2>확률 정보</h2><p>· 코스튬 ${GACHA.pool.map((p) => `「${cosName(p.char, p.look)}」 ${per}%`).join(" · ")}<br>· 꽝 (코인 +${GACHA.lucky}) ${(100 - GACHA.rate * 100).toFixed(1)}%<br>· 코스튬 없이 ${GACHA.pity}회째 뽑으면 아직 없는 코스튬 확정 (천장)<br>· 이미 가진 코스튬은 다시 나오지 않아요 (가진 만큼 남은 코스튬 확률이 그대로)</p><div class="tt-row"><button type="button" class="pri">확인</button></div>`,
      $(".tt-gacha"),
    );
    ov.querySelector<HTMLElement>("button")!.onclick = () => ov.remove();
  };
  type Pull = { kind: "cos"; char: CharId; look: LookId; dup: boolean } | { kind: "lucky" };
  // 이미 가진 코스튬은 안 나옴: 뽑기 풀은 아직 없는 코스튬만
  const unownedPool = () => GACHA.pool.filter((p) => !ME.owned.includes(ownKey(p.char, p.look)));
  function roll(): Pull {
    const pool = unownedPool();
    if (!pool.length) {
      ME.coins += GACHA.lucky;
      return { kind: "lucky" };
    }
    ME.pity++;
    const hit = ME.pity >= GACHA.pity || Math.random() < GACHA.rate;
    if (!hit) {
      ME.coins += GACHA.lucky;
      return { kind: "lucky" };
    }
    ME.pity = 0;
    const p = pick(pool);
    ME.owned.push(ownKey(p.char, p.look));
    return { kind: "cos", char: p.char, look: p.look, dup: false };
  }
  let gBusy = false;
  async function pull(n: 1 | 10) {
    const cost = n === 1 ? GACHA.cost1 : GACHA.cost10;
    if (gBusy) return;
    if (!unownedPool().length) return toast("코스튬을 전부 모았어요! 다음 배너를 기다려 주세요");
    if (ME.coins < cost) return toast("코인이 부족해요 · 게임하고 모아 와요!");
    gBusy = true;
    ME.coins -= cost;
    const res: Pull[] = Array.from({ length: n }, roll);
    save();
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
      const r = await reveal(cos[i].char, cos[i].look, cos[i].dup, last ? 1 : 0);
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
              }</div><b>${cosName(r.char, r.look)}</b><small>${r.dup ? `중복 · +${GACHA.dupRefund.toLocaleString()}` : "NEW!"}</small></div>`
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
      Promise.race([document.fonts?.ready ?? Promise.resolve(), sleep(4000)]).then(step),
    ]);
    if (!alive) return;
    bar.style.width = "100%";
    tx.textContent = "마을 준비 완료 100%";
    await sleep(250);
    goTown();
  })();

  return () => {
    alive = false;
    if (T.raf) cancelAnimationFrame(T.raf);
    for (const t of timers) clearTimeout(t);
    timers.clear();
    if (G?.timer) clearTimeout(G.timer);
    G = null;
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keydown", onFirst);
    previewA?.pause();
    S.stop();
    window.removeEventListener("keyup", onKeyUp);
    root.removeEventListener("pointerdown", onStageDown);
    root.innerHTML = "";
  };
}
