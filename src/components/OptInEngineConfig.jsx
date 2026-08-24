import React, { useState } from 'react';
import { 
  ShieldCheck, 
  MessageSquare, 
  CheckCircle2, 
  UserX, 
  Sparkles, 
  Send, 
  Smartphone, 
  Settings, 
  Save, 
  Bot,
  AlertTriangle,
  RotateCcw
} from 'lucide-react';

export default function OptInEngineConfig({ optInConfig, onSaveConfig, onSimulateMessage }) {
  const [configForm, setConfigForm] = useState(optInConfig || {
    autoOptInOnFirstMessage: true,
    welcomeMessage: 'Olá! 👋 Seja bem-vindo à nossa central de novidades. Para receber nossas ofertas exclusivas, responda 1 ou SIM. Se não quiser, responda SAIR.',
    confirmationMessage: 'Perfeito! 🎉 Seu cadastro foi ativado. Você agora receberá nossas novidades e promoções com total segurança.',
    optOutMessage: 'Entendido! 👍 Você foi removido da nossa lista e não receberá mais mensagens automáticas.',
    yesKeywords: ['SIM', 'QUERO', '1', 'ACEITO'],
    noKeywords: ['SAIR', 'PARAR', 'CANCELAR', '2']
  });

  const [yesInput, setYesInput] = useState((configForm.yesKeywords || []).join(', '));
  const [noInput, setNoInput] = useState((configForm.noKeywords || []).join(', '));
  const [isSaved, setIsSaved] = useState(false);

  // Simulation State (Live Interactive Mobile Preview)
  const [simPhone, setSimPhone] = useState('5511988776655');
  const [simName, setSimName] = useState('Cliente Teste (WhatsApp)');
  const [simMessageInput, setSimMessageInput] = useState('SIM');
  const [simChatLogs, setSimChatLogs] = useState([
    {
      sender: 'SYSTEM',
      text: 'Olá! 👋 Para receber nossas promoções e novidades diretamente no WhatsApp, responda SIM ou 1. Para recusar, responda SAIR.',
      time: '12:00'
    }
  ]);
  const [simStatusResult, setSimStatusResult] = useState(null);

  const handleSaveSubmit = (e) => {
    e.preventDefault();
    const updated = {
      ...configForm,
      yesKeywords: yesInput.split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
      noKeywords: noInput.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
    };
    onSaveConfig(updated);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  const handleSimulateSend = async (e) => {
    e.preventDefault();
    if (!simMessageInput) return;

    const userMsg = {
      sender: 'USER',
      text: simMessageInput,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setSimChatLogs(prev => [...prev, userMsg]);
    const currentInput = simMessageInput;
    setSimMessageInput('');

    // Call simulated backend endpoint
    const result = await onSimulateMessage(simPhone, currentInput, simName);

    if (result && result.replyText) {
      setSimChatLogs(prev => [...prev, {
        sender: 'BOT',
        text: result.replyText,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }]);
    }

    setSimStatusResult(result);
  };

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-emerald-400" />
          Motor de Opt-in & Conformidade Anti-Ban
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Configure a mensagem automática de consentimento e teste a alternância em tempo real com o simulador de celular.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Painel Esquerdo: Configurações de Regras (7 Cols) */}
        <div className="lg:col-span-7 space-y-6">
          <form onSubmit={handleSaveSubmit} className="p-6 rounded-2xl glass-panel border border-slate-800 space-y-5 text-xs">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-sm flex items-center gap-2">
                <Settings className="w-4 h-4 text-emerald-400" /> Mensagens & Palavras-Chave de Aceite
              </h3>
              {isSaved && (
                <span className="text-[11px] text-emerald-400 flex items-center gap-1 font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Salvo com sucesso!
                </span>
              )}
            </div>

            {/* Auto Opt-in Toggle */}
            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-between">
              <div>
                <p className="font-semibold text-slate-200">Solicitar Opt-in no 1º Contato</p>
                <p className="text-[10px] text-slate-400">Envia automaticamente a mensagem de consentimento se o lead não estiver cadastrado.</p>
              </div>
              <input
                type="checkbox"
                checked={configForm.autoOptInOnFirstMessage}
                onChange={(e) => setConfigForm({ ...configForm, autoOptInOnFirstMessage: e.target.checked })}
                className="w-5 h-5 accent-emerald-500 rounded cursor-pointer"
              />
            </div>

            {/* Mensagem de Boas-Vindas */}
            <div className="space-y-1.5">
              <label className="font-semibold text-slate-300">Mensagem de Solicitação de Permissão (Boas-vindas)</label>
              <textarea
                rows="3"
                value={configForm.welcomeMessage}
                onChange={(e) => setConfigForm({ ...configForm, welcomeMessage: e.target.value })}
                className="w-full px-3.5 py-2.5 rounded-xl glass-input text-white resize-none"
              ></textarea>
            </div>

            {/* Mensagem de Confirmação de Opt-in */}
            <div className="space-y-1.5">
              <label className="font-semibold text-emerald-300">Mensagem de Confirmação (Opt-in Ativado)</label>
              <textarea
                rows="2"
                value={configForm.confirmationMessage}
                onChange={(e) => setConfigForm({ ...configForm, confirmationMessage: e.target.value })}
                className="w-full px-3.5 py-2.5 rounded-xl glass-input text-white border-emerald-500/30 resize-none"
              ></textarea>
            </div>

            {/* Mensagem de Opt-out (Cancelamento) */}
            <div className="space-y-1.5">
              <label className="font-semibold text-rose-300">Mensagem de Remoção (Opt-out / Bloqueio Solicitado)</label>
              <textarea
                rows="2"
                value={configForm.optOutMessage}
                onChange={(e) => setConfigForm({ ...configForm, optOutMessage: e.target.value })}
                className="w-full px-3.5 py-2.5 rounded-xl glass-input text-white border-rose-500/30 resize-none"
              ></textarea>
            </div>

            {/* Palavras-Chave de Aceite e Recusa */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="font-semibold text-emerald-400">Palavras de Aceite (Separadas por vírgula)</label>
                <input
                  type="text"
                  value={yesInput}
                  onChange={(e) => setYesInput(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl glass-input text-white uppercase font-mono"
                  placeholder="SIM, QUERO, 1, ACEITO"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-rose-400">Palavras de Cancelamento / SAIR</label>
                <input
                  type="text"
                  value={noInput}
                  onChange={(e) => setNoInput(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl glass-input text-white uppercase font-mono"
                  placeholder="SAIR, PARAR, CANCELAR, 2"
                />
              </div>
            </div>

            <div className="pt-3 flex justify-end">
              <button
                type="submit"
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold shadow-lg shadow-emerald-500/20"
              >
                <Save className="w-4 h-4" /> Salvar Regras de Opt-in
              </button>
            </div>
          </form>
        </div>

        {/* Painel Direito: Simulador de WhatsApp ao Vivo (5 Cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="p-6 rounded-2xl glass-panel border border-slate-800 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-sm flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-emerald-400" /> Simulador de Interação WhatsApp
              </h3>
              <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold uppercase">
                Ao Vivo
              </span>
            </div>

            <p className="text-xs text-slate-400">
              Digite uma mensagem como <strong className="text-emerald-400">"SIM"</strong> ou <strong className="text-rose-400">"SAIR"</strong> para ver a alteração automática de consentimento do lead!
            </p>

            {/* Visual Phone Wrapper */}
            <div className="w-full max-w-sm mx-auto bg-slate-950 border-4 border-slate-800 rounded-[32px] overflow-hidden shadow-2xl flex flex-col h-[440px]">
              {/* Phone Header */}
              <div className="bg-slate-900 px-4 py-3 border-b border-slate-800 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs">
                  WA
                </div>
                <div className="flex-1">
                  <p className="text-xs font-bold text-white leading-tight">{simName}</p>
                  <p className="text-[10px] text-slate-400">+{simPhone}</p>
                </div>
              </div>

              {/* Chat Body */}
              <div className="flex-1 p-3 overflow-y-auto space-y-2 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:12px_12px]">
                {simChatLogs.map((log, index) => (
                  <div
                    key={index}
                    className={`flex flex-col ${log.sender === 'USER' ? 'items-end' : 'items-start'}`}
                  >
                    <div
                      className={`max-w-[85%] px-3 py-2 rounded-2xl text-xs shadow-md ${
                        log.sender === 'USER'
                          ? 'bg-emerald-600 text-white rounded-br-none'
                          : 'bg-slate-800 text-slate-200 border border-slate-700/60 rounded-bl-none'
                      }`}
                    >
                      {log.text}
                      <span className="block text-[8px] opacity-60 text-right mt-1">{log.time}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Chat Input */}
              <form onSubmit={handleSimulateSend} className="p-2 bg-slate-900 border-t border-slate-800 flex gap-2">
                <input
                  type="text"
                  value={simMessageInput}
                  onChange={(e) => setSimMessageInput(e.target.value)}
                  placeholder="Digite SIM, 1 ou SAIR..."
                  className="flex-1 px-3 py-1.5 rounded-full bg-slate-950 text-xs text-white border border-slate-800 focus:outline-none focus:border-emerald-500"
                />
                <button
                  type="submit"
                  className="p-2 rounded-full bg-emerald-500 text-slate-950 hover:bg-emerald-400 transition-colors"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>

            {/* Simulated Result Feedback Box */}
            {simStatusResult && (
              <div className={`p-3 rounded-xl border text-xs space-y-1 ${
                simStatusResult.actionTaken === 'OPT_IN_ACTIVATED' 
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : simStatusResult.actionTaken === 'OPT_OUT_ACTIVATED'
                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                  : 'bg-slate-900 border-slate-800 text-slate-300'
              }`}>
                <div className="flex items-center justify-between font-bold">
                  <span>Resultado no Banco de Dados:</span>
                  <span className="uppercase text-[10px]">{simStatusResult.actionTaken}</span>
                </div>
                <p className="text-[11px] opacity-90">
                  Lead <strong>{simStatusResult.lead?.name}</strong> teve seu status atualizado para: <strong className="underline">{simStatusResult.lead?.status}</strong>.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
