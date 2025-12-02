# Chats Service

The Chats Service manages chat conversations (direct and group) in the WhatsApp-style chat application.

## Features

- Create direct and group chats
- List and retrieve chat details
- Manage group members (add/remove)
- Update group chat metadata (title, avatar)
- Pin and archive chats
- Role-based access control for group admins

## API Endpoints

### Health Check

- `GET /healthz` - Health check endpoint

### Chat Management

- `POST /` - Create a new chat
- `GET /` - List all chats for authenticated user
- `GET /:id` - Get chat details
- `PATCH /:id` - Update chat metadata (admin only for groups)
- `POST /:id/pin` - Pin a chat
- `POST /:id/archive` - Archive a chat

### Group Member Management

- `POST /:id/members` - Add member to group (admin only)
- `DELETE /:id/members/:userId` - Remove member from group (admin only)

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

# Build
pnpm build

# Start production server
pnpm start
```

## Data Model

### Chat Document

```typescript
{
  _id: ObjectId,
  type: "direct" | "group",
  participants: ObjectId[],
  admins: ObjectId[],
  title?: string,
  avatarUrl?: string,
  lastMessageRef?: {
    messageId: ObjectId,
    body: string,
    senderId: ObjectId,
    createdAt: Date
  },
  createdAt: Date,
  updatedAt: Date
}
```

## Indexes

- `{ participants: 1 }` - For filtering chats by user
- `{ updatedAt: -1 }` - For sorting chat list
