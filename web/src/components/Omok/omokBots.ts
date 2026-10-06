import type { AIConfig } from "@/lib/omok/ai";
import type { Lines } from "@/lib/botTalk";

/**
 * 오목 AI 상대 (약한 순). 급수는 대략적인 체감 기준.
 * 대사 이벤트: userCheck = 내가 4·열린3을 만듦, aiCheck = AI가 4·열린3을 만듦,
 * userCapture = AI의 열린3·4를 내가 막음.
 */
export interface OmokBot {
  id: string;
  name: string;
  rank: string;
  desc: string;
  emoji: string;
  ai: AIConfig;
  lines: Lines;
}

export const OMOK_BOTS: OmokBot[] = [
  {
    id: "sprout",
    name: "오목 새싹",
    rank: "18급",
    desc: "다섯 개 놓으면 이기는 거 맞죠?",
    emoji: "🌱",
    ai: { depth: 1, ms: 300, noise: 3, blunder: 0.45, vcf: false, guard: false },
    lines: {
      greet: ["안녕하세요! 오목 오늘 처음 배웠어요 🌱", "다섯 개만 놓으면 되는 거죠? 해봐요!"],
      move: ["오, 거기 좋아 보여요", "음… 저는 어디 두지?", "돌이 반짝반짝하네요"],
      userCheck: ["어? 이거 막아야 되는 거예요?", "잠깐잠깐, 줄이 길어지는데요?!"],
      userCapture: ["앗, 막혔다!", "제 줄이 끊겼어요 😢"],
      aiCheck: ["어, 저 네 개 됐어요! 맞죠?", "이거 혹시 좋은 수예요?"],
      undo: ["괜찮아요, 저도 맨날 물러요"],
      aiWin: ["이겼어요?! 진짜로요?! 🎉"],
      aiLose: ["역시 어렵네요… 다시 배워 올게요 🌱"],
      draw: ["판이 꽉 찼어요! 비긴 거죠?"],
    },
  },
  {
    id: "kid",
    name: "동네 꼬마",
    rank: "15급",
    desc: "쉬는 시간마다 둬요",
    emoji: "🧒",
    ai: { depth: 1, ms: 300, noise: 1.5, blunder: 0.3, vcf: false, guard: false },
    lines: {
      greet: ["쉬는 시간 10분! 빨리 한 판 해요", "저 반에서 2등이에요 😎"],
      move: ["흠흠", "그 정도는 저도 알아요", "선생님 오시기 전에 끝내야 돼요"],
      userCheck: ["헉, 그거 반칙 아니에요?", "잠깐만요 생각 좀…"],
      userCapture: ["아 그걸 보셨어요?", "치사해요!"],
      aiCheck: ["네 개요! 막아 보세요~", "히히, 줄 만들었다"],
      undo: ["한 번만 봐드릴게요"],
      aiWin: ["이겼다! 내일 친구들한테 자랑해야지 😆"],
      aiLose: ["으앙 졌다… 한 판만 더요!"],
      draw: ["비겼으니까 무효예요 무효"],
    },
  },
  {
    id: "playground",
    name: "놀이터 고수",
    rank: "10급",
    desc: "열린 삼은 꼭 막아요",
    emoji: "🛝",
    ai: { depth: 2, ms: 400, noise: 0.8, blunder: 0.15, vcf: false, guard: false },
    lines: {
      greet: ["놀이터 평상에선 제가 제일 세요", "열린 삼 놔두면 바로 이겨요?"],
      move: ["그건 예상했어요", "음, 무난하네요", "모래 위에서 두던 실력 보여드릴게요"],
      userCheck: ["열린 삼이네요. 막을게요", "오, 제법인데요?"],
      userCapture: ["벌써 막혔네", "제 삼이…"],
      aiCheck: ["이번엔 제 차례예요. 막아 보세요", "열린 삼! 놓치면 끝이에요"],
      undo: ["놀이터 규칙상 한 번은 봐줘요"],
      aiWin: ["놀이터 챔피언 자리는 지켰다 🛝"],
      aiLose: ["놀이터 밖에도 고수가 있었네요"],
      draw: ["오늘은 무승부로 해요"],
    },
  },
  {
    id: "grandpa",
    name: "경로당 할아버지",
    rank: "6급",
    desc: "바둑판에 오목 둔 지 50년",
    emoji: "👴",
    ai: { depth: 2, ms: 500, noise: 0.3, blunder: 0.06, vcf: true, guard: false },
    lines: {
      greet: ["허허, 젊은이 한 판 둬 볼까", "내가 이 바둑판에 오목 둔 지 50년일세"],
      move: ["허허, 그렇게 두는구먼", "요즘 젊은이들은 수가 빨라", "음, 차나 한잔 하면서 두세"],
      userCheck: ["어이쿠, 이거 큰일 났구먼", "허허, 제법 매섭네"],
      userCapture: ["눈이 밝구먼", "에잉, 그걸 보다니"],
      aiCheck: ["사(四)일세. 막아 보게", "허허, 여기가 급소지"],
      undo: ["한 수 물러 주지. 대신 다음엔 없네"],
      aiWin: ["허허, 아직 녹슬지 않았구먼"],
      aiLose: ["허허허, 내가 졌네. 또 오게나 👴"],
      draw: ["판이 꽉 찼구먼. 오늘은 여기까지"],
    },
  },
  {
    id: "gunmo",
    name: "이건모",
    rank: "2급",
    desc: "이 사이트 만든 사람",
    emoji: "🧑‍💻",
    ai: { depth: 3, ms: 800, noise: 0.15, blunder: 0.02, vcf: true, guard: false },
    lines: {
      greet: ["제가 만든 오목에 오신 걸 환영해요 🧑‍💻", "AI는 제가 짰는데… 저보다 세면 어쩌죠"],
      move: ["오, 그 수는 테스트 케이스에 없었는데", "흠, 로그 찍어 봐야겠네요", "괜찮은 수네요"],
      userCheck: ["어… 이거 버그 아니죠?", "잠깐, 막아야겠다"],
      userCapture: ["핫픽스 당했네요", "그걸 막으시다니"],
      aiCheck: ["4 들어갑니다. 금수 아니에요 ㅎㅎ", "이거 막으면 다음 수도 있어요"],
      undo: ["무르기 기능도 제가 만들었어요. 쓰세요!"],
      aiWin: ["만든 사람 체면은 지켰네요 😅"],
      aiLose: ["와, 제 AI보다 세시네요. 랭킹 올려 주세요!"],
      draw: ["판이 꽉 찼네요. 이런 경우도 처리해 뒀죠"],
    },
  },
  {
    id: "pcbang",
    name: "PC방 오목왕",
    rank: "1단",
    desc: "온라인 오목 랭커 출신",
    emoji: "🎮",
    ai: { depth: 4, ms: 1100, noise: 0.05, blunder: 0, vcf: true, guard: true },
    lines: {
      greet: ["ㅎㅇ 한판 ㄱ", "랭겜 연승 중이라 봐드리진 않아요 🎮"],
      move: ["ㅇㅋ", "무난무난", "그 수 국룰이죠"],
      userCheck: ["오 좀 치시네", "ㄷㄷ 막아야겠다"],
      userCapture: ["아 그걸 읽네", "ㅂㄷㅂㄷ"],
      aiCheck: ["사삼 각 나왔다", "이거 VCF 들어갑니다"],
      undo: ["무르기는 매너 아닌데… 이번만요"],
      aiWin: ["ㅈㅈ ㄱㅅ요 🎮"],
      aiLose: ["ㄹㅇ 고수시네… ㅈㅈ"],
      draw: ["판 꽉 참 ㄷㄷ 무승부"],
    },
  },
  {
    id: "master",
    name: "오목 사범",
    rank: "3단",
    desc: "금수 함정도 노려요",
    emoji: "🥋",
    ai: { depth: 5, ms: 1600, noise: 0, blunder: 0, vcf: true, guard: true },
    lines: {
      greet: ["예(禮)로 시작합시다. 한 판 부탁드립니다 🥋", "오목은 수읽기입니다. 천천히 두세요"],
      move: ["좋은 수입니다", "그 수의 의도가 보입니다", "기본기가 탄탄하군요"],
      userCheck: ["날카롭군요. 받겠습니다", "좋은 공격입니다"],
      userCapture: ["잘 막았습니다", "수비가 단단하군요"],
      aiCheck: ["이제 제 공격입니다", "여기서부터 수가 이어집니다"],
      undo: ["배움에는 되돌아봄이 필요하지요"],
      aiWin: ["좋은 대국이었습니다. 복기해 보세요"],
      aiLose: ["제가 졌습니다. 훌륭합니다 🥋"],
      draw: ["승부를 가리지 못했군요. 다음을 기약하지요"],
    },
  },
  {
    id: "alpha",
    name: "알파오목",
    rank: "5단",
    desc: "자비 없는 계산 기계",
    emoji: "🤖",
    ai: { depth: 6, ms: 2200, noise: 0, blunder: 0, vcf: true, guard: true },
    lines: {
      greet: ["대국을 시작합니다. 승률 계산 중… 🤖", "인간의 수를 학습하겠습니다"],
      move: ["예측 범위 내의 수입니다", "흥미로운 선택입니다", "계산을 갱신합니다"],
      userCheck: ["위협 감지. 대응합니다", "예상보다 강한 수입니다"],
      userCapture: ["경로가 차단되었습니다", "변수가 추가되었습니다"],
      aiCheck: ["연속 위협을 시작합니다", "남은 수: 계산 완료"],
      undo: ["되돌리기를 허용합니다. 결과는 같을 것입니다"],
      aiWin: ["대국 종료. 좋은 데이터였습니다 🤖"],
      aiLose: ["…오류. 패배를 기록합니다. 당신은 강합니다"],
      draw: ["무승부. 판이 가득 찼습니다"],
    },
  },
];

export const DEFAULT_OMOK_BOT = "gunmo";

/** 랭킹 표시용: 봇 id → "알파오목(5단)" */
export function omokOppLabel(id: string) {
  const b = OMOK_BOTS.find((x) => x.id === id);
  return b ? `${b.name}(${b.rank})` : id;
}
