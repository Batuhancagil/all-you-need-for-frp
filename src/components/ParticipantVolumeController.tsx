"use client";

import { useEffect } from "react";
import { useTracks } from "@livekit/components-react";
import { RemoteAudioTrack, Track } from "livekit-client";

type ParticipantVolumeControllerProps = {
  participantVolumes: Record<string, number>;
};

const MIN_PARTICIPANT_VOLUME = 0;
const MAX_PARTICIPANT_VOLUME = 2;

function clampParticipantVolume(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_PARTICIPANT_VOLUME, Math.max(MIN_PARTICIPANT_VOLUME, value));
}

export function ParticipantVolumeController({
  participantVolumes,
}: ParticipantVolumeControllerProps) {
  const audioTracks = useTracks(
    [Track.Source.Microphone, Track.Source.ScreenShareAudio, Track.Source.Unknown],
    {
      updateOnlyOn: [],
      onlySubscribed: true,
    }
  ).filter((trackRef) => !trackRef.participant.isLocal && trackRef.publication.kind === Track.Kind.Audio);

  useEffect(() => {
    audioTracks.forEach((trackRef) => {
      const remoteTrack = trackRef.publication.track;
      if (!(remoteTrack instanceof RemoteAudioTrack)) return;

      const nextVolume = clampParticipantVolume(
        participantVolumes[trackRef.participant.identity] ?? 1
      );
      remoteTrack.setVolume(nextVolume);
    });
  }, [audioTracks, participantVolumes]);

  return null;
}
