"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { Ctx, Room, State } from "./types";
import { DialLock, Paper } from "./ui";

/*
 * 방탈출 2호 「암실」 — 설계: 프로젝트 claude/2026-11-05-escape-room2-darkroom-design.md
 * 정답: 필름 보관함 0941 (전단 × 출사 기록부) · 약품 갈색=현상 · 투명(식초)=정지 · 초록=정착
 *       노광 8초 · 현상 1분 30초 → 정지 30초 → 정착 5분 · 공구함 0417 (노트 뒷면 × 돌 사진 · 의뢰서 생일)
 * 그림: public/escape/darkroom/ (GPT → 정리 스크립트, -red = 빨간 안전등). 좌표는 원본 1672×941 기준.
 */

const B = "/escape/darkroom/";
const SIZE: [number, number] = [1672, 941];
const red = (s: State) => !s.flags.white;
const v = (s: State) => (red(s) ? "-red" : "");
const pic = (name: string, s: State) => `${B}${name}${v(s)}.webp`;

const JINHO = "진호";
const JTEXT = "진호 (문자)";

type Chem = "brown" | "green" | "clear";
const CHEMS: Chem[] = ["brown", "green", "clear"];
const CHEM_NAME: Record<Chem, string> = { brown: "갈색 병", green: "초록 병", clear: "투명 병" };
const bottleItem = (c: Chem) => `b_${c}`;
/** 트레이 i(1~3)에 부은 약품 */
const tray = (s: State, i: number) => CHEMS.find((x) => s.flags[`t${i}:${x}`]);
const traysOk = (s: State) => tray(s, 1) === "brown" && tray(s, 2) === "clear" && tray(s, 3) === "green";
const traysFull = (s: State) => !!(tray(s, 1) && tray(s, 2) && tray(s, 3));
/** 노광한 인화지의 노광 초 */
const expSec = (s: State) => {
  const k = Object.keys(s.flags).find((f) => f.startsWith("exp:") && s.flags[f]);
  return k ? Number(k.slice(4)) : null;
};

/** 출사 기록부: 필름 번호 · 날짜 · 장소 · 시간대. 전단(10/12 토 · 은행나무길 · 저녁 7시)과 셋 다 맞는 건 0941 하나 */
const LOG: [string, string, string, string][] = [
  ["0929", "10/05 (토)", "은행나무길", "저녁"],
  ["0931", "10/06 (일)", "시장", "오전"],
  ["0934", "10/09 (수)", "공원", "오후"],
  ["0936", "10/12 (토)", "시장", "오전"],
  ["0938", "10/12 (토)", "공원", "오후"],
  ["0941", "10/12 (토)", "은행나무길", "저녁"],
  ["0944", "10/19 (토)", "은행나무길", "오후"],
  ["0946", "10/20 (일)", "공원", "저녁"],
];

/** 빛 바꾸기. 흰빛을 켜는 순간 꺼내 둔 인화지는 망가짐 (서랍 상자 안 인화지는 무사) */
function setLight(c: Ctx, on: boolean) {
  const s = c.s;
  if (on === !!s.flags.white) return;
  const loose = s.inv.includes("paper") || s.inv.includes("exposed") || !!s.flags.paperOn;
  c.set((x) => {
    const flags: Record<string, boolean> = { ...x.flags, white: on, everWhite: x.flags.everWhite || on };
    let inv = x.inv;
    if (on && loose) {
      inv = inv.filter((i) => i !== "paper" && i !== "exposed");
      flags.paperOn = false;
      for (const k of Object.keys(flags)) if (k.startsWith("exp:")) flags[k] = false;
    }
    return { ...x, flags, inv, sel: inv.includes(x.sel ?? "") ? x.sel : null };
  });
  if (on && loose && s.flags.everWhite) c.say("앗— 꺼내 둔 인화지가 빛을 먹었다. 순식간에 까매진다. (서랍 상자에 인화지는 더 있다)");
  else if (!on) c.say("휴대폰 불빛을 껐다. 빨간 안전등만 남았다.");
  else if (s.flags.everWhite) c.say("휴대폰 불빛을 켰다.");
}

/** 빨간빛이면 종이 · 장면도 붉게 */
function Lit({ s, children }: { s: State; children: ReactNode }) {
  return <div style={red(s) ? { filter: "sepia(1) saturate(3.2) hue-rotate(-38deg) brightness(.82)" } : undefined}>{children}</div>;
}

function Pic({ name, s, alt }: { name: string; s: State; alt: string }) {
  return (
    <img src={pic(name, s)} alt={alt} className="mx-auto block h-auto max-h-[360px] w-auto max-w-full rounded-lg border-2 border-[#2b2930] sm:max-w-[560px]" />
  );
}

function Btn({ onClick, children, hot }: { onClick: () => void; children: ReactNode; hot?: boolean }) {
  return (
    <button onClick={onClick} className={`rounded-lg px-3 py-2 text-[14px] ${hot ? "bg-[#c0392b] font-bold text-white" : "bg-[#2b2a30] text-[#eee]"}`}>
      {children}
    </button>
  );
}

/** 문서를 처음 펼쳤을 때 본 걸로 표시 */
function Seen({ c, flag }: { c: Ctx; flag: string }) {
  const done = c.flag(flag);
  useEffect(() => {
    if (!done) c.setFlag(flag);
  }, [done, c, flag]);
  return null;
}

/** 빨간 낙서 (흰빛에서만 보임 — 안전등 아래에선 빨강이 사라짐) */
function Scribble() {
  return (
    <svg viewBox="0 0 400 220" className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="none">
      {Array.from({ length: 34 }, (_, i) => {
        const y = 6 + i * 6.3;
        return (
          <path
            key={i}
            d={`M ${2 + (i % 3) * 3} ${y} C 90 ${y - 12}, 150 ${y + 14}, 220 ${y - 5} S 340 ${y + 10}, ${398 - (i % 4) * 4} ${y - 2}`}
            stroke="#c0392b"
            strokeWidth={i % 2 ? 6.5 : 5}
            fill="none"
          />
        );
      })}
      {Array.from({ length: 9 }, (_, i) => (
        <path key={`x${i}`} d={`M ${i * 48 - 20} 0 L ${i * 48 + 60} 220`} stroke="#b03024" strokeWidth={7} fill="none" />
      ))}
    </svg>
  );
}

/** 확대기: 필름 · 인화지 올리고 노광 시간 맞춰 노광 */
function Enlarger({ c }: { c: Ctx }) {
  const s = c.s;
  const [sec, setSec] = useState(5);
  const film = !!s.flags.filmIn;
  const paper = !!s.flags.paperOn;
  const expose = () => {
    if (!film) return c.say("필름이 없다. 확대기에 필름부터 끼워야 한다.");
    if (!paper) return c.say("확대기 받침에 인화지가 없다. 서랍에서 인화지를 꺼내 올려야 한다.");
    c.set((x) => ({ ...x, flags: { ...x.flags, paperOn: false, [`exp:${sec}`]: true }, inv: [...x.inv.filter((i) => i !== "exposed"), "exposed"] }));
    c.say(`확대기 불이 ${sec}초 동안 켜졌다 꺼졌다. 노광한 인화지를 챙겼다. 겉으로는 아직 아무것도 안 보인다 — 현상해야 떠오른다.`);
  };
  return (
    <div className="space-y-3">
      <Pic name="enlarger" s={s} alt="확대기" />
      <div className="mx-auto grid max-w-[520px] grid-cols-2 gap-2 text-center text-[14px]">
        <p className="rounded-lg bg-[#1d1a1e] py-2">🎞 필름: {film ? "0941 끼움" : "없음"}</p>
        <p className="rounded-lg bg-[#1d1a1e] py-2">📄 인화지: {paper ? "올려 둠" : "없음"}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2 text-[14px]">
        <span>노광 시간</span>
        <button onClick={() => setSec((x) => Math.max(1, x - 1))} className="h-9 w-9 rounded-md bg-[#2b2a30]" aria-label="1초 줄이기">
          −
        </button>
        <span className="w-14 rounded-md bg-[#0f0e12] py-1.5 text-center font-mono text-[18px]">{sec}초</span>
        <button onClick={() => setSec((x) => Math.min(30, x + 1))} className="h-9 w-9 rounded-md bg-[#2b2a30]" aria-label="1초 늘리기">
          +
        </button>
        <Btn hot onClick={expose}>
          💡 노광
        </Btn>
      </div>
      <p className="text-center text-[12px] text-[#8f8676]">필름 · 인화지를 고른 채로 이 확대기를 누르면 올라가요. 노광은 꼭 안전등 아래에서.</p>
    </div>
  );
}

const TIMES = [
  ["30", "30초"],
  ["90", "1분 30초"],
  ["180", "3분"],
  ["300", "5분"],
] as const;

/** 현상: 트레이 1 → 2 → 3, 각각 담글 시간 */
function Develop({ c }: { c: Ctx }) {
  const s = c.s;
  const [t, setT] = useState<string[]>(["", "", ""]);
  const run = () => {
    const sec = expSec(s);
    if (!s.inv.includes("exposed") || sec === null) return c.say("현상할 인화지가 없다. 확대기에서 먼저 노광해야 한다.");
    if (t.some((x) => !x)) return c.say("트레이마다 담글 시간을 정하자.");
    const ruin = (why: string) => {
      c.set((x) => {
        const flags = { ...x.flags };
        for (const k of Object.keys(flags)) if (k.startsWith("exp:")) flags[k] = false;
        return { ...x, flags, inv: x.inv.filter((i) => i !== "exposed"), sel: x.sel === "exposed" ? null : x.sel };
      });
      c.say(why);
    };
    if (!traysFull(s)) return c.say("빈 트레이가 있다. 약품부터 부어야 한다.");
    if (tray(s, 1) !== "brown") return ruin("한참 담가도 아무것도 안 떠오른다. 첫 트레이에 든 게 현상액이 아닌 것 같다.");
    if (sec < 8 || t[0] === "30") return ruin("희미한 회색만 떠오르다 만다. 너무 하얗다. 노광이나 현상이 모자랐나.");
    if (sec > 8 || t[0] !== "90") return ruin("금세 시커멓게 타 버렸다. 노광이나 현상이 너무 길었나.");
    if (tray(s, 2) !== "clear" || tray(s, 3) !== "green" || t[1] !== "30" || t[2] !== "300")
      return ruin("사진이 떠오르나 싶더니 뿌옇게 번져 버렸다. 정지 · 정착 쪽이 틀린 것 같다.");
    c.set((x) => {
      const flags: Record<string, boolean> = { ...x.flags, photoDone: true };
      for (const k of Object.keys(flags)) if (k.startsWith("exp:")) flags[k] = false;
      return { ...x, flags, inv: [...x.inv.filter((i) => i !== "exposed"), "photo"], sel: null };
    });
    c.open("photo");
  };
  return (
    <div className="space-y-3">
      <Pic name="trays" s={s} alt="현상 트레이 세 개" />
      <div className="mx-auto grid max-w-[560px] grid-cols-3 gap-2 text-center text-[13px]">
        {[1, 2, 3].map((i) => {
          const ch = tray(s, i);
          return (
            <div key={i} className="rounded-lg bg-[#1d1a1e] p-2">
              <p className="font-bold">트레이 {i}</p>
              <p className="mt-0.5 text-[#cfc8bb]">{ch ? `${CHEM_NAME[ch]} 약품` : "비어 있음"}</p>
              <select
                value={t[i - 1]}
                onChange={(e) => setT((v) => v.map((x, j) => (j === i - 1 ? e.target.value : x)))}
                className="mt-1.5 w-full rounded-md border border-[#6b4a3a] bg-[#2a2220] px-1 py-1 text-[13px]"
              >
                <option value="">담글 시간</option>
                {TIMES.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Btn hot onClick={run}>
          🧪 노광한 인화지 현상하기
        </Btn>
        {(tray(s, 1) || tray(s, 2) || tray(s, 3)) && (
          <Btn
            onClick={() => {
              c.set((x) => {
                const flags = { ...x.flags };
                for (const k of Object.keys(flags)) if (/^t\d:/.test(k)) flags[k] = false;
                return { ...x, flags };
              });
              c.say("트레이를 비우고 수도꼭지 물로 헹궜다.");
            }}
          >
            🚿 트레이 비우기
          </Btn>
        )}
      </div>
      <p className="text-center text-[12px] text-[#8f8676]">약품병을 고른 채로 벽의 트레이를 누르면 부어요. 왼쪽부터 차례로 담가요.</p>
    </div>
  );
}

/** 문밖 열쇠 소리 뒤 60초 (넘겨도 실패는 없음) */
function KeysClock({ at }: { at: number }) {
  const [now, setNow] = useState(at);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, 60 - Math.floor((now - at) / 1000));
  return <span className="rounded-md bg-[#3a1512] px-2.5 py-1 font-mono text-[#ffb4a6]">🔑 {left > 0 ? `00:${String(left).padStart(2, "0")}` : "문고리가 돈다"}</span>;
}

export const DARKROOM: Room = {
  id: "darkroom",
  title: "암실",
  me: "나",
  card: {
    emoji: "🎞",
    tag: "신작 · 2호",
    blurb: "숨진 사진사의 암실을 정리하러 왔다. 등 뒤에서 문이 잠겼다. 빨간 불 아래에서만 보이는 것들이 있다.",
    time: "20~30분",
    level: 3,
    fear: 2,
    note: "점프 스케어 없음 · 스토리 비중 높음",
  },
  introImg: `${B}intro.webp`,
  assets: [
    ...["N", "E", "S", "W", "bottles", "camera", "photos", "letters", "toolbox", "enlarger", "filmbox", "trays", "lineph", "envelope"].flatMap((n) => [
      `${B}${n}.webp`,
      `${B}${n}-red.webp`,
    ]),
    `${B}photo.webp`,
    `${B}plate.webp`,
    `${B}intro.webp`,
  ],
  variant: v,

  items: {
    phone: {
      name: "휴대폰",
      icon: "📱",
      kind: "tool",
      desc: (s) =>
        s.flags.white
          ? "손전등을 켜 둔 휴대폰. 색이 보인다. 꺼내 둔 인화지는 이 빛을 보면 망가진다."
          : "신호는 안 잡힌다. 손전등은 켤 수 있다 (위의 📱 버튼).",
      badge: (s) => (s.flags.white ? { text: "불빛 ON", on: true } : { text: "불빛 꺼짐", on: false }),
    },
    film: { name: "필름 0941", icon: "🎞", kind: "tool", desc: "이미 현상해 둔 네거티브 필름. 빛을 봐도 괜찮다. 확대기에 끼우면 인화할 수 있다." },
    paper: { name: "인화지", icon: "📄", kind: "tool", desc: "빛을 보면 끝인 종이. 안전등 아래에서만 꺼내 둘 것. 확대기 받침에 올려 쓴다." },
    exposed: {
      name: "노광한 인화지",
      icon: "🟫",
      kind: "tool",
      desc: "확대기 빛을 받은 인화지. 겉으론 하얗다. 현상 트레이에 담가야 그림이 떠오른다.",
    },
    b_brown: { name: "갈색 병", icon: "🟤", kind: "tool", desc: "라벨이 뜯긴 갈색 약품병. 트레이에 부을 수 있다." },
    b_green: { name: "초록 병", icon: "🟢", kind: "tool", desc: "라벨이 뜯긴 초록 약품병. 트레이에 부을 수 있다." },
    b_clear: { name: "투명 병", icon: "⚪", kind: "tool", desc: "라벨이 뜯긴 투명한 약품병. 뚜껑을 열면 시큼한 식초 냄새가 난다." },
    driver: { name: "드라이버", icon: "🪛", kind: "tool", desc: "십자 드라이버. 나사를 풀 수 있다." },
    note1: { name: "쪽지 ①", icon: "📝", kind: "evidence", desc: "필름 보관함 안에 있던 영수의 쪽지.", view: "note1" },
    photo: { name: "현상한 사진", icon: "🖼", kind: "evidence", desc: "필름 0941 에서 뽑은 사진.", view: "photo" },
    receipt: { name: "공업사 영수증", icon: "🧾", kind: "evidence", desc: "공구함 안에 접혀 있던 자동차 공업사 영수증.", view: "receipt" },
    note2: { name: "쪽지 ②", icon: "📝", kind: "evidence", desc: "카메라 필름실에 끼워져 있던 영수의 쪽지.", view: "note2" },
    postcard: { name: "일본 엽서", icon: "💌", kind: "evidence", desc: "건물주가 오사카에서 보낸 엽서.", view: "letters" },
  },

  walls: {
    N: {
      name: "문",
      img: `${B}N.webp`,
      size: SIZE,
      overlay: (s) =>
        red(s) ? (
          <div
            className="pointer-events-none absolute"
            style={{
              left: `${(822 / 1672) * 100}%`,
              top: `${(78 / 941) * 100}%`,
              width: "34%",
              aspectRatio: "1",
              transform: "translate(-50%,-50%)",
              background: "radial-gradient(circle, rgba(255,60,40,.55) 0%, rgba(255,40,30,.18) 28%, rgba(255,0,0,0) 62%)",
            }}
          />
        ) : null,
      spots: [
        {
          id: "door",
          label: "암실 문",
          rect: [655, 165, 360, 710],
          click: (c) => {
            if (c.flag("photoDone")) return c.say("문고리를 잡지 않았다. 저 문 너머에 진호가 있다. 다른 길을 찾아야 한다.");
            c.say("손잡이가 헛돈다. 밖에서 잠겼다. 안쪽 걸쇠는 풀려 있는데도 안 열린다.");
          },
        },
        {
          id: "safelight",
          label: "안전등",
          rect: [780, 8, 85, 135],
          click: (c) =>
            c.say(
              red(c.s)
                ? "빨간 안전등. 인화지는 이 빛에선 괜찮다. 그리고 이 빛 아래에선 빨간 글씨나 빨간 줄이 보이지 않는다."
                : "빨간 안전등. 지금은 휴대폰 불빛이 더 밝다."
            ),
        },
        { id: "curtain", label: "암막 커튼", rect: [130, 95, 420, 785], click: (c) => c.say("문틈으로 빛이 새지 않게 치는 두꺼운 커튼. 뒤엔 벽뿐이다.") },
        {
          id: "calendar",
          label: "달력",
          rect: [1140, 195, 232, 300],
          click: (c) => c.open("calendar"),
        },
      ],
    },
    E: {
      name: "현상대",
      img: `${B}E.webp`,
      size: SIZE,
      spots: [
        ...[1, 2, 3].map((i) => ({
          id: `tray${i}`,
          label: `트레이 ${i}`,
          rect: [[275, 505, 295, 120], [618, 505, 278, 120], [945, 505, 285, 120]][i - 1] as [number, number, number, number],
          click: (c: Ctx) => {
            const sel = c.s.sel;
            const ch = CHEMS.find((x) => sel === bottleItem(x));
            if (ch) {
              if (tray(c.s, i)) return c.say(`트레이 ${i}엔 이미 약품이 들어 있다. 바꾸려면 비워야 한다.`);
              c.setFlag(`t${i}:${ch}`);
              c.take(bottleItem(ch));
              return c.say(`트레이 ${i}에 ${CHEM_NAME[ch]} 약품을 부었다. 병은 선반에 돌려놨다.`);
            }
            c.open("develop");
          },
        })),
        { id: "timer", label: "타이머", rect: [1335, 438, 115, 125], click: (c) => c.open("develop") },
        { id: "tongs", label: "집게", rect: [1248, 522, 108, 96], click: (c) => c.say("대나무 집게. 약품에 손을 넣지 않고 인화지를 옮길 때 쓴다. 현상할 땐 알아서 쓰게 되겠다.") },
        { id: "faucet", label: "수도꼭지", rect: [800, 340, 80, 115], click: (c) => c.say("물은 나온다. 트레이를 비우고 헹굴 수 있겠다. (트레이를 눌러 현상대를 보면 비우기가 있다)") },
        { id: "lineph", label: "말리는 사진들", rect: [470, 95, 745, 215], click: (c) => c.open("lineph") },
      ],
    },
    S: {
      name: "작업대",
      img: `${B}S.webp`,
      size: SIZE,
      spots: [
        { id: "flyer", label: "벽보", rect: [820, 100, 210, 240], click: (c) => c.open("flyer") },
        {
          id: "enlarger",
          label: "확대기",
          rect: [160, 25, 315, 600],
          click: (c) => {
            const sel = c.s.sel;
            if (sel === "film") {
              c.setFlag("filmIn");
              c.take("film");
              return c.say("필름 0941 을 확대기에 끼웠다.");
            }
            if (sel === "paper") {
              if (!red(c.s)) return c.say("이 불빛 아래에서 인화지를 올리면 바로 망가진다. 휴대폰 불빛부터 끄자.");
              c.setFlag("paperOn");
              c.take("paper");
              return c.say("확대기 받침에 인화지를 올렸다.");
            }
            c.open("enlarger");
          },
        },
        { id: "filmbox", label: "필름 보관함", rect: [480, 418, 208, 150], click: (c) => c.open("filmbox") },
        { id: "logbook", label: "출사 기록부", rect: [668, 518, 385, 130], click: (c) => c.open("logbook") },
        { id: "worknote", label: "작업 노트", rect: [1058, 528, 165, 116], click: (c) => c.open("worknote") },
        { id: "client", label: "의뢰서", rect: [1198, 495, 236, 150], click: (c) => c.open("client") },
        { id: "envelope", label: "인화지 봉투", rect: [1392, 532, 172, 110], click: (c) => c.open("envelope") },
        {
          id: "drawer",
          label: "서랍",
          rect: [622, 692, 425, 72],
          click: (c) => {
            if (c.has("paper")) return c.say("인화지는 한 장이면 된다.");
            if (!red(c.s)) return c.say("서랍 안에 인화지 상자가 있다. 이 불빛에 꺼내면 바로 망가진다. 불부터 끄자.");
            c.give("paper");
            c.say("서랍 속 상자에서 인화지를 한 장 꺼냈다. (빛을 보면 끝이다)");
          },
        },
      ],
    },
    W: {
      name: "선반",
      img: `${B}W.webp`,
      size: SIZE,
      spots: [
        { id: "bottles", label: "약품병 셋", rect: [300, 140, 385, 225], click: (c) => c.open("bottles") },
        { id: "camera", label: "오래된 카메라", rect: [740, 225, 210, 135], click: (c) => c.open("camera") },
        { id: "photobox", label: "사진 상자", rect: [285, 418, 328, 172], click: (c) => c.open("photobox") },
        { id: "letters", label: "편지 묶음", rect: [684, 442, 248, 140], click: (c) => c.open("letters") },
        { id: "toolbox", label: "공구함", rect: [414, 628, 396, 210], click: (c) => c.open("toolbox") },
        {
          id: "vent",
          label: "환기창",
          rect: [1210, 28, 270, 240],
          click: (c) => {
            if (c.flag("ventOpen")) return;
            if (c.s.sel !== "driver") return c.say("작은 환기창. 모서리 네 군데가 나사로 박혀 있다. 사람 하나는 빠져나갈 수 있겠다.");
            if (!c.flag("photoDone"))
              return c.say("여기로 나갈 수는 있겠다. 하지만 이대로 나가면 영수 씨가 그 필름에 뭘 남겼는지 영영 모른다. 먼저 확인하자.");
            c.setFlag("ventOpen");
            c.talk([
              { text: "(나사 네 개가 하나씩 풀린다. 환기창 덮개가 떨어지고 차가운 골목 공기가 들어온다.)" },
              { who: "나", text: "사진과 영수증을 품에 넣고, 환기창으로 몸을 밀어 넣었다." },
            ]);
          },
        },
      ],
    },
  },

  combine(a, b, c) {
    const p = new Set([a, b]);
    if (p.has("film") && p.has("paper")) {
      c.say("필름을 인화지에 그냥 대 봐야 소용없다. 확대기에 둘 다 올려야 한다.");
      return true;
    }
    if (p.has("exposed") && [...p].some((x) => x.startsWith("b_"))) {
      c.say("약품은 트레이에 부어 놓고 담가야 한다.");
      return true;
    }
    return false;
  },

  closeups: {
    calendar: {
      title: "달력 (11월)",
      render: (c) => (
        <Lit s={c.s}>
          <Paper>
            <Seen c={c} flag="seenCal" />
            <p className="mb-2 text-center font-bold">11월</p>
            <ul className="space-y-1 text-[14px]">
              <li>11/1 (금) — 필름 주문</li>
              <li>
                <b>11/2 (토) — 저녁 7시 진호 ◯</b>
              </li>
              <li>11/9 (토) — 은행나무길 아이 병문안</li>
            </ul>
            <p className="mt-2 text-right text-[12px] text-[#6a6355]">영수의 글씨. 11월 2일에만 동그라미가 쳐져 있다.</p>
          </Paper>
        </Lit>
      ),
    },
    flyer: {
      title: "벽보",
      render: (c) => (
        <Lit s={c.s}>
          <Paper tone="yellow">
            <Seen c={c} flag="seenFlyer" />
            <p className="mb-2 text-center text-[17px] font-bold">목격자를 찾습니다</p>
            <p>
              <b>10월 12일 (토) 저녁 7시경</b>, <b>은행나무길</b> 횡단보도에서 초등학생이 <b>회색 SUV</b>에 치였습니다.
            </p>
            <p className="mt-1">차는 그대로 달아났습니다. 아이는 아직 깨어나지 못했습니다.</p>
            <p className="mt-1">그 시각 그 길을 지나셨거나, 사진 · 영상이 있는 분은 경찰서 교통조사계로 연락 부탁드립니다.</p>
            <p className="mt-2 text-right text-[12px] text-[#6a6355]">— 아이의 가족 드림</p>
          </Paper>
        </Lit>
      ),
    },
    logbook: {
      title: "출사 기록부",
      render: (c) => (
        <Lit s={c.s}>
          <Paper>
            <Seen c={c} flag="seenLog" />
            <p className="mb-2 text-center font-bold">출사 기록 · 박영수</p>
            <table className="mx-auto text-[13px]">
              <thead>
                <tr className="border-b border-[#b8b0a0] text-[#6a6355]">
                  <th className="px-2 py-1">필름</th>
                  <th className="px-2">날짜</th>
                  <th className="px-2">장소</th>
                  <th className="px-2">시간대</th>
                </tr>
              </thead>
              <tbody>
                {LOG.map(([n, d, p, t]) => (
                  <tr key={n} className="font-mono">
                    <td className="px-2 py-0.5">{n}</td>
                    <td className="px-2">{d}</td>
                    <td className="px-2" style={{ fontFamily: "'Gowun Batang', serif" }}>
                      {p}
                    </td>
                    <td className="px-2" style={{ fontFamily: "'Gowun Batang', serif" }}>
                      {t}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-right text-[12px] text-[#6a6355]">현상한 필름은 번호대로 보관함에.</p>
          </Paper>
        </Lit>
      ),
    },
    filmbox: {
      title: "필름 보관함",
      render: (c) =>
        !c.flag("boxOpen") ? (
          <div className="space-y-3">
            <Pic name="filmbox" s={c.s} alt="필름 보관함" />
            <DialLock
              length={4}
              note={<p className="text-center text-[14px]">작은 철제 보관함. 네 자리 번호 자물쇠. 뚜껑에 영수의 글씨: &quot;그날 것은 따로.&quot;</p>}
              onTry={(code) => {
                if (code !== "0941") return false;
                c.setFlag("boxOpen");
                c.say("철컥. 보관함이 열렸다. 필름 통 하나와 접힌 쪽지가 들어 있다.");
                return true;
              }}
            />
          </div>
        ) : (
          <div className="space-y-3 text-center">
            <p className="text-[15px]">보관함 안: 「0941」이라고 적힌 필름 통 하나, 그리고 접힌 쪽지.</p>
            <div className="flex justify-center gap-2">
              {!c.flag("gotFilm") && (
                <Btn
                  onClick={() => {
                    c.setFlag("gotFilm");
                    c.give("film");
                    c.say("필름 0941 을 챙겼다. 이미 현상된 네거티브다. 불빛에 대 보니 작은 장면들이 거꾸로 찍혀 있다. 크게 뽑아 봐야 알겠다.");
                  }}
                >
                  🎞 필름 0941
                </Btn>
              )}
              {!c.flag("gotNote1") && (
                <Btn
                  onClick={() => {
                    c.setFlag("gotNote1");
                    c.give("note1");
                    c.open("note1");
                  }}
                >
                  📝 쪽지
                </Btn>
              )}
            </div>
            {c.flag("gotFilm") && c.flag("gotNote1") && <p className="text-[13px] text-[#a99f8c]">보관함은 이제 비었다.</p>}
          </div>
        ),
    },
    note1: {
      title: "쪽지 ①",
      render: (c) => (
        <Lit s={c.s}>
          <Paper tone="kraft" tilt={-1}>
            <p>경찰서 앞까지 갔다가 돌아왔다.</p>
            <p className="mt-1">이 필름만은 차마 못 내겠다. 내가 찍은 걸 내가 믿을 수가 없다.</p>
            <p className="mt-1">하루만 더 생각하자.</p>
            <p className="mt-2 text-right text-[12px] text-[#6a6355]">10. 14 영수</p>
          </Paper>
        </Lit>
      ),
    },
    worknote: {
      title: "작업 노트",
      render: (c) => {
        const r = red(c.s);
        const page = (front: boolean) => (
          <div className="relative mx-auto max-w-[460px] overflow-hidden rounded-[3px]">
            <Paper>
              <p className="mb-1 text-[12px] text-[#6a6355]">{front ? "앞장" : "뒷장"}</p>
              {front ? (
                <>
                  <p>현상 1분 30초 → 정지 30초 → 정착 5분.</p>
                  <p className="mt-1">노광은 8초.</p>
                  <p className="mt-1">약품 라벨은 다 떼어 놨다. 현상액은 갈색 병, 정착액은 초록 병, 정지액은 식초 냄새 나는 것.</p>
                </>
              ) : (
                <>
                  <p>공구함 번호는 그 애가 처음 우리 사진관 의자에 앉은 날.</p>
                  <p className="mt-1">그 사진은 늘 맨 앞에 뒀지.</p>
                </>
              )}
            </Paper>
            {!r && <Scribble />}
          </div>
        );
        return (
          <Lit s={c.s}>
            {r && <Seen c={c} flag="readNote" />}
            <div className="space-y-3">
              {page(true)}
              {page(false)}
              <p className="text-center text-[13px] text-[#8f8676]">
                {r ? "빨간 안전등 아래에선 빨간 낙서가 사라져 글씨만 보인다." : "빨간 색연필 낙서가 빽빽하게 덮여 있어 밑의 글씨를 읽을 수가 없다."}
              </p>
            </div>
          </Lit>
        );
      },
    },
    client: {
      title: "유품 정리 의뢰서",
      render: (c) => (
        <Lit s={c.s}>
          <Paper>
            <Seen c={c} flag="seenClient" />
            <p className="mb-2 text-center font-bold">유품 정리 의뢰서</p>
            <table className="text-[14px]">
              <tbody>
                {[
                  ["고인", "박영수 (78) · 영수사진관 운영"],
                  ["의뢰인", "박진호 (고인의 아들)"],
                  ["의뢰인 생년월일", "1980. 04. 17"],
                  ["작업 장소", "영수사진관 1층 가게 · 뒤쪽 암실"],
                  ["작업일", "11월 5일"],
                  ["주차", "의뢰인 차량 38모 2417 (가게 앞)"],
                  ["요청 사항", "암실 물건은 버리기 전에 전부 저에게 먼저 보여 주세요. 특히 필름."],
                ].map(([k, val]) => (
                  <tr key={k}>
                    <td className="py-0.5 pr-3 align-top whitespace-nowrap text-[#6a6355]">{k}</td>
                    <td>{val}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Paper>
        </Lit>
      ),
    },
    envelope: {
      title: "인화지 봉투",
      render: (c) => (
        <div className="space-y-3 text-center">
          <Pic name="envelope" s={c.s} alt="인화지 봉투" />
          <p className="text-[15px]">
            {c.flag("stripRuined")
              ? "반쯤 빠져나와 있던 시험용 인화지 띠가 새까맣다. 휴대폰 불빛을 켠 순간 빛을 먹었다."
              : "반쯤 빠져나온 시험용 인화지 띠. 하얗다. 빛을 보면 까맣게 변하는 종이다."}
          </p>
        </div>
      ),
    },
    enlarger: { title: "확대기", render: (c) => <Enlarger c={c} /> },
    develop: { title: "현상대", render: (c) => <Develop c={c} /> },
    lineph: {
      title: "말리는 사진들",
      render: (c) => (
        <div className="space-y-3">
          <Pic name="lineph" s={c.s} alt="빨랫줄에 걸린 사진 세 장" />
          <Lit s={c.s}>
            <div className="grid gap-2 sm:grid-cols-3">
              {[
                ["가로수길", "0929 · 10/5 · 은행나무길"],
                ["공원 벤치", "0938 · 10/12 · 공원"],
                ["시장 골목", "0936 · 10/12 · 시장"],
              ].map(([a, b]) => (
                <Paper key={a}>
                  <p className="text-[12px] text-[#6a6355]">{a} 사진 뒷면</p>
                  <p className="font-mono text-[14px]">{b}</p>
                </Paper>
              ))}
            </div>
          </Lit>
          <p className="text-center text-[13px] text-[#8f8676]">사진 뒷면마다 필름 번호가 적혀 있다. 출사 기록부의 번호와 같은 방식이다.</p>
        </div>
      ),
    },
    bottles: {
      title: "약품병 셋",
      render: (c) => {
        const r = red(c.s);
        return (
          <div className="space-y-3">
            <Pic name="bottles" s={c.s} alt="라벨이 뜯긴 약품병 세 개" />
            <p className="text-center text-[14px]">
              {r
                ? "라벨이 다 뜯겨 있다. 이 빨간빛 아래에선 셋 다 거무스름하게만 보인다. 하나는 조금 더 밝다."
                : "라벨은 뜯겨 있지만 이제 색이 보인다: 갈색 · 초록 · 투명."}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {CHEMS.map((ch, i) => (
                <Btn
                  key={ch}
                  onClick={() => {
                    if (r) return c.say("어느 게 어느 색인지 모르겠다. 빛을 바꿔 봐야겠다.");
                    if (CHEMS.some((x) => c.has(bottleItem(x)))) return c.say("병은 하나씩 들고 가자.");
                    c.give(bottleItem(ch));
                    c.set((x) => ({ ...x, sel: bottleItem(ch) }));
                    c.say(`${CHEM_NAME[ch]}을 들었다. 현상대 트레이를 누르면 붓는다.${ch === "clear" ? " 뚜껑을 여니 시큼한 식초 냄새가 확 올라온다." : ""}`);
                  }}
                >
                  {r ? `${i + 1}번 병` : CHEM_NAME[ch]} 들기
                </Btn>
              ))}
              {r && (
                <Btn
                  onClick={() => {
                    c.say("세 병 뚜껑을 하나씩 열어 봤다. 맨 오른쪽 병에서 시큼한 식초 냄새가 난다.");
                    c.setFlag("smelled");
                  }}
                >
                  👃 냄새 맡기
                </Btn>
              )}
            </div>
          </div>
        );
      },
    },
    camera: {
      title: "오래된 카메라",
      render: (c) => (
        <div className="space-y-3 text-center">
          <Pic name="camera" s={c.s} alt="오래된 필름 카메라" />
          <p className="text-[15px]">영수가 오래 쓴 필름 카메라. 뒷뚜껑을 열어 보니 필름은 없고, 필름실에 쪽지가 끼워져 있다.</p>
          {!c.flag("gotNote2") ? (
            <Btn
              onClick={() => {
                c.setFlag("gotNote2");
                c.give("note2");
                c.open("note2");
              }}
            >
              📝 쪽지 꺼내기
            </Btn>
          ) : (
            <p className="text-[13px] text-[#a99f8c]">쪽지는 챙겼다.</p>
          )}
        </div>
      ),
    },
    note2: {
      title: "쪽지 ②",
      render: (c) => (
        <Lit s={c.s}>
          <Paper tone="kraft" tilt={1}>
            <p>오늘 진호를 불렀다. 저녁 7시.</p>
            <p className="mt-1">사진을 보여 주고, 자수하라고 할 거다. 그 애가 안 하겠다면 내가 하겠다.</p>
            <p className="mt-1">은행나무길 그 아이 부모 얼굴을 더는 못 보겠다.</p>
            <p className="mt-2 text-right text-[12px] text-[#6a6355]">11. 2 영수</p>
          </Paper>
        </Lit>
      ),
    },
    photobox: {
      title: "사진 상자",
      render: (c) => (
        <div className="space-y-3">
          <Seen c={c} flag="seenPhotos" />
          <p className="text-center text-[14px]">낡은 상자 안에 흑백 가족사진이 차곡차곡. 앞에서부터 꺼내 나란히 놓고 한 장씩 뒷면을 본다.</p>
          <Pic name="photos" s={c.s} alt="흑백 가족사진 네 장" />
          <Lit s={c.s}>
            <div className="mx-auto grid max-w-[560px] grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["① 맨 앞", "진호 돌 · 처음 사진관 의자에 앉은 날", "1981. 4. 17"],
                ["②", "진호 백일", "1980. 7. 26"],
                ["③", "진호 입학식", "1987. 3. 2"],
                ["④", "진호 첫 출근", "2006. 1. 2"],
              ].map(([n, a, d]) => (
                <div key={n} className="rounded-[3px] bg-[#efe9dc] px-2.5 py-2 text-[13px] leading-snug text-[#2a2620]" style={{ fontFamily: "'Gowun Batang', serif" }}>
                  <p className="text-[11px] text-[#6a6355]">{n} 뒷면</p>
                  <p>{a}</p>
                  <p className="font-mono">{d}</p>
                </div>
              ))}
            </div>
          </Lit>
        </div>
      ),
    },
    letters: {
      title: "편지 묶음",
      render: (c) => (
        <div className="space-y-3">
          <Seen c={c} flag="seenLetters" />
          <Pic name="letters" s={c.s} alt="끈으로 묶은 편지 묶음" />
          <Lit s={c.s}>
            <Paper tone="white">
              <p className="mb-1 text-center font-bold">퇴거 요청서</p>
              <p className="text-[14px]">영수사진관 박영수 님. 건물 재건축으로 12월 말까지 점포를 비워 주시기 바랍니다. 지난번처럼 언성을 높이시면 법대로 하겠습니다.</p>
              <p className="mt-1 text-right text-[12px] text-[#6a6355]">10월 2일 · 건물주 최만석</p>
            </Paper>
            <div className="mt-2">
              <Paper tone="kraft" tilt={-1}>
                <p className="text-[12px] text-[#6a6355]">엽서 · 일본 오사카 소인 10. 15</p>
                <p className="mt-1 text-[14px]">영수 형님, 지난번엔 제가 말이 심했습니다. 오사카 딸네 와 있습니다. 10월 10일에 나와서 20일에 들어갑니다. 돌아가면 소주 한잔 하시지요. — 만석</p>
              </Paper>
            </div>
          </Lit>
          {!c.flag("gotPostcard") ? (
            <div className="text-center">
              <Btn
                onClick={() => {
                  c.setFlag("gotPostcard");
                  c.give("postcard");
                  c.say("엽서를 챙겼다. 10월 10일부터 20일까지 일본에 있었다면… 10월 12일 저녁엔.");
                }}
              >
                💌 엽서 챙기기
              </Btn>
            </div>
          ) : null}
        </div>
      ),
    },
    toolbox: {
      title: "공구함",
      render: (c) =>
        !c.flag("toolOpen") ? (
          <div className="space-y-3">
            <Pic name="toolbox" s={c.s} alt="번호 자물쇠가 달린 공구함" />
            <DialLock
              length={4}
              note={<p className="text-center text-[14px]">녹슨 공구함. 네 자리 번호 자물쇠.</p>}
              onTry={(code) => {
                if (code !== "0417") return false;
                c.setFlag("toolOpen");
                c.say("철컥. 공구함이 열렸다. 드라이버 몇 자루, 그리고 맨 밑에 접힌 영수증.");
                return true;
              }}
            />
          </div>
        ) : (
          <div className="space-y-3 text-center">
            <p className="text-[15px]">공구함 안: 십자 드라이버, 그리고 공구 밑에 깔아 둔 접힌 영수증.</p>
            <div className="flex justify-center gap-2">
              {!c.flag("gotDriver") && (
                <Btn
                  onClick={() => {
                    c.setFlag("gotDriver");
                    c.give("driver");
                    c.say("십자 드라이버를 챙겼다.");
                  }}
                >
                  🪛 드라이버
                </Btn>
              )}
              {!c.flag("gotReceipt") && (
                <Btn
                  onClick={() => {
                    c.setFlag("gotReceipt");
                    c.give("receipt");
                    c.open("receipt");
                  }}
                >
                  🧾 영수증
                </Btn>
              )}
            </div>
          </div>
        ),
    },
    receipt: {
      title: "공업사 영수증",
      render: (c) => (
        <Lit s={c.s}>
          <Paper>
            <p className="mb-1 text-center font-bold">○○자동차공업사 · 수리 명세</p>
            <table className="text-[14px]">
              <tbody>
                {[
                  ["입고일", "10월 13일 (일) 오전"],
                  ["차량번호", "38모 2417 (회색 SUV)"],
                  ["작업", "앞범퍼 교체 · 우측 헤드램프 교체 · 도색"],
                  ["결제", "현금"],
                ].map(([k, val]) => (
                  <tr key={k}>
                    <td className="py-0.5 pr-3 whitespace-nowrap text-[#6a6355]">{k}</td>
                    <td>{val}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[13px]">뒷면, 영수의 글씨: &quot;공업사 사장이 사진관 단골이라 사본을 받아 왔다.&quot;</p>
          </Paper>
        </Lit>
      ),
    },
    photo: {
      title: "현상한 사진",
      render: () => (
        <div className="space-y-3">
          <img src={`${B}photo.webp`} alt="현상한 흑백 사진" className="mx-auto block w-full max-w-[600px] rounded-sm border-8 border-[#efe9dc]" />
          <p className="text-center text-[14px]">은행나무길 횡단보도. 떨어진 책가방과 운동화 한 짝. 달아나는 회색 SUV.</p>
          <p className="text-center text-[13px] text-[#8f8676]">작업대 확대경으로 번호판 쪽을 크게 봤다.</p>
          <img src={`${B}plate.webp`} alt="번호판 확대: 38모 2417" className="mx-auto block w-full max-w-[420px] rounded-full border-4 border-[#2b2930]" />
        </div>
      ),
    },
  },

  hud: (c) => (
    <>
      <button
        onClick={() => setLight(c, !c.s.flags.white)}
        className={`rounded-md px-2.5 py-1 font-bold ${c.s.flags.white ? "bg-[#f1ede2] text-[#1d1a12]" : "bg-[#5a1712] text-[#ffd0c4]"}`}
      >
        {c.s.flags.white ? "📱 휴대폰 불빛 ON · 끄기" : "🔴 안전등 · 📱 불빛 켜기"}
      </button>
      {c.s.marks?.keys && !c.s.flags.ventOpen ? <KeysClock at={c.s.marks.keys} /> : null}
    </>
  ),

  start: [
    { who: JINHO, text: "어, 문이 닫혔네요. 그 문이 오래돼서 닫히면 걸려요. 방 불 차단기도 또 내려갔고… 금방 올릴게요." },
    { who: JINHO, text: "안전등은 따로라 켜져 있을 거예요. 천천히 하세요." },
    { who: "나", text: "빨간 안전등만 켜져 있다. 휴대폰은 신호가 안 잡히지만 불빛은 켤 수 있다." },
    { who: JINHO, text: "…아버지 돌아가신 날, 저는 지방 출장 중이었어요. 그게 제일 마음에 걸려요." },
    { who: JINHO, text: "필요한 거 있으면 문 두드리세요. 앞에 있을게요." },
  ],

  events: [
    {
      id: "white",
      when: (s) => !!s.flags.everWhite,
      lines: [
        { who: "나", text: "휴대폰 불은 켜지네. 색이 보인다." },
        { text: "(작업대 쪽에서 반쯤 꺼내져 있던 시험용 인화지 띠가 순식간에 까맣게 변했다.)" },
        { who: "나", text: "아. 인화지는 빛을 보면 끝이지. 꺼내 둔 인화지가 있을 땐 불을 켜면 안 되겠다." },
      ],
      run: (c) => c.setFlag("stripRuined"),
    },
    {
      id: "flyer",
      when: (s) => !!s.flags.seenFlyer,
      lines: [
        { who: JINHO, text: "벽보 보셨어요? 아버지가 그 사고에 엄청 매달리셨어요. 매일 그 길에 나가 서 계셨죠." },
        { who: JINHO, text: "건물주가 아버지랑 퇴거 문제로 많이 싸웠는데… 그 사람 차도 회색이에요. 혹시 그런 게 나오면 알려 주세요." },
      ],
      run: (c) => c.setFlag("landlordHint"),
    },
    {
      id: "box",
      when: (s) => !!s.flags.boxOpen,
      lines: [
        { who: JINHO, text: "방금 철컥 소리 났죠? 뭐 찾으셨어요?" },
        { who: "나", text: "…그냥 상자예요. 정리 중이에요." },
      ],
    },
    {
      id: "text",
      when: (s) => traysFull(s),
      lines: [
        { text: "(휴대폰이 짧게 울렸다. 신호가 한 칸 잡혔다가 사라진다.)" },
        { who: JTEXT, text: "아버지 필름 같은 거 나오면 따로 챙겨 주세요. 다른 사람한테 보이지 말고요. 제가 정리할게요." },
      ],
      run: (c) => c.setFlag("gotText"),
    },
    {
      id: "reveal",
      when: (s) => !!s.flags.photoDone,
      lines: [
        { who: "나", text: "번호판… 38모 2417." },
        { who: "나", text: "어디서 봤다. 작업대 위 의뢰서. 의뢰인 차량 38모 2417." },
        { text: "(문밖에서 발소리가 멈춘다.)" },
        { who: JINHO, text: "…다 끝났어요? 이제 열어 드릴게요." },
        { text: "(문고리가 덜컥덜컥 흔들린다. 하지만 문은 열리지 않는다.)" },
        { who: JINHO, text: "그 필름, 저 주세요." },
      ],
      run: (c) => c.setFlag("asked"),
    },
    {
      id: "keys",
      when: (s) => !!s.flags.toolOpen && !!s.flags.photoDone,
      lines: [
        { text: "(문밖에서 열쇠 꾸러미 소리가 난다.)" },
        { who: JINHO, text: "아버지 열쇠가 어딨더라… 이거였나. 이거였나." },
      ],
      run: (c) => c.set((x) => ({ ...x, marks: { ...x.marks, keys: Date.now() } })),
    },
  ],

  notebook: {
    questions: [
      { id: "q1", q: "은행나무길에서 아이를 치고 달아난 사람은?" },
      { id: "q2", q: "영수는 어떻게 죽었나?" },
      { id: "q3", q: "문 밖의 사람은 무엇을 찾고 있나?" },
    ],
    facts: [
      { id: "f1", q: "q1", text: "10/12(토) 저녁 7시경 · 은행나무길 · 회색 SUV (벽보)", got: (s) => !!s.flags.seenFlyer },
      { id: "f2", q: "q1", text: "영수는 그날 저녁 은행나무길에서 필름 0941 을 찍었다", got: (s) => !!s.flags.boxOpen },
      { id: "f3", q: "q1", text: "영수는 그 필름을 경찰에 못 냈다 — \"내가 찍은 걸 믿을 수가 없다\" (쪽지 ①)", got: (s) => !!s.flags.gotNote1 },
      { id: "f4", q: "q1", text: "진호: 건물주 차도 회색이고, 아버지와 퇴거 문제로 싸웠다", got: (s) => !!s.flags.landlordHint },
      { id: "f5", q: "q1", text: "건물주는 10/10~10/20 일본에 있었다 (엽서)", got: (s) => !!s.flags.gotPostcard },
      { id: "f6", q: "q1", text: "사진 속 달아나는 차 번호판: 38모 2417", got: (s) => !!s.flags.photoDone },
      { id: "f7", q: "q1", text: "38모 2417 은 의뢰인 진호의 차 (의뢰서)", got: (s) => !!s.flags.photoDone },
      { id: "f8", q: "q1", text: "사고 다음 날 38모 2417 앞범퍼 · 헤드램프 교체 (영수증)", got: (s) => !!s.flags.gotReceipt },
      { id: "f9", q: "q2", text: "진호: \"아버지 돌아가신 날 저는 지방 출장 중이었어요\"", got: () => true },
      { id: "f10", q: "q2", text: "11/2(토) 저녁 7시, 영수는 진호를 불렀다 (달력)", got: (s) => !!s.flags.seenCal },
      { id: "f11", q: "q2", text: "영수는 그날 진호에게 자수하라고 할 생각이었다 (쪽지 ②)", got: (s) => !!s.flags.gotNote2 },
      { id: "f12", q: "q3", text: "진호: \"필름 나오면 따로, 남한테 보이지 말고\" (문자)", got: (s) => !!s.flags.gotText },
      { id: "f13", q: "q3", text: "사진이 나오자 진호: \"그 필름, 저 주세요\"", got: (s) => !!s.flags.asked },
    ],
  },

  hints: [
    {
      id: "light",
      title: "빛",
      done: (s) => !!s.flags.everWhite,
      lines: ["휴대폰 손전등을 켤 수 있어요. 위 줄의 📱 버튼.", "흰빛에선 색이 보이고, 빨간 안전등 아래에선 빨간 글씨 · 빨간 낙서가 안 보여요.", "📱 버튼을 눌러 보세요. 꺼내 둔 인화지가 있을 땐 조심."],
    },
    {
      id: "box",
      title: "필름 보관함",
      done: (s) => !!s.flags.boxOpen,
      lines: [
        "작업대 위 벽보와 출사 기록부를 같이 보세요.",
        "벽보의 날짜 · 장소 · 시간대, 셋 다 맞는 줄은 하나뿐이에요.",
        "10/12 (토) · 은행나무길 · 저녁 → 0941.",
      ],
    },
    {
      id: "chem",
      title: "약품",
      done: (s) => traysOk(s),
      lines: [
        "작업 노트의 빨간 낙서 밑에 글이 있어요. 빛을 바꿔 보세요.",
        "노트는 안전등 아래에서, 병 색은 휴대폰 불빛 아래에서. 투명한 병은 냄새로.",
        "트레이 1 = 갈색 병(현상), 트레이 2 = 투명 병(정지 · 식초), 트레이 3 = 초록 병(정착). 병을 고른 채로 트레이를 누르기.",
      ],
    },
    {
      id: "dev",
      title: "현상",
      ready: (s) => !!s.flags.boxOpen,
      done: (s) => !!s.flags.photoDone,
      lines: [
        "필름은 확대기에, 인화지는 서랍에. 둘 다 확대기에 올리고 노광한 다음 현상대로.",
        "인화지를 꺼낸 뒤엔 휴대폰 불빛을 끄세요. 시간은 전부 작업 노트 앞장에 있어요.",
        "노광 8초 → 트레이 1 · 1분 30초 → 트레이 2 · 30초 → 트레이 3 · 5분.",
      ],
    },
    {
      id: "tool",
      title: "공구함",
      ready: (s) => !!s.flags.photoDone,
      done: (s) => !!s.flags.toolOpen,
      lines: [
        "작업 노트 뒷장을 읽어 보세요 (안전등 아래에서).",
        "\"처음 사진관 의자에 앉은 날\"이 뒷면에 적힌 사진이 있어요. 선반의 사진 상자.",
        "돌 사진 1981. 4. 17 → 0417. 의뢰서의 진호 생년월일(4월 17일)로도 확인돼요.",
      ],
    },
    {
      id: "vent",
      title: "나가는 길",
      ready: (s) => !!s.flags.toolOpen,
      done: (s) => !!s.flags.ventOpen,
      lines: ["문 말고 다른 출구가 있어요.", "선반 벽 위쪽 환기창은 나사 네 개로 박혀 있어요.", "드라이버를 고른 채로 환기창을 누르세요."],
    },
    {
      id: "r1",
      title: "보고서 1 · 뺑소니",
      report: true,
      done: (s) => !!s.locks?.includes("r1"),
      lines: ["노트의 Q1 아래 사실들을 보세요.", "사진 속 번호판이 누구 차였나요?", "박진호 · 현상한 사진 (영수증도 돼요)."],
    },
    {
      id: "r2",
      title: "보고서 2 · 영수의 죽음",
      report: true,
      done: (s) => !!s.locks?.includes("r2"),
      lines: ["11월 2일 저녁 7시에 영수가 만나기로 한 사람은?", "쪽지 ②: 그날 영수가 그 사람에게 하려던 말.", "진호 · 자수를 두고 다툼 · 쪽지 ② (달력도 돼요)."],
    },
    {
      id: "r3",
      title: "보고서 3 · 문 밖의 사람",
      report: true,
      done: (s) => !!s.locks?.includes("r3"),
      lines: ["진호가 문자로 따로 챙겨 달라고 한 것은?", "시작할 때 진호가 한 말 중, 달력과 맞지 않는 것.", "필름 0941 · 11월 2일에 출장 중이었다."],
    },
    {
      id: "rb",
      title: "덤 · 건물주",
      report: true,
      done: (s) => !!s.locks?.includes("rb"),
      lines: ["편지 묶음을 다시 보세요.", "엽서의 날짜.", "10월 10일~20일 일본 → 엽서."],
    },
  ],

  intro: (
    <>
      <p>
        11월 5일 오후. 나는 유품정리사다. 사흘 전 2층 살림집 계단에서 떨어져 숨진 「영수사진관」 주인 <b>박영수(78)</b>의 가게를, 아들{" "}
        <b>박진호(45)</b>의 의뢰로 정리하러 왔다. 경찰은 실족사로 종결했다.
      </p>
      <p className="mt-2">진호는 지쳐 보였지만 친절했다. &quot;암실이 제일 손이 많이 갈 거예요. 아버지가 평생 거기 계셨거든요.&quot;</p>
      <p className="mt-2">
        암실에 들어서자 등 뒤에서 문이 닫혔다. <b>철컥.</b> 흰 불이 꺼지고, 빨간 안전등만 남았다.
      </p>
      <p className="mt-2 text-[#e07a6a]">이 암실에서 나가고, 영수가 이 방에 숨겨 둔 것이 무엇인지 밝혀내자.</p>
    </>
  ),

  report2: {
    intro: "환기창 밖 골목. 경찰에 넘길 보고서를 쓴다. 노트의 질문 셋에 답하자.",
    evidence: [
      { id: "flyer", label: "벽보 (목격자를 찾습니다)", seen: (s) => !!s.flags.seenFlyer },
      { id: "log", label: "출사 기록부", seen: (s) => !!s.flags.seenLog },
      { id: "note1", label: "쪽지 ① (경찰서 앞까지 갔다가)", seen: (s) => !!s.flags.gotNote1 },
      { id: "photo", label: "현상한 사진 (번호판)", seen: (s) => !!s.flags.photoDone },
      { id: "client", label: "유품 정리 의뢰서", seen: (s) => !!s.flags.seenClient || !!s.flags.photoDone },
      { id: "receipt", label: "공업사 영수증", seen: (s) => !!s.flags.gotReceipt },
      { id: "cal", label: "달력 (11/2 저녁 7시 진호)", seen: (s) => !!s.flags.seenCal },
      { id: "note2", label: "쪽지 ② (자수하라고 할 거다)", seen: (s) => !!s.flags.gotNote2 },
      { id: "evict", label: "퇴거 요청서", seen: (s) => !!s.flags.seenLetters },
      { id: "postcard", label: "일본 엽서", seen: (s) => !!s.flags.gotPostcard },
      { id: "text", label: "진호의 문자", seen: (s) => !!s.flags.gotText },
    ],
    sections: [
      {
        id: "r1",
        title: "뺑소니",
        parts: [
          "",
          {
            id: "r1who",
            options: [
              { id: "jinho", label: "박진호" },
              { id: "landlord", label: "건물주 최만석" },
              { id: "youngsu", label: "박영수" },
            ],
            answer: ["jinho"],
          },
          "의 차가 10월 12일 은행나무길에서 아이를 치고 달아났다. 증거:",
          { id: "r1ev", pick: "evidence", answer: ["photo", "receipt"] },
        ],
      },
      {
        id: "r2",
        title: "영수의 죽음",
        parts: [
          "영수는 11월 2일 저녁,",
          {
            id: "r2who",
            options: [
              { id: "jinho", label: "진호" },
              { id: "landlord", label: "건물주" },
              { id: "alone", label: "아무도 없이 혼자" },
            ],
            answer: ["jinho"],
          },
          "와(과)",
          {
            id: "r2why",
            options: [
              { id: "surrender", label: "자수 문제로 다투다" },
              { id: "evict", label: "퇴거 문제로 다투다" },
              { id: "slip", label: "아무 일 없이 발을 헛디뎌" },
            ],
            answer: ["surrender"],
          },
          "계단에서 떨어졌다. 증거:",
          { id: "r2ev", pick: "evidence", answer: ["note2", "cal"] },
        ],
      },
      {
        id: "r3",
        title: "문 밖의 사람",
        parts: [
          "진호가 찾던 것은",
          {
            id: "r3what",
            options: [
              { id: "film", label: "필름 0941" },
              { id: "will", label: "아버지의 유언장" },
              { id: "keys", label: "사진관 열쇠" },
            ],
            answer: ["film"],
          },
          "이다. 그가 한 거짓말:",
          {
            id: "r3lie",
            options: [
              { id: "trip", label: "\"11월 2일엔 지방 출장 중이었다\"" },
              { id: "fight", label: "\"건물주가 아버지와 싸웠다\"" },
              { id: "accident", label: "\"아버지가 그 사고에 매달렸다\"" },
            ],
            answer: ["trip"],
          },
        ],
      },
      {
        id: "rb",
        title: "건물주는? (덤)",
        bonus: true,
        parts: ["건물주의 차도 회색이지만, 그는 운전자가 아니다. 증거:", { id: "rbev", pick: "evidence", answer: ["postcard"] }],
      },
    ],
    payoffs: [
      { clue: "아버지 돌아가신 날, 저는 지방 출장 중이었어요.", meaning: "달력: 11월 2일 저녁 7시, 영수는 진호를 불렀다. 그날 진호는 그 계단에 있었다." },
      { clue: "그 사람 차도 회색이에요.", meaning: "건물주는 그때 일본에 있었다. 의심을 돌리려던 말이었다." },
      { clue: "요청 사항: 특히 필름.", meaning: "진호가 맡긴 건 유품 정리가 아니라 필름 찾기였다." },
      { clue: "필름 나오면 따로, 남한테 보이지 말고요.", meaning: "필름을 손에 넣어 없애려 했다." },
      { clue: "이 필름만은 차마 못 내겠다.", meaning: "번호판의 주인이 아들이었기 때문이다." },
      { clue: "그 문이 오래돼서 닫히면 걸려요.", meaning: "문은 밖에서 잠겼다. 필름을 들고 나가지 못하게." },
    ],
  },

  endings: {
    truth: (
      <>
        <p>골목 끝 지구대에 사진과 영수증, 쪽지 두 장을 내밀었다. 그날 밤 진호는 사진관 앞에서 체포됐다.</p>
        <p className="mt-2">
          10월 12일 저녁, 은행나무길에서 아이를 친 건 진호의 차였다. 그 장면을 찍은 아버지는 2주 넘게 필름을 내지 못했다. 11월 2일, 아버지는 아들을
          불러 자수하라고 했고, 계단에서 다툼이 났다.
        </p>
        <p className="mt-2">진호는 아버지의 유품을 정리해 달라고 했다. 그가 지우고 싶었던 건 유품이 아니었다.</p>
        <p className="mt-2">은행나무길의 아이는 지난주에 처음 눈을 떴다고 한다.</p>
        <p className="mt-3 font-bold text-[#e07a6a]">정리를 맡긴 사람이 지우고 싶었던 건, 유품이 아니라 증거였다.</p>
      </>
    ),
    normal: (
      <>
        <p>환기창으로 빠져나오는 데는 성공했다. 하지만 보고서는 끝내 빈칸을 남겼다.</p>
        <p className="mt-2">며칠 뒤 사진관 앞을 지나는데, 자물쇠가 새것으로 바뀌어 있었다. &quot;아버지 유품은 제가 정리할게요.&quot; 진호의 문자였다.</p>
      </>
    ),
  },
  escaped: (s) => !!s.flags.ventOpen,
};
