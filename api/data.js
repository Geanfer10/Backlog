// api/data.js
// Busca o board "Backlog de Atividades - Manutenção" (id 18430494778) no Monday.com
// e devolve os itens agrupados, com as fotos/vídeos da coluna "Fotos".
//
// Carregamento rápido: a resposta fica em cache na CDN da Vercel por poucos segundos
// (s-maxage) e é renovada em segundo plano (stale-while-revalidate). Assim, quem abre
// o painel quase nunca espera a ida ao Monday, e o dado continua praticamente ao vivo.
// Para voltar a 100% sem cache, troque CACHE_CONTROL por "no-store".

const BOARD_ID = "18430494778";
const FOTOS_COLUMN = "file_mm722xc";

const GROUP_ORDER = ["topics", "group_mm72db89", "group_mm7217sw", "group_mm7298xt"];

const VIDEO_EXT = [".mp4", ".mov", ".webm", ".avi", ".mkv", ".m4v", ".3gp"];

const CACHE_CONTROL = "public, max-age=0, s-maxage=10, stale-while-revalidate=30";

// Só pede os anexos da coluna "Fotos" (ignora arquivos soltos em comentários/updates),
// o que deixa a resposta do Monday menor e mais rápida.
const QUERY = `
query ($boardId: [ID!]) {
  boards(ids: $boardId) {
    groups { id title }
    items_page(limit: 500) {
      items {
        id
        name
        group { id title }
        column_values(ids: [
          "color_mm7265sy", "text_mm729y26", "color_mm72kjc4",
          "color_mm72z03g", "color_mm72sa2r", "multiple_person_mm72f71j", "date_mm72z3ve"
        ]) {
          id
          text
        }
        assets(column_ids: ["${FOTOS_COLUMN}"]) { id name public_url }
      }
    }
  }
}`;

export default async function handler(req, res) {
  try {
    const token = process.env.MONDAY_API_TOKEN;
    if (!token) {
      res.status(500).json({ error: "MONDAY_API_TOKEN não configurado no Vercel" });
      return;
    }

    const t0 = Date.now();
    const mondayRes = await fetch("https://api.monday.com/v2", {
      method: "POST",
      headers: {
        Authorization: token,
        "Content-Type": "application/json",
        "API-Version": "2024-10",
      },
      body: JSON.stringify({ query: QUERY, variables: { boardId: [BOARD_ID] } }),
    });
    const body = await mondayRes.json();
    const mondayMs = Date.now() - t0;

    if (body.errors) {
      res.setHeader("Cache-Control", "no-store");
      res.status(502).json({ error: "Erro na API do Monday", details: body.errors });
      return;
    }

    const board = body.data.boards[0];
    const groupsMeta = Object.fromEntries(board.groups.map((g) => [g.id, g.title]));
    const itemsByGroup = Object.fromEntries(GROUP_ORDER.map((id) => [id, []]));

    for (const item of board.items_page.items) {
      const colMap = Object.fromEntries(item.column_values.map((cv) => [cv.id, cv.text || ""]));

      const fotos = (item.assets || [])
        .filter((a) => a.public_url)
        .map((a) => {
          const name = (a.name || "").toLowerCase();
          const isVideo = VIDEO_EXT.some((ext) => name.endsWith(ext));
          return { id: a.id, url: a.public_url, tipo: isVideo ? "video" : "imagem" };
        });

      const record = {
        id: item.id,
        atividade: item.name,
        departamento: colMap["color_mm7265sy"] || "",
        equipamento_local: colMap["text_mm729y26"] || "",
        tipo_manutencao: colMap["color_mm72kjc4"] || "",
        prioridade: colMap["color_mm72z03g"] || "",
        status: colMap["color_mm72sa2r"] || "",
        responsavel: colMap["multiple_person_mm72f71j"] || "",
        prazo: colMap["date_mm72z3ve"] || "",
        fotos,
      };

      const groupId = item.group.id;
      if (!itemsByGroup[groupId]) itemsByGroup[groupId] = [];
      itemsByGroup[groupId].push(record);
    }

    // Grupos conhecidos na ordem do painel; qualquer grupo novo criado no Monday vai ao final.
    const extraIds = Object.keys(itemsByGroup).filter((id) => !GROUP_ORDER.includes(id));
    const payload = {
      generated_at: new Date().toISOString(),
      groups: [...GROUP_ORDER, ...extraIds].map((id) => ({
        id,
        title: groupsMeta[id] || id,
        items: itemsByGroup[id] || [],
      })),
    };

    // Dá para ver o tempo gasto no Monday em: F12 > Network > /api/data > Timing (Server Timing).
    res.setHeader("Server-Timing", `monday;dur=${mondayMs}`);
    res.setHeader("Cache-Control", CACHE_CONTROL);
    res.status(200).json(payload);
  } catch (err) {
    res.setHeader("Cache-Control", "no-store");
    res.status(500).json({ error: "Erro interno", details: String(err) });
  }
}
