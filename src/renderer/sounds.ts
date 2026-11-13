// 用 Web Audio 现合成的几个音效,不需要音频文件。

let ctx: AudioContext | null = null;
let muted = false;

export const setMuted = (value: boolean) => (muted = value);

function audio() {
  if (muted) return null;
  ctx ??= new AudioContext();
  return ctx;
}

/** 一段白噪声,经过滤波和音量包络 */
function noise(duration: number, filter: (ac: AudioContext) => BiquadFilterNode, peak: number, attack: number) {
  const ac = audio();
  if (!ac) return;
  const buffer = ac.createBuffer(1, Math.ceil(ac.sampleRate * duration), ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const source = ac.createBufferSource();
  source.buffer = buffer;
  const gain = ac.createGain();
  const now = ac.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(peak, now + attack);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  source.connect(filter(ac)).connect(gain).connect(ac.destination);
  source.start();
}

/** 哈气:一阵偏高频的嘶嘶声 */
export function hissSound() {
  noise(1.1, (ac) => {
    const f = ac.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 4200;
    f.Q.value = 0.7;
    return f;
  }, 0.16, 0.06);
}

/** 嚼猫粮:很短的一下脆响 */
export function crunchSound() {
  noise(0.07, (ac) => {
    const f = ac.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1500 + Math.random() * 900;
    f.Q.value = 1.5;
    return f;
  }, 0.07, 0.005);
}

/** 舔水:很轻的一下 */
export function lapSound() {
  noise(0.05, (ac) => {
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    return f;
  }, 0.05, 0.005);
}
