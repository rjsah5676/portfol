/**
 * 곡 이벤트를 OfflineAudioContext로 미리 렌더링 → AudioBuffer.
 * 실시간 합성 대신 미리 굽는 이유: 재생 중 끊김이 없고, 재생 위치가 오디오 시계와 정확히 일치해서
 * 판정 싱크가 흔들리지 않는다.
 *
 * 속도: 노드는 만들어 둔 순간부터 렌더링이 끝날 때까지 계속 처리 비용이 들어서, 곡 전체를 한 번에
 * 구우면 (노드 수 × 곡 길이)만큼 느려진다. 그래서 몇 마디씩 잘라 따로 굽고(뒤에 여운 포함) 더한다.
 * 필터도 악기별로 하나만 두고 공유한다.
 */
import type { MusicEvent, Song } from "./music";
import { pianoSample } from "./piano";

const SR = 44100;
/** 한 조각 길이(마디) */
const CHUNK_BARS = 4;
/** 조각 뒤로 더 굽는 여운(초): 패드 릴리즈·딜레이 꼬리 */
const TAIL = 2.4;

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

function makeNoise(ctx: BaseAudioContext) {
  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let seed = 12345;
  for (let i = 0; i < d.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    d[i] = (seed / 0x7fffffff) * 2 - 1;
  }
  return buf;
}

/** events를 t0 기준으로 len초 동안 굽기 */
export async function renderChunk(
  song: Song,
  events: MusicEvent[],
  t0: number,
  len: number
): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(len * SR), SR);
  const stepSec = 60 / song.bpm / 4;
  const noise = makeNoise(ctx);
  const chip = song.sound.lead === "square";
  const piano = song.sound.lead === "piano";
  // 밝은 톤(K-팝 밴드): 저음·디스토션을 줄이고 고역을 열어 가볍고 반짝이게
  const bright = !!song.sound.bright;

  const bus = ctx.createGain();
  bus.gain.value = 0.8;
  // 마스터: 살짝 눌러서(소프트 클립) 드럼이 커져도 안 깨지게
  const master = ctx.createWaveShaper();
  {
    const c = new Float32Array(2048);
    for (let i = 0; i < c.length; i++) {
      const x = (i / (c.length - 1)) * 2 - 1;
      c[i] = Math.tanh(x * 1.3) / Math.tanh(1.3);
    }
    master.curve = c;
    master.oversample = "2x";
  }
  bus.connect(master).connect(ctx.destination);
  // 드럼은 따로 모아서 곡마다 음량 조절
  const drumBus = ctx.createGain();
  drumBus.gain.value = song.sound.drums ?? 1;
  drumBus.connect(bus);
  // 사이드체인 펌핑: 킥마다 눌렸다가 올라오는 버스 (패드·아르페지오·베이스·기타가 지나감)
  const pump = ctx.createGain();
  pump.gain.value = 1;
  pump.connect(bus);
  const duck: AudioNode = song.sound.pump ? pump : bus;
  if (song.sound.pump)
    for (const e of events)
      if (e.kind === "kick" && e.vel >= 0.9) {
        const t = e.step * stepSec - t0;
        pump.gain.setValueAtTime(0.35, Math.max(0, t));
        pump.gain.linearRampToValueAtTime(1, t + stepSec * 2.6);
      }
  // 짧은 스테레오 잔향 (스네어·클랩·피아노 공간감)
  const ir = ctx.createBuffer(2, Math.floor(SR * 1.4), SR);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    let seed = 99 + c * 1000;
    for (let i = 0; i < d.length; i++) {
      seed = (seed * 16807) % 2147483647;
      const tt = i / SR;
      d[i] = ((seed / 2147483647) * 2 - 1) * Math.exp(-tt * 3.2) * (tt < 0.012 ? tt / 0.012 : 1);
    }
  }
  const verb = ctx.createConvolver();
  verb.buffer = ir;
  const verbOut = ctx.createGain();
  verbOut.gain.value = 0.12;
  verb.connect(verbOut).connect(bus);
  const snareVerb = ctx.createGain();
  snareVerb.gain.value = 0.5;
  snareVerb.connect(verb);

  // 리드·아르페지오용 스테레오 딜레이 (L 한 번, R 두 번 늦게)
  const send = ctx.createGain();
  const dl = ctx.createDelay(2);
  const dr = ctx.createDelay(2);
  dl.delayTime.value = stepSec * song.sound.delaySteps;
  dr.delayTime.value = stepSec * song.sound.delaySteps;
  const fb = ctx.createGain();
  fb.gain.value = 0.3;
  const wet = ctx.createGain();
  wet.gain.value = 0.22;
  const merger = ctx.createChannelMerger(2);
  send.connect(dl);
  dl.connect(fb).connect(dl);
  dl.connect(dr);
  dl.connect(merger, 0, 0);
  dr.connect(merger, 0, 1);
  merger.connect(wet).connect(bus);

  const filter = (type: BiquadFilterType, freq: number, q = 0.7, dest: AudioNode = bus) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    f.connect(dest);
    return f;
  };
  // 악기별 공유 필터
  const hatF = filter("highpass", 8000, 0.7, drumBus);
  const ohatF = filter("highpass", 7000, 0.7, drumBus);
  const snareF = filter("highpass", 1400, 0.7, drumBus);
  const clapF = filter("bandpass", 1500, 1.2, drumBus);
  const padF = filter("lowpass", bright ? 2800 : 1300, bright ? 0.7 : 1, duck);
  const arpF = filter("lowpass", 3200, 1, duck);
  const leadF = filter("lowpass", chip ? 5000 : 3400, 1);
  const bassF = filter("lowpass", bright ? 1400 : 850, bright ? 1.5 : 3, duck);
  const subF = filter("lowpass", 160, 0.7, duck);
  // 피아노 위에 얇게 겹치는 슈퍼쏘 (어두운 로우패스로 몸통만)
  const layerF = filter("lowpass", 2200, 0.8, duck);
  const riserF = filter("bandpass", 400, 1.4, bus);
  const arpSend = ctx.createGain();
  arpSend.gain.value = 0.35;
  arpF.connect(arpSend).connect(send);
  // 기타: 톱니파 → 디스토션(웨이브셰이퍼) → 캐비닛 느낌 로우패스
  // 디스토션은 음압이 확 커져서 멜로디 밑으로 깔리게 크게 줄임
  const gtrOut = ctx.createGain();
  gtrOut.gain.value = 0.26;
  gtrOut.connect(duck);
  const gtrF = filter("lowpass", bright ? 5200 : 3000, 0.8, gtrOut);
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 6) * 0.8;
  }
  shaper.curve = curve;
  shaper.oversample = "2x";
  const gtrIn = ctx.createGain();
  gtrIn.gain.value = bright ? 0.45 : 0.9;
  gtrIn.connect(shaper).connect(gtrF);
  const crashF = filter("highpass", 5000, 0.5, drumBus);
  const leadSend = ctx.createGain();
  leadSend.gain.value = 0.6;
  leadF.connect(leadSend).connect(send);
  // 리드 기타: 톱니 2개(살짝 어긋남) → 더 센 디스토션 → 로우패스, 딜레이로 공간감
  const leadGtrOut = ctx.createGain();
  leadGtrOut.gain.value = 0.2 * (song.sound.leadGain ?? 1);
  leadGtrOut.connect(bus);
  leadGtrOut.connect(leadSend);
  const leadGtrF = filter("lowpass", bright ? 6500 : 2600, bright ? 0.6 : 1.2, leadGtrOut);
  // 밝은 톤은 저음을 걷어내서 묵직함을 없앰
  const leadGtrHp = bright ? filter("highpass", 320, 0.7, leadGtrF) : leadGtrF;
  const leadShaper = ctx.createWaveShaper();
  {
    const c = new Float32Array(1024);
    for (let i = 0; i < c.length; i++) {
      const x = (i / (c.length - 1)) * 2 - 1;
      c[i] = Math.tanh(x * (bright ? 3.5 : 9)) * 0.75;
    }
    leadShaper.curve = c;
    leadShaper.oversample = "4x";
  }
  const leadGtrIn = ctx.createGain();
  leadGtrIn.gain.value = bright ? 0.9 : 1.2;
  leadGtrIn.connect(leadShaper).connect(leadGtrHp);
  // 반짝이 레이어: 리드 한 옥타브 위 삼각파 (밝은 톤일 때만)
  const sparkleF = filter("lowpass", 9000, 0.7, bus);
  const sparkleSend = ctx.createGain();
  sparkleSend.gain.value = 0.5;
  sparkleF.connect(sparkleSend).connect(send);

  const gainEnv = (
    t: number,
    peak: number,
    a: number,
    hold: number,
    rel: number,
    dest: AudioNode
  ) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setValueAtTime(peak, t + a + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + rel);
    g.connect(dest);
    return g;
  };
  const osc = (
    type: OscillatorType,
    freq: number,
    t: number,
    end: number,
    dest: AudioNode,
    detune = 0
  ) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    o.connect(dest);
    o.start(t);
    o.stop(end);
    return o;
  };
  const noiseHit = (t: number, v: number, dest: AudioNode, dur: number) => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const g = ctx.createGain();
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(g).connect(dest);
    s.start(t, (t * 7.3) % 0.5);
    s.stop(t + dur + 0.02);
  };
  const tone = (
    type: OscillatorType,
    midi: number,
    t: number,
    dur: number,
    peak: number,
    dest: AudioNode,
    { detune = 0, a = 0.008, rel = 0.08 } = {}
  ) => {
    const g = gainEnv(t, peak, a, Math.max(0, dur - a), rel, dest);
    const end = t + dur + rel + 0.05;
    if (detune) {
      osc(type, hz(midi), t, end, g, -detune);
      osc(type, hz(midi), t, end, g, detune);
    } else osc(type, hz(midi), t, end, g);
  };

  // ── 피아노 ──
  // 음 높이별로 미리 계산한 피아노 샘플(piano.ts)을 틀고, 건반을 뗄 때(또는 페달을 뗄 때) 댐퍼로 줄인다.
  let pianoIn: AudioNode = bus;
  if (piano) {
    const pIn = ctx.createGain();
    pIn.connect(bus);
    const pVerb = ctx.createGain();
    pVerb.gain.value = 0.8;
    pIn.connect(pVerb).connect(verb);
    pianoIn = pIn;
  }
  const barSec = stepSec * 16;
  /** off: 건반(또는 페달)을 떼는 시각 */
  const pianoNote = (midi: number, t: number, off: number, vel: number) => {
    const buf = pianoSample(midi);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = vel;
    let end = t + buf.duration;
    if (off < end) {
      g.gain.setValueAtTime(vel, off);
      g.gain.setTargetAtTime(0, off, 0.08);
      end = off + 0.6;
    }
    src.connect(g).connect(pianoIn);
    src.start(t);
    src.stop(end);
  };
  /** 페달 밟은 음은 그 마디 끝까지, 아니면 음 길이만큼(살짝 겹치게) */
  const pianoOff = (e: MusicEvent, t: number, dur: number) =>
    e.pedal ? (Math.floor(e.step / 16) + 1) * barSec - t0 - 0.02 : t + dur + 0.03;

  for (const e of events) {
    const t = e.step * stepSec - t0;
    const dur = e.len * stepSec;
    const v = e.vel;
    switch (e.kind) {
      case "kick": {
        // 몸통: 180→45Hz 빠른 피치 드롭 + 서브가 길게
        const o = ctx.createOscillator();
        o.frequency.setValueAtTime(180, t);
        o.frequency.exponentialRampToValueAtTime(45, t + 0.09);
        const g = ctx.createGain();
        g.gain.setValueAtTime(1.0 * v, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
        o.connect(g).connect(drumBus);
        o.start(t);
        o.stop(t + 0.52);
        // 어택: 2ms 클릭 (비터가 닿는 소리) — 작은 스피커에서도 킥이 들리게
        noiseHit(t, 0.35 * v, snareF, 0.012);
        break;
      }
      case "snare": {
        noiseHit(t, 0.7 * v, snareF, 0.19);
        noiseHit(t, 0.3 * v, snareVerb, 0.12);
        const o = ctx.createOscillator();
        o.type = "triangle";
        o.frequency.setValueAtTime(200, t);
        o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.48 * v, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
        o.connect(g).connect(drumBus);
        o.start(t);
        o.stop(t + 0.14);
        break;
      }
      case "clap":
        for (const d of [0, 0.011, 0.022]) noiseHit(t + d, 0.26 * v, clapF, 0.1 + d * 3);
        noiseHit(t + 0.022, 0.25 * v, snareVerb, 0.15);
        break;
      case "riser": {
        // 노이즈가 점점 커지며 밴드패스가 400Hz → 6kHz로 올라감
        const sr0 = ctx.createBufferSource();
        sr0.buffer = noise;
        sr0.loop = true;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.28, t + dur);
        g.gain.setValueAtTime(0.0001, t + dur + 0.01);
        riserF.frequency.setValueAtTime(400, t);
        riserF.frequency.exponentialRampToValueAtTime(6000, t + dur);
        sr0.connect(g).connect(riserF);
        sr0.start(t);
        sr0.stop(t + dur + 0.02);
        break;
      }
      case "hat":
        noiseHit(t, (bright ? 0.22 : 0.15) * v, hatF, 0.035);
        break;
      case "ohat":
        noiseHit(t, (bright ? 0.12 : 0.08) * v, ohatF, 0.22);
        break;
      case "bass":
        if (piano && !song.sound.layer) {
          pianoNote(e.midi!, t, pianoOff(e, t, dur), 0.16 * v);
          break;
        }
        // 톱니 베이스 + 서브 사인 (몸통)
        tone("sawtooth", e.midi!, t, dur * 0.85, 0.26 * v, bassF, { rel: 0.05 });
        tone("sine", e.midi!, t, dur * 0.9, (bright ? 0.12 : 0.3) * v, subF, { rel: 0.06 });
        break;
      case "pad":
        tone("sawtooth", e.midi!, t, dur, bright ? 0.045 : 0.035, padF, {
          detune: 9,
          a: 0.35,
          rel: 0.6,
        });
        break;
      case "arp":
        if (piano) {
          pianoNote(e.midi!, t, pianoOff(e, t, dur), 0.15 * v);
          break;
        }
        tone(
          song.sound.arp,
          e.midi!,
          t,
          Math.min(dur, stepSec) * 0.9,
          (chip ? 0.05 : 0.08) * v,
          arpF,
          {
            rel: 0.05,
          }
        );
        break;
      case "lead":
        if (piano) {
          pianoNote(e.midi!, t, pianoOff(e, t, dur), 0.8 * (song.sound.leadGain ?? 1));
          if (song.sound.layer && e.len >= 1) {
            // 슈퍼쏘를 얇게 겹쳐서 피아노에 전기 느낌 + 두께
            const g = gainEnv(t, 0.03, 0.012, Math.max(0, dur * 0.9 - 0.012), 0.1, layerF);
            const end = t + dur + 0.15;
            for (const d of [-12, 0, 12]) osc("sawtooth", hz(e.midi!), t, end, g, d);
          }
        } else if (song.sound.lead === "gtrlead") {
          // 피킹 어택 짧게, 음 길이만큼 유지 (디스토션이 서스테인을 길게 만듦)
          const g = gainEnv(t, 0.9, 0.004, Math.max(0, dur * 0.95 - 0.004), 0.06, leadGtrIn);
          const end = t + dur + 0.1;
          osc("sawtooth", hz(e.midi!), t, end, g, -6);
          osc("sawtooth", hz(e.midi!), t, end, g, 6);
          // 피킹 노이즈 (아주 짧게)
          noiseHit(t, 0.05, leadGtrIn, 0.012);
          if (bright)
            tone("triangle", e.midi! + 12, t, dur * 0.9, 0.05, sparkleF, { a: 0.006, rel: 0.08 });
        } else if (song.sound.lead === "supersaw") {
          // 톱니파 5개를 조금씩 어긋나게 겹쳐 두껍게 (애니송 리드)
          const g = gainEnv(
            t,
            0.078 * (song.sound.leadGain ?? 1),
            0.01,
            Math.max(0, dur * 0.95 - 0.01),
            0.14,
            leadF
          );
          const end = t + dur + 0.2;
          for (const d of [-16, -7, 0, 7, 16]) osc("sawtooth", hz(e.midi!), t, end, g, d);
          osc("square", hz(e.midi! - 12), t, end, g); // 한 옥타브 아래로 몸통
        } else
          tone(
            song.sound.lead as OscillatorType,
            e.midi!,
            t,
            dur * 0.95,
            (chip ? 0.09 : 0.11) * (song.sound.leadGain ?? 1),
            leadF,
            {
              detune: chip ? 0 : 7,
              rel: 0.12,
            }
          );
        break;
      case "gtr": {
        // 파워코드 (근음 + 5도 + 옥타브), chug는 짧게 끊어서 뮤트 느낌
        const short = e.len <= 2;
        const g = gainEnv(
          t,
          0.07 * v,
          0.004,
          short ? dur * 0.45 : dur * 0.92,
          short ? 0.04 : 0.2,
          gtrIn
        );
        const end = t + dur + 0.25;
        for (const iv of [0, 7, 12]) {
          osc("sawtooth", hz(e.midi! + iv), t, end, g, -5);
          osc("sawtooth", hz(e.midi! + iv), t, end, g, 5);
        }
        break;
      }
      case "crash":
        noiseHit(t, 0.16 * v, crashF, 1.4);
        break;
      case "tom": {
        const o = ctx.createOscillator();
        const f0 = hz(e.midi!);
        o.frequency.setValueAtTime(f0 * 1.6, t);
        o.frequency.exponentialRampToValueAtTime(f0, t + 0.08);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.55 * v, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        o.connect(g).connect(drumBus);
        o.start(t);
        o.stop(t + 0.32);
        break;
      }
    }
  }
  return ctx.startRendering();
}

export async function renderSong(
  song: Song,
  onProgress?: (p: number) => void
): Promise<AudioBuffer> {
  const stepSec = 60 / song.bpm / 4;
  const chunkSteps = CHUNK_BARS * 16;
  const total = Math.ceil(song.duration * SR);
  const out = [new Float32Array(total), new Float32Array(total)];

  const jobs: (() => Promise<void>)[] = [];
  for (let s0 = 0; s0 < song.bars * 16; s0 += chunkSteps) {
    const evs = song.events.filter((e) => e.step >= s0 && e.step < s0 + chunkSteps);
    if (!evs.length) continue;
    const t0 = s0 * stepSec;
    const len = Math.min(chunkSteps * stepSec + TAIL, song.duration - t0);
    jobs.push(async () => {
      const buf = await renderChunk(song, evs, t0, len);
      const at = Math.round(t0 * SR);
      for (let c = 0; c < 2; c++) {
        const d = buf.getChannelData(c);
        const o = out[c];
        const n = Math.min(d.length, total - at);
        for (let i = 0; i < n; i++) o[at + i] += d[i];
      }
    });
  }
  // 동시에 몇 개씩 (렌더링 스레드가 여러 개라 병렬로 빨라짐)
  let done = 0;
  const queue = [...jobs];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      await job();
      onProgress?.(++done / jobs.length);
    }
  };
  await Promise.all([worker(), worker(), worker()]);

  // 피크 정규화 + 부드러운 클리핑으로 음량 끌어올리기
  let peak = 0;
  for (const d of out) for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  const drive = 1.6;
  const norm = Math.tanh(drive);
  const k = peak > 0 ? 1 / peak : 1;
  const result = new AudioBuffer({ numberOfChannels: 2, length: total, sampleRate: SR });
  out.forEach((d, c) => {
    for (let i = 0; i < d.length; i++) d[i] = (Math.tanh(d[i] * k * drive) / norm) * 0.9;
    result.copyToChannel(d, c);
  });
  return result;
}
