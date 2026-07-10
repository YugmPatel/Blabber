import { ObjectId } from 'mongodb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const execFileMock = vi.fn();
const readdirMock = vi.fn();
const mkdirMock = vi.fn();
const rmMock = vi.fn();
const mediaFindOneMock = vi.fn();
const reelCollection = {
  findOneAndUpdate: vi.fn(),
  updateOne: vi.fn(),
  findOne: vi.fn(),
};

vi.mock('child_process', () => ({
  execFile: execFileMock,
}));

vi.mock('fs', () => ({
  promises: {
    readdir: readdirMock,
    mkdir: mkdirMock,
    rm: rmMock,
  },
}));

vi.mock('./db', () => ({
  getDatabase: () => ({
    collection: () => ({
      findOne: mediaFindOneMock,
    }),
  }),
}));

vi.mock('./models/reel', () => ({
  getReelsCollection: () => reelCollection,
}));

vi.mock('@repo/utils', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const { processOnePendingReel } = await import('./reel-processing');

function reelFixture(overrides = {}) {
  return {
    _id: new ObjectId(),
    authorUserId: new ObjectId(),
    sourceMediaId: new ObjectId(),
    processingStatus: 'validating',
    publishState: 'draft',
    caption: '',
    visibility: 'public',
    topicIds: [],
    processingKey: 'processing-key',
    createdAt: new Date(),
    updatedAt: new Date(),
    schemaVersion: 1,
    ...overrides,
  };
}

function sourceFixture(reel: ReturnType<typeof reelFixture>) {
  return {
    _id: reel.sourceMediaId,
    userId: reel.authorUserId,
    status: 'approved',
    purpose: 'reel_source',
    fileType: 'video/mp4',
    localPath: '/data/blabber-media/reel-source.mp4',
  };
}

function mockFfmpegSuccess() {
  execFileMock.mockImplementation((file, _args, _options, callback) => {
    if (file === 'ffprobe') {
      callback(null, {
        stdout: JSON.stringify({
          streams: [
            {
              codec_type: 'video',
              codec_name: 'h264',
              width: 720,
              height: 1280,
              duration: '8',
              bit_rate: '1000000',
              r_frame_rate: '30/1',
            },
            { codec_type: 'audio', codec_name: 'aac' },
          ],
          format: { duration: '8', bit_rate: '1000000' },
        }),
        stderr: '',
      });
      return;
    }
    callback(null, { stdout: '', stderr: '' });
  });
}

describe('reel processing recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LOCAL_MEDIA_DIR = '/data/blabber-media';
    mediaFindOneMock.mockReset();
    reelCollection.findOneAndUpdate.mockReset();
    reelCollection.updateOne.mockReset();
    reelCollection.findOne.mockReset();
    readdirMock.mockResolvedValue(['segment_000.ts']);
    mkdirMock.mockResolvedValue(undefined);
    rmMock.mockResolvedValue(undefined);
    mockFfmpegSuccess();
  });

  it('claims uploaded work and stale validating or processing jobs without reviving deleted reels', async () => {
    reelCollection.findOneAndUpdate.mockResolvedValue(null);

    await expect(processOnePendingReel()).resolves.toBe(false);

    const claimFilter = reelCollection.findOneAndUpdate.mock.calls[0][0];
    expect(claimFilter.deletedAt).toEqual({ $exists: false });
    expect(claimFilter.publishState).toEqual({ $ne: 'deleted' });
    expect(claimFilter.$or).toEqual(
      expect.arrayContaining([
        { processingStatus: 'uploaded' },
        expect.objectContaining({
          processingStatus: { $in: ['validating', 'processing'] },
          processingStartedAt: expect.objectContaining({ $lte: expect.any(Date) }),
        }),
      ])
    );
  });

  it('uses a lease for worker restart recovery and prevents duplicate ready updates', async () => {
    const reel = reelFixture();
    reelCollection.findOneAndUpdate
      .mockResolvedValueOnce(reel)
      .mockResolvedValueOnce({ ...reel, processingStatus: 'ready' });
    reelCollection.updateOne.mockResolvedValue({ matchedCount: 1 });
    reelCollection.findOne.mockResolvedValue(reel);
    mediaFindOneMock.mockResolvedValue(sourceFixture(reel));

    await expect(processOnePendingReel()).resolves.toBe(true);

    const claimUpdate = reelCollection.findOneAndUpdate.mock.calls[0][1];
    const finalFilter = reelCollection.findOneAndUpdate.mock.calls[1][0];
    const finalUpdate = reelCollection.findOneAndUpdate.mock.calls[1][1];
    expect(claimUpdate.$set.processingLeaseId).toEqual(expect.any(String));
    expect(finalFilter.processingLeaseId).toBe(claimUpdate.$set.processingLeaseId);
    expect(finalUpdate.$set.processingStatus).toBe('ready');
    expect(finalUpdate.$unset.processingLeaseId).toBe('');
  });

  it('does not publish output when a recovered job loses its lease', async () => {
    const reel = reelFixture();
    reelCollection.findOneAndUpdate.mockResolvedValueOnce(reel);
    reelCollection.updateOne.mockResolvedValueOnce({ matchedCount: 0 });
    reelCollection.findOne.mockResolvedValue(null);
    mediaFindOneMock.mockResolvedValue(sourceFixture(reel));

    await expect(processOnePendingReel()).resolves.toBe(true);

    expect(reelCollection.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(reelCollection.updateOne.mock.calls.at(-1)?.[0]).toMatchObject({
      _id: reel._id,
      deletedAt: { $exists: false },
    });
  });

  it('does not clean partial derivatives after cancellation removes the active lease', async () => {
    const reel = reelFixture();
    reelCollection.findOneAndUpdate.mockResolvedValueOnce(reel);
    reelCollection.updateOne.mockResolvedValueOnce({ matchedCount: 0 });
    reelCollection.findOne.mockResolvedValue(null);
    mediaFindOneMock.mockResolvedValue(sourceFixture(reel));

    await processOnePendingReel();

    expect(rmMock).not.toHaveBeenCalled();
    expect(mkdirMock).not.toHaveBeenCalled();
  });

  it('marks only the leased job failed when processing fails', async () => {
    const reel = reelFixture();
    reelCollection.findOneAndUpdate.mockResolvedValueOnce(reel);
    reelCollection.updateOne.mockResolvedValueOnce({ matchedCount: 1 });
    reelCollection.findOne.mockResolvedValue(reel);
    mediaFindOneMock.mockResolvedValue(sourceFixture(reel));
    execFileMock.mockImplementation((file, _args, _options, callback) => {
      callback(file === 'ffprobe' ? null : new Error('failed'), {
        stdout: JSON.stringify({
          streams: [{ codec_type: 'video', codec_name: 'h264', width: 720, height: 1280, duration: '8', r_frame_rate: '30/1' }],
          format: { duration: '8' },
        }),
        stderr: '',
      });
    });

    await expect(processOnePendingReel()).resolves.toBe(true);

    const failureFilter = reelCollection.updateOne.mock.calls.at(-1)?.[0];
    const failureUpdate = reelCollection.updateOne.mock.calls.at(-1)?.[1];
    expect(failureFilter).toMatchObject({
      _id: reel._id,
      processingLeaseId: expect.any(String),
      deletedAt: { $exists: false },
    });
    expect(failureUpdate.$set.processingStatus).toBe('failed');
    expect(failureUpdate.$unset.processingLeaseId).toBe('');
  });
});
