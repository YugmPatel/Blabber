import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import axios from 'axios';

// Mock axios
vi.mock('axios');

// Mock apiClient - must be defined inline to avoid hoisting issues
vi.mock('@/api/client', () => ({
  apiClient: {
    post: vi.fn(),
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
  },
}));

// Import after mocking
import { apiClient } from '@/api/client';
import { useFileUpload } from './useFileUpload';

describe('useFileUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uploads file successfully', async () => {
    const mockPresignResponse = {
      data: {
        uploadUrl: 'https://s3.amazonaws.com/bucket/key?signature=xyz',
        mediaId: 'media-123',
        expiresIn: 300,
      },
    };

    vi.mocked(apiClient.post).mockResolvedValue(mockPresignResponse);
    vi.mocked(axios.put).mockResolvedValue({ data: {} });

    const { result } = renderHook(() => useFileUpload());

    const file = new File(['test content'], 'test.png', { type: 'image/png' });
    const mediaId = await result.current.uploadFile(file);

    // Should return media ID
    expect(mediaId).toBe('media-123');

    // Should request presigned URL
    expect(apiClient.post).toHaveBeenCalledWith('/api/media/presign', {
      fileName: 'test.png',
      fileType: 'image/png',
      fileSize: file.size,
    });

    // Should upload to S3
    expect(axios.put).toHaveBeenCalledWith(
      'https://s3.amazonaws.com/bucket/key?signature=xyz',
      file,
      expect.objectContaining({
        headers: {
          'Content-Type': 'image/png',
        },
      })
    );
  });

  it('calls onUploadProgress callback', async () => {
    const mockPresignResponse = {
      data: {
        uploadUrl: 'https://s3.amazonaws.com/bucket/key',
        mediaId: 'media-123',
        expiresIn: 300,
      },
    };

    vi.mocked(apiClient.post).mockResolvedValue(mockPresignResponse);

    // Mock axios.put to simulate progress
    vi.mocked(axios.put).mockImplementation((_url, _data, config) => {
      // Simulate progress callback
      if (config?.onUploadProgress) {
        config.onUploadProgress({
          loaded: 50,
          total: 100,
        } as any);
      }
      return Promise.resolve({ data: {} });
    });

    const { result } = renderHook(() => useFileUpload());

    const file = new File(['test content'], 'test.png', { type: 'image/png' });
    await result.current.uploadFile(file);

    // Verify axios.put was called with onUploadProgress
    expect(axios.put).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(File),
      expect.objectContaining({
        onUploadProgress: expect.any(Function),
      })
    );
  });

  it('handles presign request error', async () => {
    const mockError = new Error('Failed to get presigned URL');
    vi.mocked(apiClient.post).mockRejectedValue(mockError);

    const { result } = renderHook(() => useFileUpload());

    const file = new File(['test content'], 'test.png', { type: 'image/png' });
    const mediaId = await result.current.uploadFile(file);

    // Should return null on error
    expect(mediaId).toBeNull();
  });

  it('handles S3 upload error', async () => {
    const mockPresignResponse = {
      data: {
        uploadUrl: 'https://s3.amazonaws.com/bucket/key',
        mediaId: 'media-123',
        expiresIn: 300,
      },
    };

    vi.mocked(apiClient.post).mockResolvedValue(mockPresignResponse);
    vi.mocked(axios.put).mockRejectedValue(new Error('S3 upload failed'));

    const { result } = renderHook(() => useFileUpload());

    const file = new File(['test content'], 'test.png', { type: 'image/png' });
    const mediaId = await result.current.uploadFile(file);

    // Should return null on error
    expect(mediaId).toBeNull();
  });

  it('resets state when reset is called', async () => {
    const mockPresignResponse = {
      data: {
        uploadUrl: 'https://s3.amazonaws.com/bucket/key',
        mediaId: 'media-123',
        expiresIn: 300,
      },
    };

    vi.mocked(apiClient.post).mockResolvedValue(mockPresignResponse);
    vi.mocked(axios.put).mockResolvedValue({ data: {} });

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
    vi.mocked(apiClient.post).mockRejectedValue('String error');

    const { result } = renderHook(() => useFileUpload());

    const file = new File(['test content'], 'test.png', { type: 'image/png' });
    const mediaId = await result.current.uploadFile(file);

    expect(mediaId).toBeNull();
  });

  it('completes upload successfully', async () => {
    const mockPresignResponse = {
      data: {
        uploadUrl: 'https://s3.amazonaws.com/bucket/key',
        mediaId: 'media-123',
        expiresIn: 300,
      },
    };

    vi.mocked(apiClient.post).mockResolvedValue(mockPresignResponse);
    vi.mocked(axios.put).mockImplementation((_url, _data, config) => {
      if (config?.onUploadProgress) {
        config.onUploadProgress({
          loaded: 100,
          total: 100,
        } as any);
      }
      return Promise.resolve({ data: {} });
    });

    const { result } = renderHook(() => useFileUpload());

    const file = new File(['test content'], 'test.png', { type: 'image/png' });
    const mediaId = await result.current.uploadFile(file);

    expect(mediaId).toBe('media-123');
  });

  it('uploads different file types', async () => {
    const mockPresignResponse = {
      data: {
        uploadUrl: 'https://s3.amazonaws.com/bucket/key',
        mediaId: 'media-123',
        expiresIn: 300,
      },
    };

    vi.mocked(apiClient.post).mockResolvedValue(mockPresignResponse);
    vi.mocked(axios.put).mockResolvedValue({ data: {} });

    const { result } = renderHook(() => useFileUpload());

    // Test PDF upload
    const pdfFile = new File(['pdf content'], 'document.pdf', {
      type: 'application/pdf',
    });
    await result.current.uploadFile(pdfFile);

    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/media/presign',
      expect.objectContaining({
        fileType: 'application/pdf',
      })
    );

    // Test audio upload
    const audioFile = new File(['audio content'], 'audio.mp3', { type: 'audio/mpeg' });
    await result.current.uploadFile(audioFile);

    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/media/presign',
      expect.objectContaining({
        fileType: 'audio/mpeg',
      })
    );
  });
});
