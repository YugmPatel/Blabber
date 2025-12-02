// Service URLs configuration
export const serviceUrls = {
  auth: process.env.AUTH_SERVICE_URL || 'http://localhost:3001',
  users: process.env.USERS_SERVICE_URL || 'http://localhost:3002',
  chats: process.env.CHATS_SERVICE_URL || 'http://localhost:3003',
  messages: process.env.MESSAGES_SERVICE_URL || 'http://localhost:3004',
  media: process.env.MEDIA_SERVICE_URL || 'http://localhost:3005',
  notifications: process.env.NOTIFICATIONS_SERVICE_URL || 'http://localhost:3006',
};
