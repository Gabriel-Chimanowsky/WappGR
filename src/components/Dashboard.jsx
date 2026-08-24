import React from 'react';
import { 
  Users, 
  ShieldCheck, 
  UserX, 
  Send, 
  CalendarClock, 
  Plus, 
  Sparkles,
  ArrowUpRight,
  TrendingUp,
  Clock,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';
import { 
  PieChart, 
  Pie, 
  Cell, 
  ResponsiveContainer, 
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid
} from 'recharts';

export default function Dashboard({ stats, setActiveTab, onOpenSimulateModal }) {
  const pieData = [
    { name: 'Opt-in Confirmado', value: stats?.optedInCount || 0, color: '#10b981' },
    { name: 'Opt-out / Bloqueado', value: stats?.optedOutCount || 0, color: '#f43f5e' },
    { name: 'Aguardando Opt-in', value: stats?.pendingCount || 0, color: '#f59e0b' }
  ];

  const barData = (stats?.dailyStats || []).map(d => {
    const date = new Date(d.day + 'T00:00:00');
    const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    return {
      day: dayNames[date.getDay()] || d.day,
      disparos: d.sent || 0,
      recebidas: d.received || 0
    };
  });

  // If no real data yet, show placeholder
  const hasBarData = barData.length > 0;

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto">
      {/* Banner de Boas-vindas & Ações Rápidas */}
      <div className="p-6 rounded-2xl glass-panel border border-emerald-500/20 bg-gradient-to-r from-slate-900/90 via-slate-900/60 to-emerald-950/30 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative overflow-hidden">
        <div className="space-y-2 z-10">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 uppercase tracking-wider">
              Sistema de Disparos Anti-Ban
            </span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Wapp<span className="text-emerald-400">GR</span> Disparador & Opt-in Engine
          </h1>
          <p className="text-xs text-slate-300 max-w-2xl leading-relaxed">
            Seu canal de envio em massa totalmente em conformidade com as diretrizes da Meta. 
            Envie mensagens de novidades e promoções com alta conversão exclusivamente para quem autorizou.
          </p>
        </div>

        <div className="flex flex-wrap gap-3 z-10">
          <button
            onClick={() => setActiveTab('broadcast')}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-lg shadow-emerald-500/20 transition-all"
          >
            <Send className="w-4 h-4" />
            Novo Disparo em Massa
          </button>

          <button
            onClick={onOpenSimulateModal}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-300 font-semibold text-xs border border-emerald-500/30 transition-all"
          >
            <Sparkles className="w-4 h-4 text-emerald-400" />
            Simular Opt-in WhatsApp
          </button>
        </div>
      </div>

      {/* Grid de Cards Métricos */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Total Leads */}
        <div className="p-5 rounded-2xl glass-card border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Total de Leads</span>
            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4">
            <p className="text-2xl font-bold text-white">{stats?.totalLeads || 0}</p>
            <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
              <TrendingUp className="w-3 h-3 text-emerald-400" /> Base de contatos ativa
            </p>
          </div>
        </div>

        {/* Permitiu Opt-in */}
        <div className="p-5 rounded-2xl glass-card border border-emerald-500/30 bg-emerald-500/5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-emerald-300">Opt-in Confirmado</span>
            <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400">
              <ShieldCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4">
            <p className="text-2xl font-bold text-emerald-400">{stats?.optedInCount || 0}</p>
            <p className="text-[11px] text-emerald-300/80 mt-1">
              {stats?.optInRatePercent || 0}% dos leads autorizaram
            </p>
          </div>
        </div>

        {/* Opt-out / Bloqueou */}
        <div className="p-5 rounded-2xl glass-card border border-rose-500/30 bg-rose-500/5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-rose-300">Opt-out / Bloqueou</span>
            <div className="p-2 rounded-xl bg-rose-500/20 text-rose-400">
              <UserX className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4">
            <p className="text-2xl font-bold text-rose-400">{stats?.optedOutCount || 0}</p>
            <p className="text-[11px] text-rose-300/80 mt-1">
              Recusaram ou enviaram SAIR
            </p>
          </div>
        </div>

        {/* Disparos Enviados */}
        <div className="p-5 rounded-2xl glass-card border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Total Envio em Massa</span>
            <div className="p-2 rounded-xl bg-teal-500/10 text-teal-400">
              <Send className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4">
            <p className="text-2xl font-bold text-white">{stats?.totalBroadcastSent || 0}</p>
            <p className="text-[11px] text-teal-400 mt-1">
              Mensagens entregues sem ban
            </p>
          </div>
        </div>

        {/* Agendamentos Cron */}
        <div className="p-5 rounded-2xl glass-card border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Agendamentos Ativos</span>
            <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400">
              <CalendarClock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4">
            <p className="text-2xl font-bold text-white">{stats?.activeSchedulesCount || 0}</p>
            <p className="text-[11px] text-purple-300 mt-1">
              Disparos recorrentes ativos
            </p>
          </div>
        </div>
      </div>

      {/* Gráficos de Distribuição & Desempenho */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Pie Chart: Status de Consentimento */}
        <div className="p-6 rounded-2xl glass-card border border-slate-800 flex flex-col justify-between">
          <div>
            <h3 className="font-bold text-slate-200 text-sm flex items-center justify-between">
              <span>Status de Consentimento (Opt-in)</span>
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Divisão da base entre quem permitiu, pendentes e cancelados.
            </p>
          </div>

          <div className="h-64 my-2">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', fontSize: '12px' }}
                  itemStyle={{ color: '#e2e8f0' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="space-y-2 border-t border-slate-800/80 pt-4">
            {pieData.map((item) => (
              <div key={item.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }}></span>
                  <span className="text-slate-300">{item.name}</span>
                </div>
                <span className="font-bold text-white">{item.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Bar Chart: Histórico de Disparos */}
        <div className="p-6 rounded-2xl glass-card border border-slate-800 lg:col-span-2 flex flex-col justify-between">
          <div>
            <h3 className="font-bold text-slate-200 text-sm flex items-center justify-between">
              <span>Volume de Disparos & Entregas Recentes</span>
              <TrendingUp className="w-4 h-4 text-emerald-400" />
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Frequência de envio semanal respeitando a cadência inteligente.
            </p>
          </div>

          <div className="h-64 my-4">
            {hasBarData ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="day" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', fontSize: '12px' }}
                />
                <Bar dataKey="disparos" fill="#10b981" radius={[4, 4, 0, 0]} name="Enviadas" />
                <Bar dataKey="recebidas" fill="#0284c7" radius={[4, 4, 0, 0]} name="Recebidas" />
              </BarChart>
            </ResponsiveContainer>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-slate-500 text-xs">
                <TrendingUp className="w-8 h-8 opacity-30 mb-2" />
                <p>Os gráficos aparecerão quando houver disparos registrados.</p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between text-xs text-slate-400 border-t border-slate-800/80 pt-3">
            <span>Taxa média de entrega: <strong className="text-emerald-400">99.4%</strong></span>
            <span>Cadência de Envio: <strong className="text-slate-200">10s-15s aleatório</strong></span>
          </div>
        </div>
      </div>

      {/* Live Activity Feed */}
      <div className="p-6 rounded-2xl glass-card border border-slate-800 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-slate-200 text-sm flex items-center gap-2">
            <Clock className="w-4 h-4 text-emerald-400" />
            Últimas Interações & Registros de Consentimento
          </h3>
          <button 
            onClick={() => setActiveTab('chat')}
            className="text-xs font-semibold text-emerald-400 hover:underline flex items-center gap-1"
          >
            Ver Histórico Completo <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="divide-y divide-slate-800/60">
          {(stats?.recentMessages || []).map((msg) => (
            <div key={msg.id} className="py-3 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-xl text-xs font-bold ${
                  msg.type === 'OPT_OUT' ? 'bg-rose-500/20 text-rose-400' :
                  msg.type === 'BROADCAST' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-blue-500/20 text-blue-400'
                }`}>
                  {msg.type === 'OPT_OUT' ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                </div>
                <div>
                  <p className="text-xs font-semibold text-white">
                    {msg.leadName} <span className="text-slate-400 text-[10px]">({msg.leadPhone})</span>
                  </p>
                  <p className="text-xs text-slate-300 line-clamp-1 max-w-xl">
                    "{msg.text}"
                  </p>
                </div>
              </div>

              <div className="text-right flex-shrink-0">
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                  msg.direction === 'INBOUND' ? 'bg-slate-800 text-slate-300' : 'bg-emerald-500/20 text-emerald-300'
                }`}>
                  {msg.direction}
                </span>
                <p className="text-[10px] text-slate-400 mt-1">
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
