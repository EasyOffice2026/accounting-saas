import { existsSync, mkdirSync, rmSync } from "node:fs";
import express from "express";
import pino from "pino";
import QRCode from "qrcode";
import { Boom } from "@hapi/boom";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";

const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.WHATSAPP_API_KEY || "";
const AUTH_DIR = process.env.AUTH_DIR || "/data/auth";
const SESSION = "default";

const logger = pino({ level: process.env.LOG_LEVEL || "info" });

// A session is only expected to be online once the number has been linked.
// Before that it legitimately sits in SCAN_QR_CODE waiting for the user.
const UNHEALTHY_AFTER_MS = 5 * 60 * 1000;
const WATCHDOG_INTERVAL_MS = 60 * 1000;

let sock = null;
let latestQr = null;
let status = "STOPPED";
let me = null;
let starting = false;
let linked = false;
let offlineSince = null;

function setStatus(next) {
  if (status !== next) {
    status = next;
    logger.info({ status }, "session status changed");
  }
  offlineSince = next === "WORKING" ? null : offlineSince ?? Date.now();
}

/** Unhealthy only if the number is linked but has been offline too long. */
function offlineTooLong() {
  if (!linked || status === "WORKING" || !offlineSince) return false;
  return Date.now() - offlineSince > UNHEALTHY_AFTER_MS;
}

async function startSocket() {
  if (starting) return;
  starting = true;
  try {
    mkdirSync(AUTH_DIR, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();
    linked = Boolean(state.creds.registered);
    logger.info({ version, linked }, "starting socket");

    setStatus(linked ? "STARTING" : "SCAN_QR_CODE");

    sock = makeWASocket({
      version,
      auth: state,
      logger: logger.child({ module: "baileys" }, { level: "warn" }),
      browser: Browsers.ubuntu("Chrome"),
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        latestQr = qr;
        setStatus("SCAN_QR_CODE");
      }

      if (connection === "open") {
        latestQr = null;
        linked = true;
        me = sock?.user || null;
        setStatus("WORKING");
      }

      if (connection === "close") {
        const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        logger.warn({ code, loggedOut }, "connection closed");
        me = null;
        sock = null;
        if (loggedOut) {
          // Credentials are dead; wipe them so a fresh QR/pairing can be issued.
          rmSync(AUTH_DIR, { recursive: true, force: true });
          linked = false;
          setStatus("SCAN_QR_CODE");
        } else {
          setStatus("STARTING");
        }
        setTimeout(() => startSocket().catch((e) => logger.error(e)), 2000);
      }
    });
  } catch (err) {
    logger.error(err, "failed to start socket");
    setStatus("FAILED");
    setTimeout(() => startSocket().catch((e) => logger.error(e)), 5000);
  } finally {
    starting = false;
  }
}

async function stopSocket() {
  try {
    sock?.end(undefined);
  } catch {
    /* already closed */
  }
  sock = null;
  me = null;
  latestQr = null;
  setStatus("STOPPED");
}

function sessionInfo() {
  return {
    name: SESSION,
    status,
    me: me ? { id: me.id, pushName: me.name } : null,
    engine: { engine: "BAILEYS" },
  };
}

function normalizeChatId(raw) {
  const value = String(raw || "").trim();
  if (value.includes("@")) return value;
  const digits = value.replace(/\D/g, "");
  return `${digits}@s.whatsapp.net`;
}

const app = express();
app.use(express.json({ limit: "2mb" }));

app.use((req, res, next) => {
  if (req.path === "/health") return next();
  if (API_KEY && req.get("X-Api-Key") !== API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

app.get("/health", (_req, res) => {
  const unhealthy = offlineTooLong();
  res.status(unhealthy ? 503 : 200).json({
    status: unhealthy ? "unhealthy" : "ok",
    session: status,
    linked,
    offlineSince,
  });
});

app.get("/api/sessions", (_req, res) => res.json([sessionInfo()]));
app.get(`/api/sessions/${SESSION}`, (_req, res) => res.json(sessionInfo()));

app.post(`/api/sessions/${SESSION}/start`, async (_req, res) => {
  await startSocket();
  res.json(sessionInfo());
});

app.post(`/api/sessions/${SESSION}/stop`, async (_req, res) => {
  await stopSocket();
  res.json(sessionInfo());
});

app.post(`/api/sessions/${SESSION}/restart`, async (_req, res) => {
  await stopSocket();
  await startSocket();
  res.json(sessionInfo());
});

app.post(`/api/sessions/${SESSION}/logout`, async (_req, res) => {
  try {
    await sock?.logout();
  } catch {
    /* socket may already be gone */
  }
  await stopSocket();
  rmSync(AUTH_DIR, { recursive: true, force: true });
  await startSocket();
  res.json(sessionInfo());
});

app.get(`/api/${SESSION}/auth/qr`, async (req, res) => {
  if (!latestQr) {
    return res.status(404).json({ error: `No QR available (status: ${status})` });
  }
  if (req.query.format === "image") {
    const png = await QRCode.toBuffer(latestQr, { type: "png", width: 512, margin: 2 });
    res.type("png").send(png);
    return;
  }
  res.json({ value: latestQr });
});

app.post(`/api/${SESSION}/auth/request-code`, async (req, res) => {
  const phoneNumber = String(req.body?.phoneNumber || "").replace(/\D/g, "");
  if (!phoneNumber) return res.status(400).json({ error: "phoneNumber is required" });
  if (!sock) return res.status(409).json({ error: `Session not running (status: ${status})` });
  if (status === "WORKING") return res.status(409).json({ error: "Already linked" });
  try {
    const code = await sock.requestPairingCode(phoneNumber);
    const pretty = code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
    res.json({ code: pretty });
  } catch (err) {
    logger.error(err, "pairing code failed");
    res.status(500).json({ error: String(err?.message || err) });
  }
});

app.get(`/api/${SESSION}/groups`, async (_req, res) => {
  if (status !== "WORKING" || !sock) {
    return res.status(409).json({ error: `Session not ready (status: ${status})` });
  }
  try {
    const all = await sock.groupFetchAllParticipating();
    res.json(
      Object.values(all).map((g) => ({ id: g.id, name: g.subject || g.id }))
    );
  } catch (err) {
    logger.error(err, "group fetch failed");
    res.status(500).json({ error: String(err?.message || err) });
  }
});

app.post("/api/sendText", async (req, res) => {
  const { chatId, text } = req.body || {};
  if (!chatId || !text) return res.status(400).json({ error: "chatId and text are required" });
  if (status !== "WORKING" || !sock) {
    return res.status(409).json({ error: `Session not ready (status: ${status})` });
  }
  try {
    const sent = await sock.sendMessage(normalizeChatId(chatId), { text: String(text) });
    res.json({ id: sent?.key?.id || "", key: sent?.key || {} });
  } catch (err) {
    logger.error(err, "send failed");
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/** Re-drives a linked-but-stalled session instead of waiting for a redeploy. */
function watchdog() {
  if (!linked || status === "WORKING" || starting) return;
  const downFor = offlineSince ? Date.now() - offlineSince : 0;
  if (downFor < WATCHDOG_INTERVAL_MS) return;
  logger.warn({ status, downFor }, "watchdog restarting stalled session");
  stopSocket()
    .then(() => startSocket())
    .catch((e) => logger.error(e));
}

app.listen(PORT, "0.0.0.0", () => {
  logger.info({ port: PORT, authDir: AUTH_DIR, existing: existsSync(AUTH_DIR) }, "gateway listening");
  startSocket().catch((e) => logger.error(e));
  setInterval(watchdog, WATCHDOG_INTERVAL_MS);
});
