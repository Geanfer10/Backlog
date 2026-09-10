# Backlog (Manutenção) no Vercel

Arquivos para adicionar/substituir no seu repositório **Geanfer10/Backlog**:

- `index.html` (substitui o atual — agora busca os dados via `/api/data`, ao vivo)
- `api/data.js` (função serverless nova — busca o board de Manutenção no Monday)

Este `index.html` foi reconstruído com o mesmo padrão visual do original
(tema escuro, contadores por grupo, filtros de Status/Prioridade/Departamento/
Tipo de Manutenção, fotos nos cards) — se algum detalhe visual ficar diferente
do seu painel atual, me avise que eu ajusto.

Os arquivos antigos usados pelo GitHub Action (se você tiver algo parecido
nesse repositório) podem ser removidos depois que confirmar que o painel no
Vercel está funcionando — eles deixam de ser necessários.

## Passo a passo

1. No repositório `Backlog`, suba/substitua os arquivos `index.html` e
   `api/data.js` (mantendo a pasta `api/`).
2. Acesse [vercel.com](https://vercel.com), faça login com sua conta do GitHub.
3. Clique em **"Add New" → "Project"** e selecione o repositório `Backlog`.
4. Em "Framework Preset", deixe **"Other"**. Clique em **Deploy**.
5. Vá em **Settings → Environment Variables** e crie:
   - Name: `MONDAY_API_TOKEN`
   - Value: seu token de API do Monday
   - Marque Production, Preview e Development
6. Salve, volte em **Deployments**, clique nos "..." do último deploy e escolha
   **Redeploy** (necessário para a variável entrar em vigor).
7. O Vercel vai te dar uma URL, algo como `https://backlog-manutencao.vercel.app` —
   esse já é o painel completo, atualizado em tempo real a cada acesso.
