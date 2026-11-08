# CampusEscrow — Solana escrow for campus secondhand trades

## One-liner

Buyers lock test SOL in a program-owned listing account until they confirm; the program then pays the recorded seller exactly the listed lamport amount. Built for same-campus handovers where paying first, or handing the item over first, both feel bad.

## Problem

Campus buy/sell chats run on trust. Pay first and the seller may not show up. Hand over the textbook first and the buyer may not pay. Asking a friend to hold the money is awkward for a small trade.

## What the MVP actually does

On a local validator, and on Devnet only after a successful deploy:

1. The seller lists a title and a price in lamports with `list_item`.
2. The buyer calls `buy`. Exactly that price moves into the listing PDA. The program records the buyer.
3. The recorded buyer calls `confirm` once. The program credits that price to the seller stored on the listing.
4. Before anyone pays, the seller can `cancel`. After payment, cancel does nothing and the seller cannot withdraw.

The page reads those accounts from the cluster. It does not store orders in the browser.

## Demo intended for two Phantom wallets

About one minute, after the program is deployed to Devnet:

- Wallet B lists "Used calculus textbook" for 0.1 SOL (100000000 lamports).
- Wallet A buys. The listing account's balance is the rent it already held, plus 100000000 lamports. Explorer can show that account.
- Wallet A confirms. The seller wallet is credited 100000000 lamports by that instruction, and the order is marked completed.

Rent for the listing account and network fees are separate. Do not describe the seller's net wallet change across the whole demo as exactly +0.1 SOL.

## What was verified in this workspace

`anchor test --validator legacy` deployed the program to `solana-test-validator` and passed 8 tests: happy path with exact lamport deltas, cancel before payment, unauthorized confirm, seller cancel after funding, repeated buy and confirm, cross-order and wrong-recipient attempts, and invalid title or price.

`npx next build` in `web/` passed. The UI shows a Devnet warning, the lock-forever warning, and a clear message when the program account is missing.

## What is not true yet

Devnet deployment succeeded with `anchor program deploy --provider.cluster devnet` on Anchor CLI 1.2.2. The observed balance before deploy was 10 SOL on `EGZjWhXnpyvaJafxn1waTTHyU8hLHN5u8KPE4rZEvfMr`. The program `13xMGTJyfEDXXkYjqvhej8gvQoSypSeMWUTSAQrM7CUE` is executable, and that same wallet remains the upgrade authority. After deployment and the scripted orders, the wallet balance was 8.148514843 SOL.

https://explorer.solana.com/address/13xMGTJyfEDXXkYjqvhej8gvQoSypSeMWUTSAQrM7CUE?cluster=devnet

`node scripts/devnet-two-wallets.mjs` completed on Devnet. Listing `94wKJzgqtpqCGhFwgscARZL39YV1bCkwHmF4RArAEvbE` held exactly 100000000 lamports above 1493520 lamports of rent after buy, then `confirm` credited the recorded seller exactly 100000000 lamports and left the account at rent with state completed. A stranger `confirm` landed and failed with `UnauthorizedBuyer`. A separate listing was cancelled before payment. One earlier textbook order, `435sWW5DgjUeRZqNpHoNJBPffjUULPCJpGo9gZKvupMV`, is still funded with 0.1 test SOL because that process exited before confirm and the ephemeral buyer key was not kept.

Completed confirm: https://explorer.solana.com/tx/3kdHCgqKvvswBNzAKViW7htsAPWn1VSUbP1eGTzvjV9kCEy6LXx3T3ho1QXw7YBS6678g7YaWyzXHcji1xMo34F8?cluster=devnet

This was a scripted Devnet run. It was not a Phantom browser session. There is no public frontend URL.

## Scope

Face-to-face handover and a buyer signature. The program does not verify physical delivery and does not settle disputes. A funded buyer who never confirms leaves the price locked. There is no timeout refund. The program is unaudited. The Devnet deploy kept the deployer as upgrade authority, so this is not immutable production code. There is no AI feature.

## Prize categories that match the built project

- Best Beginner Hack, if the entrant is eligible
- DeFi track only as a small escrow payment, not as a lending or trading protocol

Do not check the AI track.

## Links

- Devnet program: https://explorer.solana.com/address/13xMGTJyfEDXXkYjqvhej8gvQoSypSeMWUTSAQrM7CUE?cluster=devnet
- Completed confirm: https://explorer.solana.com/tx/3kdHCgqKvvswBNzAKViW7htsAPWn1VSUbP1eGTzvjV9kCEy6LXx3T3ho1QXw7YBS6678g7YaWyzXHcji1xMo34F8?cluster=devnet
- Repository URL, once this private draft is published
- Frontend URL, after the owner connects hosting. None exists yet.
- A Phantom browser recording. None exists yet.
