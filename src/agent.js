import Groq from 'groq-sdk';
import { config } from './config.js';
import { logger } from './logger.js';
import { omdbToolDefinition, runOmdbTool } from './omdbTool.js';

const groq = new Groq({ apiKey: config.GROQ_API_KEY });

const MAX_TOOL_ITERATIONS = 3;
const LLM_TIMEOUT_MS = 20_000;

export const SYSTEM_PROMPT = `
Você é o "IntelPlay", um agente conversacional em português do Brasil que atua como fallback
de um chatbot de recomendação de filmes e séries na plataforma Blip.

OBJETIVOS:
1. Entender a mensagem do usuário (mesmo informal, com gírias ou erros de digitação).
2. Decidir se precisa consultar a ferramenta "search_omdb" para obter dados factuais
   sobre filmes/séries. NUNCA invente dados (sinopse, elenco, nota, ano, diretor etc.).
3. Responder de forma curta, cordial e útil, em português, com no máximo ~6 linhas.
4. Ajudar o usuário a encontrar a série que mais se encaixa nas necessidades dele (por streaming, genero, ano de lançamento, ator, diretor, emoção/sentimento, etc.).

REGRAS DE USO DA FERRAMENTA search_omdb:
- Use sempre que o usuário citar um título específico, pedir sinopse, elenco, nota,
  ano, diretor, duração, gênero, temporadas, etc.
- Prefira preencher "type" ("movie" ou "series") quando o usuário deixar claro.
- Se o usuário citar o ano, inclua "year".
- Se a ferramenta retornar "not_found", peça confirmação do título ao usuário de forma gentil.
- Se a ferramenta retornar erro de rede/HTTP, peça desculpas e sugira tentar novamente.

FORA DE ESCOPO:
- Se o pedido não for sobre filmes/séries/entretenimento audiovisual, explique educadamente
  que você é especializado em cinema/TV e convide o usuário a voltar ao fluxo principal
  do chatbot (ex.: "posso te ajudar a encontrar um filme ou série?").

ESTILO:
- Tom amigável, direto, sem emojis excessivos (no máximo 1).
- Formate dados em listas curtas quando fizer sentido (ex.: "🎬 Título: ... | Ano: ... | Nota IMDb: ...").
- Nunca exponha detalhes técnicos (chaves, URLs, JSON cru) ao usuário.
`.trim();

const toolRegistry = {
  search_omdb: runOmdbTool,
};

/**
 * Executa uma conversa com o LLM, resolvendo tool-calls até obter uma resposta final.
 * @param {string} userMessage
 * @param {Array<{role:string,content:string}>} [history]
 * @returns {Promise<{reply:string, toolCalls:Array, usage:object|undefined}>}
 */
export async function askAgent(userMessage, history = []) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.filter((m) => m && typeof m.content === 'string').slice(-10),
    { role: 'user', content: userMessage },
  ];

  const toolCallsTrace = [];
  let lastUsage;

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i += 1) {
    const completion = await groq.chat.completions.create(
      {
        model: config.GROQ_MODEL,
        messages,
        tools: [omdbToolDefinition],
        tool_choice: 'auto',
        temperature: 0.3,
        max_tokens: 600,
      },
      { timeout: LLM_TIMEOUT_MS },
    );

    lastUsage = completion.usage;
    const choice = completion.choices?.[0];
    if (!choice) throw new Error('Resposta vazia do LLM');

    const msg = choice.message;
    messages.push(msg);

    const toolCalls = msg.tool_calls ?? [];
    if (toolCalls.length === 0) {
      return {
        reply: (msg.content ?? '').trim() || 'Desculpe, não consegui responder agora.',
        toolCalls: toolCallsTrace,
        usage: lastUsage,
      };
    }

    // Executa cada tool-call solicitada
    for (const call of toolCalls) {
      const fnName = call.function?.name;
      const handler = toolRegistry[fnName];
      let parsedArgs = {};
      try {
        parsedArgs = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        parsedArgs = {};
      }

      let result;
      if (!handler) {
        result = { ok: false, error: 'unknown_tool', name: fnName };
      } else {
        result = await handler(parsedArgs);
      }

      toolCallsTrace.push({ name: fnName, arguments: parsedArgs, result });
      logger.info({ tool: fnName, ok: result.ok }, 'tool executada');

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        name: fnName,
        content: JSON.stringify(result),
      });
    }
  }

  // Falha de segurança: excedeu iterações
  return {
    reply:
      'Tive dificuldades para montar a resposta agora. Pode reformular sua pergunta sobre o filme ou série?',
    toolCalls: toolCallsTrace,
    usage: lastUsage,
  };
}
