let audioContextRef: AudioContext | null = null;

export function playGearTick(): void {
  const AudioContextClass =
    window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) {
    return;
  }

  if (audioContextRef) {
    audioContextRef.close().catch(() => undefined);
  }

  audioContextRef = new AudioContextClass();
  const context = audioContextRef;

  if (context.state === "suspended") {
    context.resume().catch(() => undefined);
  }

  const start = context.currentTime;
  const duration = 0.085;
  const buffer = context.createBuffer(1, Math.floor(context.sampleRate * duration), context.sampleRate);
  const channel = buffer.getChannelData(0);

  for (let index = 0; index < channel.length; index += 1) {
    const t = index / channel.length;
    const tooth = Math.sin(index * 0.46) * 0.42 + Math.sin(index * 0.19) * 0.28;
    channel[index] = (Math.random() * 2 - 1 + tooth) * Math.pow(1 - t, 3.2);
  }

  const source = context.createBufferSource();
  const lowpass = context.createBiquadFilter();
  const notch = context.createBiquadFilter();
  const gain = context.createGain();

  source.buffer = buffer;
  lowpass.type = "lowpass";
  lowpass.frequency.setValueAtTime(420, start);
  lowpass.Q.setValueAtTime(0.82, start);
  notch.type = "notch";
  notch.frequency.setValueAtTime(1100, start);
  notch.Q.setValueAtTime(4, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.018, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  source.connect(lowpass);
  lowpass.connect(notch);
  notch.connect(gain);
  gain.connect(context.destination);
  source.start(start);
  source.stop(start + duration);

  source.onended = () => {
    context.close().catch(() => undefined);
    if (audioContextRef === context) {
      audioContextRef = null;
    }
  };
}

export function disposeAudio(): void {
  if (audioContextRef) {
    audioContextRef.close().catch(() => undefined);
    audioContextRef = null;
  }
}
