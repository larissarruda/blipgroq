import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { z } from 'zod';
import { config } from './config.js';
import { logger } from './logger.js';
import { askAgent } from './agent.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Render/Proxies

  app.use(helmet());
  app.use(express.json({ limit: '16kb' }));
  app.use(pinoHttp({ logger }));

  const origins =
    config.CORS_ORIGINS === '*'
      ? true
      : config.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  app.use(cors({ origin: origins, methods: ['GET', 'POST'], maxAge: 86400 }));

  const limiter = rateLimit({
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    max: config.RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'rate_limited', message: 'Muitas requisições, tente novamente em instantes.' },
  });

  // Auth opcional via Bearer token
  function requireAuth(req, res, next) {
    if (!config.AGENT_AUTH_TOKEN) return next();
    const header = req.get('authorization') ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || token !== config.AGENT_AUTH_TOKEN) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    return next();
  }

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', model: config.GROQ_MODEL, uptime: process.uptime() });
  });

  const bodySchema = z.object({
    message: z.string().trim().min(1, 'message é obrigatório').max(2000),
    history: z
      .array(
        z.object({
          role: z.enum(['user', 'assistant']),
          content: z.string().max(4000),
        }),
      )
      .max(20)
      .optional(),
  });

  app.post('/agent', limiter, requireAuth, async (req, res) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'invalid_body',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    try {
      const { reply, toolCalls, usage } = await askAgent(parsed.data.message, parsed.data.history);
      return res.json({ reply, toolCalls, usage });
    } catch (err) {
      req.log.error({ err: err.message }, 'Falha no agente');
      return res.status(502).json({
        error: 'agent_failure',
        reply:
          'Desculpe, tive um problema para consultar minha fonte de dados. Pode tentar novamente em instantes?',
      });
    }
  });

  // 404 + error handler
  app.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    logger.error({ err: err.message }, 'Erro não tratado');
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
