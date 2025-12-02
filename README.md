# WhatsApp Clone - Real-Time Chat Application

A full-featured WhatsApp clone built with React, Node.js microservices, MongoDB, Redis, and WebSocket for real-time communication.

![WhatsApp Clone](https://img.shields.io/badge/WhatsApp-Clone-25D366?style=for-the-badge&logo=whatsapp&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript)
![Node.js](https://img.shields.io/badge/Node.js-20-339933?style=flat-square&logo=node.js)
![MongoDB](https://img.shields.io/badge/MongoDB-7-47A248?style=flat-square&logo=mongodb)
![Redis](https://img.shields.io/badge/Redis-7-DC382D?style=flat-square&logo=redis)

## Features

### Core Chat Features

- Real-time messaging with WebSocket (Socket.io)
- Direct messages and group chats
- Message reactions, replies, and deletion
- Typing indicators and read receipts
- Online/offline presence tracking
- Image, video, and document sharing

### Unique Features (Not in WhatsApp!)

- **Temporary Groups** - Auto-delete groups after set time (1 day to 1 month)
- **Scheduled Messages** - Send messages at a future time
- **Quick Reply Templates** - Save and reuse common messages
- **Message Bookmarks** - Save important messages across all chats
- **Chat Themes** - Custom colors and backgrounds per chat
- **Meta AI Assistant** - Built-in AI chat helper

### Additional Features

- Video and voice calls (WebRTC)
- Voice messages
- Camera integration
- Polls in chats
- Contact sharing
- Status/Stories
- Profile customization with avatar upload

## Tech Stack

| Layer     | Technology                                                  |
| --------- | ----------------------------------------------------------- |
| Frontend  | React 18, TypeScript, Vite, TailwindCSS, Zustand            |
| Gateway   | Express.js, Socket.io, Redis Adapter                        |
| Services  | Node.js microservices (Auth, Users, Chats, Messages, Media) |
| Database  | MongoDB 7                                                   |
| Cache     | Redis 7                                                     |
| Real-time | Socket.io with Redis Pub/Sub                                |

## Project Structure

```
whatsapp-clone/
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

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 8+
- Docker Desktop

### 1. Clone and Install

```bash
git clone https://github.com/YOUR_USERNAME/whatsapp-clone.git
cd whatsapp-clone
pnpm install
```

### 2. Start Services

```powershell
# Windows PowerShell
.\start.ps1 -Quick

# Or double-click start.bat
```

### 3. Open App

Navigate to http://localhost:5173

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

## Screenshots

Coming soon...

## License

MIT

## Author

Your Name
