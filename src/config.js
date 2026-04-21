import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  GROQ_API_KEY: z.string().min(10, 'GROQ_API_KEY é obrigatória'),
  OMDB_API_KEY: z.string().min(3, 'OMDB_API_KEY é obrigatória'),
  GROQ_MODEL: z.string().default('llama-3.3-70b-versatile'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  CORS_ORIGINS: z.string().default('*'),
  AGENT_AUTH_TOKEN: z.string().optional().default(''),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Configuração inválida:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = Object.freeze(parsed.data);
