import { rpc, subscribe } from "@/lib/api/socket";
import type { VsMsg, VsRoom } from "@/lib/hangul/versus";

/*
 * 니들이 한글을 알아? 대전 「말싸움」 — 서버(server/src/games/hangulVs.ts)와 주고받기
 * 방 상태는 구독(hgvs.room) 하나로 다 옴. 규칙은 lib/hangul/versus.ts
 */

export const createVs = (name: string) => rpc<string>("hgvs.create", { name });
export const joinVs = (id: string, name: string) => rpc("hgvs.join", { id, name });
export const botVs = (id: string, level: number) => rpc("hgvs.bot", { id, level });
export const startVs = (id: string) => rpc("hgvs.start", { id });
export const sentenceVs = (id: string, text: string) => rpc<VsMsg>("hgvs.sentence", { id, text });
export const loadVs = (id: string, load: number) => rpc("hgvs.load", { id, load });
export const voteVs = (id: string, msg: string) => rpc("hgvs.vote", { id, msg });
export const emoteVs = (id: string, e: string) => rpc("hgvs.emote", { id, e });
export const againVs = (id: string) => rpc("hgvs.again", { id });
export const leaveVs = (id: string) => rpc("hgvs.leave", { id }).catch(() => null);

export function watchVs(
  id: string,
  on: { room(r: VsRoom | null): void; emote?(uid: string, e: string): void; error?(): void }
) {
  return subscribe<VsRoom | null>(
    "hgvs.room",
    { id },
    {
      onSnapshot: on.room,
      onEvent(type, d) {
        if (type === "room") on.room(d as VsRoom | null);
        else if (type === "emote") {
          const { uid, e } = d as { uid: string; e: string };
          on.emote?.(uid, e);
        }
      },
      onError: () => on.error?.(),
    }
  );
}
