# Media Service

The Media Service handles file uploads and link previews for the WhatsApp-style chat application.

## Features

- **Presigned URL Generation**: Generate S3 presigned URLs for direct client uploads
- **File Validation**: Validate file types and sizes before upload
- **Link Preview**: Fetch and cache OpenGraph metadata for URLs
- **Media Metadata Storage**: Store media metadata in MongoDB

## API Endpoints

### POST /presign

Generate a presigned URL for uploading media to S3.

**Request Body:**

```json
{
  "fileName": "image.jpg",
  "fileType": "image/jpeg",
  "fileSize": 1024000
}
```

**Response:**

```json
{
  "uploadUrl": "https://s3.amazonaws.com/...",
  "mediaId": "507f1f77bcf86cd799439011",
  "expiresIn": 300
}
```

### GET /link-preview

Fetch link preview metadata for a URL.

**Query Parameters:**

- `url`: The URL to fetch preview for

**Response:**

```json
{
  "title": "Example Page",
  "description": "This is an example page",
  "image": "https://example.com/image.jpg",
  "url": "https://example.com"
}
```

### GET /healthz

Health check endpoint.

**Response:**

```json
{
  "status": "ok",
  "service": "media",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## Environment Variables

- `NODE_ENV`: Environment (development, production, test)
- `LOG_LEVEL`: Logging level (debug, info, warn, error)
- `PORT`: Server port (default: 3005)
- `MONGO_URI`: MongoDB connection string
- `MONGO_DB_NAME`: MongoDB database name
- `REDIS_HOST`: Redis host
- `REDIS_PORT`: Redis port
- `REDIS_PASSWORD`: Redis password (optional)
- `ALLOWED_ORIGINS`: Comma-separated list of allowed CORS origins
- `AWS_REGION`: AWS region for S3
- `S3_MEDIA_BUCKET`: S3 bucket name for media storage
- `MEDIA_BASE_URL`: CloudFront base URL for media access

## Development

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm dev

# Run tests
pnpm test

# Build for production
pnpm build

# Start production server
pnpm start
```

## File Type Whitelist

- **Images**: jpg, jpeg, png, gif, webp (max 10MB)
- **Audio**: mp3, ogg, m4a, wav (max 20MB)
- **Documents**: pdf, docx, xlsx, txt (max 50MB)

## Architecture

The Media Service follows a simple architecture:

1. Client requests presigned URL with file metadata
2. Service validates file type and size
3. Service generates S3 presigned PUT URL
4. Service stores media metadata in MongoDB
5. Client uploads file directly to S3 using presigned URL
6. Client references media by mediaId in messages

For link previews:

1. Client requests preview for URL
2. Service checks Redis cache
3. If not cached, service fetches URL and parses metadata
4. Service caches result in Redis (24h TTL)
5. Service returns preview data to client
