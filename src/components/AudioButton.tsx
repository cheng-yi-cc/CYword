import { useSyncExternalStore } from "react";
import { playPronunciation, pronunciationPlayer, stopPronunciation } from "../audio";

export function AudioButton({ url, className = "" }: { url?: string; className?: string }) {
  const playback = useSyncExternalStore(pronunciationPlayer.subscribe, pronunciationPlayer.snapshot);
  if (!url) return null;
  const playing = playback.url === url && playback.status === "playing";
  const failed = playback.url === url && playback.status === "error";
  return <span className="audio-control">
    <button type="button" className={`audio-button ${className}`} aria-label={failed ? "重试发音" : playing ? "停止发音" : "播放发音"} onClick={event => {
      event.stopPropagation();
      if (playing) stopPronunciation();
      else void playPronunciation(url);
    }}>{failed ? "重试发音" : playing ? "停止" : "播放发音"}</button>
    {failed && <small className="audio-error" role="status">{playback.message}</small>}
  </span>;
}
