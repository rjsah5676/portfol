"use client";

import { useCallback, useMemo, useState } from "react";
import { api } from "@/lib/api/http";
import { ROGUE_CHAR_NAME, floorLabel, type RogueChar } from "@/lib/rogue/rules";

/*
 * 관리자 · 게임 플레이 기록 — 픽셀 리셋 스토리 (rogue_plays, 회원/손님 모두 · 90일).
 * 서버에서 전부 받아(최대 1만 판) 브라우저에서 바로 묶어 봄: 캐릭터별 클리어율 · 끝난 층 · 맞은 원인 · 재화 흐름 · 아이템 · 방 시간.
 * 더 깊게 볼 땐 「JSON 받기」로 받은 파일을 그대로 분석에 씀.
 */

interface Play {
  _id: string;
  recvAt: number;
  uid: string | null;
  nick: string | null;
  guest: boolean;
  ver: string;
  char: string;
  result: string;
  floor: number;
  sec: number;
  kills: number;
  dev: boolean;
  touch: boolean;
  items: { id: string; f: number; t: number; src?: string | null }[];
  rooms: { f: number; type: string; in: number; clear: number | null; dmg: number }[];
  hits: { f: number; room: string; t: number; dmg: number; hp: number; by: string }[];
  econ: Record<string, Record<string, number>>;
  bought: string[];
}

const KR = "font-['Nanum_Gothic',sans-serif]";
const panel = "rounded-2xl border border-white/10 bg-[#1C1E24] p-5";
const heading = "mb-3 font-mono text-xs text-[#8B84FF]";
const btn =
  "rounded-full border border-white/15 px-3.5 py-1.5 font-mono text-xs whitespace-nowrap text-white/70 transition-colors hover:border-[#6C63FF]/60 hover:text-white disabled:opacity-40";
const chip = (on: boolean) =>
  `cursor-pointer rounded-full border px-3 py-1 font-mono text-xs whitespace-nowrap transition-colors ${
    on ? "border-[#6C63FF] bg-[#6C63FF]/15 text-white" : "border-white/10 text-white/50 hover:border-white/30 hover:text-white/80"
  }`;
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "-");
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const charName = (c: string) => ROGUE_CHAR_NAME[c as RogueChar] ?? c;
const ENEMY: Record<string, string> = {
  slime: "슬라임", bug: "벌레", turret: "터렛", spinner: "스피너", cube: "큐브", popup: "팝업 광고", mirror: "미러",
  kingslime: "킹 슬라임", lag: "렉 덩어리", queen: "벌레 여왕", loading: "무한 로딩", bigturret: "거대 터렛", freeze: "프리징", bsod: "블루스크린", self: "내 폭탄", "-": "?",
};
const hitName = (k: string) => {
  const [how, who = "-"] = k.split(":");
  const [w, el] = who.split("+");
  return `${ENEMY[w] ?? w}${el ? "(엘리트)" : ""} · ${({ bullet: "탄", touch: "몸통", other: "기타", bomb: "폭발" } as Record<string, string>)[how] ?? how}`;
};
const RESULT: Record<string, string> = { clear: "클리어", dead: "죽음", restart: "새로 시작" };

async function fetchAll(): Promise<Play[]> {
  const all: Play[] = [];
  let after: string | null = null;
  for (let i = 0; i < 20; i++) {
    const q: string = after ? `?after=${encodeURIComponent(after)}` : "";
    const r: { list: Play[]; next: string | null } = await api(`/api/admin/rogue/plays${q}`, { auth: true });
    all.push(...r.list);
    after = r.next;
    if (!after) break;
  }
  return all;
}

function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="text-white/40">
            {head.map((h, i) => (
              <th key={h} className={`pb-2 font-normal ${i ? "text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="font-mono text-white/80">
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-white/5">
              {r.map((c, j) => (
                <td key={j} className={`py-1.5 ${j ? "text-right tabular-nums" : KR}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function RoguePlays() {
  const [all, setAll] = useState<Play[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [dev, setDev] = useState(false);
  const [ver, setVer] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setErr("");
    try {
      setAll(await fetchAll());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "불러오지 못했어요");
    } finally {
      setBusy(false);
    }
  }, []);

  const vers = useMemo(() => [...new Set((all ?? []).map((p) => p.ver))].sort().reverse(), [all]);
  const plays = useMemo(() => (all ?? []).filter((p) => (dev || !p.dev) && (!ver || p.ver === ver)), [all, dev, ver]);
  const s = useMemo(() => {
    const ended = plays.filter((p) => p.result !== "restart");
    const clears = ended.filter((p) => p.result === "clear");
    const people = new Set(plays.map((p) => p.uid ?? p._id));
    const chars = Object.keys(ROGUE_CHAR_NAME).map((c) => {
      const xs = ended.filter((p) => p.char === c);
      return [charName(c), xs.length, pct(xs.filter((p) => p.result === "clear").length, xs.length), avg(xs.map((p) => p.floor)).toFixed(1), mmss(avg(xs.map((p) => p.sec)))];
    });
    const endFloor = new Map<number, number>();
    for (const p of ended) if (p.result !== "clear") endFloor.set(p.floor, (endFloor.get(p.floor) ?? 0) + 1);
    const dmg = new Map<string, number>(), kill = new Map<string, number>();
    for (const p of plays) {
      for (const h of p.hits ?? []) dmg.set(h.by, (dmg.get(h.by) ?? 0) + h.dmg);
      const last = (p.hits ?? [])[(p.hits ?? []).length - 1];
      if (p.result === "dead" && last) kill.set(last.by, (kill.get(last.by) ?? 0) + 1);
    }
    const floors = [...new Set(plays.flatMap((p) => Object.keys(p.econ ?? {}).map(Number)))].sort((a, b) => a - b);
    const econ = floors.map((f) => {
      const es = plays.map((p) => p.econ?.[f]).filter(Boolean) as Record<string, number>[];
      const a = (k: string) => avg(es.map((e) => e[k] ?? 0)).toFixed(1);
      return [floorLabel(f), es.length, a("bitIn"), a("bitOut"), a("keyIn"), a("keyOut"), a("bombIn"), a("bombOut")];
    });
    const items = new Map<string, { n: number; clear: number }>();
    for (const p of ended) for (const id of new Set((p.items ?? []).map((i) => i.id))) {
      const o = items.get(id) ?? { n: 0, clear: 0 };
      o.n++;
      if (p.result === "clear") o.clear++;
      items.set(id, o);
    }
    const roomT = new Map<string, number[]>();
    for (const p of plays) for (const r of p.rooms ?? []) if (r.clear != null && r.type !== "start") (roomT.get(r.type) ?? roomT.set(r.type, []).get(r.type)!).push(r.clear);
    return {
      ended, clears, people,
      guests: plays.filter((p) => p.guest).length,
      chars,
      endFloor: [...endFloor].sort((a, b) => a[0] - b[0]).map(([f, n]) => [floorLabel(f), n, pct(n, ended.length)]),
      dmg: [...dmg].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => [hitName(k), v]),
      kill: [...kill].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => [hitName(k), v]),
      econ,
      items: [...items].sort((a, b) => b[1].n - a[1].n).slice(0, 25).map(([id, o]) => [id, o.n, pct(o.n, ended.length), pct(o.clear, o.n)]),
      rooms: [...roomT].sort((a, b) => b[1].length - a[1].length).map(([t, xs]) => [t, xs.length, `${avg(xs).toFixed(1)}초`]),
    };
  }, [plays]);

  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ at: Date.now(), plays: all ?? [] })], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `rogue-plays-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  return (
    <div className={`flex flex-col gap-4 ${KR}`}>
      <div className={panel}>
        <div className={heading}>PIXEL RESET STORY · 플레이 기록</div>
        <p className="mb-3 text-xs leading-relaxed text-white/50">
          판이 끝날 때(죽음 · 클리어 · 도중에 새로 시작) 게임이 보내는 밸런스 분석용 기록이에요. 회원 · 손님 모두, 90일 보관.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={btn} disabled={busy} onClick={() => void load()}>
            {busy ? "불러오는 중…" : all ? "다시 불러오기" : "불러오기"}
          </button>
          <button type="button" className={btn} disabled={!all?.length} onClick={download}>
            JSON 받기
          </button>
          <span className={chip(dev)} onClick={() => setDev((v) => !v)}>
            DEV 판 포함
          </span>
          {vers.map((v) => (
            <span key={v} className={chip(ver === v)} onClick={() => setVer(ver === v ? "" : v)}>
              {v}
            </span>
          ))}
          {err && <span className="text-xs text-[#F472B6]">{err}</span>}
        </div>
      </div>

      {all && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              ["판 (새로 시작 빼고)", s.ended.length.toLocaleString()],
              ["사람", `${s.people.size.toLocaleString()}`],
              ["손님 판", pct(s.guests, plays.length)],
              ["클리어율", pct(s.clears.length, s.ended.length)],
              ["평균 도달 층", avg(s.ended.map((p) => p.floor)).toFixed(1)],
            ].map(([l, v]) => (
              <div key={l} className={panel}>
                <div className="text-xs text-white/45">{l}</div>
                <div className="mt-2 font-mono text-2xl font-bold tabular-nums">{v}</div>
              </div>
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className={panel}>
              <div className={heading}>캐릭터별</div>
              <Table head={["캐릭터", "판", "클리어", "평균 층", "평균 시간"]} rows={s.chars} />
            </div>
            <div className={panel}>
              <div className={heading}>어디서 끝났나 (클리어 빼고)</div>
              <Table head={["층", "판", "비율"]} rows={s.endFloor} />
            </div>
            <div className={panel}>
              <div className={heading}>받은 피해 (원인별 합)</div>
              <Table head={["원인", "피해"]} rows={s.dmg} />
            </div>
            <div className={panel}>
              <div className={heading}>죽은 원인 (마지막 한 대)</div>
              <Table head={["원인", "판"]} rows={s.kill} />
            </div>
            <div className={`${panel} lg:col-span-2`}>
              <div className={heading}>층별 재화 흐름 (판당 평균)</div>
              <Table head={["층", "판", "비트 +", "비트 −", "열쇠 +", "열쇠 −", "폭탄 +", "폭탄 −"]} rows={s.econ} />
            </div>
            <div className={panel}>
              <div className={heading}>많이 먹은 아이템 · 먹은 판의 클리어율</div>
              <Table head={["아이템", "판", "먹은 비율", "클리어"]} rows={s.items} />
            </div>
            <div className={panel}>
              <div className={heading}>방 종류별 클리어 시간</div>
              <Table head={["방", "번", "평균"]} rows={s.rooms} />
            </div>
          </div>
          <div className={panel}>
            <div className={heading}>최근 30판</div>
            <Table
              head={["언제 · 누가", "캐릭터", "결과", "층", "시간", "아이템", "맞음"]}
              rows={[...plays]
                .reverse()
                .slice(0, 30)
                .map((p) => [
                  `${new Date(p.recvAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · ${p.nick ?? "손님"}${p.dev ? " · DEV" : ""}${p.touch ? " · 터치" : ""}`,
                  charName(p.char),
                  RESULT[p.result] ?? p.result,
                  floorLabel(p.floor),
                  mmss(p.sec),
                  (p.items ?? []).length,
                  (p.hits ?? []).length,
                ])}
            />
          </div>
        </>
      )}
    </div>
  );
}
