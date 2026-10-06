"use client";

import { useEffect, useRef, useState } from "react";
import { useNick } from "@/lib/AuthContext";

export type AutoRankState = "idle" | "sending" | "done" | "error";

/**
 * 회원은 이름을 묻지 않고 기록을 자동으로 등록함.
 * ready 가 true 가 되면(게임이 끝나 기록이 나옴) 별명으로 submit 을 한 번 부름. ready 가 다시 false 가 되면 다음 판을 기다림.
 * 비회원이면 아무것도 하지 않음 (member = false → 화면에서 예전처럼 이름을 입력받음).
 */
export function useAutoRank(ready: boolean, submit: (nick: string) => Promise<unknown>) {
  const nick = useNick();
  const [state, setState] = useState<AutoRankState>("idle");
  const sent = useRef(false);
  const fn = useRef(submit);
  useEffect(() => {
    fn.current = submit;
  });
  useEffect(() => {
    if (!ready) {
      sent.current = false;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 새 판을 시작하면 상태 초기화
      setState("idle");
      return;
    }
    if (!nick || sent.current) return;
    sent.current = true;
    setState("sending");
    fn.current(nick).then(
      () => setState("done"),
      () => setState("error")
    );
  }, [ready, nick]);
  return { member: !!nick, state };
}
