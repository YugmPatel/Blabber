# Messages Service

The Messages Service handles all message-related operations including sending, retrieving, editing, deleting messages, as well as reactions and read receipts.

## Features

- Message retrieval with cursor-based pagination
- Message sending with media and reply support
- Message editing and soft deletion
- Reactions management
- Read receipts with batch support
- Optimized MongoDB indexes for performance

## API Endpoints

### GET /:chatId

Retrieve messages for a chat with cursor-based pagination.

**Query Parameters:**

- `cursor` (optional): Cursor for pagination
- `limit` (optional): Number of messages to return (default: 50)

**Response:**

```json
{
  "messages": [...],
  "nextCursor": "string|null"
}
```

### POST /:chatId

Send a new message to a chat.

**Body:**

```json
{
  "body": "string",
  "mediaId": "string (optional)",
  "replyToId": "string (optional)",
  "tempId": "string (optional)"
}
```

### PATCH /:messageId

Edit an existing message.

**Body:**

```json
{
  "body": "string"
}
```

### DELETE /:messageId

Soft delete a message (adds user to deletedFor array).

### POST /:messageId/react

Add or update a reaction to a message.

**Body:**

```json
{
  "emoji": "string"
}
```

### POST /:messageId/read

Mark messages as read (supports batch operations).

**Body:**

```json
{
  "messageIds": ["string"]
}
```

## Environment Variables

See `.env.example` in the root directory for required environment variables.

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

## Database Indexes

- Compound index: `{ chatId: 1, createdAt: -1 }` for efficient pagination
- Index: `{ senderId: 1 }` for sender queries
