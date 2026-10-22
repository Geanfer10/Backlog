# Atualização por evento (Monday → painel)

O painel **não consulta o Monday de tempos em tempos**. O Monday avisa (webhook) quando algo muda no board;
só então a API busca os dados novamente.

- `api/webhook.js` recebe o aviso do Monday e só anota "mudou" no Redis.
- `api/data.js` guarda uma cópia dos dados no Redis e só vai ao Monday se: não há cópia, houve aviso, ou a cópia
  tem mais de 30 min (links de foto do Monday expiram em 1 h). Erro/limite do Monday → serve a cópia antiga e espera.
- O painel pergunta à API a cada 20 s (só lê o Redis, não gasta chamadas do Monday).

## Configuração na Vercel
1. Storage → criar **Upstash Redis** e conectar ao projeto (cria `KV_REST_API_URL` e `KV_REST_API_TOKEN`).
2. Environment Variables → `WEBHOOK_SECRET` = texto aleatório longo (não colocar no GitHub).
3. Redeploy.
4. Criar os webhooks no board apontando para `https://SEU-SITE.vercel.app/api/webhook?key=<WEBHOOK_SECRET>`.

Sem Redis configurado, a API funciona em "modo simples" (cache de 2 min na CDN).
