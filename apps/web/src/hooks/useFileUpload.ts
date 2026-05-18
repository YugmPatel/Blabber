import { useState, useCallback } from 'react';
import axios from 'axios';
import type { AxiosError } from 'axios';
import { apiClient, getAccessToken } from '@/api/client';

interface PresignResponse {
  uploadUrl: string;
  mediaId: string;
  mediaUrl?: string;
  expiresIn?: number;
  uploadMethod?: 'PUT';
  uploadAuthRequired?: boolean;
  storage?: 's3' | 'local';
}

interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

export const useFileUpload = () => {
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

  const uploadFile = useCallback(async (file: File): Promise<string | null> => {
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

      await axios.put(presignData.uploadUrl, file, {
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

      // 3. Return media ID
      setIsUploading(false);
      setUploadProgress(null);
      return presignData.mediaId;
    } catch (err) {
      const errorMessage = getUploadErrorMessage(err);
      setError(errorMessage);
      setIsUploading(false);
      setUploadProgress(null);
      return null;
    }
  }, []);

  const reset = useCallback(() => {
    setIsUploading(false);
    setUploadProgress(null);
    setError(null);
  }, []);

  return {
    uploadFile,
    isUploading,
    uploadProgress,
    error,
    reset,
  };
};
