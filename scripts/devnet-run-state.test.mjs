import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  PRIVATE_DIR_NAME,
  backoffMs,
  createRunDirectory,
  incompleteRun,
  nextWrite,
  persistWallets,
  readRun,
  recordFailure,
  recordProgress,
  shouldRetry,
  withBackoff,
} from "./devnet-run-state.mjs";

function mode(file) {
  return fs.statSync(file).mode & 0o777;
}

function wallet(name) {
  return {
    publicKey: name,
    secretKey: Uint8Array.from({ length: 64 }, (_, index) => index),
  };
}

test("wallets are saved before funding, and run.json has no secret array", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "campus-escrow-run-"));
  try {
    const dir = createRunDirectory(root, "run-1");
    let funded = false;
    const wallets = {
      seller: wallet("seller-pub"),
      buyer: wallet("buyer-pub"),
      stranger: wallet("stranger-pub"),
      deployer: "deployer-pub",
      programId: "program-pub",
      cluster: "https://api.devnet.solana.com",
    };
    const secretFile = path.join(dir, "wallets.json");
    assert.equal(fs.existsSync(secretFile), false);
    persistWallets(dir, wallets);
    assert.equal(fs.existsSync(secretFile), true);
    funded = true;
    assert.equal(funded, true);
    assert.equal(mode(path.join(root, PRIVATE_DIR_NAME)), 0o700);
    assert.equal(mode(dir), 0o700);
    assert.equal(mode(secretFile), 0o600);
    const meta = readRun(dir);
    const metaText = fs.readFileSync(path.join(dir, "run.json"), "utf8");
    assert.equal(meta.step, "wallets-saved");
    assert.equal(meta.buyer, "buyer-pub");
    assert.equal(metaText.includes("\"secretKey\""), false);
    assert.equal(/\[[\s\d,]{80,}\]/.test(metaText), false);
    assert.equal(nextWrite(meta.step), "wallets-funded");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an error keeps the wallet file and records the order without repeating buy", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "campus-escrow-run-"));
  try {
    const dir = createRunDirectory(root, "run-2");
    persistWallets(dir, {
      seller: wallet("seller-pub"),
      buyer: wallet("buyer-pub"),
      stranger: wallet("stranger-pub"),
    });
    recordProgress(dir, {
      step: "bought",
      orders: [
        {
          name: "textbook",
          listing: "435sWW5DgjUeRZqNpHoNJBPffjUULPCJpGo9gZKvupMV",
          state: "funded",
        },
      ],
      transactions: [{ step: "buy", signature: "buy-sig" }],
    });
    recordFailure(dir, new Error("Server responded with 429 Too Many Requests"));
    assert.equal(fs.existsSync(path.join(dir, "wallets.json")), true);
    const meta = readRun(dir);
    assert.equal(meta.step, "bought");
    assert.equal(meta.orders[0].listing, "435sWW5DgjUeRZqNpHoNJBPffjUULPCJpGo9gZKvupMV");
    assert.equal(meta.transactions[0].signature, "buy-sig");
    assert.match(meta.error, /429/);
    assert.equal(nextWrite(meta.step), "unauthorized-recorded");
    assert.notEqual(nextWrite(meta.step), "bought");
    assert.equal(nextWrite("completed"), "done");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("backoff stops on a program error and skips a write that already landed", async () => {
  assert.equal(shouldRetry("InvalidState", 1), false);
  assert.equal(shouldRetry("429 Too Many Requests", 1), true);
  assert.equal(shouldRetry("429 Too Many Requests", 4), false);
  assert.deepEqual([1, 2, 3, 4].map(backoffMs), [1500, 3000, 4500, 6000]);

  let sends = 0;
  const skipped = await withBackoff({
    status: async () => ({ landed: true, signature: "already" }),
    send: async () => {
      sends += 1;
      return "sent";
    },
    sleep: async () => {},
  });
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.signature, "already");
  assert.equal(sends, 0);

  const waits = [];
  await assert.rejects(
    () =>
      withBackoff({
        status: async () => ({ landed: false }),
        send: async () => {
          throw new Error("429 Too Many Requests");
        },
        sleep: async (ms) => {
          waits.push(ms);
        },
        maxAttempts: 3,
      }),
    /429/,
  );
  assert.deepEqual(waits, [1500, 3000]);
});

test("an unfinished bought order blocks another write", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "campus-escrow-run-"));
  try {
    const dir = createRunDirectory(root, "stuck");
    persistWallets(dir, {
      seller: wallet("seller-pub"),
      buyer: wallet("buyer-pub"),
      stranger: wallet("stranger-pub"),
    });
    recordProgress(dir, { step: "bought", orders: [{ listing: "order-1", state: "funded" }] });
    const found = incompleteRun(root);
    assert.equal(found.runId, "stuck");
    assert.equal(found.meta.orders[0].listing, "order-1");
    assert.equal(nextWrite(found.meta.step), "unauthorized-recorded");
    recordProgress(dir, { step: "completed" });
    assert.equal(incompleteRun(root), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("private run directory is gitignored", () => {
  const ignore = fs.readFileSync(new URL("../.gitignore", import.meta.url), "utf8");
  assert.match(ignore, /^\.campus-escrow-private\/?$/m);
});
