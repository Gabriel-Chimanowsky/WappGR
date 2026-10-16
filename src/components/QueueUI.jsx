import { states } from "../lib/presentation";
import { Children, cloneElement, isValidElement, useId } from "react";
export function Status({ value }) {
  return (
    <span
      className={
        "status " +
        (["FAILED", "UNCERTAIN", "ACCOUNT_RESTRICTED"].includes(value)
          ? "warn"
          : "")
      }
    >
      {states[value] || value}
    </span>
  );
}
export function Field({ label, children }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {Children.map(children, (child) =>
        isValidElement(child) &&
        ["input", "select", "textarea"].includes(child.type)
          ? cloneElement(child, { id })
          : child,
      )}
    </div>
  );
}
export function Pager({ pagination, onChange, busy }) {
  if (!pagination) return null;
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-slate-400">
        {pagination.total} registros · página {pagination.page} de{" "}
        {Math.max(1, pagination.totalPages)}
      </span>
      <div className="flex gap-2">
        <button
          className="btn"
          disabled={busy || pagination.page <= 1}
          onClick={() => onChange(pagination.page - 1)}
        >
          Anterior
        </button>
        <button
          className="btn"
          disabled={busy || pagination.page >= pagination.totalPages}
          onClick={() => onChange(pagination.page + 1)}
        >
          Próxima
        </button>
      </div>
    </div>
  );
}
