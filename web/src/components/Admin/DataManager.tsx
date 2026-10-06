"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useModal } from "@/components/Modal/ModalProvider";
import { SONGS } from "@/lib/rhythm/music";
import {
  FETCH_LIMIT,
  formatCell,
  fromEditableJson,
  listDocs,
  removeChessRooms,
  removeDocs,
  replaceDoc,
  sortValue,
  toEditableJson,
  type AdminDoc,
} from "@/firestore/adminData";

type Dir = "asc" | "desc";

interface Source {
  key: string;
  label: string;
  group: string;
  /** 서브 선택값(리듬게임 곡_난이도)을 받아 컬렉션 경로를 만듦 */
  path: (sub: string) => string;
  sub?: { value: string; label: string }[];
  columns: string[];
  sort: [string, Dir];
  /** false면 편집 버튼 숨김 (규칙상 관리자 update 불가) */
  editable: boolean;
  note?: string;
}

const DIFFS = ["easy", "normal", "hard", "expert", "nightmare"];
const RHYTHM_CHARTS = SONGS.filter((s) => !s.practice).flatMap((s) =>
  DIFFS.map((d) => ({ value: `${s.id}_${d}`, label: `${s.title} · ${d}` }))
);

const SOURCES: Source[] = [
  {
    key: "mine",
    label: "지뢰찾기",
    group: "랭킹",
    path: () => "minesweeper_rankings",
    columns: ["name", "time"],
    sort: ["time", "asc"],
    editable: true,
  },
  {
    key: "reaction",
    label: "반응속도",
    group: "랭킹",
    path: () => "reaction",
    columns: ["name", "score"],
    sort: ["score", "asc"],
    editable: true,
  },
  {
    key: "melon",
    label: "멜론게임",
    group: "랭킹",
    path: () => "score",
    columns: ["name", "score"],
    sort: ["score", "desc"],
    editable: true,
  },
  {
    key: "rhythm",
    label: "리듬게임",
    group: "랭킹",
    path: (sub) => `rhythm_rankings/${sub}/scores`,
    sub: RHYTHM_CHARTS,
    columns: ["name", "score", "acc", "maxCombo", "fc", "ap", "createdAt"],
    sort: ["score", "desc"],
    editable: true,
  },
  {
    key: "chessAI",
    label: "체스 AI",
    group: "랭킹",
    path: () => "chess_ai_rankings",
    columns: ["name", "score", "opp", "moves", "seconds", "lead", "createdAt"],
    sort: ["score", "desc"],
    editable: true,
  },
  {
    key: "janggiAI",
    label: "장기 AI",
    group: "랭킹",
    path: () => "janggi_ai_rankings",
    columns: ["name", "score", "opp", "moves", "seconds", "lead", "createdAt"],
    sort: ["score", "desc"],
    editable: true,
  },
  {
    key: "guest",
    label: "방명록",
    group: "사이트",
    path: () => "guest",
    columns: ["name", "contents", "date", "color"],
    sort: ["id", "desc"],
    editable: true,
  },
  {
    key: "siteStats",
    label: "방문자 수",
    group: "사이트",
    path: () => "siteStats",
    columns: ["count"],
    sort: ["__id", "desc"],
    editable: true,
    note: "total = 누적, daily_YYYY-MM-DD = 일별",
  },
  {
    key: "chess",
    label: "체스방",
    group: "사이트",
    path: () => "chess_rooms",
    columns: ["name", "status", "whiteName", "blackName", "result", "updatedAt"],
    sort: ["updatedAt", "desc"],
    editable: false,
    note: "삭제 시 채팅·접속기록(하위 컬렉션)도 같이 삭제",
  },
  {
    key: "janggi",
    label: "장기방",
    group: "사이트",
    path: () => "janggi_rooms",
    columns: ["name", "status", "whiteName", "blackName", "result", "updatedAt"],
    sort: ["updatedAt", "desc"],
    editable: false,
    note: "white = 초, black = 한 · 삭제 시 채팅·접속기록(하위 컬렉션)도 같이 삭제",
  },
  ...["sketch_user", "sketch_user_room", "sketch_user_chat"].map<Source>((c) => ({
    key: c,
    label: c,
    group: "레거시",
    path: () => c,
    columns: [],
    sort: ["__id", "asc"],
    editable: true,
    note: "메뉴에서 내린 스케치 퀴즈 데이터",
  })),
];

const chip = (on: boolean) =>
  `cursor-pointer rounded-full border px-3 py-1 font-mono text-xs whitespace-nowrap transition-colors ${
    on
      ? "border-[#6C63FF] bg-[#6C63FF]/15 text-white"
      : "border-white/10 text-white/50 hover:border-white/30 hover:text-white/80"
  }`;
const btn =
  "cursor-pointer rounded-full border border-white/15 px-3 py-1 font-mono text-xs whitespace-nowrap text-white/70 transition-colors hover:border-[#6C63FF]/60 hover:text-white disabled:cursor-default disabled:opacity-40";
const dangerBtn =
  "cursor-pointer rounded-full border border-red-400/30 px-3 py-1 font-mono text-xs whitespace-nowrap text-red-300/80 transition-colors hover:border-red-400/70 hover:text-red-200 disabled:cursor-default disabled:opacity-40";

const valueOf = (d: AdminDoc, col: string) => (col === "__id" ? d.id : d.data[col]);

export default function DataManager() {
  const modal = useModal();
  const [srcKey, setSrcKey] = useState(SOURCES[0].key);
  const src = SOURCES.find((s) => s.key === srcKey)!;
  const [sub, setSub] = useState(RHYTHM_CHARTS[0]?.value ?? "");
  const path = src.path(sub);

  const [docs, setDocs] = useState<AdminDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<[string, Dir]>(src.sort);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setDocs(await listDocs(path));
    } catch (e) {
      console.error(e);
      setDocs([]);
      setError("불러오기 실패 (권한/규칙 확인)");
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 컬렉션 바뀔 때마다 조회
    load();
  }, [load]);

  const selectSource = (key: string) => {
    const next = SOURCES.find((s) => s.key === key)!;
    setSrcKey(key);
    setSort(next.sort);
    setSelected(new Set());
    setEditing(null);
    setQ("");
  };

  // 레거시처럼 컬럼을 정해두지 않은 컬렉션은 실제 문서 필드에서 뽑음
  const columns = useMemo(() => {
    if (src.columns.length) return src.columns;
    const keys = new Set<string>();
    docs.slice(0, 50).forEach((d) => Object.keys(d.data).forEach((k) => keys.add(k)));
    return [...keys].slice(0, 6);
  }, [src, docs]);

  const rows = useMemo(() => {
    const [col, dir] = sort;
    const sorted = [...docs].sort((a, b) => {
      const x = sortValue(valueOf(a, col));
      const y = sortValue(valueOf(b, col));
      const c = x < y ? -1 : x > y ? 1 : 0;
      return dir === "asc" ? c : -c;
    });
    const t = q.trim().toLowerCase();
    if (!t) return sorted;
    return sorted.filter((d) =>
      `${d.id} ${Object.values(d.data).map(formatCell).join(" ")}`.toLowerCase().includes(t)
    );
  }, [docs, sort, q]);

  const toggleSort = (col: string) =>
    setSort(([c, d]) => (c === col ? [c, d === "asc" ? "desc" : "asc"] : [col, "asc"]));

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)));

  const remove = async (ids: string[], label: string) => {
    if (!ids.length) return;
    const ok = await modal.confirm({
      title: "삭제",
      message: (
        <span className="whitespace-pre-line">
          {`${label} (${ids.length}개)\n${path}\n되돌릴 수 없습니다.`}
        </span>
      ),
      confirmText: "삭제",
      cancelText: "취소",
    });
    if (!ok) return;
    setBusy(true);
    try {
      if (src.key === "chess") await removeChessRooms(ids);
      else if (src.key === "janggi") await removeChessRooms(ids, "janggi_rooms");
      else await removeDocs(path, ids);
      setSelected(new Set());
      if (editing && ids.includes(editing.id)) setEditing(null);
      await load();
    } catch (e) {
      console.error(e);
      await modal.alert({ title: "삭제 실패", message: "권한 또는 규칙을 확인해주세요." });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!editing) return;
    let data;
    try {
      data = fromEditableJson(editing.text);
    } catch (e) {
      await modal.alert({ title: "JSON 오류", message: (e as Error).message });
      return;
    }
    setBusy(true);
    try {
      await replaceDoc(path, editing.id, data);
      setEditing(null);
      await load();
    } catch (e) {
      console.error(e);
      await modal.alert({ title: "저장 실패", message: "권한 또는 규칙을 확인해주세요." });
    } finally {
      setBusy(false);
    }
  };

  const groups = [...new Set(SOURCES.map((s) => s.group))];
  const isRanking = src.group === "랭킹";

  return (
    <div>
      {/* 컬렉션 선택 */}
      <div className="mb-4 flex flex-col gap-2">
        {groups.map((g) => (
          <div key={g} className="flex flex-wrap items-center gap-1.5">
            <span className="w-14 shrink-0 font-mono text-[11px] text-white/30">{g}</span>
            {SOURCES.filter((s) => s.group === g).map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => selectSource(s.key)}
                className={chip(s.key === srcKey)}
              >
                {s.label}
              </button>
            ))}
          </div>
        ))}
      </div>

      {src.sub && (
        <select
          value={sub}
          onChange={(e) => {
            setSub(e.target.value);
            setSelected(new Set());
            setEditing(null);
          }}
          className="mb-4 w-full rounded-full border border-white/10 bg-[#1C1E24] px-4 py-2 font-mono text-sm text-white focus:border-[#6C63FF]/50 focus:outline-none sm:w-auto"
        >
          {src.sub.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}

      {/* 툴바 */}
      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="이름·값·문서 ID로 찾기"
          className="min-w-0 flex-1 rounded-full border border-white/10 bg-[#1C1E24] px-4 py-2 font-['Nanum_Gothic',sans-serif] text-sm text-white placeholder:text-white/30 focus:border-[#6C63FF]/50 focus:outline-none"
        />
        <div className="flex shrink-0 gap-1.5">
          <button type="button" onClick={load} disabled={busy || loading} className={btn}>
            새로고침
          </button>
          <button
            type="button"
            disabled={busy || !selected.size}
            onClick={() => remove([...selected], "선택한 문서 삭제")}
            className={dangerBtn}
          >
            선택 삭제{selected.size ? ` ${selected.size}` : ""}
          </button>
          <button
            type="button"
            disabled={busy || !docs.length}
            onClick={() =>
              remove(
                docs.map((d) => d.id),
                isRanking ? "랭킹 초기화" : "전체 삭제"
              )
            }
            className={dangerBtn}
          >
            {isRanking ? "초기화" : "전체 삭제"}
          </button>
        </div>
      </div>
      <p className="mb-3 font-mono text-[11px] text-white/30">
        {path} ·{" "}
        {loading
          ? "…"
          : `${docs.length}개${docs.length >= FETCH_LIMIT ? ` (최대 ${FETCH_LIMIT}개까지만 조회)` : ""}`}
        {src.note && ` · ${src.note}`}
      </p>

      {error ? (
        <p className="rounded-xl border border-red-400/20 bg-[#1C1E24] py-10 text-center font-mono text-sm text-red-300/70">
          {error}
        </p>
      ) : loading ? (
        <p className="py-10 text-center font-mono text-sm text-white/30">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-[#1C1E24] py-12 text-center font-['Nanum_Gothic',sans-serif] text-sm text-white/35">
          {q ? "검색 결과가 없습니다." : "데이터가 없습니다."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/10 bg-[#1C1E24]">
          <table className="w-full font-mono text-xs">
            <thead>
              <tr className="border-b border-white/10 text-left text-white/40">
                <th className="w-8 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={toggleAll}
                    className="cursor-pointer accent-[#6C63FF]"
                  />
                </th>
                {isRanking && <th className="w-8 px-2 py-2.5">#</th>}
                {[...columns, "__id"].map((c) => (
                  <th key={c} className="px-2 py-2.5 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => toggleSort(c)}
                      className="cursor-pointer hover:text-white/80"
                    >
                      {c === "__id" ? "doc id" : c}
                      {sort[0] === c && (sort[1] === "asc" ? " ↑" : " ↓")}
                    </button>
                  </th>
                ))}
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((d, i) => (
                <Row
                  key={d.id}
                  d={d}
                  rank={isRanking ? i + 1 : undefined}
                  columns={columns}
                  checked={selected.has(d.id)}
                  onCheck={() => toggle(d.id)}
                  editable={src.editable}
                  editing={editing?.id === d.id ? editing.text : null}
                  onEdit={() =>
                    setEditing(
                      editing?.id === d.id ? null : { id: d.id, text: toEditableJson(d.data) }
                    )
                  }
                  onEditText={(text) => setEditing({ id: d.id, text })}
                  onSave={save}
                  onDelete={() => remove([d.id], `'${formatCell(d.data.name) || d.id}' 삭제`)}
                  busy={busy}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({
  d,
  rank,
  columns,
  checked,
  onCheck,
  editable,
  editing,
  onEdit,
  onEditText,
  onSave,
  onDelete,
  busy,
}: {
  d: AdminDoc;
  rank?: number;
  columns: string[];
  checked: boolean;
  onCheck: () => void;
  editable: boolean;
  editing: string | null;
  onEdit: () => void;
  onEditText: (t: string) => void;
  onSave: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const span = columns.length + (rank !== undefined ? 4 : 3);
  return (
    <>
      <tr className={`border-b border-white/5 last:border-0 ${checked ? "bg-[#6C63FF]/10" : ""}`}>
        <td className="px-3 py-2">
          <input
            type="checkbox"
            checked={checked}
            onChange={onCheck}
            className="cursor-pointer accent-[#6C63FF]"
          />
        </td>
        {rank !== undefined && <td className="px-2 py-2 text-white/35">{rank}</td>}
        {columns.map((c) => (
          <td
            key={c}
            className="max-w-[220px] truncate px-2 py-2 text-white/80"
            title={formatCell(d.data[c])}
          >
            {formatCell(d.data[c])}
          </td>
        ))}
        <td className="max-w-[120px] truncate px-2 py-2 text-white/25" title={d.id}>
          {d.id}
        </td>
        <td className="px-3 py-2">
          <div className="flex justify-end gap-1.5">
            <button type="button" onClick={onEdit} className={btn}>
              {editable ? (editing !== null ? "닫기" : "편집") : editing !== null ? "닫기" : "보기"}
            </button>
            <button type="button" onClick={onDelete} disabled={busy} className={dangerBtn}>
              삭제
            </button>
          </div>
        </td>
      </tr>
      {editing !== null && (
        <tr className="border-b border-white/5 bg-black/20">
          <td colSpan={span} className="px-3 py-3">
            <textarea
              value={editing}
              readOnly={!editable}
              onChange={(e) => onEditText(e.target.value)}
              spellCheck={false}
              rows={Math.min(18, editing.split("\n").length + 1)}
              className="w-full rounded-lg border border-white/10 bg-[#121317] p-3 font-mono text-xs text-white/85 focus:border-[#6C63FF]/50 focus:outline-none"
            />
            {editable && (
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] text-white/30">
                  문서 전체가 이 내용으로 교체됨 · 날짜는 {"{"}&quot;__timestamp&quot;: ISO{"}"}{" "}
                  형식
                </span>
                <button
                  type="button"
                  onClick={onSave}
                  disabled={busy}
                  className="cursor-pointer rounded-full bg-[#6C63FF] px-4 py-1.5 font-mono text-xs text-white transition-colors hover:bg-[#5b52f0] disabled:opacity-40"
                >
                  저장
                </button>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
