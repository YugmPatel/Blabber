# Auth Service

Authentication service for the WhatsApp-style chat application. Handles user registration, login, JWT token management, and session handling.

## Features

- User registration with password hashing (bcrypt)
- User login with JWT token issuance
- Access token (15m TTL) and refresh token (30d TTL) management
- Refresh token rotation for enhanced security
- Password reset flow
- Session management with device tracking
- HttpOnly cookies for refresh tokens

## Development

```bash
# Install dependencies (from root)
pnpm install

# Run in development mode with hot reload
pnpm --filter @services/auth dev

# Build
pnpm --filter @services/auth build

# Run tests
pnpm --filter @services/auth test

# Run tests in watch mode
pnpm --filter @services/auth test:watch
```

## Docker

### Building the Image

Build from the **repository root** (required for monorepo context):

```bash
docker build -f services/auth/Dockerfile -t auth-service:latest .
```

### Running the Container

```bash
docker run -p 3000:3000 \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e MONGO_URI=mongodb://localhost:27017 \
  -e MONGO_DB_NAME=chat_db \
  -e JWT_ACCESS_SECRET=your-access-secret \
  -e JWT_REFRESH_SECRET=your-refresh-secret \
  -e JWT_ACCESS_TTL=15m \
  -e JWT_REFRESH_TTL=30d \
  -e ALLOWED_ORIGINS=http://localhost:5173 \
  auth-service:latest
```

### Multi-stage Build Details

The Dockerfile uses a 3-stage build process:

1. **Base Stage**: Installs all dependencies using pnpm
2. **Build Stage**: Compiles TypeScript for shared packages and auth service
3. **Production Stage**: Creates minimal runtime image with only production dependencies

Benefits:

- Smaller final image size (only production dependencies)
- Faster builds with layer caching
- Enhanced security with non-root user
- Built-in health check

## Environment Variables

Required environment variables:

- `NODE_ENV`: Environment (development/production)
- `PORT`: Server port (default: 3000)
- `MONGO_URI`: MongoDB connection string
- `MONGO_DB_NAME`: MongoDB database name
- `JWT_ACCESS_SECRET`: Secret for access token signing
- `JWT_REFRESH_SECRET`: Secret for refresh token signing
- `JWT_ACCESS_TTL`: Access token TTL (e.g., "15m")
- `JWT_REFRESH_TTL`: Refresh token TTL (e.g., "30d")
- `ALLOWED_ORIGINS`: Comma-separated CORS origins

Optional:

- `LOG_LEVEL`: Logging level (default: "info")

## API Endpoints

- `GET /healthz` - Health check endpoint
- `POST /register` - User registration
- `POST /login` - User login
- `POST /refresh` - Refresh access token
- `POST /logout` - User logout
- `POST /password/forgot` - Request password reset
- `POST /password/reset` - Reset password with token
- `GET /me` - Get authenticated user details

## Architecture

The auth service follows a layered architecture:

- **Routes**: Express route handlers with Zod validation
- **Models**: MongoDB data models (User, DeviceSession, PasswordResetToken)
- **Utils**: JWT utilities and helper functions
- **Middleware**: Authentication and error handling

## Security Features

- Password hashing with bcrypt (10 rounds)
- JWT-based authentication
- Refresh token rotation
- HttpOnly cookies with SameSite=Lax
- Device session tracking
- Rate limiting (via gateway)
- Input validation with Zod
