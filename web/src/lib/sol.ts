import { BN, type Program } from "@anchor-lang/core";
import { PublicKey } from "@solana/web3.js";
import type { ReadyConfig } from "@/lib/config";

const DEFAULT_PUBKEY = PublicKey.default.toBase58();

export type ListingStateName =
  | "listed"
  | "funded"
  | "completed"
  | "cancelled"
  | "unknown";

export type ListingRow = {
  publicKey: string;
  seller: string;
  buyer: string | null;
  title: string;
  priceLamports: string;
  listingId: string;
  createdAt: number;
  state: ListingStateName;
  lamports: number;
  latestSignature: string | null;
};

type DecodedListing = {
  publicKey: PublicKey;
  account: {
    seller: PublicKey;
    buyer: PublicKey;
    priceLamports: BN;
    listingId: BN;
    createdAt: BN | number;
    state: unknown;
    title: string;
  };
};

type MethodBuilder = {
  accountsPartial: (accounts: Record<string, PublicKey>) => {
    rpc: () => Promise<string>;
  };
};

type EscrowMethods = {
  listItem: (listingId: BN, title: string, priceLamports: BN) => MethodBuilder;
  buy: () => MethodBuilder;
  confirm: () => MethodBuilder;
  cancel: () => MethodBuilder;
};

export function parseSolToLamports(input: string): BN | null {
  const text = input.trim();
  if (!/^\d+(\.\d{1,9})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const padded = (fraction + "000000000").slice(0, 9);
  const lamports = BigInt(whole) * 1_000_000_000n + BigInt(padded);
  if (lamports <= 0n || lamports > 18_446_744_073_709_551_615n) return null;
  return new BN(lamports.toString());
}

export function formatLamports(value: BN | bigint | number | string): string {
  const raw =
    typeof value === "bigint"
      ? value
      : BigInt(typeof value === "number" ? Math.trunc(value) : value.toString());
  const sign = raw < 0n ? "-" : "";
  const abs = raw < 0n ? -raw : raw;
  const whole = abs / 1_000_000_000n;
  const fraction = (abs % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
  return fraction.length > 0 ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
}

export function titleByteLength(title: string): number {
  return new TextEncoder().encode(title.trim()).length;
}

export function randomListingId(): BN {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let hex = "";
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    hex += bytes[index].toString(16).padStart(2, "0");
  }
  return new BN(hex, 16);
}

export function listingPda(
  programId: PublicKey,
  seller: PublicKey,
  listingId: BN,
): PublicKey {
  const [address] = PublicKey.findProgramAddressSync(
    [
      new TextEncoder().encode("listing"),
      seller.toBytes(),
      Uint8Array.from(listingId.toArray("le", 8)),
    ],
    programId,
  );
  return address;
}

export function stateName(state: unknown): ListingStateName {
  if (state && typeof state === "object") {
    const key = Object.keys(state)[0];
    if (
      key === "listed" ||
      key === "funded" ||
      key === "completed" ||
      key === "cancelled"
    ) {
      return key;
    }
  }
  return "unknown";
}

export function shortAddress(value: string): string {
  if (value.length < 10) return value;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function explorerAddress(config: ReadyConfig, address: string): string | null {
  if (config.cluster !== "devnet") return null;
  return `https://explorer.solana.com/address/${address}?cluster=devnet`;
}

export function explorerTx(config: ReadyConfig, signature: string): string | null {
  if (config.cluster !== "devnet") return null;
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

export function txErrorMessage(error: unknown): string {
  const logs =
    error && typeof error === "object" && "logs" in error
      ? ((error as { logs?: string[] }).logs ?? [])
      : [];
  const interesting = logs.find(
    (line) => line.includes("Error Message:") || line.includes("Error Code:"),
  );
  if (interesting) return interesting.replace(/^Program log: /, "");
  if (error instanceof Error && error.message) {
    const compact = error.message.split("\n").slice(0, 4).join(" ");
    return compact.length > 420 ? `${compact.slice(0, 420)}…` : compact;
  }
  return "The transaction was rejected.";
}

function methods(program: Program): EscrowMethods {
  return (program as unknown as { methods: EscrowMethods }).methods;
}

export async function sendListItem(
  program: Program,
  seller: PublicKey,
  title: string,
  priceLamports: BN,
): Promise<{ signature: string; listing: PublicKey }> {
  const listingId = randomListingId();
  const listing = listingPda(program.programId, seller, listingId);
  const signature = await methods(program)
    .listItem(listingId, title.trim(), priceLamports)
    .accountsPartial({ seller, listing })
    .rpc();
  return { signature, listing };
}

export async function sendBuy(
  program: Program,
  buyer: PublicKey,
  seller: PublicKey,
  listing: PublicKey,
): Promise<string> {
  return methods(program).buy().accountsPartial({ buyer, seller, listing }).rpc();
}

export async function sendConfirm(
  program: Program,
  buyer: PublicKey,
  seller: PublicKey,
  listing: PublicKey,
): Promise<string> {
  return methods(program)
    .confirm()
    .accountsPartial({ buyer, seller, listing })
    .rpc();
}

export async function sendCancel(
  program: Program,
  seller: PublicKey,
  listing: PublicKey,
): Promise<string> {
  return methods(program).cancel().accountsPartial({ seller, listing }).rpc();
}

export async function loadListings(program: Program): Promise<ListingRow[]> {
  const connection = program.provider.connection;
  const coder = program.coder.accounts as {
    memcmp: (name: string) => { offset?: number; bytes?: string; dataSize?: number } | null;
    decode: (name: string, data: Buffer) => DecodedListing["account"];
  };
  const match = coder.memcmp("listing");
  const filters = [];
  if (match?.offset != null && match.bytes != null) {
    filters.push({ memcmp: { offset: match.offset, bytes: match.bytes } });
  }
  if (match?.dataSize != null) filters.push({ dataSize: match.dataSize });
  const accounts = await connection.getProgramAccounts(program.programId, {
    commitment: "confirmed",
    filters,
  });
  return accounts
    .map(({ pubkey, account }) => {
      const decoded = coder.decode("listing", account.data);
      const buyer = decoded.buyer.toBase58();
      const created = decoded.createdAt;
      const createdAt = typeof created === "number" ? created : Number(created.toString());
      return {
        publicKey: pubkey.toBase58(),
        seller: decoded.seller.toBase58(),
        buyer: buyer === DEFAULT_PUBKEY ? null : buyer,
        title: decoded.title,
        priceLamports: decoded.priceLamports.toString(),
        listingId: decoded.listingId.toString(),
        createdAt: Number.isFinite(createdAt) ? createdAt : 0,
        state: stateName(decoded.state),
        lamports: account.lamports,
        latestSignature: null,
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt || b.listingId.localeCompare(a.listingId));
}

export { DEFAULT_PUBKEY };
