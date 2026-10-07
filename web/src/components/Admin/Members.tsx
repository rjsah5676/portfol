"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Avatar from "@/components/Account/Avatar";
import { useModal } from "@/components/Modal/ModalProvider";
import {
  clearUserAvatar,
  listUsers,
  removeUser,
  updateUser,
  type AdminUser,
} from "@/firestore/adminData";
import { refreshBadges } from "@/lib/badges";
import { ago, BOARD_LABEL } from "./Overview";

/*
 * 회원 관리: 별명·이메일로 찾기 → 줄을 누르면 펼쳐서 별명·꾸밈 바꾸기, 올린 사진 지우기, 회원 지우기.
 * 별명을 바꾸면 그 사람의 랭킹·방명록 이름도 서버에서 같이 바뀜.
 */

const KR = "font-['Nanum_Gothic',sans-serif]";
const btn =
  "cursor-pointer rounded-full border border-white/15 px-3 py-1.5 font-mono text-xs whitespace-nowrap text-white/70 transition-colors hover:border-[#6C63FF]/60 hover:text-white disabled:cursor-default disabled:opacity-35";
const dangerBtn =
  "cursor-pointer rounded-full border border-red-400/30 px-3 py-1.5 font-mono text-xs whitespace-nowrap text-red-300/90 transition-colors hover:border-red-400/70 hover:text-red-200 disabled:cursor-default disabled:opacity-35";
const input =
  "min-w-0 rounded-full border border-white/10 bg-[#121212] px-4 py-2 text-sm text-white placeholder:text-white/30 focus:border-[#6C63FF]/60 focus:outline-none";

/** 꾸밈으로 자주 쓸 만한 것 */
const BADGES = ["👑", "⭐", "🔥", "💎", "🎮", "🐛", "🍈", "🥇"];

/** 기록 이름(랭킹 판 · 온라인 게임) → 화면 이름 */
const GAME_LABEL: Record<string, string> = {
  ...BOARD_LABEL,
  rhythm: "BEAT DASH",
  chess: "체스",
  janggi: "장기",
  omok: "오목",
};

const day = (ms: number) => {
  const d = new Date(ms);
  const p = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
};

/** 펼친 줄: 고치기 · 지우기 · 기록 요약 */
function Detail({
  user,
  onSaved,
  onRemoved,
}: {
  user: AdminUser;
  onSaved: (u: AdminUser) => void;
  onRemoved: () => void;
}) {
  const modal = useModal();
  const [nick, setNick] = useState(user.nick);
  const [badge, setBadge] = useState(user.badge ?? "");
  const [records, setRecords] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const dirty = nick.trim() !== user.nick || badge.trim() !== (user.badge ?? "");

  const save = async () => {
    if (busy || !dirty) return;
    setBusy(true);
    setError("");
    try {
      onSaved(await updateUser(user.uid, { nick: nick.trim(), badge: badge.trim() || null }));
      refreshBadges(true); // 랭킹·방명록의 이름 옆 꾸밈도 바로 바뀌게
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장하지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  const clearPhoto = async () => {
    if (busy) return;
    const ok = await modal.confirm({
      title: "올린 사진 지우기",
      message: `${user.nick} 님이 올린 프로필 사진을 지울까요?`,
      confirmText: "지우기",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await clearUserAvatar(user.uid);
      onSaved({ ...user, avatar: null });
    } catch (e) {
      setError(e instanceof Error ? e.message : "지우지 못했어요.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    const ok = await modal.confirm({
      title: "회원 지우기",
      message: records
        ? `${user.nick} 님의 계정과 랭킹·방명록 기록을 모두 지워요. 되돌릴 수 없어요.`
        : `${user.nick} 님의 계정을 지워요. 랭킹·방명록 기록은 비회원 기록으로 남아요. 되돌릴 수 없어요.`,
      confirmText: "지우기",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await removeUser(user.uid, records);
      onRemoved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "지우지 못했어요.");
      setBusy(false);
    }
  };

  const plays = Object.entries(user.stats.plays ?? {}).sort((a, b) => b[1] - a[1]);
  const online = Object.entries(user.stats.online ?? {});
  const sk = user.stats.sketch;

  return (
    <div className="grid gap-6 border-t border-white/[0.07] bg-[#17181D] px-4 py-5 md:grid-cols-[1.2fr_1fr] md:px-5">
      <div>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label className="flex items-center gap-3">
            <span className={`w-10 shrink-0 text-xs text-white/45 ${KR}`}>별명</span>
            <input
              value={nick}
              maxLength={10}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => {
                setNick(e.target.value);
                setError("");
              }}
              className={`${input} flex-1 ${KR}`}
            />
          </label>
          <div className="flex items-start gap-3">
            <span className={`mt-2.5 w-10 shrink-0 text-xs text-white/45 ${KR}`}>꾸밈</span>
            <div className="min-w-0 flex-1">
              <input
                value={badge}
                aria-label="꾸밈"
                placeholder="없음"
                autoComplete="off"
                onChange={(e) => {
                  setBadge(e.target.value);
                  setError("");
                }}
                className={`${input} w-full ${KR}`}
              />
              <div className="mt-2 flex flex-wrap gap-1">
                {BADGES.map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setBadge(badge === b ? "" : b)}
                    className={`h-8 w-8 cursor-pointer rounded-full border text-sm transition-colors ${
                      badge === b
                        ? "border-[#6C63FF] bg-[#6C63FF]/20"
                        : "border-white/10 hover:border-white/30"
                    }`}
                  >
                    {b}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <p className={`text-xs ${error ? "text-red-400" : "text-white/35"} ${KR}`}>
            {error ||
              "별명을 바꾸면 이 사람의 랭킹·방명록 이름도 같이 바뀌어요. 꾸밈은 별명 앞에 붙어요 (8자까지)."}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={busy || !dirty || nick.trim().length < 2}
              className="cursor-pointer rounded-full bg-[#6C63FF] px-5 py-1.5 font-mono text-xs text-white transition-colors hover:bg-[#5b52f0] disabled:cursor-default disabled:opacity-35"
            >
              {busy ? "…" : "저장"}
            </button>
            <button type="button" onClick={clearPhoto} disabled={busy || !user.avatar} className={btn}>
              올린 사진 지우기
            </button>
          </div>
        </form>

        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/[0.07] pt-4">
          <button type="button" onClick={remove} disabled={busy} className={dangerBtn}>
            회원 지우기
          </button>
          <label className={`flex cursor-pointer items-center gap-2 text-xs text-white/55 ${KR}`}>
            <input
              type="checkbox"
              checked={records}
              onChange={(e) => setRecords(e.target.checked)}
              className="accent-[#6C63FF]"
            />
            랭킹·방명록 기록도 같이 지우기
          </label>
        </div>
      </div>

      <div className="min-w-0">
        <dl className="grid grid-cols-[4.5rem_1fr] gap-y-1.5 text-xs">
          <dt className={`text-white/35 ${KR}`}>이메일</dt>
          <dd className="truncate font-mono text-white/75">{user.email ?? "—"}</dd>
          <dt className={`text-white/35 ${KR}`}>가입</dt>
          <dd className="font-mono text-white/75">{day(user.createdAt)}</dd>
          <dt className={`text-white/35 ${KR}`}>마지막 방문</dt>
          <dd className="font-mono text-white/75">
            {user.lastVisitAt ? `${day(user.lastVisitAt)} (${ago(user.lastVisitAt)})` : "—"}
          </dd>
          <dt className={`text-white/35 ${KR}`}>uid</dt>
          <dd className="truncate font-mono text-white/40" title={user.uid}>
            {user.uid}
          </dd>
        </dl>
        {plays.length + online.length > 0 || sk ? (
          <ul className={`mt-4 flex flex-wrap gap-1.5 text-xs ${KR}`}>
            {plays.map(([g, c]) => (
              <li key={g} className="rounded-full bg-white/[0.06] px-2.5 py-1 text-white/70">
                {GAME_LABEL[g] ?? g} <span className="font-mono text-white/45">{c}판</span>
              </li>
            ))}
            {online.map(([g, r]) => (
              <li key={`o-${g}`} className="rounded-full bg-white/[0.06] px-2.5 py-1 text-white/70">
                {GAME_LABEL[g] ?? g} 온라인{" "}
                <span className="font-mono text-white/45">
                  {r.w ?? 0}승 {r.l ?? 0}패{r.d ? ` ${r.d}무` : ""}
                </span>
              </li>
            ))}
            {sk?.games ? (
              <li className="rounded-full bg-white/[0.06] px-2.5 py-1 text-white/70">
                스케치 정답 <span className="font-mono text-white/45">{sk.correct ?? 0}개</span>
              </li>
            ) : null}
          </ul>
        ) : (
          <p className={`mt-4 text-xs text-white/30 ${KR}`}>아직 게임 기록이 없어요.</p>
        )}
      </div>
    </div>
  );
}

export default function Members() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async (query: string) => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const res = await listUsers(query.trim());
      if (mine !== seq.current) return; // 그 사이에 다른 검색이 나감
      setItems(res.items);
      setTotal(res.total);
      setFailed(false);
    } catch (e) {
      console.error(e);
      if (mine === seq.current) setFailed(true);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  // 입력이 멈추면 찾기
  useEffect(() => {
    const id = setTimeout(() => load(q), q ? 250 : 0);
    return () => clearTimeout(id);
  }, [q, load]);

  return (
    <div>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="별명·이메일로 찾기"
          className={`${input} flex-1 bg-[#1C1E24] ${KR}`}
        />
        <button type="button" onClick={() => load(q)} disabled={loading} className={btn}>
          새로고침
        </button>
      </div>
      <p className="mb-3 font-mono text-[11px] text-white/30">
        {loading ? "…" : failed ? "불러오지 못했어요" : `${total.toLocaleString()}명`}
        {!loading && !failed && items.length < total && ` · 최근 ${items.length}명만 보여요 (찾기로 좁혀주세요)`}
      </p>

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#1C1E24]">
        <div
          className={`hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_5rem_4rem_4rem_5.5rem] gap-3 border-b border-white/10 px-5 py-2.5 text-[11px] text-white/35 md:grid ${KR}`}
        >
          <span>별명</span>
          <span>이메일</span>
          <span>가입</span>
          <span className="text-right">방문</span>
          <span className="text-right">게임</span>
          <span className="text-right">마지막 방문</span>
        </div>
        {items.length === 0 ? (
          <p className={`py-14 text-center text-sm text-white/30 ${KR}`}>
            {loading ? "불러오는 중…" : q ? "찾는 회원이 없어요." : "아직 회원이 없어요."}
          </p>
        ) : (
          <ul>
            {items.map((u) => {
              const open = openId === u.uid;
              return (
                <li key={u.uid} className="border-b border-white/[0.06] last:border-0">
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpenId(open ? null : u.uid)}
                    className={`grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left transition-colors md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_5rem_4rem_4rem_5.5rem] md:px-5 ${
                      open ? "bg-white/[0.04]" : "hover:bg-white/[0.03]"
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <Avatar profile={u} photo={null} size="sm" />
                      <span className="min-w-0">
                        <span className={`block truncate text-sm text-white/90 ${KR}`}>
                          {u.badge && <span className="mr-1">{u.badge}</span>}
                          {u.nick}
                        </span>
                        <span className="block truncate font-mono text-[11px] text-white/30 md:hidden">
                          {u.email}
                        </span>
                      </span>
                    </span>
                    <span className="hidden truncate font-mono text-xs text-white/45 md:block">
                      {u.email ?? "—"}
                    </span>
                    <span className="hidden font-mono text-xs text-white/45 md:block">
                      {day(u.createdAt).slice(2)}
                    </span>
                    <span className="hidden text-right font-mono text-xs text-white/75 tabular-nums md:block">
                      {u.visits.toLocaleString()}
                    </span>
                    <span className="hidden text-right font-mono text-xs text-white/75 tabular-nums md:block">
                      {u.plays.toLocaleString()}
                    </span>
                    <span className="text-right font-mono text-xs text-white/45">
                      {u.lastVisitAt ? ago(u.lastVisitAt) : "—"}
                    </span>
                  </button>
                  {open && (
                    <Detail
                      key={u.uid}
                      user={u}
                      onSaved={(next) => setItems((list) => list.map((x) => (x.uid === next.uid ? next : x)))}
                      onRemoved={() => {
                        setItems((list) => list.filter((x) => x.uid !== u.uid));
                        setTotal((t) => Math.max(0, t - 1));
                        setOpenId(null);
                      }}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
