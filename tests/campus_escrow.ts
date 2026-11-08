import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { assert } from "chai";
import { CampusEscrow } from "../target/types/campus_escrow";

const PRICE = 100_000_000; // 0.1 SOL, integer lamports

describe("campus_escrow", () => {
  const env = anchor.AnchorProvider.env();
  const provider = new anchor.AnchorProvider(env.connection, env.wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  anchor.setProvider(provider);
  const program = anchor.workspace.campusEscrow as Program<CampusEscrow>;
  const connection = provider.connection;
  let nextId = BigInt(Date.now()) * 1000n;

  function freshId(): anchor.BN {
    nextId += 1n;
    return new anchor.BN(nextId.toString());
  }

  function pda(seller: anchor.web3.PublicKey, listingId: anchor.BN) {
    const [listing] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("listing"),
        seller.toBuffer(),
        listingId.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );
    return listing;
  }

  async function fund(pubkey: anchor.web3.PublicKey, sol = 2) {
    const signature = await connection.requestAirdrop(
      pubkey,
      sol * anchor.web3.LAMPORTS_PER_SOL
    );
    const latest = await connection.getLatestBlockhash();
    await connection.confirmTransaction(
      {
        signature,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      },
      "confirmed"
    );
  }

  async function balance(pubkey: anchor.web3.PublicKey) {
    return connection.getBalance(pubkey, "confirmed");
  }

  async function list(
    seller: anchor.web3.Keypair,
    title: string,
    price: number,
    listingId = freshId()
  ) {
    const listing = pda(seller.publicKey, listingId);
    await program.methods
      .listItem(listingId, title, new anchor.BN(price))
      .accountsPartial({ seller: seller.publicKey, listing })
      .signers([seller])
      .rpc();
    return { listing, listingId };
  }

  async function buy(
    buyer: anchor.web3.Keypair,
    seller: anchor.web3.PublicKey,
    listing: anchor.web3.PublicKey
  ) {
    await program.methods
      .buy()
      .accountsPartial({ buyer: buyer.publicKey, seller, listing })
      .signers([buyer])
      .rpc();
  }

  async function confirm(
    buyer: anchor.web3.Keypair,
    seller: anchor.web3.PublicKey,
    listing: anchor.web3.PublicKey
  ) {
    await program.methods
      .confirm()
      .accountsPartial({ buyer: buyer.publicKey, seller, listing })
      .signers([buyer])
      .rpc();
  }

  async function expectFail(label: string, run: () => Promise<unknown>) {
    try {
      await run();
    } catch (err) {
      const text = errText(err);
      assert.notInclude(text, "expected failure", label);
      return text;
    }
    assert.fail(`expected failure: ${label}`);
  }

  it("locks 0.1 SOL and releases exactly that amount to the recorded seller", async () => {
    const seller = anchor.web3.Keypair.generate();
    const buyer = anchor.web3.Keypair.generate();
    await fund(seller.publicKey);
    await fund(buyer.publicKey);

    const { listing } = await list(seller, "Used calculus textbook", PRICE);
    const afterList = await program.account.listing.fetch(listing);
    assert.equal(stateName(afterList.state), "listed");
    assert.equal(afterList.title, "Used calculus textbook");
    assert.equal(afterList.priceLamports.toNumber(), PRICE);
    assert.ok(afterList.seller.equals(seller.publicKey));
    assert.ok(afterList.buyer.equals(anchor.web3.PublicKey.default));

    const infoAfterList = await connection.getAccountInfo(listing);
    assert.ok(infoAfterList);
    assert.ok(infoAfterList.owner.equals(program.programId));
    const rent = infoAfterList.lamports;
    assert.isAbove(rent, 0);

    const buyerBefore = await balance(buyer.publicKey);
    const sellerBeforeRelease = await balance(seller.publicKey);
    await buy(buyer, seller.publicKey, listing);

    const funded = await program.account.listing.fetch(listing);
    assert.equal(stateName(funded.state), "funded");
    assert.ok(funded.buyer.equals(buyer.publicKey));
    const escrowBalance = await balance(listing);
    assert.equal(escrowBalance - rent, PRICE);
    assert.equal((await balance(buyer.publicKey)) + PRICE, buyerBefore);

    await confirm(buyer, seller.publicKey, listing);

    const done = await program.account.listing.fetch(listing);
    assert.equal(stateName(done.state), "completed");
    assert.ok(done.buyer.equals(buyer.publicKey));
    assert.ok(done.seller.equals(seller.publicKey));
    assert.equal(await balance(listing), rent);
    assert.equal(
      (await balance(seller.publicKey)) - sellerBeforeRelease,
      PRICE
    );
    assert.equal(await balance(buyer.publicKey), buyerBefore - PRICE);
  });

  it("lets the seller cancel before payment and then blocks buy and confirm", async () => {
    const seller = anchor.web3.Keypair.generate();
    const buyer = anchor.web3.Keypair.generate();
    await fund(seller.publicKey);
    await fund(buyer.publicKey);
    const sellerBefore = await balance(seller.publicKey);
    const { listing } = await list(seller, "Lab goggles", PRICE);
    const rent = await balance(listing);

    await program.methods
      .cancel()
      .accountsPartial({ seller: seller.publicKey, listing })
      .signers([seller])
      .rpc();

    const cancelled = await program.account.listing.fetch(listing);
    assert.equal(stateName(cancelled.state), "cancelled");
    assert.equal(await balance(listing), rent);
    assert.equal(await balance(seller.publicKey), sellerBefore - rent);

    const buyerBefore = await balance(buyer.publicKey);
    const buyError = await expectFail("buy after cancel", () =>
      buy(buyer, seller.publicKey, listing)
    );
    assert.include(buyError, "InvalidState");
    assert.equal(await balance(buyer.publicKey), buyerBefore);
    assert.equal(await balance(listing), rent);

    const confirmError = await expectFail("confirm after cancel", () =>
      confirm(buyer, seller.publicKey, listing)
    );
    assert.include(confirmError, "InvalidState");
  });

  it("rejects confirmation from anyone except the recorded buyer", async () => {
    const seller = anchor.web3.Keypair.generate();
    const buyer = anchor.web3.Keypair.generate();
    const stranger = anchor.web3.Keypair.generate();
    await fund(seller.publicKey);
    await fund(buyer.publicKey);
    await fund(stranger.publicKey);
    const { listing } = await list(seller, "Graphing calculator", PRICE);
    await buy(buyer, seller.publicKey, listing);

    const escrowBefore = await balance(listing);
    const sellerBefore = await balance(seller.publicKey);

    const strangerError = await expectFail("stranger confirm", () =>
      confirm(stranger, seller.publicKey, listing)
    );
    assert.include(strangerError, "UnauthorizedBuyer");

    const sellerError = await expectFail("seller confirm", () =>
      confirm(seller, seller.publicKey, listing)
    );
    assert.include(sellerError, "UnauthorizedBuyer");

    assert.equal(await balance(listing), escrowBefore);
    assert.equal(await balance(seller.publicKey), sellerBefore);
    assert.equal(
      stateName((await program.account.listing.fetch(listing)).state),
      "funded"
    );
  });

  it("stops the seller from cancelling or withdrawing after funds are locked", async () => {
    const seller = anchor.web3.Keypair.generate();
    const buyer = anchor.web3.Keypair.generate();
    await fund(seller.publicKey);
    await fund(buyer.publicKey);
    const { listing } = await list(seller, "Desk lamp", PRICE);
    await buy(buyer, seller.publicKey, listing);

    const escrowBefore = await balance(listing);
    const sellerBefore = await balance(seller.publicKey);
    const cancelError = await expectFail("cancel after funding", () =>
      program.methods
        .cancel()
        .accountsPartial({ seller: seller.publicKey, listing })
        .signers([seller])
        .rpc()
    );
    assert.include(cancelError, "InvalidState");
    assert.equal(await balance(listing), escrowBefore);
    assert.equal(await balance(seller.publicKey), sellerBefore);

    await confirm(buyer, seller.publicKey, listing);
    assert.equal((await balance(seller.publicKey)) - sellerBefore, PRICE);
  });

  it("rejects a second buy and a second confirm", async () => {
    const seller = anchor.web3.Keypair.generate();
    const buyer = anchor.web3.Keypair.generate();
    const otherBuyer = anchor.web3.Keypair.generate();
    await fund(seller.publicKey);
    await fund(buyer.publicKey);
    await fund(otherBuyer.publicKey);
    const { listing } = await list(seller, "Winter coat", PRICE);
    await buy(buyer, seller.publicKey, listing);

    const otherBefore = await balance(otherBuyer.publicKey);
    const escrowBefore = await balance(listing);
    const repeatBuy = await expectFail("second buy", () =>
      buy(otherBuyer, seller.publicKey, listing)
    );
    assert.include(repeatBuy, "InvalidState");
    assert.equal(await balance(otherBuyer.publicKey), otherBefore);
    assert.equal(await balance(listing), escrowBefore);

    const sellerBefore = await balance(seller.publicKey);
    await confirm(buyer, seller.publicKey, listing);
    const afterFirst = await balance(seller.publicKey);
    assert.equal(afterFirst - sellerBefore, PRICE);

    const repeatConfirm = await expectFail("second confirm", () =>
      confirm(buyer, seller.publicKey, listing)
    );
    assert.include(repeatConfirm, "InvalidState");
    assert.equal(await balance(seller.publicKey), afterFirst);
    assert.equal(await balance(listing), escrowBefore - PRICE);

    const buyAfter = await expectFail("buy after complete", () =>
      buy(otherBuyer, seller.publicKey, listing)
    );
    assert.include(buyAfter, "InvalidState");
    const cancelAfter = await expectFail("cancel after complete", () =>
      program.methods
        .cancel()
        .accountsPartial({ seller: seller.publicKey, listing })
        .signers([seller])
        .rpc()
    );
    assert.include(cancelAfter, "InvalidState");
  });

  it("does not pay a different seller or release a different order", async () => {
    const sellerA = anchor.web3.Keypair.generate();
    const sellerB = anchor.web3.Keypair.generate();
    const buyerA = anchor.web3.Keypair.generate();
    const buyerB = anchor.web3.Keypair.generate();
    await fund(sellerA.publicKey);
    await fund(sellerB.publicKey);
    await fund(buyerA.publicKey);
    await fund(buyerB.publicKey);

    const orderA = await list(sellerA, "Calculus A", PRICE);
    const orderB = await list(sellerB, "Calculus B", 50_000_000);
    await buy(buyerA, sellerA.publicKey, orderA.listing);
    await buy(buyerB, sellerB.publicKey, orderB.listing);

    const escrowA = await balance(orderA.listing);
    const escrowB = await balance(orderB.listing);
    const sellerABefore = await balance(sellerA.publicKey);
    const sellerBBefore = await balance(sellerB.publicKey);

    const wrongRecipient = await expectFail("confirm A paying seller B", () =>
      confirm(buyerA, sellerB.publicKey, orderA.listing)
    );
    assert.match(
      wrongRecipient,
      /SellerMismatch|seeds constraint|ConstraintSeeds/i
    );

    const crossBuyer = await expectFail("buyer B confirms order A", () =>
      confirm(buyerB, sellerA.publicKey, orderA.listing)
    );
    assert.include(crossBuyer, "UnauthorizedBuyer");

    const wrongOrder = await expectFail("buyer A confirms order B", () =>
      confirm(buyerA, sellerB.publicKey, orderB.listing)
    );
    assert.include(wrongOrder, "UnauthorizedBuyer");

    const cancelOther = await expectFail("seller A cancels order B", () =>
      program.methods
        .cancel()
        .accountsPartial({ seller: sellerA.publicKey, listing: orderB.listing })
        .signers([sellerA])
        .rpc()
    );
    assert.match(
      cancelOther,
      /InvalidState|UnauthorizedSeller|seeds constraint|ConstraintSeeds/i
    );

    assert.equal(await balance(orderA.listing), escrowA);
    assert.equal(await balance(orderB.listing), escrowB);
    assert.equal(await balance(sellerA.publicKey), sellerABefore);
    assert.equal(await balance(sellerB.publicKey), sellerBBefore);

    await confirm(buyerA, sellerA.publicKey, orderA.listing);
    assert.equal((await balance(sellerA.publicKey)) - sellerABefore, PRICE);
    assert.equal(await balance(sellerB.publicKey), sellerBBefore);
    assert.equal(
      stateName((await program.account.listing.fetch(orderB.listing)).state),
      "funded"
    );
    assert.equal(await balance(orderB.listing), escrowB);
  });

  it("rejects empty, blank, overlong titles and a zero price", async () => {
    const seller = anchor.web3.Keypair.generate();
    await fund(seller.publicKey);

    const empty = await expectFail("empty title", () =>
      list(seller, "", PRICE)
    );
    assert.include(empty, "TitleEmpty");

    const blank = await expectFail("blank title", () =>
      list(seller, "   ", PRICE)
    );
    assert.include(blank, "TitleEmpty");

    const longTitle = "x".repeat(65);
    const tooLong = await expectFail("65 byte title", () =>
      list(seller, longTitle, PRICE)
    );
    assert.include(tooLong, "TitleTooLong");

    const zero = await expectFail("zero price", () =>
      list(seller, "Free pencil", 0)
    );
    assert.include(zero, "PriceNotPositive");

    const maxTitle = "y".repeat(64);
    const { listing } = await list(seller, maxTitle, 1);
    const stored = await program.account.listing.fetch(listing);
    assert.equal(stored.title, maxTitle);
    assert.equal(stored.priceLamports.toNumber(), 1);
    assert.equal(stateName(stored.state), "listed");
  });

  it("rejects cancel by a non-seller, self-purchase, and reusing a listing id", async () => {
    const seller = anchor.web3.Keypair.generate();
    const other = anchor.web3.Keypair.generate();
    await fund(seller.publicKey);
    await fund(other.publicKey);
    const listingId = freshId();
    const { listing } = await list(seller, "Bike lock", PRICE, listingId);

    const strangerCancel = await expectFail("non-seller cancel", () =>
      program.methods
        .cancel()
        .accountsPartial({ seller: other.publicKey, listing })
        .signers([other])
        .rpc()
    );
    assert.match(
      strangerCancel,
      /UnauthorizedSeller|seeds constraint|ConstraintSeeds/i
    );
    assert.equal(
      stateName((await program.account.listing.fetch(listing)).state),
      "listed"
    );

    const selfBuy = await expectFail("seller buys own listing", () =>
      buy(seller, seller.publicKey, listing)
    );
    assert.include(selfBuy, "SellerCannotBuy");

    const duplicate = await expectFail("same listing id", () =>
      list(seller, "Bike lock again", PRICE, listingId)
    );
    assert.match(duplicate, /already in use|Allocate: account/i);
  });
});

function stateName(state: unknown): string {
  if (typeof state === "object" && state !== null) {
    const key = Object.keys(state)[0];
    if (key) return key;
  }
  return String(state);
}

function errText(err: unknown): string {
  if (err instanceof anchor.AnchorError) {
    return `${err.error.errorCode.code} ${err.error.errorMessage}\n${(
      err.logs ?? []
    ).join("\n")}`;
  }
  if (err instanceof Error) {
    const logs = (err as Error & { logs?: string[] }).logs ?? [];
    return `${err.message}\n${logs.join("\n")}`;
  }
  return String(err);
}
