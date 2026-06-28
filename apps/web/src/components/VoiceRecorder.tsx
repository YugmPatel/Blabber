import { useState, useRef, useEffect } from 'react';
import { Mic, Square, Send, Trash2 } from 'lucide-react';

interface VoiceRecorderProps {
  onSend: (audioBlob: Blob, duration: number) => void | Promise<void>;
  onCancel: () => void;
}

export default function VoiceRecorder({ onSend, onCancel }: VoiceRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [duration, setDuration] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const startRecording = async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      };

      mediaRecorder.start();
      setIsRecording(true);
      setDuration(0);

      timerRef.current = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);
    } catch {
      setError('Unable to access microphone. Please check permissions.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  };

  const handleSend = async () => {
    if (!audioBlob || isSending) return;
    try {
      setIsSending(true);
      setError(null);
      await onSend(audioBlob, duration);
    } catch {
      setError('Audio recording could not be sent. Please try again.');
      setIsSending(false);
    }
  };

  const handleCancel = () => {
    if (isRecording) {
      stopRecording();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    onCancel();
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
      {error && (
        <div className="mb-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300">
          {error}
        </div>
      )}
      <div className="flex items-center gap-3">
        {/* Cancel button */}
        <button
          onClick={handleCancel}
          disabled={isSending}
          className="rounded-full p-2 text-rose-500 hover:bg-rose-50 disabled:opacity-50 dark:hover:bg-rose-950/30"
          aria-label="Cancel voice message"
        >
          <Trash2 size={20} />
        </button>

        {/* Recording indicator / Audio preview */}
        <div className="flex flex-1 items-center gap-3">
          {isRecording ? (
            <>
              <div className="h-3 w-3 animate-pulse rounded-full bg-rose-500" />
              <span className="font-medium text-slate-700 dark:text-slate-200">
                {formatDuration(duration)}
              </span>
              <div className="h-8 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                <div className="h-full animate-pulse bg-rose-400" style={{ width: '100%' }} />
              </div>
            </>
          ) : audioUrl ? (
            <>
              <span className="font-medium text-slate-700 dark:text-slate-200">
                {formatDuration(duration)}
              </span>
              <audio src={audioUrl} controls className="h-8 flex-1" />
            </>
          ) : (
            <span className="text-slate-500 dark:text-slate-400">Tap mic to start recording</span>
          )}
        </div>

        {/* Record / Stop / Send button */}
        {!audioBlob ? (
          <button
            onClick={isRecording ? stopRecording : startRecording}
            disabled={isSending}
            className={`p-3 rounded-full ${
              isRecording
                ? 'bg-rose-500 text-white hover:bg-rose-600'
                : 'bg-teal-600 text-white hover:bg-teal-700'
            }`}
            aria-label={isRecording ? 'Stop recording' : 'Start recording'}
          >
            {isRecording ? <Square size={20} /> : <Mic size={20} />}
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={isSending}
            className="rounded-full bg-teal-600 p-3 text-white hover:bg-teal-700 disabled:opacity-50"
            aria-label="Send voice message"
          >
            <Send size={20} />
          </button>
        )}
      </div>
    </div>
  );
}
