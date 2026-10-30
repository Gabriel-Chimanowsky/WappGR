import categories from "../../shared/message-categories.json";
export const categoryLabel = (value) =>
  categories.find((c) => c.value === value)?.label || "Não selecionada";
export const states = {
  REVIEW_REQUIRED: "Revisão obrigatória",
  BUDGET_SUSPENDED: "Suspensa por orçamento",
  SUSPENDED: "Suspenso para revisão",
  WAITING_WINDOW: "Aguardando nova mensagem do cliente",
  WAITING_CUSTOMER: "Aguardando nova mensagem do cliente",
  ACCEPTED: "Aceita pela API; entrega não confirmada",
  DRAFT: "Rascunho",
  SCHEDULED: "Agendada",
  RUNNING: "Executando",
  WAITING_INTERVAL: "Aguardando intervalo",
  WAITING_MANUAL: "Aguardando autorização",
  WAITING_CONNECTION: "Aguardando conexão",
  ACCOUNT_RESTRICTED: "Conta restrita: revisão necessária",
  PAUSE_REQUESTED: "Pausa solicitada",
  PAUSED: "Pausada",
  CANCEL_REQUESTED: "Cancelamento solicitado",
  CANCELLED: "Cancelada",
  COMPLETED: "Concluída",
  COMPLETED_WITH_FAILURES: "Concluída com falhas",
  LEGACY: "Legado sem retomada",
  PENDING: "Pendente",
  SENDING: "Enviando",
  SENT: "Aceita pelo provedor",
  DELIVERED: "Entregue",
  READ: "Lida",
  FAILED: "Falha",
  UNCERTAIN: "Resultado incerto",
  SKIPPED: "Ignorada",
  RETRY_WAIT: "Aguardando nova tentativa",
  LEGACY_UNKNOWN: "Histórico sem confirmação",
  RECEIVED: "Recebida",
};
export const dateLabel = (value, timezone = "America/Sao_Paulo") =>
  value
    ? new Date(
        value.endsWith("Z") ? value : value.replace(" ", "T") + "Z",
      ).toLocaleString("pt-BR", { timeZone: timezone })
    : "—";
