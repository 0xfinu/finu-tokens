#!/usr/bin/env node
// Build ERC-721 metadata for "0xmuse #1" from the approved 0xmuse logo.
//  - reads ~/workspace/0xmuse/logo/0xmuse-logo-160x160.jpg, prints its SHA-256
//  - image CID comes from ipfs-cids.json (the kubo-pinned CID). Fallback:
//    compute an offline CID with ipfs-only-hash and WARN that it is
//    computed-not-pinned and must be verified with kubo before any mint.
//  - writes metadata/0xmuse-1.json and prints the metadata file's offline CID.
// No network, no accounts, no secrets. TESTNET ONLY.
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const LOGO_PATH = "/home/hatch/workspace/0xmuse/logo/0xmuse-logo-160x160.jpg";
const CIDS_PATH = path.join(ROOT, "ipfs-cids.json");
const OUT_PATH = path.join(ROOT, "0xmuse-1.json"); // flattened layout

const TOKEN_ID = 1;
const NAME = "0xmuse #1";

async function offlineCidV1(buffer) {
  // ipfs-only-hash defaults to dag-pb CIDv0; convert to CIDv1 base32 for display.
  const { of } = require("ipfs-only-hash");
  const { CID } = require("multiformats/cid");
  const cidv0 = await of(buffer);
  return CID.parse(cidv0).toV1().toString();
}

async function main() {
  if (!fs.existsSync(LOGO_PATH)) {
    console.error("logo not found:", LOGO_PATH);
    process.exit(1);
  }
  const logo = fs.readFileSync(LOGO_PATH);
  const sha256 = crypto.createHash("sha256").update(logo).digest("hex");
  console.log("logo:", LOGO_PATH);
  console.log("logo bytes:", logo.length);
  console.log("logo sha256:", sha256);

  let imageCid;
  let imageCidSource;
  if (fs.existsSync(CIDS_PATH)) {
    const cids = JSON.parse(fs.readFileSync(CIDS_PATH, "utf8"));
    if (cids.image && cids.image.cidv1 && cids.image.pinned) {
      imageCid = cids.image.cidv1;
      imageCidSource = "kubo-pinned (ipfs-cids.json)";
      if (cids.image.sha256 !== sha256) {
        console.error("MISMATCH: ipfs-cids.json sha256 != logo sha256. Aborting.");
        process.exit(1);
      }
    }
  }
  if (!imageCid) {
    // Offline fallback: computed CID, NOT pinned. Mint script must not use
    // this until the content is added + pinned with kubo.
    imageCid = await offlineCidV1(logo);
    imageCidSource = "OFFLINE-COMPUTED (NOT pinned — verify with kubo before minting)";
    console.warn("WARNING: no pinned image CID found; using offline-computed CID.");
  }
  console.log("image CID:", imageCid);
  console.log("image CID source:", imageCidSource);

  const metadata = {
    name: NAME,
    description:
      "0xmuse #1 — a testnet NFT from the 0xmuse sniper toolkit. " +
      "Artwork is the approved 0xmuse logo (3D fluffy purple creature). " +
      "Testnet only; no value.",
    image: `ipfs://${imageCid}`,
    attributes: [
      { trait_type: "Collection", value: "0xmuse" },
      { trait_type: "Token", value: String(TOKEN_ID) },
      { trait_type: "Network", value: "Arc Testnet" },
      { trait_type: "Artwork", value: "0xmuse logo" },
      { trait_type: "Image SHA-256", value: sha256 },
    ],
    properties: {
      image_sha256: sha256,
      image_cid: imageCid,
      image_cid_source: imageCidSource,
    },
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  const json = JSON.stringify(metadata, null, 2) + "\n";
  fs.writeFileSync(OUT_PATH, json);
  console.log("wrote:", OUT_PATH);

  const metaOfflineCid = await offlineCidV1(Buffer.from(json, "utf8"));
  console.log("metadata offline CIDv1 (dag-pb; kubo `ipfs add` may give a raw bafkrei CID instead — see README):", metaOfflineCid);
  console.log("tokenURI will be: ipfs://<metadata-CID-from-kubo-add>");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
