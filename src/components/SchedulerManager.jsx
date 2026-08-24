import React, { useState } from 'react';
import { 
  CalendarClock, 
  Plus, 
  Clock, 
  Repeat, 
  CheckCircle2, 
  Power, 
  Trash2, 
  Calendar,
  Sparkles,
  Layers
} from 'lucide-react';

export default function SchedulerManager({ 
  schedules, 
  categories, 
  onAddSchedule, 
  onToggleSchedule, 
  onDeleteSchedule 
}) {
  const [form, setForm] = useState({
    title: '',
    message: 'Olá {nome}! Não se esqueça de conferir nossas novidades exclusivas de hoje!',
    categoryFilter: 'TODOS',
    recurrence: 'DAILY', // 'DAILY' | 'EVERY_OTHER_DAY' | 'SPECIFIC_DAYS'
    timeOfDay: '09:00',
    specificDays: ['MON', 'WED', 'FRI'],
    pacingSeconds: 10
  });

  const [showFormModal, setShowFormModal] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.title || !form.message || !form.timeOfDay) return;
    onAddSchedule(form);
    setShowFormModal(false);
    setForm({
      title: '',
      message: 'Olá {nome}! Não se esqueça de conferir nossas novidades exclusivas de hoje!',
      categoryFilter: 'TODOS',
      recurrence: 'DAILY',
      timeOfDay: '09:00',
      specificDays: ['MON', 'WED', 'FRI'],
      pacingSeconds: 10
    });
  };

  const handleDayToggle = (dayCode) => {
    setForm(prev => {
      const exists = prev.specificDays.includes(dayCode);
      return {
        ...prev,
        specificDays: exists 
          ? prev.specificDays.filter(d => d !== dayCode)
          : [...prev.specificDays, dayCode]
      };
    });
  };

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-purple-400" />
            Agendador Inteligente de Disparos Recorrentes
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Programe envios automáticos todo dia, dia sim/dia não, ou em dias selecionados da semana em horários fixos.
          </p>
        </div>

        <button
          onClick={() => setShowFormModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold shadow-lg shadow-purple-500/20 transition-all"
        >
          <Plus className="w-4 h-4" />
          Novo Agendamento Recorrente
        </button>
      </div>

      {/* Grid de Agendamentos Ativos */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {schedules.map((sched) => (
          <div 
            key={sched.id}
            className={`p-5 rounded-2xl glass-card border transition-all space-y-4 flex flex-col justify-between ${
              sched.active ? 'border-purple-500/30 bg-purple-500/5' : 'border-slate-800 opacity-60'
            }`}
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30 flex items-center gap-1">
                  <Repeat className="w-3 h-3" />
                  {sched.recurrence === 'DAILY' ? 'Todo dia' :
                   sched.recurrence === 'EVERY_OTHER_DAY' ? 'Dia sim / Dia não' : 'Dias Específicos'}
                </span>

                <button
                  onClick={() => onToggleSchedule(sched.id)}
                  className={`p-1.5 rounded-lg border transition-colors ${
                    sched.active 
                      ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400' 
                      : 'bg-slate-800 border-slate-700 text-slate-400'
                  }`}
                  title={sched.active ? 'Desativar Agendamento' : 'Ativar Agendamento'}
                >
                  <Power className="w-4 h-4" />
                </button>
              </div>

              <h3 className="font-bold text-white text-sm">{sched.title}</h3>
              <p className="text-xs text-slate-300 line-clamp-2 italic">
                "{sched.message}"
              </p>
            </div>

            <div className="space-y-2 pt-3 border-t border-slate-800/80 text-xs text-slate-400">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-slate-300">
                  <Clock className="w-3.5 h-3.5 text-purple-400" /> Horário Fixo:
                </span>
                <span className="font-bold text-white font-mono">{sched.time_of_day || sched.timeOfDay}h</span>
              </div>

              <div className="flex items-center justify-between text-[11px]">
                <span>Público Alvo:</span>
                <span className="font-semibold text-slate-200">{sched.category_filter || sched.categoryFilter || 'TODOS'}</span>
              </div>

              <div className="flex items-center justify-between pt-2">
                <span className="text-[10px] text-slate-500">
                  Status: {Boolean(sched.active) ? 'Ativo na fila Cron' : 'Pausado'}
                </span>
                <button
                  onClick={() => onDeleteSchedule(sched.id)}
                  className="text-slate-500 hover:text-rose-400 p-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Modal Criar Agendamento */}
      {showFormModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="p-6 rounded-2xl glass-panel border border-slate-800 w-full max-w-lg space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-base flex items-center gap-2">
                <CalendarClock className="w-5 h-5 text-purple-400" /> Criar Regra de Agendamento Recorrente
              </h3>
              <button onClick={() => setShowFormModal(false)} className="text-slate-400 hover:text-white">
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-slate-300">Título da Automação</label>
                <input
                  type="text"
                  required
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Ex: Bom dia VIPs 09:00"
                  className="w-full px-3.5 py-2.5 rounded-xl glass-input text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Padrão de Recorrência</label>
                  <select
                    value={form.recurrence}
                    onChange={(e) => setForm({ ...form, recurrence: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl glass-input text-white bg-slate-900"
                  >
                    <option value="DAILY">Todo Dia (Diário)</option>
                    <option value="EVERY_OTHER_DAY">Dia Sim / Dia Não (Alternado)</option>
                    <option value="SPECIFIC_DAYS">Dias Específicos da Semana</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Horário do Disparo</label>
                  <input
                    type="time"
                    required
                    value={form.timeOfDay}
                    onChange={(e) => setForm({ ...form, timeOfDay: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl glass-input text-white font-mono"
                  />
                </div>
              </div>

              {/* Dias Específicos Selector */}
              {form.recurrence === 'SPECIFIC_DAYS' && (
                <div className="space-y-1.5">
                  <label className="font-semibold text-slate-300">Selecione os Dias da Semana</label>
                  <div className="flex gap-1.5">
                    {[
                      { code: 'MON', label: 'Seg' },
                      { code: 'TUE', label: 'Ter' },
                      { code: 'WED', label: 'Qua' },
                      { code: 'THU', label: 'Qui' },
                      { code: 'FRI', label: 'Sex' },
                      { code: 'SAT', label: 'Sáb' },
                      { code: 'SUN', label: 'Dom' }
                    ].map((day) => {
                      const selected = form.specificDays.includes(day.code);
                      return (
                        <button
                          key={day.code}
                          type="button"
                          onClick={() => handleDayToggle(day.code)}
                          className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                            selected
                              ? 'bg-purple-600 text-white'
                              : 'bg-slate-900 border border-slate-800 text-slate-400'
                          }`}
                        >
                          {day.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <label className="font-semibold text-slate-300">Categoria de Leads Destino</label>
                <select
                  value={form.categoryFilter}
                  onChange={(e) => setForm({ ...form, categoryFilter: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl glass-input text-white bg-slate-900"
                >
                  <option value="TODOS">Todas as Categorias (Com Opt-in)</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-300">Mensagem da Recorrência</label>
                <textarea
                  rows="3"
                  required
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl glass-input text-white resize-none"
                ></textarea>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowFormModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-900 text-slate-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold shadow-lg shadow-purple-500/20"
                >
                  Salvar Regra Cron
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
