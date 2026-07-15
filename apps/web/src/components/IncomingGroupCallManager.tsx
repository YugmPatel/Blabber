import { useEffect, useRef, useState } from 'react';
import { Phone, PhoneOff, Users, Video, X } from 'lucide-react';
import type { Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import type {
  Chat,
  ClientToServerEvents,
  GroupCallStartPayload,
  ServerToClientEvents,
} from '@repo/types';
import { apiClient } from '@/api/client';
import { chatKeys } from '@/hooks/useChats';
import { useAuth } from '@/contexts/AuthContext';
import Avatar from './Avatar';
import GroupCallModal from './GroupCallModal';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface IncomingGroupCallManagerProps {
  socket: TypedSocket | null;
  isConnected: boolean;
}

interface ActiveGroupCall {
  chat: Chat;
  callId: string;
  callType: 'audio' | 'video';
  isInitiator: boolean;
}

function isValidIncomingCall(data: GroupCallStartPayload | null | undefined) {
  return Boolean(
    data?.callId &&
      data.chatId &&
      data.fromUserId &&
      (data.callType === 'audio' || data.callType === 'video')
  );
}

async function fetchChat(chatId: string) {
  const { data } = await apiClient.get<{ chat: Chat }>(`/api/chats/${chatId}`);
  return data.chat;
}

export default function IncomingGroupCallManager({ socket, isConnected }: IncomingGroupCallManagerProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [incomingCall, setIncomingCall] = useState<GroupCallStartPayload | null>(null);
  const [activeCall, setActiveCall] = useState<ActiveGroupCall | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const seenCallIdsRef = useRef(new Set<string>());
  const staleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!socket || !isConnected || !user?._id) return;

    const handleIncoming = (data: GroupCallStartPayload) => {
      if (!isValidIncomingCall(data) || data.fromUserId === user._id) return;
      if (seenCallIdsRef.current.has(data.callId)) return;
      seenCallIdsRef.current.add(data.callId);
      setJoinError(null);
      setIncomingCall(data);

      if (staleTimerRef.current) clearTimeout(staleTimerRef.current);
      staleTimerRef.current = setTimeout(() => {
        setIncomingCall((current) => (current?.callId === data.callId ? null : current));
      }, 60_000);
    };

    socket.on('group-call:incoming', handleIncoming);
    return () => {
      socket.off('group-call:incoming', handleIncoming);
    };
  }, [socket, isConnected, user?._id]);

  useEffect(() => {
    if (!socket || !isConnected) return;

    const handleEnded = (data: { callId: string; chatId: string }) => {
      setIncomingCall((current) => (current?.callId === data.callId ? null : current));
      setActiveCall((current) => (current?.callId === data.callId ? null : current));
      queryClient.setQueryData(['chats', data.chatId, 'active-group-call'], null);
    };
    const handleParticipants = (data: {
      callId: string;
      chatId: string;
      activeParticipantIds: string[];
    }) => {
      if (data.activeParticipantIds.length === 0) {
        handleEnded(data);
      }
    };

    socket.on('group-call:ended', handleEnded);
    socket.on('group-call:participants', handleParticipants);
    return () => {
      socket.off('group-call:ended', handleEnded);
      socket.off('group-call:participants', handleParticipants);
    };
  }, [socket, isConnected, queryClient]);

  useEffect(() => {
    return () => {
      if (staleTimerRef.current) clearTimeout(staleTimerRef.current);
    };
  }, []);

  const decline = () => {
    if (incomingCall && socket && user?._id) {
      socket.emit('group-call:decline', {
        callId: incomingCall.callId,
        chatId: incomingCall.chatId,
        fromUserId: user._id,
        toUserId: incomingCall.fromUserId,
      });
    }
    setIncomingCall(null);
  };

  const join = async () => {
    if (!incomingCall) return;
    try {
      setJoinError(null);
      const chat = await queryClient.fetchQuery({
        queryKey: chatKeys.detail(incomingCall.chatId),
        queryFn: () => fetchChat(incomingCall.chatId),
      });
      setActiveCall({
        chat,
        callId: incomingCall.callId,
        callType: incomingCall.callType,
        isInitiator: false,
      });
      setIncomingCall(null);
    } catch {
      setJoinError('We could not open this group call. Try again.');
    }
  };

  const groupTitle = incomingCall?.chatTitle || 'Group call';
  const isVideo = incomingCall?.callType === 'video';

  return (
    <>
      {incomingCall && !activeCall && (
        <div className="fixed inset-x-4 top-4 z-[115] mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-start gap-3">
            {incomingCall.fromUserAvatarUrl || incomingCall.chatAvatarUrl ? (
              <Avatar src={incomingCall.fromUserAvatarUrl || incomingCall.chatAvatarUrl} alt={incomingCall.fromUserName || groupTitle} size="md" />
            ) : (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-600">
                <Users size={18} className="text-white" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-slate-900 dark:text-white">
                {isVideo ? <Video size={15} /> : <Phone size={15} />}
                Incoming {incomingCall.callType} call
              </p>
              <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
                {incomingCall.fromUserName || 'Someone'} is calling {groupTitle}
              </p>
              {joinError && (
                <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{joinError}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setIncomingCall(null)}
              className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              aria-label="Dismiss incoming call"
            >
              <X size={16} />
            </button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={decline}
              className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <PhoneOff size={16} />
              Decline
            </button>
            <button
              type="button"
              onClick={() => void join()}
              className="flex items-center justify-center gap-2 rounded-xl bg-teal-600 py-2 text-sm font-semibold text-white transition hover:bg-teal-700"
            >
              {isVideo ? <Video size={16} /> : <Phone size={16} />}
              Join
            </button>
          </div>
        </div>
      )}

      {activeCall && (
        <GroupCallModal
          chat={activeCall.chat}
          title={activeCall.chat.title || incomingCall?.chatTitle || 'Group call'}
          callType={activeCall.callType}
          callId={activeCall.callId}
          isInitiator={activeCall.isInitiator}
          onClose={() => setActiveCall(null)}
        />
      )}
    </>
  );
}
