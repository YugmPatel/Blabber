# Gateway/BFF Service

The Gateway/BFF (Backend for Frontend) service is the single public entry point for the WhatsApp-style chat application. It handles HTTP API routing, WebSocket connections, authentication, and real-time event management.

## Features

- HTTP API proxying to internal microservices
- WebSocket server with Socket.io
- JWT authentication and authorization
- Rate limiting and security headers
- Redis adapter for horizontal scaling
- Real-time event broadcasting

## Environment Variables

```
NODE_ENV=development
LOG_LEVEL=info
PORT=3000
ALLOWED_ORIGINS=http://localhost:5173

# JWT
JWT_ACCESS_SECRET=your-access-secret
JWT_REFRESH_SECRET=your-refresh-secret

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Internal Service URLs
AUTH_SERVICE_URL=http://localhost:3001
USERS_SERVICE_URL=http://localhost:3002
CHATS_SERVICE_URL=http://localhost:3003
MESSAGES_SERVICE_URL=http://localhost:3004
MEDIA_SERVICE_URL=http://localhost:3005
NOTIFICATIONS_SERVICE_URL=http://localhost:3006
```

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

## API Routes

### Health Check

- `GET /healthz` - Health check endpoint

### Proxied Routes

- `/api/auth/*` - Auth service
- `/api/users/*` - Users service
- `/api/chats/*` - Chats service
- `/api/messages/*` - Messages service
- `/api/media/*` - Media service
- `/api/notifications/*` - Notifications service

## WebSocket Events

### Client to Server

- `auth:hello` - Initial authentication handshake
- `message:send` - Send a new message
- `message:read` - Mark messages as read
- `typing:start` - User started typing
- `typing:stop` - User stopped typing
- `reaction:set` - Add/remove reaction
- `chat:create` - Create new chat
- `chat:join` - Join chat room
- `chat:leave` - Leave chat room

### Server to Client

- `message:new` - New message received
- `message:edit` - Message edited
- `message:delete` - Message deleted
- `receipt:delivered` - Delivery receipt
- `receipt:read` - Read receipt
- `typing:update` - Typing indicator update
- `chat:updated` - Chat metadata updated
- `presence:update` - User presence changed
- `error` - Error notification
