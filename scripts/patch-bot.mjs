// Script reproduzível: injeta um estado "Fallback IA" (com memória de conversa) e
// um menu pós-resposta no bot exportado do Blip Builder.
//
// Uso: node scripts/patch-bot.mjs <entrada.json> <saida.json> <url-da-api>
// Ex.: node scripts/patch-bot.mjs "intelbras9 (5).json" intelbras9-ia.json https://omdb-ai-agent.onrender.com

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [, , inputArg, outputArg, apiUrlArg] = process.argv;
if (!inputArg || !outputArg || !apiUrlArg) {
  console.error('Uso: node scripts/patch-bot.mjs <entrada.json> <saida.json> <url-da-api>');
  process.exit(1);
}

const apiUrl = apiUrlArg.replace(/\/+$/, '');
const agentEndpoint = `${apiUrl}/agent`;

const inputPath = resolve(process.cwd(), inputArg);
const outputPath = resolve(process.cwd(), outputArg);

const raw = readFileSync(inputPath, 'utf8');
const bot = JSON.parse(raw);
if (!bot.flow) {
  console.error('Arquivo não parece ser um fluxo Blip válido.');
  process.exit(1);
}

const STATE_IA = 'state-fallback-ia';
const STATE_MENU = 'state-menu-ia';

// ---------------------------------------------------------------------------
// Estado 1/2 — Fallback IA: chama a API /agent enviando histórico de conversa.
// ---------------------------------------------------------------------------
bot.flow[STATE_IA] = {
  $contentActions: [
    {
      action: {
        $id: 'a9100001',
        $typeOfContent: 'chat-state',
        type: 'SendMessage',
        settings: {
          id: 'd9100001',
          type: 'application/vnd.lime.chatstate+json',
          content: { state: 'composing', interval: 1500 },
        },
        $cardContent: {
          document: {
            id: 'd9100001',
            type: 'application/vnd.lime.chatstate+json',
            content: { state: 'composing', interval: 1500 },
          },
          editable: true,
          deletable: true,
          position: 'left',
        },
      },
      $invalid: false,
    },
    {
      action: {
        $id: 'a9100002',
        $typeOfContent: 'text',
        type: 'SendMessage',
        settings: { id: 'd9100002', type: 'text/plain', content: '{{iaReplyTexto}}' },
        $cardContent: {
          document: { id: 'd9100002', type: 'text/plain', content: '{{iaReplyTexto}}' },
          editable: true,
          deletable: true,
          position: 'left',
        },
      },
      $invalid: false,
    },
    {
      input: {
        bypass: true,
        $cardContent: {
          document: { id: 'd9100003', type: 'text/plain', content: 'Entrada do usuário' },
          editable: false,
          deletable: true,
          position: 'right',
        },
        $invalid: false,
      },
      $invalid: false,
    },
  ],
  $conditionOutputs: [],
  $enteringCustomActions: [
    {
      // Monta o body JSON com message + history (últimas trocas).
      $id: 'a9100010',
      $typeOfContent: '',
      $description: '',
      $inputSchema: { type: 'object', properties: {}, required: [] },
      type: 'ExecuteScript',
      $title: 'Preparar Requisição IA',
      $invalid: false,
      settings: {
        function: 'run',
        source:
          "function run(mensagem, historicoJson) {\n" +
          "  var historico = [];\n" +
          "  if (historicoJson) { try { historico = JSON.parse(historicoJson) || []; } catch (e) {} }\n" +
          "  if (!Array.isArray(historico)) historico = [];\n" +
          "  if (historico.length > 12) historico = historico.slice(historico.length - 12);\n" +
          "  var body = { message: String(mensagem || ''), history: historico };\n" +
          "  return JSON.stringify(body);\n" +
          "}",
        inputVariables: ['input.content', 'iaHistorico'],
        outputVariable: 'iaRequestBody',
        LocalTimeZoneEnabled: false,
      },
      conditions: [],
    },
    {
      $id: 'a9100011',
      $typeOfContent: '',
      $description: '',
      $inputSchema: { type: 'object', properties: {}, required: [] },
      type: 'ProcessHttp',
      $title: 'Chamar Agente IA',
      $invalid: false,
      settings: {
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        body: '{{iaRequestBody}}',
        uri: agentEndpoint,
        responseStatusVariable: 'iaStatus',
        responseBodyVariable: 'iaResponseBody',
      },
      conditions: [],
    },
    {
      $id: 'a9100012',
      $typeOfContent: '',
      $description: '',
      $inputSchema: { type: 'object', properties: {}, required: [] },
      type: 'ExecuteScript',
      $title: 'Processar Resposta IA',
      $invalid: false,
      settings: {
        function: 'run',
        source:
          "function run(body, status) {\n" +
          "  var fallback = 'Estou com dificuldades para responder agora. Pode tentar de novo em instantes?';\n" +
          "  if (!body || (status && String(status).charAt(0) !== '2')) return fallback;\n" +
          "  try {\n" +
          "    var data = JSON.parse(body);\n" +
          "    if (data && typeof data.reply === 'string' && data.reply.trim()) return data.reply;\n" +
          "  } catch (e) {}\n" +
          "  return fallback;\n" +
          "}",
        inputVariables: ['iaResponseBody', 'iaStatus'],
        outputVariable: 'iaReplyTexto',
        LocalTimeZoneEnabled: false,
      },
      conditions: [],
    },
    {
      $id: 'a9100013',
      $typeOfContent: '',
      $description: '',
      $inputSchema: { type: 'object', properties: {}, required: [] },
      type: 'ExecuteScript',
      $title: 'Atualizar Histórico',
      $invalid: false,
      settings: {
        function: 'run',
        source:
          "function run(historicoJson, mensagemUsuario, respostaIA) {\n" +
          "  var historico = [];\n" +
          "  if (historicoJson) { try { historico = JSON.parse(historicoJson) || []; } catch(e) {} }\n" +
          "  if (!Array.isArray(historico)) historico = [];\n" +
          "  historico.push({ role: 'user', content: String(mensagemUsuario || '') });\n" +
          "  historico.push({ role: 'assistant', content: String(respostaIA || '') });\n" +
          "  if (historico.length > 12) historico = historico.slice(historico.length - 12);\n" +
          "  return JSON.stringify(historico);\n" +
          "}",
        inputVariables: ['iaHistorico', 'input.content', 'iaReplyTexto'],
        outputVariable: 'iaHistorico',
        LocalTimeZoneEnabled: false,
      },
      conditions: [],
    },
  ],
  $leavingCustomActions: [],
  $inputSuggestions: [],
  $defaultOutput: { stateId: STATE_MENU, $invalid: false },
  $localCustomActions: [],
  isAiGenerated: false,
  $tags: [
    { id: 'blip-tag-ia-http', label: 'ProcessHttp', background: '#7762E3', canChangeBackground: false },
    { id: 'blip-tag-ia-script', label: 'ExecuteScript', background: '#FF961E', canChangeBackground: false },
    { id: 'blip-tag-ia-send', label: 'SendMessage', background: '#EE82EE', canChangeBackground: false },
  ],
  id: STATE_IA,
  root: false,
  $title: 'Fallback IA',
  $position: { top: '270px', left: '1450px' },
  $invalidContentActions: false,
  $invalidOutputs: false,
  $invalidCustomActions: false,
  $invalid: false,
};

// ---------------------------------------------------------------------------
// Estado 2/2 — Menu IA: continuar conversa, ir ao menu guiado ou encerrar.
// ---------------------------------------------------------------------------
const MENU_OPTIONS = [
  { text: 'Continuar com a IA', previewText: 'Continuar com a IA', value: null, index: 0, type: null },
  { text: 'Escolher por gênero', previewText: 'Escolher por gênero', value: null, index: 1, type: null },
  { text: 'Ver séries sugeridas', previewText: 'Ver séries sugeridas', value: null, index: 2, type: null },
  { text: 'Encerrar', previewText: 'Encerrar', value: null, index: 3, type: null },
];

bot.flow[STATE_MENU] = {
  $contentActions: [
    {
      action: {
        $id: 'a9200001',
        $typeOfContent: 'chat-state',
        type: 'SendMessage',
        settings: {
          id: 'd9200001',
          type: 'application/vnd.lime.chatstate+json',
          content: { state: 'composing', interval: 800 },
        },
        $cardContent: {
          document: {
            id: 'd9200001',
            type: 'application/vnd.lime.chatstate+json',
            content: { state: 'composing', interval: 800 },
          },
          editable: true,
          deletable: true,
          position: 'left',
        },
      },
      $invalid: false,
    },
    {
      action: {
        $id: 'a9200002',
        $typeOfContent: 'select-immediate',
        type: 'SendMessage',
        settings: {
          id: 'd9200002',
          type: 'application/vnd.lime.select+json',
          content: {
            text: 'Posso te ajudar com mais alguma coisa? Pode clicar numa opção ou continuar digitando sua pergunta.',
            scope: 'immediate',
            options: MENU_OPTIONS,
            quikReply: false,
          },
        },
        $cardContent: {
          document: {
            id: 'd9200002',
            type: 'application/vnd.lime.select+json',
            content: {
              text: 'Posso te ajudar com mais alguma coisa? Pode clicar numa opção ou continuar digitando sua pergunta.',
              scope: 'immediate',
              options: MENU_OPTIONS,
              quikReply: false,
            },
          },
          editable: true,
          deletable: true,
          position: 'left',
        },
      },
      $invalid: false,
    },
    {
      input: {
        bypass: false,
        $cardContent: {
          document: { id: 'd9200003', type: 'text/plain', content: 'Entrada do usuário' },
          editable: false,
          deletable: true,
          position: 'right',
          editing: false,
        },
        $invalid: false,
      },
      $invalid: false,
    },
  ],
  $conditionOutputs: [
    {
      stateId: 'state-encerrar',
      conditions: [{ source: 'input', comparison: 'matches', values: ['^\\s*(Encerrar|encerrar|sair|tchau|adeus)\\s*[.!]*\\s*$'] }],
      $id: 'c9200001',
      $connId: 'con_menu_sair',
      $invalid: false,
    },
    {
      stateId: 'state-escolha-genero',
      conditions: [{ source: 'input', comparison: 'matches', values: ['^\\s*Escolher\\s+por\\s+gênero\\s*$'] }],
      $id: 'c9200002',
      $connId: 'con_menu_genero',
      $invalid: false,
    },
    {
      stateId: 'state-sugestao-series',
      conditions: [{ source: 'input', comparison: 'matches', values: ['^\\s*Ver\\s+séries\\s+sugeridas\\s*$'] }],
      $id: 'c9200003',
      $connId: 'con_menu_series',
      $invalid: false,
    },
  ],
  $enteringCustomActions: [],
  $leavingCustomActions: [],
  $inputSuggestions: ['Continuar com a IA', 'Escolher por gênero', 'Ver séries sugeridas', 'Encerrar'],
  // qualquer outra coisa (inclusive "Continuar com a IA" e perguntas livres) → IA
  $defaultOutput: { stateId: STATE_IA, $invalid: false },
  $localCustomActions: [],
  isAiGenerated: false,
  $tags: [
    { id: 'blip-tag-menu-ia-send', label: 'SendMessage', background: '#EE82EE', canChangeBackground: false },
    { id: 'blip-tag-menu-ia-user', label: 'UserInput', background: '#000000', canChangeBackground: false },
  ],
  id: STATE_MENU,
  root: false,
  $title: 'Menu IA',
  $position: { top: '520px', left: '1450px' },
  $invalidContentActions: false,
  $invalidOutputs: false,
  $invalidCustomActions: false,
  $invalid: false,
};

// ---------------------------------------------------------------------------
// "Exceções": envia tudo para a IA.
// ---------------------------------------------------------------------------
if (bot.flow.fallback) {
  bot.flow.fallback.$conditionOutputs = [
    {
      stateId: STATE_IA,
      conditions: [{ source: 'input', comparison: 'matches', values: ['.*'] }],
      $id: 'c9000002',
      $connId: 'con_fallback_ia',
      $invalid: false,
    },
  ];
  bot.flow.fallback.$defaultOutput = { stateId: STATE_IA, $invalid: false };
}

// ---------------------------------------------------------------------------
// "NLP Recomendação": só frases simples vão para o fluxo guiado.
// ---------------------------------------------------------------------------
const nlp = bot.flow['state-nlp-recomendacao'];
if (nlp) {
  const REGEX_SAIR =
    '^\\s*(encerrar|sair|tchau|adeus|nao\\s+quero|não\\s+quero)\\s*[.!]*\\s*$';
  const REGEX_AMBOS =
    '^\\s*(gosto\\s+dos\\s+dois|os\\s+dois|ambos|tanto\\s+faz|qualquer(\\s+um)?|indiferente|gosto\\s+de\\s+tudo|pode\\s+ser\\s+qualquer)\\s*[.!]*\\s*$';
  const REGEX_FILME =
    '^\\s*(filme|filmes|movie|cinema|quero\\s+(ver\\s+)?(um\\s+)?filme|prefiro\\s+filme|quero\\s+ver\\s+um\\s+filme|escolher\\s+por\\s+gênero)\\s*[.!]*\\s*$';
  const REGEX_SERIE =
    '^\\s*(serie|série|series|séries|quero\\s+(ver\\s+)?(uma\\s+)?(serie|série)|prefiro\\s+(serie|série)|quero\\s+ver\\s+uma\\s+(serie|série)|ver\\s+séries\\s+sugeridas)\\s*[.!]*\\s*$';

  nlp.$conditionOutputs = [
    {
      stateId: 'state-encerrar',
      conditions: [{ source: 'input', comparison: 'matches', values: [REGEX_SAIR] }],
      $id: 'c9100001',
      $connId: 'con_nlp_sair',
      $invalid: false,
    },
    {
      stateId: 'state-sortear-midia',
      conditions: [{ source: 'input', comparison: 'matches', values: [REGEX_AMBOS] }],
      $id: 'c9100002',
      $connId: 'con_nlp_ambos',
      $invalid: false,
    },
    {
      stateId: 'state-escolha-genero',
      conditions: [{ source: 'input', comparison: 'matches', values: [REGEX_FILME] }],
      $id: 'c9100003',
      $connId: 'con_nlp_filme',
      $invalid: false,
    },
    {
      stateId: 'state-serie-titulo',
      conditions: [{ source: 'input', comparison: 'matches', values: [REGEX_SERIE] }],
      $id: 'c9100004',
      $connId: 'con_nlp_serie',
      $invalid: false,
    },
  ];
  // Default: frases livres → IA
  nlp.$defaultOutput = { stateId: STATE_IA, $invalid: false };
}

// Estados que pedem título: se o usuário escrever algo muito livre, cai na IA.
for (const id of ['state-lista-filmes', 'state-serie-titulo', 'state-sugestao-series']) {
  const st = bot.flow[id];
  if (st) st.$defaultOutput = { stateId: STATE_IA, $invalid: false };
}

writeFileSync(outputPath, JSON.stringify(bot));
console.log(`OK — fluxo atualizado salvo em: ${outputPath}`);
console.log(`Endpoint configurado: ${agentEndpoint}`);
