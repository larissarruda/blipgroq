import { request } from 'undici';
import { z } from 'zod';
import { config } from './config.js';
import { logger } from './logger.js';

const OMDB_BASE_URL = 'https://www.omdbapi.com/';
const OMDB_TIMEOUT_MS = 8_000;

/**
 * Schema de entrada da tool. Exposto para o LLM via JSON Schema.
 */
export const omdbInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    imdb_id: z
      .string()
      .trim()
      .regex(/^tt\d{6,10}$/i, 'IMDb ID inválido (formato esperado: tt1234567)')
      .optional(),
    year: z.coerce
      .number()
      .int()
      .min(1888)
      .max(new Date().getFullYear() + 5)
      .optional(),
    type: z.enum(['movie', 'series', 'episode']).optional(),
    plot: z.enum(['short', 'full']).default('short'),
  })
  .refine((d) => d.title || d.imdb_id, {
    message: 'Informe ao menos "title" ou "imdb_id".',
  });

/**
 * Definição da tool no formato esperado pelo Groq function calling.
 */
export const omdbToolDefinition = {
  type: 'function',
  function: {
    name: 'search_omdb',
    description:
      'Busca informações sobre filmes, séries ou episódios na API OMDb (IMDb). ' +
      'Use esta função sempre que o usuário perguntar sobre um filme, série, elenco, ano, nota, sinopse, diretor, etc. ' +
      'Não invente dados — se faltar informação, chame esta função.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Título do filme ou série (ex: "The Matrix", "Breaking Bad").',
        },
        imdb_id: {
          type: 'string',
          description: 'ID do IMDb no formato tt1234567, caso já seja conhecido.',
        },
        year: {
          type: 'integer',
          description: 'Ano de lançamento para refinar a busca (ex: 1999).',
        },
        type: {
          type: 'string',
          enum: ['movie', 'series', 'episode'],
          description: 'Tipo do título. Use "movie" para filmes e "series" para séries.',
        },
        plot: {
          type: 'string',
          enum: ['short', 'full'],
          description: 'Tamanho da sinopse retornada. Padrão: short.',
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
};

/**
 * Executa a tool contra a API OMDb.
 * Retorna sempre um objeto serializável para ser enviado ao LLM.
 */
export async function runOmdbTool(rawArgs) {
  const parsed = omdbInputSchema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_arguments',
      details: parsed.error.flatten().fieldErrors,
    };
  }
  const args = parsed.data;

  const url = new URL(OMDB_BASE_URL);
  url.searchParams.set('apikey', config.OMDB_API_KEY);
  if (args.imdb_id) url.searchParams.set('i', args.imdb_id);
  if (args.title) url.searchParams.set('t', args.title);
  if (args.year) url.searchParams.set('y', String(args.year));
  if (args.type) url.searchParams.set('type', args.type);
  url.searchParams.set('plot', args.plot);
  url.searchParams.set('r', 'json');

  const safeLogUrl = url.toString().replace(config.OMDB_API_KEY, '[REDACTED]');
  logger.debug({ url: safeLogUrl }, 'Chamando OMDb');

  try {
    const { statusCode, body } = await request(url, {
      method: 'GET',
      headersTimeout: OMDB_TIMEOUT_MS,
      bodyTimeout: OMDB_TIMEOUT_MS,
    });

    if (statusCode < 200 || statusCode >= 300) {
      return { ok: false, error: 'omdb_http_error', status: statusCode };
    }

    const data = await body.json();

    if (data.Response === 'False') {
      return { ok: false, error: 'not_found', message: data.Error ?? 'Título não encontrado.' };
    }

    // Normaliza chaves para snake_case/camelCase amigáveis ao modelo
    return {
      ok: true,
      result: {
        title: data.Title,
        year: data.Year,
        rated: data.Rated,
        released: data.Released,
        runtime: data.Runtime,
        genre: data.Genre,
        director: data.Director,
        writer: data.Writer,
        actors: data.Actors,
        plot: data.Plot,
        language: data.Language,
        country: data.Country,
        awards: data.Awards,
        poster: data.Poster,
        imdb_rating: data.imdbRating,
        imdb_votes: data.imdbVotes,
        imdb_id: data.imdbID,
        type: data.Type,
        total_seasons: data.totalSeasons,
      },
    };
  } catch (err) {
    logger.error({ err: err.message }, 'Falha ao chamar OMDb');
    return { ok: false, error: 'network_error', message: err.message };
  }
}
