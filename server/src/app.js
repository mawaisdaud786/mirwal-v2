import express from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { env } from './config/env.js'
import { apiRouter } from './routes/index.js'
import { webhookRouter } from './modules/payments/payments.routes.js'
import { requestId } from './middleware/requestId.js'
import { optionalAuth } from './middleware/auth.js'
import { maintenanceMode } from './middleware/maintenance.js'
import { notFoundHandler } from './middleware/notFound.js'
import { errorHandler } from './middleware/errorHandler.js'
import { ok } from './lib/errors.js'

export function createApp() {
  const app = express()

  // Behind cPanel/Passenger or any reverse proxy, trust exactly one hop so rate limiting
  // and IP logging see the real client rather than the proxy.
  app.set('trust proxy', 1)
  app.disable('x-powered-by')

  app.use(helmet({
    // The API serves JSON only; a CSP here would apply to nothing and confuse debugging.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }))

  app.use(cors({
    origin(origin, callback) {
      // Same-origin and server-to-server requests send no Origin header.
      if (!origin || env.corsOrigins.includes(origin)) return callback(null, true)
      return callback(new Error('Origin not allowed by CORS'))
    },
    // Required for the httpOnly refresh cookie to travel cross-origin.
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
  }))

  app.use(requestId)

  // Payment provider callbacks are mounted BEFORE express.json() on purpose: Stripe signs the
  // exact raw bytes of the request body, so a JSON parse here would consume the stream and
  // make signature verification impossible. Each webhook route applies its own body parser.
  //
  // Also deliberately ahead of the rate limiter: a provider retrying a burst of callbacks
  // must not be throttled into failing them, which would leave real payments unsettled.
  app.use(`${env.apiPrefix}/webhooks`, webhookRouter)

  app.use(express.json({ limit: '1mb' }))
  app.use(express.urlencoded({ extended: false, limit: '1mb' }))
  app.use(cookieParser())

  app.use(rateLimit({
    windowMs: env.rateLimit.windowMs,
    limit: env.rateLimit.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again shortly.' },
    },
  }))

  // Populates req.user when a valid token is present; never rejects on its own.
  app.use(optionalAuth)

  app.get('/health', (_req, res) => ok(res, { status: 'ok', uptime: Math.round(process.uptime()) }))

  // After optionalAuth, so a staff session can be recognised and let through; before the
  // routes, so a closed storefront never reaches a controller.
  app.use(maintenanceMode)

  app.use(env.apiPrefix, apiRouter)

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
