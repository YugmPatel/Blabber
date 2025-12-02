# Notifications Service

The Notifications Service handles Web Push notifications for the WhatsApp-style chat application.

## Features

- Web Push subscription management
- Push notification delivery with VAPID authentication
- Retry logic for failed deliveries
- Automatic cleanup of expired subscriptions

## Environment Variables

```env
NODE_ENV=development
LOG_LEVEL=info
PORT=3006
MONGO_URI=mongodb://localhost:27017
MONGO_DB_NAME=whatsapp_chat
ALLOWED_ORIGINS=http://localhost:3000
VAPID_PUBLIC_KEY=<your-vapid-public-key>
VAPID_PRIVATE_KEY=<your-vapid-private-key>
VAPID_SUBJECT=mailto:your-email@example.com
```

## API Endpoints

### Health Check

```
GET /healthz
```

Returns service health status.

### Push Subscription Management

```
POST /push/subscribe
```

Store a Web Push subscription.

```
POST /push/unsubscribe
```

Remove a Web Push subscription.

### Send Notification (Internal)

```
POST /send
```

Send a push notification to a user. This endpoint is intended for internal service-to-service communication.

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

## Testing

```bash
# Run tests once
pnpm test

# Run tests in watch mode
pnpm test:watch
```
