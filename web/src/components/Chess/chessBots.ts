/**
 * 체스 AI 상대 (Stockfish 19 lite, 브라우저 워커).
 * 레이팅은 대략적인 체감 기준:
 *  - 1600 이상: Stockfish 공식 실력 제한(UCI_LimitStrength + UCI_Elo)
 *  - 1200 이하: Stockfish 최저 실력(Skill Level 0, 얕은 탐색)에 일정 확률로 아무 수나 두게 섞어서 낮춤
 *    (Stockfish의 Elo 제한은 1320이 최저라 그 아래는 이렇게 흉내냄)
 */
import type { Lines } from "@/lib/botTalk";

export interface ChessBot {
  rating: number;
  name: string;
  desc: string;
  emoji: string;
  /** UCI_Elo 제한 (없으면 Skill Level 0) */
  elo?: number;
  /** 생각 시간(ms) 또는 깊이 */
  movetime?: number;
  depth?: number;
  /** 이 확률로 탐색 대신 아무 합법수 */
  random: number;
  lines: Lines;
}

export const CHESS_BOTS: ChessBot[] = [
  {
    rating: 400,
    name: "체린이",
    desc: "규칙을 막 배웠어요",
    emoji: "🐣",
    depth: 1,
    random: 0.7,
    lines: {
      greet: ["안녕하세요! 저 체스 어제 배웠어요 😆", "말은 어떻게 움직이더라… 아 맞다!"],
      move: ["우와 그렇게도 둬요?", "헉 뭔가 멋있어요", "음… 잘 모르겠지만 좋아 보여요!"],
      userCapture: ["어?! 제 말 어디 갔어요?", "앗 그거 잡히는 거였어요?"],
      userBigCapture: ["으앙 제 제일 센 말이…", "그거 퀸이었는데요?! 😭"],
      userCheck: ["체크가 뭐였더라… 왕을 피하면 되죠?", "헉 왕이 위험해요!"],
      aiCapture: ["오! 제가 잡았어요!! 🎉", "냠냠 맛있다"],
      aiCheck: ["체크! 맞죠? 이거 체크 맞죠?"],
      undo: ["괜찮아요 저도 맨날 물러요 ㅎㅎ"],
      aiWin: ["제가 이겼어요?! 엄마한테 자랑해야지!"],
      aiLose: ["역시 어렵네요… 한 판 더 해요!", "다음엔 꼭 이길 거예요 🐥"],
      draw: ["비긴 거예요? 그럼 둘 다 이긴 거죠!"],
    },
  },
  {
    rating: 800,
    name: "폰 러버",
    desc: "폰이 제일 좋아요",
    emoji: "🧸",
    depth: 1,
    random: 0.35,
    lines: {
      greet: ["폰 여덟 개면 든든하죠. 잘 부탁해요!", "오늘도 폰으로 승부합니다 🧸"],
      move: ["오, 그 수 좋은데요?", "흠, 폰이 더 앞으로 가면 좋을 텐데", "괜찮은 수네요!"],
      userCapture: ["아 내 소중한 말…", "그건 좀 아프네요"],
      userBigCapture: ["으악! 제 큰 말을!", "그건 진짜 실수였어요…"],
      userCheck: ["앗 체크! 폰으로 막아야지", "왕님 피하세요!"],
      aiCapture: ["득템! 🧸", "공짜는 감사히 받을게요"],
      aiCheck: ["체크입니다~"],
      undo: ["한 번은 봐드릴게요!"],
      aiWin: ["폰의 힘을 보셨죠? 😎"],
      aiLose: ["폰만으론 부족했나 봐요… 잘 두시네요!"],
      draw: ["무승부! 사이좋게 반반 🧸"],
    },
  },
  {
    rating: 1200,
    name: "이건모",
    desc: "이 사이트 만든 사람",
    emoji: "🧑‍💻",
    depth: 3,
    random: 0.08,
    lines: {
      greet: [
        "제 사이트에 오신 걸 환영합니다. 한 판 하시죠!",
        "버그 없는 체스 보장합니다… 아마도요 😅",
      ],
      move: [
        "꽤 괜찮은 수군요",
        "음… 그 수는 예상 못 했네요",
        "좋아요, 그렇게 나오시겠다?",
        "코드 리뷰하듯 꼼꼼히 두시네요",
      ],
      userCapture: ["아, 그건 제 실수네요", "디버깅이 필요하겠군요…"],
      userBigCapture: ["그거 핫픽스 안 되나요? 😭", "이건 장애 보고서 감이네요"],
      userCheck: ["체크라… 예외 처리 들어갑니다", "잠깐, 이건 테스트 케이스에 없었는데요"],
      aiCapture: ["감사히 받겠습니다", "배포 완료 ✅"],
      aiCheck: ["체크! 예외 한번 던져봤습니다"],
      undo: ["롤백 승인합니다 👍"],
      aiWin: ["좋은 대국이었어요. 다음엔 더 잘 두실 거예요!", "테스트 통과! 🎉"],
      aiLose: [
        "제가 졌네요. 리팩터링 좀 하고 오겠습니다 😅",
        "잘 두시네요! 제 사이트에서 저를 이기다니",
      ],
      draw: ["무승부네요. 머지 컨플릭트 없이 깔끔하게!"],
    },
  },
  {
    rating: 1600,
    name: "기물 사냥꾼",
    desc: "공짜 기물은 안 놓쳐요",
    emoji: "🏹",
    elo: 1600,
    movetime: 500,
    random: 0,
    lines: {
      greet: ["사냥을 시작하지. 기물 관리 잘 하라고 🏹"],
      move: ["흠, 그 수는 나쁘지 않군", "냄새가 난다… 빈틈의 냄새", "조심하는군. 좋아"],
      userCapture: ["쳇, 한 마리 놓쳤군", "제법인데"],
      userBigCapture: ["내 사냥감이 나를 사냥하다니!", "크윽… 방심했다"],
      userCheck: ["덫을 놓았나? 피해주지"],
      aiCapture: ["사냥 성공 🏹", "그건 공짜였지"],
      aiCheck: ["체크. 도망쳐 보시지"],
      undo: ["이번만이다"],
      aiWin: ["좋은 사냥이었다"],
      aiLose: ["오늘은 내가 사냥감이었군… 인정하지"],
      draw: ["둘 다 빈손이군"],
    },
  },
  {
    rating: 2000,
    name: "체스 클럽 회장",
    desc: "전술이 날카로워요",
    emoji: "🎩",
    elo: 2000,
    movetime: 800,
    random: 0,
    lines: {
      greet: ["체스 클럽에 오신 걸 환영합니다. 신사적으로 갑시다 🎩"],
      move: ["흥미로운 선택이군요", "교과서적인 수입니다", "오호, 그 수를 아시는군요"],
      userCapture: ["깔끔한 교환이군요", "좋은 시야입니다"],
      userBigCapture: ["…제가 졸았나 봅니다", "훌륭합니다. 클럽에 가입하시죠"],
      userCheck: ["좋은 체크입니다. 하지만 아직이에요"],
      aiCapture: ["전술은 피할 수 없는 법이죠", "실례하겠습니다"],
      aiCheck: ["체크. 자세를 가다듬으시죠"],
      undo: ["친선 대국이니 허락하지요"],
      aiWin: ["좋은 대국이었습니다. 복기는 언제든 환영이에요"],
      aiLose: ["놀랍군요. 회장 자리를 넘겨야 할지도…"],
      draw: ["신사적인 무승부군요 🤝"],
    },
  },
  {
    rating: 2400,
    name: "그랜드마스터",
    desc: "자비가 없어요",
    emoji: "👑",
    elo: 2400,
    movetime: 1200,
    random: 0,
    lines: {
      greet: ["…시작하지.", "도전은 언제나 환영이다 👑"],
      move: ["예상한 수다", "흠.", "나쁘지 않다"],
      userCapture: ["계산된 희생이다", "…그건 미끼였다"],
      userBigCapture: ["……", "인정하지. 좋은 수다"],
      userCheck: ["체크는 승리가 아니다"],
      aiCapture: ["당연한 결과다"],
      aiCheck: ["체크."],
      undo: ["무르기는 실력이 아니다. …이번만이다"],
      aiWin: ["좋은 시도였다. 더 강해져서 와라"],
      aiLose: ["…훌륭하다. 그대가 진정한 그랜드마스터다 👑"],
      draw: ["무승부라… 쉽지 않은 상대군"],
    },
  },
];

/** 랭킹 표시용: "1600" → "기물 사냥꾼(1600)" */
export function chessOppLabel(rating: string) {
  const b = CHESS_BOTS.find((x) => String(x.rating) === rating);
  return b ? `${b.name}(${b.rating})` : rating;
}
