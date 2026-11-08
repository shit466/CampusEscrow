"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AnchorProvider, Program, Wallet } from "@anchor-lang/core";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import idl from "@/idl/campus_escrow.json";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { readConfig, type ReadyConfig } from "@/lib/config";
import { isRateLimitError, rateLimitRemainingMs } from "@/lib/rpc-rate-limit";
import {
  explorerAddress,
  explorerTx,
  formatLamports,
  loadListings,
  parseSolToLamports,
  sendBuy,
  sendCancel,
  sendConfirm,
  sendListItem,
  shortAddress,
  titleByteLength,
  txErrorMessage,
  type ListingRow,
  type ListingStateName,
} from "@/lib/sol";

const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  {
    ssr: false,
    loading: () => (
      <Button type="button" variant="outline" disabled className="h-11">
        Connect Phantom
      </Button>
    ),
  },
);

const STATE_LABEL: Record<ListingStateName, string> = {
  listed: "Listed",
  funded: "Funded",
  completed: "Completed",
  cancelled: "Cancelled",
  unknown: "Unknown",
};

export function EscrowApp() {
  const config = useMemo(() => readConfig(), []);
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-5 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-xl">
          <p className="text-xs font-medium tracking-[0.16em] text-primary uppercase">
            Campus handover
          </p>
          <h1 className="font-display mt-1 text-4xl text-balance sm:text-5xl">
            CampusEscrow
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground sm:text-base">
            A buyer locks test SOL before meeting. After looking at the item in
            person, the buyer confirms and the program releases that price to
            the seller.
          </p>
        </div>
        <WalletMultiButton />
      </header>

      <div className="mt-5 grid gap-3">
        <Alert className="border-amber-700/30 bg-amber-100/80 text-amber-950">
          <AlertTitle>Devnet / local test only</AlertTitle>
          <AlertDescription className="text-amber-950">
            Set Phantom to Devnet before signing. This page never targets
            mainnet. Test SOL has no cash value. A funded buyer who never
            confirms leaves those lamports locked in the listing account. There
            is no timeout and no admin refund.
          </AlertDescription>
        </Alert>
        <Alert>
          <AlertTitle>The program does not see the handover</AlertTitle>
          <AlertDescription>
            Confirming only checks that the recorded buyer signed. It does not
            prove a textbook was delivered, and it does not settle a dispute
            about the item&apos;s condition. Account rent and network fees are
            separate from the item price.
          </AlertDescription>
        </Alert>
      </div>

      {config.status === "blocked" ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Setup required</CardTitle>
            <CardDescription>
              Listings are read from the configured program. Nothing is stored
              in the browser.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-6">{config.reason}</p>
          </CardContent>
        </Card>
      ) : (
        <Marketplace config={config} />
      )}
    </div>
  );
}

function Marketplace({ config }: { config: ReadyConfig }) {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [rows, setRows] = useState<ListingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [programMissing, setProgramMissing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeSig, setNoticeSig] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [rateLimitUntil, setRateLimitUntil] = useState<number | null>(null);
  const [readAt, setReadAt] = useState<number | null>(null);
  const inFlight = useRef(false);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const autoRetries = useRef(0);
  const retryTimer = useRef<number | null>(null);
  const hasFreshRead = readAt !== null && !stale;
  const writesPaused = !hasFreshRead || programMissing;

  const readProgram = useMemo(() => {
    const provider = new AnchorProvider(connection, readOnlyWallet(), {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    });
    return new Program(idl, provider);
  }, [connection]);

  const writeProgram = useMemo(() => {
    if (!wallet) return readProgram;
    const provider = new AnchorProvider(connection, wallet as unknown as Wallet, {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    });
    return new Program(idl, provider);
  }, [connection, readProgram, wallet]);

  const scheduleRetry = (wait: number) => {
    if (autoRetries.current >= 3 || retryTimer.current !== null) return;
    autoRetries.current += 1;
    retryTimer.current = window.setTimeout(() => {
      retryTimer.current = null;
      void refreshRef.current();
    }, wait + 250);
  };

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    const remaining = rateLimitRemainingMs();
    if (remaining > 0) {
      setRateLimitUntil(Date.now() + remaining);
      setStale(true);
      setLoading(false);
      scheduleRetry(remaining);
      return;
    }
    inFlight.current = true;
    try {
      const info = await connection.getAccountInfo(readProgram.programId, "confirmed");
      if (!info) {
        setProgramMissing(true);
        setRows([]);
        setStale(false);
        setRateLimitUntil(null);
        setLoadError(null);
        setReadAt(Date.now());
        return;
      }
      if (!info.executable) {
        setProgramMissing(false);
        setRows([]);
        setStale(false);
        setLoadError("An account exists at the program id, but it is not an executable program.");
        return;
      }
      const nextRows = await loadListings(readProgram);
      setProgramMissing(false);
      setRows(nextRows);
      setStale(false);
      setRateLimitUntil(null);
      setLoadError(null);
      setReadAt(Date.now());
      autoRetries.current = 0;
    } catch (error) {
      if (isRateLimitError(error)) {
        const wait = rateLimitRemainingMs() || 8_000;
        const until = Date.now() + wait;
        setRateLimitUntil(until);
        setStale(true);
        setLoadError(null);
        scheduleRetry(wait);
        return;
      }
      setLoadError(txErrorMessage(error));
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [connection, readProgram]);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    const started = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => {
      window.clearTimeout(started);
      window.clearInterval(timer);
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
    };
  }, [refresh]);

  async function afterTx(signature: string, message: string) {
    setNotice(message);
    setNoticeSig(signature);
    await refresh();
  }

  return (
    <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
      <ListForm
        config={config}
        program={writeProgram}
        connected={Boolean(wallet)}
        disabled={programMissing || writesPaused}
        onComplete={afterTx}
      />
      <section className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-2xl">Orders on this program</h2>
          <Button type="button" variant="outline" className="h-10" onClick={() => void refresh()}>
            Refresh
          </Button>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          Cluster: {config.cluster}. Program{" "}
          <AddressLink config={config} address={config.programId} />. Balances
          and states below come from account data, not from this browser.
        </p>
        {rateLimitUntil ? (
          <Alert className="border-amber-700/30 bg-amber-100/80 text-amber-950">
            <AlertTitle>Devnet RPC rate limit</AlertTitle>
            <AlertDescription className="text-amber-950">
              The public Devnet endpoint returned HTTP 429. This page will not
              keep retrying in a loop. Listing, buying, confirming, and
              cancelling are paused.
              {readAt
                ? ` The orders below are the last successful read at ${new Date(readAt).toLocaleTimeString()} and may be out of date.`
                : " No current orders could be read yet."}{" "}
              Try Refresh after {new Date(rateLimitUntil).toLocaleTimeString()}.
            </AlertDescription>
          </Alert>
        ) : null}
        {stale && !rateLimitUntil ? (
          <Alert>
            <AlertTitle>Orders may be out of date</AlertTitle>
            <AlertDescription>
              The last read did not finish. These rows are kept only as a stale
              snapshot. Writes stay paused until Refresh succeeds.
            </AlertDescription>
          </Alert>
        ) : null}
        {notice ? (
          <Alert>
            <AlertTitle>Transaction confirmed</AlertTitle>
            <AlertDescription>
              {notice}{" "}
              {noticeSig ? <TxLink config={config} signature={noticeSig} /> : null}
            </AlertDescription>
          </Alert>
        ) : null}
        {loading ? (
          <Card>
            <CardContent className="py-6 text-sm text-muted-foreground">
              Reading listing accounts from the cluster…
            </CardContent>
          </Card>
        ) : null}
        {loadError ? (
          <Alert variant="destructive">
            <AlertTitle>Could not read the program</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        ) : null}
        {programMissing ? (
          <Card>
            <CardHeader>
              <CardTitle>Program is not on this cluster</CardTitle>
              <CardDescription>
                No executable account was found at {config.programId} via {config.rpcUrl}.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm leading-6 break-all">
              Local tests do not deploy to Devnet. From the repository root,
              fund a Devnet wallet with faucet SOL and run{" "}
              <code className="rounded bg-muted px-1 py-0.5">
                anchor program deploy --provider.cluster devnet
              </code>
              . Until that account exists, this page will not show orders.
            </CardContent>
          </Card>
        ) : null}
        {!loading && !loadError && !programMissing && !rateLimitUntil && rows.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-sm leading-6 text-muted-foreground">
              No listing accounts on this program yet. List an item to create
              the first order. A successful listing shows up here only after
              the transaction is confirmed.
            </CardContent>
          </Card>
        ) : null}
        {rows.map((row) => (
          <ListingCard
            key={row.publicKey}
            config={config}
            row={row}
            program={writeProgram}
            wallet={wallet?.publicKey.toBase58() ?? null}
            writesPaused={writesPaused}
            onComplete={afterTx}
          />
        ))}
      </section>
    </div>
  );
}

function ListForm({
  config,
  program,
  connected,
  disabled,
  onComplete,
}: {
  config: ReadyConfig;
  program: Program;
  connected: boolean;
  disabled: boolean;
  onComplete: (signature: string, message: string) => Promise<void>;
}) {
  const wallet = useAnchorWallet();
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!wallet) {
      setError("Connect Phantom on Devnet before listing.");
      return;
    }
    const bytes = titleByteLength(title);
    if (bytes === 0) {
      setError("Enter a title.");
      return;
    }
    if (bytes > 64) {
      setError(`Title is ${bytes} bytes. The maximum is 64.`);
      return;
    }
    const lamports = parseSolToLamports(price);
    if (!lamports) {
      setError("Enter a positive SOL price with at most 9 decimal places, such as 0.1.");
      return;
    }
    setPending(true);
    try {
      const result = await sendListItem(program, wallet.publicKey, title, lamports);
      setTitle("");
      setPrice("");
      await onComplete(
        result.signature,
        `Listed “${title.trim()}” for ${formatLamports(lamports)} SOL.`,
      );
    } catch (caught) {
      setError(txErrorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>List an item</CardTitle>
        <CardDescription>
          For the one-minute demo, list “Used calculus textbook” at 0.1 SOL
          from the seller wallet. You still sign a real transaction.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={onSubmit}>
          <div className="grid gap-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={title}
              maxLength={64}
              placeholder="Used calculus textbook"
              className="h-11 text-base"
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="price">Price (SOL)</Label>
            <Input
              id="price"
              inputMode="decimal"
              value={price}
              placeholder="0.1"
              className="h-11 text-base"
              onChange={(event) => setPrice(event.target.value)}
            />
            <p className="text-xs leading-5 text-muted-foreground">
              Stored as exact lamports. 0.1 SOL is 100000000 lamports. Creating
              the account also pays rent, which is not part of the price.
              Cluster: {config.cluster}.
            </p>
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Listing was not created</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Button
            type="submit"
            className="h-11"
            disabled={pending || disabled || !connected}
          >
            {pending ? "Waiting for signature…" : "List on the cluster"}
          </Button>
          {!connected ? (
            <p className="text-xs text-muted-foreground">
              Connect a Devnet Phantom wallet to list, buy, confirm, or cancel.
              You can still read orders without connecting.
            </p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}

function ListingCard({
  config,
  row,
  program,
  wallet,
  writesPaused,
  onComplete,
}: {
  config: ReadyConfig;
  row: ListingRow;
  program: Program;
  wallet: string | null;
  writesPaused: boolean;
  onComplete: (signature: string, message: string) => Promise<void>;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isSeller = wallet === row.seller;
  const isBuyer = wallet !== null && wallet === row.buyer;
  const price = formatLamports(row.priceLamports);
  const when = row.createdAt
    ? new Date(row.createdAt * 1000).toLocaleString()
    : "Unknown time";

  async function run(action: string, task: () => Promise<string>, message: string) {
    setError(null);
    setPending(action);
    try {
      const signature = await task();
      await onComplete(signature, message);
    } catch (caught) {
      setError(txErrorMessage(caught));
    } finally {
      setPending(null);
    }
  }

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="text-xl leading-snug">{row.title}</CardTitle>
          <Badge variant={badgeVariant(row.state)}>{STATE_LABEL[row.state]}</Badge>
        </div>
        <CardDescription>
          {price} SOL · listed {when}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm leading-6">
        <p>
          Seller <AddressLink config={config} address={row.seller} />
          {isSeller ? " · this wallet" : ""}
        </p>
        <p>
          Buyer{" "}
          {row.buyer ? (
            <>
              <AddressLink config={config} address={row.buyer} />
              {isBuyer ? " · this wallet" : ""}
            </>
          ) : (
            "none yet"
          )}
        </p>
        <p>
          Listing account <AddressLink config={config} address={row.publicKey} />
          {" · "}
          balance {formatLamports(row.lamports)} SOL ({row.lamports} lamports)
        </p>
        {row.latestSignature ? (
          <p>
            Latest transaction <TxLink config={config} signature={row.latestSignature} />
          </p>
        ) : null}
        <details className="text-xs text-muted-foreground">
          <summary>Exact order fields</summary>
          <p>Price: {row.priceLamports} lamports</p>
          <p>Listing id: {row.listingId}</p>
        </details>
        <ActionCopy row={row} isSeller={isSeller} isBuyer={isBuyer} price={price} />
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Transaction failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row">
          {row.state === "listed" && isSeller ? (
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={pending !== null || writesPaused}
              onClick={() =>
                void run(
                  "cancel",
                  () => sendCancel(program, new PublicKey(row.seller), new PublicKey(row.publicKey)),
                  "Listing cancelled before payment.",
                )
              }
            >
              {pending === "cancel" ? "Cancelling…" : "Cancel listing"}
            </Button>
          ) : null}
          {row.state === "listed" && wallet && !isSeller ? (
            <Button
              type="button"
              className="h-11"
              disabled={pending !== null || writesPaused}
              onClick={() =>
                void run(
                  "buy",
                  () =>
                    sendBuy(
                      program,
                      new PublicKey(wallet),
                      new PublicKey(row.seller),
                      new PublicKey(row.publicKey),
                    ),
                  `Locked ${price} SOL in the listing account.`,
                )
              }
            >
              {pending === "buy" ? "Waiting for signature…" : `Buy for ${price} SOL`}
            </Button>
          ) : null}
          {row.state === "funded" && isBuyer ? (
            <Button
              type="button"
              className="h-11"
              disabled={pending !== null || writesPaused}
              onClick={() =>
                void run(
                  "confirm",
                  () =>
                    sendConfirm(
                      program,
                      new PublicKey(row.buyer!),
                      new PublicKey(row.seller),
                      new PublicKey(row.publicKey),
                    ),
                  `Released ${price} SOL of lamports to the recorded seller.`,
                )
              }
            >
              {pending === "confirm" ? "Confirming…" : "Confirm handover and release"}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function ActionCopy({
  row,
  isSeller,
  isBuyer,
  price,
}: {
  row: ListingRow;
  isSeller: boolean;
  isBuyer: boolean;
  price: string;
}) {
  if (row.state === "funded" && isSeller) {
    return (
      <p>
        {price} SOL is locked here. You cannot cancel after payment, and this
        program will not return the funds if the buyer never confirms.
      </p>
    );
  }
  if (row.state === "funded" && !isBuyer) {
    return (
      <p>
        Payment is locked in this listing account. Only the recorded buyer can
        release it.
      </p>
    );
  }
  if (row.state === "completed") {
    return (
      <p>
        The program sent the listed lamport amount to the seller and left the
        account open so this record can still be read. Rent stayed behind.
        Network fees are separate, so a wallet&apos;s net change is not only
        the item price.
      </p>
    );
  }
  if (row.state === "cancelled") {
    return (
      <p>
        Cancelled before payment. The item price was never escrowed. Rent for
        this account was not reclaimed.
      </p>
    );
  }
  if (row.state === "listed" && !isSeller) {
    return (
      <p>Buying moves exactly {price} SOL into this program-owned account.</p>
    );
  }
  return null;
}

function AddressLink({ config, address }: { config: ReadyConfig; address: string }) {
  const href = explorerAddress(config, address);
  const label = shortAddress(address);
  if (!href) return <span className="font-medium">{label}</span>;
  return (
    <a className="font-medium underline underline-offset-2" href={href} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  );
}

function TxLink({ config, signature }: { config: ReadyConfig; signature: string }) {
  const href = explorerTx(config, signature);
  const label = shortAddress(signature);
  if (!href) return <span className="font-medium">{label}</span>;
  return (
    <a className="font-medium underline underline-offset-2" href={href} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  );
}

function badgeVariant(state: ListingStateName): "default" | "secondary" | "destructive" | "outline" {
  if (state === "funded") return "default";
  if (state === "completed") return "secondary";
  if (state === "cancelled") return "destructive";
  return "outline";
}

function readOnlyWallet(): Wallet {
  const refuse = () => Promise.reject(new Error("Connect Phantom before signing."));
  return {
    publicKey: PublicKey.default,
    signTransaction: refuse,
    signAllTransactions: refuse,
  } as unknown as Wallet;
}
