# Painel de Backlog de Manutenção

Painel HTML com filtros interativos (Status, Prioridade, Departamento, Tipo de
Manutenção) e fotos das atividades, alimentado pelo board **"Backlog de
Atividades - Manutenção"** do Monday.com (id `18430494778`).

## Como funciona

- `index.html` — o painel em si. Lê `data.json` e renderiza os cards.
- `data.json` — gerado automaticamente pelo workflow abaixo. Não editar à mão.
- `scripts/fetch-data.mjs` — script Node que busca os itens do board na API
  do Monday, resolve as fotos anexadas na coluna **Fotos** em URLs, e grava
  `data.json`.
- `.github/workflows/update-data.yml` — roda o script a cada 15 minutos e
  faz commit do `data.json` atualizado.

## Setup (mesmo padrão do repositório "Gerador")

1. Crie um repositório novo no GitHub (ex: `Backlog-Manutencao`) e suba estes
   arquivos (drag-and-drop ou editor do navegador).
2. Em **Settings → Secrets and variables → Actions**, crie o secret
   `MONDAY_API_TOKEN` com seu token de API do Monday.com (Perfil → Admin →
   API, ou Perfil → Developers).
3. Em **Settings → Pages**, publique a partir da branch `main`, pasta raiz.
4. Em **Actions**, rode o workflow "Atualizar dados do backlog" manualmente
   uma vez (`workflow_dispatch`) para gerar o primeiro `data.json` — depois
   disso ele roda sozinho a cada 15 min.
5. O painel fica em `https://<seu-usuario>.github.io/<repo>/`.

## Adicionando fotos

Basta anexar a foto na coluna **Fotos** do item, no Monday.com. Na próxima
execução da automação (até 15 min depois), ela aparece no card do painel.
Se quiser forçar a atualização na hora, rode o workflow manualmente em
**Actions → Atualizar dados do backlog → Run workflow**.

## Observações técnicas

- As URLs de fotos vêm do campo `public_url` da API `assets` do Monday, que
  pode expirar depois de um tempo — por isso a automação roda a cada 15 min,
  renovando as URLs.
- Os IDs de coluna usados no script (`color_mm7265sy`, `text_mm729y26` etc.)
  são fixos para este board. Se colunas forem adicionadas/removidas no
  Monday, atualize a lista `COLUMN_IDS` em `scripts/fetch-data.mjs`.
