import type { z } from 'zod';

/** An error answer from the server: the HTTP status plus the server's error code, e.g. `invalid_or_expired_link`. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(`${status} ${code}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

type RequestOptions<T> = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Checks the response, so a server change that breaks the web app fails loudly here. */
  schema?: z.ZodType<T>;
};

/**
 * Calls the server through `/api` (proxied by Vite in development), sending the login cookie.
 * Network failures throw `ApiError(0, 'network_error')`.
 */
export async function api<T = unknown>(path: string, options: RequestOptions<T> = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      headers: options.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(0, 'network_error');
  }

  const text = await response.text();
  const json: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const code =
      json && typeof json === 'object' && 'error' in json && typeof json.error === 'string' ? json.error : 'unknown_error';
    throw new ApiError(response.status, code);
  }
  return options.schema ? options.schema.parse(json) : (json as T);
}
