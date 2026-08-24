import React from 'react';
import { 
  LayoutDashboard, 
  QrCode, 
  Users, 
  ShieldCheck, 
  Send, 
  CalendarClock, 
  MessageSquare, 
  Webhook,
  Zap,
  CheckCircle2,
  AlertCircle,
  GitBranch
} from 'lucide-react';

export default function Sidebar({ activeTab, setActiveTab, stats, connection }) {
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'connection', label: 'Conectar WhatsApp', icon: QrCode, badge: connection?.status === 'CONNECTED' ? 'ON' : 'OFF' },
    { id: 'leads', label: 'Gestão de Leads', icon: Users, count: stats?.totalLeads },
    { id: 'flows', label: 'Fluxos & Funis', icon: GitBranch, highlight: true },
    { id: 'optin', label: 'Regras de Opt-in', icon: ShieldCheck },
    { id: 'broadcast', label: 'Disparos em Massa', icon: Send },
    { id: 'scheduler', label: 'Agendador (Cron)', icon: CalendarClock, count: stats?.activeSchedulesCount },
    { id: 'chat', label: 'Chat em Tempo Real', icon: MessageSquare },
    { id: 'crm', label: 'Integração CRM', icon: Webhook }
  ];

  return (
    <aside className="w-64 glass-panel border-r border-slate-800/80 flex flex-col justify-between h-screen sticky top-0 z-30">
      <div>
        {/* Logo WappGR */}
        <div className="p-6 border-b border-slate-800/60 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 p-0.5 shadow-lg shadow-emerald-500/20">
            <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
              <Zap className="w-5 h-5 text-emerald-400 fill-emerald-400/20" />
            </div>
          </div>
          <div>
            <h1 className="font-bold text-lg text-white tracking-wide flex items-center gap-1.5">
              Wapp<span className="text-emerald-400">GR</span>
            </h1>
            <p className="text-[10px] text-slate-400 font-medium">Wallzap & Lead Opt-in Platform</p>
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="p-3 space-y-1.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-medium transition-all duration-200 ${
                  isActive 
                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shadow-sm' 
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-emerald-400' : 'text-slate-400'}`} />
                  <span>{item.label}</span>
                </div>

                {item.badge && (
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                    item.badge === 'ON' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                  }`}>
                    {item.badge}
                  </span>
                )}

                {item.count !== undefined && item.count !== null && (
                  <span className="text-[10px] px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 font-semibold">
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Connection & Meta Compliance Card */}
      <div className="p-4 border-t border-slate-800/60">
        <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                connection?.status === 'CONNECTED' ? 'bg-emerald-400' : 'bg-amber-400'
              }`}></span>
              <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                connection?.status === 'CONNECTED' ? 'bg-emerald-500' : 'bg-amber-500'
              }`}></span>
            </span>
            <div>
              <p className="text-[11px] font-semibold text-slate-200">
                {connection?.status === 'CONNECTED' ? 'WhatsApp Online' : 'Aguardando QR Code'}
              </p>
              <p className="text-[9px] text-slate-400">
                {connection?.phone || 'Desconectado'}
              </p>
            </div>
          </div>
          {connection?.status === 'CONNECTED' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          ) : (
            <AlertCircle className="w-4 h-4 text-amber-400" />
          )}
        </div>
      </div>
    </aside>
  );
}
