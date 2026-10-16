let csrf = "";
export function setSession(session) {
  csrf = session?.csrf || "";
}
export async function request(path, options = {}) {
  const res = await fetch(path.startsWith("/api/") ? path : "/api/v1" + path, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
      ...options.headers,
    },
  });
  if (res.status === 401 && !path.includes("/auth/"))
    window.dispatchEvent(new Event("session-expired"));
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Erro " + res.status);
  }
  return res;
}
export async function api(path, options) {
  return (await request(path, options)).json();
}
export const mutation = (path, body = {}, method = "POST", key) =>
  api(path, {
    method,
    body: JSON.stringify(body),
    headers: key ? { "Idempotency-Key": key } : {},
  });
export async function download(path, name, body) {
  const res = await request(
      path,
      body ? { method: "POST", body: JSON.stringify(body) } : {},
    ),
    url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
