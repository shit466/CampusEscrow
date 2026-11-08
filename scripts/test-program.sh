#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="${HOME}/.local/bin:${HOME}/.local/share/solana/install/active_release/bin:${PATH}"
cd "${ROOT}"
if [[ ! -f target/deploy/campus_escrow-keypair.json ]]; then
  anchor build
  anchor keys sync
  anchor build
  mkdir -p web/src/idl
  cp target/idl/campus_escrow.json web/src/idl/campus_escrow.json
  if [[ -f target/types/campus_escrow.ts ]]; then
    cp target/types/campus_escrow.ts web/src/idl/campus_escrow.ts
  fi
  echo "New program id (public): $(solana-keygen pubkey target/deploy/campus_escrow-keypair.json)"
  echo "Put that address in web/.env.local as NEXT_PUBLIC_PROGRAM_ID."
fi
exec anchor test --validator legacy
