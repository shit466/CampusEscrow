const DEFAULT_WAIT_MS = 8_000;
const MAX_WAIT_MS = 60_000;

let limitedUntil = 0;

export function parseRetryAfter(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) {
    return Math.min(Number(trimmed) * 1000, MAX_WAIT_MS);
  }
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.min(Math.max(0, date - now), MAX_WAIT_MS);
}

export function rateLimitRemainingMs(now = Date.now()): number {
  return Math.max(0, limitedUntil - now);
}

export function resetRateLimitForTests(): void {
  limitedUntil = 0;
}

export function isRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b429\b/.test(message);
}

export function createRateLimitedFetch(
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const current = now();
    if (current < limitedUntil) {
      const seconds = Math.max(1, Math.ceil((limitedUntil - current) / 1000));
      return new Response("Devnet RPC rate limit is still active.", {
        status: 429,
        statusText: "Too Many Requests",
        headers: { "Retry-After": String(seconds) },
      });
    }
    const response = await fetchImpl(input, init);
    if (response.status === 429) {
      const wait = parseRetryAfter(response.headers.get("Retry-After"), current) ?? DEFAULT_WAIT_MS;
      limitedUntil = current + wait;
    }
    return response;
  };
}
