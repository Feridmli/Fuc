const BACKEND_URL = process.env.BACKEND_URL;
const NFT_CONTRACT_ADDRESS = process.env.NFT_CONTRACT_ADDRESS;
const SEAPORT_CONTRACT_ADDRESS = process.env.SEAPORT_CONTRACT_ADDRESS || "0x00000000000001ad428e4906ae43d8f9852d0dd6";
const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY;

if (!OPENSEA_API_KEY) { console.error("❌ OPENSEA_API_KEY missing"); process.exit(1); }
if (!NFT_CONTRACT_ADDRESS) { console.error("❌ NFT_CONTRACT_ADDRESS missing"); process.exit(1); }

const CHAIN = "apechain"; 
const ORDER_TYPE = "listings";
const PAGE_SIZE = 50;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchOrders(cursor = null) {
  let url = `https://api.opensea.io/api/v2/orders/${CHAIN}/${ORDER_TYPE}?asset_contract_address=${NFT_CONTRACT_ADDRESS}&limit=${PAGE_SIZE}`;
  if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

  const res = await fetch(url, {
    headers: { "Accept": "application/json", "X-API-KEY": OPENSEA_API_KEY }
  });

  if (!res.ok) { console.log("❌ OpenSea error:", res.status); return null; }
  return res.json();
}

function normalizeOrder(order) {
  try {
    const protocol = order.protocol_data || order.protocolData || null;
    const maker = order.maker || {};
    const orderHash = order.order_hash || order.hash || null;
    const price = (order.price && order.price.current && order.price.current.value) || order.current_price || null;
    return { protocol, maker, orderHash, price };
  } catch (e) {
    return { protocol: null, maker: {}, orderHash: null, price: null };
  }
}

async function postOrderToBackend(orderPayload) {
  try {
    const res = await fetch(`${BACKEND_URL}/order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(orderPayload)
    });

    if (!res.ok) { console.log("❌ Backend rejected:", res.status); return false; }
    const data = await res.json().catch(() => null);
    return data && data.success === true;
  } catch (e) { console.log("❌ Backend error:", e.message); return false; }
}

async function main() {
  console.log("🚀 OpenSea → ApeChain Sync başladı...");
  let cursor = null;
  let totalScanned = 0;
  let totalSent = 0;

  while (true) {
    console.log(`📦 Fetching orders (cursor=${cursor || "null"})`);
    const data = await fetchOrders(cursor);
    if (!data || !data.orders || data.orders.length === 0) { console.log("⏹ No more orders."); break; }

    for (const ord of data.orders) {
      const nftMeta = (ord.criteria && ord.criteria.metadata) || ord.asset || (ord.assets && ord.assets[0]) || null;
      if (!nftMeta) continue;

      const tokenId = nftMeta.identifier || nftMeta.token_id || nftMeta.tokenId || nftMeta.id || null;
      const image = nftMeta.image_url || nftMeta.image || (nftMeta.metadata && nftMeta.metadata.image) || null;
      if (!tokenId) continue;

      const { protocol, maker, orderHash, price } = normalizeOrder(ord);

      const payload = {
        tokenId: tokenId.toString(),
        price: price || "0",
        sellerAddress: (maker.address || "0x0").toLowerCase(),
        seaportOrder: protocol || ord,
        orderHash: orderHash || `${tokenId}-${maker.address}`,
        image: image,
        marketplaceContract: SEAPORT_CONTRACT_ADDRESS
      };

      totalScanned++;
      const sent = await postOrderToBackend(payload);
      if (sent) totalSent++;
      await sleep(200);
    }

    cursor = data.next || data.cursor || null;
    if (!cursor) break;
    await sleep(500);
  }

  console.log("\n🎉 SYNC TAMAMLANDI");
  console.log("📌 Scanned:", totalScanned);
  console.log("📌 Sent:", totalSent);
}

main().catch(err => { console.log("💀 Fatal:", err); process.exit(1); });