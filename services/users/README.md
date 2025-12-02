# Users Service

The Users Service handles user profile management, search, presence tracking, and block/unblock functionality for the WhatsApp-style chat application.

## Features

- **User Profile Retrieval**: Fetch user details by ID
- **User Search**: Text-based search on username and name fields
- **Profile Updates**: Update name, avatar, and about fields
- **Block/Unblock**: Manage blocked users list
- **Presence Tracking**: Redis-based online/offline status with TTL

## API Endpoints

### GET /:id

Retrieve user profile by ID.

**Response:**

```json
{
  "user": {
    "_id": "...",
    "username": "johndoe",
    "name": "John Doe",
    "avatarUrl": "https://...",
    "about": "Software developer",
    "lastSeen": "2024-01-01T00:00:00Z"
  }
}
```

### GET /search?q=query

Search for users by username or name.

**Query Parameters:**

- `q` (required): Search query string

**Response:**

```json
{
  "users": [
    {
      "_id": "...",
      "username": "johndoe",
      "name": "John Doe",
      "avatarUrl": "https://...",
      "about": "Software developer"
    }
  ]
}
```

### PATCH /me

Update authenticated user's profile.

**Authentication:** Required (Bearer token)

**Request Body:**

```json
{
  "name": "New Name",
  "avatarUrl": "https://...",
  "about": "Updated bio"
}
```

**Response:**

```json
{
  "user": {
    "_id": "...",
    "username": "johndoe",
    "name": "New Name",
    "avatarUrl": "https://...",
    "about": "Updated bio",
    "lastSeen": "2024-01-01T00:00:00Z"
  }
}
```

### POST /block

Block a user.

**Authentication:** Required (Bearer token)

**Request Body:**

```json
{
  "userId": "..."
}
```

**Response:**

```json
{
  "success": true,
  "message": "User blocked successfully"
}
```

### POST /unblock

Unblock a user.

**Authentication:** Required (Bearer token)

**Request Body:**

```json
{
  "userId": "..."
}
```

**Response:**

```json
{
  "success": true,
  "message": "User unblocked successfully"
}
```

### GET /presence/:id

Get user's online/offline status.

**Response:**

```json
{
  "online": true,
  "lastSeen": "2024-01-01T00:00:00Z"
}
```

### GET /healthz

Health check endpoint.

**Response:**

```json
{
  "status": "ok",
  "service": "users",
  "timestamp": "2024-01-01T00:00:00Z"
}
```

## Environment Variables

Required environment variables:

```env
NODE_ENV=development
LOG_LEVEL=info
PORT=3002

# MongoDB
MONGO_URI=mongodb://localhost:27017
MONGO_DB_NAME=whatsapp_chat

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# JWT
JWT_ACCESS_SECRET=your-access-secret
JWT_REFRESH_SECRET=your-refresh-secret
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=30d

# CORS
ALLOWED_ORIGINS=http://localhost:3000
```

## Development

### Install Dependencies

```bash
pnpm install
```

### Run in Development Mode

```bash
pnpm dev
```

### Build

```bash
pnpm build
```

### Run Tests

```bash
pnpm test
```

### Run Tests in Watch Mode

```bash
pnpm test:watch
```

## MongoDB Indexes

The service creates the following indexes on startup:

- `username` (unique)
- `email` (unique)
- `username, name` (text index for search)

## Redis Keys

### Presence Tracking

- **Key Pattern**: `presence:<userId>`
- **Value**: JSON object with `{ online: boolean, lastSeen: string }`
- **TTL**: 300 seconds (5 minutes)

## Docker

### Build Image

```bash
docker build -t users-service -f services/users/Dockerfile .
```

### Run Container

```bash
docker run -p 3002:3002 \
  -e MONGO_URI=mongodb://host.docker.internal:27017 \
  -e REDIS_HOST=host.docker.internal \
  users-service
```

## Architecture

The Users Service follows a layered architecture:

- **Routes**: HTTP endpoint handlers
- **Models**: Database operations and schema definitions
- **Redis**: Presence tracking and caching
- **Middleware**: Authentication and validation

## Testing

The service includes comprehensive unit and integration tests:

- Profile retrieval tests
- Search functionality tests
- Profile update tests
- Block/unblock tests
- Presence tracking tests

Run tests with MongoDB and Redis running locally or use test containers.
