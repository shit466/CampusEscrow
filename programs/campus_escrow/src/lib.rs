use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("13xMGTJyfEDXXkYjqvhej8gvQoSypSeMWUTSAQrM7CUE");

/// Campus secondhand escrow.
///
/// One listing PDA stores the order and, once bought, holds the item price
/// above the rent-exempt minimum. Only this program can debit that account.
/// The buyer releasing funds is an on-chain signature check. It does not
/// prove that a textbook changed hands.
#[program]
pub mod campus_escrow {
    use super::*;

    pub fn list_item(
        ctx: Context<ListItem>,
        listing_id: u64,
        title: String,
        price_lamports: u64,
    ) -> Result<()> {
        let title = title.trim().to_string();
        require!(!title.is_empty(), EscrowError::TitleEmpty);
        require!(title.len() <= MAX_TITLE_LEN, EscrowError::TitleTooLong);
        require!(price_lamports > 0, EscrowError::PriceNotPositive);

        let listing = &mut ctx.accounts.listing;
        listing.seller = ctx.accounts.seller.key();
        listing.buyer = Pubkey::default();
        listing.price_lamports = price_lamports;
        listing.listing_id = listing_id;
        listing.created_at = Clock::get()?.unix_timestamp;
        listing.state = ListingState::Listed;
        listing.bump = ctx.bumps.listing;
        listing.title = title.clone();

        emit!(ItemListed {
            listing: listing.key(),
            seller: listing.seller,
            listing_id,
            price_lamports,
            title,
        });
        Ok(())
    }

    pub fn buy(ctx: Context<Buy>) -> Result<()> {
        let price = ctx.accounts.listing.price_lamports;
        require!(
            ctx.accounts.listing.state == ListingState::Listed,
            EscrowError::InvalidState
        );
        require!(price > 0, EscrowError::PriceNotPositive);
        require_keys_eq!(
            ctx.accounts.seller.key(),
            ctx.accounts.listing.seller,
            EscrowError::SellerMismatch
        );
        require!(
            ctx.accounts.buyer.key() != ctx.accounts.listing.seller,
            EscrowError::SellerCannotBuy
        );

        let listing_info = ctx.accounts.listing.to_account_info();
        let balance_before = listing_info.lamports();

        let cpi_accounts = system_program::Transfer {
            from: ctx.accounts.buyer.to_account_info(),
            to: listing_info,
        };
        let cpi_ctx = CpiContext::new(system_program::ID, cpi_accounts);
        system_program::transfer(cpi_ctx, price)?;

        let balance_after = ctx.accounts.listing.to_account_info().lamports();
        require!(
            balance_after
                == balance_before
                    .checked_add(price)
                    .ok_or(EscrowError::MathOverflow)?,
            EscrowError::EscrowAmountMismatch
        );

        let listing = &mut ctx.accounts.listing;
        listing.buyer = ctx.accounts.buyer.key();
        listing.state = ListingState::Funded;

        emit!(ItemFunded {
            listing: listing.key(),
            buyer: listing.buyer,
            seller: listing.seller,
            price_lamports: price,
        });
        Ok(())
    }

    pub fn confirm(ctx: Context<Confirm>) -> Result<()> {
        let price = ctx.accounts.listing.price_lamports;
        require!(
            ctx.accounts.listing.state == ListingState::Funded,
            EscrowError::InvalidState
        );
        require!(price > 0, EscrowError::PriceNotPositive);
        require!(
            ctx.accounts.listing.buyer != Pubkey::default(),
            EscrowError::UnauthorizedBuyer
        );
        require_keys_eq!(
            ctx.accounts.buyer.key(),
            ctx.accounts.listing.buyer,
            EscrowError::UnauthorizedBuyer
        );
        require_keys_eq!(
            ctx.accounts.seller.key(),
            ctx.accounts.listing.seller,
            EscrowError::SellerMismatch
        );

        let rent = Rent::get()?.minimum_balance(ctx.accounts.listing.to_account_info().data_len());
        let balance = ctx.accounts.listing.get_lamports();
        let minimum = rent.checked_add(price).ok_or(EscrowError::MathOverflow)?;
        require!(balance >= minimum, EscrowError::InsufficientEscrow);

        // Move the listed price only. Rent, and any stray lamports, stay in
        // the listing account so the completed record remains readable.
        ctx.accounts.listing.sub_lamports(price)?;
        ctx.accounts.seller.add_lamports(price)?;
        ctx.accounts.listing.state = ListingState::Completed;

        emit!(ItemConfirmed {
            listing: ctx.accounts.listing.key(),
            buyer: ctx.accounts.buyer.key(),
            seller: ctx.accounts.seller.key(),
            price_lamports: price,
        });
        Ok(())
    }

    pub fn cancel(ctx: Context<Cancel>) -> Result<()> {
        require!(
            ctx.accounts.listing.state == ListingState::Listed,
            EscrowError::InvalidState
        );
        require_keys_eq!(
            ctx.accounts.seller.key(),
            ctx.accounts.listing.seller,
            EscrowError::UnauthorizedSeller
        );

        // Listed orders have not escrowed the item price. Cancellation only
        // flips state. It does not pay anyone and cannot run after `buy`.
        ctx.accounts.listing.state = ListingState::Cancelled;
        ctx.accounts.listing.buyer = Pubkey::default();

        emit!(ItemCancelled {
            listing: ctx.accounts.listing.key(),
            seller: ctx.accounts.seller.key(),
        });
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(listing_id: u64)]
pub struct ListItem<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(
        init,
        payer = seller,
        space = 8 + Listing::INIT_SPACE,
        seeds = [LISTING_SEED, seller.key().as_ref(), &listing_id.to_le_bytes()],
        bump
    )]
    pub listing: Account<'info, Listing>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Buy<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(constraint = seller.key() == listing.seller @ EscrowError::SellerMismatch)]
    pub seller: SystemAccount<'info>,
    #[account(
        mut,
        seeds = [LISTING_SEED, seller.key().as_ref(), &listing.listing_id.to_le_bytes()],
        bump = listing.bump,
        constraint = listing.state == ListingState::Listed @ EscrowError::InvalidState
    )]
    pub listing: Account<'info, Listing>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Confirm<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(
        mut,
        constraint = seller.key() == listing.seller @ EscrowError::SellerMismatch
    )]
    pub seller: SystemAccount<'info>,
    #[account(
        mut,
        seeds = [LISTING_SEED, seller.key().as_ref(), &listing.listing_id.to_le_bytes()],
        bump = listing.bump,
        constraint = listing.state == ListingState::Funded @ EscrowError::InvalidState,
        constraint = buyer.key() == listing.buyer @ EscrowError::UnauthorizedBuyer
    )]
    pub listing: Account<'info, Listing>,
}

#[derive(Accounts)]
pub struct Cancel<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(
        mut,
        seeds = [LISTING_SEED, seller.key().as_ref(), &listing.listing_id.to_le_bytes()],
        bump = listing.bump,
        constraint = listing.state == ListingState::Listed @ EscrowError::InvalidState,
        constraint = seller.key() == listing.seller @ EscrowError::UnauthorizedSeller
    )]
    pub listing: Account<'info, Listing>,
}

#[account]
#[derive(InitSpace)]
pub struct Listing {
    pub seller: Pubkey,
    pub buyer: Pubkey,
    pub price_lamports: u64,
    pub listing_id: u64,
    pub created_at: i64,
    pub state: ListingState,
    pub bump: u8,
    #[max_len(64)]
    pub title: String,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum ListingState {
    Listed,
    Funded,
    Completed,
    Cancelled,
}

#[event]
pub struct ItemListed {
    pub listing: Pubkey,
    pub seller: Pubkey,
    pub listing_id: u64,
    pub price_lamports: u64,
    pub title: String,
}

#[event]
pub struct ItemFunded {
    pub listing: Pubkey,
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub price_lamports: u64,
}

#[event]
pub struct ItemConfirmed {
    pub listing: Pubkey,
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub price_lamports: u64,
}

#[event]
pub struct ItemCancelled {
    pub listing: Pubkey,
    pub seller: Pubkey,
}

#[error_code]
pub enum EscrowError {
    #[msg("Title must not be empty")]
    TitleEmpty,
    #[msg("Title exceeds 64 bytes")]
    TitleTooLong,
    #[msg("Price must be a positive number of lamports")]
    PriceNotPositive,
    #[msg("Listing is not in the required state")]
    InvalidState,
    #[msg("Only the recorded buyer can confirm")]
    UnauthorizedBuyer,
    #[msg("Only the recorded seller can cancel")]
    UnauthorizedSeller,
    #[msg("Seller account does not match the listing")]
    SellerMismatch,
    #[msg("Seller cannot buy their own listing")]
    SellerCannotBuy,
    #[msg("Escrow balance does not match the listing price")]
    EscrowAmountMismatch,
    #[msg("Escrow does not hold the listing price above rent")]
    InsufficientEscrow,
    #[msg("Arithmetic overflow")]
    MathOverflow,
}

#[constant]
pub const LISTING_SEED: &[u8] = b"listing";

pub const MAX_TITLE_LEN: usize = 64;
