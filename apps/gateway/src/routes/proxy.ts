import { Router } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { serviceUrls } from '../config.js';

const router = Router();

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
      // Forward cookies
      if (req.headers.cookie) {
        proxyReq.setHeader('Cookie', req.headers.cookie);
      }
      // Forward request body for POST/PUT/PATCH
      if (req.body && (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH')) {
        const bodyData = JSON.stringify(req.body);
        proxyReq.setHeader('Content-Type', 'application/json');
        proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
        proxyReq.write(bodyData);
      }
    },
    onProxyRes: (proxyRes, req, res) => {
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
    onError: (err, req, res) => {
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
      // Forward Authorization header
      if (req.headers.authorization) {
        proxyReq.setHeader('Authorization', req.headers.authorization);
      }
      // Forward cookies
      if (req.headers.cookie) {
        proxyReq.setHeader('Cookie', req.headers.cookie);
      }
      // Forward request body for POST/PUT/PATCH
      if (req.body && (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH')) {
        const bodyData = JSON.stringify(req.body);
        proxyReq.setHeader('Content-Type', 'application/json');
        proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
        proxyReq.write(bodyData);
      }
    },
    onError: (err, req, res) => {
      console.error('Users service proxy error:', err);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Users service unavailable' });
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
      // Forward Authorization header
      if (req.headers.authorization) {
        proxyReq.setHeader('Authorization', req.headers.authorization);
      }
      // Forward cookies
      if (req.headers.cookie) {
        proxyReq.setHeader('Cookie', req.headers.cookie);
      }
      // Forward request body for POST/PUT/PATCH
      if (req.body && (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH')) {
        const bodyData = JSON.stringify(req.body);
        proxyReq.setHeader('Content-Type', 'application/json');
        proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
        proxyReq.write(bodyData);
      }
    },
    onError: (err, req, res) => {
      console.error('Chats service proxy error:', err);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Chats service unavailable' });
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
      // Forward Authorization header
      if (req.headers.authorization) {
        proxyReq.setHeader('Authorization', req.headers.authorization);
      }
      // Forward cookies
      if (req.headers.cookie) {
        proxyReq.setHeader('Cookie', req.headers.cookie);
      }
      // Forward request body for POST/PUT/PATCH
      if (req.body && (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH')) {
        const bodyData = JSON.stringify(req.body);
        proxyReq.setHeader('Content-Type', 'application/json');
        proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
        proxyReq.write(bodyData);
      }
    },
    onError: (err, req, res) => {
      console.error('Messages service proxy error:', err);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Messages service unavailable' });
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
    pathRewrite: {
      '^/api/media': '',
    },
    onProxyReq: (proxyReq, req: any) => {
      if (req.body && (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH')) {
        const bodyData = JSON.stringify(req.body);
        proxyReq.setHeader('Content-Type', 'application/json');
        proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
        proxyReq.write(bodyData);
      }
    },
    onError: (err, req, res) => {
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
      if (req.body && (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH')) {
        const bodyData = JSON.stringify(req.body);
        proxyReq.setHeader('Content-Type', 'application/json');
        proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
        proxyReq.write(bodyData);
      }
    },
    onError: (err, req, res) => {
      console.error('Notifications service proxy error:', err);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Notifications service unavailable' });
      }
    },
  })
);

export default router;
