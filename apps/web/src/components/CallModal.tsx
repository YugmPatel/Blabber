import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff, X } from 'lucide-react';
import type {
  CallAnswerPayload,
  CallControlPayload,
  CallIceCandidatePayload,
  CallInvitePayload,
  CallOfferPayload,
  ClientToServerEvents,
  ServerToClientEvents,
} from '@repo/types';
import Avatar from './Avatar';
import { useAuth } from '@/contexts/AuthContext';
import { useAppStore, type ActiveCall } from '@/store/app-store';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface CallModalProps {
  socket: TypedSocket | null;
  isConnected: boolean;
}

const iceServers: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function getUserName(
  user: { name?: string; username?: string; email?: string } | null | undefined
) {
  return user?.name || user?.username || user?.email || 'Unknown user';
}

function serializeDescription(description: RTCSessionDescriptionInit) {
  return {
    type: description.type,
    sdp: description.sdp,
  };
}

const callCanceledMessage = 'Call canceled.';
const RING_TIMEOUT_MS = 45_000;

function getMediaErrorMessage(callType: ActiveCall['callType'], error?: unknown) {
  const devices = callType === 'video' ? 'camera and microphone' : 'microphone';

  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return `Permission denied. Allow ${devices} access to start the call.`;
    }
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      return callType === 'video'
        ? 'No camera or microphone was found.'
        : 'No microphone was found.';
    }
    if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
      return `Could not start the ${devices}. Another app may be using it.`;
    }
  }

  return callType === 'video'
    ? 'Could not access camera or microphone. Please check permissions.'
    : 'Could not access microphone. Please check permissions.';
}

export default function CallModal({ socket, isConnected }: CallModalProps) {
  const { user: currentUser } = useAuth();
  const activeCall = useAppStore((state) => state.activeCall);
  const setActiveCall = useAppStore((state) => state.setActiveCall);
  const updateActiveCall = useAppStore((state) => state.updateActiveCall);
  const clearActiveCall = useAppStore((state) => state.clearActiveCall);

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraEnabled, setIsCameraEnabled] = useState(true);
  const [duration, setDuration] = useState(0);

  const activeCallRef = useRef<ActiveCall | null>(activeCall);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const invitedCallIdsRef = useRef(new Set<string>());
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ringTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isClosingRef = useRef(false);

  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

  useEffect(() => {
    if (!activeCall) return;
    isClosingRef.current = false;
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, [activeCall?.callId]);

  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream, activeCall?.status]);

  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = remoteStream;
    }
  }, [remoteStream, activeCall?.status]);

  const cleanupResources = useCallback(() => {
    isClosingRef.current = true;
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (remoteStreamRef.current) {
      remoteStreamRef.current.getTracks().forEach((track) => track.stop());
    }
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
    pendingIceCandidatesRef.current = [];
    remoteStreamRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setIsMuted(false);
    setIsCameraEnabled(true);
    setDuration(0);
  }, []);

  const isCurrentCall = useCallback((call: ActiveCall) => {
    const currentCall = activeCallRef.current;
    return Boolean(
      currentCall &&
        currentCall.callId === call.callId &&
        currentCall.status !== 'ended' &&
        currentCall.status !== 'error' &&
        !isClosingRef.current
    );
  }, []);

  const closeCall = useCallback(
    (message?: string) => {
      const callId = activeCallRef.current?.callId;
      cleanupResources();
      if (message) {
        updateActiveCall({ status: 'ended', error: message });
      } else {
        updateActiveCall({ status: 'ended' });
      }
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
      }
      closeTimerRef.current = setTimeout(
        () => {
          if (!callId || activeCallRef.current?.callId === callId) {
            clearActiveCall();
          }
        },
        message ? 1600 : 900
      );
    },
    [cleanupResources, clearActiveCall, updateActiveCall]
  );

  const dismissCall = useCallback(() => {
    cleanupResources();
    clearActiveCall();
  }, [cleanupResources, clearActiveCall]);

	  const emitControl = useCallback(
    (event: 'call:accept' | 'call:decline' | 'call:cancel' | 'call:end', call: ActiveCall) => {
      if (!socket || !currentUser?._id) return;
      socket.emit(event, {
        callId: call.callId,
        chatId: call.chatId,
        fromUserId: currentUser._id,
        toUserId: call.peerUserId,
      });
    },
    [socket, currentUser?._id]
	  );

	  useEffect(() => {
	    if (ringTimerRef.current) {
	      clearTimeout(ringTimerRef.current);
	      ringTimerRef.current = null;
	    }
	    if (!activeCall || (activeCall.status !== 'outgoing' && activeCall.status !== 'incoming')) return undefined;

	    const callId = activeCall.callId;
	    ringTimerRef.current = setTimeout(() => {
	      const latestCall = activeCallRef.current;
	      if (!latestCall || latestCall.callId !== callId) return;
	      if (latestCall.status !== 'outgoing' && latestCall.status !== 'incoming') return;
	      emitControl(latestCall.status === 'outgoing' ? 'call:cancel' : 'call:decline', latestCall);
	      closeCall('No answer.');
	    }, RING_TIMEOUT_MS);

	    return () => {
	      if (ringTimerRef.current) {
	        clearTimeout(ringTimerRef.current);
	        ringTimerRef.current = null;
	      }
	    };
	  }, [activeCall?.callId, activeCall?.status, closeCall, emitControl]);

  const drainPendingIceCandidates = useCallback(async () => {
    const pc = peerConnectionRef.current;
    if (!pc?.remoteDescription) return;

    const candidates = pendingIceCandidatesRef.current.splice(0);
    for (const candidate of candidates) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // Candidate timing can race with SDP setup; later candidates can still connect.
      }
    }
  }, []);

  const createPeerConnection = useCallback(
    (stream: MediaStream) => {
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }

      isClosingRef.current = false;
      const pc = new RTCPeerConnection(iceServers);
      peerConnectionRef.current = pc;

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      pc.onicecandidate = (event) => {
        const latestCall = activeCallRef.current;
        if (!event.candidate || !latestCall || !socket || !currentUser?._id) return;
        socket.emit('call:ice-candidate', {
          callId: latestCall.callId,
          chatId: latestCall.chatId,
          fromUserId: currentUser._id,
          toUserId: latestCall.peerUserId,
          candidate: event.candidate.toJSON(),
        });
      };

      pc.ontrack = (event) => {
        const incomingStream = event.streams[0] ?? remoteStreamRef.current ?? new MediaStream();
        if (
          !event.streams[0] &&
          !incomingStream.getTracks().some((track) => track.id === event.track.id)
        ) {
          incomingStream.addTrack(event.track);
        }
        remoteStreamRef.current = incomingStream;
        setRemoteStream(incomingStream);
      };

      pc.onconnectionstatechange = () => {
        if (isClosingRef.current) return;
        if (pc.connectionState === 'connected') {
          updateActiveCall({ status: 'active' });
        }
        if (pc.connectionState === 'failed') {
          const latestCall = activeCallRef.current;
          if (latestCall) {
            emitControl('call:end', latestCall);
          }
          closeCall('Call connection lost.');
        }
      };

      return pc;
    },
    [socket, currentUser?._id, emitControl, closeCall, updateActiveCall]
  );

  const ensureLocalMedia = useCallback(
    async (call: ActiveCall) => {
      if (localStreamRef.current) {
        const hasAudio = localStreamRef.current.getAudioTracks().length > 0;
        const hasRequiredVideo =
          call.callType === 'audio' || localStreamRef.current.getVideoTracks().length > 0;
        if (hasAudio && hasRequiredVideo) return localStreamRef.current;
        localStreamRef.current.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        const message = 'Media devices are not available in this browser.';
        updateActiveCall({ status: 'error', error: message });
        throw new Error(message);
      }

      try {
        const constraints: MediaStreamConstraints =
          call.callType === 'video'
            ? { audio: true, video: { facingMode: 'user' } }
            : { audio: true, video: false };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (!isCurrentCall(call)) {
          stream.getTracks().forEach((track) => track.stop());
          throw new Error(callCanceledMessage);
        }
        localStreamRef.current = stream;
        setLocalStream(stream);
        setIsCameraEnabled(
          call.callType === 'video' ? stream.getVideoTracks().some((track) => track.enabled) : false
        );
        return stream;
      } catch (error) {
        if (error instanceof Error && error.message === callCanceledMessage) {
          throw error;
        }
        const message = getMediaErrorMessage(call.callType, error);
        if (activeCallRef.current?.callId === call.callId) {
          updateActiveCall({ status: 'error', error: message });
        }
        throw new Error(message);
      }
    },
    [isCurrentCall, updateActiveCall]
  );

  const startCallerOffer = useCallback(
    async (call: ActiveCall) => {
      if (!socket || !currentUser?._id) return;

      updateActiveCall({ status: 'connecting' });
      try {
        const stream = await ensureLocalMedia(call);
        if (!isCurrentCall(call)) return;
        const pc = createPeerConnection(stream);
        isClosingRef.current = false;
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (!isCurrentCall(call)) return;
        socket.emit('call:offer', {
          callId: call.callId,
          chatId: call.chatId,
          fromUserId: currentUser._id,
          toUserId: call.peerUserId,
          offer: serializeDescription(offer),
        });
      } catch (error) {
        if (error instanceof Error && error.message === callCanceledMessage) return;
        emitControl('call:end', call);
        setTimeout(() => closeCall(error instanceof Error ? error.message : undefined), 1200);
      }
    },
    [
      socket,
      currentUser?._id,
      ensureLocalMedia,
      createPeerConnection,
      emitControl,
      closeCall,
      updateActiveCall,
      isCurrentCall,
    ]
  );

  useEffect(() => {
    if (!socket || !isConnected || !currentUser?._id || !activeCall) return;
    if (activeCall.direction !== 'outgoing' || invitedCallIdsRef.current.has(activeCall.callId)) {
      return;
    }

    invitedCallIdsRef.current.add(activeCall.callId);
    ensureLocalMedia(activeCall)
      .then(() => {
        if (!isCurrentCall(activeCall) || activeCallRef.current?.status !== 'outgoing') return;
	        socket.emit('call:invite', {
	          callId: activeCall.callId,
	          chatId: activeCall.chatId,
	          fromUserId: currentUser._id,
	          fromUserName: getUserName(currentUser),
	          fromUserAvatarUrl: currentUser.avatarUrl,
	          toUserId: activeCall.toUserId,
	          callType: activeCall.callType,
        });
      })
      .catch((error) => {
        if (error instanceof Error && error.message === callCanceledMessage) return;
      });
  }, [socket, isConnected, currentUser, activeCall, ensureLocalMedia, isCurrentCall]);

  useEffect(() => {
    if (!socket || !currentUser?._id) return;

    const handleIncoming = (data: CallInvitePayload) => {
      const currentCall = activeCallRef.current;
      if (currentCall && currentCall.status !== 'ended' && currentCall.status !== 'error') {
        socket.emit('call:decline', {
          callId: data.callId,
          chatId: data.chatId,
          fromUserId: currentUser._id,
          toUserId: data.fromUserId,
        });
        return;
      }
      if (currentCall) {
        cleanupResources();
      }

      setActiveCall({
        callId: data.callId,
        chatId: data.chatId,
        callType: data.callType,
        direction: 'incoming',
        status: 'incoming',
        fromUserId: data.fromUserId,
        fromUserName: data.fromUserName,
        toUserId: currentUser._id,
	        peerUserId: data.fromUserId,
	        peerName: data.fromUserName || 'Someone',
	        peerAvatarUrl: data.fromUserAvatarUrl,
	      });
    };

    const handleAccepted = (data: CallControlPayload) => {
      const call = activeCallRef.current;
      if (!call || call.callId !== data.callId || call.direction !== 'outgoing') return;
      void startCallerOffer(call);
    };

    const handleDeclined = (data: CallControlPayload) => {
      const call = activeCallRef.current;
      if (!call || call.callId !== data.callId) return;
      closeCall('Call declined.');
    };

    const handleCanceled = (data: CallControlPayload) => {
      const call = activeCallRef.current;
      if (!call || call.callId !== data.callId) return;
      closeCall('Call canceled.');
    };

    const handleEnded = (data: CallControlPayload) => {
      const call = activeCallRef.current;
      if (!call || call.callId !== data.callId) return;
      closeCall('Call ended.');
    };

    const handleOffer = async (data: CallOfferPayload) => {
      const call = activeCallRef.current;
      if (!call || call.callId !== data.callId || call.direction !== 'incoming') return;

      try {
        const stream = await ensureLocalMedia(call);
        if (!isCurrentCall(call)) return;
        const pc = peerConnectionRef.current ?? createPeerConnection(stream);
        await pc.setRemoteDescription(
          new RTCSessionDescription(data.offer as RTCSessionDescriptionInit)
        );
        await drainPendingIceCandidates();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (!isCurrentCall(call)) return;
        socket.emit('call:answer', {
          callId: call.callId,
          chatId: call.chatId,
          fromUserId: currentUser._id,
          toUserId: call.peerUserId,
          answer: serializeDescription(answer),
        });
        updateActiveCall({ status: 'active' });
      } catch (error) {
        if (error instanceof Error && error.message === callCanceledMessage) return;
        if (activeCallRef.current?.callId === call.callId) {
          updateActiveCall({
            status: 'error',
            error: error instanceof Error ? error.message : 'Failed to answer the call.',
          });
          emitControl('call:end', call);
          cleanupResources();
        }
      }
    };

    const handleAnswer = async (data: CallAnswerPayload) => {
      const call = activeCallRef.current;
      const pc = peerConnectionRef.current;
      if (!call || call.callId !== data.callId || !pc) return;

      try {
        await pc.setRemoteDescription(
          new RTCSessionDescription(data.answer as RTCSessionDescriptionInit)
        );
        await drainPendingIceCandidates();
        updateActiveCall({ status: 'active' });
      } catch {
        emitControl('call:end', call);
        closeCall('Failed to connect the call.');
      }
    };

    const handleIceCandidate = async (data: CallIceCandidatePayload) => {
      const call = activeCallRef.current;
      const pc = peerConnectionRef.current;
      if (!call || call.callId !== data.callId || !data.candidate) return;

      if (!pc || !pc.remoteDescription) {
        pendingIceCandidatesRef.current.push(data.candidate as RTCIceCandidateInit);
        return;
      }

      try {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate as RTCIceCandidateInit));
      } catch {
        if (!isClosingRef.current) {
          pendingIceCandidatesRef.current.push(data.candidate as RTCIceCandidateInit);
        }
      }
    };

    const handleCallError = (data: { callId?: string; message: string }) => {
      const call = activeCallRef.current;
      if (data.callId && call?.callId !== data.callId) return;
      updateActiveCall({ status: 'error', error: data.message });
      setTimeout(() => closeCall(), 1600);
    };

    socket.on('call:incoming', handleIncoming);
    socket.on('call:accept', handleAccepted);
    socket.on('call:decline', handleDeclined);
    socket.on('call:cancel', handleCanceled);
    socket.on('call:end', handleEnded);
    socket.on('call:offer', handleOffer);
    socket.on('call:answer', handleAnswer);
    socket.on('call:ice-candidate', handleIceCandidate);
    socket.on('call:error', handleCallError);

    return () => {
      socket.off('call:incoming', handleIncoming);
      socket.off('call:accept', handleAccepted);
      socket.off('call:decline', handleDeclined);
      socket.off('call:cancel', handleCanceled);
      socket.off('call:end', handleEnded);
      socket.off('call:offer', handleOffer);
      socket.off('call:answer', handleAnswer);
      socket.off('call:ice-candidate', handleIceCandidate);
      socket.off('call:error', handleCallError);
    };
  }, [
    socket,
    currentUser?._id,
    setActiveCall,
    updateActiveCall,
    ensureLocalMedia,
    cleanupResources,
    createPeerConnection,
    drainPendingIceCandidates,
    emitControl,
    closeCall,
    startCallerOffer,
    isCurrentCall,
  ]);

  useEffect(() => {
    if (activeCall?.status !== 'active') return;
    const timer = setInterval(() => setDuration((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [activeCall?.status]);

  useEffect(() => {
    if (!activeCall) {
      cleanupResources();
    }
  }, [activeCall, cleanupResources]);

  useEffect(
    () => () => {
	      if (closeTimerRef.current) {
	        clearTimeout(closeTimerRef.current);
	      }
	      if (ringTimerRef.current) {
	        clearTimeout(ringTimerRef.current);
	      }
	      cleanupResources();
    },
    [cleanupResources]
  );

  const acceptCall = async () => {
    const call = activeCallRef.current;
    if (!call) return;
    updateActiveCall({ status: 'connecting' });
    try {
      const stream = await ensureLocalMedia(call);
      if (!isCurrentCall(call)) return;
      createPeerConnection(stream);
      isClosingRef.current = false;
      emitControl('call:accept', call);
    } catch (error) {
      if (error instanceof Error && error.message === callCanceledMessage) return;
      if (activeCallRef.current?.callId === call.callId) {
        emitControl('call:decline', call);
      }
    }
  };

  const declineCall = () => {
    const call = activeCallRef.current;
    if (!call) return;
    emitControl('call:decline', call);
    closeCall();
  };

  const cancelOrEndCall = () => {
    const call = activeCallRef.current;
    if (!call) return;
    const event =
      call.status === 'incoming'
        ? 'call:decline'
        : call.status === 'outgoing'
          ? 'call:cancel'
          : 'call:end';
    emitControl(event, call);
    closeCall();
  };

  const toggleMute = () => {
    const audioTrack = localStreamRef.current?.getAudioTracks()[0];
    if (!audioTrack) return;
    audioTrack.enabled = !audioTrack.enabled;
    setIsMuted(!audioTrack.enabled);
  };

  const toggleCamera = () => {
    const videoTrack = localStreamRef.current?.getVideoTracks()[0];
    if (!videoTrack) return;
    videoTrack.enabled = !videoTrack.enabled;
    setIsCameraEnabled(videoTrack.enabled);
  };

  if (!activeCall) return null;

  const isVideoCall = activeCall.callType === 'video';
  const isIncoming = activeCall.status === 'incoming';
  const isActive = activeCall.status === 'active';
  const isBusy = activeCall.status === 'outgoing' || activeCall.status === 'connecting';
  const isEndedOrError = activeCall.status === 'ended' || activeCall.status === 'error';

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4">
      <div className="relative flex h-[min(720px,92vh)] w-full max-w-4xl overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 text-white shadow-2xl">
        <button
          type="button"
          onClick={isEndedOrError ? dismissCall : cancelOrEndCall}
          aria-label="Close call"
          className="absolute right-4 top-4 z-20 rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20"
        >
          <X size={20} />
        </button>

        <div className="relative flex min-h-0 flex-1 items-center justify-center bg-slate-950">
          {isVideoCall && isActive && remoteStream ? (
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex flex-col items-center text-center">
              <Avatar src={activeCall.peerAvatarUrl} alt={activeCall.peerName} size="xl" />
              <h2 className="mt-5 text-2xl font-semibold">{activeCall.peerName}</h2>
              <p className="mt-2 text-sm text-slate-300">
                {activeCall.status === 'outgoing' && `Calling ${activeCall.peerName}...`}
                {activeCall.status === 'incoming' &&
                  `Incoming ${activeCall.callType} call from ${activeCall.peerName}`}
                {activeCall.status === 'connecting' && 'Connecting...'}
                {activeCall.status === 'active' &&
                  (isVideoCall ? 'Connected' : formatDuration(duration))}
                {activeCall.status === 'ended' && (activeCall.error || 'Call ended.')}
                {activeCall.status === 'error' && activeCall.error}
              </p>
            </div>
          )}

          {isVideoCall && localStream && (
            <div className="absolute bottom-24 right-4 h-36 w-28 overflow-hidden rounded-xl border border-white/30 bg-slate-900 shadow-xl md:h-44 md:w-32">
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="h-full w-full object-cover"
              />
            </div>
          )}

          {!isVideoCall && remoteStream && <audio ref={remoteAudioRef} autoPlay />}

          {isVideoCall && isActive && (
            <div className="absolute left-1/2 top-5 -translate-x-1/2 rounded-full bg-black/45 px-4 py-1.5 text-sm">
              {formatDuration(duration)}
            </div>
          )}

          <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-3">
            {isIncoming ? (
              <>
                <button
                  type="button"
                  onClick={declineCall}
                  className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-600 text-white transition hover:bg-rose-500"
                  aria-label="Decline call"
                >
                  <PhoneOff size={22} />
                </button>
                <button
                  type="button"
                  onClick={acceptCall}
                  className="flex h-14 w-14 items-center justify-center rounded-full bg-teal-500 text-white transition hover:bg-teal-400"
                  aria-label="Accept call"
                >
                  <Phone size={22} />
                </button>
              </>
            ) : (
              <>
                {(isActive || isBusy) && (
                  <button
                    type="button"
                    onClick={toggleMute}
                    className={`flex h-12 w-12 items-center justify-center rounded-full transition ${
                      isMuted ? 'bg-rose-600 hover:bg-rose-500' : 'bg-white/15 hover:bg-white/25'
                    }`}
                    aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                  >
                    {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
                  </button>
                )}
                {isVideoCall && (isActive || isBusy) && (
                  <button
                    type="button"
                    onClick={toggleCamera}
                    className={`flex h-12 w-12 items-center justify-center rounded-full transition ${
                      !isCameraEnabled
                        ? 'bg-rose-600 hover:bg-rose-500'
                        : 'bg-white/15 hover:bg-white/25'
                    }`}
                    aria-label={isCameraEnabled ? 'Turn camera off' : 'Turn camera on'}
                  >
                    {isCameraEnabled ? <Video size={20} /> : <VideoOff size={20} />}
                  </button>
                )}
                {!isEndedOrError && (
                  <button
                    type="button"
                    onClick={cancelOrEndCall}
                    className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-600 text-white transition hover:bg-rose-500"
                    aria-label={activeCall.status === 'outgoing' ? 'Cancel call' : 'End call'}
                  >
                    <PhoneOff size={22} />
                  </button>
                )}
                {isEndedOrError && (
                  <button
                    type="button"
                    onClick={dismissCall}
                    className="rounded-xl bg-white px-6 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-slate-100"
                  >
                    Close
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
