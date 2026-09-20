type Playback = { url: string; status: "idle" | "playing" | "error"; message: string };
type Playable = Pick<HTMLAudioElement, "play" | "pause" | "addEventListener">;

/** 全部入口共用一条发音通道，迟到的播放结果不能覆盖新发音。 */
export class PronunciationPlayer {
  private current: Playable | null = null;
  private state: Playback = { url: "", status: "idle", message: "" };
  private listeners = new Set<() => void>();
  private factory: (url: string) => Playable;
  constructor(factory: (url: string) => Playable = url => new Audio(url)) { this.factory = factory; }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(state: Playback) { this.state = state; this.listeners.forEach(listener => listener()); }
  stop(url?: string) {
    if (url && this.state.url !== url) return;
    this.current?.pause();
    this.current = null;
    this.update({ url: "", status: "idle", message: "" });
  }
  async play(url?: string) {
    if (!url) return;
    this.stop();
    let audio: Playable;
    try { audio = this.factory(url); }
    catch { this.update({ url, status: "error", message: "发音暂时无法播放，点击重试" }); return; }
    this.current = audio;
    this.update({ url, status: "playing", message: "" });
    const fail = () => {
      if (this.current !== audio) return;
      audio.pause();
      this.current = null;
      this.update({ url, status: "error", message: "发音暂时无法播放，点击重试" });
    };
    audio.addEventListener("ended", () => { if (this.current === audio) this.stop(); }, { once: true });
    audio.addEventListener("error", fail, { once: true });
    try {
      await audio.play();
      if (this.current !== audio) audio.pause();
    } catch { fail(); }
  }
}

export const pronunciationPlayer = new PronunciationPlayer();
export const playPronunciation = (url?: string) => pronunciationPlayer.play(url);
export const stopPronunciation = (url?: string) => pronunciationPlayer.stop(url);
