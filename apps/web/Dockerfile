# Stage 1: Build
FROM node:20.19.4-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

# Set working directory
WORKDIR /app

# Copy workspace files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./

# Copy package files for all workspaces
COPY packages/types/package.json ./packages/types/
COPY packages/config/package.json ./packages/config/
COPY packages/utils/package.json ./packages/utils/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/tsconfig/package.json ./packages/tsconfig/
COPY apps/web/package.json ./apps/web/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code for packages
COPY packages/ ./packages/

# Copy source code for web app
COPY apps/web/ ./apps/web/

# Browser must reach the gateway on the host (baked in at build time for static nginx)
ARG VITE_API_URL
ARG VITE_SOCKET_URL
ARG VITE_LIVEKIT_WS_URL
ARG VITE_ALLOW_LOCAL_API_FALLBACK=false
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_SOCKET_URL=$VITE_SOCKET_URL
ENV VITE_LIVEKIT_WS_URL=$VITE_LIVEKIT_WS_URL
ENV VITE_ALLOW_LOCAL_API_FALLBACK=$VITE_ALLOW_LOCAL_API_FALLBACK

RUN pnpm --filter @repo/types build

WORKDIR /app/apps/web
# Production bundle uses the same TypeScript build path as the package script.
RUN pnpm build

# Stage 2: Production with Nginx
FROM nginx:alpine

RUN apk add --no-cache curl

# Copy custom nginx config
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets from builder stage
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

# Expose port 80
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -fsS http://127.0.0.1/health >/dev/null || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
