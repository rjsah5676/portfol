/*
 * 올인 러브 — 대본 (M1: 콜드 오픈 + 1주차 + 즉사형 엔딩 3개 + 반성회)
 * 스토리 문서: 프로젝트 claude/2026-10-23-poker-vn-story-v2.md
 *
 * 수치: affA/affY 호감 · trustA/trustY 신뢰 · tilt 틸트 · tip 팁 · ignoreA 읽씹 · dealFail 딜링 실패 · bossDeal 사장 제안 수락 · knowY 연서 블러프 간파
 * 딜브레이커 체크: 히로인 곁 다른 남자 X · 기습 과거 남자 X · 주인공 호구짓 X
 */
import type { Mood, Scenes, Step, Who } from "./types";

// ---- 작성 도우미 (결과는 순수 데이터) ----
const say = (who: Who, text: string, mood?: Mood): Step => ({ t: "say", who, text, ...(mood && { mood }) });
const N = (text: string): Step => say("narr", text);
const ME = (text: string, mood?: Mood): Step => say("me", text, mood);
const Y = (text: string, mood?: Mood): Step => say("yeonseo", text, mood);
const A = (text: string, mood?: Mood): Step => say("amy", text, mood);
const BOSS = (text: string, mood?: Mood): Step => say("boss", text, mood);
const TH = (text: string): Step => say("me", text, "think");

export const START = "open";

export const SCENES: Scenes = {
  // ================= 콜드 오픈 =================
  open: [
    { t: "bgm", id: "vip" },
    { t: "bg", id: "black" },
    N("새벽 네 시."),
    N("지하에는 창문이 없다. 그래서 여기서는 시간이 흐르지 않는다."),
    { t: "bg", id: "vip" },
    { t: "sfx", id: "chip" },
    N("초록 펠트 위에 칩이 산처럼 쌓여 있다. 내 앞에도, 맞은편에도."),
    BOSS("자, {name} 씨. 3년 만이죠? 그 손이 테이블 위에 올라온 게."),
    N("맞은편 남자가 웃는다. 늘 그렇듯, 아주 정중하게."),
    N("옆에서 누군가 숨죽여 울고 있다. 고개를 돌리면 안 된다. 지금 돌리면, 진다."),
    BOSS("그래서… 이 판에 뭘 걸 건데요?"),
    TH("나는 칩으로 손을 뻗었다."),
    { t: "bgm", id: null },
    { t: "bg", id: "black" },
    { t: "title", text: "4주 전", sub: "" },
    { t: "goto", to: "d1" },
  ],

  // ================= 1일차 =================
  d1: [
    { t: "day", day: 1, slot: "밤 근무" },
    { t: "bgm", id: "pub" },
    { t: "bg", id: "pub" },
    { t: "sfx", id: "shuffle" },
    N("성수동 골목 2층, 홀덤펍 「HOUSE」."),
    TH("앉지 않는다. 테이블 건너편에 서서 카드만 나눠 준다. 그게 내 유일한 규칙이다."),
    TH("3년 전까지 사람들은 나를 '손'이라고 불렀다. 지금은 그냥 신입 딜러 {name}이다."),
    { t: "show", who: "amy", pos: "c", dist: 0 },
    A("딜러 바뀌었네? …뭐, 손만 빠르면 상관없어."),
    N("금발 트윈테일이 의자에 털썩 앉는다. 칩을 쌓는 손이 거칠다. 아마추어다. 그것도 지는 쪽의."),
    A("올인! 이번엔 진짜거든!"),
    { t: "sfx", id: "chip" },
    TH("세븐 투 오프슈트. 홀덤에서 제일 나쁜 패로 올인이라니."),
    { t: "sfx", id: "deal" },
    N("리버에 상대의 풀하우스가 완성된다."),
    A("…뭐? 그게 왜 떠?! 그게 왜 거기서 떠냐고!", "shout"),
    {
      t: "choice",
      prompt: "칩을 쓸어 가며, 한마디?",
      opts: [
        { text: "\"세븐 투로 올인은… 용감했어요.\"", eff: { affA: 2 } },
        { text: "\"다음엔 이길 거예요. 아마.\"", eff: { affA: 1, trustA: 1 } },
        { text: "(아무 말 없이 칩만 정리한다)", eff: { affY: 1 } },
      ],
    },
    A("…흥. 딱히 위로해 달라고 한 적 없거든.", "normal"),
    A("다음 판에 다 복수할 거니까. 딜러 너, 도망가지 마."),
    { t: "hide", who: "amy" },
    N("그리고 구석 자리. 오늘 밤 한 번도 지지 않은 손님이 있다."),
    { t: "show", who: "yeonseo", pos: "c", dist: 0 },
    N("검은 머리, 무표정. 칩을 손가락 세 개로 쌓는 버릇. 한쪽 손에만 낀 검은 레이스 장갑."),
    TH("…프로다. 그것도 아주 오래된."),
    Y("딜러님."),
    Y("셔플할 때 엄지가 먼저 나가네요."),
    TH("심장이 한 박자 늦게 뛴다. 그건 내 옛날 버릇이다."),
    Y("예전에 그렇게 섞던 사람이 하나 있었는데. …아니에요. 수고하셨어요."),
    { t: "hide", who: "yeonseo" },
    TH("그녀는 칩을 바꾸지도 않고 나갔다. 오늘 딴 돈은, 전부 가게 돈이었다."),
    { t: "goto", to: "d2" },
  ],

  // ================= 2일차 — 딜링 튜토리얼 =================
  d2: [
    { t: "day", day: 2, slot: "밤 근무" },
    { t: "bg", id: "pub" },
    { t: "show", who: "amy", pos: "c", dist: 0 },
    A("딜러! 어제 그 딜러 맞지? 오늘은 내가 이길 거니까 카드 똑바로 줘."),
    TH("손이 굳지 않았는지, 오늘 확인해 보자."),
    { t: "mini", kind: "deal", key: "deal1" },
    { t: "when", cond: { v: "mini_deal1", op: "<=", n: 1 }, to: "d2_bad", else: "d2_good" },
  ],
  d2_bad: [
    { t: "set", eff: { dealFail: 1 } },
    A("손 느려! 딜러 바뀌었다더니 더 느린 사람 데려왔네?", "shout"),
    TH("…3년이 길긴 길었나 보다."),
    { t: "goto", to: "d2_end" },
  ],
  d2_good: [
    { t: "set", eff: { tip: 2, affA: 1 } },
    A("…뭐야. 좀 하네."),
    A("딱히 칭찬한 거 아니야. 그냥 사실을 말한 거지.", "normal"),
    { t: "goto", to: "d2_end" },
  ],
  d2_end: [
    N("그날 밤 에이미는 또 졌다. 이번엔 투페어로, 조금 덜 억울하게."),
    { t: "hide" },
    { t: "goto", to: "d3" },
  ],

  // ================= 3일차 =================
  d3: [
    { t: "day", day: 3, slot: "낮" },
    { t: "bgm", id: "night" },
    { t: "bg", id: "store" },
    N("동네 편의점. 계산대 앞에서 누가 동전을 세고 있다."),
    { t: "show", who: "amy", pos: "c", dist: 0 },
    A("…삼각김밥 1+1인데 하나 값만 있으면 되는 거 아니야? 왜 둘 다 찍혀?"),
    TH("어제 그 트윈테일이다. 펍 밖에서 보니 그냥 평범한 대학생 같다."),
    {
      t: "choice",
      opts: [
        { text: "\"제가 하나 살게요. 남는 거 주세요.\"", eff: { affA: 2, trustA: 1 } },
        { text: "\"1+1은 두 개 다 찍고 하나 값만 빠져요.\"", eff: { trustA: 1 } },
        { text: "(못 본 척 지나간다)", eff: { affA: -1 } },
      ],
    },
    A("어? 딜러? …아저씨, 여기 살아?"),
    ME("아저씨는 좀."),
    A("몇 살인데."),
    ME("스물일곱."),
    A("아저씨네."),
    N("그녀가 폰을 내민다. 화면에 메신저 QR 코드."),
    A("다음 판에 복수할 거라고 했지. 도망 못 가게 번호 줘."),
    A("…딱히 다른 뜻은 없거든! 연애 같은 거 해 본 적도 없고, 해 보고 싶지도 않으니까!", "shout"),
    TH("묻지도 않았는데."),
    { t: "hide" },
    { t: "day", day: 3, slot: "밤 근무" },
    { t: "bgm", id: "pub" },
    { t: "bg", id: "pub" },
    { t: "show", who: "yeonseo", pos: "c", dist: 0 },
    N("오늘도 그 구석 자리. 오늘도 이기는 중이다."),
    Y("딜러님, '손'이라는 사람 알아요?"),
    Y("3년 전에 이 바닥에서 제일 손이 빨랐대요. 어느 날 크게 지고 사라졌고."),
    {
      t: "choice",
      prompt: "그녀가 똑바로 본다.",
      opts: [
        { text: "\"모르는 사람이네요.\"", eff: { affY: 1 } },
        { text: "(대답 대신 카드를 돌린다)", eff: { trustY: 1 } },
        { text: "\"그쪽은 왜 매일 혼자 와요?\"", eff: { affY: 1, trustY: 1 }, to: "d3_ask" },
      ],
    },
    { t: "goto", to: "d3_y_end" },
  ],
  d3_ask: [
    Y("…빚이요."),
    Y("사장님한테 빚이 있어요. 그래서 가게 돈으로 앉아서, 손님 돈을 따요. 하우스 플레이어라고 하죠."),
    Y("사장님이랑은 그게 다예요. 빚 장부 들고 있는 사람. 그 이상은 없어요."),
    TH("묻지도 않은 것까지 선을 긋는다. 이 사람도 묻지도 않은 걸 말하는 타입이었나."),
    Y("딜러님도 아마 금방 알게 될 거예요. 이 가게가 어떤 곳인지."),
    { t: "goto", to: "d3_y_end" },
  ],
  d3_y_end: [
    { t: "hide" },
    {
      t: "phone",
      from: "amy",
      msgs: ["야", "오늘 펍 안 갔는데", "딜러 오늘도 출근함?", "…딱히 궁금한 건 아니고"],
      replies: [
        { text: "출근했어. 오늘은 왜 안 왔어?", eff: { affA: 1 } },
        { text: "안 와서 테이블이 조용하더라", eff: { affA: 2 } },
      ],
      ignore: { ignoreA: 1 },
    },
    { t: "goto", to: "d4" },
  ],

  // ================= 4일차 — 사장 첫 등장 =================
  d4: [
    { t: "day", day: 4, slot: "마감 후" },
    { t: "bg", id: "pub" },
    N("마감 후. 의자를 테이블 위에 올리고 있는데, 계단에서 구두 소리가 난다."),
    BOSS("고생 많아요, {name} 씨. 사장 백상현입니다."),
    N("마흔 중반쯤. 잘 다린 셔츠, 늘 웃는 얼굴. 웃는데 눈이 안 웃는 사람."),
    BOSS("손은 아직 기억하죠? 셔플할 때 엄지 먼저 나가는 거, 그대로던데."),
    TH("…알고 뽑은 거다."),
    BOSS("걱정 마요. 그냥 반가워서. 빚 갚는 데 도움 되는 일이 있으면 언제든 말해요. 이 가게엔 위층만 있는 게 아니라서."),
    N("사장이 바닥을 구두 끝으로 톡톡 두드린다. 지하. VIP룸."),
    { t: "show", who: "yeonseo", pos: "r", dist: 0 },
    N("바 카운터 끝에 연서가 서 있었다. 장갑 낀 손이 잔을 쥔 채 잠깐 떨렸다."),
    N("그녀는 아무 말 없이 계단을 내려갔다. 위가 아니라, 아래로."),
    { t: "hide" },
    {
      t: "phone",
      from: "amy",
      msgs: ["내일 낮에 시간 있어?", "아니 그냥 물어본 거야", "대학가에 인형뽑기 새로 생겼는데 혼자 가기 좀 그래서"],
      replies: [
        { text: "시간 돼. 몇 시?", eff: { affA: 2, amyDate: 1 } },
        { text: "내일은 일찍 출근해야 해서", eff: { affA: 0 } },
      ],
      ignore: { ignoreA: 1 },
    },
    { t: "goto", to: "d5" },
  ],

  // ================= 5일차 — 자유 슬롯 =================
  d5: [
    { t: "day", day: 5, slot: "낮" },
    { t: "bg", id: "room" },
    TH("출근 전까지 시간이 남는다."),
    {
      t: "free",
      prompt: "오늘 낮, 어디로 갈까?",
      opts: [
        { text: "대학가 오락실 — 에이미", to: "d5_amy" },
        { text: "일찍 출근 — 빈 펍", to: "d5_yeon" },
        { text: "원룸에서 쉰다", to: "d5_rest", eff: { tilt: -1 } },
      ],
    },
  ],
  d5_amy: [
    { t: "bgm", id: "night" },
    { t: "bg", id: "arcade" },
    { t: "show", who: "amy", pos: "c", dist: 0 },
    A("늦었어! …3분이지만. 3분도 늦은 거야."),
    N("인형뽑기 기계 앞. 그녀는 벌써 만 원을 넣은 얼굴이다."),
    A("이거 봐, 집게가 일부러 힘 빼는 거야. 완전 사기라고."),
    TH("사기는 아니다. 확률이다. …그리고 나는 확률을 읽는 게 직업이었다."),
    {
      t: "choice",
      opts: [
        { text: "\"비켜 봐. 한 번에 뽑아 줄게.\"", eff: { affA: 2, tilt: 1 } },
        { text: "\"집게 말고, 인형 머리 쪽을 노려.\" (가르쳐 준다)", eff: { affA: 1, trustA: 2 } },
      ],
    },
    { t: "sfx", id: "win" },
    { t: "dist", who: "amy", dist: 1 },
    A("뽑혔다! 뽑혔어!! 봤지? 봤지?!", "shout"),
    N("그녀가 하늘색 곰 인형을 끌어안고 폴짝 뛴다. 그러다 내 소매를 붙잡은 걸 깨닫고 얼굴이 새빨개진다."),
    A("…이건 딱히 기뻐서 그런 게 아니라, 원가 회수해서 그런 거거든.", "shake"),
    { t: "dist", who: "amy", dist: 0 },
    A("고, 고마워. …딜러."),
    { t: "set", eff: { amyDate: 1 } },
    { t: "hide" },
    { t: "goto", to: "d5_night" },
  ],
  d5_yeon: [
    { t: "bg", id: "pub" },
    N("오픈 두 시간 전. 불 꺼진 펍에서 카드 섞는 소리가 난다."),
    { t: "show", who: "yeonseo", pos: "c", dist: 0 },
    N("연서가 혼자, 빈 테이블에서 셔플을 연습하고 있다."),
    Y("…일찍 왔네요."),
    Y("딜러님. 한 번만 섞어 볼래요? 제 앞에서."),
    {
      t: "choice",
      prompt: "3년 만에, 누군가를 위해 카드를 섞는다면.",
      opts: [
        { text: "카드를 받아 제대로 섞는다", eff: { affY: 2, trustY: 1, tilt: 1 } },
        { text: "\"딜러는 손님 앞에서만 섞어요.\"", eff: { affY: 1 } },
      ],
    },
    { t: "dist", who: "yeonseo", dist: 1 },
    N("카드가 테이블 위에서 물처럼 흘렀다. 연서가 아주 조금, 숨을 멈췄다."),
    Y("…역시."),
    N("그녀가 장갑 낀 손으로 카드 한 장을 집는다. 하트 에이스."),
    Y("저 이 손, 다쳤었어요. 카드를 너무 꽉 쥐어서. 그래서 장갑 껴요.", "whisper"),
    Y("…왜 이런 얘길 하는지 모르겠네요. 잊어요."),
    { t: "dist", who: "yeonseo", dist: 0 },
    { t: "set", eff: { yeonGlove: 1 } },
    { t: "hide" },
    { t: "goto", to: "d5_night" },
  ],
  d5_rest: [
    TH("천장을 본다. 3년 전 그날 밤이 또 떠오른다."),
    TH("칩 소리. 웃는 얼굴. 그리고 내 손에서 빠져나가던 모든 것."),
    TH("…앉지 않는다. 그거면 된다."),
    { t: "goto", to: "d5_night" },
  ],
  d5_night: [
    { t: "day", day: 5, slot: "밤 근무" },
    { t: "bgm", id: "pub" },
    { t: "bg", id: "pub" },
    N("평범한 밤이었다. 에이미는 지고, 연서는 이기고, 사장은 웃었다."),
    { t: "when", cond: { v: "amyDate", op: ">=", n: 1 }, to: "d6" },
    {
      t: "phone",
      from: "amy",
      msgs: ["오늘 혼자 인형뽑기 했는데 만 오천 원 날림", "…다 너 때문이야", "답장 안 할 거면 읽지도 마"],
      replies: [
        { text: "다음엔 같이 가자. 내가 뽑아 줄게", eff: { affA: 2 } },
        { text: "만 오천 원이면 선방했네", eff: { affA: 1 } },
      ],
      ignore: { ignoreA: 1 },
    },
    { t: "goto", to: "d6" },
  ],

  // ================= 6일차 — 에이미의 승리, 연서의 패배 =================
  d6: [
    { t: "when", cond: { v: "ignoreA", op: ">=", n: 3 }, to: "end_ghost" },
    { t: "day", day: 6, slot: "밤 근무" },
    { t: "bg", id: "pub" },
    TH("오늘은 테이블이 꽉 찼다. 손이 바빠진다."),
    { t: "mini", kind: "deal", key: "deal2" },
    { t: "when", cond: { v: "mini_deal2", op: "<=", n: 1 }, to: "d6_dealbad" },
    { t: "set", eff: { tip: 2 } },
    { t: "goto", to: "d6_main" },
  ],
  d6_dealbad: [
    { t: "set", eff: { dealFail: 1 } },
    { t: "when", cond: { v: "dealFail", op: ">=", n: 2 }, to: "end_fired" },
    TH("또 손이 꼬였다. 다음엔 정말 잘릴지도 모른다."),
    { t: "goto", to: "d6_main" },
  ],
  d6_main: [
    { t: "show", who: "amy", pos: "l", dist: 0 },
    A("플러시! 플러시라고! 봤어? 내가 이겼어!!", "shout"),
    { t: "sfx", id: "win" },
    N("에이미가 처음으로 큰 판을 가져갔다. 칩을 끌어안은 얼굴이 아이 같다."),
    { t: "show", who: "yeonseo", pos: "r", dist: 0 },
    N("그리고 같은 판에서, 연서가 처음으로 졌다."),
    TH("이상하다. 연서는 턴에서 이미 졌다는 걸 알았을 텐데, 리버까지 따라왔다."),
    { t: "hide", who: "amy" },
    { t: "show", who: "yeonseo", pos: "c", dist: 1 },
    ME("방금 그거, 일부러 진 거예요?"),
    {
      t: "mini",
      kind: "tell",
      key: "tellY1",
      tell: {
        who: "yeonseo",
        claim: "…아뇨. 그냥 진 거예요.",
        cues: [
          "대답하기 직전, 장갑 낀 손끝이 칩을 두 번 두드렸다.",
          "시선이 1초쯤 계단 쪽으로 갔다가 돌아왔다.",
          "목소리는 평소와 똑같이 평평하다.",
        ],
        truth: "bluff",
      },
    },
    { t: "when", cond: { v: "mini_tellY1", op: ">=", n: 1 }, to: "d6_read", else: "d6_miss" },
  ],
  d6_read: [
    { t: "set", eff: { knowY: 1, trustY: 1 } },
    TH("거짓말이다. 칩을 두 번 두드리는 건, 내가 아는 한 '보여 주기 위한 수'를 둘 때의 버릇이다."),
    TH("누구한테 보여 주려고? …계단 쪽. 지하에서 올라오는 계단."),
    {
      t: "choice",
      opts: [
        { text: "\"사장님 보라고 진 거죠.\"", eff: { trustY: 2, affY: 1 }, secret: true, cond: { v: "knowY", op: ">=", n: 1 } },
        { text: "(모른 척한다)", eff: { affY: 1 } },
      ],
    },
    Y("…딜러님은 눈이 너무 좋네요.", "whisper"),
    Y("그거, 이 가게에선 별로 좋은 거 아니에요."),
    { t: "goto", to: "d6_amy" },
  ],
  d6_miss: [
    TH("…모르겠다. 3년 쉬니 사람 읽는 눈도 녹슨 건가."),
    Y("그쪽이 신경 쓸 일 아니에요."),
    { t: "goto", to: "d6_amy" },
  ],
  d6_amy: [
    { t: "hide" },
    { t: "day", day: 6, slot: "마감 후" },
    { t: "show", who: "amy", pos: "c", dist: 0 },
    A("딜러! 오늘 내가 쏜다. 떡볶이. 이긴 사람이 쏘는 거야."),
    A("…딱히 너랑 먹고 싶어서가 아니라, 오늘 딜이 좀 괜찮았으니까 팁 같은 거지."),
    {
      t: "choice",
      opts: [
        { text: "\"좋아. 대신 맵기는 내가 고른다.\"", eff: { affA: 2 } },
        { text: "\"오늘은 피곤해서. 다음에 꼭.\"", eff: { affA: -1, trustA: 1 } },
      ],
    },
    N("포장마차 불빛 아래, 에이미가 처음으로 자기 얘기를 했다."),
    A("나 여기 오는 거, 아빠 때문이야. 아빠한테 포커 배웠거든."),
    A("…아빠는 지금 없어. 연락도 안 되고. 그래도 나는 아빠랑 달라. 나는 이기니까.", "whisper"),
    N("그녀가 목에 건 낡은 군번줄을 만지작거렸다."),
    { t: "hide" },
    { t: "goto", to: "d7" },
  ],

  // ================= 7일차 — 큰 결정 ① =================
  d7: [
    { t: "day", day: 7, slot: "밤 근무" },
    { t: "bg", id: "pub" },
    BOSS("{name} 씨, 잠깐."),
    N("영업 중에 사장이 내 옆에 와서 아주 낮게 말한다."),
    BOSS("그 금발 아가씨 있잖아요. 다음 주부터 그 손님 패, 신호 좀 줘요. 손가락 하나면 돼요."),
    BOSS("VIP 손님 모시려고 그래요. 그 아가씨 아버지도 예전에 우리 단골이었거든요."),
    TH("…아버지?"),
    {
      t: "choice",
      prompt: "사장이 웃으며 기다린다.",
      opts: [
        { text: "\"딜러는 패를 안 봅니다.\" (거절)", eff: { trustA: 1 } },
        { text: "\"생각해 볼게요.\"", eff: { tilt: 1 } },
        { text: "\"…빚에서 얼마나 빼 줄 건데요?\" (수락)", eff: { bossDeal: 1, tilt: 2 } },
      ],
    },
    BOSS("좋아요, 좋아. 천천히 생각해요. 우린 시간 많으니까."),
    { t: "day", day: 7, slot: "마감 후" },
    { t: "bgm", id: "night" },
    { t: "bg", id: "alley" },
    N("마감하고 나오니 비가 쏟아지고 있었다."),
    { t: "show", who: "amy", pos: "l", dist: 0 },
    N("차양 아래 계단에 에이미가 쪼그려 앉아 있다. 오늘은 크게 졌다. 술 냄새가 난다."),
    A("…집 가기 싫어. 아니, 집 가는 길 무서운 거 아니고. 그냥 비 맞기 싫은 거야."),
    { t: "show", who: "yeonseo", pos: "r", dist: 0 },
    N("건물 입구 쪽엔 연서가 서 있다. 우산은 하나. 누군가를 기다리는 것처럼."),
    Y("…딜러님. 우산, 하나밖에 없어서요."),
    {
      t: "choice",
      prompt: "비가 그칠 것 같지 않다.",
      opts: [
        { text: "에이미를 데려다준다", to: "r_amy" },
        { text: "연서의 우산 아래로 간다", to: "r_yeon" },
        { text: "둘 다 두고 혼자 뛰어간다", to: "r_none" },
      ],
    },
  ],

  r_amy: [
    { t: "hide", who: "yeonseo" },
    { t: "show", who: "amy", pos: "c", dist: 1 },
    N("재킷을 벗어 그녀 머리 위에 씌웠다. 에이미가 눈을 동그랗게 떴다."),
    A("…뭐야. 젖잖아, 너."),
    N("골목 끝까지 걷는 동안 그녀는 한마디도 안 했다. 대신 내 소매 끝을 꼭 쥐고 있었다."),
    { t: "dist", who: "amy", dist: 2 },
    A("…너 왜 이렇게 따뜻해.", "whisper"),
    { t: "end", text: "에이미 루트", sub: "2주차로 이어집니다 — M1 프로토는 여기까지" },
  ],
  r_yeon: [
    { t: "hide", who: "amy" },
    { t: "show", who: "yeonseo", pos: "c", dist: 1 },
    N("작은 우산 아래, 어깨가 닿을 만큼 가깝다. 장갑 낀 손이 손잡이를 쥔 내 손 바로 위에 있다."),
    Y("에이미 씨는 택시 불러 줬어요. 걱정 마요."),
    N("한참을 말없이 걷다가, 그녀가 아주 작게 말했다."),
    { t: "dist", who: "yeonseo", dist: 2 },
    Y("…사장님이 그쪽에 대해 알아보라고 했어요. 그래서 기다린 거예요.", "whisper"),
    Y("근데 지금은… 그냥 비 오니까요.", "bare"),
    { t: "end", text: "연서 루트", sub: "2주차로 이어집니다 — M1 프로토는 여기까지" },
  ],
  r_none: [
    { t: "hide" },
    N("빗속을 뛰었다. 뒤에서 누가 부르는 것 같았지만 돌아보지 않았다."),
    { t: "when", cond: { all: [{ v: "tilt", op: "<=", n: 0 }, { v: "bossDeal", op: "==", n: 0 }] }, to: "end_plain" },
    { t: "end", text: "공통 루트 계속", sub: "2주차 중반에 다시 기회가 옵니다 — M1 프로토는 여기까지" },
  ],

  // ================= 즉사형 엔딩 =================
  end_fired: [
    { t: "hide" },
    BOSS("{name} 씨. 손이 많이 굳었네요. 아쉽지만 오늘까지만 나와요."),
    N("전설의 손은, 수습 딱지도 못 떼고 앞치마를 반납했다."),
    { t: "ending", id: "fired" },
  ],
  end_ghost: [
    { t: "hide" },
    { t: "bg", id: "pub" },
    N("그 뒤로 에이미는 펍에 오지 않았다."),
    N("마지막으로 온 메시지는 하나였다. \"됐어. 딜러도 다 똑같네.\""),
    TH("나중에 들은 얘기로는, 그녀가 지하 계단을 내려가는 걸 본 사람이 있다고 했다."),
    { t: "ending", id: "ghost" },
  ],
  end_plain: [
    { t: "bg", id: "room" },
    N("그 뒤로도 나는 성실하게 카드를 나눠 줬다."),
    N("에이미는 가끔 왔고, 연서는 어느 날부터 안 보였다. 사장은 여전히 웃었다."),
    TH("아무 일도 일어나지 않았다. 아무 일도."),
    { t: "ending", id: "plain" },
  ],

  // ================= 마감 후 반성회 (배드 엔딩 힌트) =================
  rev_fired: [
    { t: "bg", id: "pub" },
    say("taeyang", "ㅋㅋㅋ 형 손 굳었다고 잘림? 전설의 손이라며~"),
    say("jeongmin", "딜링은 타이밍입니다. 불빛이 빛나는 자리에 맞춰 누르세요. 두 번 연속 망하면 끝입니다."),
    say("taeyang", "다음 회차엔 손 좀 풀고 와라~"),
    { t: "goto", to: "__title" },
  ],
  rev_ghost: [
    { t: "bg", id: "pub" },
    say("taeyang", "와 형 에이미 메시지 세 번 씹음? 그건 좀;;"),
    say("jeongmin", "메시지는 답장만 해도 됩니다. 츤데레의 \"딱히\"는 \"답장해\"라는 뜻이죠. 통계적으로."),
    { t: "goto", to: "__title" },
  ],
  rev_plain: [
    { t: "bg", id: "pub" },
    say("jeongmin", "아무도 고르지 않고, 사장 제안도 거절하고, 손도 쓰지 않으면… 평화롭습니다. 그리고 아무것도 없죠."),
    say("taeyang", "형, 미연시에서 혼자 뛰어가는 건 반칙이지 ㅋㅋ"),
    { t: "goto", to: "__title" },
  ],
};
