const fs = require("node:fs");
const path = require("node:path");
const { normalizePhone } = require("./domain");
const AUTH_DIR =
  process.env.WAPPGR_AUTH_DIR || path.join(__dirname, "baileys_auth");
class BaileysManager {
  constructor({
    authDir = AUTH_DIR,
    loadSdk = () => import("@whiskeysockets/baileys"),
    reconnectDelays = [5000, 15000, 30000, 60000, 300000],
  } = {}) {
    this.authDir = authDir;
    this.loadSdk = loadSdk;
    this.reconnectDelays = reconnectDelays;
    this.reconnectAttempts = 0;
    this.saveQueue = Promise.resolve();
    this.sock = null;
    this.state = "DISCONNECTED";
    this.qr = null;
    this.callbacks = {};
    this.generation = 0;
    this.stopped = false;
  }
  setCallbacks(callbacks) {
    this.callbacks = callbacks;
  }
  hasCredentials() {
    return fs.existsSync(path.join(this.authDir, "creds.json"));
  }
  getStatus() {
    return {
      status: this.state,
      qrCode: this.qr,
      phone: this.sock?.user?.id?.split("@")[0].split(":")[0] || null,
      profileName: this.sock?.user?.name || null,
      baileysAlive: !!this.sock,
      lastConnectionAt: this.lastConnectionAt || null,
      lastDisconnectReason: this.lastDisconnectReason || null,
      nextReconnectAt: this.nextReconnectAt || null,
    };
  }
  notify() {
    this.callbacks.onStatusChange?.(this.getStatus());
  }
  init() {
    if (process.env.WAPPGR_DISABLE_WHATSAPP === "1") return Promise.resolve();
    if (this.cleaning) return this.cleaning.then(() => this.init());
    if (this.initializing) return this.initializing;
    clearTimeout(this.reconnect);
    this.reconnect = null;
    this.nextReconnectAt = null;
    if (
      this.sock &&
      ["CONNECTED", "PAIRING", "CONNECTING"].includes(this.state)
    )
      return Promise.resolve();
    this.stopped = false;
    const generation = ++this.generation;
    this.state = "CONNECTING";
    this.notify();
    this.initializing = this.connect(generation)
      .catch((error) => {
        if (generation !== this.generation || this.stopped) throw error;
        this.state = "DISCONNECTED";
        this.lastDisconnectReason =
          "Falha ao inicializar conexão: " + error.message;
        const code = error.code || error.cause?.code;
        if (
          [
            "ECONNRESET",
            "ECONNREFUSED",
            "ETIMEDOUT",
            "ENOTFOUND",
            "EAI_AGAIN",
          ].includes(code) &&
          this.hasCredentials()
        )
          this.scheduleReconnect();
        this.notify();
        throw error;
      })
      .finally(() => {
        this.initializing = null;
      });
    return this.initializing;
  }
  scheduleReconnect() {
    if (this.stopped || this.reconnect) return;
    const wait =
      this.reconnectDelays[
        Math.min(this.reconnectAttempts++, this.reconnectDelays.length - 1)
      ];
    this.nextReconnectAt = new Date(Date.now() + wait).toISOString();
    this.reconnect = setTimeout(() => {
      this.reconnect = null;
      this.init().catch(() => {});
    }, wait);
    this.reconnect.unref?.();
  }
  async connect(generation) {
    const {
      default: makeWASocket,
      useMultiFileAuthState: loadAuthState,
      DisconnectReason,
      fetchLatestBaileysVersion,
    } = await this.loadSdk();
    if (this.stopped || generation !== this.generation) return;
    fs.mkdirSync(this.authDir, { recursive: true, mode: 0o700 });
    const { state, saveCreds } = await loadAuthState(this.authDir);
    if (this.stopped || generation !== this.generation) return;
    const { version } = await fetchLatestBaileysVersion();
    if (this.stopped || generation !== this.generation) return;
    this.state = "CONNECTING";
    this.notify();
    const sock = makeWASocket({
      auth: state,
      version,
      logger: require("pino")({ level: "silent" }),
      browser: ["WappGR", "Chrome", "1.0"],
      syncFullHistory: false,
      connectTimeoutMs: 30000,
      defaultQueryTimeoutMs: 30000,
    });
    this.sock = sock;
    sock.ev.on("creds.update", () => {
      if (generation !== this.generation || this.stopped) return;
      this.saveQueue = this.saveQueue
        // Accepted updates must drain before stop; logout waits, then deletes.
        .then(() => saveCreds())
        .catch(() => console.error("Falha ao persistir credenciais WhatsApp."));
    });
    sock.ev.on("connection.update", async (update) => {
      if (generation !== this.generation) return;
      if (update.qr) {
        const qr = await require("qrcode").toDataURL(update.qr);
        if (generation !== this.generation) return;
        this.qr = qr;
        this.state = "PAIRING";
      }
      if (update.connection === "open") {
        this.reconnectAttempts = 0;
        this.state = "CONNECTED";
        this.lastConnectionAt = new Date().toISOString();
        this.lastDisconnectReason = null;
        this.qr = null;
      }
      if (update.connection === "close") {
        const code = update.lastDisconnect?.error?.output?.statusCode;
        this.lastDisconnectReason = code
          ? "WhatsApp encerrou a conexão (código " + code + ")"
          : "Conexão encerrada pelo transporte";
        this.state = "DISCONNECTED";
        this.qr = null;
        this.sock = null;
        if (update.lastDisconnect?.error?.output?.statusCode === 403) {
          this.stopped = true;
          this.callbacks.onRestriction?.(
            "Acesso recusado pelo WhatsApp (403). Revisão operacional necessária.",
          );
        }
        if (
          update.lastDisconnect?.error?.output?.statusCode ===
          DisconnectReason.loggedOut
        ) {
          this.stopped = true;
          await this.logout();
          return;
        }
        if (!this.stopped) {
          this.scheduleReconnect();
        }
      }
      this.notify();
    });
    sock.ev.on("messages.upsert", (event) => {
      if (generation !== this.generation) return;
      for (const msg of event.messages || []) {
        if (msg.key?.fromMe) {
          if (msg.key.id) this.callbacks.onReceipt?.(msg.key.id, "SENT");
          continue;
        }
        if (event.type !== "notify") continue;
        const jid = msg.key?.remoteJid;
        if (!jid || (!jid.endsWith("@s.whatsapp.net") && !jid.endsWith("@lid")))
          continue;
        const m = msg.message || {};
        const content =
          m.conversation ||
          m.extendedTextMessage?.text ||
          m.buttonsResponseMessage?.selectedDisplayText ||
          m.templateButtonReplyMessage?.selectedDisplayText;
        if (!content || !msg.key.id) continue;
        const pn = jid.endsWith("@s.whatsapp.net") ? jid : msg.key.remoteJidAlt;
        this.callbacks.onMessage?.({
          id: msg.key.id,
          jid,
          phone: pn?.endsWith("@s.whatsapp.net")
            ? "+" + pn.split("@")[0].split(":")[0]
            : null,
          name: msg.pushName || "Contato WhatsApp",
          text: content,
          clientTimestamp: Number.isFinite(Number(msg.messageTimestamp))
            ? new Date(Number(msg.messageTimestamp) * 1000).toISOString()
            : null,
        });
      }
    });
    sock.ev.on("messages.update", (events) => {
      if (generation !== this.generation) return;
      for (const { key, update } of events) {
        if (Number(update.status) >= 2)
          this.callbacks.onReceipt?.(
            key.id,
            Number(update.status) >= 4
              ? "READ"
              : Number(update.status) === 3
                ? "DELIVERED"
                : "SENT",
          );
      }
    });
    sock.ev.on("message-receipt.update", (events) => {
      if (generation !== this.generation) return;
      for (const { key, receipt } of events) {
        if (receipt.readTimestamp || receipt.receiptTimestamp)
          this.callbacks.onReceipt?.(
            key.id,
            receipt.readTimestamp ? "READ" : "DELIVERED",
          );
      }
    });
  }
  async send(target, payload, providerId, context = {}) {
    if (this.state !== "CONNECTED" || !this.sock)
      return {
        success: false,
        definitelyNotSent: true,
        retryable: true,
        error: "WhatsApp desconectado",
      };
    const jid = String(target).includes("@")
      ? target
      : normalizePhone("+" + target) + "@s.whatsapp.net";
    if (!/^\d+@(s\.whatsapp\.net|lid)$/.test(jid))
      return {
        success: false,
        definitelyNotSent: true,
        retryable: false,
        error: "Destino inválido",
      };
    let content = payload.text || payload.content || "";
    if (payload.options?.length)
      content +=
        "\n\n" +
        payload.options
          .map(
            (o, i) =>
              i + 1 + ". " + o.label + " (digite " + (o.keyword || i + 1) + ")",
          )
          .join("\n");
    let message = { text: content };
    if (payload.type && payload.type !== "TEXT") {
      try {
        const url = new URL(payload.mediaUrl);
        const hosts = (process.env.WAPPGR_MEDIA_HOSTS || "")
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
        if (
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          !hosts.includes(url.hostname)
        )
          throw Error("Origem de mídia não autorizada");
        const response = await fetch(url, {
          redirect: "error",
          signal: AbortSignal.timeout(15000),
        });
        if (
          !response.ok ||
          Number(response.headers.get("content-length")) > 20971520
        )
          throw Error("Mídia indisponível ou excede 20 MB");
        const chunks = [];
        let size = 0;
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > 20971520) throw Error("Mídia excede 20 MB");
          chunks.push(chunk);
        }
        const data = Buffer.concat(chunks);
        if (payload.type === "IMAGE")
          message = { image: data, caption: content };
        else if (payload.type === "VIDEO")
          message = { video: data, caption: content };
        else if (payload.type === "AUDIO")
          message = {
            audio: data,
            mimetype:
              response.headers.get("content-type")?.split(";")[0] ||
              "audio/mp4",
            ptt: true,
          };
        else throw Error("Tipo de mídia inválido");
      } catch (error) {
        return {
          success: false,
          definitelyNotSent: true,
          retryable: false,
          error: error.message,
        };
      }
    }
    if (this.state !== "CONNECTED" || !this.sock)
      return {
        success: false,
        definitelyNotSent: true,
        retryable: true,
        error: "Conexão perdida antes do envio",
      };
    const reason = context.beforeSend?.();
    if (reason)
      return {
        success: false,
        definitelyNotSent: true,
        retryable: false,
        error: reason,
      };
    try {
      const result = await this.sock.sendMessage(jid, message, {
        messageId: providerId,
      });
      return result?.key?.id
        ? { success: true, messageId: result.key.id }
        : {
            success: false,
            uncertain: true,
            error: "Provedor não confirmou o resultado",
          };
    } catch {
      return {
        success: false,
        uncertain: true,
        error: "Resultado de rede incerto; sem reenvio automático",
      };
    }
  }
  clearAuth() {
    fs.rmSync(this.authDir, { recursive: true, force: true });
  }
  async stop() {
    this.stopped = true;
    clearTimeout(this.reconnect);
    this.reconnect = null;
    this.nextReconnectAt = null;
    this.generation++;
    const sock = this.sock;
    this.sock = null;
    this.state = "DISCONNECTED";
    this.qr = null;
    sock?.end?.(new Error("Encerramento controlado do WappGR"));
    await this.saveQueue;
    this.notify();
  }
  logout() {
    if (this.cleaning) return this.cleaning;
    this.stopped = true;
    clearTimeout(this.reconnect);
    this.reconnect = null;
    this.nextReconnectAt = null;
    this.generation++;
    const sock = this.sock;
    this.sock = null;
    this.state = "DISCONNECTED";
    this.qr = null;
    this.cleaning = (async () => {
      if (sock) await sock.logout().catch(() => {});
      await this.saveQueue;
      this.clearAuth();
      this.notify();
    })().finally(() => {
      this.cleaning = null;
    });
    return this.cleaning;
  }
}
module.exports = new BaileysManager();
module.exports.BaileysManager = BaileysManager;
