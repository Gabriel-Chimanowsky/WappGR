import React, { useState, useRef } from 'react';
import { 
  Users, 
  Search, 
  Plus, 
  Filter, 
  ShieldCheck, 
  UserX, 
  Clock, 
  Tag, 
  Trash2, 
  X,
  Upload,
  AlertCircle,
  Edit2,
  CheckSquare,
  Square,
  Layers,
  Settings,
  FolderEdit,
  Save,
  Check
} from 'lucide-react';

export default function LeadsManager({ 
  leads, 
  pagination,
  categories, 
  onAddLead, 
  onUpdateLead, 
  onDeleteLead, 
  onAddCategory,
  onUpdateCategory,
  onDeleteCategory,
  onBulkUpdateLeads,
  onBulkDeleteLeads,
  onImportLeads,
  showToast
}) {
  const fileInputRef = useRef(null);
  const [selectedCategory, setSelectedCategory] = useState('TODOS');
  const [selectedStatus, setSelectedStatus] = useState('TODOS');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Selection state for Bulk Actions
  const [selectedLeadIds, setSelectedLeadIds] = useState([]);
  const [bulkCategoryTarget, setBulkCategoryTarget] = useState('');
  const [bulkStatusTarget, setBulkStatusTarget] = useState('');

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [showCatModal, setShowCatModal] = useState(false);
  const [showManageCatsModal, setShowManageCatsModal] = useState(false);
  const [editingLead, setEditingLead] = useState(null);
  const [editingCategory, setEditingCategory] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);

  // Forms
  const [newLeadForm, setNewLeadForm] = useState({
    name: '',
    phone: '',
    category: categories[0]?.name || 'Leads Orgânicos',
    notes: '',
    initialConsent: 'OPT_IN'
  });

  const [newCatForm, setNewCatForm] = useState({
    name: '',
    color: '#10b981',
    description: ''
  });

  // Filter logic (category_name from SQLite join)
  const filteredLeads = leads.filter(lead => {
    const catName = lead.category_name || lead.category || '';
    if (selectedCategory !== 'TODOS' && catName !== selectedCategory) return false;
    if (selectedStatus !== 'TODOS' && lead.status !== selectedStatus) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchName = (lead.name || '').toLowerCase().includes(q);
      const matchPhone = (lead.phone || '').includes(q);
      const matchNotes = (lead.notes || '').toLowerCase().includes(q);
      return matchName || matchPhone || matchNotes;
    }
    return true;
  });

  // Checkbox handlers
  const handleToggleSelectLead = (id) => {
    setSelectedLeadIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleSelectAllFiltered = () => {
    if (selectedLeadIds.length === filteredLeads.length) {
      setSelectedLeadIds([]);
    } else {
      setSelectedLeadIds(filteredLeads.map(l => l.id));
    }
  };

  // Bulk action: Change Category
  const handleApplyBulkCategory = async () => {
    if (!bulkCategoryTarget || selectedLeadIds.length === 0) return;
    await onBulkUpdateLeads(selectedLeadIds, { category: bulkCategoryTarget });
    setSelectedLeadIds([]);
    setBulkCategoryTarget('');
  };

  // Bulk action: Change Opt-in Status
  const handleApplyBulkStatus = async () => {
    if (!bulkStatusTarget || selectedLeadIds.length === 0) return;
    await onBulkUpdateLeads(selectedLeadIds, { status: bulkStatusTarget });
    setSelectedLeadIds([]);
    setBulkStatusTarget('');
  };

  // Bulk action: Delete
  const handleConfirmBulkDelete = async () => {
    if (selectedLeadIds.length === 0) return;
    await onBulkDeleteLeads(selectedLeadIds);
    setSelectedLeadIds([]);
    setBulkDeleteConfirm(false);
  };

  // CSV Import handler
  const handleFileImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = evt.target.result;
        const rawLines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (rawLines.length === 0) {
          showToast('Arquivo vazio.', 'error');
          return;
        }

        const firstLine = rawLines[0];
        const delimiter = firstLine.includes(';') ? ';' : (firstLine.includes('\t') ? '\t' : ',');
        const splitLine = (l) => l.split(delimiter).map(c => c.replace(/^["']|["']$/g, '').trim());

        const headers = splitLine(firstLine).map(h => h.toLowerCase());
        const hasHeader = headers.some(h => 
          h.includes('nome') || h.includes('name') || h.includes('cliente') || 
          h.includes('tel') || h.includes('cel') || h.includes('zap') || h.includes('phone') || h.includes('fone')
        );

        let leadsData = [];

        if (hasHeader && rawLines.length > 1) {
          const nameIdx = headers.findIndex(h => h.includes('nome') || h.includes('name') || h.includes('cliente') || h.includes('contato'));
          const phoneIdx = headers.findIndex(h => h.includes('tel') || h.includes('cel') || h.includes('zap') || h.includes('phone') || h.includes('fone') || h.includes('numero'));
          const catIdx = headers.findIndex(h => h.includes('cat') || h.includes('tag') || h.includes('grupo'));
          const notesIdx = headers.findIndex(h => h.includes('not') || h.includes('obs') || h.includes('desc'));

          leadsData = rawLines.slice(1).map(line => {
            const cols = splitLine(line);
            const rawPhone = phoneIdx !== -1 ? cols[phoneIdx] : cols[0];
            const rawName = nameIdx !== -1 ? cols[nameIdx] : (cols[1] || `Lead ${String(rawPhone).slice(-4)}`);
            return {
              name: rawName || `Lead ${String(rawPhone).slice(-4)}`,
              phone: rawPhone,
              category: (catIdx !== -1 ? cols[catIdx] : '') || categories[0]?.name || 'Leads Orgânicos',
              notes: (notesIdx !== -1 ? cols[notesIdx] : '') || 'Importado via planilha',
              status: 'PENDING'
            };
          }).filter(l => l.phone && l.phone.replace(/\D/g, '').length >= 8);
        } else {
          leadsData = rawLines.map(line => {
            const cols = splitLine(line);
            if (cols.length === 1) {
              const digits = cols[0].replace(/\D/g, '');
              return {
                name: `Contato ${digits.slice(-4)}`,
                phone: cols[0],
                category: categories[0]?.name || 'Leads Orgânicos',
                notes: 'Importado de lista',
                status: 'PENDING'
              };
            } else {
              return {
                name: cols[0] || `Contato ${cols[1]?.slice(-4)}`,
                phone: cols[1] || cols[0],
                category: cols[2] || categories[0]?.name || 'Leads Orgânicos',
                notes: cols[3] || 'Importado de lista',
                status: 'PENDING'
              };
            }
          }).filter(l => l.phone && l.phone.replace(/\D/g, '').length >= 8);
        }

        if (leadsData.length === 0) {
          showToast('Nenhum telefone válido encontrado no arquivo.', 'error');
          return;
        }

        onImportLeads(leadsData);
      } catch (err) {
        showToast('Erro ao processar arquivo: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleCreateLeadSubmit = (e) => {
    e.preventDefault();
    if (!newLeadForm.name || !newLeadForm.phone) return;
    onAddLead(newLeadForm);
    setShowAddModal(false);
    setNewLeadForm({
      name: '',
      phone: '',
      category: categories[0]?.name || 'Leads Orgânicos',
      notes: '',
      initialConsent: 'OPT_IN'
    });
  };

  const handleUpdateLeadSubmit = (e) => {
    e.preventDefault();
    if (!editingLead) return;
    onUpdateLead(editingLead.id, {
      name: editingLead.name,
      category: editingLead.category_name || editingLead.category,
      status: editingLead.status,
      notes: editingLead.notes
    });
    setEditingLead(null);
  };

  const handleCreateCatSubmit = (e) => {
    e.preventDefault();
    if (!newCatForm.name) return;
    onAddCategory(newCatForm);
    setShowCatModal(false);
    setNewCatForm({ name: '', color: '#10b981', description: '' });
  };

  const handleUpdateCatSubmit = (e) => {
    e.preventDefault();
    if (!editingCategory || !editingCategory.name) return;
    onUpdateCategory(editingCategory.id, {
      name: editingCategory.name,
      color: editingCategory.color,
      description: editingCategory.description
    });
    setEditingCategory(null);
  };

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header & Main Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
            <Users className="w-5 h-5 text-emerald-400" />
            Gestão & Categorização de Leads
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Gerencie contatos, edite categorias individualmente ou em massa e controle o Opt-In com segurança.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            ref={fileInputRef}
            accept=".csv,.txt"
            onChange={handleFileImport}
            className="hidden"
          />

          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 text-xs font-semibold transition-all"
            title="Importar contatos via CSV / Excel"
          >
            <Upload className="w-4 h-4 text-emerald-400" />
            Importar CSV
          </button>

          <button
            onClick={() => setShowManageCatsModal(true)}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-purple-300 text-xs font-semibold transition-all"
          >
            <FolderEdit className="w-4 h-4 text-purple-400" />
            Gerenciar Categorias
          </button>

          <button
            onClick={() => setShowCatModal(true)}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 text-xs font-semibold transition-all"
          >
            <Tag className="w-4 h-4 text-emerald-400" />
            Nova Categoria
          </button>

          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold shadow-lg shadow-emerald-500/20 transition-all"
          >
            <Plus className="w-4 h-4" />
            Adicionar Lead
          </button>
        </div>
      </div>

      {/* Categorias Pills Bar */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
        <button
          onClick={() => setSelectedCategory('TODOS')}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all flex-shrink-0 ${
            selectedCategory === 'TODOS'
              ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
              : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
          }`}
        >
          Todas Categorias ({leads.length})
        </button>

        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setSelectedCategory(cat.name)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all flex-shrink-0 flex items-center gap-2 ${
              selectedCategory === cat.name
                ? 'bg-slate-800 text-white border border-emerald-500/40'
                : 'bg-slate-900/80 border border-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cat.color }}></span>
            <span>{cat.name}</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-950 text-slate-400 font-bold">
              {cat.count || 0}
            </span>
          </button>
        ))}
      </div>

      {/* Barra de Ações em Massa (Aparece quando há leads selecionados) */}
      {selectedLeadIds.length > 0 && (
        <div className="p-4 rounded-2xl bg-emerald-950/40 border border-emerald-500/40 flex flex-wrap items-center justify-between gap-4 animate-slide-up shadow-xl">
          <div className="flex items-center gap-3">
            <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 font-bold text-xs flex items-center gap-1.5 border border-emerald-500/30">
              <CheckSquare className="w-3.5 h-3.5" />
              {selectedLeadIds.length} {selectedLeadIds.length === 1 ? 'lead selecionado' : 'leads selecionados'}
            </span>
            <button
              onClick={() => setSelectedLeadIds([])}
              className="text-xs text-slate-400 hover:text-slate-200 underline"
            >
              Desmarcar todos
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs">
            {/* Alterar Categoria em Massa */}
            <div className="flex items-center gap-1.5 bg-slate-900/90 p-1.5 rounded-xl border border-slate-800">
              <Tag className="w-3.5 h-3.5 text-purple-400 ml-1.5" />
              <select
                value={bulkCategoryTarget}
                onChange={(e) => setBulkCategoryTarget(e.target.value)}
                className="bg-transparent text-white text-xs px-2 py-1 focus:outline-none"
              >
                <option value="" className="bg-slate-900">Mover para Categoria...</option>
                {categories.map(c => (
                  <option key={c.id} value={c.name} className="bg-slate-900">{c.name}</option>
                ))}
              </select>
              <button
                onClick={handleApplyBulkCategory}
                disabled={!bulkCategoryTarget}
                className="px-3 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold transition-all"
              >
                Aplicar
              </button>
            </div>

            {/* Alterar Opt-in em Massa */}
            <div className="flex items-center gap-1.5 bg-slate-900/90 p-1.5 rounded-xl border border-slate-800">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 ml-1.5" />
              <select
                value={bulkStatusTarget}
                onChange={(e) => setBulkStatusTarget(e.target.value)}
                className="bg-transparent text-white text-xs px-2 py-1 focus:outline-none"
              >
                <option value="" className="bg-slate-900">Alterar Opt-In...</option>
                <option value="OPT_IN" className="bg-slate-900">Marcar como Permitiu (OPT-IN)</option>
                <option value="OPT_OUT" className="bg-slate-900">Marcar como Bloqueado (OPT-OUT)</option>
                <option value="PENDING" className="bg-slate-900">Marcar como Pendente</option>
              </select>
              <button
                onClick={handleApplyBulkStatus}
                disabled={!bulkStatusTarget}
                className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold transition-all"
              >
                Aplicar
              </button>
            </div>

            {/* Excluir em Massa */}
            <button
              onClick={() => setBulkDeleteConfirm(true)}
              className="px-3.5 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 font-bold flex items-center gap-1.5 transition-all"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Excluir em Massa
            </button>
          </div>
        </div>
      )}

      {/* Filtros Secundários & Busca */}
      <div className="p-4 rounded-2xl glass-panel border border-slate-800 flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Search */}
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por nome, telefone ou nota..."
            className="w-full pl-10 pr-4 py-2 rounded-xl glass-input text-xs text-white"
          />
        </div>

        {/* Status Consent Filter */}
        <div className="flex items-center gap-2 w-full md:w-auto">
          <span className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-emerald-400" /> Consentimento:
          </span>

          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
            {['TODOS', 'OPT_IN', 'OPT_OUT', 'PENDING'].map((st) => (
              <button
                key={st}
                onClick={() => setSelectedStatus(st)}
                className={`px-3 py-1 rounded-lg font-medium transition-all ${
                  selectedStatus === st
                    ? 'bg-slate-800 text-emerald-400 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {st === 'TODOS' ? 'Todos' : st === 'OPT_IN' ? 'Permitiu' : st === 'OPT_OUT' ? 'Bloqueou' : 'Pendente'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tabela de Leads */}
      <div className="rounded-2xl glass-panel border border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-900/80 border-b border-slate-800 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                <th className="p-4 pl-5 w-10">
                  <button 
                    onClick={handleSelectAllFiltered}
                    className="text-slate-400 hover:text-white"
                    title={selectedLeadIds.length === filteredLeads.length ? 'Desmarcar todos' : 'Selecionar todos'}
                  >
                    {selectedLeadIds.length > 0 && selectedLeadIds.length === filteredLeads.length ? (
                      <CheckSquare className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                  </button>
                </th>
                <th className="p-4">Nome do Lead</th>
                <th className="p-4">Telefone (WhatsApp)</th>
                <th className="p-4">Categoria</th>
                <th className="p-4">Status de Permissão</th>
                <th className="p-4">Origem / Método</th>
                <th className="p-4">Envios</th>
                <th className="p-4 text-right pr-6">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-xs">
              {filteredLeads.length === 0 ? (
                <tr>
                  <td colSpan="8" className="p-8 text-center text-slate-500">
                    Nenhum lead encontrado com os filtros aplicados.
                  </td>
                </tr>
              ) : (
                filteredLeads.map((lead) => {
                  const isChecked = selectedLeadIds.includes(lead.id);
                  const consentMethod = lead.consent_method || lead.consentMethod;
                  const consentTimestamp = lead.consent_timestamp || lead.consentTimestamp;
                  const messagesSent = lead.messages_sent_count ?? lead.messagesSentCount ?? 0;
                  const categoryName = lead.category_name || lead.category || 'Leads Orgânicos';

                  return (
                    <tr 
                      key={lead.id} 
                      className={`transition-colors ${isChecked ? 'bg-emerald-500/10' : 'hover:bg-slate-900/40'}`}
                    >
                      {/* Checkbox */}
                      <td className="p-4 pl-5">
                        <button 
                          onClick={() => handleToggleSelectLead(lead.id)}
                          className="text-slate-400 hover:text-white"
                        >
                          {isChecked ? (
                            <CheckSquare className="w-4 h-4 text-emerald-400" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      </td>

                      {/* Nome */}
                      <td className="p-4 font-semibold text-white">
                        <div>
                          <p>{lead.name}</p>
                          {lead.notes && (
                            <p className="text-[10px] text-slate-400 font-normal line-clamp-1 mt-0.5">{lead.notes}</p>
                          )}
                        </div>
                      </td>

                      {/* Telefone */}
                      <td className="p-4 text-slate-300 font-mono">
                        +{lead.phone}
                      </td>

                      {/* Categoria com Seletor Rápido Inline */}
                      <td className="p-4">
                        <select
                          value={categoryName}
                          onChange={(e) => onUpdateLead(lead.id, { category: e.target.value })}
                          className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-900 border border-slate-800 text-slate-200 cursor-pointer hover:border-emerald-500/50 focus:outline-none"
                        >
                          {categories.map(c => (
                            <option key={c.id} value={c.name}>{c.name}</option>
                          ))}
                        </select>
                      </td>

                      {/* Status de Permissão (Opt-In / Opt-Out) */}
                      <td className="p-4">
                        {lead.status === 'OPT_IN' ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                            <ShieldCheck className="w-3.5 h-3.5" /> Permitiu (Opt-in)
                          </span>
                        ) : lead.status === 'OPT_OUT' ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">
                            <UserX className="w-3.5 h-3.5" /> Bloqueou / Recusou
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                            <Clock className="w-3.5 h-3.5" /> Aguardando
                          </span>
                        )}
                      </td>

                      {/* Método de Consentimento */}
                      <td className="p-4 text-slate-400 text-[11px]">
                        <div>
                          <p className="font-semibold text-slate-300">
                            {consentMethod === 'WHATSAPP_KEYWORD' ? 'Respondeu SIM no Zap' :
                             consentMethod === 'FORM_WEBHOOK' ? 'Formulário Web / CRM' :
                             consentMethod === 'MANUAL' ? 'Manual' :
                             consentMethod === 'IMPORT' ? 'Importação CSV' :
                             consentMethod === 'MANUAL_BULK_OVERRIDE' ? 'Edição em Massa' : 'Pendente'}
                          </p>
                          {consentTimestamp && (
                            <p className="text-[9px] text-slate-400 mt-0.5">
                              {new Date(consentTimestamp).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                      </td>

                      {/* Envios */}
                      <td className="p-4 text-slate-300 font-semibold">
                        {messagesSent} msgs
                      </td>

                      {/* Ações */}
                      <td className="p-4 text-right pr-6">
                        <div className="flex items-center justify-end gap-2">
                          {/* Editar Lead */}
                          <button
                            onClick={() => setEditingLead(lead)}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                            title="Editar Lead Completo"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>

                          {/* Toggle Opt-In */}
                          {lead.status === 'OPT_IN' ? (
                            <button
                              onClick={() => onUpdateLead(lead.id, { status: 'OPT_OUT' })}
                              className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 transition-colors"
                              title="Marcar como Bloqueado/Opt-out"
                            >
                              <UserX className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <button
                              onClick={() => onUpdateLead(lead.id, { status: 'OPT_IN' })}
                              className="p-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 transition-colors"
                              title="Aprovar Opt-in Manual"
                            >
                              <ShieldCheck className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {/* Remover Lead */}
                          <button
                            onClick={() => setDeleteConfirm({ id: lead.id, name: lead.name })}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-500/20 hover:text-rose-400 text-slate-400 transition-colors"
                            title="Remover Lead"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Gerenciar / Editar Categorias */}
      {showManageCatsModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="p-6 rounded-2xl glass-panel border border-slate-800 w-full max-w-lg space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-base flex items-center gap-2">
                <FolderEdit className="w-5 h-5 text-purple-400" />
                Gerenciamento de Categorias & Tags
              </h3>
              <button onClick={() => setShowManageCatsModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
              {categories.map((cat) => (
                <div key={cat.id} className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-3.5 h-3.5 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }}></span>
                    <div className="min-w-0">
                      <p className="font-bold text-white truncate">{cat.name}</p>
                      {cat.description && <p className="text-[10px] text-slate-400 truncate">{cat.description}</p>}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="px-2 py-0.5 rounded bg-slate-950 text-[10px] text-slate-400 font-mono">
                      {cat.count || 0} leads
                    </span>

                    <button
                      onClick={() => setEditingCategory({ ...cat })}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                      title="Editar Categoria"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => {
                        if (confirm(`Tem certeza que deseja excluir a categoria "${cat.name}"? Os leads desta categoria não serão excluídos.`)) {
                          onDeleteCategory(cat.id);
                        }
                      }}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-500/20 hover:text-rose-400 text-slate-400"
                      title="Excluir Categoria"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-between items-center pt-2 border-t border-slate-800 text-xs">
              <button
                onClick={() => {
                  setShowManageCatsModal(false);
                  setShowCatModal(true);
                }}
                className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" /> Criar Nova Categoria
              </button>
              <button
                onClick={() => setShowManageCatsModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-900 text-slate-300 hover:bg-slate-800"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Editar Categoria Existente */}
      {editingCategory && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="p-6 rounded-2xl glass-panel border border-purple-500/30 w-full max-w-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-base flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-purple-400" /> Editar Categoria
              </h3>
              <button onClick={() => setEditingCategory(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUpdateCatSubmit} className="space-y-4 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-slate-300">Nome da Categoria</label>
                <input
                  type="text"
                  required
                  value={editingCategory.name}
                  onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl glass-input text-white"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-300">Cor de Identificação</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={editingCategory.color || '#10b981'}
                    onChange={(e) => setEditingCategory({ ...editingCategory, color: e.target.value })}
                    className="w-12 h-10 rounded-xl glass-input cursor-pointer p-1"
                  />
                  <span className="font-mono text-slate-400">{editingCategory.color}</span>
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-300">Descrição</label>
                <textarea
                  rows="2"
                  value={editingCategory.description || ''}
                  onChange={(e) => setEditingCategory({ ...editingCategory, description: e.target.value })}
                  className="w-full px-3.5 py-2 rounded-xl glass-input text-white resize-none"
                ></textarea>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingCategory(null)}
                  className="px-4 py-2 rounded-xl bg-slate-900 text-slate-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold flex items-center gap-1.5"
                >
                  <Save className="w-4 h-4" /> Salvar Alterações
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Editar Lead Individual */}
      {editingLead && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="p-6 rounded-2xl glass-panel border border-slate-800 w-full max-w-md space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-base flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-emerald-400" /> Editar Contato
              </h3>
              <button onClick={() => setEditingLead(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUpdateLeadSubmit} className="space-y-4 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-slate-300">Nome do Lead</label>
                <input
                  type="text"
                  required
                  value={editingLead.name}
                  onChange={(e) => setEditingLead({ ...editingLead, name: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl glass-input text-white"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-300">Telefone (WhatsApp)</label>
                <input
                  type="text"
                  disabled
                  value={editingLead.phone}
                  className="w-full px-3.5 py-2.5 rounded-xl glass-input text-slate-400 font-mono opacity-60"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-300">Categoria</label>
                <select
                  value={editingLead.category_name || editingLead.category || ''}
                  onChange={(e) => setEditingLead({ ...editingLead, category_name: e.target.value, category: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl glass-input text-white bg-slate-900"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-300">Status de Permissão (Opt-In)</label>
                <select
                  value={editingLead.status}
                  onChange={(e) => setEditingLead({ ...editingLead, status: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl glass-input text-white bg-slate-900"
                >
                  <option value="OPT_IN">Permitiu Envio (Opt-in Confirmado)</option>
                  <option value="PENDING">Aguardando Consentimento (Pendente)</option>
                  <option value="OPT_OUT">Bloqueado / Recusou (Opt-out)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-300">Observações / Notas</label>
                <textarea
                  rows="2"
                  value={editingLead.notes || ''}
                  onChange={(e) => setEditingLead({ ...editingLead, notes: e.target.value })}
                  className="w-full px-3.5 py-2 rounded-xl glass-input text-white resize-none"
                ></textarea>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingLead(null)}
                  className="px-4 py-2 rounded-xl bg-slate-900 text-slate-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold flex items-center gap-1.5"
                >
                  <Save className="w-4 h-4" /> Salvar Lead
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Confirmação de Exclusão Individual */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="p-6 rounded-2xl glass-panel border border-rose-500/30 w-full max-w-sm space-y-4 text-xs">
            <div className="flex items-center gap-3 text-rose-400 font-bold text-sm">
              <AlertCircle className="w-5 h-5" />
              Confirmar Exclusão
            </div>
            <p className="text-slate-300">
              Tem certeza que deseja remover o lead <strong>"{deleteConfirm.name}"</strong>? Esta ação não pode ser desfeita.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 rounded-xl bg-slate-900 text-slate-300 hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  onDeleteLead(deleteConfirm.id);
                  setDeleteConfirm(null);
                }}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold"
              >
                Sim, Remover
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Confirmação de Exclusão em Massa */}
      {bulkDeleteConfirm && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="p-6 rounded-2xl glass-panel border border-rose-500/40 w-full max-w-sm space-y-4 text-xs">
            <div className="flex items-center gap-3 text-rose-400 font-bold text-sm">
              <AlertCircle className="w-5 h-5" />
              Exclusão em Massa
            </div>
            <p className="text-slate-300">
              Tem certeza que deseja excluir permanentemente os <strong>{selectedLeadIds.length} leads selecionados</strong>?
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setBulkDeleteConfirm(false)}
                className="px-4 py-2 rounded-xl bg-slate-900 text-slate-300 hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmBulkDelete}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold"
              >
                Sim, Excluir Todos
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Criar Nova Categoria */}
      {showCatModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="p-6 rounded-2xl glass-panel border border-slate-800 w-full max-w-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-base flex items-center gap-2">
                <Tag className="w-5 h-5 text-emerald-400" /> Nova Categoria
              </h3>
              <button onClick={() => setShowCatModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateCatSubmit} className="space-y-4 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-slate-300">Nome da Categoria</label>
                <input
                  type="text"
                  required
                  value={newCatForm.name}
                  onChange={(e) => setNewCatForm({ ...newCatForm, name: e.target.value })}
                  placeholder="Ex: Clientes Black Friday"
                  className="w-full px-3.5 py-2.5 rounded-xl glass-input text-white"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-300">Cor de Identificação</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={newCatForm.color}
                    onChange={(e) => setNewCatForm({ ...newCatForm, color: e.target.value })}
                    className="w-12 h-10 rounded-xl glass-input cursor-pointer p-1"
                  />
                  <span className="font-mono text-slate-400">{newCatForm.color}</span>
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-300">Descrição (Opcional)</label>
                <textarea
                  rows="2"
                  value={newCatForm.description}
                  onChange={(e) => setNewCatForm({ ...newCatForm, description: e.target.value })}
                  placeholder="Finalidade desta categoria..."
                  className="w-full px-3.5 py-2 rounded-xl glass-input text-white resize-none"
                ></textarea>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCatModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-900 text-slate-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold"
                >
                  Criar Categoria
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Adicionar Novo Lead */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="p-6 rounded-2xl glass-panel border border-slate-800 w-full max-w-md space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-base flex items-center gap-2">
                <Plus className="w-5 h-5 text-emerald-400" /> Cadastrar Novo Lead
              </h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateLeadSubmit} className="space-y-4 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-slate-300">Nome Completo</label>
                <input
                  type="text"
                  required
                  value={newLeadForm.name}
                  onChange={(e) => setNewLeadForm({ ...newLeadForm, name: e.target.value })}
                  placeholder="Ex: João da Silva"
                  className="w-full px-3.5 py-2.5 rounded-xl glass-input text-white"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-300">Telefone WhatsApp (Com DDD)</label>
                <input
                  type="text"
                  required
                  value={newLeadForm.phone}
                  onChange={(e) => setNewLeadForm({ ...newLeadForm, phone: e.target.value })}
                  placeholder="Ex: (11) 98877-6655"
                  className="w-full px-3.5 py-2.5 rounded-xl glass-input text-white font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-300">Categoria / Tag CRM</label>
                <select
                  value={newLeadForm.category}
                  onChange={(e) => setNewLeadForm({ ...newLeadForm, category: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl glass-input text-white bg-slate-900"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-300">Status de Permissão Inicial</label>
                <select
                  value={newLeadForm.initialConsent}
                  onChange={(e) => setNewLeadForm({ ...newLeadForm, initialConsent: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-xl glass-input text-white bg-slate-900"
                >
                  <option value="OPT_IN">Permitiu Envio (Opt-in Confirmado)</option>
                  <option value="PENDING">Aguardando Opt-in (Enviar boas-vindas)</option>
                  <option value="OPT_OUT">Bloqueado / Não quer receber</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-300">Observações / Notas</label>
                <textarea
                  rows="2"
                  value={newLeadForm.notes}
                  onChange={(e) => setNewLeadForm({ ...newLeadForm, notes: e.target.value })}
                  placeholder="Notas internas do CRM..."
                  className="w-full px-3.5 py-2 rounded-xl glass-input text-white resize-none"
                ></textarea>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-900 text-slate-300 hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold shadow-lg shadow-emerald-500/20"
                >
                  Salvar Lead
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
