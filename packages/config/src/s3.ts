import { z } from 'zod';

const S3ConfigSchema = z.object({
  S3_MEDIA_BUCKET: z.string().min(1, 'S3_MEDIA_BUCKET is required'),
  S3_REGION: z.string().min(1, 'S3_REGION is required'),
  CLOUDFRONT_MEDIA_DIST_ID: z.string().optional(),
  MEDIA_BASE_URL: z.string().url('MEDIA_BASE_URL must be a valid URL'),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
});

export type S3Config = z.infer<typeof S3ConfigSchema>;

export function loadS3Config(): S3Config {
  const result = S3ConfigSchema.safeParse(process.env);
  
  if (!result.success) {
    console.error('❌ Invalid S3/CloudFront configuration:', result.error.format());
    throw new Error('Invalid S3/CloudFront configuration');
  }
  
  return result.data;
}
