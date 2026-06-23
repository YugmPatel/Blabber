import { Router } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { serviceUrls } from '../config.js';

const router: Router = Router();

function hasJsonBody(req: any) {
  return req.body && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
}

function writeJsonBody(proxyReq: any, req: any) {
  if (!hasJsonBody(req)) return;
  const bodyData = JSON.stringify(req.body);
  proxyReq.setHeader('Content-Type', 'application/json');
  proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
  proxyReq.write(bodyData);
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
      // Forward cookies
      if (req.headers.cookie) {
        proxyReq.setHeader('Cookie', req.headers.cookie);
      }
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
      // Forward Authorization header
      if (req.headers.authorization) {
        proxyReq.setHeader('Authorization', req.headers.authorization);
      }
      // Forward cookies
      if (req.headers.cookie) {
        proxyReq.setHeader('Cookie', req.headers.cookie);
      }
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
      if (req.headers.authorization) {
        proxyReq.setHeader('Authorization', req.headers.authorization);
      }
      if (req.headers.cookie) {
        proxyReq.setHeader('Cookie', req.headers.cookie);
      }
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
      // Forward Authorization header
      if (req.headers.authorization) {
        proxyReq.setHeader('Authorization', req.headers.authorization);
      }
      // Forward cookies
      if (req.headers.cookie) {
        proxyReq.setHeader('Cookie', req.headers.cookie);
      }
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
      if (req.headers.authorization) {
        proxyReq.setHeader('Authorization', req.headers.authorization);
      }
      if (req.headers.cookie) {
        proxyReq.setHeader('Cookie', req.headers.cookie);
      }
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
      if (req.headers.authorization) {
        proxyReq.setHeader('Authorization', req.headers.authorization);
      }
      if (req.headers.cookie) {
        proxyReq.setHeader('Cookie', req.headers.cookie);
      }
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
