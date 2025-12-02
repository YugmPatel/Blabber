import { Request, Response } from 'express';
import { z } from 'zod';
import axios from 'axios';
import * as cheerio from 'cheerio';
import crypto from 'crypto';
import { asyncHandler } from '@repo/utils';
import { getRedisClient } from '../redis';

const LinkPreviewQuerySchema = z.object({
  url: z.string().url('url must be a valid URL'),
});

interface LinkPreviewData {
  title: string;
  description: string;
  image: string;
  url: string;
}

function generateUrlHash(url: string): string {
  return crypto.createHash('md5').update(url).digest('hex');
}

async function fetchLinkPreview(url: string): Promise<LinkPreviewData> {
  try {
    // Fetch the URL with a timeout
    const response = await axios.get(url, {
      timeout: 10000, // 10 seconds
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LinkPreviewBot/1.0)',
      },
      maxRedirects: 5,
    });

    const html = response.data;
    const $ = cheerio.load(html);

    // Extract OpenGraph tags (preferred)
    let title = $('meta[property="og:title"]').attr('content') || '';
    let description = $('meta[property="og:description"]').attr('content') || '';
    let image = $('meta[property="og:image"]').attr('content') || '';

    // Fallback to Twitter Card tags
    if (!title) {
      title = $('meta[name="twitter:title"]').attr('content') || '';
    }
    if (!description) {
      description = $('meta[name="twitter:description"]').attr('content') || '';
    }
    if (!image) {
      image = $('meta[name="twitter:image"]').attr('content') || '';
    }

    // Fallback to standard HTML tags
    if (!title) {
      title = $('title').text() || '';
    }
    if (!description) {
      description = $('meta[name="description"]').attr('content') || '';
    }

    // Ensure image URL is absolute
    if (image && !image.startsWith('http')) {
      const urlObj = new URL(url);
      if (image.startsWith('//')) {
        image = `${urlObj.protocol}${image}`;
      } else if (image.startsWith('/')) {
        image = `${urlObj.protocol}//${urlObj.host}${image}`;
      } else {
        image = `${urlObj.protocol}//${urlObj.host}/${image}`;
      }
    }

    return {
      title: title.trim(),
      description: description.trim(),
      image: image.trim(),
      url,
    };
  } catch (error: any) {
    throw new Error(`Failed to fetch link preview: ${error.message}`);
  }
}

export const linkPreview = asyncHandler(async (req: Request, res: Response) => {
  // Validate query parameters
  const parseResult = LinkPreviewQuerySchema.safeParse(req.query);

  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Validation Error',
      message: parseResult.error.errors[0].message,
      details: parseResult.error.errors,
    });
  }

  const { url } = parseResult.data;

  // Generate cache key
  const urlHash = generateUrlHash(url);
  const cacheKey = `link-preview:${urlHash}`;

  try {
    // Check Redis cache
    const redis = getRedisClient();
    const cachedData = await redis.get(cacheKey);

    if (cachedData) {
      const previewData: LinkPreviewData = JSON.parse(cachedData);
      return res.status(200).json(previewData);
    }

    // Fetch link preview
    const previewData = await fetchLinkPreview(url);

    // Cache in Redis with 24-hour TTL
    const ttl = 24 * 60 * 60; // 24 hours in seconds
    await redis.setex(cacheKey, ttl, JSON.stringify(previewData));

    return res.status(200).json(previewData);
  } catch (error: any) {
    return res.status(500).json({
      error: 'Link Preview Error',
      message: error.message || 'Failed to generate link preview',
    });
  }
});
