/**
 * Evolution API v2 Client
 * Integração real com WhatsApp via Evolution API (Docker)
 * 
 * Documentação: https://doc.evolution-api.com/
 */
const axios = require('axios');

class EvolutionClient {
  constructor(baseUrl, globalApiKey) {
    this.baseUrl = (baseUrl || 'http://localhost:8080').replace(/\/$/, '');
    this.globalApiKey = globalApiKey || '';
    this.instanceName = 'wappgr-main';

    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'apikey': this.globalApiKey
      }
    });
  }

  updateConfig(baseUrl, apiKey) {
    if (baseUrl) this.baseUrl = baseUrl.replace(/\/$/, '');
    if (apiKey) this.globalApiKey = apiKey;
    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'apikey': this.globalApiKey
      }
    });
  }

  // ─── INSTANCE MANAGEMENT ──────────────────────────────

  /** Create a new WhatsApp instance */
  async createInstance(instanceName) {
    this.instanceName = instanceName || this.instanceName;
    try {
      const res = await this.http.post('/instance/create', {
        instanceName: this.instanceName,
        integration: 'WHATSAPP-BAILEYS',
        qrcode: true,
        rejectCall: false,
        groupsIgnore: true,
        alwaysOnline: false,
        readMessages: false,
        readStatus: false,
        syncFullHistory: false
      });
      return { success: true, data: res.data };
    } catch (err) {
      return this._handleError(err, 'createInstance');
    }
  }

  /** Get connection status of instance */
  async getConnectionStatus() {
    try {
      const res = await this.http.get(`/instance/connectionState/${this.instanceName}`);
      return { success: true, data: res.data };
    } catch (err) {
      return this._handleError(err, 'getConnectionStatus');
    }
  }

  /** Fetch QR Code for pairing */
  async fetchQrCode() {
    try {
      const res = await this.http.get(`/instance/connect/${this.instanceName}`);
      return { success: true, data: res.data };
    } catch (err) {
      return this._handleError(err, 'fetchQrCode');
    }
  }

  /** Logout / disconnect instance */
  async logout() {
    try {
      const res = await this.http.delete(`/instance/logout/${this.instanceName}`);
      return { success: true, data: res.data };
    } catch (err) {
      return this._handleError(err, 'logout');
    }
  }

  /** Delete instance completely */
  async deleteInstance() {
    try {
      const res = await this.http.delete(`/instance/delete/${this.instanceName}`);
      return { success: true, data: res.data };
    } catch (err) {
      return this._handleError(err, 'deleteInstance');
    }
  }

  /** Restart instance */
  async restartInstance() {
    try {
      const res = await this.http.put(`/instance/restart/${this.instanceName}`);
      return { success: true, data: res.data };
    } catch (err) {
      return this._handleError(err, 'restartInstance');
    }
  }

  // ─── MESSAGING ────────────────────────────────────────

  /**
   * Send a text message to a phone number
   * @param {string} phone - Phone number with country code, e.g. '5511999887766'
   * @param {string} text - Message text
   * @returns {Promise<object>}
   */
  async sendText(phone, text) {
    const number = this._formatPhone(phone);
    try {
      const res = await this.http.post(`/message/sendText/${this.instanceName}`, {
        number,
        text
      });
      return { success: true, data: res.data, messageId: res.data?.key?.id };
    } catch (err) {
      return this._handleError(err, 'sendText');
    }
  }

  /**
   * Send text message with delay (for pacing in broadcasts)
   * @param {string} phone 
   * @param {string} text 
   * @param {number} delayMs - Delay in ms before sending
   */
  async sendTextWithDelay(phone, text, delayMs = 0) {
    if (delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    return this.sendText(phone, text);
  }

  /**
   * Send media (image, document, etc.)
   */
  async sendMedia(phone, mediaUrl, caption, mediaType = 'image') {
    const number = this._formatPhone(phone);
    try {
      const res = await this.http.post(`/message/sendMedia/${this.instanceName}`, {
        number,
        mediatype: mediaType,
        mimetype: mediaType === 'image' ? 'image/jpeg' : 'application/pdf',
        caption: caption || '',
        media: mediaUrl
      });
      return { success: true, data: res.data };
    } catch (err) {
      return this._handleError(err, 'sendMedia');
    }
  }

  // ─── WEBHOOK CONFIGURATION ────────────────────────────

  /** Set webhook URL for receiving messages/events from Evolution API */
  async setWebhook(webhookUrl) {
    try {
      const res = await this.http.post(`/webhook/set/${this.instanceName}`, {
        enabled: true,
        url: webhookUrl,
        webhookByEvents: false,
        webhookBase64: false,
        events: [
          'MESSAGES_UPSERT',
          'MESSAGES_UPDATE',
          'CONNECTION_UPDATE',
          'QRCODE_UPDATED'
        ]
      });
      return { success: true, data: res.data };
    } catch (err) {
      return this._handleError(err, 'setWebhook');
    }
  }

  // ─── CHECK IF NUMBER EXISTS ON WHATSAPP ───────────────

  async checkNumber(phone) {
    const number = this._formatPhone(phone);
    try {
      const res = await this.http.post(`/chat/whatsappNumbers/${this.instanceName}`, {
        numbers: [number]
      });
      return { success: true, data: res.data };
    } catch (err) {
      return this._handleError(err, 'checkNumber');
    }
  }

  // ─── PROFILE INFO ─────────────────────────────────────

  async getProfileInfo() {
    try {
      const res = await this.http.get(`/instance/fetchInstances`, {
        params: { instanceName: this.instanceName }
      });
      return { success: true, data: res.data };
    } catch (err) {
      return this._handleError(err, 'getProfileInfo');
    }
  }

  // ─── HEALTH CHECK ─────────────────────────────────────

  async healthCheck() {
    try {
      const res = await this.http.get('/');
      return { success: true, alive: true, data: res.data };
    } catch (err) {
      return { success: false, alive: false, error: err.message };
    }
  }

  // ─── INTERNAL ─────────────────────────────────────────

  _formatPhone(phone) {
    // Remove non-digits, ensure it's just the number
    let cleaned = String(phone).replace(/\D/g, '');
    // Add @s.whatsapp.net suffix is handled by Evolution API
    return cleaned;
  }

  _handleError(err, method) {
    const status = err.response?.status;
    const message = err.response?.data?.message || err.response?.data?.error || err.message;
    console.error(`[EvolutionAPI] ${method} error (${status}):`, message);
    return {
      success: false,
      error: message,
      status,
      detail: err.response?.data
    };
  }
}

// Singleton instance
let client = null;

function getEvolutionClient(baseUrl, apiKey) {
  if (!client) {
    client = new EvolutionClient(baseUrl, apiKey);
  }
  return client;
}

module.exports = { EvolutionClient, getEvolutionClient };
