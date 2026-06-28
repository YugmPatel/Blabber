import { useEffect, useMemo, useRef, useState } from 'react';
import { Mic, MicOff, PhoneOff, Video, VideoOff, Users } from 'lucide-react';
import axios from 'axios';
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
import { useAppStore } from '@/store/app-store';
import type { Chat } from '@repo/types';

interface GroupCallModalProps {
  chat: Chat;
  title: string;
  callType: 'audio' | 'video';
  callId: string;
  isInitiator?: boolean;
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

function createClientSessionId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getGroupCallErrorMessage(err: unknown) {
  if (axios.isAxiosError<{ message?: string }>(err)) {
    const message = err.response?.data?.message;
    if (message) return message;

    const status = err.response?.status;
    if (status === 403) return 'You no longer have access to this group.';
    if (status === 404 || status === 410) return 'This group call is no longer active.';
    if (status === 503) return 'Group calling is not configured on this server.';
    return 'We could not connect you to the call. Try again.';
  }

  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
      return 'Camera or microphone permission is required to join.';
    }
    if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      return 'Camera or microphone was not found on this device.';
    }
    if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
      return 'Camera or microphone is already in use by another app.';
    }
  }

  if (err instanceof Error) {
    const message = err.message.toLowerCase();
    if (
      message.includes('pc connection') ||
      message.includes('peerconnection') ||
      message.includes('ice') ||
      message.includes('signal')
    ) {
      return 'We could not connect to the call service. Try again.';
    }
    if (message.includes('permission') || message.includes('notallowed')) {
      return 'Camera or microphone permission is required to join.';
    }
  }

  return 'We could not connect you to the call. Try again.';
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
    if (element instanceof HTMLMediaElement) {
      element.autoplay = true;
    }
    container.replaceChildren(element);

    return () => {
      tile.track.detach(element);
      element.remove();
    };
  }, [tile]);

  return <div ref={containerRef} className="h-full w-full" />;
}

export default function GroupCallModal({ chat, title, callType, callId, isInitiator = false, onClose }: GroupCallModalProps) {
  const socket = useAppStore((state) => state.socket);
  const [room] = useState(() => new Room({ adaptiveStream: true, dynacast: true }));
  const [status, setStatus] = useState('Joining...');
  const [error, setError] = useState<string | null>(null);
  const [localTracks, setLocalTracks] = useState<LocalTrack[]>([]);
  const [remoteTiles, setRemoteTiles] = useState<TrackTile[]>([]);
  const [participantCount, setParticipantCount] = useState(1);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(callType === 'video');
  const localTracksRef = useRef<LocalTrack[]>([]);
  const clientSessionIdRef = useRef(createClientSessionId());

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
        const tracks = await createLocalTracks({
          audio: true,
          video: callType === 'video',
        });
        if (cancelled) {
          tracks.forEach((track) => track.stop());
          return;
        }
        localTracksRef.current = tracks;
        setLocalTracks(tracks);

        const { data } = await apiClient.post<{
          token: string;
          wsUrl?: string;
          callId: string;
        }>(`/api/chats/${chat._id}/calls/group-token`, {
          callType,
          callId,
          isInitiator,
          clientSessionId: clientSessionIdRef.current,
        });
        const wsUrl = data.wsUrl || import.meta.env.VITE_LIVEKIT_WS_URL;
        if (!wsUrl) throw new Error('Group call server is not configured.');

        const updateParticipantCount = () => setParticipantCount(1 + room.remoteParticipants.size);

        room
          .on(RoomEvent.TrackSubscribed, upsertRemoteTrack)
          .on(RoomEvent.TrackUnsubscribed, removeRemoteTrack)
          .on(RoomEvent.ParticipantConnected, () => {
            updateParticipantCount();
            setStatus('Connected');
          })
          .on(RoomEvent.ParticipantDisconnected, () => {
            updateParticipantCount();
            setStatus('Connected');
          })
          .on(RoomEvent.Disconnected, () => setStatus('Call ended'));

        await room.connect(wsUrl, data.token);
        if (cancelled) return;

        for (const track of tracks) {
          await room.localParticipant.publishTrack(track);
        }
        updateParticipantCount();
        setStatus('Connected');
      } catch (err) {
        localTracksRef.current.forEach((track) => track.stop());
        localTracksRef.current = [];
        setLocalTracks([]);
        setError(getGroupCallErrorMessage(err));
        setStatus('Could not join');
      }
    };

    connect();

    return () => {
      cancelled = true;
      localTracksRef.current.forEach((track) => track.stop());
      localTracksRef.current = [];
      room.disconnect();
      socket?.emit('group-call:leave', {
        callId,
        chatId: chat._id,
        clientSessionId: clientSessionIdRef.current,
      });
    };
    // The room lifecycle is intentionally tied to this modal instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId, callType, chat._id, room, socket]);

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
