import { useState, useEffect, useCallback } from "react";
import Sidebar from "./components/Sidebar";
import Navbar from "./components/Navbar";
import Dashboard from "./components/Dashboard";
import ConnectionManager from "./components/ConnectionManager";
import LeadsManager from "./components/LeadsManager";
import OptInEngineConfig from "./components/OptInEngineConfig";
import CampaignBroadcastWizard from "./components/CampaignBroadcastWizard";
import SchedulerManager from "./components/SchedulerManager";
import LiveChat from "./components/LiveChat";
import CRMIntegration from "./components/CRMIntegration";
import FlowsManager from "./components/FlowsManager";
import { api, mutation } from "./lib/api";
export default function App() {
  const [activeTab, setActiveTab] = useState("dashboard"),
    [stats, setStats] = useState(null),
    [categories, setCategories] = useState([]),
    [flows, setFlows] = useState([]),
    [optInConfig, setOptInConfig] = useState(null),
    [connection, setConnection] = useState(null),
    [toast, setToast] = useState(null),
    [campaignSelection, setCampaignSelection] = useState(null),
    [error, setError] = useState("");
  const showToast = useCallback(
    (message, type = "success") => setToast({ message, type }),
    [],
  );
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  const refresh = useCallback(async () => {
    const paths = [
        "/dashboard/stats",
        "/categories",
        "/flows",
        "/optin/config",
        "/connection",
      ],
      setters = [
        setStats,
        setCategories,
        setFlows,
        setOptInConfig,
        setConnection,
      ];
    const results = await Promise.allSettled(paths.map((path) => api(path)));
    let problem = "";
    results.forEach((r, i) => {
      if (r.status === "fulfilled") setters[i](r.value);
      else problem = r.reason.message;
    });
    setError(problem);
  }, []);
  useEffect(() => {
    let alive = true,
      timer;
    async function poll() {
      await refresh();
      if (alive) timer = setTimeout(poll, 8000);
    }
    poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [refresh]);
  const action = async (
    path,
    body = {},
    method = "POST",
    idempotent = false,
  ) => {
    setToast(null);
    try {
      const result = await mutation(
        path,
        body,
        method,
        idempotent ? crypto.randomUUID() : undefined,
      );
      await refresh();
      return result;
    } catch (e) {
      showToast(e.message, "error");
      return null;
    }
  };
  return (
    <div className="min-h-screen flex bg-slate-950 text-slate-100 font-sans">
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        stats={stats}
        connection={connection}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <Navbar
          activeTab={activeTab}
          onRefresh={refresh}
          stats={stats}
          connection={connection}
        />
        {error && (
          <p className="error m-4" role="alert">
            {error}
          </p>
        )}
        <main className="flex-1 overflow-y-auto">
          {activeTab === "dashboard" && (
            <Dashboard
              stats={stats}
              setActiveTab={setActiveTab}
              onOpenSimulateModal={() => setActiveTab("optin")}
            />
          )}
          {activeTab === "connection" && (
            <ConnectionManager onRefresh={refresh} />
          )}
          {activeTab === "leads" && (
            <LeadsManager
              categories={categories}
              onRefresh={refresh}
              onCreateCampaign={(selection) => {
                setCampaignSelection(selection);
                setActiveTab("broadcast");
              }}
            />
          )}
          {activeTab === "broadcast" && (
            <CampaignBroadcastWizard
              categories={categories}
              selection={campaignSelection}
              onClearSelection={() => setCampaignSelection(null)}
              connection={connection}
            />
          )}
          {activeTab === "scheduler" && (
            <SchedulerManager
              categories={categories}
              onOpenCampaign={() => setActiveTab("broadcast")}
            />
          )}
          {activeTab === "chat" && <LiveChat />}
          {activeTab === "crm" && <CRMIntegration />}
          {activeTab === "flows" && (
            <FlowsManager
              flows={flows}
              categories={categories}
              leads={[]}
              showToast={showToast}
              onSaveFlow={(data) =>
                action(
                  "/flows" + (data.id ? "/" + data.id : ""),
                  data,
                  data.id ? "PATCH" : "POST",
                )
              }
              onToggleFlow={(id) =>
                action("/flows/" + id + "/toggle", {}, "PATCH")
              }
              onDeleteFlow={(id) => action("/flows/" + id, {}, "DELETE")}
              onTriggerLeadFlow={(id, leadId) =>
                action(
                  "/flows/" + id + "/trigger-lead",
                  { leadId },
                  "POST",
                  true,
                )
              }
            />
          )}
          {activeTab === "optin" && optInConfig && (
            <OptInEngineConfig
              optInConfig={optInConfig}
              onSaveConfig={(data) => action("/optin/config", data)}
              onSimulateMessage={(phone, messageText, name) =>
                action("/optin/process-message", { phone, messageText, name })
              }
            />
          )}
        </main>
      </div>
      {toast && (
        <div
          role="status"
          className={
            "fixed bottom-5 right-5 max-w-lg z-50 " +
            (toast.type === "error" ? "error" : "notice")
          }
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
