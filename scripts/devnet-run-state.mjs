import fs from "node:fs";
import path from "node:path";

export const PRIVATE_DIR_NAME = ".campus-escrow-private";

const TERMINAL_ERROR =
  /UnauthorizedBuyer|InvalidState|SellerMismatch|SellerCannotBuy|TitleEmpty|TitleTooLong|PriceNotPositive|EscrowAmountMismatch/;
const RETRYABLE_ERROR =
  /429|Too Many Requests|Unknown action|Blockhash not found|Node is behind|fetch failed|ECONNRESET|ETIMEDOUT|socket hang up/;

export function backoffMs(attempt) {
  return Math.min(1500 * attempt, 8000);
}

export function shouldRetry(text, attempt, maxAttempts = 4) {
  if (attempt >= maxAttempts) return false;
  if (TERMINAL_ERROR.test(text)) return false;
  return RETRYABLE_ERROR.test(text);
}

export function errorText(error) {
  const logs = error?.logs ?? [];
  return `${error?.message ?? error}\n${logs.join("\n")}`;
}

export function nextWrite(step) {
  const order = [
    "wallets-saved",
    "wallets-funded",
    "cancel-listed",
    "cancelled",
    "listed",
    "bought",
    "unauthorized-recorded",
    "completed",
  ];
  const index = order.indexOf(step);
  if (index === -1) return "wallets-saved";
  if (index === order.length - 1) return "done";
  return order[index + 1];
}

export function createRunDirectory(root, runId) {
  const privateRoot = path.join(root, PRIVATE_DIR_NAME);
  const dir = path.join(privateRoot, runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.chmodSync(privateRoot, 0o700);
  fs.chmodSync(dir, 0o700);
  return dir;
}

function writeJson(file, value, mode) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode });
  fs.chmodSync(file, mode);
}

function publicText(value) {
  if (value == null) return null;
  return typeof value.toBase58 === "function" ? value.toBase58() : String(value);
}

export function persistWallets(dir, wallets) {
  const secretFile = path.join(dir, "wallets.json");
  writeJson(
    secretFile,
    {
      seller: Array.from(wallets.seller.secretKey),
      buyer: Array.from(wallets.buyer.secretKey),
      stranger: Array.from(wallets.stranger.secretKey),
    },
    0o600,
  );
  const meta = {
    step: "wallets-saved",
    seller: publicText(wallets.seller.publicKey),
    buyer: publicText(wallets.buyer.publicKey),
    stranger: publicText(wallets.stranger.publicKey),
    deployer: publicText(wallets.deployer),
    programId: publicText(wallets.programId),
    cluster: wallets.cluster ?? null,
    orders: [],
    transactions: [],
    error: null,
  };
  writeJson(path.join(dir, "run.json"), meta, 0o644);
  return meta;
}

export function readRun(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8"));
}

export function incompleteRun(root) {
  const privateRoot = path.join(root, PRIVATE_DIR_NAME);
  if (!fs.existsSync(privateRoot)) return null;
  const runs = fs
    .readdirSync(privateRoot)
    .map((name) => {
      const dir = path.join(privateRoot, name);
      const metaPath = path.join(dir, "run.json");
      if (!fs.existsSync(metaPath)) return null;
      return { runId: name, dir, meta: JSON.parse(fs.readFileSync(metaPath, "utf8")) };
    })
    .filter(Boolean)
    .filter((run) => run.meta.step && run.meta.step !== "completed" && run.meta.step !== "wallets-saved");
  return runs.at(-1) ?? null;
}

export function recordProgress(dir, patch) {
  const current = readRun(dir);
  const next = {
    ...current,
    ...patch,
    orders: patch.orders ?? current.orders,
    transactions: patch.transactions ?? current.transactions,
  };
  writeJson(path.join(dir, "run.json"), next, 0o644);
  return next;
}

export function recordFailure(dir, error) {
  const message = errorText(error).split("\n")[0].slice(0, 500);
  return recordProgress(dir, { error: message });
}

export async function withBackoff({
  send,
  status,
  sleep,
  maxAttempts = 4,
}) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (status) {
      const current = await status();
      if (current?.landed) {
        return { skipped: true, signature: current.signature ?? null, attempt };
      }
    }
    try {
      const value = await send();
      return { skipped: false, value, attempt };
    } catch (error) {
      lastError = error;
      if (!shouldRetry(errorText(error), attempt, maxAttempts)) throw error;
      await sleep(backoffMs(attempt));
    }
  }
  throw lastError;
}
