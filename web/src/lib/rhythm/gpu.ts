/**
 * 브라우저가 화면을 그래픽카드로 그리는지 (하드웨어 가속).
 * 가속이 꺼져 있으면 WebGL이 아예 없거나 SwiftShader·Basic Render 같은 소프트웨어 장치로 나옴 —
 * 그 상태에선 전체화면 캔버스를 CPU로 그려서 컴이 좋아도 프레임이 크게 떨어짐.
 */
export interface GpuInfo {
  /** 그래픽 장치 이름 (ANGLE 껍데기는 벗김) */
  name: string;
  /** 소프트웨어 렌더링(가속 꺼짐)으로 보임 */
  software: boolean;
}

let cached: GpuInfo | null = null;

export function gpuInfo(): GpuInfo {
  if (cached) return cached;
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    if (!gl) return (cached = { name: "WebGL 없음", software: true });
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const r = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    cached = {
      name: r.replace(/^ANGLE \((.*)\)$/, "$1"),
      software: /swiftshader|basic render|llvmpipe|softpipe|software/i.test(r),
    };
  } catch {
    cached = { name: "?", software: false };
  }
  return cached;
}

/** 지금 브라우저에서 그래픽 가속 설정을 여는 주소 */
export function accelSettingsUrl(): { browser: string; url: string } {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Edg\//.test(ua)) return { browser: "엣지", url: "edge://settings/system" };
  if (/Whale\//.test(ua)) return { browser: "웨일", url: "whale://settings/system" };
  if (/OPR\//.test(ua)) return { browser: "오페라", url: "opera://settings/system" };
  if (/Firefox\//.test(ua))
    return {
      browser: "파이어폭스",
      url: "about:preferences (성능 → 권장 성능 설정 끄고 가속 켜기)",
    };
  return { browser: "크롬", url: "chrome://settings/system" };
}
