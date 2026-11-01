"use client";

import { useState } from "react";
import { getPicks, playSfx, setPick, SFX_NAMES, type SfxName } from "@/lib/hangul/sound";

/*
 * ?review=sfx — 효과음 후보 들어 보고 고르기 (일레븐랩스 후보 4개씩, 기본은 다듬기 스크립트가 "깨끗한" 것으로 고름)
 * 고른 번호는 이 브라우저에만 저장됨 → 마음에 드는 번호를 알려 주면 기본 파일로 바꿔 둠
 */
const WHERE: Record<SfxName, string> = {
  place: "자모 누르기",
  erase: "하나 지우기",
  discard: "전부 지우기 · 없는 자모",
  "sent-best": "정답!",
  "sent-good": "별해!",
  "sent-meh": "틀림",
  over: "포기",
  start: "퍼즐 열기",
  click: "버튼",
  open: "랭킹 · 힌트 열기",
  like: "👍 · 랭킹 올림",
  card: "자랑하기",
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
                {[1, 2, 3, 4].map((k) => (
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
