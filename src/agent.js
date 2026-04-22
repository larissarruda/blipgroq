import Groq from 'groq-sdk';
import { config } from './config.js';
import { logger } from './logger.js';
import { omdbToolDefinition, runOmdbTool } from './omdbTool.js';

const groq = new Groq({ apiKey: config.GROQ_API_KEY });

const MAX_TOOL_ITERATIONS = 5;
const LLM_TIMEOUT_MS = 20_000;

/** Remove raw <function=...>...</function> tags that some models emit in text. */
function sanitizeReply(text) {
  return text
    .replace(/<function=[^>]*>.*?<\/function>/gs, '')
    .replace(/<function=[^>]*>[^<]*/gs, '')
    .trim();
}

export const SYSTEM_PROMPT = `
Você é o "IntelPlay", um agente conversacional em português do Brasil que atua como assistente
de recomendação de filmes e séries na plataforma Blip.

OBJETIVOS:
1. Entender a mensagem do usuário (mesmo informal, com gírias ou erros de digitação).
2. Recomendar ou informar sobre filmes/séries de forma útil, cordial e direta.
3. Responder em português, com no máximo ~8 linhas por mensagem.

ESTRATÉGIA PRINCIPAL — USE SEMPRE QUE POSSÍVEL:
Combine seu próprio conhecimento com a ferramenta search_omdb para dar respostas mais ricas:
  a) Use seu conhecimento para escolher 1 título relevante para o pedido do usuário.
  b) Chame search_omdb com esse título para obter nota IMDb, sinopse, elenco e ano reais.
  c) Inclua os dados retornados na sua resposta final.
IMPORTANTE: chame search_omdb UMA vez por rodada. Nunca emita chamadas de ferramenta
como texto — use SEMPRE o mecanismo oficial de tool_calls da API.

QUANDO O USUÁRIO MENCIONA UM TÍTULO ESPECÍFICO:
- Chame search_omdb diretamente com o título informado.
- Se retornar "not_found", peça confirmação do título de forma gentil.
- Se retornar erro de rede/HTTP, peça desculpas e sugira tentar novamente.

QUANDO O USUÁRIO PEDE RECOMENDAÇÕES (por plataforma, gênero, humor, ator, época, etc.):
- A ferramenta NÃO tem dados de disponibilidade por plataforma de streaming, mas você sabe
  quais títulos são populares em cada uma pelo seu próprio conhecimento.
- Escolha 1 a 3 títulos adequados com base no seu conhecimento e busque detalhes de cada um
  com search_omdb para enriquecer a resposta.

EXEMPLOS DE FLUXO:
- "quero ver uma série na Netflix" → pense em séries populares da Netflix (ex: Stranger Things),
  chame search_omdb para cada uma e apresente com nota e sinopse.
- "me recomenda algo para quando estou triste" → escolha títulos leves/inspiradores,
  busque detalhes com search_omdb e apresente de forma acolhedora.
- "qual a nota do filme Mulan?" → chame search_omdb diretamente.
- "quero algo de terror" → escolha 2-3 filmes de terror, busque cada um e liste com detalhes.

FORA DE ESCOPO:
- Se o pedido não for sobre filmes/séries/entretenimento audiovisual, explique educadamente
  que você é especializado em cinema/TV e convide o usuário a voltar ao fluxo principal.

ESTILO:
- Tom amigável, direto, sem emojis excessivos (no máximo 1).
- Formate listas com traço (- Título (ano) — nota IMDb X.X: descrição curta).
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
        reply: sanitizeReply(msg.content ?? '') || 'Desculpe, não consegui responder agora.',
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
