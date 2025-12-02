# Requirements Document

## Introduction

This document outlines the requirements for a production-ready, WhatsApp-style real-time chat application built as a monorepo. The system is designed to support 1,000+ concurrent users with real-time messaging, media sharing, presence tracking, and notifications. The architecture follows a microservices pattern with a Gateway/BFF layer, deployed on AWS infrastructure using modern DevOps practices.

The application consists of a React frontend, Node.js backend services (Auth, Users, Chats, Messages, Media, Notifications), and comprehensive infrastructure-as-code for AWS deployment. The system emphasizes scalability, security, real-time communication, and developer experience.

## Requirements

### Requirement 1: Monorepo Structure and Tooling

**User Story:** As a developer, I want a well-organized monorepo with proper tooling, so that I can efficiently develop, build, and deploy multiple services and applications.

#### Acceptance Criteria

1. WHEN the repository is initialized THEN the system SHALL use pnpm workspaces for package management
2. WHEN the repository is initialized THEN the system SHALL use Turborepo for build orchestration with pipelines for build, lint, test, dev, and deploy
3. WHEN the repository structure is created THEN the system SHALL organize code into apps/ (web, gateway), services/ (auth, users, chats, messages, media, notifications), and packages/ (types, config, utils, eslint-config, tsconfig)
4. WHEN the repository is initialized THEN the system SHALL include root configuration files: package.json, pnpm-workspace.yaml, turbo.json, .editorconfig, .gitignore, .nvmrc, .prettierrc, .eslintrc.cjs
5. WHEN the repository is initialized THEN the system SHALL include comprehensive documentation in README.md and docs/ARCHITECTURE.md with Mermaid diagrams

### Requirement 2: Shared Packages

**User Story:** As a developer, I want shared packages for common functionality, so that I can maintain consistency and reduce code duplication across services.

#### Acceptance Criteria

1. WHEN packages/types is created THEN the system SHALL define core TypeScript types and Zod schemas for User, Chat, Message, Reaction, Media, JWT tokens, and API DTOs
2. WHEN packages/config is created THEN the system SHALL provide environment configuration loaders using Zod for validation covering NODE_ENV, LOG_LEVEL, MONGO_URI, REDIS_HOST, JWT secrets, S3/CloudFront, and CORS origins
3. WHEN packages/utils is created THEN the system SHALL provide Pino logger, HTTP error helpers, async wrappers, Redis-based rate-limit middleware, JWT auth middleware, and pagination helpers
4. WHEN packages/eslint-config is created THEN the system SHALL provide shared ESLint configuration for TypeScript projects
5. WHEN packages/tsconfig is created THEN the system SHALL provide base TypeScript configurations for apps and services

### Requirement 3: Gateway/BFF Layer

**User Story:** As a system architect, I want a single public-facing Gateway/BFF layer, so that I can centralize routing, authentication, and WebSocket management while keeping internal services private.

#### Acceptance Criteria

1. WHEN the gateway is initialized THEN the system SHALL create an Express application with routes for /healthz and /api/\* proxying to internal services
2. WHEN the gateway handles HTTP requests THEN the system SHALL apply rate limiting, CORS, Helmet security headers, and JSON parsing middleware
3. WHEN the gateway is initialized THEN the system SHALL create a Socket.io server with Redis adapter for horizontal scaling
4. WHEN a client connects via WebSocket THEN the system SHALL verify the access token during handshake and reject unauthorized connections
5. WHEN a client connects successfully THEN the system SHALL join the client to rooms: user:<id> and relevant chat:<chatId> rooms
6. WHEN the gateway receives client events THEN the system SHALL handle: auth:hello, message:send, message:read, typing:start, typing:stop, reaction:set, chat:create, chat:join, chat:leave
7. WHEN the gateway emits server events THEN the system SHALL send: message:new, message:edit, message:delete, receipt:delivered, receipt:read, typing:update, chat:updated, presence:update, error
8. WHEN a message is sent with optimistic tempId THEN the system SHALL map tempId to definitive \_id and acknowledge to client
9. WHEN the gateway proxies HTTP requests THEN the system SHALL route /api/auth/_ to auth service, /api/users/_ to users service, /api/chats/_ to chats service, /api/messages/_ to messages service, /api/media/_ to media service, /api/notifications/_ to notifications service
10. WHEN the gateway is containerized THEN the system SHALL provide a multi-stage Dockerfile and ECS task definition template

### Requirement 4: Authentication Service

**User Story:** As a user, I want secure authentication with JWT tokens, so that I can safely access the chat application with proper session management.

#### Acceptance Criteria

1. WHEN a user registers THEN the system SHALL validate input with Zod, hash password with bcrypt, create user record, and return access and refresh tokens
2. WHEN a user logs in THEN the system SHALL verify credentials, create DeviceSession with hashed refresh token, issue access token (15m TTL) and refresh token (30d TTL)
3. WHEN tokens are issued THEN the system SHALL send refresh token as httpOnly cookie with SameSite=Lax and access token in response body
4. WHEN a refresh token is used THEN the system SHALL rotate the refresh token, invalidate old token, and issue new access and refresh tokens
5. WHEN a user logs out THEN the system SHALL invalidate the DeviceSession and clear refresh token cookie
6. WHEN password reset is requested THEN the system SHALL generate secure reset token and provide reset endpoint
7. WHEN /me endpoint is called THEN the system SHALL return authenticated user details based on valid access token
8. WHEN the auth service starts THEN the system SHALL expose /healthz endpoint for health checks
9. WHEN the auth service is containerized THEN the system SHALL provide a multi-stage Dockerfile

### Requirement 5: Users Service

**User Story:** As a user, I want to manage my profile and search for other users, so that I can customize my presence and find contacts to chat with.

#### Acceptance Criteria

1. WHEN a user profile is requested THEN the system SHALL return user details by ID including username, name, avatarUrl, about, and lastSeen
2. WHEN a user searches for contacts THEN the system SHALL support query parameter ?q= and return matching users by username or name
3. WHEN a user updates their profile THEN the system SHALL allow PATCH /me to update name, avatar, and about fields with validation
4. WHEN a user blocks another user THEN the system SHALL add to blocked list and prevent message delivery
5. WHEN a user unblocks another user THEN the system SHALL remove from blocked list
6. WHEN presence is queried THEN the system SHALL return online status and lastSeen from Redis with TTL-based expiration
7. WHEN the users collection is created THEN the system SHALL create unique index on username field
8. WHEN the users service starts THEN the system SHALL expose /healthz endpoint for health checks
9. WHEN the users service is containerized THEN the system SHALL provide a multi-stage Dockerfile

### Requirement 6: Chats Service

**User Story:** As a user, I want to create and manage chat conversations (direct and group), so that I can communicate with individuals or groups.

#### Acceptance Criteria

1. WHEN a chat is created THEN the system SHALL support type "direct" or "group" with participants array and optional title/avatarUrl for groups
2. WHEN chats are listed THEN the system SHALL return all chats for authenticated user with lastMessageRef and sorted by updatedAt
3. WHEN a chat is retrieved THEN the system SHALL return full chat details including participants, admins, title, and avatarUrl
4. WHEN a member is added to group chat THEN the system SHALL verify requester is admin and add member to participants array
5. WHEN a member is removed from group chat THEN the system SHALL verify requester is admin and remove member from participants array
6. WHEN a group chat is updated THEN the system SHALL allow admins to PATCH title and avatarUrl
7. WHEN a chat is pinned THEN the system SHALL mark chat as pinned for the user
8. WHEN a chat is archived THEN the system SHALL mark chat as archived for the user
9. WHEN the chats service implements RBAC THEN the system SHALL enforce admin-only operations for group management
10. WHEN the chats service starts THEN the system SHALL expose /healthz endpoint for health checks
11. WHEN the chats service is containerized THEN the system SHALL provide a multi-stage Dockerfile

### Requirement 7: Messages Service

**User Story:** As a user, I want to send, receive, edit, and react to messages with media support, so that I can have rich conversations.

#### Acceptance Criteria

1. WHEN messages are retrieved THEN the system SHALL support cursor-based pagination with ?cursor= and ?limit= parameters ordered by createdAt descending
2. WHEN a message is sent THEN the system SHALL validate with Zod, save to MongoDB with chatId, senderId, body, optional media reference, optional replyTo, and status="sent"
3. WHEN a message is edited THEN the system SHALL update body and set editedAt timestamp
4. WHEN a message is deleted THEN the system SHALL either soft-delete or add userId to deletedFor array
5. WHEN a reaction is added THEN the system SHALL append to reactions array with userId and emoji
6. WHEN a message is marked as read THEN the system SHALL update status field and support batched read receipts
7. WHEN the messages collection is created THEN the system SHALL create compound index on { chatId: 1, createdAt: -1 }
8. WHEN a message schema is defined THEN the system SHALL support fields: \_id, chatId, senderId, body, media{type, url, duration, thumb}, replyTo, reactions[], status, createdAt, editedAt, deletedFor[]
9. WHEN the messages service starts THEN the system SHALL expose /healthz endpoint for health checks
10. WHEN the messages service is containerized THEN the system SHALL provide a multi-stage Dockerfile

### Requirement 8: Media Service

**User Story:** As a user, I want to upload and share media files (images, audio, documents), so that I can enrich my conversations with multimedia content.

#### Acceptance Criteria

1. WHEN a presigned URL is requested THEN the system SHALL validate file type and size before generating S3 presigned PUT URL
2. WHEN a presigned URL is generated THEN the system SHALL use AWS SDK v3 to create time-limited presigned PUT URL for S3_MEDIA_BUCKET
3. WHEN file validation occurs THEN the system SHALL whitelist allowed MIME types and enforce maximum file size limits
4. WHEN a link preview is requested THEN the system SHALL fetch metadata from URL and cache in MongoDB or Redis
5. WHEN the media service starts THEN the system SHALL expose /healthz endpoint for health checks
6. WHEN the media service is containerized THEN the system SHALL provide a multi-stage Dockerfile

### Requirement 9: Notifications Service

**User Story:** As a user, I want to receive push notifications for new messages, so that I stay informed even when not actively using the app.

#### Acceptance Criteria

1. WHEN a user subscribes to push notifications THEN the system SHALL store Web Push subscription with VAPID keys
2. WHEN a user unsubscribes THEN the system SHALL remove push subscription
3. WHEN a notification is sent THEN the system SHALL use Web Push protocol with VAPID authentication
4. WHEN the notifications service provides internal endpoint THEN the system SHALL expose POST /send for other services to trigger notifications
5. WHEN the notifications service starts THEN the system SHALL expose /healthz endpoint for health checks
6. WHEN the notifications service is containerized THEN the system SHALL provide a multi-stage Dockerfile

### Requirement 10: MongoDB Data Models

**User Story:** As a backend developer, I want well-defined MongoDB schemas with proper indexes, so that I can ensure data integrity and query performance.

#### Acceptance Criteria

1. WHEN the users collection is defined THEN the system SHALL include fields: \_id, username (unique), name, avatarUrl, about, contacts[], blocked[], lastSeen, createdAt
2. WHEN the chats collection is defined THEN the system SHALL include fields: \_id, type ("direct"|"group"), participants[], admins[], title, avatarUrl, lastMessageRef, createdAt, updatedAt
3. WHEN the messages collection is defined THEN the system SHALL include fields: \_id, chatId, senderId, body, media{type, url, duration, thumb}, replyTo, reactions[], status ("sent"|"delivered"|"read"), createdAt, editedAt, deletedFor[]
4. WHEN the deviceSessions collection is defined THEN the system SHALL include fields: \_id, userId, refreshTokenHash, ua, ip, expiresAt
5. WHEN collections are created THEN the system SHALL create appropriate indexes for query optimization

### Requirement 11: Frontend React Application

**User Story:** As a user, I want a modern, responsive web interface, so that I can easily chat, send media, and manage conversations from any device.

#### Acceptance Criteria

1. WHEN the frontend is initialized THEN the system SHALL use Vite + React + TypeScript + Tailwind CSS + React Router + React Query + Zustand
2. WHEN routing is configured THEN the system SHALL define routes: /login, /register, /chats, /chats/:id, /profile, /settings, /archived, /starred
3. WHEN authentication is implemented THEN the system SHALL store access token in memory, use httpOnly cookie for refresh, and implement silent token refresh with retry
4. WHEN Socket.io client is initialized THEN the system SHALL authenticate with access token, implement reconnection strategy, and map events to Zustand store
5. WHEN the chat UI is rendered THEN the system SHALL display sidebar with chat list (search, pinned, archived), chat view with message bubbles, composer with emoji picker and attachments
6. WHEN messages are displayed THEN the system SHALL show typing indicators, read/delivered ticks, date dividers, presence badges, and online/lastSeen status
7. WHEN files are uploaded THEN the system SHALL request presigned URL from /api/media/presign and PUT directly to S3
8. WHEN state is managed THEN the system SHALL use React Query for server state (users/chats/messages) and implement optimistic updates with tempId to \_id mapping
9. WHEN components are created THEN the system SHALL include: ChatItem, MessageBubble (text/media/reply), Composer, TypingDots, ReadReceipts, Avatar, Toasts
10. WHEN accessibility is implemented THEN the system SHALL include proper ARIA attributes and support keyboard navigation
11. WHEN responsive design is implemented THEN the system SHALL support both mobile and desktop layouts
12. WHEN the frontend is built THEN the system SHALL provide .env.example with VITE_API_URL, VITE_SOCKET_URL, VITE_CLOUDFRONT_MEDIA_URL

### Requirement 12: Security and Validation

**User Story:** As a security engineer, I want comprehensive security measures, so that the application is protected against common vulnerabilities.

#### Acceptance Criteria

1. WHEN routes receive input THEN the system SHALL validate all input with Zod schemas
2. WHEN errors occur THEN the system SHALL use centralized error handler with appropriate status codes
3. WHEN HTTP security is configured THEN the system SHALL use Helmet middleware for security headers
4. WHEN CORS is configured THEN the system SHALL restrict origins to ALLOWED_ORIGINS environment variable
5. WHEN rate limiting is implemented THEN the system SHALL use Redis-based rate limiting by IP and user ID
6. WHEN input is processed THEN the system SHALL sanitize user input to prevent injection attacks
7. WHEN media uploads are processed THEN the system SHALL whitelist file types and enforce size limits

### Requirement 13: Redis and WebSocket Scaling

**User Story:** As a DevOps engineer, I want horizontally scalable WebSocket infrastructure, so that the system can handle 1,000+ concurrent users across multiple instances.

#### Acceptance Criteria

1. WHEN Socket.io is configured THEN the system SHALL use @socket.io/redis-adapter for pub/sub across instances
2. WHEN presence is tracked THEN the system SHALL use Redis pub/sub for presence updates
3. WHEN typing events are emitted THEN the system SHALL debounce typing events to reduce Redis traffic
4. WHEN read receipts are sent THEN the system SHALL batch read receipts to optimize performance
5. WHEN ALB is configured THEN the system SHALL disable sticky sessions when using Redis adapter

### Requirement 14: Environment Configuration and Secrets

**User Story:** As a developer, I want clear environment configuration, so that I can easily set up local development and production environments.

#### Acceptance Criteria

1. WHEN .env.example is created THEN the system SHALL document all required environment variables: NODE_ENV, LOG_LEVEL, PORT, MONGO_URI, MONGO_DB_NAME, REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, JWT_ACCESS_TTL, JWT_REFRESH_TTL, ALLOWED_ORIGINS, S3_MEDIA_BUCKET, S3_REGION, CLOUDFRONT_MEDIA_DIST_ID, MEDIA_BASE_URL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
2. WHEN services load configuration THEN the system SHALL validate environment variables with Zod and fail fast on missing/invalid values

### Requirement 15: Docker and Local Development

**User Story:** As a developer, I want containerized services and local development environment, so that I can develop and test the entire system locally.

#### Acceptance Criteria

1. WHEN Dockerfiles are created THEN the system SHALL use multi-stage builds for gateway and all services
2. WHEN docker-compose.dev.yml is created THEN the system SHALL include gateway, all services, local MongoDB, and local Redis with hot reload support
3. WHEN local development is started THEN the system SHALL support running all services with docker-compose up

### Requirement 16: Testing

**User Story:** As a QA engineer, I want comprehensive testing infrastructure, so that I can verify functionality and performance.

#### Acceptance Criteria

1. WHEN unit tests are created THEN the system SHALL use Jest/Vitest for backend and React Testing Library for frontend
2. WHEN integration tests are created THEN the system SHALL test Socket.io events using socket.io-client and supertest
3. WHEN load testing is configured THEN the system SHALL provide Artillery scenario simulating 1,000 virtual users sending messages, reading, typing, and joining rooms

### Requirement 17: CI/CD Pipeline

**User Story:** As a DevOps engineer, I want automated CI/CD pipelines, so that code changes are automatically built, tested, and deployed.

#### Acceptance Criteria

1. WHEN web-deploy.yml workflow runs THEN the system SHALL build frontend, upload to S3, and invalidate CloudFront cache
2. WHEN service-build-deploy.yml workflow runs THEN the system SHALL build Docker images, push to ECR, and update ECS services
3. WHEN GitHub Actions authenticate to AWS THEN the system SHALL use OIDC to assume IAM role without long-lived credentials

### Requirement 18: AWS Infrastructure (Terraform)

**User Story:** As a DevOps engineer, I want infrastructure-as-code for AWS, so that I can provision and manage cloud resources consistently across environments.

#### Acceptance Criteria

1. WHEN VPC module is created THEN the system SHALL provision VPC, public/private subnets across 2-3 AZs, IGW, NAT gateways, and route tables
2. WHEN ECS module is created THEN the system SHALL provision ECS cluster, task execution roles, task roles, service definitions, and autoscaling policies
3. WHEN ALB module is created THEN the system SHALL provision Application Load Balancer with HTTP/HTTPS listeners, target groups, and WebSocket support
4. WHEN ECR module is created THEN the system SHALL provision repositories for gateway and all services
5. WHEN ElastiCache module is created THEN the system SHALL provision Redis cluster, subnet group, and security group
6. WHEN S3/CloudFront module is created THEN the system SHALL provision frontend bucket with CloudFront distribution and ACM certificate, plus media bucket
7. WHEN secrets module is created THEN the system SHALL provision Secrets Manager secrets and SSM parameters for sensitive configuration
8. WHEN Route53 module is created THEN the system SHALL provision hosted zone and DNS records
9. WHEN observability module is created THEN the system SHALL provision CloudWatch log groups and alarms
10. WHEN security groups are configured THEN the system SHALL allow ALB to ECS (HTTP), ECS to Redis (6379), and ECS to internet via NAT
11. WHEN ECS tasks are configured THEN the system SHALL reference Secrets Manager for JWT secrets, Redis auth, and MongoDB URI
12. WHEN environments are created THEN the system SHALL provide separate configurations for dev, staging, and prod
13. WHEN Terraform outputs are defined THEN the system SHALL output ALB DNS, CloudFront domain, Redis endpoint, ECR repo ARNs, and S3 bucket names
14. WHEN CloudFront is configured for SPA THEN the system SHALL route 404 errors to /index.html

### Requirement 19: Documentation

**User Story:** As a new developer, I want comprehensive documentation, so that I can quickly understand the architecture and get started with development.

#### Acceptance Criteria

1. WHEN README.md is created THEN the system SHALL include prerequisites, local development setup, environment configuration, available scripts, and deployment steps
2. WHEN docs/ARCHITECTURE.md is created THEN the system SHALL include Mermaid diagrams showing system architecture, data flow, and deployment topology
3. WHEN code is written THEN the system SHALL include inline comments explaining complex logic and integration points
