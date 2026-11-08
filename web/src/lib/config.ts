import idl from "@/idl/campus_escrow.json";

export const IDL_ADDRESS = idl.address;

const envCluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER?.trim() || "devnet";
const envRpc =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ||
  "https://api.devnet.solana.com";
const envProgramId = process.env.NEXT_PUBLIC_PROGRAM_ID?.trim() || "";

export type ReadyConfig = {
  status: "ready";
  cluster: "devnet" | "localnet";
  rpcUrl: string;
  programId: string;
  programIdSource: "env" | "idl";
};

export type AppConfig =
  | { status: "blocked"; reason: string }
  | ReadyConfig;

export function readConfig(): AppConfig {
  const clusterRaw = envCluster.toLowerCase();
  const rpcLower = envRpc.toLowerCase();
  if (clusterRaw.includes("mainnet") || rpcLower.includes("mainnet")) {
    return {
      status: "blocked",
      reason:
        "This prototype refuses mainnet. Use Devnet or a local validator, and do not point the RPC at real SOL.",
    };
  }
  if (
    clusterRaw !== "devnet" &&
    clusterRaw !== "localnet" &&
    clusterRaw !== "localhost" &&
    clusterRaw !== "local"
  ) {
    return {
      status: "blocked",
      reason: `Unknown cluster "${envCluster}". Set NEXT_PUBLIC_SOLANA_CLUSTER to devnet or localnet.`,
    };
  }
  if (!envProgramId) {
    return {
      status: "blocked",
      reason:
        "NEXT_PUBLIC_PROGRAM_ID is not set. Copy web/.env.example to web/.env.local and set it to the deployed program address. This page will not invent listings.",
    };
  }
  if (envProgramId !== IDL_ADDRESS) {
    return {
      status: "blocked",
      reason: `NEXT_PUBLIC_PROGRAM_ID (${envProgramId}) does not match the IDL address compiled into this app (${IDL_ADDRESS}). Rebuild the program, sync the IDL, and use one address.`,
    };
  }
  return {
    status: "ready",
    cluster: clusterRaw === "devnet" ? "devnet" : "localnet",
    rpcUrl: envRpc,
    programId: envProgramId,
    programIdSource: "env",
  };
}

export function providerEndpoint(): string {
  const config = readConfig();
  return config.status === "ready"
    ? config.rpcUrl
    : "https://api.devnet.solana.com";
}
