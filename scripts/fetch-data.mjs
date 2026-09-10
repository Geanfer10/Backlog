// Busca os itens do board "Backlog de Atividades - Manutenção" no Monday.com,
// resolve as fotos anexadas (coluna "Fotos") em URLs públicas, e grava data.json
// na raiz do repositório para o painel HTML consumir.

import { writeFile } from "node:fs/promises";

const MONDAY_API = "https://api.monday.com/v2";
const TOKEN = process.env.MONDAY_API_TOKEN;
const BOARD_ID = "18430494778";

// IDs das colunas do board (ver README.md para referência)
const COLUMN_IDS = [
  "color_mm7265sy", // Departamento
  "text_mm729y26", // Equipamento / Local
  "color_mm72kjc4", // Tipo de Manutenção
  "color_mm72z03g", // Prioridade
  "color_mm72sa2r", // Status
  "multiple_person_mm72f71j", // Responsável
  "date_mm72z3ve", // Prazo
  "file_mm722xc", // Fotos
];

async function gql(query, variables = {}) {
  const res = await fetch(MONDAY_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: TOKEN,
      "API-Version": "2024-10",
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors) {
    throw new Error(JSON.stringify(body.errors));
  }
  return body.data;
}

async function fetchBoard() {
  const query = `
    query ($boardId: [ID!], $columnIds: [String!]) {
      boards(ids: $boardId) {
        name
        groups { id title }
        items_page(limit: 500) {
          items {
            id
            name
            group { id title }
            column_values(ids: $columnIds) {
              id
              type
              text
              value
            }
          }
        }
      }
    }
  `;
  const data = await gql(query, { boardId: [BOARD_ID], columnIds: COLUMN_IDS });
  return data.boards[0];
}

function byColumnId(columnValues, id) {
  return columnValues.find((c) => c.id === id);
}

function extractAssetIds(fileColumnValue) {
  if (!fileColumnValue || !fileColumnValue.value) return [];
  try {
    const parsed = JSON.parse(fileColumnValue.value);
    const files = parsed.files || [];
    return files.filter((f) => f.assetId).map((f) => String(f.assetId));
  } catch {
    return [];
  }
}

async function fetchAssets(assetIds) {
  if (assetIds.length === 0) return {};
  const query = `
    query ($ids: [ID!]!) { 
      assets(ids: $ids) {
        id
        name
        public_url
      }
    }
  `;
  const data = await gql(query, { ids: assetIds });
  const map = {};
  for (const asset of data.assets) {
    map[asset.id] = { name: asset.name, url: asset.public_url };
  }
  return map;
}

async function main() {
  if (!TOKEN) {
    throw new Error("MONDAY_API_TOKEN não definido (configure o secret no GitHub).");
  }

  const board = await fetchBoard();
  const allItems = board.items_page.items;

  const allAssetIds = new Set();
  for (const item of allItems) {
    const fileCol = byColumnId(item.column_values, "file_mm722xc");
    for (const id of extractAssetIds(fileCol)) allAssetIds.add(id);
  }
  const assetMap = await fetchAssets([...allAssetIds]);

  const items = allItems.map((item) => {
    const get = (id) => byColumnId(item.column_values, id)?.text || "";
    const fileCol = byColumnId(item.column_values, "file_mm722xc");
    const fotos = extractAssetIds(fileCol)
      .map((id) => assetMap[id])
      .filter(Boolean);

    return {
      id: item.id,
      name: item.name,
      group_id: item.group.id,
      group_title: item.group.title,
      departamento: get("color_mm7265sy"),
      equipamento: get("text_mm729y26"),
      tipo_manutencao: get("color_mm72kjc4"),
      prioridade: get("color_mm72z03g"),
      status: get("color_mm72sa2r"),
      responsaveis: get("multiple_person_mm72f71j"),
      prazo: get("date_mm72z3ve"),
      fotos,
    };
  });

  const output = {
    generated_at: new Date().toISOString(),
    board_name: board.name,
    board_url: `https://messigean18s-team.monday.com/boards/${BOARD_ID}`,
    groups: board.groups,
    items,
  };

  await writeFile("data.json", JSON.stringify(output, null, 2));
  console.log(`Gerado data.json com ${items.length} itens.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
