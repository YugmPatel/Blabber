# Multi-stage Dockerfile for Media Service

# Stage 1: Base - Install dependencies
FROM node:20.11.0-alpine AS base

# Install pnpm
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

# Set working directory
WORKDIR /app

# Copy workspace configuration files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./

# Copy package.json files for all required packages
COPY packages/types/package.json ./packages/types/
COPY packages/config/package.json ./packages/config/
COPY packages/utils/package.json ./packages/utils/
COPY packages/tsconfig/package.json ./packages/tsconfig/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY services/media/package.json ./services/media/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Stage 2: Build - Compile TypeScript
FROM base AS build

# Copy source code for shared packages
COPY packages/types ./packages/types
COPY packages/config ./packages/config
COPY packages/utils ./packages/utils
COPY packages/tsconfig ./packages/tsconfig

# Copy media service source code
COPY services/media ./services/media

# Build shared packages first
RUN pnpm --filter @repo/types build
RUN pnpm --filter @repo/config build
RUN pnpm --filter @repo/utils build

# Build media service
RUN pnpm --filter @services/media build

# Stage 3: Production - Create minimal runtime image
FROM node:20.11.0-alpine AS production

# Install pnpm
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Set working directory
WORKDIR /app

# Copy workspace configuration
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./

# Copy package.json files
COPY packages/types/package.json ./packages/types/
COPY packages/config/package.json ./packages/config/
COPY packages/utils/package.json ./packages/utils/
COPY services/media/package.json ./services/media/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts from build stage
COPY --from=build /app/packages/types/dist ./packages/types/dist
COPY --from=build /app/packages/config/dist ./packages/config/dist
COPY --from=build /app/packages/utils/dist ./packages/utils/dist
COPY --from=build /app/services/media/dist ./services/media/dist

# Change ownership to non-root user
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port (default 3000, can be overridden by PORT env var)
EXPOSE 3000

# Set working directory to media service
WORKDIR /app/services/media

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 3000) + '/healthz', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); })"

# Start the service
CMD ["node", "dist/index.js"]
