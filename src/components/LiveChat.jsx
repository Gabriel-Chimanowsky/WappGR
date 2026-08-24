import React, { useState, useEffect, useRef } from 'react';
import { 
  MessageSquare, 
  Send, 
  ShieldCheck, 
  UserX, 
  Search, 
  User, 
  Bot, 
  Clock, 
  Check, 
  CheckCheck,
  Loader2
} from 'lucide-react';

export default function LiveChat({ leads, messages, onSendMessage }) {
  const [selectedLeadId, setSelectedLeadId] = useState(leads[0]?.id || null);
  const [inputText, setInputText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [localMessages, setLocalMessages] = useState([]);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Keep selected lead valid
  useEffect(() => {
    if (!selectedLeadId && leads.length > 0) {
      setSelectedLeadId(leads[0].id);
    }
  }, [leads, selectedLeadId]);

  const selectedLead = leads.find(l => l.id === selectedLeadId) || leads[0];

  // Clear local pending messages when server messages arrive
  useEffect(() => {
    setLocalMessages([]);
  }, [messages]);

  const serverMessages = messages
    .filter(m => 
      (m.lead_id || m.leadId) === selectedLeadId || 
      (m.lead_phone || m.leadPhone) === selectedLead?.phone
    )
    .slice()
    .reverse();

  // Merge server messages with local optimistic messages
  const leadMessages = [...serverMessages, ...localMessages];

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [leadMessages.length, selectedLeadId]);

  const filteredLeads = leads.filter(l => 
    (l.name || '').toLowerCase().includes(searchQuery.toLowerCase()) || 
    (l.phone || '').includes(searchQuery)
  );

  const handleSend = async (e) => {
    e.preventDefault();
    if (!inputText.trim() || !selectedLeadId || isSending) return;

    const textToSend = inputText.trim();
    setInputText('');

    // Instant local optimistic message
    const tempMsg = {
      id: 'temp-' + Date.now(),
      lead_id: selectedLeadId,
      direction: 'OUTBOUND',
      text: textToSend,
      type: 'DIRECT_CHAT',
      timestamp: new Date().toISOString(),
      pending: true
    };
    setLocalMessages(prev => [...prev, tempMsg]);
    setIsSending(true);

    try {
      await onSendMessage(selectedLeadId, textToSend);
    } finally {
      setIsSending(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  return (
    <div className="p-8 h-[calc(100vh-4rem)] max-w-7xl mx-auto flex gap-6">
      {/* Lista de Contatos Esquerda */}
      <div className="w-80 glass-panel border border-slate-800 rounded-2xl flex flex-col overflow-hidden flex-shrink-0">
        <div className="p-4 border-b border-slate-800 space-y-3">
          <h3 className="font-bold text-white text-sm flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-emerald-400" /> Conversas WhatsApp
          </h3>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar contato..."
              className="w-full pl-9 pr-3 py-1.5 rounded-xl glass-input text-xs text-white"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60">
          {filteredLeads.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              Nenhum contato encontrado.
            </div>
          ) : (
            filteredLeads.map((lead) => {
              const isSelected = lead.id === selectedLeadId;
              return (
                <div
                  key={lead.id}
                  onClick={() => setSelectedLeadId(lead.id)}
                  className={`p-3.5 cursor-pointer transition-all flex items-center gap-3 ${
                    isSelected ? 'bg-emerald-500/10 border-l-4 border-emerald-500' : 'hover:bg-slate-900/40'
                  }`}
                >
                  <div className="w-10 h-10 rounded-full bg-slate-800 text-slate-200 flex items-center justify-center font-bold text-xs flex-shrink-0">
                    {(lead.name || 'W').substring(0, 2).toUpperCase()}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold text-white truncate">{lead.name}</p>
                      {lead.status === 'OPT_IN' && <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />}
                      {lead.status === 'OPT_OUT' && <UserX className="w-3.5 h-3.5 text-rose-400 flex-shrink-0" />}
                    </div>
                    <p className="text-[10px] text-slate-400 truncate font-mono">+{lead.phone}</p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Janela de Conversa Direita */}
      <div className="flex-1 glass-panel border border-slate-800 rounded-2xl flex flex-col overflow-hidden">
        {selectedLead ? (
          <>
            {/* Chat Header */}
            <div className="p-4 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs">
                  {(selectedLead.name || 'W').substring(0, 2).toUpperCase()}
                </div>
                <div>
                  <h3 className="font-bold text-white text-sm">{selectedLead.name}</h3>
                  <p className="text-[10px] text-slate-400 flex items-center gap-2">
                    <span className="font-mono">+{selectedLead.phone}</span>
                    <span>•</span>
                    <span className="text-emerald-400 font-semibold">{selectedLead.category_name || selectedLead.category || 'Geral'}</span>
                  </p>
                </div>
              </div>

              <div>
                {selectedLead.status === 'OPT_IN' ? (
                  <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5" /> Opt-in Ativo
                  </span>
                ) : selectedLead.status === 'OPT_OUT' ? (
                  <span className="px-3 py-1 rounded-full text-xs font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center gap-1">
                    <UserX className="w-3.5 h-3.5" /> Bloqueado / Opt-out
                  </span>
                ) : (
                  <span className="px-3 py-1 rounded-full text-xs font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" /> Aguardando Consentimento
                  </span>
                )}
              </div>
            </div>

            {/* Chat Body */}
            <div className="flex-1 p-6 overflow-y-auto space-y-3 bg-slate-950/40">
              {leadMessages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 text-xs">
                  <Clock className="w-8 h-8 opacity-40 mb-2" />
                  Nenhuma mensagem trocada com este contato ainda.
                </div>
              ) : (
                leadMessages.map((msg) => {
                  const isOutbound = msg.direction === 'OUTBOUND';
                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${isOutbound ? 'items-end' : 'items-start'}`}
                    >
                      <div
                        className={`max-w-[70%] px-4 py-2.5 rounded-2xl text-xs shadow-md ${
                          isOutbound
                            ? 'bg-emerald-600 text-white rounded-br-none'
                            : 'bg-slate-800 text-slate-200 border border-slate-700 rounded-bl-none'
                        }`}
                      >
                        <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                        <div className="flex items-center justify-end gap-1.5 mt-1 opacity-75 text-[9px]">
                          <span>{msg.type || 'CHAT'}</span>
                          <span>•</span>
                          <span>
                            {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                          </span>
                          {isOutbound && (
                            msg.pending ? (
                              <Loader2 className="w-3 h-3 text-emerald-200 animate-spin" />
                            ) : (
                              <CheckCheck className="w-3 h-3 text-emerald-200" />
                            )
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Chat Input Footer */}
            <form onSubmit={handleSend} className="p-3 bg-slate-900 border-t border-slate-800 flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={`Enviar mensagem no WhatsApp para ${selectedLead.name}...`}
                className="flex-1 px-4 py-2.5 rounded-xl glass-input text-xs text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
              <button
                type="submit"
                disabled={isSending || !inputText.trim()}
                className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-2 shadow-lg shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {isSending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                {isSending ? 'Enviando...' : 'Enviar'}
              </button>
            </form>
          </>
        ) : (
          <div className="h-full flex items-center justify-center text-slate-500 text-xs">
            Selecione um contato ao lado para visualizar a conversa.
          </div>
        )}
      </div>
    </div>
  );
}
