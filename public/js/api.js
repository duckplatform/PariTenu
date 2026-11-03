export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || 'Erreur inattendue.');
    this.status = status;
    this.code = body?.code;
    this.body = body ?? {};
  }
}

export async function api(method, path, body) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiError(0, { error: 'Pas de connexion au serveur. Vérifie ton réseau.', code: 'offline' });
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const get = (path) => api('GET', path);
export const post = (path, body) => api('POST', path, body);
export const patch = (path, body) => api('PATCH', path, body);
export const del = (path) => api('DELETE', path);
