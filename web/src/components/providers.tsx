"use client";

import { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import "@solana/wallet-adapter-react-ui/styles.css";
import { providerEndpoint } from "@/lib/config";
import { createRateLimitedFetch } from "@/lib/rpc-rate-limit";

export function Providers({ children }: { children: React.ReactNode }) {
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);
  const connectionConfig = useMemo(
    () => ({
      commitment: "confirmed" as const,
      // web3.js otherwise console.errors and retries 429s at 500ms, 1s, 2s, 4s.
      disableRetryOnRateLimit: true,
      fetch: createRateLimitedFetch(),
    }),
    [],
  );
  return (
    <ConnectionProvider endpoint={providerEndpoint()} config={connectionConfig}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
