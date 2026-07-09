// Thin fetch-based JSON client — zero HTTP dependencies, matching the
// license server's own minimal-dependency style. This is also where the
// server's one REST inconsistency gets papered over: /activate raises an
// HTTP error (404/403, body {"detail": "..."}) while /verify always returns
// HTTP 200 with valid:false. Callers of this module see one shape either way.

import { NetworkError } from "./errors.js";

export const DEFAULT_BASE_URL = "https://api.sublimearts.io";

export interface ApiResponse {
  valid: boolean;
  message: string;
  email?: string | null;
  expires_at?: string | null;
  lease?: string | null;
  [key: string]: unknown;
}

export class HttpClient {
  private baseUrl: string;
  private timeoutMs: number;

  constructor(baseUrl: string = DEFAULT_BASE_URL, timeoutMs = 10_000) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.timeoutMs = timeoutMs;
  }

  async postJson(path: string, body: Record<string, unknown>): Promise<ApiResponse> {
    return this.request("POST", path, body);
  }

  async getJson(path: string): Promise<ApiResponse> {
    return this.request("GET", path, undefined);
  }

  private async request(method: string, path: string, body: Record<string, unknown> | undefined): Promise<ApiResponse> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new NetworkError(reason);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      let message = `${res.status} ${res.statusText}`;
      try {
        const payload = (await res.json()) as { detail?: string };
        if (payload?.detail) message = payload.detail;
      } catch {
        // non-JSON error body — keep the status line as the message
      }
      return { valid: false, message, email: null, expires_at: null, lease: null };
    }

    return (await res.json()) as ApiResponse;
  }
}
