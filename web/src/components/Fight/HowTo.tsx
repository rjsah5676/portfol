/**
 * 판 아래 조작·기술 설명 (선택 화면·경기 중 공용) — 키는 칸으로, 기술은 이름 + 한 줄 설명으로 나눠서 읽기 쉽게.
 * 경기 중엔 지금 싸우는 두 캐릭터의 기술도 보여 줌.
 */
import { CHARS } from "@/lib/fight/chars";
import { KeyCap, keyText } from "./KeyCap";

const KR = "font-['Nanum_Gothic',sans-serif]";

function Kbd({ children }: { children: string }) {
  return <KeyCap k={children} style={{ fontSize: "10.5px" }} />;
}

type Row = [string, React.ReactNode, React.ReactNode?];
const k = (...ks: string[]) => (
  <span className="inline-flex flex-nowrap items-center gap-0.5 whitespace-nowrap">
    {ks.map((x, i) => (x === "/" || x === "+" ? <span key={i} className="px-0.5 text-white/30">{x}</span> : <Kbd key={i}>{x}</Kbd>))}
  </span>
);

/** 콤보·기술: 묶음별 [이름, 설명] */
const TECH: { title: string; color: string; items: [string, string][] }[] = [
  {
    title: "공격 잇기",
    color: "#FDE047",
    items: [
      ["연속기", "약 J 는 4단, 발차기 K 는 2단까지. 마지막 동작은 세지만 막히면 반격당해요"],
      ["캔슬", "맞히는 중에 L · I 를 누르면 바로 이어 나가요"],
      ["점프 우선", "J · K 공격 중에도 점프가 바로 나가요 (L · I 는 끝나자마자)"],
      ["카운터", "상대가 기술을 내는 중·대시 중에 맞히면 1.25배, 경직도 길어요"],
    ],
  },
  {
    title: "잡기 · 가드",
    color: "#7DD3FC",
    items: [
      ["잡기", "J + K 동시 — 가드를 뚫고 위로 띄워요. 잡힌 직후 J + K 로 풀면 피해 없음 (막는 경직 중인 상대는 안 잡혀요)"],
  ["돌진 잡기", "대시 중·대시 직후 J + K (조금 어긋나게 눌러도 됨) — 게이지 25를 쓰고 미끄러지듯 길게 파고들어 잡아요. 막고 기다리는 상대를 깨는 수단, 헛치면 빈틈이 커요"],
      ["가드 반격", "막는 중·막은 직후 K — 게이지 25 쓰고 상대를 띄워요"],
      ["가드 깎임", "막아도 조금 깎여요 — 기본기는 피해의 15%, L · I 는 기술마다"],
      ["저스트 가드", "맞기 직전에 ↓ 를 새로 눌러 가드 — 경직 절반, 깎임 없음, 게이지 + (누르고만 있던 가드는 보통 가드)"],
      ["다운 공격", "누운 상대도 맞아요 (못 막음, 피해 절반). J + K 로 잡으면 다시 띄움 — 콤보마다 한 번"],
    ],
  },
  {
    title: "공중 콤보",
    color: "#FF8A3D",
    items: [
      ["띄우고 점프", "잡기·가드 반격 등으로 띄운 뒤 바로 점프 → 공중 J · K (맞히면 나도 같이 천천히 내려옴)"],
      ["공중 횟수", "점프마다 J 4번 + K 2번 (2단 점프하면 다시). 섞어 맞히면 더 아프고, 같은 것만 반복하면 덜 아파요"],
      ["내려찍기", "마무리로 공중에서 ↓ + K — 바닥에 꽂아 튕긴 뒤 다운 (피해 1.4배, 점프마다 1번 · K 횟수와 따로)"],
    ],
  },
];

/** 묶음 제목: 왼쪽 색 막대 + 글자 */
function Sec({ title, color, children }: { title: string; color: string; children?: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex items-center gap-1.5">
      <span className="h-3 w-[3px] rounded-full" style={{ background: color }} />
      <span className="text-[11px] font-extrabold tracking-wide text-white/80">{title}</span>
      {children}
    </div>
  );
}

const CARD = "rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-2";

/** 상태 이상: [이름, 누가, 색, 설명] */
const STATUS: [string, string, string, string][] = [
  ["화상", "이그나", "#FF8A3D", "화염구·업화주에 맞으면 한동안 체력이 조금씩 닳아요 (화상으로는 안 쓰러짐)"],
  ["감전", "제나", "#FDE047", "뇌창·천뢰강림에 맞으면 잠깐 몸이 굳고, 한동안 느려지며 제나에게 더 아프게 맞아요"],
  ["방울", "릴리", "#7DD3FC", "비눗방울에 맞으면 갇혀서 둥실 떠요 — 버튼 연타로 빨리 탈출, 맞으면 터지며 +20 피해"],
  ["일시정지", "건모", "#3B9CFF", "Ctrl+A 선택 박스에 맞으면 ⏸ 잠깐 멈춰요 — 그 사이 건모의 약·잡기가 확정으로 들어와요"],
  ["혼란", "건모", "#A5B4FC", "공중 Alt+Tab에 맞으면 자리가 바뀌고 💫 둥실 멈췄다가 바닥에 넘어져요 (아래가 낭떠러지면 안 넘어짐)"],
];

export default function HowTo({ mode, chars }: { mode: "ai" | "2p" | "online" | "practice"; chars?: [number, number] }) {
  const two = mode === "2p";
  const rows: Row[] = two
    ? [
        ["이동", k("A", "D"), k("←", "→")],
        ["대시", k("A", "A", "/", "D", "D"), k("←", "←", "/", "→", "→")],
        ["점프 (2단)", k("W", "/", "Space"), k("↑", "/", "Enter")],
        ["가드", k("S"), k("↓")],
        ["약", k("J"), k(",")],
        ["발차기", k("K"), k(".")],
        ["아이덴티티", k("L"), k(";")],
        ["필살기 (MAX)", k("I"), k("'")],
        ["잡기", k("J", "+", "K"), k(",", "+", ".")],
        ["돌진 잡기 (대시 중·직후)", k("J", "+", "K"), k(",", "+", ".")],
      ]
    : [
        ["이동", k("A", "D"), k("←", "→")],
        ["대시", k("A", "A", "/", "D", "D"), k("←", "←", "/", "→", "→")],
        ["점프 (2단)", k("W", "/", "Space"), k("↑")],
        ["가드", k("S"), k("↓")],
        ["약", k("J"), k("Z")],
        ["발차기", k("K"), k("X")],
        ["아이덴티티", k("L"), k("C")],
        ["필살기 (MAX)", k("I"), k("V")],
        ["잡기", k("J", "+", "K"), k("Z", "+", "X")],
        ["돌진 잡기 (대시 중·직후)", k("J", "+", "K"), k("Z", "+", "X")],
      ];
  return (
    <div className={`mt-3 flex flex-col gap-3 rounded-lg bg-black/20 px-3 py-3 ${KR} text-[11.5px] leading-relaxed text-white/60`}>
      <div className="grid gap-3 md:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
        {/* 조작 */}
        <section className={CARD}>
          <Sec title="조작" color="#A78BFA" />
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-2 gap-y-1">
            <span />
            <span className="min-w-20 text-center text-[10px] text-white/35">{two ? "1P" : "기본"}</span>
            <span className="min-w-16 text-center text-[10px] text-white/35">{two ? "2P" : "또는"}</span>
            {rows.map(([label, a, b]) => (
              <div key={label} className="contents">
                <span className="break-keep text-white/70">{label}</span>
                <span className="flex min-w-20 justify-center">{a}</span>
                <span className="flex min-w-16 justify-center">{b}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 border-t border-white/10 pt-1.5 text-[10.5px] text-white/35">
            {mode === "online" ? "온라인은 멈추지 않아요 · Esc 메뉴" : "Esc·P 일시정지"} · 게임패드·휴대폰 화면 버튼도 돼요
          </div>
        </section>
        {/* 캐릭터 */}
        {chars ? (
          <section className="min-w-0">
            <Sec title="캐릭터 기술" color="#F472B6" />
            <div className="grid gap-2 sm:grid-cols-2">
              {chars.map((ci, i) => {
                const c = CHARS[ci];
                return (
                  <div key={i} className={`${CARD} flex flex-col gap-1`}>
                    <div className="flex items-center gap-1.5">
                      <span className="rounded px-1 font-mono text-[10px] font-bold text-white" style={{ background: i === 0 ? "#3B82F6" : "#F43F5E" }}>
                        {i === 0 ? "1P" : "2P"}
                      </span>
                      <b className="text-[12px]" style={{ color: c.color }}>
                        {c.name}
                      </b>
                    </div>
                    <p className="break-keep">
                      <KeyCap k="L" /> <b className="text-[#FDE047]/85">{c.idName}</b> {keyText(c.idDesc)}
                    </p>
                    <p className="break-keep">
                      <b className="text-[#FDE047]/60">{keyText(c.airLabel ?? "점프 중 L")}</b> {keyText(c.airDesc)}
                    </p>
                    <p className="break-keep">
                      <KeyCap k="I" /> <b className="text-[#22D3EE]/85">{c.ultName}</b> {keyText(c.ultDesc)}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>
        ) : (
          <StatusList />
        )}
      </div>
      {/* 콤보·기술 */}
      <section>
        <Sec title="콤보 · 기술" color="#FDE047" />
        <div className="grid gap-2 lg:grid-cols-3">
          {TECH.map((g) => (
            <div key={g.title} className={CARD}>
              <div className="mb-1 text-[10.5px] font-bold" style={{ color: g.color }}>
                {g.title}
              </div>
              <dl className="flex flex-col gap-1">
                {g.items.map(([t, d]) => (
                  <div key={t}>
                    <dt className="font-bold text-white/80">{t}</dt>
                    <dd className="break-keep text-white/55">{keyText(d)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </section>
      {chars && <StatusList />}
    </div>
  );
}

/** 상태 이상 */
function StatusList() {
  return (
    <section className="min-w-0">
      <Sec title="상태 이상" color="#34D399" />
      <div className={`${CARD} grid gap-1`}>
        {STATUS.map(([n, who, col, d]) => (
          <div key={n} className="flex items-start gap-2">
            <span className="mt-px w-14 shrink-0 rounded px-1.5 text-center text-[10.5px] font-bold text-black" style={{ background: col }}>
              {n}
            </span>
            <span className="w-9 shrink-0 text-white/45">{who}</span>
            <span className="min-w-0 break-keep">{d}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
