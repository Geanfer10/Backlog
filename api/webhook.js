// api/webhook.js
// Recebe os avisos do Monday ("algo mudou no board") e só anota isso no Redis.
// O trabalho pesado (ir ao Monday buscar os dados) fica para /api/data, que faz isso
// uma única vez, mesmo que cheguem vários avisos seguidos.
//
// Segurança: a URL do webhook leva uma chave (?key=...) que precisa ser igual à variável
// de ambiente WEBHOOK_SECRET da Vercel. Sem a chave certa, nada é anotado.

import { timingSafeEqual } from "node:crypto";

const BOARD_ID = "18430494778";
const EVENT_KEY = "backlog:lastEvent";

function sameText(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export default async function handler(req, res) {
  try {
    const secret = process.env.WEBHOOK_SECRET;
    const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!secret || !redisUrl || !redisToken) {
      // Sem configurar, o Monday não consegue nem criar o webhook (o "desafio" falha) — é proposital.
      res.status(500).json({ error: "WEBHOOK_SECRET e o Redis precisam estar configurados na Vercel" });
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ error: "Use POST" });
      return;
    }

    const key = new URL(req.url || "/", "http://localhost").searchParams.get("key") || "";
    if (!sameText(key, secret)) {
      res.status(401).json({ error: "Chave inválida" });
      return;
    }

    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch (e) { body = {}; }
    }
    body = body || {};

    // Verificação inicial do Monday: precisa devolver o mesmo "challenge".
    if (body.challenge) {
      res.status(200).json({ challenge: body.challenge });
      return;
    }

    const ev = body.event || {};
    if (String(ev.boardId) !== BOARD_ID) {
      res.status(200).json({ ignored: true });
      return;
    }

    const r = await fetch(redisUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${redisToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(["SET", EVENT_KEY, String(Date.now())]),
    });
    const out = await r.json();
    if (out.error) throw new Error("Redis: " + out.error);

    res.status(200).json({ ok: true });
  } catch (err) {
    // Resposta de erro faz o Monday tentar de novo (1 vez por minuto, por até 30 min).
    res.status(500).json({ error: "Erro interno", details: String(err) });
  }
}
