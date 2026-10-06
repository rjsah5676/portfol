// 비밀번호 방 공통 유틸 (체스·스케치 퀴즈)
// 비밀번호는 평문으로 저장하지 않고 방 id와 섞어 SHA-256 해시로만 저장·비교.
// 해시는 아무도 읽을 수 없는 곳에 두고, 규칙(Firestore/RTDB)이 입력값과 비교만 함.

export async function hashPassword(roomId: string, pw: string): Promise<string> {
  const data = new TextEncoder().encode(`${roomId}:${pw}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 초대 링크용 키 (링크로 들어오면 비밀번호 없이 입장) */
export const randomKey = () =>
  [...crypto.getRandomValues(new Uint8Array(12))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

export class WrongPasswordError extends Error {
  constructor() {
    super("비밀번호가 맞지 않습니다.");
  }
}
