# Blabber

### _Where conversations flow_

A full-featured real-time chat application built with React, Node.js microservices, MongoDB, Redis, and WebSocket.

![Blabber](https://img.shields.io/badge/Blabber-Chat_App-6366f1?style=for-the-badge&logo=chat&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript)
![Node.js](https://img.shields.io/badge/Node.js-20-339933?style=flat-square&logo=node.js)
![MongoDB](https://img.shields.io/badge/MongoDB-7-47A248?style=flat-square&logo=mongodb)
![Redis](https://img.shields.io/badge/Redis-7-DC382D?style=flat-square&logo=redis)
![Socket.io](https://img.shields.io/badge/Socket.io-4-010101?style=flat-square&logo=socket.io)

---

## Features

### Core Chat

- Real-time messaging with WebSocket
- Direct messages & group chats
- Message reactions, replies & deletion
- Typing indicators & read receipts
- Online/offline presence tracking
- Image, video & document sharing
- Voice messages & camera capture

### Unique Features

- **Temporary Groups** - Auto-delete groups after set time
- **Scheduled Messages** - Send messages at a future time
- **Quick Reply Templates** - Save & reuse common messages
- **Message Bookmarks** - Save important messages across chats
- **Chat Themes** - Custom colors & backgrounds per chat
- **AI Assistant** - Built-in AI chat helper

### Additional

- Video & voice calls (WebRTC)
- Polls in chats
- Contact sharing
- Status/Stories
- Profile customization

---

## Tech Stack

| Layer     | Technology                                       |
| --------- | ------------------------------------------------ |
| Frontend  | React 18, TypeScript, Vite, TailwindCSS, Zustand |
| Gateway   | Express.js, Socket.io, Redis Adapter             |
| Services  | Node.js Microservices                            |
| Database  | MongoDB 7                                        |
| Cache     | Redis 7                                          |
| Real-time | Socket.io + Redis Pub/Sub                        |

---

## Project Structure

```
blabber/
├── apps/
│   ├── web/              # React frontend
│   └── gateway/          # API Gateway + WebSocket
├── services/
│   ├── auth/             # Authentication (JWT)
│   ├── users/            # User profiles & presence
│   ├── chats/            # Chat rooms & groups
│   ├── messages/         # Message storage
│   ├── media/            # File uploads
│   └── notifications/    # Push notifications
├── packages/
│   ├── types/            # Shared TypeScript types
│   ├── config/           # Shared configuration
│   └── utils/            # Shared utilities
└── docker-compose.dev.yml
```

---

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 8+
- Docker Desktop

### 1. Clone & Install

```bash
git clone https://github.com/YOUR_USERNAME/blabber.git
cd blabber
pnpm install
```

### 2. Start Services

```powershell
# Windows
.\start.ps1 -Quick
```

### 3. Open App

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
| MongoDB  | 27017 |
| Redis    | 6379  |

---

## Screenshots

_Coming soon..._

---

## License

MIT

---

<p align="center">
  <b>Blabber</b> - Where conversations flow
</p>
