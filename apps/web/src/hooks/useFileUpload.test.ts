import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import axios from 'axios';

// Mock axios
vi.mock('axios');

// Mock apiClient - must be defined inline to avoid hoisting issues
vi.mock('@/api/client', () => ({
  API_URL: 'http://localhost:3000',
  getAccessToken: vi.fn(() => 'test-token'),
  apiClient: {
    post: vi.fn(),
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
  },
}));

import { useFileUpload } from './useFileUpload';

describe('useFileUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uploads file successfully', async () => {
    const mockUploadResponse = {
      data: {
        mediaId: 'media-123',
        publicUrl: 'https://cdn.example.com/test.png',
        fileName: 'test.png',
        mimeType: 'image/png',
        size: 12,
      },
    };

    vi.mocked(axios.post).mockResolvedValue(mockUploadResponse);

    const { result } = renderHook(() => useFileUpload());

    const file = new File(['test content'], 'test.png', { type: 'image/png' });
    const mediaId = await result.current.uploadFile(file);

    // Should return media ID
    expect(mediaId).toBe('media-123');

    expect(axios.post).toHaveBeenCalledWith(
      'http://localhost:3000/api/media/upload',
      expect.any(FormData),
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-token' },
        withCredentials: true,
        onUploadProgress: expect.any(Function),
      })
    );
  });

  it('calls onUploadProgress callback', async () => {
    const mockUploadResponse = {
      data: {
        mediaId: 'media-123',
      },
    };

    vi.mocked(axios.post).mockImplementation((_url, _data, config) => {
      // Simulate progress callback
      if (config?.onUploadProgress) {
        config.onUploadProgress({
          loaded: 50,
          total: 100,
        } as any);
      }
      return Promise.resolve(mockUploadResponse);
    });

    const { result } = renderHook(() => useFileUpload());

    const file = new File(['test content'], 'test.png', { type: 'image/png' });
    await result.current.uploadFile(file);

    expect(axios.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(FormData),
      expect.objectContaining({
        onUploadProgress: expect.any(Function),
      })
    );
  });

  it('handles presign request error', async () => {
    const mockError = new Error('Failed to get presigned URL');
    vi.mocked(axios.post).mockRejectedValue(mockError);

    const { result } = renderHook(() => useFileUpload());

    const file = new File(['test content'], 'test.png', { type: 'image/png' });
    const mediaId = await result.current.uploadFile(file);

    // Should return null on error
    expect(mediaId).toBeNull();
  });

  it('handles upload error', async () => {
    vi.mocked(axios.post).mockRejectedValue(new Error('Upload failed'));

    const { result } = renderHook(() => useFileUpload());

    const file = new File(['test content'], 'test.png', { type: 'image/png' });
    const mediaId = await result.current.uploadFile(file);

    // Should return null on error
    expect(mediaId).toBeNull();
  });

  it('resets state when reset is called', async () => {
    const mockUploadResponse = {
      data: {
        mediaId: 'media-123',
      },
    };

    vi.mocked(axios.post).mockResolvedValue(mockUploadResponse);

    const { result } = renderHook(() => useFileUpload());

    const file = new File(['test content'], 'test.png', { type: 'image/png' });
    await result.current.uploadFile(file);

    // Reset state
    result.current.reset();

    expect(result.current.isUploading).toBe(false);
    expect(result.current.uploadProgress).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('handles non-Error exceptions', async () => {
    vi.mocked(axios.post).mockRejectedValue('String error');

    const { result } = renderHook(() => useFileUpload());

    const file = new File(['test content'], 'test.png', { type: 'image/png' });
    const mediaId = await result.current.uploadFile(file);

    expect(mediaId).toBeNull();
  });

  it('completes upload successfully', async () => {
    const mockUploadResponse = {
      data: {
        mediaId: 'media-123',
      },
    };

    vi.mocked(axios.post).mockImplementation((_url, _data, config) => {
      if (config?.onUploadProgress) {
        config.onUploadProgress({
          loaded: 100,
          total: 100,
        } as any);
      }
      return Promise.resolve(mockUploadResponse);
    });

    const { result } = renderHook(() => useFileUpload());

    const file = new File(['test content'], 'test.png', { type: 'image/png' });
    const mediaId = await result.current.uploadFile(file);

    expect(mediaId).toBe('media-123');
  });

  it('uploads different file types', async () => {
    const mockUploadResponse = {
      data: {
        mediaId: 'media-123',
      },
    };

    vi.mocked(axios.post).mockResolvedValue(mockUploadResponse);

    const { result } = renderHook(() => useFileUpload());

    // Test PDF upload
    const pdfFile = new File(['pdf content'], 'document.pdf', {
      type: 'application/pdf',
    });
    await result.current.uploadFile(pdfFile);

    let formData = vi.mocked(axios.post).mock.calls[0][1] as FormData;
    expect(formData.get('fileType')).toBe('application/pdf');

    // Test audio upload
    const audioFile = new File(['audio content'], 'audio.mp3', { type: 'audio/mpeg' });
    await result.current.uploadFile(audioFile);

    formData = vi.mocked(axios.post).mock.calls[1][1] as FormData;
    expect(formData.get('fileType')).toBe('audio/mpeg');
  });
});
