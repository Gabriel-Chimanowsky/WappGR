import React, { useState } from 'react';
import { 
  Send, 
  ShieldCheck, 
  Users, 
  Clock, 
  Play, 
  CheckCircle2, 
  AlertCircle, 
  Sparkles,
  Layers,
  History,
  Info
} from 'lucide-react';

export default function CampaignBroadcastWizard({ 
  campaigns, 
  categories, 
  leads, 
  onSendCampaign 
}) {
  const [form, setForm] = useState({
    title: '',
    categoryFilter: 'TODOS',
    message: 'Olá {nome}! 🚀 Temos uma novidade incrível da categoria {categoria} preparada especialmente para você. Confira em nosso site!',
    pacingSeconds: 10
  });

  const [isDispatching, setIsDispatching] = useState(false);
  const [resultFeedback, setResultFeedback] = useState(null);

  // Calculate target count
  const eligibleLeads = leads.filter(l => {
    if (l.status !== 'OPT_IN') return false; // Strictly OPT_IN
    const catName = l.category_name || l.category || '';
    if (form.categoryFilter !== 'TODOS' && catName !== form.categoryFilter) return false;
    return true;
  });

  const handleInsertPlaceholder = (placeholder) => {
    setForm(prev => ({
      ...prev,
      message: prev.message + ' ' + placeholder
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title || !form.message) return;

    setIsDispatching(true);
    setResultFeedback(null);

    const res = await onSendCampaign(form);

    setIsDispatching(false);
    if (res && res.campaign) {
      setResultFeedback(res.message);
      setForm({
        title: '',
        categoryFilter: 'TODOS',
        message: 'Olá {nome}! 🚀 Temos uma novidade incrível da categoria {categoria} preparada especialmente para você.',
        pacingSeconds: 10
      });
    }
  };

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
          <Send className="w-5 h-5 text-emerald-400" />
          Central de Disparos em Massa (Broadcasting)
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Crie campanhas de mensagens em massa direcionadas exclusivamente para leads autorizados com controle de cadência anti-ban.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Formulário do Disparo (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          <form onSubmit={handleSubmit} className="p-6 rounded-2xl glass-panel border border-slate-800 space-y-5 text-xs">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-sm flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-400" /> Nova Campanha de Disparo
              </h3>
              <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" /> Meta Compliance Active
              </span>
            </div>

            {/* Título da Campanha */}
            <div className="space-y-1">
              <label className="font-semibold text-slate-300">Título Identificador da Campanha</label>
              <input
                type="text"
                required
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Ex: Lançamento Coleção Outono / Promoção VIP"
                className="w-full px-3.5 py-2.5 rounded-xl glass-input text-white"
              />
            </div>

            {/* Categoria Alvo */}
            <div className="space-y-1">
              <label className="font-semibold text-slate-300">Filtrar Público-Alvo por Categoria</label>
              <select
                value={form.categoryFilter}
                onChange={(e) => setForm({ ...form, categoryFilter: e.target.value })}
                className="w-full px-3.5 py-2.5 rounded-xl glass-input text-white bg-slate-900"
              >
                <option value="TODOS">Todas as Categorias (Todos os leads com Opt-in)</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.name}>{cat.name}</option>
                ))}
              </select>
            </div>

            {/* Editor de Mensagem com Variáveis */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="font-semibold text-slate-300">Conteúdo da Mensagem</label>
                <div className="flex items-center gap-1 text-[10px]">
                  <span className="text-slate-400">Inserir Tag:</span>
                  <button
                    type="button"
                    onClick={() => handleInsertPlaceholder('{nome}')}
                    className="px-2 py-0.5 rounded bg-slate-800 text-emerald-400 hover:bg-slate-700 font-mono"
                  >
                    {'{nome}'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInsertPlaceholder('{categoria}')}
                    className="px-2 py-0.5 rounded bg-slate-800 text-teal-400 hover:bg-slate-700 font-mono"
                  >
                    {'{categoria}'}
                  </button>
                </div>
              </div>
              <textarea
                rows="4"
                required
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                placeholder="Escreva sua mensagem aqui..."
                className="w-full px-3.5 py-2.5 rounded-xl glass-input text-white resize-none"
              ></textarea>
            </div>

            {/* Configuração de Pacing Anti-Ban */}
            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-amber-400" /> Intervalo de Pacing Anti-Ban (Atraso entre envios)
                </span>
                <span className="font-bold text-emerald-400 font-mono">{form.pacingSeconds} segundos</span>
              </div>
              <input
                type="range"
                min="5"
                max="30"
                step="1"
                value={form.pacingSeconds}
                onChange={(e) => setForm({ ...form, pacingSeconds: parseInt(e.target.value) })}
                className="w-full accent-emerald-500 cursor-pointer"
              />
              <p className="text-[10px] text-slate-400">
                Garante variação humanizada entre cada mensagem disparada para proteger o número contra detecção de bot pelo WhatsApp.
              </p>
            </div>

            {/* Card de Validação de Audiência */}
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Users className="w-5 h-5 text-emerald-400" />
                <div>
                  <p className="font-bold text-white text-xs">Leads Elegíveis (Opt-in Confirmado)</p>
                  <p className="text-[10px] text-emerald-300/80">Esta mensagem será enviada somente para contatos autorizados.</p>
                </div>
              </div>
              <span className="text-xl font-bold text-emerald-400 font-mono">
                {eligibleLeads.length} leads
              </span>
            </div>

            {/* Feedback */}
            {resultFeedback && (
              <div className="p-3 rounded-xl bg-emerald-500/20 border border-emerald-500 text-emerald-300 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> {resultFeedback}
              </div>
            )}

            <div className="pt-2 flex justify-end">
              <button
                type="submit"
                disabled={isDispatching || eligibleLeads.length === 0}
                className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-xs shadow-lg transition-all ${
                  isDispatching || eligibleLeads.length === 0
                    ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                    : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-emerald-500/20'
                }`}
              >
                {isDispatching ? (
                  <>Disparando Lote...</>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-slate-950" /> Iniciar Disparo para {eligibleLeads.length} Leads
                  </>
                )}
              </button>
            </div>
          </form>
        </div>

        {/* Painel Direito: Histórico de Campanhas (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="p-6 rounded-2xl glass-panel border border-slate-800 space-y-4">
            <h3 className="font-bold text-white text-sm flex items-center gap-2 border-b border-slate-800 pb-3">
              <History className="w-4 h-4 text-emerald-400" /> Histórico de Disparos Efetuados
            </h3>

            <div className="space-y-3">
              {campaigns.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-6">Nenhuma campanha realizada ainda.</p>
              ) : (
                campaigns.map((camp) => (
                  <div key={camp.id} className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2 text-xs">
                    <div className="flex items-center justify-between font-bold text-white">
                      <span>{camp.title}</span>
                      <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px]">
                        {camp.status}
                      </span>
                    </div>

                    <p className="text-[11px] text-slate-300 line-clamp-2 italic">
                      "{camp.message}"
                    </p>

                    <div className="flex items-center justify-between text-[10px] text-slate-400 pt-2 border-t border-slate-800/60">
                      <span>Alvo: {camp.category_filter || camp.categoryFilter || 'TODOS'}</span>
                      <span className="font-semibold text-emerald-400">
                        {camp.sent_count ?? camp.sentCount ?? 0} / {camp.total_target ?? camp.totalTarget ?? 0} entregues
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
