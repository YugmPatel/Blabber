import { useState, useRef, useEffect } from 'react';
import { Mic, Square, Send, Trash2 } from 'lucide-react';

interface VoiceRecorderProps {
  onSend: (audioBlob: Blob, duration: number) => void;
  onCancel: () => void;
}

export default function VoiceRecorder({ onSend, onCancel }: VoiceRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
      };

      mediaRecorder.start();
      setIsRecording(true);
      setDuration(0);

      timerRef.current = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('Microphone error:', err);
      alert('Unable to access microphone. Please check permissions.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    }
  };

  const handleSend = () => {
    if (audioBlob) {
      onSend(audioBlob, duration);
    }
  };

  const handleCancel = () => {
    if (isRecording) {
      stopRecording();
    }
    onCancel();
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex items-center gap-3 bg-[#f0f2f5] px-4 py-3 border-t border-gray-100">
      {/* Cancel button */}
      <button onClick={handleCancel} className="p-2 rounded-full text-red-500 hover:bg-red-50">
        <Trash2 size={20} />
      </button>

      {/* Recording indicator / Audio preview */}
      <div className="flex-1 flex items-center gap-3">
        {isRecording ? (
          <>
            <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
            <span className="text-gray-700 font-medium">{formatDuration(duration)}</span>
            <div className="flex-1 h-8 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-red-400 animate-pulse" style={{ width: '100%' }} />
            </div>
          </>
        ) : audioUrl ? (
          <>
            <span className="text-gray-700 font-medium">{formatDuration(duration)}</span>
            <audio src={audioUrl} controls className="flex-1 h-8" />
          </>
        ) : (
          <span className="text-gray-500">Tap mic to start recording</span>
        )}
      </div>

      {/* Record / Stop / Send button */}
      {!audioBlob ? (
        <button
          onClick={isRecording ? stopRecording : startRecording}
          className={`p-3 rounded-full ${
            isRecording
              ? 'bg-red-500 text-white hover:bg-red-600'
              : 'bg-[#00a884] text-white hover:bg-[#008f72]'
          }`}
        >
          {isRecording ? <Square size={20} /> : <Mic size={20} />}
        </button>
      ) : (
        <button
          onClick={handleSend}
          className="p-3 rounded-full bg-[#00a884] text-white hover:bg-[#008f72]"
        >
          <Send size={20} />
        </button>
      )}
    </div>
  );
}
