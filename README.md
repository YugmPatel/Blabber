# Blabber

### _Talk. Decide. Do._

An AI-native real-time chat application built with React, Node.js microservices, MongoDB, Redis, and WebSocket. Blabber turns group conversations into summaries, tasks, decisions, and shared memory — seamlessly.

![Blabber](https://img.shields.io/badge/Blabber-AI_Chat-6366f1?style=for-the-badge&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript)
![Node.js](https://img.shields.io/badge/Node.js-20-339933?style=flat-square&logo=node.js)
![MongoDB](https://img.shields.io/badge/MongoDB-7-47A248?style=flat-square&logo=mongodb)
![Redis](https://img.shields.io/badge/Redis-7-DC382D?style=flat-square&logo=redis)
![Socket.io](https://img.shields.io/badge/Socket.io-4-010101?style=flat-square&logo=socket.io)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3-06B6D4?style=flat-square&logo=tailwindcss)

---

## Features

### AI Intelligence

- **Catch-Me-Up Summaries** — One-click AI summary of any chat thread so you never lose context
- **Task Extraction** _(coming soon)_ — Automatically surfaces action items from conversations
- **Shared Memory** _(coming soon)_ — Remembers decisions and context across chats
- **Waiting On** _(coming soon)_ — Tracks who you're waiting on for responses

### Core Chat

- Real-time messaging with WebSocket (Socket.io)
- Direct messages and group chats
- Message reactions, replies, edits, and deletion
- Typing indicators and read receipts
- Online/offline presence tracking
- Image, video, and document sharing
- Voice messages and camera capture
- Contact sharing and polls
- Scheduled messages

### UI & Experience

- **Modern AI-native design** — Clean, premium workspace feel (Tailwind CSS)
- **Light & Dark mode** — Persistent theme with smooth toggle
- **Collapsible sidebar** — Drawer-style navigation, desktop and mobile
- **Polished avatars** — Deterministic color-coded initials, online status dots
- **WhatsApp-style composer** — `+` action menu for attachments, emoji, voice
- **Unified Settings** — One settings page with sub-sections (Profile, Privacy, Notifications, Appearance, AI Engine, Help)
- Video and voice calls (WebRTC)

---

## Tech Stack

| Layer     | Technology                                                      |
| --------- | --------------------------------------------------------------- |
| Frontend  | React 18, TypeScript, Vite, TailwindCSS, Zustand, React Query  |
| Gateway   | Express.js, Socket.io, Redis Pub/Sub adapter                    |
| Services  | Node.js microservices (auth, users, chats, messages, media, notifications) |
| Database  | MongoDB 7                                                       |
| Cache     | Redis 7                                                         |
| Real-time | Socket.io + Redis Pub/Sub                                       |
| Auth      | JWT access tokens + HTTP-only refresh cookies                   |
| Monorepo  | pnpm workspaces                                                 |

---

## Project Structure

```
blabber/
├── apps/
│   ├── web/                  # React frontend (Vite + TypeScript)
│   └── gateway/              # API Gateway + WebSocket (Express + Socket.io)
├── services/
│   ├── auth/                 # Authentication — JWT, refresh tokens
│   ├── users/                # User profiles & presence
│   ├── chats/                # Chat rooms, groups, AI intelligence
│   ├── messages/             # Message storage & retrieval
│   ├── media/                # File uploads (images, docs, audio)
│   └── notifications/        # Push notifications
├── packages/
│   ├── types/                # Shared TypeScript types
│   ├── config/               # Shared configuration
│   └── utils/                # Shared utilities
├── docker-compose.full.yml   # Full production-like stack
└── docker-compose.dev.yml    # Local dev stack
```

---

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 8+
- Docker Desktop

### 1. Clone & Install

```bash
git clone https://github.com/YugmPatel/Blabber.git
cd Blabber
pnpm install
```

### 2. Start the Full Stack (Docker)

```bash
docker compose -f docker-compose.full.yml up -d
```

### 3. Open the App

```
http://localhost:5173
```

---

## Service Ports

| Service  | Port  |
| -------- | ----- |
| Frontend | 5173  |
| Gateway  | 3000  |
| Auth     | 3001  |
| Users    | 3002  |
| Chats    | 3003  |
| Messages | 3004  |
| Media    | 3005  |
| MongoDB  | 27018 |
| Redis    | 6380  |

---

## UI Highlights

### Login / Register
Split-panel layout — abstract layered aurora gradient on the left (CSS-only SVG waves in teal, purple, and navy) and a clean form on the right with the Blabber logo.

### Main Shell
Collapsible sidebar with chat navigation, a `+` button for new conversations, and a profile/account menu at the bottom with a dark mode toggle. The right side shows only the active chat or a clean empty state ("Ready to turn noise into signal?").

### Chat View
Inline Catch-Me-Up card above the message list for quick AI summaries. Composer bar with a floating `+` action menu (Documents, Photos, Camera, Audio, Contact, Poll, Event).

### Settings
Unified settings page at `/settings` with a left sub-navigation panel: Profile, Privacy, Notifications, Appearance (dark mode toggle), AI Engine, and Help.

---

## Development

```bash
# Install dependencies
pnpm install

# Run full stack via Docker
docker compose -f docker-compose.full.yml up -d

# Rebuild a specific service after code changes
docker compose -f docker-compose.full.yml up -d --build web

# Frontend only (requires services running)
pnpm --filter ./apps/web dev

# Type-check frontend
pnpm --filter ./apps/web build
```

---

## License

MIT

---

<p align="center">
  <b>Blabber</b> — Talk. Decide. Do.
</p>
