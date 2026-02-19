"use client";

import { useCallback, useEffect, useRef, useState } from "react";

function extractVideoId(embedUrl: string | null): string | null {
  if (!embedUrl?.trim()) return null;
  const m = embedUrl.match(/(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement,
        opts: {
          videoId: string;
          playerVars?: { autoplay?: number; loop?: number; playlist?: string };
          events?: { onReady?: (e: { target: YTPlayer }) => void; onStateChange?: (e: { data: number }) => void };
        }
      ) => YTPlayer;
      PlayerState?: { PLAYING: number; PAUSED: number; ENDED: number };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface YTPlayer {
  playVideo: () => void;
  pauseVideo: () => void;
  getPlayerState: () => number;
}

type Props = {
  backgroundMusicUrl: string | null;
  musicUrl: string;
  setMusicUrl: (v: string) => void;
  setBackgroundMusic: (url?: string) => void;
  musicError: string | null;
  canManageSession: boolean;
};

export function MusicPlayer({
  backgroundMusicUrl,
  musicUrl,
  setMusicUrl,
  setBackgroundMusic,
  musicError,
  canManageSession,
}: Props) {
  const [playing, setPlaying] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const playerRef = useRef<YTPlayer | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoId = extractVideoId(backgroundMusicUrl);

  const loadYouTubeAPI = useCallback(() => {
    if (typeof window === "undefined" || window.YT?.Player) return;
    const existing = document.querySelector('script[src*="youtube.com/iframe_api"]');
    if (existing) return;

    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    const first = document.getElementsByTagName("script")[0];
    first?.parentNode?.insertBefore(tag, first);
  }, []);

  useEffect(() => {
    loadYouTubeAPI();
  }, [loadYouTubeAPI]);

  useEffect(() => {
    if (!videoId || !containerRef.current) return;

    const initPlayer = () => {
      if (!containerRef.current || !window.YT?.Player) return;
      const yt = window.YT;
      const player = new yt.Player(containerRef.current, {
        videoId,
        playerVars: { autoplay: 0, loop: 1, playlist: videoId },
        events: {
          onReady: (e) => {
            playerRef.current = e.target;
          },
          onStateChange: (e) => {
            // 1=playing, 2=paused, 0=ended
            setPlaying(e.data === 1);
          },
        },
      });
    };

    if (window.YT?.Player) {
      initPlayer();
    } else {
      window.onYouTubeIframeAPIReady = () => {
        window.onYouTubeIframeAPIReady = undefined;
        initPlayer();
      };
    }

    return () => {
      playerRef.current = null;
    };
  }, [videoId]);

  const togglePlay = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    const state = p.getPlayerState?.();
    // 1=playing, 2=paused, -1/0/5=not playing
    if (state === 1) {
      p.pauseVideo();
    } else {
      p.playVideo();
    }
  }, []);

  const hasMusic = !!videoId;
  const showPlayer = hasMusic || canManageSession;

  if (!showPlayer) return null;

  return (
    <>
      {/* Hidden container for YouTube player - no visible video */}
      {hasMusic && (
        <div
          key={videoId}
          ref={containerRef}
          className="pointer-events-none invisible fixed left-[-9999px] top-0 h-px w-px"
          aria-hidden
        />
      )}

      <div
        className={`fixed bottom-4 right-4 z-40 flex flex-col gap-2 rounded-2xl border border-zinc-200 bg-white shadow-lg transition-all group ${
          expanded ? "p-4 min-w-[280px]" : "rounded-full p-1.5 gap-1"
        }`}
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={togglePlay}
            disabled={!hasMusic}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white shadow-md transition hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed"
            title={hasMusic ? (playing ? "Pause" : "Play") : "No music set"}
            aria-label={playing ? "Pause music" : "Play music"}
          >
            {playing ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>
          {expanded ? (
            <>
              <span className="text-xs font-medium text-zinc-600">
                {hasMusic ? (playing ? "Playing" : "Paused") : "No music"}
              </span>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="ml-auto rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700"
                title="Minimize"
                aria-label="Minimize"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 15l-6-6-6 6" />
                </svg>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="rounded-full p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700"
              title="Expand to set music"
              aria-label="Expand"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          )}
        </div>

        {expanded && (
          <>
            {canManageSession && (
              <div className="flex flex-col gap-2">
                <input
                  type="url"
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                  value={musicUrl}
                  onChange={(e) => setMusicUrl(e.target.value)}
                  placeholder="https://youtube.com/watch?v=..."
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void setBackgroundMusic()}
                    className="rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    Set
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMusicUrl("");
                      void setBackgroundMusic("");
                    }}
                    className="rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-semibold"
                  >
                    Clear
                  </button>
                </div>
                {musicError && <p className="text-xs text-amber-600">{musicError}</p>}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
