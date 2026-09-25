import { useSyncExternalStore } from "react";
import { playPronunciation, pronunciationPlayer, stopPronunciation } from "../audio";

export function AudioButton({ url, className = "", pronunciation }: { url?: string; className?: string; pronunciation?: string }) {
  const playback = useSyncExternalStore(pronunciationPlayer.subscribe, pronunciationPlayer.snapshot);
  if (!url) return pronunciation ? <strong className="ipa">{pronunciation}</strong> : null;
  const playing = playback.url === url && (playback.status === "loading" || playback.status === "playing");
  const failed = playback.url === url && playback.status === "error";
  return <span className="audio-control">
    <button type="button" className={`audio-button ${pronunciation ? "has-pronunciation" : ""} ${className}`} aria-label={failed ? "重试发音" : playing ? "停止发音" : "播放发音"} onClick={event => {
      event.stopPropagation();
      if (playing) stopPronunciation();
      else void playPronunciation(url);
    }}>{pronunciation && <strong className="ipa">{pronunciation}</strong>}<span>{failed ? "重试发音" : playing ? "停止" : "播放发音"}</span></button>
    {failed && <small className="audio-error" role="status">{playback.message}</small>}
  </span>;
}
