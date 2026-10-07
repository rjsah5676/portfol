"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Avatar from "@/components/Account/Avatar";
import { plainName } from "@/components/Nick";
import { getOverview, type AdminActivity, type AdminOverview } from "@/firestore/adminData";
import { siteLabel } from "@/components/Admin/Traffic";

/*
 * 관리자 첫 화면: 사이트에서 지금 무슨 일이 있는지 한눈에.
 * 방문자(14일) · 확인할 것(문의·회원·글·방명록) · 지금 열려 있는 것 · 랭킹 기록 수 · 서버 · 최근 활동.
 * 30초마다 다시 읽음. 숫자를 누르면 그 데이터를 다루는 구역으로 이동.
 */

const KR = "font-['Nanum_Gothic',sans-serif]";
const panel = "rounded-2xl border border-white/10 bg-[#1C1E24] p-5";
const heading = "mb-4 font-mono text-xs text-[#8B84FF]";

/** 랭킹 컬렉션 → 화면 이름 */
export const BOARD_LABEL: Record<string, string> = {
  score: "멜론 게임",
  minesweeper_rankings: "지뢰찾기",
  reaction: "반응속도",
  rhythm_rankings: "BEAT DASH",
  chess_ai_rankings: "체스 AI",
  janggi_ai_rankings: "장기 AI",
  omok_ai_rankings: "오목 AI",
  fight_ai_rankings: "픽셀 격투 AI",
};
const ROOM_LABEL: Record<string, string> = {
  chess_rooms: "체스",
  janggi_rooms: "장기",
  omok_rooms: "오목",
};
const ACT: Record<AdminActivity["kind"], { label: string; color: string }> = {
  member: { label: "가입", color: "#8B84FF" },
  guest: { label: "방명록", color: "#2DD4BF" },
  inquiry: { label: "문의", color: "#FBBF24" },
  rank: { label: "랭킹", color: "#F472B6" },
};

const n = (v: number) => v.toLocaleString();

/** "3분 전" · "2시간 전" · "어제" · "10.03" */
export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return "방금";
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  if (s < 172800) return "어제";
  const d = new Date(at);
  return `${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

function uptime(startedAt: number): string {
  const m = Math.floor((Date.now() - startedAt) / 60000);
  if (m < 60) return `${m}분`;
  if (m < 1440) return `${Math.floor(m / 60)}시간 ${m % 60}분`;
  return `${Math.floor(m / 1440)}일 ${Math.floor((m % 1440) / 60)}시간`;
}

/** 확인할 것 한 줄 — 누르면 그 구역으로 */
function Todo({
  label,
  value,
  note,
  alert,
  onClick,
}: {
  label: string;
  value: number;
  note?: string;
  alert?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full cursor-pointer items-baseline justify-between gap-3 border-b border-white/[0.07] py-3 text-left last:border-0"
    >
      <span className={`text-sm text-white/70 transition-colors group-hover:text-white ${KR}`}>
        {label}
        {note && <span className="ml-2 text-xs text-white/30">{note}</span>}
      </span>
      <span
        className={`font-mono text-xl tabular-nums ${alert ? "text-[#FBBF24]" : "text-white"}`}
      >
        {n(value)}
      </span>
    </button>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className={`text-sm text-white/55 ${KR}`}>{label}</span>
      <span className="font-mono text-sm text-white/90 tabular-nums">{children}</span>
    </div>
  );
}

export default function Overview({ onGo }: { onGo: (tab: string) => void }) {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadedAt, setLoadedAt] = useState(0);

  const load = useCallback(async () => {
    try {
      setData(await getOverview());
      setFailed(false);
      setLoadedAt(Date.now());
    } catch (e) {
      console.error(e);
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 처음 한 번 + 30초마다 조회
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  if (!data)
    return (
      <p className="py-16 text-center font-mono text-sm text-white/35">
        {failed ? "불러오지 못했어요. 서버가 떠 있는지 확인해주세요." : "불러오는 중…"}
      </p>
    );

  const max = Math.max(1, ...data.visitors.daily.map((d) => d.count));
  const rankTotal = Object.values(data.rankings).reduce((a, b) => a + b, 0);
  const rankMax = Math.max(1, ...Object.values(data.rankings));
  const boards = Object.entries(data.rankings).sort((a, b) => b[1] - a[1]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-[1.7fr_1fr]">
        {/* 방문자 */}
        <section className={panel}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className={heading}>방문자</div>
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-5xl font-bold text-white tabular-nums">
                  {n(data.visitors.today)}
                </span>
                <span className={`text-sm text-white/45 ${KR}`}>오늘</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onGo("visitors")}
              className={`cursor-pointer text-right text-sm text-white/45 transition-colors hover:text-white ${KR}`}
            >
              누적 <span className="font-mono text-white/90">{n(data.visitors.total)}</span>
            </button>
          </div>
          {/* 최근 14일 (오늘이 맨 오른쪽) */}
          <div className="mt-6 flex h-28 items-end gap-1.5">
            {data.visitors.daily.map((d, i) => (
              <div
                key={d.date}
                title={`${d.date} · ${n(d.count)}명`}
                className="group flex h-full flex-1 flex-col justify-end"
              >
                <span className="mb-1 text-center font-mono text-[10px] text-white/0 transition-colors group-hover:text-white/70">
                  {d.count}
                </span>
                <span
                  className={`w-full rounded-t-sm transition-colors ${
                    i === data.visitors.daily.length - 1
                      ? "bg-[#8B84FF]"
                      : "bg-[#6C63FF]/35 group-hover:bg-[#6C63FF]/70"
                  }`}
                  style={{ height: `${Math.max(3, (d.count / max) * 100)}%` }}
                />
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between font-mono text-[10px] text-white/30">
            <span>{data.visitors.daily[0].date.slice(5).replace("-", ".")}</span>
            <span>오늘</span>
          </div>
          {/* 오늘 유입 TOP 3 → 유입 분석 */}
          <button
            type="button"
            onClick={() => onGo("traffic")}
            className={`mt-5 flex w-full cursor-pointer flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-white/[0.07] pt-4 text-left text-sm transition-colors hover:text-white ${KR}`}
          >
            <span className="font-mono text-xs text-[#8B84FF]">오늘 유입</span>
            <span className="text-white/45">
              <span className="font-mono text-white/90">{n(data.traffic.entries)}</span>회
            </span>
            {data.traffic.top.length === 0 ? (
              <span className="text-white/30">아직 없어요</span>
            ) : (
              data.traffic.top.map(([k, c], i) => (
                <span key={k} className="text-white/55">
                  <span className="mr-1 font-mono text-[11px] text-white/30">{i + 1}</span>
                  {siteLabel(k)} <span className="font-mono text-white/80">{n(c)}</span>
                </span>
              ))
            )}
          </button>
        </section>

        {/* 확인할 것 */}
        <section className={panel}>
          <div className={heading}>확인할 것</div>
          <Todo
            label="안 읽은 문의"
            note={`전체 ${n(data.inquiries.total)}`}
            value={data.inquiries.unread}
            alert={data.inquiries.unread > 0}
            onClick={() => onGo("inbox")}
          />
          <Todo label="회원" value={data.members.total} onClick={() => onGo("members")} />
          <Todo
            label="글"
            note={`공부 ${n(data.posts.total - data.posts.retro)} · 회고 ${n(data.posts.retro)}`}
            value={data.posts.total}
            onClick={() => onGo("posts")}
          />
          <Todo label="방명록" value={data.guest.total} onClick={() => onGo("guest")} />
        </section>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* 지금 열려 있는 것 */}
        <section className={panel}>
          <div className={heading}>지금</div>
          <Line label="접속 중인 연결">{n(data.server.connections)}</Line>
          <button type="button" onClick={() => onGo("rooms")} className="block w-full cursor-pointer text-left">
            <Line label="스케치 퀴즈">
              {data.live.sketch.rooms}방 · {data.live.sketch.players}명
            </Line>
            <Line label="픽셀 격투">
              {data.live.fight.rooms}방 · {data.live.fight.players}명
            </Line>
            {Object.entries(data.rooms).map(([c, r]) => (
              <Line key={c} label={ROOM_LABEL[c] ?? c}>
                <span className={r.playing ? "text-[#2DD4BF]" : ""}>대국 {r.playing}</span>
                <span className="text-white/35"> · 대기 {r.waiting} · 전체 {n(r.total)}</span>
              </Line>
            ))}
          </button>
        </section>

        {/* 랭킹 기록 수 */}
        <section className={panel}>
          <button
            type="button"
            onClick={() => onGo("rankings")}
            className="mb-4 flex w-full cursor-pointer items-baseline justify-between font-mono text-xs text-[#8B84FF]"
          >
            랭킹 기록
            <span className="text-white/45">{n(rankTotal)}개</span>
          </button>
          <div className="flex flex-col gap-2">
            {boards.map(([b, c]) => (
              <div key={b} className="flex items-center gap-3">
                <span className={`w-24 shrink-0 truncate text-xs text-white/60 ${KR}`}>
                  {BOARD_LABEL[b] ?? b}
                </span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                  <span
                    className="block h-full rounded-full bg-[#F472B6]/70"
                    style={{ width: `${(c / rankMax) * 100}%` }}
                  />
                </span>
                <span className="w-8 text-right font-mono text-xs text-white/70 tabular-nums">{n(c)}</span>
              </div>
            ))}
          </div>
        </section>

        {/* 서버 */}
        <section className={`${panel} md:col-span-2 lg:col-span-1`}>
          <div className={heading}>서버</div>
          <Line label="켜진 지">{uptime(data.server.startedAt)}</Line>
          <Line label="메모리">{n(data.server.memoryMb)} MB</Line>
          <Line label="Node">{data.server.node}</Line>
          <Line label="환경">{data.server.env}</Line>
          <p className="mt-3 font-mono text-[11px] text-white/25">
            {loadedAt ? `${new Date(loadedAt).toLocaleTimeString("ko-KR")} 기준 · 30초마다 갱신` : ""}
            {failed && " · 갱신 실패"}
          </p>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.7fr_1fr]">
        {/* 최근 활동 */}
        <section className={panel}>
          <div className={heading}>최근 활동</div>
          {data.activity.length === 0 ? (
            <p className={`py-6 text-center text-sm text-white/30 ${KR}`}>아직 활동이 없어요.</p>
          ) : (
            <ul>
              {data.activity.map((a, i) => (
                <li
                  key={i}
                  className="flex items-baseline gap-3 border-b border-white/[0.06] py-2.5 last:border-0"
                >
                  <span
                    className="w-12 shrink-0 font-mono text-[11px]"
                    style={{ color: ACT[a.kind].color }}
                  >
                    {ACT[a.kind].label}
                  </span>
                  <span className={`shrink-0 text-sm text-white/90 ${KR}`}>{plainName(a.who) || "(이름 없음)"}</span>
                  <span className={`min-w-0 flex-1 truncate text-sm text-white/45 ${KR}`}>
                    {a.kind === "rank"
                      ? a.text.startsWith("rhythm:")
                        ? `BEAT DASH · ${a.text.slice(7)}`
                        : (BOARD_LABEL[a.text] ?? a.text)
                      : a.kind === "member"
                        ? ""
                        : a.text}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-white/30">{ago(a.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 최근 가입 */}
        <section className={panel}>
          <button
            type="button"
            onClick={() => onGo("members")}
            className="mb-4 cursor-pointer font-mono text-xs text-[#8B84FF]"
          >
            최근 가입
          </button>
          {data.members.recent.length === 0 ? (
            <p className={`py-6 text-center text-sm text-white/30 ${KR}`}>아직 회원이 없어요.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {data.members.recent.map((m) => (
                <li key={m.uid} className="flex items-center gap-3">
                  <Avatar profile={m} photo={null} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm text-white/90 ${KR}`}>
                      {m.badge && <span className="mr-1">{m.badge}</span>}
                      {m.nick}
                    </span>
                    <span className="block truncate font-mono text-[11px] text-white/30">{m.email}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-white/30">{ago(m.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
