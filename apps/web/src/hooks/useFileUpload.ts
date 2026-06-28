import { useState, useCallback } from 'react';
import axios from 'axios';
import type { AxiosError } from 'axios';
import { API_URL, getAccessToken } from '@/api/client';

export interface UploadResult {
  mediaId: string;
  mediaUrl?: string;
  publicUrl?: string;
  storageKey?: string;
  fileName?: string;
  mimeType?: string;
  size?: number;
}

interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

interface UseFileUploadResult {
  uploadMedia?: (file: File) => Promise<UploadResult | null>;
  uploadFile: (file: File) => Promise<string | null>;
  isUploading: boolean;
  uploadProgress: UploadProgress | null;
  error: string | null;
  reset: () => void;
}

export const useFileUpload = (): UseFileUploadResult => {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const getUploadErrorMessage = (err: unknown) => {
    if (axios.isAxiosError(err)) {
      const axiosError = err as AxiosError<{ message?: string; error?: string }>;
      return (
        axiosError.response?.data?.message ||
        axiosError.response?.data?.error ||
        axiosError.message ||
        'Failed to upload file'
      );
    }

    return err instanceof Error ? err.message : 'Failed to upload file';
  };

  const uploadMedia = useCallback(async (file: File): Promise<UploadResult | null> => {
    setIsUploading(true);
    setError(null);
    setUploadProgress(null);

    try {
      const formData = new FormData();
      formData.append('file', file, file.name);
      formData.append('fileName', file.name);
      formData.append('fileType', file.type);
      formData.append('fileSize', String(file.size));

      const headers: Record<string, string> = {};
      const token = getAccessToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const uploadResponse = await axios.post<UploadResult>(`${API_URL}/api/media/upload`, formData, {
        headers,
        withCredentials: true,
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const percentage = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            setUploadProgress({
              loaded: progressEvent.loaded,
              total: progressEvent.total,
              percentage,
            });
          }
        },
      });

      setIsUploading(false);
      setUploadProgress(null);

      return {
        mediaId: uploadResponse.data.mediaId,
        mediaUrl: uploadResponse.data.mediaUrl || uploadResponse.data.publicUrl,
        publicUrl: uploadResponse.data.publicUrl,
        storageKey: uploadResponse.data.storageKey,
        fileName: uploadResponse.data.fileName || file.name,
        mimeType: uploadResponse.data.mimeType || file.type,
        size: uploadResponse.data.size || file.size,
      };
    } catch (err) {
      const errorMessage = getUploadErrorMessage(err);
      setError(errorMessage);
      setIsUploading(false);
      setUploadProgress(null);
      return null;
    }
  }, []);

  const uploadFile = useCallback(
    async (file: File): Promise<string | null> => {
      const result = await uploadMedia(file);
      return result?.mediaId ?? null;
    },
    [uploadMedia]
  );

  const reset = useCallback(() => {
    setIsUploading(false);
    setUploadProgress(null);
    setError(null);
  }, []);

  return {
    uploadMedia,
    uploadFile,
    isUploading,
    uploadProgress,
    error,
    reset,
  };
};
