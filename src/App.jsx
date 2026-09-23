import React, { useState, useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import Navbar from './components/Navbar';
import Dashboard from './components/Dashboard';
import ConnectionManager from './components/ConnectionManager';
import LeadsManager from './components/LeadsManager';
import OptInEngineConfig from './components/OptInEngineConfig';
import CampaignBroadcastWizard from './components/CampaignBroadcastWizard';
import SchedulerManager from './components/SchedulerManager';
import LiveChat from './components/LiveChat';
import CRMIntegration from './components/CRMIntegration';
import FlowsManager from './components/FlowsManager';

// Simple toast notification system
function Toast({ message, type, onClose }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const colors = {
    success: 'bg-emerald-500/90 border-emerald-400 text-white',
    error: 'bg-rose-500/90 border-rose-400 text-white',
    info: 'bg-blue-500/90 border-blue-400 text-white',
    warning: 'bg-amber-500/90 border-amber-400 text-slate-900'
  };

  return (
    <div className={`fixed bottom-6 right-6 z-50 px-5 py-3 rounded-xl border shadow-2xl text-sm font-semibold animate-slide-up ${colors[type] || colors.info}`}>
      {message}
    </div>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);

  // App Central State
  const [stats, setStats] = useState(null);
  const [leads, setLeads] = useState([]);
  const [leadsPagination, setLeadsPagination] = useState(null);
  const [categories, setCategories] = useState([]);
  const [flows, setFlows] = useState([]);
  const [optInConfig, setOptInConfig] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [messages, setMessages] = useState([]);
  const [connection, setConnection] = useState(null);
  const [webhooks, setWebhooks] = useState(null);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type, key: Date.now() });
  }, []);

  // API Helper
  const api = useCallback(async (url, options = {}) => {
    try {
      const res = await fetch(url, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...options.headers }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
      return data;
    } catch (err) {
      console.error(`API Error [${url}]:`, err);
      throw err;
    }
  }, []);

  // Fetch All Data
  const fetchAllData = useCallback(async () => {
    try {
      const [statsRes, leadsRes, catRes, flowsRes, optInRes, campRes, schedRes, msgRes, connRes, crmRes] = await Promise.all([
        api('/api/v1/dashboard/stats'),
        api('/api/v1/leads'),
        api('/api/v1/categories'),
        api('/api/v1/flows'),
        api('/api/v1/optin/config'),
        api('/api/v1/campaigns'),
        api('/api/v1/schedules'),
        api('/api/v1/chat/messages?limit=100'),
        api('/api/v1/connection'),
        api('/api/v1/crm/config')
      ]);

      setStats(statsRes);
      setLeads(leadsRes.leads || leadsRes);
      setLeadsPagination(leadsRes.pagination || null);
      setCategories(catRes);
      setFlows(flowsRes);
      setOptInConfig(optInRes);
      setCampaigns(campRes);
      setSchedules(schedRes);
      setMessages(msgRes);
      setConnection(connRes);
      setWebhooks(crmRes);
      setLoading(false);
    } catch (err) {
      console.error('Fetch error:', err);
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchAllData();
    const interval = setInterval(fetchAllData, 8000);
    return () => clearInterval(interval);
  }, [fetchAllData]);

  // ─── Handlers ───────────────────────────────────────────
  const handleAddLead = async (leadData) => {
    try {
      await api('/api/v1/leads', { method: 'POST', body: JSON.stringify(leadData) });
      showToast(`Lead "${leadData.name}" adicionado com sucesso!`);
      fetchAllData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleUpdateLead = async (id, updateData) => {
    try {
      await api(`/api/v1/leads/${id}`, { method: 'PATCH', body: JSON.stringify(updateData) });
      showToast('Lead atualizado.', 'info');
      fetchAllData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleDeleteLead = async (id) => {
    try {
      await api(`/api/v1/leads/${id}`, { method: 'DELETE' });
      showToast('Lead removido.', 'warning');
      fetchAllData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleImportLeads = async (payload) => {
    try {
      const body = Array.isArray(payload) ? { leads: payload } : payload;
      const result = await api('/api/v1/leads/import', { method: 'POST', body: JSON.stringify(body) });
      let msg = `Importação concluída: ${result.imported || 0} novos adicionados`;
      if (result.updated) msg += `, ${result.updated} atualizados`;
      if (result.skipped) msg += `, ${result.skipped} ignorados`;
      showToast(msg);
      fetchAllData();
      return result;
    } catch (err) {
      showToast(err.message, 'error');
      return null;
    }
  };

  const handleExportLeads = async (options = {}) => {
    try {
      const { leadIds, category, status, search } = options;
      const res = await fetch('/api/v1/leads/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadIds, category, status, search })
      });
      if (!res.ok) throw new Error('Falha ao exportar contatos.');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `leads_wappgr_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      showToast('Download do arquivo CSV de leads iniciado!', 'info');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleAddCategory = async (catData) => {
    try {
      await api('/api/v1/categories', { method: 'POST', body: JSON.stringify(catData) });
      showToast(`Categoria "${catData.name}" criada!`);
      fetchAllData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleUpdateCategory = async (id, catData) => {
    try {
      await api(`/api/v1/categories/${id}`, { method: 'PATCH', body: JSON.stringify(catData) });
      showToast('Categoria atualizada com sucesso!');
      fetchAllData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleDeleteCategory = async (id) => {
    try {
      await api(`/api/v1/categories/${id}`, { method: 'DELETE' });
      showToast('Categoria removida.');
      fetchAllData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleBulkUpdateLeads = async (leadIds, updates) => {
    try {
      const result = await api('/api/v1/leads/bulk-update', {
        method: 'POST',
        body: JSON.stringify({ leadIds, ...updates })
      });
      showToast(`${result.updated} leads atualizados em massa!`);
      fetchAllData();
      return result;
    } catch (err) {
      showToast(err.message, 'error');
      return null;
    }
  };

  const handleBulkDeleteLeads = async (leadIds) => {
    try {
      const result = await api('/api/v1/leads/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ leadIds })
      });
      showToast(`${result.deleted} leads removidos.`);
      fetchAllData();
      return result;
    } catch (err) {
      showToast(err.message, 'error');
      return null;
    }
  };

  const handleSaveFlow = async (flowData) => {
    try {
      if (flowData.id) {
        await api(`/api/v1/flows/${flowData.id}`, { method: 'PATCH', body: JSON.stringify(flowData) });
        showToast(`Fluxo "${flowData.name}" atualizado!`);
      } else {
        await api('/api/v1/flows', { method: 'POST', body: JSON.stringify(flowData) });
        showToast(`Fluxo "${flowData.name}" criado com sucesso!`);
      }
      fetchAllData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleToggleFlow = async (id) => {
    try {
      await api(`/api/v1/flows/${id}/toggle`, { method: 'PATCH' });
      showToast('Status do fluxo alterado!');
      fetchAllData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleDeleteFlow = async (id) => {
    try {
      await api(`/api/v1/flows/${id}`, { method: 'DELETE' });
      showToast('Fluxo removido.', 'warning');
      fetchAllData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleTriggerLeadFlow = async (flowId, leadId) => {
    try {
      const result = await api(`/api/v1/flows/${flowId}/trigger-lead`, { method: 'POST', body: JSON.stringify({ leadId }) });
      showToast(result.message || 'Fluxo disparado no WhatsApp!');
      fetchAllData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleSaveOptInConfig = async (configData) => {
    try {
      await api('/api/v1/optin/config', { method: 'POST', body: JSON.stringify(configData) });
      showToast('Regras de Opt-in salvas!');
      fetchAllData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleSimulateMessage = async (phone, messageText, name) => {
    try {
      const data = await api('/api/v1/optin/process-message', {
        method: 'POST',
        body: JSON.stringify({ phone, messageText, name })
      });
      fetchAllData();
      return data;
    } catch (err) {
      showToast(err.message, 'error');
      return null;
    }
  };

  const handleSendCampaign = async (campaignData) => {
    try {
      const data = await api('/api/v1/campaigns/send', { method: 'POST', body: JSON.stringify(campaignData) });
      showToast(data.message || 'Disparo iniciado!');
      fetchAllData();
      return data;
    } catch (err) {
      showToast(err.message, 'error');
      return null;
    }
  };

  const handleAddSchedule = async (schedData) => {
    try {
      await api('/api/v1/schedules', { method: 'POST', body: JSON.stringify(schedData) });
      showToast('Agendamento criado!');
      fetchAllData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleToggleSchedule = async (id) => {
    try {
      await api(`/api/v1/schedules/${id}/toggle`, { method: 'PATCH' });
      showToast('Status do agendamento alterado.', 'info');
      fetchAllData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleDeleteSchedule = async (id) => {
    try {
      await api(`/api/v1/schedules/${id}`, { method: 'DELETE' });
      showToast('Agendamento removido.', 'warning');
      fetchAllData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleSendChatMessage = async (leadId, text) => {
    try {
      const result = await api('/api/v1/chat/send', { method: 'POST', body: JSON.stringify({ leadId, text }) });
      if (!result.success) {
        showToast(`Envio falhou: ${result.error}`, 'error');
      }
      fetchAllData();
      return result;
    } catch (err) {
      showToast(err.message, 'error');
      return null;
    }
  };

  const handleConnectionAction = async (action, payload) => {
    try {
      const data = await api(`/api/v1/connection/${action}`, {
        method: 'POST',
        body: JSON.stringify(payload || {})
      });
      showToast(data.success ? 'Ação realizada!' : (data.error || 'Resposta recebida'), data.success ? 'success' : 'info');
      fetchAllData();
      return data;
    } catch (err) {
      showToast(err.message, 'error');
      return null;
    }
  };

  const handleFetchQrCode = async () => {
    try {
      return await api('/api/v1/connection/qrcode');
    } catch (err) {
      showToast(err.message, 'error');
      return null;
    }
  };

  const handleCheckConnectionStatus = async () => {
    try {
      const data = await api('/api/v1/connection/status');
      fetchAllData();
      return data;
    } catch (err) {
      showToast(err.message, 'error');
      return null;
    }
  };

  // Loading screen (apenas no carregamento inicial)
  if (loading && !stats) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin mx-auto"></div>
          <p className="text-sm font-semibold text-slate-400">Carregando WappGR...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-slate-950 text-slate-100 font-sans">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} stats={stats} connection={connection} />

      <div className="flex-1 flex flex-col min-w-0">
        <Navbar activeTab={activeTab} onRefresh={fetchAllData} stats={stats} connection={connection} />

        <main className="flex-1 overflow-y-auto">
          {activeTab === 'dashboard' && (
            <Dashboard stats={stats} setActiveTab={setActiveTab} onOpenSimulateModal={() => setActiveTab('optin')} />
          )}
          {activeTab === 'connection' && (
            <ConnectionManager
              connection={connection}
              onConnectionAction={handleConnectionAction}
              onFetchQrCode={handleFetchQrCode}
              onCheckStatus={handleCheckConnectionStatus}
              showToast={showToast}
            />
          )}
          {activeTab === 'leads' && (
            <LeadsManager
              leads={leads}
              pagination={leadsPagination}
              categories={categories}
              onAddLead={handleAddLead}
              onUpdateLead={handleUpdateLead}
              onDeleteLead={handleDeleteLead}
              onAddCategory={handleAddCategory}
              onUpdateCategory={handleUpdateCategory}
              onDeleteCategory={handleDeleteCategory}
              onBulkUpdateLeads={handleBulkUpdateLeads}
              onBulkDeleteLeads={handleBulkDeleteLeads}
              onImportLeads={handleImportLeads}
              onExportLeads={handleExportLeads}
              showToast={showToast}
            />
          )}
          {activeTab === 'flows' && (
            <FlowsManager
              flows={flows}
              categories={categories}
              leads={leads}
              onSaveFlow={handleSaveFlow}
              onToggleFlow={handleToggleFlow}
              onDeleteFlow={handleDeleteFlow}
              onTriggerLeadFlow={handleTriggerLeadFlow}
              showToast={showToast}
            />
          )}
          {activeTab === 'optin' && (
            <OptInEngineConfig optInConfig={optInConfig} onSaveConfig={handleSaveOptInConfig} onSimulateMessage={handleSimulateMessage} />
          )}
          {activeTab === 'broadcast' && (
            <CampaignBroadcastWizard campaigns={campaigns} categories={categories} leads={leads} onSendCampaign={handleSendCampaign} />
          )}
          {activeTab === 'scheduler' && (
            <SchedulerManager schedules={schedules} categories={categories} onAddSchedule={handleAddSchedule} onToggleSchedule={handleToggleSchedule} onDeleteSchedule={handleDeleteSchedule} />
          )}
          {activeTab === 'chat' && (
            <LiveChat leads={leads} messages={messages} onSendMessage={handleSendChatMessage} />
          )}
          {activeTab === 'crm' && (
            <CRMIntegration webhooks={webhooks} onSaveWebhooks={(data) => setWebhooks(data)} />
          )}
        </main>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} key={toast.key} />}
    </div>
  );
}
