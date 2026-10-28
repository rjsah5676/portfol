/**
 * 야구 로딩 화면(GameLoader)에 넘길 할 일 — M1 은 격투게임 그림(얼굴 · 컷인)과 글꼴만.
 * 새 그림 · 소리를 넣으면 여기에도 추가할 것.
 */
import { CHARS, FAMILY, GIVEN, artUrl, cutinUrl, faceUrl, hasSwingArt, swingArtUrl } from "@/lib/baseball/data";
import { keyed, type LoadTask } from "@/lib/preload";

const FONTS = ['16px "Black Han Sans"', '16px "Jua"', '700 16px "JetBrains Mono"', '800 16px "JetBrains Mono"', '700 16px "Nanum Gothic"', '800 16px "Nanum Gothic"'];
// 한글 웹폰트는 글자 묶음(unicode-range)으로 나눠 받아서, 처음 쓰는 글자가 나오면 그 묶음을 받는 동안 캔버스 글씨가 늦게 뜸
// (판은 먼저 뜨고 글씨가 늦게 옴) → 경기 화면에 나오는 글씨는 로딩 화면에서 미리 받아 둠
const MISSION_TEXT =
  "의 특별 미션! 성공 코인 호감 실패하면 돌발 마구/필살 감독 신뢰 누르면 바로 시작 주장 선배 안경 후배 " +
  "담장 넘겨 봐. 네 힘이면 돼. 장타 하나. 보여 줘. 주자 불러들여. 발로 만든 점수! 한 점만. 네가 해내는 거 보고 싶어. 안타 하나만. 나 보고 있어. " +
  "주자 불러들여! 한 점만 내 봐 여기서 한 방! 홈런 치면 보너스다 장타 하나 부탁해! 안타 하나만 쳐 줘! 이번 이닝 무실점으로 막아! 삼진으로 잡아! " +
  "아쉽지만 안타! 미션 성공! 미션 실패… 특수능력 발동! 끈질긴 승부 득점권 타격 파워 주루 7회~ 2스트라이크 회초 회말 오늘 타수 안타 시즌 타점 투구 수 제구 변화 체력 좌타 우타 좌투 우투 빠름 늦음 투수 교체";
const FONT_TEXT = "픽셀 프로야구 나만의 리그 훈련 휴식 외출 상점 은퇴 스트라이크 볼 파울 헛스윙 삼진 안타 홈런 2루타 3루타 아웃 득점 0123456789 km/h 마구 필살타법 미션 " + MISSION_TEXT + " " + CHARS.map((c) => `${c.name} ${c.swing.name}`).join(" ") + " 공이 날아올 때 K! 필살타법을 다 썼어요! 결승타 역전타 끝내기 병살 미션은 없던 걸로 (칠 공이 없었음) " + FAMILY.join("") + GIVEN.join("");
const fontsTask = keyed("baseball:fonts", () =>
  typeof document === "undefined" || !document.fonts
    ? Promise.resolve()
    : Promise.all(FONTS.map((f) => document.fonts.load(f, FONT_TEXT).catch(() => null)))
);

export function baseballTasks(): LoadTask[] {
  const t: LoadTask[] = [];
  for (const c of CHARS) {
    t.push(faceUrl(c.id), cutinUrl(c.id), artUrl(c.id));
    if (hasSwingArt(c.id)) t.push(swingArtUrl(c.id));
  }
  t.push("/baseball/stadium/bat-low.webp", "/baseball/sprites/batter-idle.webp", "/baseball/sprites/batter-idle-mask.png", "/baseball/sprites/batter-load.webp", "/baseball/sprites/batter-swing.webp", "/baseball/sprites/batter-walkin.webp", "/baseball/sprites/pitcher-set.webp", "/baseball/sprites/pitcher-throw.webp");
  // 경기 화면 HUD · 수비수 · 타격 효과
  t.push("/baseball/sprites/fielder-if-ready.webp", "/baseball/sprites/fielder-of-ready.webp", "/baseball/sprites/runner-lead.webp", "/baseball/sprites/runner-hands.webp");
  for (const u of ["swing", "swing-down", "bunt", "pad", "knob", "burst", "ring", "homerun", "throw", "profile", "npc-manager", "npc-captain", "npc-senior", "npc-glasses", "npc-junior"]) t.push(`/baseball/ui/${u}.webp`);
  t.push(fontsTask);
  return t;
}
