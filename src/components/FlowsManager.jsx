import React, { useState } from 'react';
import { 
  GitBranch, 
  Plus, 
  Play, 
  Trash2, 
  Edit3, 
  Save, 
  X, 
  Check, 
  AlertCircle, 
  MessageSquare, 
  Image as ImageIcon, 
  Mic, 
  Video, 
  Clock, 
  Tag, 
  Layers, 
  ArrowRight, 
  Sparkles,
  ToggleLeft,
  ToggleRight,
  ExternalLink,
  ChevronRight,
  CornerDownRight,
  Smartphone,
  ShieldCheck
} from 'lucide-react';

export default function FlowsManager({ 
  flows, 
  categories, 
  leads, 
  onSaveFlow, 
  onToggleFlow, 
  onDeleteFlow, 
  onTriggerLeadFlow,
  showToast 
}) {
  const [editingFlow, setEditingFlow] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [testModalFlow, setTestModalFlow] = useState(null);
  const [testLeadId, setTestLeadId] = useState(leads[0]?.id || '');
  const [deleteConfirmFlow, setDeleteConfirmFlow] = useState(null);

  // Initial template for creating a new flow
  const handleStartCreateFlow = () => {
    setEditingFlow({
      id: null,
      name: 'Novo Fluxo de Conversação',
      trigger_type: 'KEYWORD',
      trigger_keywords: 'QUERO, VER, CATALOGO, OFERTA, PLANOS',
      description: 'Funil automático acionado quando o lead responde ao disparo',
      active: 1,
      steps: [
        {
          id: 'step_1',
          title: 'Mensagem Inicial & Opções',
          type: 'TEXT',
          content: 'Olá {nome}! 👋 Que ótimo falar com você. Como podemos te ajudar hoje?',
          delaySeconds: 1,
          changeCategory: '',
          options: [
            { id: 'opt_1', label: 'Ver Produtos / Catálogo', keyword: '1', nextStepId: 'step_2' },
            { id: 'opt_2', label: 'Falar com Especialista', keyword: '2', nextStepId: 'step_3' }
          ]
        },
        {
          id: 'step_2',
          title: 'Envio do Catálogo',
          type: 'IMAGE',
          mediaUrl: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800&auto=format&fit=crop&q=80',
          content: 'Aqui está nosso catálogo de novidades com preços exclusivos! ✨\n\nDeseja falar com alguém da nossa equipe?',
          delaySeconds: 2,
          changeCategory: 'Interessados',
          options: [
            { id: 'opt_2_1', label: 'Falar com Atendente', keyword: '1', nextStepId: 'step_3' }
          ]
        },
        {
          id: 'step_3',
          title: 'Encaminhamento Humano',
          type: 'TEXT',
          content: 'Combinado! 👤 Nossa equipe já foi notificada e vai te responder aqui mesmo.',
          delaySeconds: 1,
          changeCategory: 'Clientes VIP',
          options: []
        }
      ]
    });
    setIsCreating(true);
  };

  const handleAddStep = () => {
    if (!editingFlow) return;
    const newStepId = `step_${Date.now()}`;
    const newStep = {
      id: newStepId,
      title: `Etapa ${editingFlow.steps.length + 1}`,
      type: 'TEXT',
      mediaUrl: '',
      content: 'Mensagem da etapa...',
      delaySeconds: 1,
      changeCategory: '',
      options: []
    };
    setEditingFlow({
      ...editingFlow,
      steps: [...editingFlow.steps, newStep]
    });
  };

  const handleUpdateStep = (stepIndex, field, value) => {
    if (!editingFlow) return;
    const updatedSteps = [...editingFlow.steps];
    updatedSteps[stepIndex] = {
      ...updatedSteps[stepIndex],
      [field]: value
    };
    setEditingFlow({
      ...editingFlow,
      steps: updatedSteps
    });
  };

  const handleRemoveStep = (stepIndex) => {
    if (!editingFlow || editingFlow.steps.length <= 1) {
      showToast('O fluxo deve ter pelo menos uma etapa.', 'warning');
      return;
    }
    const updatedSteps = editingFlow.steps.filter((_, idx) => idx !== stepIndex);
    setEditingFlow({
      ...editingFlow,
      steps: updatedSteps
    });
  };

  const handleAddOptionToStep = (stepIndex) => {
    if (!editingFlow) return;
    const updatedSteps = [...editingFlow.steps];
    const currentStep = updatedSteps[stepIndex];
    const currentOptions = currentStep.options || [];
    const newOpt = {
      id: `opt_${Date.now()}`,
      label: `Opção ${currentOptions.length + 1}`,
      keyword: String(currentOptions.length + 1),
      nextStepId: editingFlow.steps[stepIndex + 1]?.id || ''
    };
    updatedSteps[stepIndex] = {
      ...currentStep,
      options: [...currentOptions, newOpt]
    };
    setEditingFlow({ ...editingFlow, steps: updatedSteps });
  };

  const handleUpdateOption = (stepIndex, optIndex, field, value) => {
    if (!editingFlow) return;
    const updatedSteps = [...editingFlow.steps];
    const options = [...updatedSteps[stepIndex].options];
    options[optIndex] = { ...options[optIndex], [field]: value };
    updatedSteps[stepIndex].options = options;
    setEditingFlow({ ...editingFlow, steps: updatedSteps });
  };

  const handleRemoveOption = (stepIndex, optIndex) => {
    if (!editingFlow) return;
    const updatedSteps = [...editingFlow.steps];
    updatedSteps[stepIndex].options = updatedSteps[stepIndex].options.filter((_, idx) => idx !== optIndex);
    setEditingFlow({ ...editingFlow, steps: updatedSteps });
  };

  const handleSaveSubmit = async (e) => {
    e.preventDefault();
    if (!editingFlow.name) {
      showToast('Nome do fluxo é obrigatório.', 'error');
      return;
    }
    await onSaveFlow(editingFlow);
    setEditingFlow(null);
    setIsCreating(false);
  };

  const handleExecuteTest = async () => {
    if (!testLeadId || !testModalFlow) return;
    await onTriggerLeadFlow(testModalFlow.id, testLeadId);
    setTestModalFlow(null);
  };

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-emerald-400" />
            Fluxos & Funis Interativos de Conversação
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Crie jornadas automáticas que respondem disparos com texto, botões de escolha, imagens, vídeos, áudios e troca automática de categorias.
          </p>
        </div>

        <button
          onClick={handleStartCreateFlow}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold shadow-lg shadow-emerald-500/20 transition-all self-start md:self-auto"
        >
          <Plus className="w-4 h-4" />
          Criar Novo Fluxo
        </button>
      </div>

      {/* Lista de Fluxos Cadastrados */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {flows.length === 0 ? (
          <div className="col-span-full p-12 glass-panel border border-slate-800 rounded-2xl text-center space-y-3">
            <GitBranch className="w-10 h-10 text-slate-600 mx-auto" />
            <h3 className="text-sm font-bold text-slate-300">Nenhum fluxo interativo criado ainda</h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Crie seu primeiro funil para que, quando o cliente responder seu disparo em massa, ele receba uma sequência de opções e mídias automaticamente!
            </p>
            <button
              onClick={handleStartCreateFlow}
              className="mt-2 px-4 py-2 rounded-xl bg-emerald-500 text-slate-950 font-bold text-xs"
            >
              Criar Primeiro Fluxo
            </button>
          </div>
        ) : (
          flows.map((flow) => {
            const stepsCount = flow.steps?.length || 0;
            const keywords = (flow.trigger_keywords || '').split(',').map(k => k.trim()).filter(Boolean);

            return (
              <div
                key={flow.id}
                className={`p-5 rounded-2xl glass-panel border transition-all flex flex-col justify-between space-y-4 ${
                  flow.active ? 'border-emerald-500/30 bg-slate-900/60' : 'border-slate-800 bg-slate-950/40 opacity-75'
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <h3 className="font-bold text-white text-sm truncate flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
                        {flow.name}
                      </h3>
                      {flow.description && (
                        <p className="text-xs text-slate-400 line-clamp-2">{flow.description}</p>
                      )}
                    </div>

                    {/* Toggle Active */}
                    <button
                      onClick={() => onToggleFlow(flow.id)}
                      className="text-slate-400 hover:text-emerald-400 flex-shrink-0 transition-colors"
                      title={flow.active ? 'Desativar Fluxo' : 'Ativar Fluxo'}
                    >
                      {flow.active ? (
                        <ToggleRight className="w-7 h-7 text-emerald-400" />
                      ) : (
                        <ToggleLeft className="w-7 h-7 text-slate-600" />
                      )}
                    </button>
                  </div>

                  {/* Badges de Gatilho e Etapas */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="px-2.5 py-0.5 rounded-lg text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700 flex items-center gap-1">
                      <Layers className="w-3 h-3 text-purple-400" /> {stepsCount} {stepsCount === 1 ? 'Etapa' : 'Etapas'}
                    </span>

                    {flow.trigger_type === 'ALL_NEW' ? (
                      <span className="px-2.5 py-0.5 rounded-lg text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                        Todas as Novas Conversas
                      </span>
                    ) : (
                      <span className="px-2.5 py-0.5 rounded-lg text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        Palavras: {keywords.slice(0, 3).join(', ')}{keywords.length > 3 ? '...' : ''}
                      </span>
                    )}

                    {flow.activeSessions > 0 && (
                      <span className="px-2.5 py-0.5 rounded-lg text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        {flow.activeSessions} em andamento
                      </span>
                    )}
                  </div>
                </div>

                {/* Footer Buttons */}
                <div className="pt-3 border-t border-slate-800 flex items-center justify-between gap-2 text-xs">
                  <button
                    onClick={() => {
                      setTestModalFlow(flow);
                      setTestLeadId(leads[0]?.id || '');
                    }}
                    className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-400 font-semibold flex items-center gap-1.5 transition-all"
                  >
                    <Play className="w-3.5 h-3.5" /> Testar no Zap
                  </button>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        setEditingFlow(JSON.parse(JSON.stringify(flow)));
                        setIsCreating(false);
                      }}
                      className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all"
                      title="Editar Fluxo e Etapas"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => setDeleteConfirmFlow(flow)}
                      className="p-2 rounded-xl bg-slate-800 hover:bg-rose-500/20 hover:text-rose-400 text-slate-400 transition-all"
                      title="Excluir Fluxo"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Modal / Editor Completo de Fluxo */}
      {editingFlow && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="my-8 w-full max-w-4xl glass-panel border border-slate-800 rounded-2xl p-6 space-y-6 max-h-[90vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-4 flex-shrink-0">
              <div>
                <h3 className="font-bold text-white text-base flex items-center gap-2">
                  <GitBranch className="w-5 h-5 text-emerald-400" />
                  {isCreating ? 'Novo Funil de Conversação' : `Editando: ${editingFlow.name}`}
                </h3>
                <p className="text-xs text-slate-400">
                  Configure os gatilhos, mensagens, imagens, áudios, vídeos e as opções de botões numéricos.
                </p>
              </div>
              <button onClick={() => setEditingFlow(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Scrollable Body */}
            <form onSubmit={handleSaveSubmit} className="flex-1 overflow-y-auto space-y-6 pr-2">
              {/* 1. Configurações Principais */}
              <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-4 text-xs">
                <h4 className="font-bold text-slate-200 uppercase tracking-wider text-[11px] flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-400" /> Gatilho de Ativação do Fluxo
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-300">Nome do Fluxo</label>
                    <input
                      type="text"
                      required
                      value={editingFlow.name}
                      onChange={(e) => setEditingFlow({ ...editingFlow, name: e.target.value })}
                      placeholder="Ex: Funil de Apresentação de Produtos"
                      className="w-full px-3.5 py-2.5 rounded-xl glass-input text-white"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="font-semibold text-slate-300">Tipo de Gatilho</label>
                    <select
                      value={editingFlow.trigger_type}
                      onChange={(e) => setEditingFlow({ ...editingFlow, trigger_type: e.target.value })}
                      className="w-full px-3.5 py-2.5 rounded-xl glass-input text-white bg-slate-900"
                    >
                      <option value="KEYWORD">Palavras-Chave (Ex: QUERO, VER, 1, OFERTA)</option>
                      <option value="ALL_NEW">Todas as Novas Mensagens / Contatos</option>
                    </select>
                  </div>
                </div>

                {editingFlow.trigger_type === 'KEYWORD' && (
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-300">Palavras-Chave de Ativação (Separadas por vírgula)</label>
                    <input
                      type="text"
                      value={editingFlow.trigger_keywords || ''}
                      onChange={(e) => setEditingFlow({ ...editingFlow, trigger_keywords: e.target.value })}
                      placeholder="Ex: QUERO, VER, CATALOGO, COMPRAR, PLANOS, PROMO"
                      className="w-full px-3.5 py-2.5 rounded-xl glass-input text-white font-mono"
                    />
                    <p className="text-[10px] text-slate-400">
                      Quando o lead responder seu disparo com qualquer uma destas palavras, o fluxo iniciará automaticamente.
                    </p>
                  </div>
                )}

                <div className="space-y-1">
                  <label className="font-semibold text-slate-300">Descrição Interna (Opcional)</label>
                  <input
                    type="text"
                    value={editingFlow.description || ''}
                    onChange={(e) => setEditingFlow({ ...editingFlow, description: e.target.value })}
                    placeholder="Para que serve este fluxo..."
                    className="w-full px-3.5 py-2 rounded-xl glass-input text-white"
                  />
                </div>
              </div>

              {/* 2. Árvore de Etapas / Passos do Fluxo */}
              <div className="space-y-4 text-xs">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-slate-200 uppercase tracking-wider text-[11px] flex items-center gap-2">
                    <Layers className="w-3.5 h-3.5 text-purple-400" /> Etapas do Funil ({editingFlow.steps.length})
                  </h4>

                  <button
                    type="button"
                    onClick={handleAddStep}
                    className="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold flex items-center gap-1.5 text-xs shadow-lg shadow-purple-600/20"
                  >
                    <Plus className="w-3.5 h-3.5" /> Adicionar Etapa
                  </button>
                </div>

                <div className="space-y-4">
                  {editingFlow.steps.map((step, stepIdx) => (
                    <div
                      key={step.id || stepIdx}
                      className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800 space-y-4 relative"
                    >
                      {/* Step Header */}
                      <div className="flex items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs flex-shrink-0">
                            {stepIdx + 1}
                          </span>
                          <input
                            type="text"
                            value={step.title}
                            onChange={(e) => handleUpdateStep(stepIdx, 'title', e.target.value)}
                            placeholder="Título da Etapa"
                            className="bg-transparent font-bold text-white text-xs border-b border-transparent hover:border-slate-700 focus:border-emerald-500 focus:outline-none px-1 py-0.5"
                          />
                        </div>

                        <div className="flex items-center gap-3">
                          {/* Tipo de Mídia */}
                          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
                            {[
                              { type: 'TEXT', label: 'Texto', icon: MessageSquare },
                              { type: 'IMAGE', label: 'Imagem', icon: ImageIcon },
                              { type: 'AUDIO', label: 'Áudio', icon: Mic },
                              { type: 'VIDEO', label: 'Vídeo', icon: Video }
                            ].map((item) => {
                              const Icon = item.icon;
                              const isActive = step.type === item.type;
                              return (
                                <button
                                  type="button"
                                  key={item.type}
                                  onClick={() => handleUpdateStep(stepIdx, 'type', item.type)}
                                  className={`px-2.5 py-1 rounded-lg flex items-center gap-1 text-[11px] font-semibold transition-all ${
                                    isActive
                                      ? 'bg-emerald-500 text-slate-950 shadow-sm'
                                      : 'text-slate-400 hover:text-white'
                                  }`}
                                >
                                  <Icon className="w-3 h-3" />
                                  {item.label}
                                </button>
                              );
                            })}
                          </div>

                          <button
                            type="button"
                            onClick={() => handleRemoveStep(stepIdx)}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                            title="Remover Etapa"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Media URL Input if applicable */}
                      {(step.type === 'IMAGE' || step.type === 'AUDIO' || step.type === 'VIDEO') && (
                        <div className="space-y-1">
                          <label className="font-semibold text-slate-300 flex items-center gap-1.5">
                            <ExternalLink className="w-3.5 h-3.5 text-emerald-400" />
                            URL da Mídia ({step.type === 'IMAGE' ? 'Imagem JPG/PNG' : step.type === 'AUDIO' ? 'Áudio MP3/OGG (Voz)' : 'Vídeo MP4'})
                          </label>
                          <input
                            type="url"
                            value={step.mediaUrl || ''}
                            onChange={(e) => handleUpdateStep(stepIdx, 'mediaUrl', e.target.value)}
                            placeholder="https://exemplo.com/arquivo.mp4"
                            className="w-full px-3.5 py-2 rounded-xl glass-input text-white font-mono text-[11px]"
                          />
                        </div>
                      )}

                      {/* Conteúdo da Mensagem / Legenda */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <label className="font-semibold text-slate-300">
                            {step.type === 'TEXT' ? 'Mensagem de Texto' : 'Legenda / Mensagem de Acompanhamento'}
                          </label>
                          <div className="flex items-center gap-1 text-[10px] text-slate-400">
                            <span>Variáveis:</span>
                            <button
                              type="button"
                              onClick={() => handleUpdateStep(stepIdx, 'content', (step.content || '') + ' {nome}')}
                              className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-emerald-400"
                            >
                              &#123;nome&#125;
                            </button>
                            <button
                              type="button"
                              onClick={() => handleUpdateStep(stepIdx, 'content', (step.content || '') + ' {categoria}')}
                              className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-emerald-400"
                            >
                              &#123;categoria&#125;
                            </button>
                          </div>
                        </div>
                        <textarea
                          rows="3"
                          required
                          value={step.content || ''}
                          onChange={(e) => handleUpdateStep(stepIdx, 'content', e.target.value)}
                          placeholder="Digite a mensagem que o lead receberá..."
                          className="w-full px-3.5 py-2.5 rounded-xl glass-input text-white resize-none"
                        ></textarea>
                      </div>

                      {/* Configurações Adicionais da Etapa: Atraso & Troca de Categoria */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
                        <div className="space-y-1">
                          <label className="font-semibold text-slate-400 flex items-center gap-1.5 text-[11px]">
                            <Clock className="w-3 h-3 text-amber-400" /> Atraso Humano / Digitando...
                          </label>
                          <select
                            value={step.delaySeconds || 1}
                            onChange={(e) => handleUpdateStep(stepIdx, 'delaySeconds', Number(e.target.value))}
                            className="w-full px-3 py-1.5 rounded-lg glass-input text-white bg-slate-900 text-xs"
                          >
                            <option value="0">Sem Atraso (Instantâneo)</option>
                            <option value="1">1 Segundo</option>
                            <option value="2">2 Segundos (Recomendado)</option>
                            <option value="3">3 Segundos</option>
                            <option value="5">5 Segundos</option>
                          </select>
                        </div>

                        <div className="space-y-1">
                          <label className="font-semibold text-slate-400 flex items-center gap-1.5 text-[11px]">
                            <Tag className="w-3 h-3 text-purple-400" /> Mudar Categoria Automaticamente
                          </label>
                          <select
                            value={step.changeCategory || ''}
                            onChange={(e) => handleUpdateStep(stepIdx, 'changeCategory', e.target.value)}
                            className="w-full px-3 py-1.5 rounded-lg glass-input text-white bg-slate-900 text-xs"
                          >
                            <option value="">Não alterar categoria</option>
                            {categories.map(c => (
                              <option key={c.id} value={c.name}>Mover para: {c.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* Botões / Opções Interativas de Resposta */}
                      <div className="space-y-3 pt-2">
                        <div className="flex items-center justify-between">
                          <label className="font-bold text-slate-300 text-xs flex items-center gap-1.5">
                            <CornerDownRight className="w-3.5 h-3.5 text-emerald-400" />
                            Botões de Resposta / Ramificações ({step.options?.length || 0})
                          </label>
                          <button
                            type="button"
                            onClick={() => handleAddOptionToStep(stepIdx)}
                            className="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 text-[11px] font-bold flex items-center gap-1"
                          >
                            <Plus className="w-3 h-3" /> Adicionar Opção
                          </button>
                        </div>

                        {(!step.options || step.options.length === 0) ? (
                          <div className="p-3 rounded-xl bg-slate-950/40 border border-dashed border-slate-800 text-[11px] text-slate-500">
                            Nenhuma opção configurada. O fluxo finalizará nesta etapa (ou continuará se houver mensagem subsequente).
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {step.options.map((opt, optIdx) => (
                              <div
                                key={opt.id || optIdx}
                                className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex flex-col md:flex-row items-center gap-3 text-xs"
                              >
                                <div className="flex-1 w-full space-y-1">
                                  <span className="text-[10px] text-slate-400 font-semibold">Texto do Botão</span>
                                  <input
                                    type="text"
                                    required
                                    value={opt.label}
                                    onChange={(e) => handleUpdateOption(stepIdx, optIdx, 'label', e.target.value)}
                                    placeholder="Ex: Ver Catálogo"
                                    className="w-full px-3 py-1.5 rounded-lg glass-input text-white text-xs"
                                  />
                                </div>

                                <div className="w-full md:w-28 space-y-1">
                                  <span className="text-[10px] text-slate-400 font-semibold">Dígito / Palavra</span>
                                  <input
                                    type="text"
                                    required
                                    value={opt.keyword || String(optIdx + 1)}
                                    onChange={(e) => handleUpdateOption(stepIdx, optIdx, 'keyword', e.target.value)}
                                    placeholder="1"
                                    className="w-full px-3 py-1.5 rounded-lg glass-input text-white font-mono text-center text-xs"
                                  />
                                </div>

                                <div className="w-full md:w-48 space-y-1">
                                  <span className="text-[10px] text-slate-400 font-semibold">Próxima Etapa</span>
                                  <select
                                    value={opt.nextStepId || ''}
                                    onChange={(e) => handleUpdateOption(stepIdx, optIdx, 'nextStepId', e.target.value)}
                                    className="w-full px-3 py-1.5 rounded-lg glass-input text-white bg-slate-900 text-xs"
                                  >
                                    <option value="">Fim do Fluxo</option>
                                    {editingFlow.steps.map((otherStep, otherIdx) => (
                                      <option key={otherStep.id || otherIdx} value={otherStep.id}>
                                        Etapa {otherIdx + 1}: {otherStep.title}
                                      </option>
                                    ))}
                                  </select>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => handleRemoveOption(stepIdx, optIdx)}
                                  className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 mt-4 md:mt-0"
                                  title="Remover Opção"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Modal Footer Buttons */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingFlow(null)}
                  className="px-4 py-2 rounded-xl bg-slate-900 text-slate-300 hover:bg-slate-800 text-xs"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-2 shadow-lg shadow-emerald-500/20"
                >
                  <Save className="w-4 h-4" />
                  Salvar Funil Completo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Testar Fluxo no Zap */}
      {testModalFlow && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="p-6 rounded-2xl glass-panel border border-emerald-500/30 w-full max-w-sm space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-sm flex items-center gap-2">
                <Play className="w-4 h-4 text-emerald-400" /> Testar Fluxo no WhatsApp
              </h3>
              <button onClick={() => setTestModalFlow(null)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-slate-300">
              Escolha um contato para disparar a primeira etapa do fluxo <strong>"{testModalFlow.name}"</strong>:
            </p>

            <div className="space-y-1">
              <label className="font-semibold text-slate-300">Selecione o Lead</label>
              <select
                value={testLeadId}
                onChange={(e) => setTestLeadId(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl glass-input text-white bg-slate-900"
              >
                {leads.map(l => (
                  <option key={l.id} value={l.id}>
                    {l.name} (+{l.phone})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setTestModalFlow(null)}
                className="px-4 py-2 rounded-xl bg-slate-900 text-slate-300 hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                onClick={handleExecuteTest}
                className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold flex items-center gap-1.5"
              >
                <Play className="w-3.5 h-3.5" /> Disparar Teste
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Confirmar Exclusão de Fluxo */}
      {deleteConfirmFlow && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="p-6 rounded-2xl glass-panel border border-rose-500/30 w-full max-w-sm space-y-4 text-xs">
            <div className="flex items-center gap-2 text-rose-400 font-bold text-sm">
              <AlertCircle className="w-5 h-5" /> Confirmar Exclusão
            </div>
            <p className="text-slate-300">
              Tem certeza que deseja excluir o fluxo <strong>"{deleteConfirmFlow.name}"</strong>?
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setDeleteConfirmFlow(null)}
                className="px-4 py-2 rounded-xl bg-slate-900 text-slate-300 hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  onDeleteFlow(deleteConfirmFlow.id);
                  setDeleteConfirmFlow(null);
                }}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
