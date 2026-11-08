# CampusEscrow

Campus secondhand trades often fail because one person has to trust the other first. Pay before the meeting and the seller can disappear. Hand over the textbook first and the buyer can walk away. A person acting as guarantor is slow for a 0.1 SOL book.

CampusEscrow is a small Solana program for that face-to-face case. The seller lists an item and a price in lamports. The buyer locks exactly that price in a program-owned account. After they meet and the buyer is satisfied, the buyer signs once and the program pays the recorded seller. The program does not see the textbook, and it does not decide who is right if the two people disagree.

Solana fits this because the listing and the locked lamports live in one program-derived account. Only this program can debit it. The buyer, seller, price, and state are readable by anyone, and a Devnet Explorer link can show the same account the page is reading. A campus-sized payment does not need a company in the middle.

This repository is a hackathon MVP for **Devnet and a local validator**. It is not a mainnet product.

## What is implemented

- Anchor program `campus_escrow` with `list_item`, `buy`, `confirm`, and `cancel`.
- One listing PDA per order. Seeds are `["listing", seller, listing_id]`. The same account stores the order and, after `buy`, holds the price above rent.
- States: listed, funded, completed, cancelled.
- `buy` moves exactly `price_lamports` from the buyer wallet into the listing account and records the buyer.
- `confirm` can be signed only by that buyer, only once, and credits exactly `price_lamports` to the seller stored on the listing. The recipient is not chosen at confirm time.
- `cancel` works only before payment, and only for the seller. It does not move the item price.
- Next.js app wired to the IDL: Phantom via the Solana Wallet Adapter, Devnet warning, listing form, accounts fetched with `getProgramAccounts`, role-specific actions, pending and error text, and Explorer links on Devnet.
- If the program account is missing, the page says so. It does not invent orders.

## What this MVP does not do

- It does not prove a physical handover.
- It does not settle disputes or offer arbitration.
- It has no timeout. A buyer who funds an order and never confirms leaves those lamports in the listing account.
- Cancelling a listing does not refund the rent that created the account.
- Lamports sent directly to a listing, outside `buy`, are not a feature and are not returned.
- It is not audited. The deployed program would have an upgrade authority. Do not describe it as immutable, fee-free, or safe for real money.
- `confirm` transfers the listed lamport amount. It does not promise that a wallet's overall balance changes by exactly 0.1 SOL. Listing rent and transaction fees are separate.

## Account design

`list_item` creates the PDA and the seller pays its rent-exempt minimum. That rent is not the item price. `buy` uses a system-program transfer of `price_lamports` onto the program-owned account. `confirm` subtracts that same integer from the listing and adds it to the stored seller, leaving at least the rent-exempt minimum so the completed record can still be read. Prices are `u64` lamports. The client converts a SOL string with integer math and rejects more than 9 decimal places.

Title length is 1 to 64 bytes after trimming. The price must be greater than zero. The seller cannot buy their own listing. A second buy, a second confirm, a cancel after funding, a confirm by anyone except the recorded buyer, and a confirm that names a different seller account all fail before lamports move.

## One-minute demo

The program is deployed on Devnet. See [Devnet status](#devnet-status). A browser session has listed items with Phantom. Browser buy and browser confirm have not been signed yet. The completed 0.1 SOL order below was a script, not a Phantom session.

1. Seller lists **Used calculus textbook** for **0.1 SOL** (100000000 lamports).
2. Buyer clicks **Buy**. The listing account balance increases by exactly that price. Rent was already there.
3. Buyer clicks **Confirm handover and release**. The program credits the seller wallet by 100000000 lamports and marks the order completed.
4. Open the listing account and the transaction signatures in Solana Explorer on Devnet.

The placeholders in the form are only hints. Nothing is submitted until a wallet signs.

## Layout

```text
programs/campus_escrow   Anchor program
tests/campus_escrow.ts   Local-validator tests
web/                     Next.js app
web/src/idl/             IDL copied from target/idl after a build
scripts/test-program.sh  Test entry point
scripts/build-program.sh Build and copy the IDL
scripts/devnet-two-wallets.mjs
docs/HANDOFF.zh-CN.md    Beginner setup in Chinese
docs/mlh-submission-note.md
```

## View the deployed Devnet program

The program is already on Devnet at `13xMGTJyfEDXXkYjqvhej8gvQoSypSeMWUTSAQrM7CUE`. Do not generate a new program id or deploy again to look at it. The beginner steps are only in `docs/HANDOFF.zh-CN.md`: work in `CampusEscrow/web`, copy `.env.example` to `.env.local`, run `npm ci`, then `npm run dev`, and open http://127.0.0.1:43123 with Phantom set to Devnet. The user has listed from the browser. Browser buy and browser confirm are still untested. One older test order, `435sWW5DgjUeRZqNpHoNJBPffjUULPCJpGo9gZKvupMV`, is still funded because its buyer key was lost; leave it. This MVP is Devnet-only and has not been audited.

## Local validator, only if you change the program

The source tree does not contain program keypairs or wallet files. `.campus-escrow-private/` is gitignored and holds disposable demo keys if that script is run; do not zip or commit it.

Tested here with Rust 1.99.1, Solana CLI 4.3.2 (Agave), Anchor CLI 1.2.2, and Node.js 22.

```bash
npm install
bash scripts/test-program.sh
```

When `target/deploy/campus_escrow-keypair.json` is absent, `scripts/test-program.sh` does this, in order:

1. `anchor build`, which creates that gitignored program keypair.
2. `anchor keys sync`, which rewrites `declare_id!` and `Anchor.toml` to the new public key.
3. `anchor build` again, so the binary matches the synced id.
4. Copies `target/idl/campus_escrow.json` and `target/types/campus_escrow.ts` into `web/src/idl/`.
5. Prints the new program id. Put that public key in `web/.env.local` as `NEXT_PUBLIC_PROGRAM_ID`. The value in `.env.example` will not match the new IDL until you replace it.
6. Runs `anchor test --validator legacy`.

`scripts/build-program.sh` only builds and copies the IDL. It does not run `anchor keys sync`. On a fresh tree, run `scripts/test-program.sh` (or the same sync steps) before trusting the copied IDL.

Then:

```bash
cp web/.env.example web/.env.local
# edit NEXT_PUBLIC_PROGRAM_ID if keys sync printed a different public key
cd web && npm install && npm run dev
```

`npm run dev` listens on port 43123 of the machine where it is started. `.env.example` has cluster name, RPC URL, and a public program id. It has no wallet secret.

## Tests and builds that ran

Local validator, not Devnet:

```bash
anchor test --validator legacy
```

Anchor 1.2 defaults to Surfpool, which is not installed here. `--validator legacy` is `solana-test-validator`. The run compiled the program, deployed it to that validator, and executed the transactions below. **8 passing (16s).** Exit code 0.

- locks 0.1 SOL and releases exactly that amount to the recorded seller
- lets the seller cancel before payment and then blocks buy and confirm
- rejects confirmation from anyone except the recorded buyer
- stops the seller from cancelling or withdrawing after funds are locked
- rejects a second buy and a second confirm
- does not pay a different seller or release a different order
- rejects empty, blank, overlong titles and a zero price
- rejects cancel by a non-seller, self-purchase, and reusing a listing id

The happy-path test checks integer lamports: the buyer decreases by the price, the listing increases by the price above rent, and `confirm` increases the seller by the price while the listing returns to its rent balance. The provider wallet pays the test transaction fees, so those fees are not mixed into the buyer and seller deltas.

Also run:

| Command | Result |
| --- | --- |
| `npx prettier --check tests migrations` | Passed |
| `cd web && npx eslint .` | Passed |
| `cd web && npx next build` | Passed (Next.js 16.4.5) |

`cd web && npx tsc --noEmit` is part of `next build` and passed there. Root `npm test` calls the same `anchor test --validator legacy` command; the recorded run was the `anchor` command itself.

Surfpool tests were not run again. The program source did not change after the local-validator run.

## Devnet status

`anchor program deploy --provider.cluster devnet` on Anchor CLI 1.2.2 succeeded. Upgrade authority is still the deployer. It was not revoked.

Before that command, `solana balance` on cluster `https://api.devnet.solana.com` showed **10 SOL** for `EGZjWhXnpyvaJafxn1waTTHyU8hLHN5u8KPE4rZEvfMr`. That public key matches both `solana address` and `solana-keygen pubkey` on the configured signer. The program account did not exist yet. After deployment and the scripted orders below, the same wallet read **8.148514843 SOL**.

- Program: `13xMGTJyfEDXXkYjqvhej8gvQoSypSeMWUTSAQrM7CUE`
- Executable: true. Owner: `BPFLoaderUpgradeab1e11111111111111111111111`
- Program data: `8bqRrYRCsW4VywALyNoUBzR3iew3CEX98ELLeSdopThN`, 165272 bytes, balance 0.8404606 SOL
- Program account balance: 0.00083312 SOL
- IDL metadata account: `G5eSAxeWXk2gHMMCoGu3nvZuWSYHWBzLZtFPPRfE93C9`
- Explorer: https://explorer.solana.com/address/13xMGTJyfEDXXkYjqvhej8gvQoSypSeMWUTSAQrM7CUE?cluster=devnet

`node scripts/devnet-two-wallets.mjs` then sent real Devnet transactions. It funded disposable wallets from the deployer (0.2, 0.25, and 0.05 SOL) instead of calling the faucet. One completed order:

| Step | Result |
| --- | --- |
| List "Used calculus textbook" for 100000000 lamports | https://explorer.solana.com/tx/5cdBY77XSWAF5uFWuMq6xFwCoru6Nf2nFUJvpd4TXkEnsxR4WTEKazcpH6MNdnsdrAAkaiNsVW2kEVGYUJBY5eUZ?cluster=devnet |
| Buy | Listing `94wKJzgqtpqCGhFwgscARZL39YV1bCkwHmF4RArAEvbE` balance became 101493520 lamports. Rent was 1493520, so the locked price was exactly 100000000. Buyer wallet dropped 100005000, which is the price plus a 5000 lamport fee. https://explorer.solana.com/tx/vejTEiaVjSjao4cRg4KWr3oqawMRKpCrCVAdqYdTrr5bgu7GZQz6ihJCQaMhgQ9fdhd2A6uUToya4BRQuhT6jrd?cluster=devnet |
| Stranger `confirm` | Landed and failed on chain with `UnauthorizedBuyer` (custom 6004), fee 5000. Price stayed locked. https://explorer.solana.com/tx/4dnVmtrodnJKMhqn1rEVba8ih9amaQRMqvech4TuJ8T59zdw1efnrKE1z98e7i1sdbgdmvYMSnsCfKbJ1GMiQwv2?cluster=devnet |
| Buyer `confirm` | Seller balance increased by exactly 100000000 lamports. Listing returned to 1493520. State `completed`. https://explorer.solana.com/tx/3kdHCgqKvvswBNzAKViW7htsAPWn1VSUbP1eGTzvjV9kCEy6LXx3T3ho1QXw7YBS6678g7YaWyzXHcji1xMo34F8?cluster=devnet |

A separate scratch-paper listing was cancelled before payment. Cancel: https://explorer.solana.com/tx/4ciUD5zzTfdyTdGUJiFZt9qkC5N5HdnHszCX5b6385K9QjfU8j64jieqovhwUPeAxo5fg6brT9tW8T3nWu2gDpzS?cluster=devnet . Account `5ftde4UdjDaFmJxcz83j4a79cCE46wjpUJmBtEbkWscH` stayed at the rent balance 1493520. A following buy was rejected in preflight with `InvalidState`; that rejection did not land as its own transaction.

An earlier script process bought a textbook and then lost the ephemeral buyer key when an RPC 429 hid the unauthorized-confirm result. That order is still `funded` and cannot be released: listing `435sWW5DgjUeRZqNpHoNJBPffjUULPCJpGo9gZKvupMV`, balance 101493520 lamports (1493520 rent + 100000000 price). Its on-chain denial is https://explorer.solana.com/tx/3MHVgrAyg4LWZjgAo4CNkXYRju12XLqSywKpphzgx8dfwcf4guQ7k1LuMt9DKN4Wrw4H9mkjJYiySHdGpP6mZKez?cluster=devnet . This is test SOL stuck by the program rules, not a mainnet loss.

Those Devnet results used script-generated keypairs. Separately, a person has listed from Phantom in a browser (two listings). Browser buy and browser confirm have not been done. The lost-key order above is still funded with 0.1 test SOL.

There is no hosted frontend. `npm run dev` listens only on the machine that starts it. This workspace does not publish that port for someone else to open.
