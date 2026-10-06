let last = 0;
/**
 * 서버를 다시 띄워도 계속 커지는 번호.
 * 목록 스냅샷에 붙여서, 늦게 도착한 옛 스냅샷이 새 것을 덮어쓰지 않게 클라이언트가 비교함.
 */
export function stamp(): number {
  last = Math.max(last + 1, Date.now() * 1000);
  return last;
}
