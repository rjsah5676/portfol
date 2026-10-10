/*
 * 게임 소리 크기 기준 (2026-10-11 측정)
 *
 * 기본 설정 그대로 실제 브라우저에서 나가는 소리를 녹음해서 잼 — 통합 음량(LUFS), 0.4초 창 최대 RMS(짧게 튀는 소리), 실제 최대(dBTP).
 *   게임         통합    0.4초 최대  최대     크게 들리던 쪽
 *   포커        -17.6     -9.9      +2.6    효과음·음성 (칩·징글이 0 dBFS 로 겹쳐 찢어짐)
 *   스케치 퀴즈  -14.6    -10.0      +0.3    징글·진행 음성 (-11 LUFS 로 배경음악보다 15 dB 큼)
 *   격투        -16.5    -13.6      -1.3    효과음 (압축기를 거쳐 단단하고 큼)
 *   BEAT DASH  -17.5    -16.2      -1.4    곡 (곡마다 -7.6 ~ -14.5 LUFS 로 7 dB 차이)
 *   지뢰찾기    -14 ~ -22 -14.1     +0.1    칸 여는 소리 · 폭발(찢어짐)
 *   멜론 게임   -23.7    -25.9      -7.9    (괜찮음)
 *   스케치 로비 -26.4    -26.0     -11.7    (괜찮음)
 *   체스·장기·오목 착수음 -31 ~ -42 dBFS     (작음 — 그대로)
 *
 * 2차(같은 날): 1차 적용 뒤에도 크다고 해서 전체 -6 dB 추가 → 목표 통합 약 -27 LUFS.
 * 기준점: "헤드셋에서 포커를 5·5·5 로 두면 들을 만하다" → 그때 측정값이 통합 -20.4 LUFS.
 * 목표: 게임 중 통합 약 -21 LUFS, 짧게 튀는 소리(0.4초) -14 dBFS 아래, 최대는 리미터로 -1 dBFS 아래 (안 찢어지게).
 *
 * 슬라이더 값은 그대로 두고 그 뒤에 곱함 → 이미 저장해 둔 설정도 같은 비율로 작아짐 (슬라이더 끝까지 올리면 예전보다 작게 들릴 수 있음).
 */

export const dbGain = (db: number) => 10 ** (db / 20);

/** 전체를 한 번 더 낮추는 값 (2026-10-11 2차: "배포 서버랑 큰 차이 없음" → 전부 -6 dB 추가) */
export const MASTER_DB = -6;
const lv = (db: number) => dbGain(db + MASTER_DB);

/** 게임별 보정 (곱하는 값) — 모두 MASTER_DB 포함 */
export const LEVEL = {
  /** 따로 보정이 없는 소리(멜론 · 격투 배경음악 · 지뢰찾기 끝 음악 등)에 곱하는 값 */
  master: lv(0),
  poker: { sfx: lv(-6), voice: lv(0), bgm: lv(-1) },
  sketch: { sfx: lv(-11), bgm: lv(0) },
  /** 격투 효과음 (배경음악은 master) */
  fight: { sfx: lv(-7) },
  /** 지뢰찾기 합성음 (lib/sfx.ts 의 깃발 · 칸 열기 · 폭발) */
  mine: lv(-7),
  rhythm: {
    /** 곡은 곡마다 크기를 재서 이 크기로 맞춤 (음악 슬라이더 100% 기준) */
    musicLufs: -21 + MASTER_DB,
    /** 메뉴 배경음악 (곡 고르기 전 화면) */
    menuLufs: -25 + MASTER_DB,
    /** 효과음 (콤보 · 실패 · 카운트다운 등) · 타격음 */
    sfx: lv(-4),
    hit: lv(-4),
  },
} as const;

/**
 * 들어 있는 소리의 대략적인 통합 음량 (LUFS 근사).
 * BS.1770 의 게이트(절대 -70, 상대 -10)는 그대로 쓰고 K-가중 필터만 뺌 — 사이트 곡 18개로 재 보면 실제 LUFS 와 ±1.3 dB 안.
 * 내 음악처럼 미리 잴 수 없는 곡도 같은 식으로 맞추려고 브라우저에서 계산함 (몇 분짜리 곡도 수십 ms).
 */
const loudnessCache = new WeakMap<AudioBuffer, number>();
export function measureLufs(buf: AudioBuffer): number {
  const hit = loudnessCache.get(buf);
  if (hit !== undefined) return hit;
  const sr = buf.sampleRate;
  const step = Math.max(1, Math.round(sr * 0.1)); // 0.1초 칸
  const n = Math.floor(buf.length / step);
  const sums = new Float64Array(n);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let k = 0; k < n; k++) {
      let s = 0;
      const end = (k + 1) * step;
      for (let i = k * step; i < end; i++) s += d[i] * d[i];
      sums[k] += s;
    }
  }
  // 0.4초 창(0.1초씩 겹침)의 채널 합 평균 제곱
  const blocks: number[] = [];
  for (let k = 0; k + 4 <= n; k++) blocks.push((sums[k] + sums[k + 1] + sums[k + 2] + sums[k + 3]) / (step * 4));
  const lufs = (ms: number) => -0.691 + 10 * Math.log10(ms + 1e-20);
  const loud = blocks.filter((ms) => lufs(ms) > -70);
  if (!loud.length) return -70;
  const rel = lufs(loud.reduce((a, b) => a + b, 0) / loud.length) - 10;
  const gated = loud.filter((ms) => lufs(ms) > rel);
  const out = lufs(gated.reduce((a, b) => a + b, 0) / gated.length);
  loudnessCache.set(buf, out);
  return out;
}

/** 이 소리를 목표 크기(LUFS)에 맞추는 배수 — 원래 작은 곡을 키우지는 않음(최대 1배, 찢어지지 않게) */
export function fitGain(buf: AudioBuffer, targetLufs: number): number {
  return Math.min(1, dbGain(targetLufs - measureLufs(buf)));
}

/**
 * 겹친 소리가 찢어지지 않게 마지막에 거는 리미터 (-3 dB 위는 강하게 눌러 최대 약 -1 dBFS).
 * Web Audio 압축기는 스스로 "메이크업 게인"을 더해서(이 설정이면 약 +1.7 dB) 그만큼 다시 빼 줌 — 전체가 커지지 않게.
 * 돌려주는 노드로 연결하면 됨 (컨텍스트마다 하나).
 */
const limiters = new WeakMap<BaseAudioContext, AudioNode>();
export function limiter(ctx: BaseAudioContext): AudioNode {
  const hit = limiters.get(ctx);
  if (hit) return hit;
  const c = ctx.createDynamicsCompressor();
  c.threshold.value = -3;
  c.knee.value = 2;
  c.ratio.value = 20;
  c.attack.value = 0.002;
  c.release.value = 0.15;
  const trim = ctx.createGain();
  trim.gain.value = dbGain(-1.7);
  c.connect(trim).connect(ctx.destination);
  limiters.set(ctx, c);
  return c;
}
