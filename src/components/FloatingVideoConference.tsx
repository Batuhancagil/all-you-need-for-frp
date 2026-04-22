"use client";

import type {
  MessageDecoder,
  MessageEncoder,
  TrackReferenceOrPlaceholder,
} from "@livekit/components-core";
import {
  CarouselLayout,
  Chat,
  ConnectionStateToast,
  ControlBar,
  FocusLayout,
  FocusLayoutContainer,
  LayoutContextProvider,
  ParticipantTile,
  RoomAudioRenderer,
  useCreateLayoutContext,
  usePinnedTracks,
  useTracks,
} from "@livekit/components-react";
import type { MessageFormatter } from "@livekit/components-react";
import { isEqualTrackRef, isTrackReference, isWeb, log } from "@livekit/components-core";
import { RoomEvent, Track } from "livekit-client";
import * as React from "react";

export interface FloatingVideoConferenceProps extends React.HTMLAttributes<HTMLDivElement> {
  chatMessageFormatter?: MessageFormatter;
  chatMessageEncoder?: MessageEncoder;
  chatMessageDecoder?: MessageDecoder;
}

/**
 * Video conference layout with icon-only control bar for cramped/floating UIs.
 * Use when videos are shown in a compact fixed panel (e.g. float on right).
 */
export function FloatingVideoConference({
  chatMessageFormatter,
  chatMessageDecoder,
  chatMessageEncoder,
  ...props
}: FloatingVideoConferenceProps) {
  const [widgetState, setWidgetState] = React.useState<{
    showChat: boolean;
    unreadMessages: number;
  }>({
    showChat: false,
    unreadMessages: 0,
  });
  const lastAutoFocusedScreenShareTrack = React.useRef<TrackReferenceOrPlaceholder | null>(
    null
  );
  const focusContainerRef = React.useRef<HTMLDivElement | null>(null);

  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { updateOnlyOn: [RoomEvent.ActiveSpeakersChanged], onlySubscribed: false }
  );

  const widgetUpdate = (state: { showChat?: boolean; unreadMessages?: number }) => {
    log.debug("updating widget state", state);
    setWidgetState((prev) => ({ ...prev, ...state }));
  };

  const layoutContext = useCreateLayoutContext();

  const screenShareTracks = tracks
    .filter(isTrackReference)
    .filter((track) => track.publication.source === Track.Source.ScreenShare);

  const focusTrack = usePinnedTracks(layoutContext)?.[0];
  const carouselTracks = tracks.filter((track) => !isEqualTrackRef(track, focusTrack));

  const screenShareKey = React.useMemo(
    () =>
      screenShareTracks
        .map((ref) => `${ref.publication.trackSid}_${ref.publication.isSubscribed}`)
        .join(),
    [screenShareTracks]
  );

  React.useEffect(() => {
    if (
      screenShareTracks.some((track) => track.publication.isSubscribed) &&
      lastAutoFocusedScreenShareTrack.current === null
    ) {
      log.debug("Auto set screen share focus:", { newScreenShareTrack: screenShareTracks[0] });
      layoutContext.pin.dispatch?.({ msg: "set_pin", trackReference: screenShareTracks[0] });
      lastAutoFocusedScreenShareTrack.current = screenShareTracks[0];
    } else if (
      lastAutoFocusedScreenShareTrack.current &&
      !screenShareTracks.some(
        (track) =>
          track.publication.trackSid ===
          lastAutoFocusedScreenShareTrack.current?.publication?.trackSid
      )
    ) {
      log.debug("Auto clearing screen share focus.");
      layoutContext.pin.dispatch?.({ msg: "clear_pin" });
      lastAutoFocusedScreenShareTrack.current = null;
    }
    if (focusTrack && !isTrackReference(focusTrack)) {
      const updatedFocusTrack = tracks.find(
        (tr) =>
          tr.participant.identity === focusTrack.participant.identity &&
          tr.source === focusTrack.source
      );
      if (updatedFocusTrack !== focusTrack && isTrackReference(updatedFocusTrack)) {
        layoutContext.pin.dispatch?.({ msg: "set_pin", trackReference: updatedFocusTrack });
      }
    }
    // screenShareKey already encodes the subscribed state per track; avoid joining inline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenShareKey, focusTrack?.publication?.trackSid]);

  const requestFocusFullscreen = React.useCallback(() => {
    const host = focusContainerRef.current;
    if (!host) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    const video = host.querySelector("video");
    const target: Element = (video as Element | null) ?? host;
    const anyTarget = target as Element & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    };
    const request =
      target.requestFullscreen?.bind(target) ??
      (anyTarget.webkitRequestFullscreen?.bind(target) as (() => Promise<void>) | undefined);
    if (request) void request();
  }, []);

  const tileKey = (tr: TrackReferenceOrPlaceholder) =>
    `${tr.participant.identity}:${tr.source}:${isTrackReference(tr) ? tr.publication.trackSid : "placeholder"}`;

  return (
    <div className="lk-video-conference" {...props}>
      {isWeb() && (
        <LayoutContextProvider value={layoutContext} onWidgetChange={widgetUpdate}>
          <div className="lk-video-conference-inner">
            {!focusTrack ? (
              <div className="lk-grid-layout-wrapper aynfrp-column-layout">
                {tracks.map((tr) => (
                  <ParticipantTile
                    key={tileKey(tr)}
                    trackRef={isTrackReference(tr) ? tr : undefined}
                  />
                ))}
              </div>
            ) : (
              <div
                className="lk-focus-layout-wrapper"
                ref={focusContainerRef}
                onDoubleClick={requestFocusFullscreen}
                style={{ position: "relative" }}
              >
                <FocusLayoutContainer>
                  <CarouselLayout tracks={carouselTracks}>
                    <ParticipantTile />
                  </CarouselLayout>
                  {focusTrack && <FocusLayout trackRef={focusTrack} />}
                </FocusLayoutContainer>
                <button
                  type="button"
                  onClick={requestFocusFullscreen}
                  className="absolute right-2 top-2 z-30 rounded bg-black/50 p-1.5 text-white hover:bg-black/70"
                  title="Toggle fullscreen"
                  aria-label="Toggle fullscreen"
                  style={{ position: "absolute" }}
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 9V3h6" />
                    <path d="M21 9V3h-6" />
                    <path d="M3 15v6h6" />
                    <path d="M21 15v6h-6" />
                  </svg>
                </button>
              </div>
            )}
            <ControlBar
              variation="minimal"
              controls={{ chat: true, settings: false }}
            />
          </div>
          <Chat
            style={{ display: widgetState.showChat ? "grid" : "none" }}
            messageFormatter={chatMessageFormatter}
            messageEncoder={chatMessageEncoder}
            messageDecoder={chatMessageDecoder}
          />
        </LayoutContextProvider>
      )}
      <RoomAudioRenderer />
      <ConnectionStateToast />
    </div>
  );
}
