import { Router } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { serviceUrls } from '../config.js';

const router: Router = Router();

function hasJsonBody(req: any) {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  return (
    req.body &&
    contentType.includes('application/json') &&
    ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)
  );
}

function writeJsonBody(proxyReq: any, req: any) {
  if (!hasJsonBody(req)) return;
  const bodyData = JSON.stringify(req.body);
  proxyReq.setHeader('Content-Type', 'application/json');
  proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
  proxyReq.write(bodyData);
}

function forwardCommonHeaders(proxyReq: any, req: any) {
  if (req.headers.authorization) {
    proxyReq.setHeader('Authorization', req.headers.authorization);
  }
  if (req.headers.cookie) {
    proxyReq.setHeader('Cookie', req.headers.cookie);
  }
  if (req.requestId) {
    proxyReq.setHeader('x-request-id', req.requestId);
  }
}

// Proxy to Auth Service
router.use(
  '/api/auth',
  createProxyMiddleware({
    target: serviceUrls.auth,
    changeOrigin: true,
    pathRewrite: {
      '^/api/auth': '', // Remove /api/auth prefix
    },
    cookieDomainRewrite: '',
    onProxyReq: (proxyReq, req: any) => {
      forwardCommonHeaders(proxyReq, req);
      writeJsonBody(proxyReq, req);
    },
    onProxyRes: (proxyRes, _req, res) => {
      // Forward Set-Cookie headers - ensure they work across the proxy
      const setCookieHeaders = proxyRes.headers['set-cookie'];
      if (setCookieHeaders) {
        // Modify cookies to remove domain restriction for localhost dev
        const modifiedCookies = setCookieHeaders.map((cookie: string) => {
          // Remove any domain attribute for localhost development
          return cookie.replace(/;\s*domain=[^;]*/gi, '');
        });
        res.setHeader('Set-Cookie', modifiedCookies);
      }
    },
    onError: (err, _req, res) => {
      console.error('Auth service proxy error:', err);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Auth service unavailable' });
      }
    },
  })
);

// Proxy to Users Service
router.use(
  '/api/users',
  createProxyMiddleware({
    target: serviceUrls.users,
    changeOrigin: true,
    pathRewrite: {
      '^/api/users': '',
    },
    onProxyReq: (proxyReq, req: any) => {
      forwardCommonHeaders(proxyReq, req);
      writeJsonBody(proxyReq, req);
    },
    onError: (err, _req, res) => {
      console.error('Users service proxy error:', err);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Users service unavailable' });
      }
    },
  })
);

router.use(
  '/api/moments',
  createProxyMiddleware({
    target: serviceUrls.users,
    changeOrigin: true,
    pathRewrite: {
      '^/api/moments': '/moments',
    },
    onProxyReq: (proxyReq, req: any) => {
      forwardCommonHeaders(proxyReq, req);
      writeJsonBody(proxyReq, req);
    },
    onError: (err, _req, res) => {
      console.error('Moments service proxy error:', err);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Moments service unavailable' });
      }
    },
  })
);

router.use(
  /^\/api\/profiles\/([^/]+)\/reels/,
  createProxyMiddleware({
    target: serviceUrls.media,
    changeOrigin: true,
    pathRewrite: (_path, req: any) => req.originalUrl.replace(/^\/api\//, '/').split('?')[0] + (req.url.includes('?') ? `?${req.url.split('?')[1]}` : ''),
    onProxyReq: (proxyReq, req: any) => {
      forwardCommonHeaders(proxyReq, req);
      writeJsonBody(proxyReq, req);
    },
    onError: (err, _req, res) => {
      console.error('Profile Reels proxy error:', err);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Reels service unavailable' });
      }
    },
  })
);

router.use(
  '/api/profiles',
  createProxyMiddleware({
    target: serviceUrls.users,
    changeOrigin: true,
    pathRewrite: {
      '^/api/profiles': '/profiles',
    },
    onProxyReq: (proxyReq, req: any) => {
      forwardCommonHeaders(proxyReq, req);
      writeJsonBody(proxyReq, req);
    },
    onError: (err, _req, res) => {
      console.error('Profiles service proxy error:', err);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Profiles service unavailable' });
      }
    },
  })
);

router.use(
  '/api/reels',
  createProxyMiddleware({
    target: serviceUrls.media,
    changeOrigin: true,
    pathRewrite: {
      '^/api/reels': '/reels',
    },
    onProxyReq: (proxyReq, req: any) => {
      forwardCommonHeaders(proxyReq, req);
      writeJsonBody(proxyReq, req);
    },
    onError: (err, _req, res) => {
      console.error('Reels service proxy error:', err);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Reels service unavailable' });
      }
    },
  })
);

router.use(
  '/api/feed',
  createProxyMiddleware({
    target: serviceUrls.users,
    changeOrigin: true,
    pathRewrite: {
      '^/api/feed': '/feed',
    },
    onProxyReq: (proxyReq, req: any) => {
      forwardCommonHeaders(proxyReq, req);
      writeJsonBody(proxyReq, req);
    },
    onError: (err, _req, res) => {
      console.error('Feed service proxy error:', err);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Feed service unavailable' });
      }
    },
  })
);

router.use(
  '/api/discovery',
  createProxyMiddleware({
    target: serviceUrls.users,
    changeOrigin: true,
    pathRewrite: {
      '^/api/discovery': '/discovery',
    },
    onProxyReq: (proxyReq, req: any) => {
      forwardCommonHeaders(proxyReq, req);
      writeJsonBody(proxyReq, req);
    },
    onError: (err, _req, res) => {
      console.error('Discovery service proxy error:', err);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Discovery service unavailable' });
      }
    },
  })
);

router.use(
  '/api/posts',
  createProxyMiddleware({
    target: serviceUrls.users,
    changeOrigin: true,
    pathRewrite: {
      '^/api/posts': '/posts',
    },
    onProxyReq: (proxyReq, req: any) => {
      forwardCommonHeaders(proxyReq, req);
      writeJsonBody(proxyReq, req);
    },
    onError: (err, _req, res) => {
      console.error('Posts service proxy error:', err);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Posts service unavailable' });
      }
    },
  })
);

router.use(
  '/api/communities',
  createProxyMiddleware({
    target: serviceUrls.users,
    changeOrigin: true,
    pathRewrite: {
      '^/api/communities': '/communities',
    },
    onProxyReq: (proxyReq, req: any) => {
      forwardCommonHeaders(proxyReq, req);
      writeJsonBody(proxyReq, req);
    },
    onError: (err, _req, res) => {
      console.error('Communities service proxy error:', err);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Communities service unavailable' });
      }
    },
  })
);

router.use(
  '/api/community-posts',
  createProxyMiddleware({
    target: serviceUrls.users,
    changeOrigin: true,
    pathRewrite: {
      '^/api/community-posts': '/community-posts',
    },
    onProxyReq: (proxyReq, req: any) => {
      forwardCommonHeaders(proxyReq, req);
      writeJsonBody(proxyReq, req);
    },
    onError: (err, _req, res) => {
      console.error('Community posts service proxy error:', err);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Community posts service unavailable' });
      }
    },
  })
);

router.use(
  '/api/reports',
  createProxyMiddleware({
    target: serviceUrls.users,
    changeOrigin: true,
    pathRewrite: {
      '^/api/reports': '/reports',
    },
    onProxyReq: (proxyReq, req: any) => {
      forwardCommonHeaders(proxyReq, req);
      writeJsonBody(proxyReq, req);
    },
    onError: (err, _req, res) => {
      console.error('Reports service proxy error:', err);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Reports service unavailable' });
      }
    },
  })
);

router.use(
  '/api/moderation',
  createProxyMiddleware({
    target: serviceUrls.users,
    changeOrigin: true,
    pathRewrite: {
      '^/api/moderation': '/moderation',
    },
    onProxyReq: (proxyReq, req: any) => {
      forwardCommonHeaders(proxyReq, req);
      writeJsonBody(proxyReq, req);
    },
    onError: (err, _req, res) => {
      console.error('Moderation service proxy error:', err);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Moderation service unavailable' });
      }
    },
  })
);

// Proxy to Chats Service
router.use(
  '/api/chats',
  createProxyMiddleware({
    target: serviceUrls.chats,
    changeOrigin: true,
    pathRewrite: {
      '^/api/chats': '',
    },
    onProxyReq: (proxyReq, req: any) => {
      forwardCommonHeaders(proxyReq, req);
      writeJsonBody(proxyReq, req);
    },
    onError: (err, _req, res) => {
      console.error('Chats service proxy error:', err);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Chats service unavailable' });
      }
    },
  })
);

// Proxy to Intelligence endpoints (served by Chats Service)
router.use(
  '/api/intelligence',
  createProxyMiddleware({
    target: serviceUrls.intelligence,
    changeOrigin: true,
    pathRewrite: {
      '^/api/intelligence': '/intelligence',
    },
    onProxyReq: (proxyReq, req: any) => {
      forwardCommonHeaders(proxyReq, req);
      writeJsonBody(proxyReq, req);
    },
    onError: (err, _req, res) => {
      console.error('Intelligence service proxy error:', err);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Intelligence service unavailable' });
      }
    },
  })
);

// Proxy to Messages Service
router.use(
  '/api/messages',
  createProxyMiddleware({
    target: serviceUrls.messages,
    changeOrigin: true,
    pathRewrite: {
      '^/api/messages': '',
    },
    onProxyReq: (proxyReq, req: any) => {
      forwardCommonHeaders(proxyReq, req);
      writeJsonBody(proxyReq, req);
    },
    onError: (err, _req, res) => {
      console.error('Messages service proxy error:', err);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Messages service unavailable' });
      }
    },
  })
);

// Proxy to Call History endpoints (served by Chats Service)
router.use(
  '/api/calls',
  createProxyMiddleware({
    target: serviceUrls.chats,
    changeOrigin: true,
    pathRewrite: {
      '^/api/calls': '/calls',
    },
    onProxyReq: (proxyReq, req: any) => {
      forwardCommonHeaders(proxyReq, req);
      writeJsonBody(proxyReq, req);
    },
    onError: (err, _req, res) => {
      console.error('Calls service proxy error:', err);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Calls service unavailable' });
      }
    },
  })
);

// Proxy group invite preview/join endpoints to Chats Service
router.use(
  '/api/invites',
  createProxyMiddleware({
    target: serviceUrls.chats,
    changeOrigin: true,
    pathRewrite: {
      '^/api/invites': '/invites',
    },
    onProxyReq: (proxyReq, req: any) => {
      forwardCommonHeaders(proxyReq, req);
      writeJsonBody(proxyReq, req);
    },
    onError: (err, _req, res) => {
      console.error('Invites service proxy error:', err);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Invites service unavailable' });
      }
    },
  })
);

// Proxy to Media Service
router.use(
  '/api/media',
  createProxyMiddleware({
    target: serviceUrls.media,
    changeOrigin: true,
    xfwd: true,
    pathRewrite: {
      '^/api/media': '',
    },
    onProxyReq: (proxyReq, req: any) => {
      forwardCommonHeaders(proxyReq, req);
      writeJsonBody(proxyReq, req);
    },
    onError: (err, _req, res) => {
      console.error('Media service proxy error:', err);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Media service unavailable' });
      }
    },
  })
);

// Proxy to Notifications Service
router.use(
  '/api/notifications',
  createProxyMiddleware({
    target: serviceUrls.notifications,
    changeOrigin: true,
    pathRewrite: {
      '^/api/notifications': '',
    },
    onProxyReq: (proxyReq, req: any) => {
      forwardCommonHeaders(proxyReq, req);
      writeJsonBody(proxyReq, req);
    },
    onError: (err, _req, res) => {
      console.error('Notifications service proxy error:', err);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Notifications service unavailable' });
      }
    },
  })
);

export default router;
