// api/data.js
// Entrega os dados do board "Backlog de Atividades - Manutenção" (id 18430494778).
//
// COMO FUNCIONA (atualização por evento):
//  - O Monday avisa /api/webhook quando algo muda; o webhook só anota "mudou" no Redis.
//  - Aqui, a gente guarda uma cópia (snapshot) dos dados no Redis e só vai ao Monday quando:
//      1) ainda não existe cópia, ou
//      2) o webhook avisou que algo mudou, ou
//      3) a cópia tem mais de 30 min (os links de foto do Monday expiram em 1 h).
//  - O painel pergunta aqui a cada 20 s, mas isso NÃO consulta o Monday: só lê o Redis.
//  - Se o Monday falhar ou estourar o limite diário, devolvemos a última cópia com aviso
//    e esperamos um tempo antes de tentar de novo (nada de insistir).
//
// Variáveis de ambiente (Vercel): MONDAY_API_TOKEN, WEBHOOK_SECRET e as do Redis (Upstash),
// que a própria Vercel cria ao conectar o banco: KV_REST_API_URL e KV_REST_API_TOKEN.
// Sem o Redis configurado, cai num modo simples (consulta o Monday com cache longo na CDN).

const BOARD_ID = "18430494778";
const FOTOS_COLUMN = "file_mm722xc";
const GROUP_ORDER = ["topics", "group_mm72db89", "group_mm7217sw", "group_mm7298xt"];
const VIDEO_EXT = [".mp4", ".mov", ".webm", ".avi", ".mkv", ".m4v", ".3gp"];

const SNAPSHOT_KEY = "backlog:snapshot";
const EVENT_KEY = "backlog:lastEvent";
const BACKOFF_KEY = "backlog:backoff";
const LOCK_KEY = "backlog:lock";

const MAX_AGE_MS = 30 * 60 * 1000; // renova a cópia mesmo sem mudanças (links de foto expiram em 1 h)
const MIN_GAP_MS = 5000;           // nunca atualiza mais de 1 vez a cada 5 s
const LOCK_TTL_S = 20;             // trava para só uma requisição ir ao Monday por vez
const BACKOFF_S = 120;             // espera após erro do Monday
const BACKOFF_LIMIT_S = 900;       // espera após estourar o limite diário/por minuto
const CLOCK_SLACK_MS = 2000;       // folga para diferença de relógio entre servidores

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

/* ---------- Redis (Upstash, via REST: sem pacote para instalar) ---------- */

function redisConfig() {
  return {
    url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
  };
}

async function redis(command) {
  const { url, token } = redisConfig();
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const body = await r.json();
  if (body.error) throw new Error("Redis: " + body.error);
  return body.result;
}

/* ---------- Monday ---------- */

class MondayError extends Error {
  constructor(message, isLimit) {
    super(message);
    this.isLimit = !!isLimit;
  }
}

async function fetchFromMonday(token) {
  const startedAt = Date.now();
  const r = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json", "API-Version": "2024-10" },
    body: JSON.stringify({ query: QUERY, variables: { boardId: [BOARD_ID] } }),
  });
  let body = null;
  try { body = await r.json(); } catch (e) { /* resposta sem JSON */ }

  const limitCodes = ["DAILY_LIMIT_EXCEEDED", "COMPLEXITY_BUDGET_EXHAUSTED", "IP_RATE_LIMIT_EXCEEDED", "maxConcurrencyExceeded"];
  const errText = JSON.stringify((body && (body.errors || body.error_message || body.error_code)) || "");
  const isLimit = r.status === 429 || limitCodes.some((c) => errText.includes(c)) || /rate limit|limit exceeded/i.test(errText);
  if (!r.ok || !body || body.errors || !body.data) {
    throw new MondayError(`Monday respondeu ${r.status}: ${errText.slice(0, 300)}`, isLimit);
  }

  const board = body.data.boards[0];
  const groupsMeta = Object.fromEntries(board.groups.map((g) => [g.id, g.title]));
  const itemsByGroup = Object.fromEntries(GROUP_ORDER.map((id) => [id, []]));

  for (const item of board.items_page.items) {
    const col = Object.fromEntries(item.column_values.map((cv) => [cv.id, cv.text || ""]));
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
      departamento: col["color_mm7265sy"] || "",
      equipamento_local: col["text_mm729y26"] || "",
      tipo_manutencao: col["color_mm72kjc4"] || "",
      prioridade: col["color_mm72z03g"] || "",
      status: col["color_mm72sa2r"] || "",
      responsavel: col["multiple_person_mm72f71j"] || "",
      prazo: col["date_mm72z3ve"] || "",
      fotos,
    };
    const gid = item.group.id;
    if (!itemsByGroup[gid]) itemsByGroup[gid] = [];
    itemsByGroup[gid].push(record);
  }

  const extraIds = Object.keys(itemsByGroup).filter((id) => !GROUP_ORDER.includes(id));
  // "fetched_at" fica um pouco no passado de propósito: se um aviso do webhook chegar
  // quase junto com esta leitura, na dúvida a gente lê de novo (melhor sobrar do que perder mudança).
  const fetchedAt = startedAt - CLOCK_SLACK_MS;
  return {
    payload: {
      version: String(fetchedAt),
      fetched_at: fetchedAt,
      generated_at: new Date(startedAt).toISOString(),
      groups: [...GROUP_ORDER, ...extraIds].map((id) => ({
        id,
        title: groupsMeta[id] || id,
        items: itemsByGroup[id] || [],
      })),
    },
    mondayMs: Date.now() - startedAt,
  };
}

// Só uma requisição por vez vai ao Monday (as outras usam a cópia que já existe).
async function refreshSnapshot(token) {
  const got = await redis(["SET", LOCK_KEY, "1", "NX", "EX", String(LOCK_TTL_S)]);
  if (got !== "OK") return null;
  try {
    const { payload, mondayMs } = await fetchFromMonday(token);
    await redis(["SET", SNAPSHOT_KEY, JSON.stringify(payload)]);
    return { payload, mondayMs };
  } catch (e) {
    await redis(["SET", BACKOFF_KEY, "1", "EX", String(e.isLimit ? BACKOFF_LIMIT_S : BACKOFF_S)]).catch(() => {});
    throw e;
  } finally {
    await redis(["DEL", LOCK_KEY]).catch(() => {});
  }
}

async function waitForSnapshot() {
  for (let i = 0; i < 16; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const raw = await redis(["GET", SNAPSHOT_KEY]);
    if (raw) return JSON.parse(raw);
  }
  return null;
}

/* ---------- Handler ---------- */

export default async function handler(req, res) {
  try {
    const token = process.env.MONDAY_API_TOKEN;
    if (!token) {
      res.status(500).json({ error: "MONDAY_API_TOKEN não configurado no Vercel" });
      return;
    }

    // Modo simples (Redis ainda não configurado): consulta o Monday e deixa a CDN guardar 2 min.
    if (!redisConfig().url || !redisConfig().token) {
      const { payload, mondayMs } = await fetchFromMonday(token);
      res.setHeader("Server-Timing", `monday;dur=${mondayMs}`);
      res.setHeader("Cache-Control", "public, max-age=0, s-maxage=120, stale-while-revalidate=300");
      res.status(200).json({ ...payload, modo: "simples" });
      return;
    }

    const requestedVersion = new URL(req.url || "/", "http://localhost").searchParams.get("v");

    const [rawSnap, rawEvent, backoff] = await redis(["MGET", SNAPSHOT_KEY, EVENT_KEY, BACKOFF_KEY]);
    let snap = rawSnap ? JSON.parse(rawSnap) : null;
    const lastEvent = Number(rawEvent) || 0;
    const age = snap ? Date.now() - snap.fetched_at : Infinity;
    const changed = !!snap && lastEvent > snap.fetched_at;
    const expired = age > MAX_AGE_MS;
    const needsRefresh = !snap || changed || expired;

    let error = null;
    let mondayMs = null;

    if (needsRefresh && !backoff && (!snap || age >= MIN_GAP_MS)) {
      try {
        const fresh = await refreshSnapshot(token);
        if (fresh) {
          snap = fresh.payload;
          mondayMs = fresh.mondayMs;
        } else if (!snap) {
          snap = await waitForSnapshot(); // outra requisição está buscando a primeira cópia
        }
      } catch (e) {
        error = String(e.message || e);
      }
    }

    if (!snap) {
      res.setHeader("Cache-Control", "no-store");
      res.status(error ? 502 : 503).json({
        error: error || "Monday indisponível no momento; tentando de novo em instantes",
      });
      return;
    }

    // Defasado = precisava atualizar e não conseguiu (erro do Monday ou período de espera).
    const stale = needsRefresh && (!!error || !!backoff) && (changed || expired);

    if (mondayMs !== null) res.setHeader("Server-Timing", `monday;dur=${mondayMs}`);

    if (!stale && requestedVersion && requestedVersion === snap.version) {
      res.setHeader("Cache-Control", "public, max-age=0, s-maxage=5");
      res.status(200).json({ unchanged: true, version: snap.version, fetched_at: snap.fetched_at });
      return;
    }

    res.setHeader("Cache-Control", stale ? "no-store" : "public, max-age=0, s-maxage=5");
    res.status(200).json(stale ? { ...snap, stale: true } : snap);
  } catch (err) {
    res.setHeader("Cache-Control", "no-store");
    res.status(500).json({ error: "Erro interno", details: String(err) });
  }
}
