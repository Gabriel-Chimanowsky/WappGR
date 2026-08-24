import React, { useState, useEffect, useCallback } from 'react';
import { 
  QrCode, 
  Smartphone, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  Power, 
  ShieldCheck, 
  Wifi, 
  Loader2, 
  Sparkles,
  Zap
} from 'lucide-react';

export default function ConnectionManager({ connection, onConnectionAction, onFetchQrCode, onCheckStatus, showToast }) {
  const [qrCodeData, setQrCodeData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [statusChecking, setStatusChecking] = useState(false);

  const fetchLiveStatus = useCallback(async () => {
    try {
      const data = await onCheckStatus();
      if (data?.qr) {
        setQrCodeData(data.qr);
      } else if (data?.status === 'CONNECTED') {
        setQrCodeData(null);
      }
    } catch (e) {}
  }, [onCheckStatus]);

  // Fast polling while not connected to catch QR Code generation & connection state instantly
  useEffect(() => {
    fetchLiveStatus();
    const interval = setInterval(() => {
      if (connection?.status !== 'CONNECTED') {
        fetchLiveStatus();
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [fetchLiveStatus, connection?.status]);

  const handleStartConnection = async () => {
    setLoading(true);
    await onConnectionAction('start');
    showToast('Inicializando WhatsApp Web... O QR Code aparecerá em instantes.');
    setTimeout(async () => {
      await fetchLiveStatus();
      setLoading(false);
    }, 2000);
  };

  const handleLogout = async () => {
    if (!confirm('Tem certeza que deseja desconectar o seu WhatsApp do WappGR?')) return;
    setLoading(true);
    await onConnectionAction('logout');
    setQrCodeData(null);
    showToast('WhatsApp desconectado com sucesso.', 'warning');
    setTimeout(() => {
      fetchLiveStatus();
      setLoading(false);
    }, 1500);
  };

  const isConnected = connection?.status === 'CONNECTED';
  const isPairing = connection?.status === 'PAIRING' || qrCodeData !== null;

  return (
    <div className="p-8 space-y-8 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
          <Smartphone className="w-5 h-5 text-emerald-400" />
          Conexão WhatsApp Web Direta (100% Nativo)
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Pareie seu WhatsApp Pessoal ou Business diretamente escaneando o QR Code na tela. Sem necessidade de Docker ou serviços externos.
        </p>
      </div>

      {/* Status Banner */}
      <div className={`p-5 rounded-2xl border flex items-center justify-between transition-all ${
        isConnected ? 'glass-card border-emerald-500/30 bg-emerald-500/5 shadow-lg shadow-emerald-500/10' :
        isPairing ? 'glass-card border-amber-500/30 bg-amber-500/5' :
        'glass-card border-slate-800'
      }`}>
        <div className="flex items-center gap-3.5">
          <div className={`p-3 rounded-xl ${
            isConnected ? 'bg-emerald-500/20 text-emerald-400' :
            isPairing ? 'bg-amber-500/20 text-amber-400' :
            'bg-slate-800 text-slate-400'
          }`}>
            <Wifi className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${
                isConnected ? 'bg-emerald-400 animate-pulse' :
                isPairing ? 'bg-amber-400 animate-ping' :
                'bg-slate-600'
              }`}></span>
              <p className="text-sm font-bold text-white">
                {isConnected ? 'WhatsApp Online & Conectado' :
                 isPairing ? 'Aguardando Leitura do QR Code...' :
                 'WhatsApp Desconectado'}
              </p>
            </div>
            <p className="text-xs text-slate-400 mt-0.5 font-mono">
              {isConnected ? `Número: +${connection?.phone || ''} (${connection?.profile_name || 'Perfil'})` :
               'Engine Nativo Baileys pronto para envio e recepção real'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button 
            onClick={async () => {
              setStatusChecking(true);
              await fetchLiveStatus();
              setStatusChecking(false);
              showToast('Status atualizado!');
            }}
            disabled={statusChecking}
            className="px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 text-xs font-semibold flex items-center gap-1.5 transition-all"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${statusChecking ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>
      </div>

      {/* Main Connection Card */}
      <div className="p-8 rounded-2xl glass-panel border border-slate-800 space-y-6">
        <div className="flex flex-col md:flex-row items-center gap-8 justify-center">
          {/* Display QR Code */}
          <div className="flex-shrink-0 text-center space-y-4">
            <div className="w-64 h-64 rounded-2xl bg-white flex items-center justify-center shadow-2xl border-4 border-slate-800 overflow-hidden relative">
              {loading ? (
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="w-10 h-10 text-emerald-600 animate-spin" />
                  <p className="text-xs text-slate-700 font-bold">Inicializando WhatsApp...</p>
                </div>
              ) : isConnected ? (
                <div className="w-full h-full bg-slate-950 p-6 flex flex-col items-center justify-center text-center space-y-3">
                  <div className="w-16 h-16 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                    <CheckCircle2 className="w-10 h-10" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white">{connection?.profile_name || 'WhatsApp'}</p>
                    <p className="text-xs text-emerald-400 font-mono">+{connection?.phone}</p>
                  </div>
                  <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold">
                    Sessão Ativa
                  </span>
                </div>
              ) : qrCodeData ? (
                <img 
                  src={qrCodeData} 
                  alt="WhatsApp QR Code Real"
                  className="w-full h-full object-contain p-2"
                />
              ) : (
                <div className="flex flex-col items-center gap-3 p-4 text-center">
                  <QrCode className="w-12 h-12 text-slate-400" />
                  <p className="text-xs text-slate-600 font-medium">Clique no botão abaixo para gerar o QR Code</p>
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex justify-center gap-3">
              {isConnected ? (
                <button
                  onClick={handleLogout}
                  disabled={loading}
                  className="px-5 py-2.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/30 font-bold text-xs flex items-center gap-2 shadow-lg transition-all"
                >
                  <Power className="w-4 h-4" /> Desconectar Sessão
                </button>
              ) : (
                <button
                  onClick={handleStartConnection}
                  disabled={loading}
                  className="px-6 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-2 shadow-lg shadow-emerald-500/20 transition-all"
                >
                  <Zap className="w-4 h-4 fill-slate-950" />
                  {qrCodeData ? 'Gerar Novo QR Code' : 'Conectar & Gerar QR Code'}
                </button>
              )}
            </div>
          </div>

          {/* Passo a Passo de Pareamento */}
          <div className="space-y-4 flex-1 max-w-lg">
            <h3 className="font-bold text-white text-base flex items-center gap-2">
              <Smartphone className="w-5 h-5 text-emerald-400" />
              Como parear seu celular:
            </h3>

            <ol className="space-y-3 text-xs text-slate-300">
              <li className="flex items-start gap-3 p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-[10px] flex-shrink-0">1</span>
                <span>Abra o <strong>WhatsApp</strong> no seu smartphone (Pessoal ou Business).</span>
              </li>
              <li className="flex items-start gap-3 p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-[10px] flex-shrink-0">2</span>
                <span>Acesse <strong>Aparelhos Conectados</strong> no menu de configurações.</span>
              </li>
              <li className="flex items-start gap-3 p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-[10px] flex-shrink-0">3</span>
                <span>Toque em <strong>Conectar um Aparelho</strong> e aponte a câmera para o QR Code ao lado.</span>
              </li>
              <li className="flex items-start gap-3 p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-[10px] flex-shrink-0">4</span>
                <span>A conexão será estabelecida em tempo real. As mensagens e disparos serão feitos diretamente por esta instância.</span>
              </li>
            </ol>

            <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-2.5 text-[11px] text-emerald-300">
              <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span>Sua sessão fica salva localmente na pasta segura <code>server/baileys_auth/</code>.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
