import $ from "jquery";

declare global {
  interface Window {
    $: JQueryStatic;
    jQuery: JQueryStatic;
  }
}

// jquery-ui-dist는 ESM import가 아니라 전역 window.jQuery가 이미 있다고 가정하는
// 구식 플러그인 스크립트라서, jquery-ui를 import하기 전에 전역으로 노출해줘야 함.
if (typeof window !== "undefined") {
  window.$ = $;
  window.jQuery = $;
}

export default $;
