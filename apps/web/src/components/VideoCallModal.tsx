import { useState, useRef, useEffect, useCallback } from 'react';
import { X, Mic, MicOff, Video, VideoOff, Phone, PhoneOff, Monitor, Users } from 'lucide-react';

interface VideoCallModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatId: string;
  chatName: string;
  isVideoCall: boolean;
  isIncoming?: boolean;
  callerId?: string;
}

type CallState = 'idle' | 'calling' | 'ringing' | 'connected' | 'ended';

export default function VideoCallModal({
  isOpen,
  onClose,
  chatName,
  isVideoCall,
  isIncoming = false,
}: VideoCallModalProps) {
  const [callState, setCallState] = useState<CallState>(isIncoming ? 'ringing' : 'idle');
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(isVideoCall);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const callTimerRef = useRef<NodeJS.Timeout | null>(null);

  // ICE servers for WebRTC (using public STUN servers)
  const iceServers = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  };

  // Initialize media stream
  const initializeMedia = useCallback(async () => {
    try {
      const constraints: MediaStreamConstraints = {
        audio: true,
        video: isVideoCall ? { width: 1280, height: 720, facingMode: 'user' } : false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      return stream;
    } catch (err) {
      console.error('Error accessing media devices:', err);
      setError('Could not access camera/microphone. Please check permissions.');
      return null;
    }
  }, [isVideoCall]);

  // Create peer connection
  const createPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection(iceServers);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        // In production, send this to signaling server
        console.log('ICE candidate:', event.candidate);
      }
    };

    pc.ontrack = (event) => {
      if (remoteVideoRef.current && event.streams[0]) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'connected') {
        setCallState('connected');
      } else if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
        endCall();
      }
    };

    peerConnectionRef.current = pc;
    return pc;
  }, []);

  // Start call
  const startCall = async () => {
    setCallState('calling');
    setError(null);

    const stream = await initializeMedia();
    if (!stream) {
      setCallState('idle');
      return;
    }

    const pc = createPeerConnection();
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      // In production, send offer to signaling server
      console.log('Offer created:', offer);

      // Simulate connection for demo
      setTimeout(() => {
        if (callState === 'calling') {
          setCallState('connected');
        }
      }, 2000);
    } catch (err) {
      console.error('Error creating offer:', err);
      setError('Failed to start call');
      setCallState('idle');
    }
  };

  // Answer incoming call
  const answerCall = async () => {
    setCallState('connected');
    const stream = await initializeMedia();
    if (!stream) return;

    const pc = createPeerConnection();
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));
  };

  // End call
  const endCall = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }

    setCallState('ended');
    setTimeout(onClose, 1500);
  }, [onClose]);

  // Toggle mute
  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  // Toggle video
  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoEnabled(videoTrack.enabled);
      }
    }
  };

  // Toggle screen sharing
  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      // Stop screen sharing, revert to camera
      const stream = await initializeMedia();
      if (stream && peerConnectionRef.current) {
        const videoTrack = stream.getVideoTracks()[0];
        const sender = peerConnectionRef.current
          .getSenders()
          .find((s) => s.track?.kind === 'video');
        if (sender && videoTrack) {
          sender.replaceTrack(videoTrack);
        }
      }
      setIsScreenSharing(false);
    } else {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = screenStream.getVideoTracks()[0];

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = screenStream;
        }

        if (peerConnectionRef.current) {
          const sender = peerConnectionRef.current
            .getSenders()
            .find((s) => s.track?.kind === 'video');
          if (sender) {
            sender.replaceTrack(screenTrack);
          }
        }

        screenTrack.onended = () => {
          toggleScreenShare();
        };

        setIsScreenSharing(true);
      } catch (err) {
        console.error('Error sharing screen:', err);
      }
    }
  };

  // Call duration timer
  useEffect(() => {
    if (callState === 'connected') {
      callTimerRef.current = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    }

    return () => {
      if (callTimerRef.current) {
        clearInterval(callTimerRef.current);
      }
    };
  }, [callState]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }
    };
  }, []);

  // Format duration
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black">
      {/* Close button */}
      <button
        onClick={endCall}
        className="absolute right-4 top-4 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
      >
        <X size={24} />
      </button>

      {/* Remote video (full screen) */}
      {isVideoCall && callState === 'connected' && (
        <video ref={remoteVideoRef} autoPlay playsInline className="h-full w-full object-cover" />
      )}

      {/* Audio call or waiting state background */}
      {(!isVideoCall || callState !== 'connected') && (
        <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-b from-[#00a884] to-[#008f72]">
          <div className="mb-4 flex h-32 w-32 items-center justify-center rounded-full bg-white/20">
            <Users size={64} className="text-white" />
          </div>
          <h2 className="mb-2 text-2xl font-semibold text-white">{chatName}</h2>
          <p className="text-white/80">
            {callState === 'idle' && 'Ready to call'}
            {callState === 'calling' && 'Calling...'}
            {callState === 'ringing' && 'Incoming call...'}
            {callState === 'connected' && formatDuration(callDuration)}
            {callState === 'ended' && 'Call ended'}
          </p>
        </div>
      )}

      {/* Local video (picture-in-picture) */}
      {isVideoCall && isVideoEnabled && callState === 'connected' && (
        <div className="absolute bottom-24 right-4 h-40 w-28 overflow-hidden rounded-lg border-2 border-white shadow-lg">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full object-cover"
          />
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-lg bg-red-500 px-4 py-2 text-white">
          {error}
        </div>
      )}

      {/* Call duration overlay */}
      {callState === 'connected' && isVideoCall && (
        <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-black/50 px-4 py-2 text-white">
          {formatDuration(callDuration)}
        </div>
      )}

      {/* Controls */}
      <div className="absolute bottom-8 left-1/2 flex -translate-x-1/2 items-center gap-4">
        {callState === 'idle' && (
          <button
            onClick={startCall}
            className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500 text-white hover:bg-green-600"
          >
            {isVideoCall ? <Video size={28} /> : <Phone size={28} />}
          </button>
        )}

        {callState === 'ringing' && (
          <>
            <button
              onClick={endCall}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600"
            >
              <PhoneOff size={28} />
            </button>
            <button
              onClick={answerCall}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500 text-white hover:bg-green-600"
            >
              <Phone size={28} />
            </button>
          </>
        )}

        {callState === 'calling' && (
          <button
            onClick={endCall}
            className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600"
          >
            <PhoneOff size={28} />
          </button>
        )}

        {callState === 'connected' && (
          <>
            {/* Mute button */}
            <button
              onClick={toggleMute}
              className={`flex h-14 w-14 items-center justify-center rounded-full ${
                isMuted ? 'bg-red-500' : 'bg-white/20'
              } text-white hover:bg-white/30`}
            >
              {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
            </button>

            {/* Video toggle (only for video calls) */}
            {isVideoCall && (
              <button
                onClick={toggleVideo}
                className={`flex h-14 w-14 items-center justify-center rounded-full ${
                  !isVideoEnabled ? 'bg-red-500' : 'bg-white/20'
                } text-white hover:bg-white/30`}
              >
                {isVideoEnabled ? <Video size={24} /> : <VideoOff size={24} />}
              </button>
            )}

            {/* Screen share (only for video calls) */}
            {isVideoCall && (
              <button
                onClick={toggleScreenShare}
                className={`flex h-14 w-14 items-center justify-center rounded-full ${
                  isScreenSharing ? 'bg-blue-500' : 'bg-white/20'
                } text-white hover:bg-white/30`}
              >
                <Monitor size={24} />
              </button>
            )}

            {/* End call */}
            <button
              onClick={endCall}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600"
            >
              <PhoneOff size={24} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
