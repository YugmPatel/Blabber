# Implementation Plan

- [x] 1. Initialize monorepo structure and root configuration
  - Create root package.json with pnpm workspaces configuration
  - Create pnpm-workspace.yaml defining apps/, services/, and packages/ workspaces
  - Create turbo.json with pipelines for build, lint, test, dev, and deploy
  - Create root configuration files: .editorconfig, .gitignore, .nvmrc, .prettierrc, .eslintrc.cjs
  - Create .env.example with all required environment variables
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 14.1_

- [x] 2. Create shared packages foundation

- [x] 2.1 Implement packages/tsconfig
  - Create base tsconfig.json for services
  - Create tsconfig.json for React apps
  - Create package.json with proper exports
  - _Requirements: 2.5_

- [x] 2.2 Implement packages/eslint-config
  - Create ESLint configuration for TypeScript projects
  - Create package.json with peer dependencies
  - _Requirements: 2.4_

- [x] 2.3 Implement packages/types
  - Define User, Chat, Message, Reaction, Media types with TypeScript interfaces
  - Create Zod schemas for User, Chat, Message, Media, JWT tokens
  - Create API DTO types for requests and responses
  - Create package.json and export all types
  - _Requirements: 2.1_

- [x] 2.4 Implement packages/config
  - Create environment config loaders with Zod validation for common config (NODE_ENV, LOG_LEVEL, PORT)
  - Create database config loader (MONGO_URI, MONGO_DB_NAME)
  - Create Redis config loader (REDIS_HOST, REDIS_PORT, REDIS_PASSWORD)
  - Create JWT config loader (JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, JWT_ACCESS_TTL, JWT_REFRESH_TTL)
  - Create S3/CloudFront config loader
  - Create CORS config loader (ALLOWED_ORIGINS)
  - Create package.json and export all config loaders
  - _Requirements: 2.2, 14.2_

- [x] 2.5 Implement packages/utils
  - Create Pino logger with structured logging configuration
  - Create HTTP error classes (AppError, NotFoundError, UnauthorizedError, ValidationError)
  - Create async handler wrapper for Express routes
  - Create Redis-based rate limit middleware
  - Create JWT auth middleware for access token verification
  - Create pagination helpers for cursor-based pagination
  - Create package.json and export all utilities
  - _Requirements: 2.3_

- [-] 3. Implement Auth Service

- [x] 3.1 Set up auth service structure
  - Create services/auth directory with src/, package.json, tsconfig.json
  - Set up Express app with basic middleware (helmet, cors, json)
  - Create MongoDB connection utility using packages/config
  - Create /healthz endpoint
  - _Requirements: 4.8_

- [x] 3.2 Implement user registration
  - Create POST /register route with Zod validation
  - Implement password hashing with bcrypt (10 rounds)
  - Create user document in MongoDB users collection
  - Generate access token (15m TTL) and refresh token (30d TTL)
  - Create DeviceSession document with hashed refresh token
  - Return user data, access token, and set httpOnly cookie for refresh token
  - Write unit tests for registration flow
  - _Requirements: 4.1_

- [x] 3.3 Implement user login
  - Create POST /login route with Zod validation
  - Verify email and password against users collection
  - Generate access and refresh tokens
  - Create DeviceSession with user agent and IP address
  - Set httpOnly cookie with SameSite=Lax for refresh token
  - Write unit tests for login flow
  - _Requirements: 4.2, 4.3_

- [x] 3.4 Implement token refresh with rotation
  - Create POST /refresh route that reads refresh token from cookie
  - Verify refresh token and find matching DeviceSession
  - Invalidate old DeviceSession
  - Generate new access and refresh tokens
  - Create new DeviceSession with new refresh token hash
  - Set new httpOnly cookie
  - Write unit tests for refresh rotation
  - _Requirements: 4.4_

- [x] 3.5 Implement logout
  - Create POST /logout route
  - Delete DeviceSession from database
  - Clear refresh token cookie
  - Write unit tests for logout
  - _Requirements: 4.5_

- [x] 3.6 Implement password reset flow
  - Create POST /password/forgot route to generate reset token
  - Create POST /password/reset route to update password with valid token
  - Write unit tests for password reset
  - _Requirements: 4.6_

- [x] 3.7 Implement GET /me endpoint
  - Create GET /me route with JWT auth middleware
  - Return authenticated user details
  - Write unit tests for /me endpoint
  - _Requirements: 4.7_

- [x] 3.8 Create Dockerfile for auth service
  - Create multi-stage Dockerfile with build and production stages
  - _Requirements: 4.9_

- [x] 4. Implement Users Service

- [x] 4.1 Set up users service structure
  - Create services/users directory with src/, package.json, tsconfig.json
  - Set up Express app with middleware
  - Create MongoDB connection utility
  - Create /healthz endpoint
  - _Requirements: 5.8_

- [x] 4.2 Implement user profile retrieval
  - Create GET /:id route to fetch user by ID
  - Return user details (username, name, avatarUrl, about, lastSeen)
  - Write unit tests for profile retrieval
  - _Requirements: 5.1_

- [x] 4.3 Implement user search
  - Create GET /search route with query parameter ?q=
  - Implement MongoDB text search on username and name fields
  - Filter out blocked users from results
  - Write unit tests for search functionality
  - _Requirements: 5.2_

- [x] 4.4 Implement profile update
  - Create PATCH /me route with Zod validation
  - Allow updates to name, avatarUrl, and about fields
  - Write unit tests for profile updates
  - _Requirements: 5.3_

- [x] 4.5 Implement block/unblock functionality
  - Create POST /block route to add user to blocked list
  - Create POST /unblock route to remove user from blocked list
  - Write unit tests for block/unblock
  - _Requirements: 5.4, 5.5_

- [x] 4.6 Implement presence tracking with Redis
  - Create GET /presence/:id route
  - Implement Redis-based presence with TTL (5 minutes)
  - Return online status and lastSeen timestamp
  - Write unit tests for presence tracking
  - _Requirements: 5.6_

- [x] 4.7 Create MongoDB indexes for users collection
  - Create unique index on username field
  - Create text index on username and name for search
  - _Requirements: 5.7_

- [x] 4.8 Create Dockerfile for users service
  - Create multi-stage Dockerfile
  - _Requirements: 5.9_

- [x] 5. Implement Chats Service

- [x] 5.1 Set up chats service structure
  - Create services/chats directory with src/, package.json, tsconfig.json
  - Set up Express app with middleware
  - Create MongoDB connection utility
  - Create /healthz endpoint
  - _Requirements: 6.10_

- [x] 5.2 Implement chat creation
  - Create POST / route with Zod validation
  - Support type "direct" and "group"
  - For direct chats: validate exactly 2 participants
  - For group chats: set creator as initial admin, require title
  - Write unit tests for chat creation
  - _Requirements: 6.1_

- [x] 5.3 Implement chat listing
  - Create GET / route to list all chats for authenticated user
  - Filter by participants array
  - Sort by updatedAt descending
  - Include lastMessageRef in response
  - Write unit tests for chat listing
  - _Requirements: 6.2_

- [x] 5.4 Implement chat retrieval
  - Create GET /:id route

  - Return full chat details including participants, admins, title, avatarUrl
  - Write unit tests for chat retrieval
  - _Requirements: 6.3_

- [x] 5.5 Implement group member management
  - Create POST /:id/members route to add member (admin only)
  - Create DELETE /:id/members/:userId route to remove member (admin only)
  - Implement RBAC middleware to verify admin role
  - Write unit tests for member management
  - _Requirements: 6.4, 6.5, 6.9_

- [x] 5.6 Implement group chat updates
  - Create PATCH /:id route to update title and avatarUrl (admin only)
  - Apply RBAC middleware
  - Write unit tests for chat updates
  - _Requirements: 6.6_

- [x] 5.7 Implement pin and archive functionality
  - Create POST /:id/pin route to mark chat as pinned
  - Create POST /:id/archive route to mark chat as archived
  - Write unit tests for pin/archive
  - _Requirements: 6.7, 6.8_

- [x] 5.8 Create Dockerfile for chats service
  - Create multi-stage Dockerfile
  - _Requirements: 6.11_

- [x] 6. Implement Messages Service

- [x] 6.1 Set up messages service structure
  - Create services/messages directory with src/, package.json, tsconfig.json
  - Set up Express app with middleware
  - Create MongoDB connection utility
  - Create /healthz endpoint
  - _Requirements: 7.9_

- [x] 6.2 Implement message retrieval with cursor pagination
  - Create GET /:chatId route with ?cursor= and ?limit= query parameters
  - Implement cursor-based pagination using createdAt and \_id
  - Order by createdAt descending
  - Return messages array and nextCursor
  - Write unit tests for pagination
  - _Requirements: 7.1_

- [x] 6.3 Implement message sending
  - Create POST /:chatId route with Zod validation
  - Save message to MongoDB with chatId, senderId, body, optional media, optional replyTo
  - Set initial status to "sent"
  - Update chat's lastMessageRef
  - Return created message document
  - Write unit tests for message sending
  - _Requirements: 7.2_

- [x] 6.4 Implement message editing
  - Create PATCH /:messageId route
  - Update body field and set editedAt timestamp
  - Verify sender is message owner
  - Write unit tests for message editing
  - _Requirements: 7.3_

- [x] 6.5 Implement message deletion
  - Create DELETE /:messageId route
  - Add userId to deletedFor array (soft delete)
  - Write unit tests for message deletion
  - _Requirements: 7.4_

- [x] 6.6 Implement reactions
  - Create POST /:messageId/react route
  - Append or update reaction in reactions array (one emoji per user)
  - Write unit tests for reactions
  - _Requirements: 7.5_

- [x] 6.7 Implement read receipts
  - Create POST /:messageId/read route with batched messageIds
  - Update status field to "read"
  - Support batch updates for multiple messages
  - Write unit tests for read receipts
  - _Requirements: 7.6_

- [x] 6.8 Create MongoDB indexes for messages collection
  - Create compound index on { chatId: 1, createdAt: -1 }
  - Create index on senderId
  - _Requirements: 7.7_

- [x] 6.9 Create Dockerfile for messages service
  - Create multi-stage Dockerfile
  - _Requirements: 7.10_

- [x] 7. Implement Media Service

- [x] 7.1 Set up media service structure
  - Create services/media directory with src/, package.json, tsconfig.json
  - Set up Express app with middleware
  - Create MongoDB connection utility
  - Create /healthz endpoint
  - _Requirements: 8.5_

- [x] 7.2 Implement presigned URL generation
  - Create POST /presign route with Zod validation
  - Validate file type against whitelist (images, audio, documents)
  - Validate file size against limits (images 10MB, audio 20MB, documents 50MB)
  - Use AWS SDK v3 to generate S3 presigned PUT URL with 5-minute expiration
  - Create media document in MongoDB
  - Return uploadUrl, mediaId, and expiresIn
  - Write unit tests for presigned URL generation
  - _Requirements: 8.1, 8.2, 8.3_

- [x] 7.3 Implement link preview
  - Create GET /link-preview route with ?url= query parameter
  - Fetch URL and parse OpenGraph/meta tags
  - Cache result in Redis with 24-hour TTL
  - Return title, description, image, and url
  - Write unit tests for link preview
  - _Requirements: 8.4_

- [x] 7.4 Create Dockerfile for media service
  - Create multi-stage Dockerfile
  - _Requirements: 8.6_

- [x] 8. Implement Notifications Service

- [x] 8.1 Set up notifications service structure
  - Create services/notifications directory with src/, package.json, tsconfig.json
  - Set up Express app with middleware
  - Create MongoDB connection utility
  - Create /healthz endpoint
  - _Requirements: 9.5_

- [x] 8.2 Implement push subscription management
  - Create POST /push/subscribe route to store Web Push subscription
  - Create POST /push/unsubscribe route to remove subscription
  - Store subscriptions in pushSubscriptions collection
  - Write unit tests for subscription management
  - _Requirements: 9.1, 9.2_

- [x] 8.3 Implement push notification sending
  - Create internal POST /send route for other services
  - Implement Web Push protocol with VAPID authentication
  - Include retry logic for failed deliveries
  - Clean up expired subscriptions on 410 Gone response
  - Write unit tests for notification sending
  - _Requirements: 9.3, 9.4_

- [x] 8.4 Create Dockerfile for notifications service
  - Create multi-stage Dockerfile

  - _Requirements: 9.6_

- [x] 9. Implement Gateway/BFF

- [x] 9.1 Set up gateway structure
  - Create apps/gateway directory with src/, package.json, tsconfig.json
  - Set up Express app with helmet, cors, rate-limit, and json middleware
  - Create /healthz endpoint
  - Write basic supertest for /healthz
  - _Requirements: 3.1, 3.2_

- [x] 9.2 Implement HTTP API routing and proxying
  - Create route handlers to proxy /api/auth/\* to auth service

  - Create route handlers to proxy /api/users/\* to users service
  - Create route handlers to proxy /api/chats/\* to chats service
  - Create route handlers to proxy /api/messages/\* to messages service
  - Create route handlers to proxy /api/media/\* to media service
  - Create route handlers to proxy /api/notifications/\* to notifications service
  - Write integration tests for routing
  - _Requirements: 3.9_

- [x] 9.3 Set up Socket.io server with Redis adapter
  - Create Socket.io server attached to HTTP server
  - Configure @socket.io/redis-adapter for horizontal scaling
  - Write basic Socket.io connection test
  - _Requirements: 3.3, 13.1_

- [x] 9.4 Implement Socket.io authentication
  - Verify access token during socket handshake
  - Reject unauthorized connections
  - Join authenticated user to user:<id> room
  - Write tests for socket authentication
  - _Requirements: 3.4_

- [x] 9.5 Implement Socket.io room management
  - Join clients to chat:<chatId> rooms on chat:join event
  - Leave rooms on chat:leave event
  - Write tests for room management
  - _Requirements: 3.5_

- [x] 9.6 Implement client-to-server socket events
  - Implement auth:hello event handler
  - Implement message:send event handler (call messages service, broadcast to room)
  - Implement message:read event handler (call messages service, emit receipts)
  - Implement typing:start and typing:stop handlers with debouncing
  - Implement reaction:set event handler
  - Implement chat:create, chat:join, chat:leave event handlers
  - Write integration tests for socket events
  - _Requirements: 3.6, 13.2_

- [x] 9.7 Implement server-to-client socket events
  - Emit message:new when new message received
  - Emit message:edit when message edited
  - Emit message:delete when message deleted
  - Emit receipt:delivered and receipt:read for delivery/read receipts
  - Emit typing:update for typing indicators
  - Emit chat:updated when chat metadata changes
  - Emit presence:update when user presence changes
  - Emit error for error notifications
  - Write tests for server events
  - _Requirements: 3.7, 13.3_

- [x] 9.8 Implement optimistic message handling
  - Accept tempId from client in message:send
  - Map tempId to definitive \_id from messages service
  - Acknowledge to client with tempId -> \_id mapping
  - Write tests for optimistic updates
  - _Requirements: 3.8_

- [x] 9.9 Create Dockerfile and ECS task definition template
  - Create multi-stage Dockerfile for gateway
  - Create ecs-taskdef.json template
  - _Requirements: 3.10_

- [x] 10. Implement Frontend React Application

- [x] 10.1 Set up frontend project structure
  - Create apps/web directory with Vite + React + TypeScript
  - Configure Tailwind CSS
  - Set up React Router with routes: /login, /register, /chats, /chats/:id, /profile, /settings
  - Create .env.example with VITE_API_URL, VITE_SOCKET_URL, VITE_CLOUDFRONT_MEDIA_URL
  - _Requirements: 11.1, 11.2, 11.12_

- [x] 10.2 Implement authentication context and API client
  - Create AuthContext with access token state
  - Create axios client with request interceptor to add Bearer token
  - Implement response interceptor for 401 handling and silent token refresh
  - Store access token in memory, use httpOnly cookie for refresh
  - Write tests for auth flow
  - _Requirements: 11.3_

- [x] 10.3 Implement login and register pages
  - Create LoginPage with form (email, password)
  - Create RegisterPage with form (username, email, password, name)

  - Implement form validation
  - Call /api/auth/login and /api/auth/register
  - Redirect to /chats on success
  - Write tests for auth pages
  - _Requirements: 11.3_

- [x] 10.4 Set up React Query for server state
  - Configure QueryClientProvider
  - Create query hooks for users, chats, and messages
  - Implement infinite scroll for messages with useInfiniteQuery
  - Write tests for query hooks
  - _Requirements: 11.8_

- [x] 10.5 Set up Zustand for client state
  - Create Zustand store for access token, socket connection, active chat, pending messages, typing indicators
  - Write tests for store actions
  - _Requirements: 11.8_

- [x] 10.6 Implement Socket.io client integration
  - Create SocketProvider with Socket.io client
  - Authenticate with access token on connection
  - Implement reconnection strategy
  - Create useSocket hook
  - Write tests for socket connection
  - _Requirements: 11.4_

- [x] 10.7 Implement socket event handlers
  - Create useSocketEvents hook to subscribe to server events
  - Map message:new to React Query cache updates
  - Map typing:update to Zustand store
  - Map presence:update to React Query cache
  - Map receipt:read to message status updates
  - Handle optimistic message resolution (tempId -> \_id)
  - Write tests for event handlers
  - _Requirements: 11.4, 11.8_

- [x] 10.8 Implement chat list sidebar
  - Create Sidebar component with search bar
  - Create ChatList component to display all chats
  - Create ChatItem component with Avatar, chat preview, unread badge
  - Implement search functionality
  - Display pinned and archived chats
  - Write tests for sidebar components
  - _Requirements: 11.5_

-

- [x] 10.9 Implement chat view
  - Create ChatView component for /chats/:id route
  - Create ChatHeader with avatar, chat info, and actions
  - Create MessageList with infinite scroll
  - Create DateDivider component
  - Create MessageBubble component for text, media, replies
  - Display typing indicators with TypingDots component
  - Display read/delivered ticks with ReadReceipts component
  - Write tests for chat view components
  - _Requirements: 11.5, 11.6_

- [x] 10.10 Implement message composer
  - Create Composer component with text input
  - Integrate emoji picker
  - Implement file upload button
  - Create useSendMessage hook with optimistic updates
  - Emit message:send via socket with tempId
  - Write tests for composer
  - _Requirements: 11.5, 11.8_

- [x] 10.11 Implement file upload flow
  - Create useFileUpload hook
  - Request presigned URL from /api/media/presign
  - Upload file directly to S3 using presigned PUT URL
  - Return mediaId for message attachment
  - Write tests for file upload
  - _Requirements: 11.7_

- [x] 10.12 Implement presence and online status
  - Display presence badges on avatars
  - Show online/lastSeen status in chat header
  - Update presence from socket events
  - Write tests for presence display
  - _Requirements: 11.6_

- [x] 10.13 Implement shared UI components
  - Create Avatar component
  - Create Toast notification component
  - Ensure all components have proper ARIA attributes
  - Implement responsive layouts for mobile and desktop
  - Write tests for UI components
  - _Requirements: 11.9, 11.10, 11.11_

- [x] 10.14 Create Dockerfile for frontend
  - Create multi-stage Dockerfile with build and nginx stages
  - _Requirements: 11.12_

- [ ] 11. Set up local development environment
- [ ] 11.1 Create docker-compose.dev.yml
  - Define services for MongoDB, Redis, gateway, and all microservices
  - Configure hot reload with volume mounts
  - Set up service networking
  - _Requirements: 15.2, 15.3_

- [ ] 11.2 Create development scripts
  - Add "dev" script to root package.json using turbo
  - Add "docker:build" and "docker:up" scripts
  - Test local development setup
  - _Requirements: 15.2_

- [ ] 12. Implement testing infrastructure
- [ ] 12.1 Set up unit testing
  - Configure Jest/Vitest for backend services
  - Configure React Testing Library for frontend
  - Write sample unit tests for each service
  - _Requirements: 16.1_

- [ ] 12.2 Set up integration testing
  - Create Socket.io integration tests using socket.io-client and supertest
  - Test message flow end-to-end
  - _Requirements: 16.2_

- [ ] 12.3 Create load testing scenario
  - Create loadtest/artillery.yml
  - Define scenario simulating 1,000 virtual users
  - Include WebSocket and HTTP requests (sending messages, reading, typing, joining rooms)
  - _Requirements: 16.3_

- [ ] 13. Set up CI/CD pipelines
- [ ] 13.1 Create web deployment workflow
  - Create .github/workflows/web-deploy.yml
  - Build frontend with Vite
  - Upload build artifacts to S3
  - Invalidate CloudFront cache
  - Use GitHub OIDC for AWS authentication
  - _Requirements: 17.1, 17.3_

- [ ] 13.2 Create service deployment workflow
  - Create .github/workflows/service-build-deploy.yml
  - Build Docker images for gateway and all services
  - Push images to ECR
  - Update ECS service definitions
  - Use GitHub OIDC for AWS authentication
  - _Requirements: 17.2, 17.3_

- [ ] 14. Create Terraform infrastructure modules
- [ ] 14.1 Create VPC module
  - Define VPC with public and private subnets across 2-3 AZs
  - Create Internet Gateway and NAT gateways
  - Configure route tables
  - _Requirements: 18.1_

- [ ] 14.2 Create ECR module
  - Define ECR repositories for gateway and all services
  - Configure lifecycle policies
  - _Requirements: 18.4_

- [ ] 14.3 Create ElastiCache module
  - Define Redis cluster
  - Create subnet group and security group
  - _Requirements: 18.5_

- [ ] 14.4 Create S3 and CloudFront module
  - Create S3 bucket for frontend with static website hosting
  - Create CloudFront distribution with ACM certificate
  - Configure SPA routing (404 -> /index.html)
  - Create S3 bucket for media storage
  - _Requirements: 18.6, 18.14_

- [ ] 14.5 Create Secrets Manager module
  - Define secrets for JWT secrets, Redis auth, MongoDB URI
  - Create SSM parameters for non-sensitive config
  - _Requirements: 18.7, 18.11_

- [ ] 14.6 Create ALB module
  - Define Application Load Balancer in public subnets
  - Create HTTP and HTTPS listeners
  - Configure target groups for gateway
  - Enable WebSocket support
  - _Requirements: 18.3, 18.10_

- [ ] 14.7 Create ECS module
  - Define ECS cluster on Fargate
  - Create task execution role and task roles
  - Define task definitions for gateway and all services (reference Secrets Manager)
  - Create ECS services in private subnets
  - Configure autoscaling policies
  - _Requirements: 18.2, 18.11_

- [ ] 14.8 Create security groups
  - Define security group for ALB (allow 80/443 from internet)
  - Define security group for ECS tasks (allow traffic from ALB, Redis, and NAT for outbound)
  - Define security group for Redis (allow 6379 from ECS)
  - _Requirements: 18.10_

- [ ] 14.9 Create Route53 module
  - Define hosted zone
  - Create A records for chat.example.com (CloudFront) and api.example.com (ALB)
  - _Requirements: 18.8_

- [ ] 14.10 Create observability module
  - Define CloudWatch log groups for all services
  - Create CloudWatch alarms for critical metrics
  - _Requirements: 18.9_

- [ ] 14.11 Create environment configurations
  - Create infra/terraform/envs/dev with main.tf, variables.tf, outputs.tf
  - Create infra/terraform/envs/staging with main.tf, variables.tf, outputs.tf
  - Create infra/terraform/envs/prod with main.tf, variables.tf, outputs.tf
  - Define outputs for ALB DNS, CloudFront domain, Redis endpoint, ECR ARNs, S3 bucket names
  - _Requirements: 18.12, 18.13_

- [ ] 15. Create comprehensive documentation
- [ ] 15.1 Create README.md
  - Document prerequisites (pnpm, Node LTS, Docker, Terraform, AWS CLI)
  - Provide local development setup instructions
  - Document environment configuration
  - List available scripts
  - Provide deployment steps
  - _Requirements: 19.1_

- [ ] 15.2 Create docs/ARCHITECTURE.md
  - Include Mermaid diagrams for system architecture
  - Document data flow patterns
  - Describe deployment topology
  - Explain design decisions
  - _Requirements: 19.2_

- [ ] 15.3 Add inline code comments
  - Review all code and add comments for complex logic
  - Document integration points between services
  - _Requirements: 19.3_
