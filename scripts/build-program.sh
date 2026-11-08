#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="${HOME}/.local/bin:${HOME}/.local/share/solana/install/active_release/bin:${PATH}"
cd "${ROOT}"
anchor build
mkdir -p web/src/idl
cp target/idl/campus_escrow.json web/src/idl/campus_escrow.json
if [[ -f target/types/campus_escrow.ts ]]; then
  cp target/types/campus_escrow.ts web/src/idl/campus_escrow.ts
fi
echo "IDL synced to web/src/idl"
