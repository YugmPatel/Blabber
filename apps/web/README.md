# Web Frontend

React + TypeScript + Vite frontend application for the WhatsApp-style chat application.

## Tech Stack

- **React 19** - UI library
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server
- **Tailwind CSS** - Utility-first CSS framework
- **React Router** - Client-side routing
- **React Query** - Server state management
- **Zustand** - Client state management
- **Socket.io Client** - Real-time WebSocket communication
- **Axios** - HTTP client
- **Zod** - Runtime validation

## Getting Started

### Prerequisites

- Node.js (LTS version specified in `.nvmrc`)
- pnpm

### Installation

From the root of the monorepo:

```bash
pnpm install
```

### Development

```bash
pnpm --filter web dev
```

The app will be available at `http://localhost:5173`

### Environment Variables

Copy `.env.example` to `.env` and configure:

```env
VITE_API_URL=http://localhost:3000
VITE_SOCKET_URL=http://localhost:3000
VITE_CLOUDFRONT_MEDIA_URL=https://media.example.com
```

### Build

```bash
pnpm --filter web build
```

### Testing

```bash
# Run tests once
pnpm --filter web test

# Watch mode
pnpm --filter web test:watch
```

## Project Structure

```
src/
├── api/              # API client and hooks
├── components/       # Reusable UI components
├── hooks/            # Custom React hooks
├── pages/            # Page components
├── store/            # Zustand stores
├── socket/           # Socket.io client setup
├── test/             # Test utilities
├── App.tsx           # Root component
├── main.tsx          # Entry point
├── router.tsx        # Route configuration
└── index.css         # Global styles
```

## Routes

- `/login` - Login page
- `/register` - Registration page
- `/chats` - Chat list (sidebar)
- `/chats/:id` - Individual chat view
- `/profile` - User profile
- `/settings` - Application settings
