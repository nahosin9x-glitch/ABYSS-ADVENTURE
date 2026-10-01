let context: AudioContext | null = null,
  music: GainNode | null = null;
export function updateAudio(
  musicVolume: number,
  sfxVolume: number,
  play = false,
  suspend = false,
) {
  if (suspend || document.hidden) {
    void context?.suspend();
    return;
  }
  if (!context && !(musicVolume || (play && sfxVolume))) return;
  context ??= new AudioContext();
  void context.resume();
  if (!music) {
    music = context.createGain();
    music.connect(context.destination);
    for (const frequency of [55, 82.407, 110]) {
      const tone = context.createOscillator();
      tone.frequency.value = frequency;
      tone.type = "sine";
      tone.connect(music);
      tone.start();
    }
  }
  music.gain.setTargetAtTime(musicVolume * 0.025, context.currentTime, 0.2);
  if (play && sfxVolume) {
    const tone = context.createOscillator(),
      gain = context.createGain();
    tone.frequency.setValueAtTime(220, context.currentTime);
    tone.frequency.exponentialRampToValueAtTime(90, context.currentTime + 0.1);
    gain.gain.setValueAtTime(sfxVolume * 0.08, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.15);
    tone.connect(gain);
    gain.connect(context.destination);
    tone.start();
    tone.stop(context.currentTime + 0.16);
  }
}
