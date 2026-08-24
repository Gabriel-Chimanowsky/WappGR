import React from 'react';
import { ShieldCheck, Sparkles, RefreshCw, Smartphone } from 'lucide-react';

export default function Navbar({ activeTab, onRefresh, stats, connection }) {
  const titles = {
    dashboard: 'Painel Geral de Controle',
    connection: 'Conexão WhatsApp & Instâncias',
    leads: 'Gestão de Leads & Categorias',
    optin: 'Regras de Consentimento (Opt-in Engine)',
    broadcast: 'Central de Disparos em Massa',
    scheduler: 'Agendador de Campanhas Recorrentes',
    chat: 'Conversas 1 a 1 em Tempo Real',
    crm: 'Configurações de Integração CRM & Webhooks'
  };

  return (
    <header className="h-16 border-b border-slate-800/80 px-8 flex items-center justify-between sticky top-0 bg-slate-950/80 backdrop-blur-md z-20">
      <div className="flex items-center gap-4">
        <h2 className="text-base font-bold text-white tracking-wide">
          {titles[activeTab] || 'WappGR'}
        </h2>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <ShieldCheck className="w-3.5 h-3.5" />
          Meta Policy Compliant (Opt-In Active)
        </span>
      </div>

      <div className="flex items-center gap-3">
        {/* Quick Instance Type Badge */}
        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-300">
          <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
          <span>{connection?.instanceType === 'META_CLOUD_API' ? 'Meta Cloud API Official' : 'WhatsApp Web Socket (QR Code)'}</span>
        </div>

        {/* Refresh button */}
        <button
          onClick={onRefresh}
          className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          title="Atualizar dados"
        >
          <RefreshCw className="w-4 h-4" />
        </button>

        {/* Opt-in Rate Widget */}
        <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-500/10 to-teal-500/10 border border-emerald-500/20">
          <Sparkles className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-semibold text-emerald-300">
            {stats?.optInRatePercent || 0}% Aceite Opt-in
          </span>
        </div>
      </div>
    </header>
  );
}
