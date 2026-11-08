import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import anchor from "@anchor-lang/core";
import web3 from "@solana/web3.js";
import {
  createRunDirectory,
  errorText,
  incompleteRun,
  persistWallets,
  recordFailure,
  recordProgress,
  withBackoff,
} from "./devnet-run-state.mjs";

const { AnchorProvider, BN, Program, Wallet } = anchor;
const {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} = web3;

const rpc = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
if (rpc.toLowerCase().includes("mainnet")) {
  console.error("Refusing to run against mainnet.");
  process.exit(1);
}

const idlPath = new URL("../target/idl/campus_escrow.json", import.meta.url);
const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
const programId = new PublicKey(idl.address);
const connection = new Connection(rpc, "confirmed");
const PRICE = 100_000_000n;

const info = await connection.getAccountInfo(programId);
if (!info?.executable) {
  console.error(`No executable program at ${programId.toBase58()} on ${rpc}.`);
  process.exit(1);
}

const deployerPath =
  process.env.ANCHOR_WALLET ??
  path.join(os.homedir(), ".config", "solana", "id.json");
const deployer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(deployerPath, "utf8"))),
);
console.log(`cluster ${rpc}`);
console.log(`program ${programId.toBase58()}`);
console.log(`deployer ${deployer.publicKey.toBase58()}`);
console.log(`deployer_lamports_before ${await connection.getBalance(deployer.publicKey)}`);

let activeRunDir = null;
process.on("unhandledRejection", (error) => {
  if (activeRunDir) {
    try {
      recordFailure(activeRunDir, error);
    } catch {
      // Keep the wallet file even if the metadata update fails.
    }
  }
  console.error(errorText(error).split("\n")[0]);
  console.error("wallets_retained");
  process.exit(1);
});

const repoRootEarly = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prior = incompleteRun(repoRootEarly);
if (prior) {
  console.error(`incomplete_run ${prior.runId} step ${prior.meta.step}`);
  console.error(JSON.stringify({
    seller: prior.meta.seller,
    buyer: prior.meta.buyer,
    orders: prior.meta.orders,
    transactions: prior.meta.transactions,
    error: prior.meta.error,
  }));
  console.error("refusing_new_orders");
  process.exit(2);
}

const seller = Keypair.generate();
const buyer = Keypair.generate();
const stranger = Keypair.generate();
console.log(`seller ${seller.publicKey.toBase58()}`);
console.log(`buyer ${buyer.publicKey.toBase58()}`);
console.log(`stranger ${stranger.publicKey.toBase58()}`);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = createRunDirectory(repoRoot, runId);
activeRunDir = runDir;
persistWallets(runDir, {
  seller,
  buyer,
  stranger,
  deployer: deployer.publicKey,
  programId,
  cluster: rpc,
});
console.log(`run_dir ${runDir}`);
console.log("wallets_saved_before_funding");

async function transfer(to, lamports) {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: deployer.publicKey,
      toPubkey: to,
      lamports,
    }),
  );
  const signature = await connection.sendTransaction(tx, [deployer]);
  const latest = await connection.getLatestBlockhash();
  await connection.confirmTransaction(
    { signature, ...latest },
    "confirmed",
  );
  return signature;
}

const sellerFund = await transfer(seller.publicKey, 0.2 * LAMPORTS_PER_SOL);
const buyerFund = await transfer(buyer.publicKey, 0.25 * LAMPORTS_PER_SOL);
const strangerFund = await transfer(stranger.publicKey, 0.05 * LAMPORTS_PER_SOL);
recordProgress(runDir, {
  step: "wallets-funded",
  transactions: [
    { step: "fund-seller", signature: sellerFund },
    { step: "fund-buyer", signature: buyerFund },
    { step: "fund-stranger", signature: strangerFund },
  ],
});
console.log(`fund_seller ${sellerFund}`);
console.log(`fund_buyer ${buyerFund}`);
console.log(`fund_stranger ${strangerFund}`);

function providerFor(payer) {
  return new AnchorProvider(connection, new Wallet(payer), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
}

function listingPda(owner, listingId) {
  const [listing] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("listing"),
      owner.toBuffer(),
      listingId.toArrayLike(Buffer, "le", 8),
    ],
    programId,
  );
  return listing;
}

async function rpcRetry(label, fn, status) {
  const result = await withBackoff({
    send: fn,
    status,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  if (result.skipped) {
    console.log(`skip ${label} already landed ${result.signature ?? ""}`);
    return result.signature;
  }
  return result.value;
}

function remember(step, extra) {
  recordProgress(runDir, { step, error: null, ...extra });
}

const sellerProgram = new Program(idl, providerFor(seller));

async function chainState(listingPubkey) {
  try {
    const row = await sellerProgram.account.listing.fetch(listingPubkey);
    return Object.keys(row.state)[0];
  } catch {
    return null;
  }
}
const buyerProgram = new Program(idl, providerFor(buyer));
const strangerProgram = new Program(idl, providerFor(stranger));

const cancelId = new BN(Date.now());
const cancelListing = listingPda(seller.publicKey, cancelId);
const cancelListSig = await rpcRetry(
  "cancel-list",
  () =>
    sellerProgram.methods
      .listItem(cancelId, "Scratch paper", new BN(1))
      .accountsPartial({ seller: seller.publicKey, listing: cancelListing })
      .rpc(),
  async () => ({ landed: (await chainState(cancelListing)) !== null }),
);
const rentOnly = await connection.getBalance(cancelListing, "confirmed");
const cancelSig = await rpcRetry(
  "cancel",
  () =>
    sellerProgram.methods
      .cancel()
      .accountsPartial({ seller: seller.publicKey, listing: cancelListing })
      .rpc(),
  async () => ({ landed: (await chainState(cancelListing)) === "cancelled" }),
);
const cancelled = await sellerProgram.account.listing.fetch(cancelListing);
const cancelBalance = await connection.getBalance(cancelListing, "confirmed");
if (Object.keys(cancelled.state)[0] !== "cancelled") {
  throw new Error(`cancel state ${Object.keys(cancelled.state)[0]}`);
}
if (cancelBalance !== rentOnly) {
  throw new Error(`cancel moved lamports ${rentOnly} -> ${cancelBalance}`);
}
let buyAfterCancel = "not-attempted";
try {
  await buyerProgram.methods
    .buy()
    .accountsPartial({
      buyer: buyer.publicKey,
      seller: seller.publicKey,
      listing: cancelListing,
    })
    .rpc();
  throw new Error("buy after cancel unexpectedly succeeded");
} catch (error) {
  buyAfterCancel = errorText(error);
  if (!buyAfterCancel.includes("InvalidState")) {
    throw error;
  }
}
console.log(`cancel_listing ${cancelListing.toBase58()}`);
console.log(`cancel_list_tx ${cancelListSig}`);
console.log(`cancel_tx ${cancelSig}`);
console.log(`cancel_balance_lamports ${cancelBalance}`);
console.log(`buy_after_cancel_rejected ${buyAfterCancel.split("\n")[0]}`);
remember("cancelled", {
  orders: [
    {
      name: "scratch-paper",
      listing: cancelListing.toBase58(),
      listingId: cancelId.toString(),
      state: "cancelled",
    },
  ],
  transactions: [
    { step: "cancel-list", signature: cancelListSig },
    { step: "cancel", signature: cancelSig },
  ],
});

const listingId = new BN(Date.now() + 1);
const listing = listingPda(seller.publicKey, listingId);
const listSig = await rpcRetry(
  "list",
  () =>
    sellerProgram.methods
      .listItem(listingId, "Used calculus textbook", new BN(PRICE.toString()))
      .accountsPartial({ seller: seller.publicKey, listing })
      .rpc(),
  async () => ({ landed: (await chainState(listing)) !== null }),
);
const afterList = await connection.getBalance(listing, "confirmed");
const listed = await sellerProgram.account.listing.fetch(listing);
if (Object.keys(listed.state)[0] !== "listed") {
  throw new Error("list did not land as listed");
}
if (listed.priceLamports.toString() !== PRICE.toString()) {
  throw new Error(`price ${listed.priceLamports.toString()}`);
}
remember("listed", {
  orders: [
    {
      name: "textbook",
      listing: listing.toBase58(),
      listingId: listingId.toString(),
      state: "listed",
    },
  ],
  transactions: [{ step: "list", signature: listSig }],
});

const buyerBefore = await connection.getBalance(buyer.publicKey, "confirmed");
const sellerBeforeBuy = await connection.getBalance(seller.publicKey, "confirmed");
const buySig = await rpcRetry(
  "buy",
  () =>
    buyerProgram.methods
      .buy()
      .accountsPartial({
        buyer: buyer.publicKey,
        seller: seller.publicKey,
        listing,
      })
      .rpc(),
  async () => {
    const state = await chainState(listing);
    return { landed: state === "funded" || state === "completed" };
  },
);
const fundedBalance = await connection.getBalance(listing, "confirmed");
const buyerAfterBuy = await connection.getBalance(buyer.publicKey, "confirmed");
const sellerAfterBuy = await connection.getBalance(seller.publicKey, "confirmed");
const funded = await buyerProgram.account.listing.fetch(listing);
const locked = BigInt(fundedBalance) - BigInt(afterList);
if (locked !== PRICE) {
  throw new Error(`locked ${locked} expected ${PRICE}`);
}
if (!funded.buyer.equals(buyer.publicKey) || Object.keys(funded.state)[0] !== "funded") {
  throw new Error("buy did not record the buyer");
}
if (BigInt(sellerAfterBuy) !== BigInt(sellerBeforeBuy)) {
  throw new Error("seller balance changed on buy");
}
remember("bought", {
  orders: [
    {
      name: "textbook",
      listing: listing.toBase58(),
      listingId: listingId.toString(),
      state: "funded",
    },
  ],
  transactions: [
    { step: "list", signature: listSig },
    { step: "buy", signature: buySig },
  ],
});

const beforeDenied = await connection.getBalance(listing, "confirmed");
const sellerBeforeDenied = await connection.getBalance(seller.publicKey, "confirmed");
let deniedSig = "";
let deniedText = "";
try {
  await strangerProgram.methods
    .confirm()
    .accountsPartial({
      buyer: stranger.publicKey,
      seller: seller.publicKey,
      listing,
    })
    .rpc({ skipPreflight: true });
  throw new Error("unauthorized confirm unexpectedly succeeded");
} catch (error) {
  deniedText = errorText(error);
  deniedSig = error.signature ?? extractSig(deniedText);
  if (!deniedText.includes("UnauthorizedBuyer")) {
    const recent = await connection.getSignaturesForAddress(listing, { limit: 1 });
    const latest = recent[0];
    if (latest?.err) {
      const tx = await connection.getTransaction(latest.signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      const logs = tx?.meta?.logMessages?.join("\n") ?? "";
      if (logs.includes("UnauthorizedBuyer")) {
        deniedText = logs;
        deniedSig = latest.signature;
      } else {
        throw error;
      }
    } else {
      throw error;
    }
  }
}
const afterDenied = await connection.getBalance(listing, "confirmed");
const sellerAfterDenied = await connection.getBalance(seller.publicKey, "confirmed");
if (afterDenied !== beforeDenied || sellerAfterDenied !== sellerBeforeDenied) {
  throw new Error("unauthorized confirm moved lamports");
}
remember("unauthorized-recorded", {
  transactions: [
    { step: "list", signature: listSig },
    { step: "buy", signature: buySig },
    { step: "unauthorized-confirm", signature: deniedSig || null },
  ],
});

const sellerBeforeRelease = await connection.getBalance(seller.publicKey, "confirmed");
const confirmSig = await rpcRetry(
  "confirm",
  () =>
    buyerProgram.methods
      .confirm()
      .accountsPartial({
        buyer: buyer.publicKey,
        seller: seller.publicKey,
        listing,
      })
      .rpc(),
  async () => ({ landed: (await chainState(listing)) === "completed" }),
);
const sellerAfterRelease = await connection.getBalance(seller.publicKey, "confirmed");
const listingAfter = await connection.getBalance(listing, "confirmed");
const done = await buyerProgram.account.listing.fetch(listing);
const credited = BigInt(sellerAfterRelease) - BigInt(sellerBeforeRelease);
if (credited !== PRICE) {
  throw new Error(`seller credit ${credited}`);
}
if (listingAfter !== afterList) {
  throw new Error(`listing left ${listingAfter} expected rent ${afterList}`);
}
if (Object.keys(done.state)[0] !== "completed" || !done.seller.equals(seller.publicKey)) {
  throw new Error("completed state mismatch");
}

const explorer = "https://explorer.solana.com";
const link = (signature) => `${explorer}/tx/${signature}?cluster=devnet`;
console.log(`textbook_listing ${listing.toBase58()}`);
console.log(`rent_lamports ${afterList}`);
console.log(`buyer_debit_on_buy_including_fee ${buyerBefore - buyerAfterBuy}`);
console.log(`locked_above_rent ${locked.toString()}`);
console.log(`funded_account_lamports ${fundedBalance}`);
console.log(`unauthorized ${deniedText.split("\n")[0]}`);
console.log(`unauthorized_tx ${deniedSig || "preflight-only"}`);
console.log(`seller_credit_on_confirm ${credited.toString()}`);
console.log(`listing_lamports_after_confirm ${listingAfter}`);
console.log(`state ${Object.keys(done.state)[0]}`);
console.log(`buyer_pubkey_on_account ${done.buyer.toBase58()}`);
console.log(`seller_pubkey_on_account ${done.seller.toBase58()}`);
console.log(`price_lamports ${done.priceLamports.toString()}`);
console.log(`deployer_lamports_after ${await connection.getBalance(deployer.publicKey)}`);
console.log(`list ${link(listSig)}`);
console.log(`buy ${link(buySig)}`);
console.log(`confirm ${link(confirmSig)}`);
console.log(`cancel_list ${link(cancelListSig)}`);
console.log(`cancel ${link(cancelSig)}`);
console.log(`account ${explorer}/address/${listing.toBase58()}?cluster=devnet`);
console.log(`program ${explorer}/address/${programId.toBase58()}?cluster=devnet`);
remember("completed", {
  orders: [
    {
      name: "scratch-paper",
      listing: cancelListing.toBase58(),
      listingId: cancelId.toString(),
      state: "cancelled",
    },
    {
      name: "textbook",
      listing: listing.toBase58(),
      listingId: listingId.toString(),
      state: "completed",
    },
  ],
});
console.log("wallets_retained_for_diagnosis");

function extractSig(text) {
  const match = text.match(/[1-9A-HJ-NP-Za-km-z]{80,90}/);
  return match ? match[0] : "";
}
