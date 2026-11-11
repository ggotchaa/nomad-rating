// Thin fetch wrapper for the Nomad API. Errors carry the server's stable `error` code
// (translated in the UI), never raw messages.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(code)
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init
  const response = await fetch(`/api${path}`, {
    credentials: 'include',
    ...rest,
    headers: { ...(json !== undefined && { 'Content-Type': 'application/json' }), ...headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  })
  if (response.status === 204) return undefined as T
  const body = (await response.json().catch(() => ({}))) as { error?: string; details?: unknown }
  if (!response.ok) throw new ApiError(response.status, body.error ?? 'network.error', body.details)
  return body as T
}
