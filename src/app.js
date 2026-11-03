
import express from 'express';
import { config } from './config.js';
import { HttpError } from './util.js';
import { authenticate, requireRole } from './auth.js';
import { authRouter } from './routes/auth.js';
import { candidateRouter } from './routes/candidate.js';
import { adminRouter } from './routes/admin.js';

function securityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');

  // Allow Google Firebase authentication popup communication.
  res.setHeader(
    'Cross-Origin-Opener-Policy',
    'same-origin-allow-popups'
  );

  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' https://www.gstatic.com https://apis.google.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https://*.googleusercontent.com",
      "connect-src 'self' https://www.google.com https://www.gstatic.com https://apis.google.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com",
      "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'self'",
    ].join('; ')
  );

  next();
}

// Cookies are SameSite=Strict; this header check is a second,
// independent CSRF barrier.
function writeGuard(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  if (req.headers['x-requested-with'] !== 'pariksha') {
    return next(
      new HttpError(403, 'csrf', 'Request blocked.')
    );
  }

  next();
}

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(securityHeaders);
  app.use(express.json({ limit: '2mb' }));

  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use('/api', writeGuard);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, time: Date.now() });
  });

  app.use('/api/auth', authRouter);

  app.use(
    '/api/admin',
    authenticate,
    requireRole('admin'),
    adminRouter
  );

  app.use(
    '/api',
    authenticate,
    requireRole('candidate'),
    candidateRouter
  );

  app.use('/api', (_req, _res, next) => {
    next(new HttpError(404, 'not_found', 'Not found.'));
  });

  app.use(
    express.static(config.publicDir, {
      etag: true,
      maxAge: 0,
    })
  );

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({
        error: 'bad_json',
        message: 'The request body is not valid JSON.',
      });
    }

    if (err?.type === 'entity.too.large') {
      return res.status(413).json({
        error: 'too_large',
        message: 'The request is too large.',
      });
    }

    const status = err instanceof HttpError ? err.status : 500;

    if (status === 500) {
      console.error(err);
    }

    res.status(status).json({
      error: err.code || 'server_error',
      message:
        status === 500
          ? 'Something went wrong on our side. Try again.'
          : err.message,
      ...(err.extra || {}),
    });
  });

  return app;
}
