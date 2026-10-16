export const states = {
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
