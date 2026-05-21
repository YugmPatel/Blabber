import { useState, useCallback } from 'react';
import axios from 'axios';
import type { AxiosError } from 'axios';
import { apiClient, getAccessToken } from '@/api/client';

interface PresignResponse {
  uploadUrl: string;
  mediaId: string;
  mediaUrl?: string;
  publicUrl?: string;
  storageKey?: string;
  fileName?: string;
  mimeType?: string;
  size?: number;
  expiresIn?: number;
  uploadMethod?: 'PUT';
  uploadAuthRequired?: boolean;
  storage?: 's3' | 'local';
}

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
      // 1. Request presigned URL from media service
      const { data: presignData } = await apiClient.post<PresignResponse>('/api/media/presign', {
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
      });

      // 2. Upload file directly to the returned media target.
      const headers: Record<string, string> = {
        'Content-Type': file.type,
      };

      if (presignData.uploadAuthRequired) {
        const token = getAccessToken();
        if (!token) {
          throw new Error('Authentication is required to upload this file');
        }
        headers.Authorization = `Bearer ${token}`;
      }

      const uploadResponse = await axios.put<Partial<UploadResult>>(presignData.uploadUrl, file, {
        headers,
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
        mediaId: uploadResponse.data.mediaId || presignData.mediaId,
        mediaUrl:
          uploadResponse.data.mediaUrl ||
          uploadResponse.data.publicUrl ||
          presignData.mediaUrl ||
          presignData.publicUrl,
        publicUrl: uploadResponse.data.publicUrl || presignData.publicUrl,
        storageKey: uploadResponse.data.storageKey || presignData.storageKey,
        fileName: uploadResponse.data.fileName || presignData.fileName || file.name,
        mimeType: uploadResponse.data.mimeType || presignData.mimeType || file.type,
        size: uploadResponse.data.size || presignData.size || file.size,
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
