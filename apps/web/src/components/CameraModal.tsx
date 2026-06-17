import { useState, useRef, useEffect } from 'react';
import { X, Camera, RotateCcw } from 'lucide-react';

interface CameraModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (file: File) => void | Promise<void>;
  confirmLabel?: string;
}

export default function CameraModal({
  isOpen,
  onClose,
  onCapture,
  confirmLabel = 'Send Photo',
}: CameraModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);

  const waitForCameraFrame = (video: HTMLVideoElement) =>
    new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();

      const checkFrame = () => {
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          resolve();
          return;
        }

        if (Date.now() - startedAt > 5000) {
          reject(new Error('Camera preview timed out'));
          return;
        }

        window.setTimeout(checkFrame, 100);
      };

      checkFrame();
    });

  const withCameraStartupTimeout = (promise: Promise<unknown>) =>
    Promise.race([
      promise,
      new Promise((_, reject) => {
        window.setTimeout(() => reject(new Error('Camera preview timed out')), 5000);
      }),
    ]);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsStarting(false);
    setIsCameraReady(false);
  };

  const startCamera = async () => {
    try {
      stopCamera();
      setError(null);
      setIsStarting(true);

      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Camera capture is not available in this browser.');
        setIsStarting(false);
        return;
      }

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode },
        audio: false,
      });
      streamRef.current = mediaStream;

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        const video = videoRef.current;
        const playPromise = video.play();
        await withCameraStartupTimeout(
          Promise.race([
            waitForCameraFrame(video),
            playPromise.then(() => waitForCameraFrame(video)),
          ])
        );
        setIsCameraReady(true);
      }
    } catch {
      const hadStream = !!streamRef.current;
      stopCamera();
      setError(
        hadStream
          ? 'Camera preview could not start. Please try again or use photo upload.'
          : 'Unable to access camera. Please check permissions.'
      );
    } finally {
      setIsStarting(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setCapturedImage(null);
      void startCamera();
    }
    return () => {
      stopCamera();
    };
  }, [isOpen, facingMode]);

  const handleCapture = () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!isCameraReady || !video.videoWidth || !video.videoHeight) {
      setError('Camera is still starting. Please try again in a moment.');
      return;
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0);
      const imageData = canvas.toDataURL('image/jpeg', 0.8);
      setCapturedImage(imageData);
      stopCamera();
    }
  };

  const handleRetake = () => {
    setCapturedImage(null);
    void startCamera();
  };

  const handleSend = async () => {
    if (!capturedImage) return;

    try {
      setIsSending(true);
      const response = await fetch(capturedImage);
      const blob = await response.blob();
      const file = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
      await onCapture(file);
      handleClose();
    } catch {
      setError('The captured photo could not be sent. Please try again.');
      setIsSending(false);
    }
  };

  const handleClose = () => {
    stopCamera();
    setCapturedImage(null);
    setError(null);
    setIsSending(false);
    onClose();
  };

  const toggleCamera = () => {
    setFacingMode((prev) => (prev === 'user' ? 'environment' : 'user'));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between p-4 z-10">
        <button
          onClick={handleClose}
          className="p-2 rounded-full bg-black/50 text-white hover:bg-black/70"
        >
          <X size={24} />
        </button>
        {!capturedImage && (
          <button
            onClick={toggleCamera}
            className="p-2 rounded-full bg-black/50 text-white hover:bg-black/70"
          >
            <RotateCcw size={24} />
          </button>
        )}
      </div>

      {/* Camera view or captured image */}
      <div className="relative w-full h-full flex items-center justify-center">
        {error ? (
          <div className="text-white text-center p-4">
            <p className="mb-4">{error}</p>
            <button
              onClick={() => void startCamera()}
              className="px-4 py-2 bg-[#00a884] rounded-lg hover:bg-[#008f72]"
            >
              Try Again
            </button>
          </div>
        ) : capturedImage ? (
          <img
            src={capturedImage}
            alt="Captured"
            className="max-w-full max-h-full object-contain"
          />
        ) : (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="max-w-full max-h-full object-contain"
            />
            {isStarting && !isCameraReady && (
              <div className="absolute rounded-lg bg-black/60 px-4 py-2 text-sm text-white">
                Starting camera...
              </div>
            )}
          </>
        )}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      {/* Bottom controls */}
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-8 p-8">
        {capturedImage ? (
          <>
            <button
              onClick={handleRetake}
              className="px-6 py-3 bg-gray-600 text-white rounded-full hover:bg-gray-700"
            >
              Retake
            </button>
            <button
              onClick={handleSend}
              disabled={isSending}
              className="px-6 py-3 bg-[#00a884] text-white rounded-full hover:bg-[#008f72] disabled:opacity-50"
            >
              {isSending ? 'Sending...' : confirmLabel}
            </button>
          </>
        ) : (
          <button
            onClick={handleCapture}
            className="w-16 h-16 rounded-full bg-white border-4 border-gray-300 hover:border-[#00a884] transition-colors flex items-center justify-center"
            disabled={!!error}
          >
            <Camera size={28} className="text-gray-700" />
          </button>
        )}
      </div>
    </div>
  );
}
