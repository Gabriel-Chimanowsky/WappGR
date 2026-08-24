import React, { useState } from 'react';
import { 
  Webhook, 
  Key, 
  Copy, 
  Check, 
  Send, 
  Sparkles, 
  Database, 
  Code, 
  Layers,
  ExternalLink,
  ShieldCheck
} from 'lucide-react';

export default function CRMIntegration({ webhooks, onSaveWebhooks }) {
  const [apiKey, setApiKey] = useState(webhooks?.apiKey || 'wappgr_live_sec_9876543210abcdef');
  const [outboundUrl, setOutboundUrl] = useState(webhooks?.outboundEventsUrl || 'https://seu-crm.com.br/webhooks/wappgr-events');
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const inboundUrl = 'http://localhost:3001/api/v1/crm/webhook/lead';

  // Live Tester State
  const [testPayload, setTestPayload] = useState(JSON.stringify({
    phone: "5511977889900",
    name: "Fernando Vendas (Lead CRM)",
    category: "Clientes VIP",
    optInConfirmed: true,
    notes: "Adicionado via Webhook n8n / checkout Kiwify"
  }, null, 2));

  const [testResult, setTestResult] = useState(null);
  const [isTesting, setIsTesting] = useState(false);

  const copyToClipboard = (text, setFn) => {
    navigator.clipboard.writeText(text);
    setFn(true);
    setTimeout(() => setFn(false), 2000);
  };

  const handleTestWebhook = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const parsed = JSON.parse(testPayload);
      const res = await fetch(inboundUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey
        },
        body: JSON.stringify(parsed)
      });
      const data = await res.json();
      setTestResult({ status: res.status, data });
    } catch (e) {
      setTestResult({ error: 'Erro ao enviar payload JSON: ' + e.message });
    }
    setIsTesting(false);
  };

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
          <Webhook className="w-5 h-5 text-emerald-400" />
          Integração CRM & Suite de Webhooks (CRM Ready)
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Conecte o WappGR com qualquer CRM exterior (n8n, Typebot, HubSpot, ActiveCampaign, RD Station, Make).
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Painel Esquerdo: Credenciais & URLs (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          {/* API Key */}
          <div className="p-6 rounded-2xl glass-panel border border-slate-800 space-y-4">
            <h3 className="font-bold text-white text-sm flex items-center gap-2 border-b border-slate-800 pb-3">
              <Key className="w-4 h-4 text-amber-400" /> Autenticação API REST (Chave Secreta)
            </h3>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">Sua API Key do WappGR</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={apiKey}
                  className="flex-1 px-3.5 py-2.5 rounded-xl glass-input text-xs text-emerald-400 font-mono"
                />
                <button
                  onClick={() => copyToClipboard(apiKey, setCopiedKey)}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1.5"
                >
                  {copiedKey ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  {copiedKey ? 'Copiado!' : 'Copiar'}
                </button>
              </div>
              <p className="text-[10px] text-slate-400">
                Passe no cabeçalho HTTP como <code>x-api-key</code> em todas as requisições externas.
              </p>
            </div>
          </div>

          {/* Webhook Inbound */}
          <div className="p-6 rounded-2xl glass-panel border border-slate-800 space-y-4">
            <h3 className="font-bold text-white text-sm flex items-center gap-2 border-b border-slate-800 pb-3">
              <Database className="w-4 h-4 text-emerald-400" /> Webhook de Entrada (Inbound URL)
            </h3>

            <p className="text-xs text-slate-300 leading-relaxed">
              Utilize esta URL nos formulários do seu site ou no CRM parceiro para adicionar ou atualizar leads automaticamente no WappGR.
            </p>

            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={inboundUrl}
                className="flex-1 px-3.5 py-2.5 rounded-xl glass-input text-xs text-white font-mono"
              />
              <button
                onClick={() => copyToClipboard(inboundUrl, setCopiedUrl)}
                className="px-4 py-2.5 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-semibold flex items-center gap-1.5"
              >
                {copiedUrl ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copiedUrl ? 'Copiado!' : 'Copiar URL'}
              </button>
            </div>
          </div>
        </div>

        {/* Painel Direito: Testador de Webhook Inbound ao Vivo (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="p-6 rounded-2xl glass-panel border border-slate-800 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-sm flex items-center gap-2">
                <Code className="w-4 h-4 text-purple-400" /> Testador de Inserção via CRM Webhook
              </h3>
              <span className="text-[10px] px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 font-bold">
                POST JSON
              </span>
            </div>

            <p className="text-xs text-slate-400">
              Simule o envio de um payload de checkout ou CRM e veja a criação instantânea de lead no WappGR:
            </p>

            <textarea
              rows="7"
              value={testPayload}
              onChange={(e) => setTestPayload(e.target.value)}
              className="w-full p-3 rounded-xl glass-input text-xs text-emerald-300 font-mono resize-none"
            ></textarea>

            <button
              onClick={handleTestWebhook}
              disabled={isTesting}
              className="w-full py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-purple-500/20"
            >
              <Send className="w-4 h-4" />
              {isTesting ? 'Disparando Requisição Webhook...' : 'Testar Inserção via CRM Webhook'}
            </button>

            {/* Test Result Display */}
            {testResult && (
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-2 text-xs">
                <div className="flex items-center justify-between font-bold text-white">
                  <span>Resposta do Servidor:</span>
                  <span className="text-emerald-400 font-mono">Status {testResult.status || 200}</span>
                </div>
                <pre className="text-[10px] text-slate-300 bg-slate-950 p-2 rounded-lg font-mono overflow-x-auto">
                  {JSON.stringify(testResult.data || testResult, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
