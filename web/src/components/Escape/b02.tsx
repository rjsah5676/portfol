"use client";

import { paintEast, paintIntro, paintNorth, paintSouth, paintWest } from "./b02Art";
import type { Ctx, Room, State } from "./types";
import { DialLock, Keypad, Paper } from "./ui";

/*
 * 방탈출 1호 「반지하 B02호」 — 설계: 프로젝트 claude/2026-11-05-escape-room1-design.md
 * 정답: 서랍 5915 (알바 시간에 열린 4줄의 날짜 끝자리) · 보일러실 0825 (첫 몰래 출입)
 */

const uvOn = (s: State) => s.sel === "uv" && !!s.flags.uvOn;

/** 도어락 출입 기록 (서하가 9/6 에 뽑은 것). ★ = 서하 알바 시간(화목토 18~23시)에 열린 줄 */
const LOG: [string, string, string][] = [
  ["08/21", "금", "23:40"],
  ["08/22", "토", "23:20"],
  ["08/24", "월", "14:05"],
  ["08/25", "화", "19:12"], // ★ 처음
  ["08/26", "수", "22:10"],
  ["08/27", "목", "23:15"],
  ["08/28", "금", "17:30"],
  ["08/29", "토", "21:40"], // ★
  ["08/31", "월", "12:00"],
  ["09/01", "화", "20:05"], // ★
  ["09/02", "수", "18:30"],
  ["09/03", "목", "17:50"],
  ["09/05", "토", "19:30"], // ★
  ["09/06", "일", "15:00"],
];

const DIARY: [string, string][] = [
  ["d1", "8/26. 또 그 냄새가 난다. 내가 안 쓰는 섬유유연제 냄새. 의자가 책상에서 한 뼘 나와 있었다. 내가 예민한 걸까."],
  ["d2", "9/2. 도어락 기록을 뽑아 봤다. 내가 알바 간 시간에 문이 열렸다. 비밀번호를 바꿨는데 또 열렸다. 관리자 비밀번호를 아는 사람이다."],
  [
    "d3",
    "9/6. 오늘 계단에서 그 사람이 웃으면서 말했다. \"누나, 화목토는 늦게 들어오시죠?\" 내 알바 요일을 안다. 증거는 이 방에 다 남겨 둔다. 보일러실 비밀번호는 그 사람이 처음 이 방에 들어온 날로 바꿔 놨다. 나는 당분간 지수네 있을 거다.",
  ],
];

const say = (c: Ctx, m: string) => c.say(m);

export const B02: Room = {
  id: "b02",
  title: "반지하 B02호",
  items: {
    coin: { name: "동전", icon: "🪙", desc: "500원짜리. 납작하고 단단하다." },
    battery: { name: "건전지", icon: "🔋", desc: "AA 건전지 두 개. 리모컨에서 뺐다." },
    uv: {
      name: "UV 손전등",
      icon: "🔦",
      desc: (s) =>
        s.flags.uvOn
          ? "보랏빛이 나오는 손전등. 고른 채로 여기저기 보면 숨은 글씨나 자국이 드러난다."
          : "보랏빛이 나오는 손전등. 지금은 꺼져 있다 — 건전지 칸이 비어 있다.",
      badge: (s) => (s.flags.uvOn ? { text: "ON", on: true } : { text: "꺼짐", on: false }),
    },
    lace: { name: "빨간 신발끈 조각", icon: "🧵", desc: "침대 밑에서 나온 빨간 신발끈 끄트머리. 흙이 묻어 있다." },
    ice: { name: "얼음 덩어리", icon: "🧊", desc: "얼음 안에 접힌 종이가 갇혀 있다." },
    d1: { name: "일기 조각 ①", icon: "📄", desc: "찢긴 일기장 윗부분.", view: "diary" },
    d2: { name: "일기 조각 ②", icon: "📄", desc: "찢긴 일기장 가운데.", view: "diary" },
    d3: { name: "일기 조각 ③", icon: "📄", desc: "찢긴 일기장 아랫부분. 조금 젖어 있다.", view: "diary" },
  },

  walls: {
    N: {
      name: "현관",
      paint: (g) => paintNorth(g),
      spots: [
        { id: "door", label: "현관문", rect: [128, 38, 46, 98], click: (c) => say(c, "손잡이가 돌아가지 않는다. 누가 밖에서 잠갔다. 두드려도 대답이 없다.") },
        {
          id: "doorlock",
          label: "도어락",
          rect: [174, 70, 16, 20],
          click: (c) => say(c, "안쪽 열림 버튼을 눌러도 덜컥거리기만 한다. 밖에서 걸쇠를 따로 건 것 같다."),
        },
        {
          id: "shoes",
          label: "신발장",
          rect: [36, 92, 64, 44],
          click: (c) => {
            c.setFlag("seenShoes");
            c.open("shoes");
          },
        },
        { id: "keydish", label: "열쇠 접시", rect: [76, 84, 18, 8], click: (c) => say(c, "열쇠 접시가 비어 있다. 서하는 열쇠를 챙겨 나갔다.") },
        { id: "umbrella", label: "우산꽂이", rect: [212, 94, 22, 42], click: (c) => say(c, "우산 두 개. 별다른 건 없다.") },
        { id: "window", label: "창문", rect: [240, 16, 56, 26], click: (c) => say(c, "길바닥 높이의 반지하 창. 사람들 발만 지나간다. 쇠창살이 단단하다.") },
      ],
    },
    E: {
      name: "부엌",
      paint: paintEast,
      spots: [
        { id: "fridgeDoor", label: "냉장고 문에 붙은 종이", rect: [36, 72, 38, 40], click: (c) => c.open("fridge") },
        {
          id: "freezer",
          label: "냉동실",
          rect: [30, 30, 52, 40],
          click: (c) => c.open("freezer"),
        },
        { id: "fridgeIn", label: "냉장실", rect: [30, 112, 52, 24], click: (c) => say(c, "우유 하나, 반찬통 둘. 우유 유통기한이 9월 8일이다.") },
        {
          id: "piggy",
          label: "돼지 저금통",
          rect: [246, 82, 24, 16],
          click: (c) => {
            if (c.flag("coin")) return say(c, "더 흔들어도 아무것도 안 나온다.");
            c.setFlag("coin");
            c.give("coin");
            say(c, "흔들었더니 구멍으로 500원짜리 동전 하나가 굴러 나왔다.");
          },
        },
        { id: "cupboard", label: "찬장", rect: [140, 26, 130, 34], click: (c) => say(c, "라면, 햇반, 커피믹스. 혼자 사는 대학생 찬장이다.") },
        { id: "sink", label: "개수대", rect: [146, 82, 52, 16], click: (c) => say(c, "컵 하나가 엎어져 말라 있다. 며칠은 된 것 같다.") },
      ],
    },
    S: {
      name: "책상 · 침대",
      paint: paintSouth,
      spots: [
        {
          id: "schedule",
          label: "알바 시간표",
          rect: [28, 40, 34, 36],
          click: (c) => {
            c.setFlag("seenSchedule");
            c.open("schedule");
          },
        },
        { id: "calendar", label: "달력", rect: [70, 36, 26, 32], click: (c) => c.open("calendar") },
        {
          id: "photo",
          label: "찢긴 사진",
          rect: [100, 44, 20, 22],
          click: (c) => {
            c.setFlag("seenPhoto");
            c.open("photo");
          },
        },
        { id: "drawer", label: "책상 서랍", rect: [68, 100, 48, 22], click: (c) => c.open("drawer") },
        { id: "laptop", label: "노트북", rect: [32, 86, 30, 10], click: (c) => say(c, "배터리가 다 됐는지 켜지지 않는다.") },
        {
          id: "outlet",
          label: "콘센트",
          rect: [18, 116, 12, 12],
          click: (c) => {
            c.setFlag("seenOutlet");
            say(c, "충전기가 늘 꽂혀 있던 자국. 폰 충전기가 없다. 챙겨 나간 걸까?");
          },
        },
        {
          id: "underbed",
          label: "침대 밑",
          rect: [160, 124, 140, 14],
          click: (c) => {
            if (c.s.sel === "uv" && !c.flag("uvOn")) return say(c, "손전등을 비춰 보려 했지만 꺼져 있다. 건전지가 없다.");
            if (!uvOn(c.s)) return say(c, "너무 어두워서 안이 안 보인다. 불빛이 있으면 좋겠다.");
            c.open("underbed");
          },
        },
        { id: "bed", label: "침대", rect: [160, 88, 140, 36], click: (c) => say(c, "이불이 반듯하게 개어져 있다. 급하게 끌려 나간 방 같지는 않다.") },
      ],
    },
    W: {
      name: "욕실 · 보일러실",
      paint: paintWest,
      spots: [
        { id: "bath", label: "욕실", rect: [18, 38, 64, 98], click: (c) => c.open("bath") },
        { id: "tv", label: "TV", rect: [118, 66, 74, 38], click: (c) => say(c, "꺼진 TV. 전원을 눌러도 반응이 없다. 리모컨도 안 먹는 걸까.") },
        {
          id: "remote",
          label: "리모컨",
          rect: [174, 102, 18, 8],
          click: (c) => {
            if (c.flag("battery")) return say(c, "건전지를 뺀 빈 리모컨.");
            if (c.s.sel !== "coin") return say(c, "뒤판이 꽉 끼어 있다. 납작한 걸로 비틀면 열릴 것 같다.");
            c.setFlag("battery");
            c.give("battery");
            say(c, "동전으로 뒤판을 비틀어 열었다. 건전지 두 개를 챙겼다.");
          },
        },
        {
          id: "letter",
          label: "군사우편 봉투",
          rect: [122, 101, 22, 10],
          click: (c) => {
            c.setFlag("seenLetter");
            c.open("letter");
          },
        },
        { id: "boilerDoor", label: "보일러실 문", rect: [226, 38, 58, 98], click: (c) => c.open("boiler") },
        { id: "keypad", label: "보일러실 키패드", rect: [288, 74, 16, 24], click: (c) => c.open("boiler") },
      ],
    },
  },

  combine(a, b, c) {
    const pair = new Set([a, b]);
    if (pair.has("uv") && pair.has("battery")) {
      c.take("battery");
      c.setFlag("uvOn");
      c.say("손전등에 건전지를 넣었다. 딸깍 — 보랏빛이 켜진다. (손전등을 고른 채로 여기저기 비춰 보자)");
      return true;
    }
    if (pair.has("ice") && pair.has("uv")) {
      c.say("UV 빛으로는 얼음이 녹지 않는다.");
      return true;
    }
    if ([...pair].every((x) => x.startsWith("d"))) {
      c.open("diary");
      return true;
    }
    return false;
  },

  closeups: {
    fridge: {
      title: "냉장고 문",
      render: (c) => (
        <div className="space-y-4">
          <Paper>
            <p className="mb-2 text-center text-[13px] font-bold tracking-wider">디지털 도어락 출입 기록 · B02호</p>
            <p className="mb-2 text-center text-[11px] text-[#6a6355]">출력 09/06 · 비밀번호로 열림만 표시</p>
            <table className="mx-auto font-mono text-[13px]">
              <tbody>
                {LOG.map(([d, w, t]) => (
                  <tr key={d + t}>
                    <td className="pr-3">{d}</td>
                    <td className="pr-3">({w})</td>
                    <td className="pr-3">{t}</td>
                    <td>비밀번호 열림</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {c.flag("seenLog") ? null : <SeenOnce c={c} flag="seenLog" />}
          </Paper>
          <Paper tone="yellow" tilt={-1}>
            <p className="mb-1 text-center font-bold">【 공 지 】</p>
            <p>
              집주인 할머니께서 <b>8월 19일부터 입원</b> 치료 중이십니다. 당분간 건물 관리는 아드님 <b>민규 씨</b>가 맡습니다.
            </p>
            <p className="mt-1">각 호실 여분 열쇠와 도어락 관리자 비밀번호도 민규 씨가 보관하오니, 문의는 민규 씨에게 해 주세요.</p>
            <p className="mt-2 text-right text-[12px]">8월 20일 · 관리인 드림</p>
            {c.flag("seenNotice") ? null : <SeenOnce c={c} flag="seenNotice" />}
          </Paper>
        </div>
      ),
    },
    freezer: {
      title: "냉동실",
      render: (c) =>
        c.flag("ice") ? (
          <p className="text-center text-[15px]">성에뿐이다. 얼음 덩어리는 챙겼다.</p>
        ) : (
          <div className="text-center">
            <p className="text-[56px]">🧊</p>
            <p className="text-[15px]">냉동실 안쪽, 얼음 덩어리 안에 접힌 종이가 갇혀 있다. 왜 이런 데다…</p>
            <button
              onClick={() => {
                c.setFlag("ice");
                c.give("ice");
                c.say("얼음 덩어리를 챙겼다. 녹일 방법이 필요하다.");
                c.open(null);
              }}
              className="mt-3 rounded-lg bg-[#e9c46a] px-4 py-2 font-bold text-[#1d1a12]"
            >
              꺼내기
            </button>
          </div>
        ),
    },
    schedule: {
      title: "알바 시간표",
      render: () => (
        <Paper>
          <p className="mb-2 text-center font-bold">편의점 근무표 (한서하)</p>
          <table className="mx-auto text-center text-[13px]">
            <tbody>
              <tr className="font-bold">
                {["월", "화", "수", "목", "금", "토", "일"].map((d) => (
                  <td key={d} className="w-10 border border-[#b8b0a0] py-1">
                    {d}
                  </td>
                ))}
              </tr>
              <tr>
                {["", "18:00\n~23:00", "", "18:00\n~23:00", "", "18:00\n~23:00", ""].map((t, i) => (
                  <td key={i} className={`h-14 border border-[#b8b0a0] text-[11px] whitespace-pre ${t ? "bg-[#f6c88a]" : ""}`}>
                    {t}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-center text-[12px] text-[#6a6355]">지각 3번이면 주말 근무 빠짐!! 🔥</p>
        </Paper>
      ),
    },
    calendar: {
      title: "달력",
      render: () => (
        <Paper>
          <p className="mb-2 text-center font-bold">8월 · 9월 메모</p>
          <ul className="space-y-1 text-[14px]">
            <li>8/19 — 주인 할머니 입원 😢 빨리 나으세요</li>
            <li>8/20 — 관리 이제 민규 씨가 한대</li>
            <li>9/7 — 지수네 ✈</li>
            <li>9/12 — 지수 생일 🎂</li>
          </ul>
        </Paper>
      ),
    },
    photo: {
      title: "찢긴 사진",
      render: () => (
        <div className="space-y-3">
          <Paper tone="kraft">
            <p>바닷가에서 찍은 사진. 서하와 남자 한 명. 남자 쪽은 반쯤 찢겨 나갔다.</p>
          </Paper>
          <Paper tilt={1}>
            <p className="text-[13px] text-[#6a6355]">사진 뒷면, 서하 글씨:</p>
            <p className="mt-1 text-[16px]">&quot;다시 만나자고? 웃기지 마. — 도윤에게&quot;</p>
          </Paper>
        </div>
      ),
    },
    letter: {
      title: "군사우편",
      render: () => (
        <Paper tone="kraft">
          <p className="text-[12px] text-[#6a6355]">군사우편 · 소인 08/30 · 보내는 사람: 상병 김도윤 (○○사단)</p>
          <p className="mt-2">
            서하야. 사진 돌려 달라고 한 거 미안하다. 그때는 내가 좀 이상했어. 8월은 하계 전술훈련이라 <b>한 번도 못 나갔고</b>, 휴가는
            10월에나 나와. 그때 얼굴 보고 정식으로 사과할게. 답장 안 해도 돼.
          </p>
        </Paper>
      ),
    },
    shoes: {
      title: "신발장",
      render: () => (
        <Paper>
          <p>서하의 신발 몇 켤레. 맨 윗칸, 늘 신던 흰 운동화 자리가 비어 있다. 실내 슬리퍼는 가지런하다.</p>
        </Paper>
      ),
    },
    drawer: {
      title: "책상 서랍",
      render: (c) =>
        !c.flag("drawerOpen") ? (
          <DialLock
            length={4}
            note={
              <Paper tone="yellow" tilt={-2}>
                <p className="text-[15px]">자물쇠에 붙은 서하의 메모:</p>
                <p className="mt-1 text-[17px] font-bold">&quot;내가 없을 때 열린 날. 순서대로, 날짜 끝자리.&quot;</p>
              </Paper>
            }
            onTry={(code) => {
              if (code !== "5915") return false;
              c.setFlag("drawerOpen");
              c.say("철컥. 서랍이 열렸다.");
              return true;
            }}
          />
        ) : (
          <div className="space-y-3 text-center">
            <p className="text-[15px]">서랍 안: 볼펜 몇 자루, 학생증 사본, 그리고…</p>
            <div className="flex justify-center gap-2">
              {!c.flag("gotUv") && (
                <button
                  onClick={() => {
                    c.setFlag("gotUv");
                    c.give("uv");
                    c.say("UV 손전등을 챙겼다. 스위치를 눌러 봐도 켜지지 않는다 — 건전지가 없다.");
                  }}
                  className="rounded-lg bg-[#2b2a30] px-3 py-2 text-[15px] text-[#eee]"
                >
                  🔦 손전등
                </button>
              )}
              {!c.flag("gotD1") && (
                <button
                  onClick={() => {
                    c.setFlag("gotD1");
                    c.give("d1");
                    c.say("찢긴 일기 조각을 챙겼다.");
                  }}
                  className="rounded-lg bg-[#2b2a30] px-3 py-2 text-[15px] text-[#eee]"
                >
                  📄 일기 조각
                </button>
              )}
            </div>
            {c.flag("gotUv") && c.flag("gotD1") && <p className="text-[13px] text-[#a99f8c]">더는 쓸 만한 게 없다.</p>}
          </div>
        ),
    },
    underbed: {
      title: "침대 밑",
      render: (c) => (
        <div className="space-y-3 text-center">
          <p className="text-[15px]">
            보랏빛에 먼지가 드러난다. 그 사이로 <b>진흙 묻은 운동화 자국</b> — 발끝이 방 안쪽을 향해 있다. 누가 여기 엎드려 있었다.
          </p>
          <div className="flex justify-center gap-2">
            {!c.flag("lace") && (
              <button
                onClick={() => {
                  c.setFlag("lace");
                  c.give("lace");
                  c.say("침대 다리에 걸린 빨간 신발끈 조각을 챙겼다.");
                }}
                className="rounded-lg bg-[#2b2a30] px-3 py-2 text-[15px] text-[#eee]"
              >
                🧵 빨간 끈 조각
              </button>
            )}
            {!c.flag("gotD2") && (
              <button
                onClick={() => {
                  c.setFlag("gotD2");
                  c.give("d2");
                  c.say("침대 판 밑에 테이프로 붙여 둔 일기 조각을 떼어 냈다.");
                }}
                className="rounded-lg bg-[#2b2a30] px-3 py-2 text-[15px] text-[#eee]"
              >
                📄 테이프로 붙은 종이
              </button>
            )}
          </div>
        </div>
      ),
    },
    bath: {
      title: "욕실",
      render: (c) => {
        const uv = uvOn(c.s);
        return (
          <div className="space-y-3">
            <div className="relative mx-auto h-[150px] max-w-[320px] rounded-lg border-4 border-[#9aa3ad] bg-gradient-to-br from-[#b9c8d2] to-[#8d9ca8]">
              {uv ? (
                <p
                  className="absolute inset-0 grid place-items-center px-4 text-center text-[17px] font-bold"
                  style={{ color: "#e8d9ff", textShadow: "0 0 8px #b78bff, 0 0 16px #b78bff", fontFamily: "'Gowun Batang', serif" }}
                  ref={(el) => {
                    if (el && !c.flag("seenMirror")) queueMicrotask(() => c.setFlag("seenMirror"));
                  }}
                >
                  경찰에 갈 거야.
                  <br />
                  근데 그 사람이 먼저 신고하면…?
                </p>
              ) : (
                <p className="absolute inset-0 grid place-items-center text-[13px] text-[#4a5560]">뿌연 거울</p>
              )}
            </div>
            <p className="text-center text-[14px]">세면대 위 칫솔꽂이에 칫솔이 없다. 선반 위엔 드라이어.</p>
            <div className="text-center">
              <button
                onClick={() => {
                  if (c.flag("gotD3")) return c.say("드라이어. 이제 쓸 일은 없다.");
                  if (c.s.sel !== "ice") return c.say("평범한 드라이어. 뭘 말리거나 녹일 때 쓸 만하다.");
                  c.take("ice");
                  c.setFlag("gotD3");
                  c.give("d3");
                  c.say("드라이어 바람에 얼음이 녹고, 젖은 종이가 나왔다. 일기 조각이다.");
                }}
                className="rounded-lg bg-[#2b2a30] px-4 py-2 text-[15px] text-[#eee]"
              >
                💨 드라이어
              </button>
            </div>
            {!uv && <p className="text-center text-[12px] text-[#8f8676]">거울에 뭔가 문질러 쓴 자국이 희미하게 보인다.</p>}
          </div>
        );
      },
    },
    boiler: {
      title: "보일러실 문",
      render: (c) =>
        c.flag("boilerOpen") ? (
          <p className="text-center text-[15px]">문이 열려 있다. 보일러 옆 좁은 통로 끝에 뒷마당으로 나가는 계단이 보인다.</p>
        ) : (
          <div className="space-y-3">
            <p className="text-center text-[14px]">철문 옆 숫자 키패드. 4자리.</p>
            <Keypad
              length={4}
              worn={uvOn(c.s) ? ["0", "2", "5", "8"] : undefined}
              onTry={(code) => {
                if (code !== "0825") return false;
                c.setFlag("boilerOpen");
                c.say("삐리릭 — 보일러실 문이 열렸다!");
                return true;
              }}
            />
            {uvOn(c.s) && <p className="text-center text-[12px] text-[#cdb4ff]">보랏빛에 손때 묻은 숫자 네 개가 떠오른다.</p>}
          </div>
        ),
    },
    diary: {
      title: "일기 조각",
      render: (c) => {
        const got = DIARY.filter(([id]) => c.has(id));
        return (
          <Paper tone="white">
            {DIARY.map(([id, text]) =>
              got.some(([g]) => g === id) ? (
                <p key={id} className="border-b border-dashed border-[#b8b0a0] py-2 last:border-0">
                  {text}
                </p>
              ) : (
                <p key={id} className="py-2 text-center text-[#a39b8a]">
                  ( 찢겨 나간 부분 )
                </p>
              )
            )}
            {got.length === 3 && <p className="mt-2 text-center text-[12px] text-[#6a6355]">세 조각이 딱 맞는다.</p>}
          </Paper>
        );
      },
    },
  },

  hints: [
    {
      id: "drawer",
      title: "책상 서랍",
      done: (s) => !!s.flags.drawerOpen,
      lines: [
        "냉장고 문에 붙은 종이와 벽에 붙은 종이를 나란히 놓고 보세요.",
        "서하가 집에 없던 시간은 언제였을까요? 알바 시간표를 보세요.",
        "화 · 목 · 토 18:00~23:00 안에 열린 기록은 딱 4줄. 그 날짜 끝자리를 순서대로.",
      ],
    },
    {
      id: "uv",
      title: "손전등",
      ready: (s) => !!s.flags.drawerOpen,
      done: (s) => !!s.flags.uvOn,
      lines: [
        "서랍에서 나온 손전등은 건전지가 없어요.",
        "건전지가 들어 있을 만한 물건이 방에 있어요. TV 쪽을 보세요.",
        "리모컨 뒤판은 동전으로 열려요. 동전은 부엌 저금통에. 건전지와 손전등을 겹치세요.",
      ],
    },
    {
      id: "diary",
      title: "일기 조각",
      ready: (s) => !!s.flags.drawerOpen,
      done: (s) => !!(s.flags.gotD1 && s.flags.gotD2 && s.flags.gotD3),
      lines: [
        "일기 조각은 세 개예요. 하나는 서랍에서 나왔죠.",
        "어두운 곳과 차가운 곳. 손전등을 고른 채로 침대 밑을 보세요.",
        "냉동실 얼음 덩어리는 욕실 드라이어로 녹여요 (얼음을 고르고 드라이어를 누르기).",
      ],
    },
    {
      id: "boiler",
      title: "보일러실",
      ready: (s) => !!(s.flags.gotD1 && s.flags.gotD2 && s.flags.gotD3),
      done: (s) => !!s.flags.boilerOpen,
      lines: [
        "일기 마지막 조각을 다시 읽어 보세요.",
        "\"그 사람이 처음 이 방에 들어온 날\" = 서하가 없을 때 처음 열린 기록.",
        "8월 25일 → 0825. UV 손전등을 고른 채로 키패드를 보면 확인할 수 있어요.",
      ],
    },
  ],

  intro: (
    <>
      <p>
        9월 10일 오후. 신입 형사인 나는 실종 신고된 대학생 <b>한서하(24)</b>의 반지하 방을 수색하러 왔다.
      </p>
      <p className="mt-2">
        문을 열어 준 건 집주인 할머니의 아들 <b>민규</b>. &quot;서하 누나가 사흘째 안 들어와서 제가 신고했어요. 저는 밖에 있을게요.&quot;
      </p>
      <p className="mt-2">
        수색을 시작하고 몇 분 뒤 — <b>철컥.</b> 현관이 밖에서 잠겼다. 폰은 신호가 잡히지 않는다.
      </p>
      <p className="mt-2 text-[#e9c46a]">이 방에서 나가고, 서하에게 무슨 일이 있었는지 밝혀내자.</p>
    </>
  ),
  introPaint: paintIntro,

  report: {
    culprits: [
      { id: "mingyu", label: "집주인 아들 민규" },
      { id: "granny", label: "집주인 할머니" },
      { id: "doyun", label: "전 남자친구 도윤" },
      { id: "seoha", label: "서하 본인 (자작극)" },
    ],
    statuses: [
      { id: "kidnapped", label: "누군가에게 납치됐다" },
      { id: "hiding", label: "스스로 몸을 숨겼다" },
      { id: "dead", label: "이미 숨졌다" },
    ],
    answer: { culprit: "mingyu", status: "hiding" },
    evidence: [
      { id: "log", label: "도어락 출입 기록 (알바 시간에 열림)", seen: (s) => !!s.flags.seenLog, good: true },
      { id: "notice", label: "건물 공지문 (열쇠 · 관리자 비번은 민규)", seen: (s) => !!s.flags.seenNotice, good: true },
      { id: "lace", label: "침대 밑 빨간 신발끈 조각", seen: (s) => !!s.flags.lace, good: true },
      { id: "diary", label: "서하의 일기 (\"누나\", 알바 요일)", seen: (s) => !!s.flags.gotD3, good: true },
      { id: "mirror", label: "거울의 숨은 글씨 (먼저 신고하면?)", seen: (s) => !!s.flags.seenMirror, good: true },
      { id: "photo", label: "찢긴 사진 (도윤에게)", seen: (s) => !!s.flags.seenPhoto, good: false },
      { id: "letter", label: "군사우편 (도윤은 부대에)", seen: (s) => !!s.flags.seenLetter, good: false },
      { id: "shoes", label: "신발장 빈자리 · 없는 충전기", seen: (s) => !!(s.flags.seenShoes || s.flags.seenOutlet), good: false },
    ],
  },
  endings: {
    truth: (
      <>
        <p>보고서를 들고 지구대에 전화했다. 지수네 집에서 서하가 전화를 받았다. &quot;형사님… 그 사람 맞아요.&quot;</p>
        <p className="mt-2">
          민규는 건물 앞에서 체포됐다. 할머니가 입원한 뒤 관리자 비밀번호로 서하가 알바 간 사이 방에 드나들었고, 서하가 사라지자 직접 실종 신고를
          냈다. 경찰이 서하를 찾아 주면, 자기도 서하가 어디 있는지 알게 되니까.
        </p>
        <p className="mt-3 font-bold text-[#e9c46a]">서하를 찾아 달라고 한 사람이, 서하가 숨은 이유였다.</p>
      </>
    ),
    normal: (
      <>
        <p>보일러실 뒤 계단으로 빠져나오는 데는 성공했다. 하지만 보고서는 진실에서 빗나갔다.</p>
        <p className="mt-2">그 사이 건물 앞에 서 있던 민규는 어디론가 사라졌다…</p>
      </>
    ),
  },
  escaped: (s) => !!s.flags.boilerOpen,
};

/** 문서를 처음 펼쳤을 때 본 걸로 표시 (보고서 근거 목록용) */
function SeenOnce({ c, flag }: { c: Ctx; flag: string }) {
  return (
    <span
      ref={(el) => {
        if (el) queueMicrotask(() => c.setFlag(flag));
      }}
    />
  );
}
