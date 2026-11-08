/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/campus_escrow.json`.
 */
export type CampusEscrow = {
  "address": "13xMGTJyfEDXXkYjqvhej8gvQoSypSeMWUTSAQrM7CUE",
  "metadata": {
    "name": "campusEscrow",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Devnet escrow for campus face-to-face handovers"
  },
  "docs": [
    "Campus secondhand escrow.",
    "",
    "One listing PDA stores the order and, once bought, holds the item price",
    "above the rent-exempt minimum. Only this program can debit that account.",
    "The buyer releasing funds is an on-chain signature check. It does not",
    "prove that a textbook changed hands."
  ],
  "instructions": [
    {
      "name": "buy",
      "discriminator": [
        102,
        6,
        61,
        18,
        1,
        218,
        235,
        234
      ],
      "accounts": [
        {
          "name": "buyer",
          "writable": true,
          "signer": true
        },
        {
          "name": "seller"
        },
        {
          "name": "listing",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  115,
                  116,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "seller"
              },
              {
                "kind": "account",
                "path": "listing.listingId",
                "account": "listing"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "cancel",
      "discriminator": [
        232,
        219,
        223,
        41,
        219,
        236,
        220,
        190
      ],
      "accounts": [
        {
          "name": "seller",
          "writable": true,
          "signer": true
        },
        {
          "name": "listing",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  115,
                  116,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "seller"
              },
              {
                "kind": "account",
                "path": "listing.listingId",
                "account": "listing"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "confirm",
      "discriminator": [
        174,
        1,
        15,
        213,
        3,
        190,
        131,
        0
      ],
      "accounts": [
        {
          "name": "buyer",
          "writable": true,
          "signer": true
        },
        {
          "name": "seller",
          "writable": true
        },
        {
          "name": "listing",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  115,
                  116,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "seller"
              },
              {
                "kind": "account",
                "path": "listing.listingId",
                "account": "listing"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "listItem",
      "discriminator": [
        174,
        245,
        22,
        211,
        228,
        103,
        121,
        13
      ],
      "accounts": [
        {
          "name": "seller",
          "writable": true,
          "signer": true
        },
        {
          "name": "listing",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  105,
                  115,
                  116,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "seller"
              },
              {
                "kind": "arg",
                "path": "listingId"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "listingId",
          "type": "u64"
        },
        {
          "name": "title",
          "type": "string"
        },
        {
          "name": "priceLamports",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "listing",
      "discriminator": [
        218,
        32,
        50,
        73,
        43,
        134,
        26,
        58
      ]
    }
  ],
  "events": [
    {
      "name": "itemCancelled",
      "discriminator": [
        5,
        214,
        224,
        15,
        19,
        71,
        176,
        140
      ]
    },
    {
      "name": "itemConfirmed",
      "discriminator": [
        119,
        33,
        121,
        219,
        148,
        199,
        96,
        130
      ]
    },
    {
      "name": "itemFunded",
      "discriminator": [
        58,
        213,
        25,
        29,
        170,
        91,
        185,
        146
      ]
    },
    {
      "name": "itemListed",
      "discriminator": [
        51,
        193,
        103,
        51,
        201,
        26,
        211,
        113
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "titleEmpty",
      "msg": "Title must not be empty"
    },
    {
      "code": 6001,
      "name": "titleTooLong",
      "msg": "Title exceeds 64 bytes"
    },
    {
      "code": 6002,
      "name": "priceNotPositive",
      "msg": "Price must be a positive number of lamports"
    },
    {
      "code": 6003,
      "name": "invalidState",
      "msg": "Listing is not in the required state"
    },
    {
      "code": 6004,
      "name": "unauthorizedBuyer",
      "msg": "Only the recorded buyer can confirm"
    },
    {
      "code": 6005,
      "name": "unauthorizedSeller",
      "msg": "Only the recorded seller can cancel"
    },
    {
      "code": 6006,
      "name": "sellerMismatch",
      "msg": "Seller account does not match the listing"
    },
    {
      "code": 6007,
      "name": "sellerCannotBuy",
      "msg": "Seller cannot buy their own listing"
    },
    {
      "code": 6008,
      "name": "escrowAmountMismatch",
      "msg": "Escrow balance does not match the listing price"
    },
    {
      "code": 6009,
      "name": "insufficientEscrow",
      "msg": "Escrow does not hold the listing price above rent"
    },
    {
      "code": 6010,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow"
    }
  ],
  "types": [
    {
      "name": "itemCancelled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "listing",
            "type": "pubkey"
          },
          {
            "name": "seller",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "itemConfirmed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "listing",
            "type": "pubkey"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "seller",
            "type": "pubkey"
          },
          {
            "name": "priceLamports",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "itemFunded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "listing",
            "type": "pubkey"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "seller",
            "type": "pubkey"
          },
          {
            "name": "priceLamports",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "itemListed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "listing",
            "type": "pubkey"
          },
          {
            "name": "seller",
            "type": "pubkey"
          },
          {
            "name": "listingId",
            "type": "u64"
          },
          {
            "name": "priceLamports",
            "type": "u64"
          },
          {
            "name": "title",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "listing",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "seller",
            "type": "pubkey"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "priceLamports",
            "type": "u64"
          },
          {
            "name": "listingId",
            "type": "u64"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "state",
            "type": {
              "defined": {
                "name": "listingState"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "title",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "listingState",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "listed"
          },
          {
            "name": "funded"
          },
          {
            "name": "completed"
          },
          {
            "name": "cancelled"
          }
        ]
      }
    }
  ],
  "constants": [
    {
      "name": "listingSeed",
      "type": "bytes",
      "value": "[108, 105, 115, 116, 105, 110, 103]"
    }
  ]
};
