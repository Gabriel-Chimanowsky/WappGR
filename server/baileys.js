const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

const AUTH_DIR = path.join(__dirname, 'baileys_auth');

function normalizePhone(phone) {
  let cleaned = String(phone || '').replace(/\D/g, '');
  if (!cleaned) return '';
  // Se tiver 10 ou 11 dígitos (DDD + número brasileiro sem DDI 55)
  if ((cleaned.length === 10 || cleaned.length === 11) && !cleaned.startsWith('55')) {
    cleaned = '55' + cleaned;
  }
  return cleaned;
}

class BaileysManager {
  constructor() {
    this.sock = null;
    this.qrCodeBase64 = null;
    this.connectionState = 'DISCONNECTED'; // 'DISCONNECTED' | 'PAIRING' | 'CONNECTED'
    this.onMessageCallback = null;
    this.onStatusChangeCallback = null;
    this.isInitializing = false;
  }

  setCallbacks({ onMessage, onStatusChange }) {
    this.onMessageCallback = onMessage;
    this.onStatusChangeCallback = onStatusChange;
  }

  async init() {
    if (this.isInitializing) return;
    this.isInitializing = true;

    try {
      if (!fs.existsSync(AUTH_DIR)) {
        fs.mkdirSync(AUTH_DIR, { recursive: true });
      }

      const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
      const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] }));

      this.sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: ['WappGR', 'Chrome', '120.0.0'],
        syncFullHistory: false,
        generateHighQualityLinkPreview: true
      });

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            this.qrCodeBase64 = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
            this.connectionState = 'PAIRING';
            if (this.onStatusChangeCallback) {
              this.onStatusChangeCallback({ status: 'PAIRING', qr: this.qrCodeBase64 });
            }
          } catch (err) {
            console.error('[Baileys] Erro ao gerar Base64 do QR Code:', err);
          }
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          console.log(`[Baileys] Conexão encerrada (${statusCode}). Reconectar: ${shouldReconnect}`);
          this.connectionState = 'DISCONNECTED';
          this.qrCodeBase64 = null;

          if (this.onStatusChangeCallback) {
            this.onStatusChangeCallback({ status: 'DISCONNECTED' });
          }

          if (statusCode === DisconnectReason.loggedOut) {
            this.clearAuth();
          } else if (shouldReconnect) {
            setTimeout(() => {
              this.isInitializing = false;
              this.init();
            }, 3000);
          }
        } else if (connection === 'open') {
          console.log('[Baileys] WhatsApp Conectado com Sucesso!');
          this.connectionState = 'CONNECTED';
          this.qrCodeBase64 = null;

          const userJid = this.sock.user?.id || '';
          const phone = userJid.split(':')[0] || userJid.split('@')[0] || '';
          const profileName = this.sock.user?.name || 'WhatsApp Conectado';

          if (this.onStatusChangeCallback) {
            this.onStatusChangeCallback({
              status: 'CONNECTED',
              phone,
              profileName
            });
          }
        }
      });

      // Real-time Incoming Message Listener
      this.sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;

        for (const msg of m.messages) {
          if (!msg.message || msg.key.fromMe) continue;

          const remoteJid = msg.key.remoteJid || '';
          if (remoteJid.endsWith('@g.us')) continue; // Ignore groups

          const isLid = remoteJid.endsWith('@lid');
          const phone = isLid ? remoteJid.replace('@lid', '') : remoteJid.replace('@s.whatsapp.net', '');
          const text = msg.message?.conversation ||
                       msg.message?.extendedTextMessage?.text ||
                       msg.message?.buttonsResponseMessage?.selectedDisplayText ||
                       msg.message?.templateButtonReplyMessage?.selectedId ||
                       '';

          const pushName = msg.pushName || '';
          const msgId = msg.key.id || '';

          if (remoteJid && text && this.onMessageCallback) {
            try {
              await this.onMessageCallback({ phone, remoteJid, text, pushName, msgId });
            } catch (err) {
              console.error('[Baileys] Erro no processamento da mensagem:', err);
            }
          }
        }
      });
    } catch (err) {
      console.error('[Baileys] Erro ao inicializar socket:', err);
    } finally {
      this.isInitializing = false;
    }
  }

  async sendText(target, text) {
    if (this.connectionState !== 'CONNECTED' || !this.sock) {
      return { success: false, error: 'WhatsApp não está conectado. Acesse "Conectar WhatsApp" e escaneie o QR Code primeiro.' };
    }

    let jid = null;

    // Se o target já for um JID completo (ex: xxxx@lid ou xxxx@s.whatsapp.net)
    if (typeof target === 'string' && (target.includes('@s.whatsapp.net') || target.includes('@lid'))) {
      jid = target;
    } else {
      const cleaned = normalizePhone(target);
      if (!cleaned) {
        return { success: false, error: 'Número de telefone inválido.' };
      }

      // Consulta no servidor oficial do WhatsApp para obter o JID exato registrado
      try {
        const results = await this.sock.onWhatsApp(cleaned);
        if (results && results.length > 0 && results[0]?.exists && results[0]?.jid) {
          jid = results[0].jid;
        } else if (cleaned.startsWith('55') && cleaned.length === 13) {
          // Trata número brasileiro registrado sem o 9º dígito (55 + DDD + 8 dígitos)
          const without9 = cleaned.slice(0, 4) + cleaned.slice(5);
          const resWithout9 = await this.sock.onWhatsApp(without9);
          if (resWithout9 && resWithout9.length > 0 && resWithout9[0]?.exists && resWithout9[0]?.jid) {
            jid = resWithout9[0].jid;
          }
        } else if (cleaned.startsWith('55') && cleaned.length === 12) {
          // Trata número brasileiro registrado com o 9º dígito (55 + DDD + 9 + 8 dígitos)
          const with9 = cleaned.slice(0, 4) + '9' + cleaned.slice(4);
          const resWith9 = await this.sock.onWhatsApp(with9);
          if (resWith9 && resWith9.length > 0 && resWith9[0]?.exists && resWith9[0]?.jid) {
            jid = resWith9[0].jid;
          }
        }
      } catch (err) {
        console.warn('[Baileys] onWhatsApp check aviso:', err.message);
      }

      if (!jid) {
        jid = `${cleaned}@s.whatsapp.net`;
      }
    }

    console.log(`[Baileys] Disparando mensagem para JID oficial: ${jid}...`);

    try {
      const sent = await this.sock.sendMessage(jid, { text });
      console.log(`[Baileys] Mensagem entregue com sucesso para ${jid}! ID: ${sent?.key?.id}`);
      return { success: true, messageId: sent?.key?.id, jid };
    } catch (err) {
      console.error(`[Baileys] Erro ao enviar mensagem para ${jid}:`, err.message);
      return { success: false, error: err.message || 'Erro no envio via WhatsApp' };
    }
  }

  async sendMedia(target, { type = 'TEXT', mediaUrl, caption, text, options }) {
    if (this.connectionState !== 'CONNECTED' || !this.sock) {
      return { success: false, error: 'WhatsApp não está conectado.' };
    }

    let jid = null;
    if (typeof target === 'string' && (target.includes('@s.whatsapp.net') || target.includes('@lid'))) {
      jid = target;
    } else {
      const cleaned = normalizePhone(target);
      if (!cleaned) return { success: false, error: 'Telefone inválido.' };
      try {
        const results = await this.sock.onWhatsApp(cleaned);
        if (results && results.length > 0 && results[0]?.exists && results[0]?.jid) {
          jid = results[0].jid;
        }
      } catch (e) {}
      if (!jid) jid = `${cleaned}@s.whatsapp.net`;
    }

    // Format text with numbered option buttons if options exist
    let formattedText = (text || caption || '').trim();
    if (options && Array.isArray(options) && options.length > 0) {
      const numbers = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
      const buttonsList = options.map((opt, idx) => {
        const emoji = numbers[idx] || `[${idx + 1}]`;
        const key = opt.keyword || String(idx + 1);
        return `${emoji} *${opt.label}* _(digite *${key}*)_`;
      }).join('\n');

      formattedText = formattedText ? `${formattedText}\n\n${buttonsList}\n\n👉 *Responda com o número da opção desejada.*` : `${buttonsList}\n\n👉 *Responda com o número da opção desejada.*`;
    }

    console.log(`[Baileys] Enviando etapa de fluxo [${type}] para ${jid}...`);

    try {
      let sent = null;
      if (type === 'IMAGE' && mediaUrl) {
        sent = await this.sock.sendMessage(jid, {
          image: { url: mediaUrl },
          caption: formattedText
        });
      } else if (type === 'AUDIO' && mediaUrl) {
        sent = await this.sock.sendMessage(jid, {
          audio: { url: mediaUrl },
          mimetype: 'audio/mp4',
          ptt: true
        });
        if (formattedText) {
          await this.sock.sendMessage(jid, { text: formattedText });
        }
      } else if (type === 'VIDEO' && mediaUrl) {
        sent = await this.sock.sendMessage(jid, {
          video: { url: mediaUrl },
          caption: formattedText
        });
      } else {
        sent = await this.sock.sendMessage(jid, { text: formattedText });
      }

      console.log(`[Baileys] Etapa [${type}] enviada com sucesso! ID: ${sent?.key?.id}`);
      return { success: true, messageId: sent?.key?.id, jid };
    } catch (err) {
      console.error(`[Baileys] Falha ao enviar mídia (${type}) para ${jid}, tentando fallback em texto:`, err.message);
      try {
        const sent = await this.sock.sendMessage(jid, { text: formattedText });
        return { success: true, messageId: sent?.key?.id, jid };
      } catch (fallbackErr) {
        return { success: false, error: err.message };
      }
    }
  }

  async logout() {
    try {
      if (this.sock) {
        await this.sock.logout().catch(() => {});
      }
    } catch (e) {}

    this.clearAuth();
    this.connectionState = 'DISCONNECTED';
    this.qrCodeBase64 = null;
  }

  clearAuth() {
    try {
      if (fs.existsSync(AUTH_DIR)) {
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      }
    } catch (e) {
      console.error('[Baileys] Erro ao limpar auth dir:', e);
    }
  }

  getStatus() {
    return {
      status: this.connectionState,
      qr: this.qrCodeBase64,
      phone: this.sock?.user?.id?.split(':')[0] || this.sock?.user?.id?.split('@')[0] || null,
      profileName: this.sock?.user?.name || null
    };
  }
}

// Singleton
const baileysManager = new BaileysManager();

module.exports = baileysManager;
