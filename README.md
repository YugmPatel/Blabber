# Blabber

An AI-powered real-time conversation workspace that turns everyday chats into summaries, decisions, action items, and shared context.

Blabber is not just a chat application. It combines real-time messaging, group collaboration, media sharing, and chat intelligence so conversations remain useful after they happen.

## The Problem

Most chat apps are good at sending messages, but they are poor at helping people keep track of what was decided, what needs to be done, and what is still waiting for someone.

In busy group chats, important context gets buried quickly:

- Decisions are scattered across long threads.
- Action items are mentioned once and forgotten.
- Follow-ups depend on memory instead of structure.
- New participants have to scroll through old messages to understand what happened.

Blabber is designed around a different idea: communication should create useful context, not just more messages.

## Why Blabber Is Different

Traditional chat apps focus on delivery. Blabber focuses on understanding.

| Capability | Traditional chat apps | Blabber |
| --- | --- | --- |
| Message delivery | Send and receive messages | Real-time delivery with structured backend services |
| Long conversation understanding | Manual scrolling and searching | Chat summaries and conversation context |
| Action item tracking | Buried in messages | Extracted action items and follow-up awareness |
| Decision tracking | Spread across the thread | Decision extraction and decision history |
| Waiting-on tracking | Users remember manually | Waiting-on items surface pending responsibilities |
| Group memory | Depends on individual memory | Group brain acts as shared conversation context |
| AI summaries | Usually external or absent | Built into chat intelligence routes |
| Media/context handling | Attach files and links | Media uploads, avatars, documents, and link previews |
| Architecture | Often a single app/server | Gateway plus dedicated microservices |

## Key Features

### Core Messaging

- One-to-one chats
- Group chats
- Real-time message delivery
- Chat list and chat detail views
- Message editing
- Message deletion
- Reactions
- Read receipts
- Poll-style message support
- Reply support

### AI Conversation Intelligence

- Chat summaries
- Action item extraction
- Decision extraction
- Waiting-on tracking
- Group brain / shared conversation memory
- Intelligent conversation context for long threads

These features are intended to help users avoid scrolling through long conversations to recover what matters.

### Conversation-to-Action Workflow

Blabber is built around the idea that conversations often create work. The app includes backend and frontend flows for surfacing:

- What needs to be done
- Who may be responsible
- What was decided
- What is still pending
- What the group should remember

### Group Brain

Group Brain is Blabber's shared memory layer for a chat. Instead of every participant manually remembering decisions, context, and follow-ups, the conversation can preserve useful knowledge and make it easier to access later.

### User and Profile

- Register
- Login
- Refresh session
- Logout
- Current user profile
- Profile update
- Avatar management
- Password reset flow

### Media and Rich Context

- Image upload
- Document upload
- Avatar upload
- Group avatar upload
- Link preview support
- Local media serving
- S3-style presigned upload support when configured

Blabber treats media as part of the conversation context, not just as isolated attachments.

### Realtime Layer

- Socket.IO gateway
- Live message events
- Message update events
- Message delete events
- Reactions
- Read receipts
- Typing and presence-style realtime events
- Call signaling support
- Redis-backed pub/sub flow for realtime broadcasting

### Notifications

- Push subscription routes
- Push unsubscribe routes
- Notification sending routes

## Product Use Cases

- Student project groups tracking decisions, responsibilities, and open questions
- Startup teams discussing product ideas, next steps, and ownership
- Friends planning trips, dinners, events, or shared purchases
- Communities managing long-running group conversations
- Teams that need summaries instead of scrolling through chat history
- Any group that wants chat to become useful context instead of disappearing into the thread

## Architecture

```text
Web App
  |
  v
API Gateway + Socket.IO
  |
  +--> Auth Service
  +--> Users Service
  +--> Chats Service
  +--> Messages Service
  +--> Media Service
  +--> Notifications Service
  |
  +--> MongoDB
  +--> Redis
```

The web app talks to the gateway. The gateway proxies HTTP requests to the appropriate backend service and also hosts the Socket.IO realtime layer.

MongoDB stores app data such as users, chats, messages, media records, sessions, and intelligence outputs. Redis supports pub/sub, presence-related workflows, caching, and realtime communication patterns.

This structure makes Blabber closer to a production-style distributed system than a single-server chat demo.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | React `19.1.1`, TypeScript, Vite `7`, Tailwind CSS |
| Frontend state/data | React Query, Zustand, React Router |
| Backend runtime | Node.js |
| Backend framework | Express |
| API gateway | Express, http-proxy-middleware |
| Realtime | Socket.IO, Socket.IO client |
| Database | MongoDB 7 |
| Cache/pubsub | Redis 7 |
| Auth | JWT access tokens, HttpOnly refresh cookies, bcrypt |
| Validation | Zod |
| Media | Local media flow, AWS S3 presign support via AWS SDK |
| AI provider integration | OpenRouter-compatible provider code with chat completion flows |
| Package manager | pnpm workspaces, pnpm `8.15.0` |
| Build orchestration | Turbo |
| Containers | Docker, Docker Compose |

## Project Structure

| Path | Purpose |
| --- | --- |
| `apps/web` | React frontend application. |
| `apps/gateway` | API gateway and Socket.IO server. |
| `services/auth` | Registration, login, refresh sessions, logout, password reset, and current user routes. |
| `services/users` | User profiles, profile update, search, block/unblock, and presence lookup. |
| `services/chats` | Direct/group chats, group management, chat preferences, and intelligence routes. |
| `services/messages` | Message retrieval, sending, editing, deletion, reactions, read state, and poll votes. |
| `services/media` | Media presign, local upload, media serving, media records, and link previews. |
| `services/notifications` | Push notification subscription, unsubscribe, and send routes. |
| `packages/types` | Shared TypeScript types and Zod schemas. |
| `packages/config` | Shared environment configuration loaders. |
| `packages/utils` | Shared utilities, errors, auth middleware, logging, and Redis pub/sub helpers. |
| `docker-compose.full.yml` | Full-stack Docker setup for web, gateway, services, MongoDB, and Redis. |

## Local Development

Docker is the most reliable way to run the full application because it starts the web app, gateway, backend services, MongoDB, and Redis together.

### Prerequisites

- Node.js `20.11.0`, based on `.nvmrc`
- pnpm `8.15.0`
- Docker Desktop or another Docker-compatible runtime

### Install Dependencies

```bash
pnpm install
```

### Start The Full Stack

Docker Compose v2:

```bash
docker compose -f docker-compose.full.yml up -d
```

Legacy Compose command:

```bash
docker-compose -f docker-compose.full.yml up -d
```

Open the web app:

```text
http://localhost:5173
```

Gateway health check:

```text
http://localhost:3000/healthz
```

### Check Containers

```bash
docker compose -f docker-compose.full.yml ps
```

or:

```bash
docker-compose -f docker-compose.full.yml ps
```

### Stop Containers

```bash
docker compose -f docker-compose.full.yml down
```

or:

```bash
docker-compose -f docker-compose.full.yml down
```

### Run Individual Parts Locally

Frontend:

```bash
pnpm --filter ./apps/web dev
```

Gateway:

```bash
pnpm --filter @apps/gateway dev
```

Example service:

```bash
pnpm --filter @services/auth dev
```

Build all packages:

```bash
pnpm build
```

Run tests:

```bash
pnpm test
```

## Environment Variables

The project uses environment variables for service configuration. See `.env.example` for the full template.

| Variable | Purpose |
| --- | --- |
| `VITE_API_URL` | Frontend API base URL. |
| `VITE_SOCKET_URL` | Frontend Socket.IO URL. |
| `MONGO_URI` | MongoDB connection string. |
| `MONGO_DB_NAME` | MongoDB database name. |
| `REDIS_HOST` | Redis host. |
| `REDIS_PORT` | Redis port. |
| `REDIS_PASSWORD` | Optional Redis password. |
| `JWT_ACCESS_SECRET` | Access token signing secret. |
| `JWT_REFRESH_SECRET` | Refresh token signing secret. |
| `JWT_ACCESS_TTL` | Access token lifetime. |
| `JWT_REFRESH_TTL` | Refresh token lifetime. |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins. |
| `AUTH_SERVICE_URL` | Gateway target for auth service. |
| `USERS_SERVICE_URL` | Gateway target for users service. |
| `CHATS_SERVICE_URL` | Gateway target for chats service. |
| `MESSAGES_SERVICE_URL` | Gateway target for messages service. |
| `MEDIA_SERVICE_URL` | Gateway target for media service. |
| `NOTIFICATIONS_SERVICE_URL` | Gateway target for notifications service. |
| `INTELLIGENCE_SERVICE_URL` | Gateway target for chat intelligence routes. |
| `LOCAL_MEDIA_DIR` | Local directory for stored media files. |
| `LOCAL_MEDIA_UPLOAD_BASE_URL` | Base URL used for local media upload targets. |
| `PUBLIC_MEDIA_BASE_URL` | Public base URL returned for local media records. |
| `S3_MEDIA_BUCKET` | Optional S3 bucket for S3-style media upload. |
| `S3_REGION` | Optional S3 region. |
| `MEDIA_BASE_URL` | Public media base URL for S3-style media. |
| `AWS_ACCESS_KEY_ID` | Optional AWS access key for S3. |
| `AWS_SECRET_ACCESS_KEY` | Optional AWS secret for S3. |
| `VAPID_PUBLIC_KEY` | Web push public key. |
| `VAPID_PRIVATE_KEY` | Web push private key. |
| `VAPID_SUBJECT` | Web push contact subject. |
| `OPENROUTER_API_KEY` | Optional AI provider key for chat intelligence. |
| `OPENROUTER_MODEL` | Optional model name for the AI provider. |
| `OPENROUTER_HTTP_REFERER` / `OPENROUTER_REFERER` | Optional provider metadata. |

Example placeholder values:

```env
VITE_API_URL=http://localhost:3000
VITE_SOCKET_URL=http://localhost:3000
MONGO_URI=mongodb://localhost:27017
MONGO_DB_NAME=blabber
REDIS_HOST=localhost
REDIS_PORT=6379
JWT_ACCESS_SECRET=replace-with-at-least-32-characters
JWT_REFRESH_SECRET=replace-with-at-least-32-characters
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
OPENROUTER_API_KEY=
```

AI provider keys can be configured through environment variables such as `OPENROUTER_API_KEY` and `OPENROUTER_MODEL`.

## API Overview

All browser-facing HTTP APIs go through the gateway.

| Gateway path | Service | Purpose |
| --- | --- | --- |
| `/api/auth` | Auth service | Register, login, refresh, logout, password reset, current user. |
| `/api/users` | Users service | User profiles, search, profile updates, block/unblock, presence lookup. |
| `/api/chats` | Chats service | Direct chats, group chats, chat metadata, members, pin/archive. |
| `/api/messages` | Messages service | Message list, send, edit, delete, reactions, read state, poll voting. |
| `/api/media` | Media service | Presign uploads, local media upload, media serving, link previews. |
| `/api/intelligence` | Chats service | Summaries, actions, decisions, waiting-on items, group brain. |
| `/api/notifications` | Notifications service | Push subscribe, unsubscribe, and send routes. |

## Service Ports

| Service | Port |
| --- | --- |
| Web app | 5173 |
| Gateway | 3000 |
| Auth service | 3001 |
| Users service | 3002 |
| Chats service | 3003 |
| Messages service | 3004 |
| Media service | 3005 |
| Notifications service | 3006 |
| MongoDB | 27018 on host, 27017 in Docker network |
| Redis | 6380 on host, 6379 in Docker network |

## License

MIT
