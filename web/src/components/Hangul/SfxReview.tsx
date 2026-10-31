"use client";

import { useState } from "react";
import { getPicks, playSfx, setPick, SFX_NAMES, type SfxName } from "@/lib/hangul/sound";

/*
 * ?review=sfx — 효과음 후보 들어 보고 고르기 (일레븐랩스 후보 4개씩, 기본은 다듬기 스크립트가 "깨끗한" 것으로 고름)
 * 고른 번호는 이 브라우저에만 저장됨 → 마음에 드는 번호를 알려 주면 기본 파일로 바꿔 둠
 */
const WHERE: Record<SfxName, string> = {
  select: "자모 고르기",
  merge: "자모끼리 합치기",
  syllable: "글자 완성",
  word: "낱말 묶기",
  place: "원고지에 놓기",
  erase: "원고지에서 빼기",
  punct: "문장부호",
  discard: "버리기",
  "sent-best": "문장 완성 · 명문",
  "sent-good": "문장 완성 · 말 됨",
  "sent-meh": "문장 완성 · 억지",
  link: "앞 문장과 이어짐",
  read: "글 낭독 공격",
  shot: "글자 · 낱말이 쏨",
  kill: "먹물 처치",
  hit: "(예비) 맞음",
  wave: "웨이브 시작",
  boss: "왕먹물 등장",
  warn: "먹물 70% 경고",
  over: "먹물에 덮임",
  start: "시작 꽹과리",
  switch: "시작 회초리",
  click: "버튼",
  open: "랭킹 열기",
  like: "👍 웃겨요",
  card: "카드 만들기",
  drop: "(예비) 자모 들어옴",
};

export default function SfxReview() {
  const [picks, setPicks] = useState(getPicks);
  const choose = (n: SfxName, k: number | null) => {
    setPick(n, k);
    setPicks(getPicks());
    playSfx(n, 1, k ?? undefined);
  };
  return (
    <section className="hg-review">
      <h2>효과음 고르기</h2>
      <p className="hg-dim">
        ▶ 를 누르면 들려요. 고른 번호는 이 브라우저에만 저장 — 마음에 드는 번호를 알려 주면 기본으로
        바꿔 둠.
      </p>
      <table>
        <tbody>
          {SFX_NAMES.map((n) => (
            <tr key={n}>
              <th>
                {WHERE[n]}
                <small>{n}</small>
              </th>
              <td>
                <button
                  type="button"
                  className={picks[n] == null ? "is-on" : ""}
                  onClick={() => choose(n, null)}
                >
                  ▶ 기본
                </button>
                {(n === "drop" ? [1, 3, 4] : [1, 2, 3, 4]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={picks[n] === k ? "is-on" : ""}
                    onClick={() => choose(n, k)}
                  >
                    ▶ {k}
                  </button>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
