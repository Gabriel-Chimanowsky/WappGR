import React, { useState, useRef, useMemo, useEffect } from 'react';
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
  Download,
  AlertCircle,
  Edit2,
  CheckSquare,
  Square,
  Layers,
  Settings,
  FolderEdit,
  Save,
  Check,
  FileText,
  CheckCircle2,
  HelpCircle,
  ArrowRight,
  FileSpreadsheet,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight
} from 'lucide-react';

// Helper: Parser flexível de leads a partir de texto (CSV, TSV, TXT ou colado de planilha)
// Mapeia nativamente: Contato | Desde | Telefone | Etiquetas | Último Envio (ignora Ação Rápida)
function parseLeadsInput(text, defaultCategory, defaultStatus, useSpreadsheetCategories = false) {
  if (!text || !text.trim()) return [];

  const rawLines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (rawLines.length === 0) return [];

  const firstLine = rawLines[0];
  // Priorizar tabulação \t se presente (padrão de cópia do Excel e planilhas), depois ;, |, ,
  const delimiter = firstLine.includes('\t') 
    ? '\t' 
    : (firstLine.includes(';') ? ';' : (firstLine.includes('|') ? '|' : ','));
  
  const splitLine = (l) => {
    if (delimiter === '\t') {
      return l.split('\t').map(c => c.replace(/^["']|["']$/g, '').trim());
    }
    const regex = new RegExp(`(?:^|${delimiter})(?:"([^"]*(?:""[^"]*)*)"|([^"${delimiter}]*))`, 'g');
    const cols = [];
    let match;
    while ((match = regex.exec(l)) !== null) {
      let val = match[1] !== undefined ? match[1].replace(/""/g, '"') : match[2];
      cols.push((val || '').trim());
      if (regex.lastIndex === 0) break;
    }
    return cols;
  };

  const cleanH = (h) => String(h || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  const firstCols = splitLine(firstLine);
  const headers = firstCols.map(cleanH);

  // Detecta se a primeira linha é cabeçalho
  const hasHeader = headers.some(h => 
    h === 'contato' || h.includes('contato') || h.includes('nome') || h.includes('name') || h.includes('cliente') || 
    h.includes('tel') || h.includes('cel') || h.includes('zap') || h.includes('phone') || h.includes('fone') || h.includes('numero') ||
    h.includes('etiqueta') || h.includes('desde') || h.includes('ultimo')
  );

  const linesToProcess = hasHeader ? rawLines.slice(1) : rawLines;
  
  // Mapeamento específico dos títulos solicitados:
  // Contato | Desde | Telefone | Etiquetas | Último Envio | Ação Rápida
  const nameIdx = hasHeader ? headers.findIndex(h => h === 'contato' || h.startsWith('contato') || h.includes('nome') || h.includes('name') || h.includes('cliente')) : -1;
  const sinceIdx = hasHeader ? headers.findIndex(h => h.includes('desde') || h.includes('criado') || h.includes('cadastro')) : -1;
  const phoneIdx = hasHeader ? headers.findIndex(h => h.includes('telefone') || h.includes('tel') || h.includes('cel') || h.includes('zap') || h.includes('phone') || h.includes('fone') || h.includes('numero')) : -1;
  const catIdx = hasHeader ? headers.findIndex(h => h.includes('etiqueta') || h.includes('tag') || h.includes('cat') || h.includes('grupo')) : -1;
  const lastSentIdx = hasHeader ? headers.findIndex(h => h.includes('ultimo') || h.includes('disparo') || h.includes('envio')) : -1;
  const notesIdx = hasHeader ? headers.findIndex(h => h.includes('not') || h.includes('obs') || h.includes('desc')) : -1;
  // Ação Rápida: explicitamente ignorada

  const results = [];

  for (const line of linesToProcess) {
    const cols = splitLine(line);
    if (!cols || cols.length === 0 || (cols.length === 1 && !cols[0])) continue;

    let name = '';
    let phone = '';
    let category = defaultCategory;
    let since = '';
    let lastSent = '';
    let etiquetas = '';
    let notes = '';

    if (hasHeader) {
      phone = phoneIdx !== -1 ? cols[phoneIdx] : cols[0];
      name = nameIdx !== -1 ? cols[nameIdx] : '';
      if (catIdx !== -1 && cols[catIdx]) {
        etiquetas = cols[catIdx];
        if (useSpreadsheetCategories) {
          const firstTag = etiquetas.split(/[,;|]/).map(t => t.trim()).filter(Boolean)[0];
          // Evita tags inválidas como datas, URLs ou números puros
          if (firstTag && firstTag.length <= 40 && !/^\d{1,2}\/\d{1,2}/.test(firstTag) && !/^\d+$/.test(firstTag) && !firstTag.includes('http')) {
            category = firstTag;
          } else {
            category = defaultCategory;
          }
        } else {
          category = defaultCategory;
        }
      }
      if (sinceIdx !== -1 && cols[sinceIdx]) {
        since = cols[sinceIdx];
      }
      if (lastSentIdx !== -1 && cols[lastSentIdx]) {
        lastSent = cols[lastSentIdx];
      }
      if (notesIdx !== -1 && cols[notesIdx]) {
        notes = cols[notesIdx];
      }
    } else {
      // Detecção heurística quando não há cabeçalho
      if (cols.length === 1) {
        phone = cols[0];
      } else if (cols.length === 2) {
        const digits0 = cols[0].replace(/\D/g, '');
        const digits1 = cols[1].replace(/\D/g, '');
        if (digits0.length >= 8 && digits1.length < 8) {
          phone = cols[0];
          name = cols[1];
        } else {
          name = cols[0];
          phone = cols[1];
        }
      } else {
        const digits0 = cols[0].replace(/\D/g, '');
        if (digits0.length >= 8) {
          phone = cols[0];
          name = cols[1];
          category = useSpreadsheetCategories ? (cols[2] || defaultCategory) : defaultCategory;
          notes = cols.slice(3).join(' ');
        } else {
          name = cols[0];
          phone = cols[1];
          category = useSpreadsheetCategories ? (cols[2] || defaultCategory) : defaultCategory;
          notes = cols.slice(3).join(' ');
        }
      }
    }

    const cleanDigits = String(phone || '').replace(/\D/g, '');
    if (cleanDigits.length >= 8) {
      if (!name || !name.trim()) name = `Contato ${cleanDigits.slice(-4)}`;

      // Montar detalhes completos das notas preservando Etiquetas, Desde e Último Envio
      const noteParts = [];
      if (notes && notes.trim()) noteParts.push(notes.trim());
      if (etiquetas && etiquetas.trim()) noteParts.push(`Etiquetas: ${etiquetas.trim()}`);
      if (since && since.trim()) noteParts.push(`Desde: ${since.trim()}`);
      if (lastSent && lastSent.trim() && lastSent.toLowerCase() !== 'nunca' && lastSent !== '-') {
        noteParts.push(`Último Envio: ${lastSent.trim()}`);
      }

      const combinedNotes = noteParts.join(' | ') || 'Importado via planilha';

      results.push({
        name: name.trim(),
        phone: phone.trim(),
        category: category || defaultCategory || 'Leads Orgânicos',
        notes: combinedNotes,
        status: defaultStatus || 'OPT_IN',
        since: since.trim(),
        lastSent: lastSent.trim(),
        etiquetas: etiquetas.trim()
      });
    }
  }

  return results;
}

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
  onCleanupEmptyCategories,
  onCleanupCorruptedCategories,
  onBulkDeleteCategories,
  onBulkUpdateLeads,
  onBulkDeleteLeads,
  onImportLeads,
  onExportLeads,
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

  // Estados para Gerenciamento e Limpeza de Categorias
  const [catSearchQuery, setCatSearchQuery] = useState('');
  const [selectedCatIds, setSelectedCatIds] = useState([]);
  const [isCleaningCats, setIsCleaningCats] = useState(false);

  // Estados para Paginação de Leads
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(100); // 50, 100, 250, 500, 1000, 'all'

  // NOVO: Estados para Importação em Massa com Classificação
  const [showImportModal, setShowImportModal] = useState(false);
  const [importTab, setImportTab] = useState('file'); // 'file' | 'paste'
  const [importPastedText, setImportPastedText] = useState('');
  const [importConsentStatus, setImportConsentStatus] = useState('OPT_IN'); // 'OPT_IN' | 'PENDING' | 'OPT_OUT'
  const [importCategory, setImportCategory] = useState(categories[0]?.name || 'Leads Orgânicos');
  const [useSpreadsheetCategories, setUseSpreadsheetCategories] = useState(false);
  const [isCustomCategory, setIsCustomCategory] = useState(false);
  const [customCategoryName, setCustomCategoryName] = useState('');
  const [importUpdateExisting, setImportUpdateExisting] = useState(true);
  const [parsedImportLeads, setParsedImportLeads] = useState([]);
  const [importFileName, setImportFileName] = useState('');
  const [isImporting, setIsImporting] = useState(false);

  // NOVO: Estados para Exportação em Massa
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportScope, setExportScope] = useState('all'); // 'all' | 'filtered' | 'selected'

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

  // Categorias vazias (sem nenhum lead vinculado)
  const emptyCategories = useMemo(() => {
    return categories.filter(c => (c.count || 0) === 0);
  }, [categories]);

  // Categorias corrompidas (com caracteres binários, caracteres de substituição U+FFFD ou tamanho anormal)
  const corruptedCategories = useMemo(() => {
    return categories.filter(c => {
      if (!c.name || !c.name.trim()) return true;
      return /[\uFFFD\u0000-\u001F\u007F-\u009F]/.test(c.name) || c.name.length > 45;
    });
  }, [categories]);

  // Filter logic (category_name from SQLite join)
  const filteredLeads = useMemo(() => {
    return leads.filter(lead => {
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
  }, [leads, selectedCategory, selectedStatus, searchQuery]);

  // Resetar página atual quando filtros ou tamanho de página mudarem
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedCategory, selectedStatus, pageSize]);

  // Cálculos de Paginação
  const totalFiltered = filteredLeads.length;
  const effectivePageSize = pageSize === 'all' ? Math.max(1, totalFiltered) : Number(pageSize);
  const totalPages = Math.max(1, Math.ceil(totalFiltered / effectivePageSize));

  const paginatedLeads = useMemo(() => {
    if (pageSize === 'all') return filteredLeads;
    const start = (currentPage - 1) * effectivePageSize;
    return filteredLeads.slice(start, start + effectivePageSize);
  }, [filteredLeads, currentPage, effectivePageSize, pageSize]);

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

  // Bulk action: Direct Status Change (1 clique)
  const handleApplyBulkDirectStatus = async (status) => {
    if (selectedLeadIds.length === 0) return;
    await onBulkUpdateLeads(selectedLeadIds, { status });
    setSelectedLeadIds([]);
  };

  // Bulk action: Delete
  const handleConfirmBulkDelete = async () => {
    if (selectedLeadIds.length === 0) return;
    await onBulkDeleteLeads(selectedLeadIds);
    setSelectedLeadIds([]);
    setBulkDeleteConfirm(false);
  };

  // Executar exportação
  const handleExecuteExport = () => {
    const targetScope = exportScope;
    if (targetScope === 'selected') {
      if (selectedLeadIds.length === 0) {
        showToast('Nenhum lead selecionado para exportar.', 'warning');
        return;
      }
      if (onExportLeads) onExportLeads({ leadIds: selectedLeadIds });
    } else if (targetScope === 'filtered') {
      if (onExportLeads) {
        onExportLeads({
          category: selectedCategory,
          status: selectedStatus,
          search: searchQuery
        });
      }
    } else {
      if (onExportLeads) onExportLeads({});
    }
    setShowExportModal(false);
  };

  // Exportar selecionados diretamente da barra flutuante
  const handleExportSelectedDirect = () => {
    if (selectedLeadIds.length === 0) return;
    if (onExportLeads) {
      onExportLeads({ leadIds: selectedLeadIds });
    }
  };

  // Tratamento do arquivo selecionado na Importação em Massa (suporte a .xlsx, .xls, .csv, .txt)
  const handleImportFileInput = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setImportFileName(file.name);
    const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');

    if (isExcel) {
      showToast('Lendo planilha Excel...', 'info');
      try {
        if (!window.XLSX) {
          await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Não foi possível carregar leitor Excel. No Google Planilhas, faça download como CSV ou use a aba "Colar Lista".'));
            document.head.appendChild(script);
          });
        }
        const data = await file.arrayBuffer();
        const workbook = window.XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.SheetNames[0];
        const csvText = window.XLSX.utils.sheet_to_csv(workbook.Sheets[firstSheet], { FS: '\t' });
        const targetCategory = isCustomCategory && customCategoryName.trim() ? customCategoryName.trim() : importCategory;
        const parsed = parseLeadsInput(csvText, targetCategory, importConsentStatus, useSpreadsheetCategories);
        setParsedImportLeads(parsed);
        if (parsed.length === 0) {
          showToast('Nenhum contato com telefone válido encontrado na planilha Excel.', 'warning');
        } else {
          showToast(`${parsed.length} contatos extraídos da planilha Excel com sucesso!`, 'success');
        }
      } catch (err) {
        showToast(err.message, 'error');
      }
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = evt.target.result;
        // Evitar leitura de arquivo binário corrompido (ex: ZIP ou XLSX renomeado para CSV)
        if (text.startsWith('PK\x03\x04') || text.includes('\uFFFD') || text.includes('\x00')) {
          showToast('Este arquivo contém formato binário (Excel não-convertido). No Google Planilhas, escolha "Fazer download > Valores separados por vírgula (.csv)".', 'error');
          return;
        }
        const targetCategory = isCustomCategory && customCategoryName.trim() ? customCategoryName.trim() : importCategory;
        const parsed = parseLeadsInput(text, targetCategory, importConsentStatus, useSpreadsheetCategories);
        setParsedImportLeads(parsed);
        if (parsed.length === 0) {
          showToast('Nenhum número de telefone válido encontrado no arquivo.', 'warning');
        } else {
          showToast(`${parsed.length} contatos válidos identificados no arquivo!`, 'info');
        }
      } catch (err) {
        showToast('Erro ao ler arquivo: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Tratamento de texto colado na Importação em Massa
  const handlePastedTextChange = (text) => {
    setImportPastedText(text);
    const targetCategory = isCustomCategory && customCategoryName.trim() ? customCategoryName.trim() : importCategory;
    const parsed = parseLeadsInput(text, targetCategory, importConsentStatus, useSpreadsheetCategories);
    setParsedImportLeads(parsed);
  };

  // Atualizar classificação de consentimento em massa para os contatos identificados
  const handleConsentStatusSelect = (status) => {
    setImportConsentStatus(status);
    setParsedImportLeads(prev => prev.map(l => ({ ...l, status })));
  };

  // Atualizar categoria de destino para os contatos identificados
  const handleCategorySelect = (catName) => {
    setImportCategory(catName);
    setIsCustomCategory(false);
    if (!useSpreadsheetCategories) {
      setParsedImportLeads(prev => prev.map(l => ({ ...l, category: catName })));
    }
  };

  // Alternar regra de categoria na importação
  const handleToggleSpreadsheetCategories = (useTags) => {
    setUseSpreadsheetCategories(useTags);
    const targetCategory = isCustomCategory && customCategoryName.trim() ? customCategoryName.trim() : importCategory;
    if (!useTags) {
      // Forçar todos à categoria padrão
      setParsedImportLeads(prev => prev.map(l => ({ ...l, category: targetCategory })));
    } else {
      // Reprocessar para extrair tags da coluna Etiquetas se houver texto colado
      if (importPastedText) {
        const parsed = parseLeadsInput(importPastedText, targetCategory, importConsentStatus, true);
        setParsedImportLeads(parsed);
      }
    }
  };

  // Submissão da Importação em Massa
  const handleConfirmImportLeads = async () => {
    if (parsedImportLeads.length === 0) {
      showToast('Nenhum contato válido para importar.', 'warning');
      return;
    }

    const finalCat = isCustomCategory && customCategoryName.trim() ? customCategoryName.trim() : importCategory;
    const payloadLeads = parsedImportLeads.map(l => ({
      ...l,
      category: useSpreadsheetCategories ? (l.category || finalCat) : finalCat,
      status: importConsentStatus
    }));

    setIsImporting(true);
    try {
      await onImportLeads({
        leads: payloadLeads,
        defaultCategory: finalCat,
        defaultStatus: importConsentStatus,
        updateExisting: importUpdateExisting,
        useSpreadsheetCategories: useSpreadsheetCategories
      });
      setShowImportModal(false);
      setParsedImportLeads([]);
      setImportPastedText('');
      setImportFileName('');
    } catch (err) {
      showToast('Erro na importação: ' + err.message, 'error');
    } finally {
      setIsImporting(false);
    }
  };

  // Limpeza de categorias vazias (0 leads)
  const handleCleanupEmptyCats = async () => {
    if (emptyCategories.length === 0) {
      showToast('Não há categorias vazias para limpar.', 'info');
      return;
    }
    if (!confirm(`Deseja remover todas as ${emptyCategories.length} categorias vazias (sem leads vinculados)?`)) {
      return;
    }
    setIsCleaningCats(true);
    try {
      if (onCleanupEmptyCategories) {
        await onCleanupEmptyCategories();
      }
      setSelectedCatIds([]);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setIsCleaningCats(false);
    }
  };

  // Excluir categorias selecionadas em massa
  const handleBulkDeleteCats = async () => {
    if (selectedCatIds.length === 0) return;
    if (!confirm(`Deseja excluir ${selectedCatIds.length} categoria(s) selecionada(s)? Os leads dessas categorias permanecerão cadastrados como "Sem Categoria".`)) {
      return;
    }
    setIsCleaningCats(true);
    try {
      if (onBulkDeleteCategories) {
        await onBulkDeleteCategories(selectedCatIds);
      }
      setSelectedCatIds([]);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setIsCleaningCats(false);
    }
  };

  // Reparar categorias corrompidas (com caracteres estranhos)
  const handleCleanupCorruptedCats = async () => {
    if (!confirm(`Deseja reparar ${corruptedCategories.length} categoria(s) corrompida(s)? Todos os leads vinculados a elas serão movidos com segurança para "Leads Orgânicos" e as categorias inválidas serão excluídas.`)) {
      return;
    }
    setIsCleaningCats(true);
    try {
      if (onCleanupCorruptedCategories) {
        await onCleanupCorruptedCategories();
      }
      setSelectedCategory('TODOS');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setIsCleaningCats(false);
    }
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
          <button
            onClick={() => {
              setParsedImportLeads([]);
              setImportPastedText('');
              setImportFileName('');
              setShowImportModal(true);
            }}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-200 text-xs font-semibold transition-all hover:border-emerald-500/50 shadow-sm"
            title="Importar contatos em massa (Planilha ou Colar Lista) e classificar Opt-In"
          >
            <Upload className="w-4 h-4 text-emerald-400" />
            Importar em Massa
          </button>

          <button
            onClick={() => {
              setExportScope(selectedLeadIds.length > 0 ? 'selected' : 'all');
              setShowExportModal(true);
            }}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-200 text-xs font-semibold transition-all hover:border-sky-500/50 shadow-sm"
            title="Exportar contatos em formato CSV / Excel"
          >
            <Download className="w-4 h-4 text-sky-400" />
            Exportar CSV
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

        {corruptedCategories.length > 0 && (
          <button
            onClick={handleCleanupCorruptedCats}
            className="px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex-shrink-0 flex items-center gap-1.5 bg-rose-500/20 border border-rose-500/50 text-rose-300 hover:bg-rose-500/30 shadow-lg"
            title="Clique para reparar as categorias corrompidas e mover os leads vinculados para Leads Orgânicos"
          >
            <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
            <span>Reparar {corruptedCategories.length} Bugadas</span>
          </button>
        )}

        {emptyCategories.length > 0 && (
          <button
            onClick={() => setShowManageCatsModal(true)}
            className="px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all flex-shrink-0 flex items-center gap-1.5 bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 shadow-sm"
            title="Clique para gerenciar ou excluir categorias vazias"
          >
            <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
            <span>{emptyCategories.length} vazias (Limpar)</span>
          </button>
        )}

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

            {/* Ações Rápidas de Classificação de Opt-In em Massa */}
            <div className="flex items-center gap-1.5 bg-slate-900/90 p-1.5 rounded-xl border border-slate-800">
              <span className="text-[11px] font-semibold text-slate-400 px-1 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> Classificar:
              </span>
              <button
                onClick={() => handleApplyBulkDirectStatus('OPT_IN')}
                className="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 font-bold border border-emerald-500/30 flex items-center gap-1 transition-all"
                title="Marcar todos os selecionados como Aceitou receber mensagens (OPT_IN)"
              >
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                Aceitou (Opt-In)
              </button>
              <button
                onClick={() => handleApplyBulkDirectStatus('OPT_OUT')}
                className="px-2.5 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 font-bold border border-rose-500/30 flex items-center gap-1 transition-all"
                title="Marcar todos os selecionados como Recusou receber mensagens (OPT_OUT)"
              >
                <UserX className="w-3 h-3 text-rose-400" />
                Recusou (Opt-Out)
              </button>
              <button
                onClick={() => handleApplyBulkDirectStatus('PENDING')}
                className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-bold border border-amber-500/30 flex items-center gap-1 transition-all"
                title="Marcar todos os selecionados como Pendente de confirmação"
              >
                <Clock className="w-3 h-3 text-amber-400" />
                Pendente
              </button>
            </div>

            {/* Exportar Selecionados */}
            <button
              onClick={handleExportSelectedDirect}
              className="px-3 py-1.5 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/30 font-bold flex items-center gap-1.5 transition-all"
              title="Exportar leads selecionados para arquivo CSV"
            >
              <Download className="w-3.5 h-3.5" />
              Exportar Selecionados
            </button>

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
                paginatedLeads.map((lead) => {
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

        {/* Barra de Paginação & Navegação dos Leads */}
        <div className="p-4 bg-slate-900/60 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs">
          {/* Info de exibição */}
          <div className="flex items-center gap-3 text-slate-400">
            <span>
              Mostrando <strong className="text-white">{totalFiltered === 0 ? 0 : (currentPage - 1) * effectivePageSize + 1}</strong> a <strong className="text-white">{Math.min(currentPage * effectivePageSize, totalFiltered)}</strong> de <strong className="text-emerald-400 font-bold">{totalFiltered}</strong> contatos
              {totalFiltered !== leads.length && (
                <span className="text-slate-500 text-[11px] ml-1.5">
                  (filtrados de {leads.length} no total)
                </span>
              )}
            </span>
          </div>

          {/* Controles de Navegação */}
          <div className="flex items-center gap-3">
            {/* Seletor de Registros por Página */}
            <div className="flex items-center gap-2">
              <span className="text-slate-400">Exibir:</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                className="bg-slate-950 text-white rounded-lg border border-slate-800 px-2.5 py-1 text-xs focus:outline-none focus:border-emerald-500 font-semibold"
              >
                <option value={50}>50 por página</option>
                <option value={100}>100 por página</option>
                <option value={250}>250 por página</option>
                <option value={500}>500 por página</option>
                <option value={1000}>1.000 por página</option>
                <option value="all">Ver Todos ({totalFiltered})</option>
              </select>
            </div>

            {/* Botões de Página */}
            {pageSize !== 'all' && totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentPage(1)}
                  disabled={currentPage === 1}
                  className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Primeira Página"
                >
                  <ChevronsLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Página Anterior"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                <span className="px-3 py-1 bg-slate-950 border border-slate-800 rounded-lg text-slate-300 text-xs font-mono">
                  Pág. <strong className="text-white">{currentPage}</strong> / <strong className="text-slate-400">{totalPages}</strong>
                </span>

                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Próxima Página"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage === totalPages}
                  className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Última Página"
                >
                  <ChevronsRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal Gerenciar & Limpar Categorias */}
      {showManageCatsModal && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="p-6 rounded-3xl glass-panel border border-slate-700/60 w-full max-w-xl space-y-4 shadow-2xl animate-fade-in">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="font-bold text-white text-base flex items-center gap-2">
                  <FolderEdit className="w-5 h-5 text-purple-400" />
                  Gerenciamento & Limpeza de Categorias
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {categories.length} categoria(s) cadastrada(s) • {emptyCategories.length} vazia(s) sem nenhum lead
                </p>
              </div>
              <button onClick={() => setShowManageCatsModal(false)} className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800/60 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Barra de Ações Rápidas de Limpeza */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {corruptedCategories.length > 0 && (
                <button
                  onClick={handleCleanupCorruptedCats}
                  disabled={isCleaningCats}
                  className="px-3.5 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/50 font-bold flex items-center gap-2 transition-all shadow-sm"
                  title="Move todos os leads das categorias corrompidas para Leads Orgânicos e remove as categorias bugadas"
                >
                  <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                  Reparar {corruptedCategories.length} Bugadas (Salvar Leads)
                </button>
              )}

              {emptyCategories.length > 0 && (
                <button
                  onClick={handleCleanupEmptyCats}
                  disabled={isCleaningCats}
                  className="px-3.5 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 font-bold flex items-center gap-2 transition-all shadow-sm"
                  title="Remove em 1 clique todas as categorias que possuem 0 leads vinculados"
                >
                  <Trash2 className="w-3.5 h-3.5 text-amber-400" />
                  {isCleaningCats ? 'Limpando...' : `Limpar ${emptyCategories.length} Categorias Vazias`}
                </button>
              )}

              {selectedCatIds.length > 0 && (
                <button
                  onClick={handleBulkDeleteCats}
                  disabled={isCleaningCats}
                  className="px-3.5 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 font-bold flex items-center gap-2 transition-all shadow-sm"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                  Excluir {selectedCatIds.length} Selecionada(s)
                </button>
              )}

              {emptyCategories.length > 0 && selectedCatIds.length !== emptyCategories.length && (
                <button
                  onClick={() => setSelectedCatIds(emptyCategories.map(c => c.id))}
                  className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white font-medium transition-all"
                >
                  Marcar todas vazias
                </button>
              )}

              {selectedCatIds.length > 0 && (
                <button
                  onClick={() => setSelectedCatIds([])}
                  className="text-xs text-slate-400 hover:text-slate-200 underline ml-auto"
                >
                  Desmarcar ({selectedCatIds.length})
                </button>
              )}
            </div>

            {/* Busca de Categorias */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={catSearchQuery}
                onChange={(e) => setCatSearchQuery(e.target.value)}
                placeholder="Filtrar categorias por nome..."
                className="w-full pl-9 pr-3 py-2 rounded-xl glass-input text-xs text-white"
              />
            </div>

            {/* Lista de Categorias com Rolagem */}
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {categories
                .filter(c => !catSearchQuery || c.name.toLowerCase().includes(catSearchQuery.toLowerCase()))
                .map((cat) => {
                  const isEmpty = (cat.count || 0) === 0;
                  const isChecked = selectedCatIds.includes(cat.id);

                  return (
                    <div 
                      key={cat.id} 
                      className={`p-3 rounded-xl border flex items-center justify-between gap-3 text-xs transition-all ${
                        isChecked 
                          ? 'bg-purple-950/30 border-purple-500/50' 
                          : isEmpty 
                          ? 'bg-slate-900/60 border-slate-800/80 hover:border-slate-700' 
                          : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {/* Checkbox para seleção em massa */}
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedCatIds(prev => 
                              prev.includes(cat.id) ? prev.filter(id => id !== cat.id) : [...prev, cat.id]
                            );
                          }}
                          className="text-slate-400 hover:text-white flex-shrink-0"
                        >
                          {isChecked ? (
                            <CheckSquare className="w-4 h-4 text-purple-400" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>

                        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }}></span>
                        <div className="min-w-0">
                          <p className="font-bold text-white truncate">{cat.name}</p>
                          {cat.description && <p className="text-[10px] text-slate-400 truncate">{cat.description}</p>}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        {isEmpty ? (
                          <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-300/80 border border-amber-500/20 text-[10px] font-mono">
                            0 leads (vazia)
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-[10px] font-mono font-bold">
                            {cat.count} {cat.count === 1 ? 'lead' : 'leads'}
                          </span>
                        )}

                        <button
                          onClick={() => setEditingCategory({ ...cat })}
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                          title="Editar Categoria"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>

                        <button
                          onClick={() => {
                            if (confirm(`Excluir a categoria "${cat.name}"? Os leads vinculados permanecerão cadastrados como "Sem Categoria".`)) {
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
                  );
                })}
            </div>

            <div className="flex justify-between items-center pt-2 border-t border-slate-800 text-xs">
              <button
                onClick={() => {
                  setShowManageCatsModal(false);
                  setShowCatModal(true);
                }}
                className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold flex items-center gap-1.5 shadow-lg shadow-purple-500/20"
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

      {/* ══════════════════════════════════════════════════════ */}
      {/* MODAL: Importação em Massa com Classificação de Opt-In */}
      {/* ══════════════════════════════════════════════════════ */}
      {showImportModal && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 z-50 overflow-y-auto">
          <div className="p-6 rounded-3xl glass-panel border border-slate-700/60 w-full max-w-2xl space-y-5 my-8 shadow-2xl animate-fade-in">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <h3 className="font-bold text-white text-lg flex items-center gap-2.5">
                  <Upload className="w-5 h-5 text-emerald-400" />
                  Importar Contatos & Classificar Consentimento (Opt-In)
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Cadastre contatos em massa e defina se já autorizaram o recebimento de mensagens.
                </p>
              </div>
              <button 
                onClick={() => setShowImportModal(false)} 
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800/60 transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Abas: Arquivo vs Colar Lista */}
            <div className="flex items-center gap-2 p-1 bg-slate-950 rounded-2xl border border-slate-800 text-xs">
              <button
                type="button"
                onClick={() => setImportTab('file')}
                className={`flex-1 py-2 px-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all ${
                  importTab === 'file'
                    ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <FileSpreadsheet className="w-4 h-4" />
                Arquivo CSV / TXT
              </button>
              <button
                type="button"
                onClick={() => setImportTab('paste')}
                className={`flex-1 py-2 px-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all ${
                  importTab === 'paste'
                    ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <FileText className="w-4 h-4" />
                Colar Lista Diretamente
              </button>
            </div>

            {/* Conteúdo Aba: Arquivo */}
            {importTab === 'file' && (
              <div className="space-y-2">
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-700/80 hover:border-emerald-500/60 rounded-2xl p-6 text-center cursor-pointer bg-slate-900/40 hover:bg-slate-900/70 transition-all group"
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept=".csv,.txt"
                    onChange={handleImportFileInput}
                    className="hidden"
                  />
                  <Upload className="w-8 h-8 text-emerald-400 mx-auto mb-2 group-hover:scale-110 transition-transform" />
                  <p className="text-sm font-bold text-white">
                    {importFileName ? `Arquivo selecionado: ${importFileName}` : 'Clique para selecionar seu arquivo CSV ou TXT'}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    Detecta automaticamente colunas: <strong>Contato | Desde | Telefone | Etiquetas | Último Envio</strong> (Ação Rápida é ignorada).
                  </p>
                </div>
              </div>
            )}

            {/* Conteúdo Aba: Colar Lista */}
            {importTab === 'paste' && (
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between items-center">
                  <label className="font-semibold text-slate-300">Cole a lista da sua planilha (com ou sem cabeçalhos):</label>
                  <span className="text-[11px] text-purple-400 font-medium">Reconhece: Contato, Desde, Telefone, Etiquetas, Último Envio</span>
                </div>
                <textarea
                  rows="4"
                  value={importPastedText}
                  onChange={(e) => handlePastedTextChange(e.target.value)}
                  placeholder={"Contato\tDesde\tTelefone\tEtiquetas\tÚltimo Envio\tAção Rápida\nJoão Silva\t12/03/2024\t11999998888\tClientes VIP\t15/05/2024\tConversar\nMaria Santos\t01/01/2024\t21988887777\tNovos Leads\tNunca\tConversar"}
                  className="w-full px-3.5 py-2.5 rounded-xl glass-input text-white font-mono text-xs resize-y"
                ></textarea>
              </div>
            )}

            {/* SEÇÃO PRINCIPAL: Classificação em Massa do Consentimento (Opt-In) */}
            <div className="space-y-2 text-xs">
              <label className="font-bold text-white flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                Como classificar o consentimento desses contatos? (Classificação em Massa)
              </label>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Opção OPT_IN */}
                <div 
                  onClick={() => handleConsentStatusSelect('OPT_IN')}
                  className={`p-3.5 rounded-2xl border cursor-pointer transition-all flex flex-col justify-between ${
                    importConsentStatus === 'OPT_IN'
                      ? 'bg-emerald-500/15 border-emerald-500 shadow-md shadow-emerald-500/10'
                      : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-bold text-emerald-400 text-xs flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4" /> Aceitou (OPT-IN)
                      </span>
                      {importConsentStatus === 'OPT_IN' && (
                        <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-300 leading-relaxed">
                      Já autorizou envio. Fica liberado imediatamente para campanhas e fluxos sem pedir confirmação.
                    </p>
                  </div>
                  <span className="mt-2 text-[10px] font-semibold text-emerald-300/80 bg-emerald-500/10 px-2 py-0.5 rounded-md inline-block self-start">
                    Pronto para disparos
                  </span>
                </div>

                {/* Opção PENDING */}
                <div 
                  onClick={() => handleConsentStatusSelect('PENDING')}
                  className={`p-3.5 rounded-2xl border cursor-pointer transition-all flex flex-col justify-between ${
                    importConsentStatus === 'PENDING'
                      ? 'bg-amber-500/15 border-amber-500 shadow-md shadow-amber-500/10'
                      : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-bold text-amber-400 text-xs flex items-center gap-1.5">
                        <Clock className="w-4 h-4" /> Pendente
                      </span>
                      {importConsentStatus === 'PENDING' && (
                        <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-300 leading-relaxed">
                      Aguardando confirmação. Receberá mensagem automática de solicitação de Opt-In.
                    </p>
                  </div>
                  <span className="mt-2 text-[10px] font-semibold text-amber-300/80 bg-amber-500/10 px-2 py-0.5 rounded-md inline-block self-start">
                    Fluxo de validação
                  </span>
                </div>

                {/* Opção OPT_OUT */}
                <div 
                  onClick={() => handleConsentStatusSelect('OPT_OUT')}
                  className={`p-3.5 rounded-2xl border cursor-pointer transition-all flex flex-col justify-between ${
                    importConsentStatus === 'OPT_OUT'
                      ? 'bg-rose-500/15 border-rose-500 shadow-md shadow-rose-500/10'
                      : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-bold text-rose-400 text-xs flex items-center gap-1.5">
                        <UserX className="w-4 h-4" /> Recusou (OPT-OUT)
                      </span>
                      {importConsentStatus === 'OPT_OUT' && (
                        <span className="w-2 h-2 rounded-full bg-rose-400"></span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-300 leading-relaxed">
                      Não autorizou receber mensagens. O sistema bloqueia disparos automáticos para este número.
                    </p>
                  </div>
                  <span className="mt-2 text-[10px] font-semibold text-rose-300/80 bg-rose-500/10 px-2 py-0.5 rounded-md inline-block self-start">
                    Bloqueado de envios
                  </span>
                </div>
              </div>
            </div>

            {/* SEÇÃO: Regra de Categoria & Opção de Sobrescrever */}
            <div className="space-y-3 text-xs">
              {/* Opção de Atribuição de Categoria */}
              <div className="space-y-1.5">
                <label className="font-bold text-white flex items-center gap-1.5">
                  <Tag className="w-4 h-4 text-purple-400" />
                  Regra de Categoria na Importação
                </label>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div
                    onClick={() => handleToggleSpreadsheetCategories(false)}
                    className={`p-3 rounded-2xl border cursor-pointer transition-all ${
                      !useSpreadsheetCategories
                        ? 'bg-purple-500/15 border-purple-500 text-white shadow-md'
                        : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-xs flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-purple-400" /> Categoria Fixa Única (Recomendado)
                      </span>
                      {!useSpreadsheetCategories && <span className="w-2 h-2 rounded-full bg-purple-400"></span>}
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Atribui 100% dos contatos importados à categoria selecionada abaixo, garantindo organização e sem poluir o sistema com tags extras.
                    </p>
                  </div>

                  <div
                    onClick={() => handleToggleSpreadsheetCategories(true)}
                    className={`p-3 rounded-2xl border cursor-pointer transition-all ${
                      useSpreadsheetCategories
                        ? 'bg-purple-500/15 border-purple-500 text-white shadow-md'
                        : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-xs flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5 text-purple-400" /> Usar Coluna "Etiquetas" da Planilha
                      </span>
                      {useSpreadsheetCategories && <span className="w-2 h-2 rounded-full bg-purple-400"></span>}
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Cria categorias automaticamente a partir do texto encontrado na coluna Etiquetas. (Utilize apenas se a planilha já estiver limpa e padronizada).
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Seleção de Categoria (se Categoria Fixa ou como fallback) */}
                <div className="space-y-1.5">
                  <label className="font-semibold text-slate-300 flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5 text-purple-400" />
                    {!useSpreadsheetCategories ? 'Categoria de Destino para Todos os Contatos' : 'Categoria Padrão (Fallback)'}
                  </label>
                  <select
                    value={isCustomCategory ? '__NEW__' : importCategory}
                    onChange={(e) => {
                      if (e.target.value === '__NEW__') {
                        setIsCustomCategory(true);
                      } else {
                        handleCategorySelect(e.target.value);
                      }
                    }}
                    className="w-full px-3.5 py-2.5 rounded-xl glass-input text-white bg-slate-900"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.name}>{c.name}</option>
                    ))}
                    <option value="__NEW__">+ Criar Nova Categoria...</option>
                  </select>

                  {isCustomCategory && (
                    <input
                      type="text"
                      placeholder="Digite o nome da nova categoria..."
                      value={customCategoryName}
                      onChange={(e) => {
                        setCustomCategoryName(e.target.value);
                        if (!useSpreadsheetCategories) {
                          setParsedImportLeads(prev => prev.map(l => ({ ...l, category: e.target.value })));
                        }
                      }}
                      className="w-full px-3.5 py-2 rounded-xl glass-input text-white mt-1.5"
                      autoFocus
                    />
                  )}
                </div>

                {/* Checkbox Sobrescrever Contatos Existentes */}
                <div className="space-y-1.5">
                  <label className="font-semibold text-slate-300">Tratamento de Contatos Existentes</label>
                  <div 
                    onClick={() => setImportUpdateExisting(!importUpdateExisting)}
                    className="flex items-start gap-2.5 p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 cursor-pointer hover:bg-slate-900 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={importUpdateExisting}
                      onChange={(e) => setImportUpdateExisting(e.target.checked)}
                      className="mt-0.5 rounded text-emerald-500 focus:ring-emerald-500 cursor-pointer"
                    />
                    <div className="text-[11px] text-slate-300 leading-tight">
                      <strong className="text-white block">Atualizar contatos existentes</strong>
                      Se o telefone já existir no sistema, atualizar seu status de Opt-In e categoria conforme configurado acima.
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* SEÇÃO: Pré-visualização dos Contatos Detectados */}
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-emerald-400" />
                  Pré-visualização da Base:
                </span>
                <span className={`px-2.5 py-0.5 rounded-full font-bold text-[11px] ${
                  parsedImportLeads.length > 0 
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'bg-slate-800 text-slate-400'
                }`}>
                  {parsedImportLeads.length} contatos válidos reconhecidos
                </span>
              </div>

              {parsedImportLeads.length > 0 && parsedImportLeads.some(l => l.since || l.etiquetas || l.lastSent) && (
                <div className="px-3 py-1.5 rounded-xl bg-purple-950/40 border border-purple-500/30 text-[11px] text-purple-200 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
                  <span>
                    Colunas detectadas: <strong>Contato</strong>, <strong>Desde</strong>, <strong>Telefone</strong>, <strong>Etiquetas</strong> e <strong>Último Envio</strong> (Ação Rápida descartada).
                  </span>
                </div>
              )}

              {parsedImportLeads.length === 0 ? (
                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 text-center text-slate-500 text-xs">
                  Faça upload de um arquivo ou cole linhas de texto acima para visualizar os contatos aqui.
                </div>
              ) : (
                <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/70 divide-y divide-slate-800/60">
                  {parsedImportLeads.slice(0, 5).map((lead, idx) => (
                    <div key={idx} className="p-2.5 flex flex-col md:flex-row md:items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2.5">
                        <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-400 text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                          {idx + 1}
                        </span>
                        <div>
                          <p className="font-bold text-white leading-tight flex items-center gap-2">
                            {lead.name}
                            {lead.etiquetas && (
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 font-normal">
                                🏷️ {lead.etiquetas}
                              </span>
                            )}
                          </p>
                          <p className="text-[11px] font-mono text-slate-400">{lead.phone}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[10px]">
                        {lead.since && (
                          <span className="px-2 py-0.5 rounded bg-slate-800/80 text-slate-300 font-medium">
                            📅 Desde: {lead.since}
                          </span>
                        )}
                        {lead.lastSent && lead.lastSent.toLowerCase() !== 'nunca' && lead.lastSent !== '-' && (
                          <span className="px-2 py-0.5 rounded bg-slate-800/80 text-slate-300 font-medium">
                            📤 Último: {lead.lastSent}
                          </span>
                        )}
                        <span className={`px-2 py-0.5 rounded-md font-bold ${
                          importConsentStatus === 'OPT_IN' 
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
                            : importConsentStatus === 'OPT_OUT'
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                            : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        }`}>
                          {importConsentStatus === 'OPT_IN' ? 'Aceitou (Opt-In)' : importConsentStatus === 'OPT_OUT' ? 'Recusou (Opt-Out)' : 'Pendente'}
                        </span>
                      </div>
                    </div>
                  ))}
                  {parsedImportLeads.length > 5 && (
                    <div className="p-2 text-center text-[11px] text-slate-400 bg-slate-900/40">
                      + outros {parsedImportLeads.length - 5} contatos prontos para importar...
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="px-4 py-2.5 rounded-xl bg-slate-900 text-slate-300 hover:bg-slate-800 font-semibold text-xs"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={parsedImportLeads.length === 0 || isImporting}
                onClick={handleConfirmImportLeads}
                className="px-6 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-bold text-xs shadow-lg shadow-emerald-500/20 flex items-center gap-2 transition-all"
              >
                {isImporting ? (
                  <span>Importando...</span>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    <span>Confirmar & Cadastrar {parsedImportLeads.length} Contatos</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════ */}
      {/* MODAL: Exportação em Massa (CSV / Planilha Excel)      */}
      {/* ══════════════════════════════════════════════════════ */}
      {showExportModal && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 z-50">
          <div className="p-6 rounded-3xl glass-panel border border-slate-700/60 w-full max-w-md space-y-5 shadow-2xl animate-fade-in">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-base flex items-center gap-2">
                <Download className="w-5 h-5 text-sky-400" />
                Exportar Contatos (CSV / Excel)
              </h3>
              <button onClick={() => setShowExportModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-300">
              Escolha quais contatos você deseja exportar para planilha:
            </p>

            {/* Escopos de Exportação */}
            <div className="space-y-2.5 text-xs">
              {/* Opção: Todos */}
              <label 
                className={`p-3 rounded-2xl border flex items-center gap-3 cursor-pointer transition-all ${
                  exportScope === 'all' 
                    ? 'bg-sky-500/15 border-sky-500 text-white font-bold' 
                    : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:bg-slate-900'
                }`}
              >
                <input
                  type="radio"
                  name="exportScope"
                  value="all"
                  checked={exportScope === 'all'}
                  onChange={() => setExportScope('all')}
                  className="text-sky-500 focus:ring-sky-500"
                />
                <div className="flex-1">
                  <p className="leading-tight">Todos os Leads Cadastrados</p>
                  <p className="text-[11px] font-normal text-slate-400">Total de {leads.length} contatos no sistema</p>
                </div>
              </label>

              {/* Opção: Filtrados */}
              <label 
                className={`p-3 rounded-2xl border flex items-center gap-3 cursor-pointer transition-all ${
                  exportScope === 'filtered' 
                    ? 'bg-sky-500/15 border-sky-500 text-white font-bold' 
                    : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:bg-slate-900'
                }`}
              >
                <input
                  type="radio"
                  name="exportScope"
                  value="filtered"
                  checked={exportScope === 'filtered'}
                  onChange={() => setExportScope('filtered')}
                  className="text-sky-500 focus:ring-sky-500"
                />
                <div className="flex-1">
                  <p className="leading-tight">Apenas Leads Filtrados na Tela</p>
                  <p className="text-[11px] font-normal text-slate-400">
                    {filteredLeads.length} contatos (Filtros: {selectedCategory !== 'TODOS' ? selectedCategory : 'Todas Cat.'} / {selectedStatus !== 'TODOS' ? selectedStatus : 'Todos Status'})
                  </p>
                </div>
              </label>

              {/* Opção: Selecionados por Checkbox */}
              <label 
                className={`p-3 rounded-2xl border flex items-center gap-3 transition-all ${
                  selectedLeadIds.length === 0
                    ? 'opacity-40 cursor-not-allowed bg-slate-900/40 border-slate-800 text-slate-500'
                    : exportScope === 'selected'
                    ? 'bg-sky-500/15 border-sky-500 text-white font-bold cursor-pointer'
                    : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:bg-slate-900 cursor-pointer'
                }`}
              >
                <input
                  type="radio"
                  name="exportScope"
                  value="selected"
                  disabled={selectedLeadIds.length === 0}
                  checked={exportScope === 'selected'}
                  onChange={() => setExportScope('selected')}
                  className="text-sky-500 focus:ring-sky-500"
                />
                <div className="flex-1">
                  <p className="leading-tight">Apenas Leads Marcados com Checkbox</p>
                  <p className="text-[11px] font-normal text-slate-400">
                    {selectedLeadIds.length} {selectedLeadIds.length === 1 ? 'lead selecionado' : 'leads selecionados'}
                  </p>
                </div>
              </label>
            </div>

            {/* Informações de Compatibilidade */}
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 text-[11px] text-slate-400 space-y-1">
              <p className="font-semibold text-slate-300 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Compatibilidade Total com Excel & Planilhas
              </p>
              <p>
                Exporta colunas de <strong>ID, Nome, Telefone, Categoria, Status de Consentimento (Opt-In), Origem, Envios e Data</strong> com codificação UTF-8 e acentuação perfeita.
              </p>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowExportModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-900 text-slate-300 hover:bg-slate-800 font-semibold text-xs"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleExecuteExport}
                className="px-5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs shadow-lg shadow-sky-500/20 flex items-center gap-1.5 transition-all"
              >
                <Download className="w-4 h-4" />
                Baixar Arquivo CSV
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
