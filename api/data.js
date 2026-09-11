// api/board-manutencao.js
// Busca os dados do board "Backlog de Atividades - Manutenção" (id 18430494778)
// diretamente no Monday.com a cada requisição. Sem cache — sempre em tempo real.

const BOARD_ID = "18430494778";

const GROUP_ORDER = ["topics", "group_mm72db89", "group_mm7217sw", "group_mm7298xt"];

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
        assets { id name public_url }
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
    if (body.errors) {
      res.status(502).json({ error: "Erro na API do Monday", details: body.errors });
      return;
    }

    const board = body.data.boards[0];
    const groupsMeta = Object.fromEntries(board.groups.map(g => [g.id, g.title]));
    const itemsByGroup = Object.fromEntries(GROUP_ORDER.map(id => [id, []]));

    for (const item of board.items_page.items) {
      const colMap = Object.fromEntries(item.column_values.map(cv => [cv.id, cv.text || ""]));
      const VIDEO_EXT = [".mp4", ".mov", ".webm", ".avi", ".mkv"];
      const fotos = (item.assets || [])
        .filter(a => a.public_url)
        .map(a => {
          const name = (a.name || "").toLowerCase();
          const isVideo = VIDEO_EXT.some(ext => name.endsWith(ext));
          return { url: a.public_url, tipo: isVideo ? "video" : "imagem" };
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

    const payload = {
      generated_at: new Date().toISOString(),
      groups: GROUP_ORDER.map(id => ({
        id,
        title: groupsMeta[id] || id,
        items: itemsByGroup[id] || [],
      })),
    };

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(payload);
  } catch (err) {
    res.status(500).json({ error: "Erro interno", details: String(err) });
  }
}
