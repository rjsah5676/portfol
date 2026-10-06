/**
 * 모달·시트가 열려 있는 동안 뒤 페이지 스크롤 잠금 (여러 개가 겹쳐도 마지막 하나가 닫힐 때 풀림).
 * 이 사이트는 html이 스크롤을 가져서(overflow-x: clip) body에만 overflow:hidden을 주면 안 먹음 → html에 줌.
 * body를 position:fixed로 고정하는 방식은 열려 있는 동안 scrollY가 0이 돼서, 모달이 쌓은 히스토리를
 * 뒤로가기로 소비할 때 브라우저가 0으로 스크롤을 복원해 버려서(맨 위로 튐) 쓰지 않음.
 * 배경에서 시작한 터치 스크롤은 모달 쪽에서 touch-action: none으로 막음.
 */
let count = 0;
let saved = { html: "", body: "" };

export function lockScroll(): () => void {
  if (typeof document === "undefined") return () => {};
  if (count++ === 0) {
    const h = document.documentElement.style;
    const b = document.body.style;
    saved = { html: h.overflow, body: b.overflow };
    h.overflow = "hidden";
    b.overflow = "hidden";
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--count > 0) return;
    document.documentElement.style.overflow = saved.html;
    document.body.style.overflow = saved.body;
  };
}
