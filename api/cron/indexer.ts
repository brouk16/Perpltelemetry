import type { IncomingMessage, ServerResponse } from "http";
import {
  ensureState,
  tickForward,
  tickBackward,
  tickBackfillAccounts,
} from "../../artifacts/api-server/src/perpl/indexer";

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  const secret = process.env["CRON_SECRET"];
  const auth = req.headers["authorization"];

  if (secret && auth !== `Bearer ${secret}`) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }

  try {
    await ensureState();
    await Promise.all([
      tickForward(),
      tickBackward(),
      tickBackfillAccounts(),
    ]);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, ts: Date.now() }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ ok: false, error: String(err) }),
    );
  }
}
