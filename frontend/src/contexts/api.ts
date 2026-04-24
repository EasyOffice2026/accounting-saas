export async function apiFetch(path: string, opts: RequestInit = {}) {
  const token = localStorage.getItem("token");
  const headers: Record<string, string> = {
    ...(opts.headers as Record<string, string> || {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401) {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    window.location.href = "/";
  }
  return res;
}

export async function apiGet(path: string) {
  const res = await apiFetch(path);
  return res.json();
}

export async function apiPost(path: string, body: FormData | URLSearchParams) {
  const res = await apiFetch(path, { method: "POST", body });
  return res.json();
}
