# 🎬 OMDb AI Agent — Desafio 4 (Intelbras)

Agente de **IA Generativa com Function Calling** que atua como *fallback inteligente* de um chatbot Blip:
quando o NLP principal não entende a intenção do usuário, o Blip faz uma chamada HTTP para este
serviço, que usa um LLM (**Groq + LLaMA 3.3**) para interpretar a mensagem, decidir se precisa
consultar a **API OMDb** (via *tool call*) e responder em linguagem natural.

---

## ✨ Arquitetura

```
Usuário ──► Blip (fluxo NLP) ──► (fallback) ──► POST /agent ──► Groq LLM
                                                                  │
                                                   tool_call ◄────┤
                                                        │
                                                        ▼
                                                    OMDb API
                                                        │
                                                   resultado ────► LLM ──► resposta PT-BR
```

- **Stack:** Node.js 20 + Express + Groq SDK + OMDb
- **Segurança:** Helmet, CORS, rate-limit, validação Zod, Bearer token opcional, logs com redaction
- **Testes:** `node --test` (sem dependências externas)
- **Deploy:** Render (`render.yaml`) ou Docker

---

## 📁 Estrutura

```
omdb-ai-agent/
├── src/
│   ├── server.js        # Bootstrap HTTP + graceful shutdown
│   ├── app.js           # Express app (segurança, rotas, validação)
│   ├── agent.js         # Loop de function-calling com Groq
│   ├── omdbTool.js      # Definição da tool + cliente OMDb
│   ├── config.js        # Variáveis de ambiente (validadas com Zod)
│   └── logger.js        # Pino logger (com redaction de segredos)
├── test/
│   ├── app.test.js
│   └── omdbTool.test.js
├── .env.example
├── Dockerfile
├── render.yaml
└── package.json
```

---

## 🔑 Pré-requisitos

1. **Node.js 20+** → https://nodejs.org
2. **Conta no Groq (grátis)** → https://console.groq.com/keys (gere uma API Key)
3. **Conta no OMDb (grátis)** → https://www.omdbapi.com/apikey.aspx (confirme o e-mail)
4. **Conta no GitHub** (para publicar) e **Render** (para hospedar) — ambas grátis

---

## 🚀 Como rodar localmente (passo a passo)

```bash
# 1. Clone / entre na pasta
cd omdb-ai-agent

# 2. Instale dependências
npm install

# 3. Configure variáveis de ambiente
cp .env.example .env
# edite .env e preencha GROQ_API_KEY e OMDB_API_KEY

# 4. Rode em modo dev (auto-reload)
npm run dev
# ou em produção
npm start

# 5. Teste o health
curl http://localhost:3000/health
```

### Testando o endpoint do agente

```bash
curl -X POST http://localhost:3000/agent \
  -H "Content-Type: application/json" \
  -d '{"message":"me fala da sinopse do filme Matrix de 1999"}'
```

Resposta esperada (exemplo):

```json
{
  "reply": "🎬 The Matrix (1999) — Dirigido pelas Wachowskis...",
  "toolCalls": [
    { "name": "search_omdb", "arguments": { "title": "The Matrix", "year": 1999 }, "result": { "ok": true, "..." } }
  ],
  "usage": { "total_tokens": 612 }
}
```

### Exemplo fora de escopo

```bash
curl -X POST http://localhost:3000/agent -H "Content-Type: application/json" \
  -d '{"message":"qual a capital da França?"}'
# → "Eu sou especializado em filmes e séries 🎥. Posso te sugerir algum título?"
```

---

## 🧪 Testes automatizados (auditoria)

```bash
npm test
```

Cobertura: validação de schemas da tool, respostas HTTP do servidor, middlewares de segurança,
rotas 404 e tratamento de body inválido.

---

## ☁️ Deploy no Render (recomendado)

### Opção A — via `render.yaml` (Blueprint — 1 clique)

1. Faça push deste repositório para o GitHub.
2. Em https://dashboard.render.com, clique em **New → Blueprint** e selecione o repo.
3. O Render lerá `render.yaml` e pedirá para preencher os segredos:
   - `GROQ_API_KEY`
   - `OMDB_API_KEY`
   - `AGENT_AUTH_TOKEN` *(opcional, mas recomendado)*
4. Clique em **Apply**. Em ~2 min o serviço sobe em `https://<nome>.onrender.com`.

### Opção B — manual

1. **New → Web Service** → conecte o repo.
2. Runtime: **Node** | Build: `npm ci --omit=dev` | Start: `node src/server.js`
3. Em **Environment**, adicione `GROQ_API_KEY` e `OMDB_API_KEY`.
4. Health Check Path: `/health`.

> 💡 O **plano Free do Render dorme após 15 min de inatividade**. A 1ª requisição depois disso
> demora ~30 s. Se o Blip reclamar de timeout, configure um pinger (ex.: UptimeRobot) batendo
> em `/health` a cada 10 min.

---

## 🤝 Integração com o Blip (fluxo do Desafio 1)

No fluxo do Blip, adicione um bloco **“Requisição HTTP”** no caminho *fallback do NLP*:

- **Método:** `POST`
- **URL:** `https://<seu-app>.onrender.com/agent`
- **Headers:**
  - `Content-Type: application/json`
  - `Authorization: Bearer {{AGENT_AUTH_TOKEN}}` *(se você definiu o token)*
- **Body:**
  ```json
  {
    "message": "{{input.content}}"
  }
  ```
- **Variável de saída:** `agentReply` ← `body.reply`

Depois, crie um bloco de mensagem que envie `{{agentReply}}` ao usuário e volte para o menu principal.

---

## 🧠 Prompt utilizado

O *system prompt* fica em [src/agent.js](src/agent.js) na constante `SYSTEM_PROMPT`. Resumo:

- Persona: **Cine-Assistente**, fallback do chatbot Blip.
- Sempre em **PT-BR**, tom cordial, curto (até ~6 linhas).
- **Proibido inventar dados** factuais — deve chamar a tool `search_omdb`.
- **Escopo:** filmes e séries. Fora disso, responde educadamente e convida o usuário a voltar.
- Regras específicas de uso de parâmetros (`type`, `year`, `plot`).

## 🛠️ Definição da Tool (function calling)

A tool `search_omdb` é descrita em [src/omdbTool.js](src/omdbTool.js) no formato OpenAI/Groq:

| Parâmetro  | Tipo       | Descrição |
|------------|------------|-----------|
| `title`    | string     | Título do filme/série |
| `imdb_id`  | string     | ID IMDb (tt#######) |
| `year`     | integer    | Ano de lançamento |
| `type`     | enum       | `movie` / `series` / `episode` |
| `plot`     | enum       | `short` / `full` (padrão: short) |

O LLM decide autonomamente quando e com quais parâmetros chamar. O retorno da tool é JSON
normalizado (snake_case) para facilitar o entendimento do modelo.

---

## 🔒 Decisões técnicas

| Decisão | Justificativa |
|---|---|
| **Groq + LLaMA 3.3 70B** | Free tier generoso, baixa latência, suporte nativo a function calling |
| **Zod** para validação | Falha cedo e de forma explícita (entradas do usuário e env vars) |
| **Helmet + rate-limit + CORS** | Proteção OWASP básica (injection, DoS, CSRF) |
| **Bearer token opcional** | Evita abuso do endpoint público por terceiros |
| **Loop com `MAX_TOOL_ITERATIONS=3`** | Previne loops infinitos de tool-calls |
| **Timeouts em LLM e OMDb** | Garante que o Blip não fique pendurado |
| **Logs com redaction** | Nunca vaza `GROQ_API_KEY` / `OMDB_API_KEY` em logs |
| **`node --test`** | Zero dependências de teste, roda em qualquer Node 20+ |
| **ESM + `type: "module"`** | Código moderno, top-level await nos testes |

---

## 🐳 Rodar com Docker (opcional)

```bash
docker build -t omdb-ai-agent .
docker run --rm -p 3000:3000 --env-file .env omdb-ai-agent
```

---

## 📋 Checklist dos critérios de avaliação

- [x] **Prompt engineering** — persona, escopo, tom e regras explícitas
- [x] **Tool schema correto** — parâmetros, descrição, tipos e enum
- [x] **Decisão autônoma** — `tool_choice: auto` + system prompt orientativo
- [x] **Fora de escopo** — tratamento explícito no prompt + exemplo testado
- [x] **Código organizado** — separação de responsabilidades (config, logger, tool, agent, app)
- [x] **Deploy público** — `render.yaml` + Dockerfile
- [x] **README reprodutível** — passo a passo completo

---

## 📝 Licença

MIT — sinta-se à vontade para usar como base.
