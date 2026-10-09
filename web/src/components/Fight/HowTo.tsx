/**
 * 판 아래 조작·기술 설명 (선택 화면·경기 중 공용) — 키는 칸으로, 기술은 이름 + 한 줄 설명으로 나눠서 읽기 쉽게.
 * 경기 중엔 지금 싸우는 두 캐릭터의 기술도 보여 줌. 콤보 넣는 법·캐릭터별 설명은 게임 화면 안 「기술 가이드」(TechGuide).
 */
import { CHARS } from "@/lib/fight/chars";
import { STATUS, TECH } from "./guideData";
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
          <div key={n + who} className="flex items-start gap-2">
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
