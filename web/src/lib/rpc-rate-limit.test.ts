import assert from "node:assert/strict";
import test from "node:test";
import {
  createRateLimitedFetch,
  isRateLimitError,
  parseRetryAfter,
  rateLimitRemainingMs,
  resetRateLimitForTests,
} from "./rpc-rate-limit.ts";


test("parse Retry-After seconds and HTTP dates", () => {
  const now = Date.parse("2026-11-08T07:00:00.000Z");
  assert.equal(parseRetryAfter("3", now), 3000);
  assert.equal(parseRetryAfter(null, now), null);
  assert.equal(parseRetryAfter("Sun, 08 Nov 2026 07:00:05 GMT", now), 5000);
});

test("a 429 sets a cooldown and does not call the network again until it ends", async () => {
  resetRateLimitForTests();
  let calls = 0;
  let now = 1_000;
  const fetchImpl = async () => {
    calls += 1;
    return new Response("slow down", {
      status: 429,
      statusText: "Too Many Requests",
      headers: { "Retry-After": "2" },
    });
  };
  const limited = createRateLimitedFetch(fetchImpl as typeof fetch, () => now);
  const first = await limited("https://api.devnet.solana.com", { method: "POST" });
  assert.equal(first.status, 429);
  assert.equal(calls, 1);
  assert.equal(rateLimitRemainingMs(now), 2000);

  const second = await limited("https://api.devnet.solana.com", { method: "POST" });
  assert.equal(second.status, 429);
  assert.equal(calls, 1);
  assert.equal(await second.text(), "Devnet RPC rate limit is still active.");

  now += 2000;
  await limited("https://api.devnet.solana.com", { method: "POST" });
  assert.equal(calls, 2);
  resetRateLimitForTests();
});

test("successful responses are not delayed and 429 text is recognizable", async () => {
  resetRateLimitForTests();
  const limited = createRateLimitedFetch(async () => new Response("ok", { status: 200 }));
  const response = await limited("https://api.devnet.solana.com");
  assert.equal(response.status, 200);
  assert.equal(isRateLimitError(new Error("429 Too Many Requests: {}")), true);
  assert.equal(isRateLimitError(new Error("Account not found")), false);
  resetRateLimitForTests();
});
