# IntelPlay: Ferramenta para tratamento de fallback

**[Testar o chatbot ao vivo](https://larissa-arruda-erfpc.chat.blip.ai/?appKey=aW50ZWxicmFzOTpkZTJjZmM5NS05MWY1LTRiNWItYmE0ZS0wYTQ0YTA3M2U0YzU=&_gl=1*14aj4nh*_gcl_au*NzA4NzkwODkwLjE3NzYwMTc4NjI.*_ga*NTI4OTI0NDA2LjE3NzYwMTc4NjI.*_ga_8GVWK8YMGL*czE3NzY4MjAwMDUkbzE2JGcxJHQxNzc2ODIwMDk0JGo0MiRsMCRoNTI2MTIyMTgx)**

Esse projeto é o backend de um chatbot de recomendação de filmes e séries, desenvolvido como parte do Desafio 4 da Intelbras. A ideia é simples: quando o usuário manda uma mensagem no Blip e o NLP não entende o que ele quer, esse é o fallback. O agente usa um LLM (Groq com LLaMA 3.3) pra interpretar a mensagem, buscar dados reais na API do OMDb quando necessário, e responder em português de um jeito natural.

## Como funciona

O fluxo básico é esse:

```
Usuário → Blip → POST /agent → LLM (Groq)
                                   ↓ (se precisar de dados)
                               search_omdb (OMDb API)
                                   ↓
                               resposta em PT-BR → Blip → Usuário
```

O legal é que o agente combina o conhecimento próprio do modelo com dados reais da API. Por exemplo, se você pede "me recomenda uma série na Netflix", ele pensa num título popular, busca os detalhes (nota IMDb, sinopse, elenco) na API e te responde com informações reais, sem inventar nada.

## Pré-requisitos

Você vai precisar de:

- **Node.js 20+**
- **API Key do Groq** (gratuita) → https://console.groq.com/keys
- **API Key do OMDb** (gratuita) → https://www.omdbapi.com/apikey.aspx

## Como rodar localmente

```bash
# Clone o repositório e entre na pasta
git clone https://github.com/larissarruda/blipgroq.git
cd blipgroq

# Instale as dependências
npm install

# Copie o arquivo de exemplo e preencha suas chaves
cp .env.example .env
# Abra o .env e coloque suas chaves em GROQ_API_KEY e OMDB_API_KEY

# Suba o servidor
npm start
```

Para confirmar que está funcionando:

```bash
curl http://localhost:3000/health
```

### Testando o agente

```bash
# Perguntando sobre um filme específico
curl -X POST http://localhost:3000/agent \
  -H "Content-Type: application/json" \
  -d '{"message":"qual a nota do filme Matrix?"}'

# Pedindo uma recomendação
curl -X POST http://localhost:3000/agent \
  -H "Content-Type: application/json" \
  -d '{"message":"me recomenda uma série pra assistir triste"}'
```

### Rodando os testes

```bash
npm test
```

## Deploy no Render

1. Faça push do repositório pro GitHub
2. No [dashboard do Render](https://dashboard.render.com), clique em **New → Blueprint**
3. Selecione o repositório (ele vai ler o `render.yaml` automaticamente)
4. Preencha as variáveis de ambiente `GROQ_API_KEY` e `OMDB_API_KEY`
5. Clique em **Apply** e aguarde ~2 minutos

> O plano gratuito do Render "dorme" após 15 min sem uso. A primeira requisição depois disso pode demorar ~30s. Recomendo usar o [UptimeRobot](https://uptimerobot.com/) pra ficar batendo no `/health` a cada 10 minutos.

## Prompt utilizado

O system prompt completo fica em `src/agent.js` (constante `SYSTEM_PROMPT`). A ideia central por trás dele:

```
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

FORA DE ESCOPO:
- Se o pedido não for sobre filmes/séries/entretenimento audiovisual, explique educadamente
  que você é especializado em cinema/TV e convide o usuário a voltar ao fluxo principal.

ESTILO:
- Tom amigável, direto, sem emojis excessivos (no máximo 1).
- Formate listas com traço (- Título (ano) — nota IMDb X.X: descrição curta).
- Nunca exponha detalhes técnicos (chaves, URLs, JSON cru) ao usuário.
```

## Decisões técnicas

**Por que esse prompt?**

A versão inicial só instruía o modelo a chamar a ferramenta para títulos específicos, e ele ficava perdido em pedidos vagos como "me recomenda algo na Netflix". O problema é que a API do OMDb não sabe quais títulos estão em qual streaming, mas o LLM sabe. Então o ajuste foi ensinar o agente a combinar os dois: usa o próprio conhecimento pra escolher o título, e usa a API pra buscar os dados reais (nota, sinopse, elenco). Isso resolveu o problema de respostas de erros genéricos.

**Loop de iterações com limite (`MAX_TOOL_ITERATIONS = 5`)**

O agente pode encadear várias chamadas à ferramenta numa mesma resposta. Isso foi necessário pra suportar recomendações: o modelo escolhe um título, busca os detalhes, depois pode buscar outro. O limite de 5 iterações existe pra evitar loops infinitos caso o modelo entre num ciclo.

**Validação com Zod nas duas pontas**

As variáveis de ambiente são parseadas e validadas via Zod no startup da aplicação, com falha imediata caso alguma chave obrigatória esteja ausente ou inválida. O body de cada requisição `POST /agent` também passa por um schema Zod antes de chegar no handler, garantindo tipos corretos e limites de tamanho sem depender de validação manual.

**Helmet + rate-limit**

O endpoint é público, então qualquer um pode bater nele. Cada requisição consome créditos da API do Groq, então o rate-limit era essencial.

**Formatação da resposta**

Durante os testes percebi que o modelo às vezes emite chamadas de ferramenta como texto cru (`<function=...>`) em vez de usar o mecanismo correto da API. 

## Estrutura do projeto

```
src/
├── server.js     # inicia o servidor HTTP
├── app.js        # rotas, middlewares de segurança, validação
├── agent.js      # loop de function calling com o Groq
├── omdbTool.js   # definição da tool e chamada à API OMDb
├── config.js     # variáveis de ambiente
└── logger.js     # logs com Pino

test/
├── app.test.js
└── omdbTool.test.js
```
