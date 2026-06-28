import { Blob } from 'buffer';
import { configureTestServiceEnv } from '@repo/config';

configureTestServiceEnv({
  service: 'media',
  port: 3005,
  defaultRedisHost: 'localhost',
  defaultRedisPort: '6379',
});
process.env.REDIS_PASSWORD ||= '';
process.env.S3_REGION = 'us-east-1';
process.env.S3_MEDIA_BUCKET = 'test-media-bucket';
process.env.MEDIA_BASE_URL = 'https://test.cloudfront.net';

if (typeof globalThis.File === 'undefined') {
  class TestFile extends Blob {
    name: string;
    lastModified: number;

    constructor(parts: BlobPart[], name: string, options: FilePropertyBag = {}) {
      super(parts, options);
      this.name = name;
      this.lastModified = options.lastModified || Date.now();
    }
  }

  Object.defineProperty(globalThis, 'File', {
    value: TestFile,
    configurable: true,
  });
}
