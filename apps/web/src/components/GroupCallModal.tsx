import { useEffect, useMemo, useRef, useState } from 'react';
import { Mic, MicOff, PhoneOff, Video, VideoOff, Users } from 'lucide-react';
import {
  createLocalTracks,
  LocalTrack,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
} from 'livekit-client';
import { apiClient } from '@/api/client';
import type { Chat } from '@repo/types';

interface GroupCallModalProps {
  chat: Chat;
  title: string;
  callType: 'audio' | 'video';
  callId: string;
  onClose: () => void;
}

interface TrackTile {
  id: string;
  name: string;
  identity: string;
  track: LocalTrack | RemoteTrack;
  kind: Track.Kind;
  local?: boolean;
}

function createCallId(chatId: string) {
  return `group-${chatId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function TrackAttachment({ tile }: { tile: TrackTile }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const element = tile.track.attach();
    element.className =
      tile.kind === Track.Kind.Video
        ? 'h-full w-full rounded-xl object-cover'
        : 'hidden';
    if (element instanceof HTMLVideoElement) {
      element.playsInline = true;
      element.muted = Boolean(tile.local);
    }
    container.replaceChildren(element);

    return () => {
      tile.track.detach(element);
      element.remove();
    };
  }, [tile]);

  return <div ref={containerRef} className="h-full w-full" />;
}

export default function GroupCallModal({ chat, title, callType, callId, onClose }: GroupCallModalProps) {
  const [room] = useState(() => new Room({ adaptiveStream: true, dynacast: true }));
  const [status, setStatus] = useState('Joining...');
  const [error, setError] = useState<string | null>(null);
  const [localTracks, setLocalTracks] = useState<LocalTrack[]>([]);
  const [remoteTiles, setRemoteTiles] = useState<TrackTile[]>([]);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(callType === 'video');
  const localTracksRef = useRef<LocalTrack[]>([]);

  const visibleTiles = useMemo(() => {
    const localVideo = localTracks.find((track) => track.kind === Track.Kind.Video);
    const videoTiles = remoteTiles.filter((tile) => tile.kind === Track.Kind.Video);
    const audioTiles = remoteTiles.filter((tile) => tile.kind === Track.Kind.Audio);
    const tiles: TrackTile[] = [];
    if (localVideo) {
      tiles.push({
        id: `local-${localVideo.sid || localVideo.mediaStreamTrack.id}`,
        name: 'You',
        identity: 'local',
        track: localVideo,
        kind: Track.Kind.Video,
        local: true,
      });
    }
    return { videoTiles: [...tiles, ...videoTiles], audioTiles };
  }, [localTracks, remoteTiles]);

  useEffect(() => {
    let cancelled = false;

    const upsertRemoteTrack = (
      track: RemoteTrack,
      _publication: RemoteTrackPublication,
      participant: RemoteParticipant
    ) => {
      setRemoteTiles((tiles) => {
        const trackId = track.sid || track.mediaStreamTrack.id;
        const next = tiles.filter((tile) => tile.id !== trackId);
        next.push({
          id: trackId,
          name: participant.name || participant.identity,
          identity: participant.identity,
          track,
          kind: track.kind,
        });
        return next;
      });
    };

    const removeRemoteTrack = (track: RemoteTrack) => {
      const trackId = track.sid || track.mediaStreamTrack.id;
      setRemoteTiles((tiles) => tiles.filter((tile) => tile.id !== trackId));
    };

    const connect = async () => {
      try {
        const { data } = await apiClient.post<{
          token: string;
          wsUrl?: string;
          callId: string;
        }>(`/api/chats/${chat._id}/calls/group-token`, { callType, callId });
        const wsUrl = data.wsUrl || import.meta.env.VITE_LIVEKIT_WS_URL;
        if (!wsUrl) throw new Error('Group call server is not configured.');

        room
          .on(RoomEvent.TrackSubscribed, upsertRemoteTrack)
          .on(RoomEvent.TrackUnsubscribed, removeRemoteTrack)
          .on(RoomEvent.ParticipantConnected, () => setStatus('Connected'))
          .on(RoomEvent.ParticipantDisconnected, () => setStatus('Connected'))
          .on(RoomEvent.Disconnected, () => setStatus('Call ended'));

        await room.connect(wsUrl, data.token);
        if (cancelled) return;

        const tracks = await createLocalTracks({
          audio: true,
          video: callType === 'video',
        });
        if (cancelled) {
          tracks.forEach((track) => track.stop());
          return;
        }

        for (const track of tracks) {
          await room.localParticipant.publishTrack(track);
        }
        setLocalTracks(tracks);
        localTracksRef.current = tracks;
        setStatus('Connected');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not start group call.');
        setStatus('Could not join');
      }
    };

    connect();

    return () => {
      cancelled = true;
      localTracksRef.current.forEach((track) => track.stop());
      localTracksRef.current = [];
      room.disconnect();
      apiClient
        .post('/api/chats/calls/events', { callId, chatId: chat._id, event: 'end' })
        .catch(() => undefined);
    };
    // The room lifecycle is intentionally tied to this modal instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId, callType, chat._id, room]);

  const toggleMic = async () => {
    const audioTrack = localTracks.find((track) => track.kind === Track.Kind.Audio);
    if (!audioTrack) return;
    if (micEnabled) {
      await audioTrack.mute();
      setMicEnabled(false);
    } else {
      await audioTrack.unmute();
      setMicEnabled(true);
    }
  };

  const toggleCamera = async () => {
    const videoTrack = localTracks.find((track) => track.kind === Track.Kind.Video);
    if (!videoTrack) return;
    if (cameraEnabled) {
      await videoTrack.mute();
      setCameraEnabled(false);
    } else {
      await videoTrack.unmute();
      setCameraEnabled(true);
    }
  };

  const participantCount = 1 + room.remoteParticipants.size;
  const videoTiles = visibleTiles.videoTiles;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/90 p-4">
      <div className="flex h-full max-h-[760px] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-white">{title}</h2>
            <p className="mt-1 flex items-center gap-1 text-xs text-slate-300">
              <Users size={14} />
              {participantCount} in call · {status}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-rose-600 p-2.5 text-white transition hover:bg-rose-500"
            aria-label="End call"
          >
            <PhoneOff size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 p-4">
          {error ? (
            <div className="flex h-full items-center justify-center text-center">
              <div className="max-w-sm rounded-2xl border border-white/10 bg-white/5 p-6">
                <p className="text-sm font-semibold text-white">Group call unavailable</p>
                <p className="mt-2 text-sm leading-6 text-slate-300">{error}</p>
              </div>
            </div>
          ) : videoTiles.length > 0 ? (
            <div className="grid h-full gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {videoTiles.map((tile) => (
                <div key={tile.id} className="relative min-h-40 overflow-hidden rounded-xl bg-slate-900">
                  <TrackAttachment tile={tile} />
                  <div className="absolute bottom-2 left-2 rounded-full bg-black/55 px-2.5 py-1 text-xs font-medium text-white">
                    {tile.name}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-teal-500/20 text-teal-200">
                  <Users size={34} />
                </div>
                <p className="mt-4 text-sm font-semibold text-white">
                  {callType === 'audio' ? 'Audio call active' : 'Waiting for video'}
                </p>
                <p className="mt-1 text-sm text-slate-400">Others will appear here as they join.</p>
              </div>
            </div>
          )}
          {visibleTiles.audioTiles.map((tile) => (
            <TrackAttachment key={tile.id} tile={tile} />
          ))}
        </div>

        <div className="flex items-center justify-center gap-3 border-t border-white/10 px-5 py-4">
          <button
            type="button"
            onClick={toggleMic}
            className={`rounded-full p-3 transition ${
              micEnabled ? 'bg-white/10 text-white hover:bg-white/15' : 'bg-rose-600 text-white hover:bg-rose-500'
            }`}
            aria-label={micEnabled ? 'Mute microphone' : 'Unmute microphone'}
          >
            {micEnabled ? <Mic size={20} /> : <MicOff size={20} />}
          </button>
          {callType === 'video' && (
            <button
              type="button"
              onClick={toggleCamera}
              className={`rounded-full p-3 transition ${
                cameraEnabled ? 'bg-white/10 text-white hover:bg-white/15' : 'bg-rose-600 text-white hover:bg-rose-500'
              }`}
              aria-label={cameraEnabled ? 'Turn camera off' : 'Turn camera on'}
            >
              {cameraEnabled ? <Video size={20} /> : <VideoOff size={20} />}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-rose-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-rose-500"
          >
            Leave
          </button>
        </div>
      </div>
    </div>
  );
}

export { createCallId as createGroupCallId };
