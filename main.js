import { ethers } from "ethers";
import { Seaport } from "@opensea/seaport-js";

const BACKEND_URL = "https://sənin-app.onrender.com"; 
const NFT_CONTRACT_ADDRESS = "0x54a88333F6e7540eA982261301309048aC431eD5";
const SEAPORT_CONTRACT_ADDRESS = "0x00000000000001ad428e4906ae43d8f9852d0dd6"; // canonical
const APECHAIN_ID = 33139; 

let provider = null;
let signer = null;
let seaport = null;
let userAddress = null;

let currentPage = 1;
const PAGE_SIZE = 12;

const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const addrSpan = document.getElementById("addr");
const marketplaceDiv = document.getElementById("marketplace");
const noticeDiv = document.getElementById("notice");
const pageIndicator = document.getElementById("pageIndicator");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");

function notify(msg, timeout = 4000) {
  noticeDiv.textContent = msg;
  if (timeout > 0) setTimeout(() => { if (noticeDiv.textContent === msg) noticeDiv.textContent = ""; }, timeout);
}

async function connectWallet() {
  try {
    if (!window.ethereum) return alert("Metamask/Vişual Ethereum provider tapılmadı!");

    provider = new ethers.providers.Web3Provider(window.ethereum, "any");
    await provider.send("eth_requestAccounts", []);
    signer = provider.getSigner();
    userAddress = (await signer.getAddress()).toLowerCase();

    const network = await provider.getNetwork();
    if (network.chainId !== APECHAIN_ID) {
      try {
        await provider.send("wallet_addEthereumChain", [{
          chainId: "0x" + APECHAIN_ID.toString(16),
          chainName: "ApeChain Mainnet",
          nativeCurrency: { name: "APE", symbol: "APE", decimals: 18 },
          rpcUrls: ["https://rpc.apechain.com"],
          blockExplorerUrls: ["https://apescan.io"]
        }]);
        notify("Şəbəkə dəyişdirildi. Yenidən qoşun.");
      } catch (e) { console.warn("Şəbəkə əlavə etmə uğursuz oldu:", e); }
    }

    seaport = new Seaport(signer, { contractAddress: SEAPORT_CONTRACT_ADDRESS });

    connectBtn.style.display = "none";
    disconnectBtn.style.display = "inline-block";
    addrSpan.textContent = userAddress.slice(0,6) + "..." + userAddress.slice(-4);

    await loadOrders(currentPage);
  } catch (err) {
    console.error("Wallet connect error:", err);
    alert("Cüzdan qoşularkən xəta oldu. Konsolu yoxla.");
  }
}

connectBtn.onclick = connectWallet;
disconnectBtn.onclick = () => {
  provider = signer = seaport = userAddress = null;
  connectBtn.style.display = "inline-block";
  disconnectBtn.style.display = "none";
  addrSpan.textContent = "";
  marketplaceDiv.innerHTML = "";
  notify("Cüzdan ayırıldı", 2000);
};

// Pagination
prevBtn.onclick = () => { if (currentPage > 1) { currentPage--; loadOrders(currentPage); } };
nextBtn.onclick = () => { currentPage++; loadOrders(currentPage); };

// Load Orders
async function loadOrders(page = 1) {
  try {
    pageIndicator.textContent = page;
    marketplaceDiv.innerHTML = "<p style='opacity:.7'>Yüklənir...</p>";

    const res = await fetch(`${BACKEND_URL}/orders?page=${page}&limit=${PAGE_SIZE}`);
    if (!res.ok) { marketplaceDiv.innerHTML = "<p>Xəta: serverdən məlumat gəlmədi.</p>"; return; }
    const data = await res.json();
    if (!data.success) { marketplaceDiv.innerHTML = "<p>Xəta: serverdən məlumat gəlmədi.</p>"; return; }

    const orders = data.orders || [];
    if (!orders.length) { marketplaceDiv.innerHTML = "<p>Bu səhifədə satışda NFT yoxdur.</p>"; return; }

    marketplaceDiv.innerHTML = "";
    for (const o of orders) {
      const tokenId = o.tokenId ?? o.tokenid ?? o.token_id ?? (o.token ? o.token : "unknown");
      const price = o.price ?? o.list_price ?? parseOrderPrice(o);
      const image = o.image ?? (o.metadata && o.metadata.image) ?? o.image_url ?? null;

      const card = document.createElement("div");
      card.className = "nft-card";
      card.innerHTML = `
        <img src="${image || 'https://ipfs.io/ipfs/QmExampleNFTImage/1.png'}" alt="NFT image" onerror="this.src='https://ipfs.io/ipfs/QmExampleNFTImage/1.png'">
        <h4>Bear #${tokenId}</h4>
        <p class="price">Qiymət: ${price ?? 'Not listed' } APE</p>
        <div class="nft-actions">
          <button class="wallet-btn" data-token="${tokenId}" data-orderid="${o.id || o.order_id || ''}">Buy</button>
        </div>
      `;
      marketplaceDiv.appendChild(card);

      const buyBtn = card.querySelector("button");
      buyBtn.onclick = async (ev) => {
        ev.target.disabled = true;
        try { await buyNFT(o); } catch (e) { console.error("buy handler error:", e); }
        finally { ev.target.disabled = false; }
      };
    }
  } catch (err) { console.error("loadOrders error:", err); marketplaceDiv.innerHTML = "<p>Xəta baş verdi (konsolu yoxla).</p>"; }
}

function parseOrderPrice(o) {
  try {
    const so = o.seaportOrder || o.seaportorder || o.seaport_order || (o.seaportOrderJSON ? JSON.parse(o.seaportOrderJSON) : null);
    const params = (so && so.parameters) ? so.parameters : (so && so.consideration ? so : null);
    if (params && params.consideration) {
      const cons = params.consideration;
      if (cons.length > 0) {
        const amount = cons[0].endAmount ?? cons[0].startAmount ?? cons[0].amount ?? null;
        if (amount) {
          let amt = amount;
          if (typeof amount === "object" && (amount.toString || amount.value)) { amt = amount.toString ? amount.toString() : amount.value; }
          const bn = ethers.BigNumber.from(amt.toString());
          return ethers.utils.formatEther(bn);
        }
      }
    }
  } catch (e) {}
  return null;
}

async function buyNFT(orderRecord) {
  if (!seaport || !signer) return alert("Əvvəlcə cüzdanı qoşun!");

  notify("Transaksiya hazırlanır...");
  const order = orderRecord.seaportOrder || orderRecord.seaportorder || orderRecord.seaport_order;
  let parsedOrder = order;

  if (!order && orderRecord.seaportOrderJSON) {
    try { parsedOrder = JSON.parse(orderRecord.seaportOrderJSON); } catch (e) { parsedOrder = null; }
  }
  if (!parsedOrder) { alert("Order məlumatı tapılmadı."); return; }

  try {
    const buyerAddr = await signer.getAddress();
    notify("Seaport-ə əməliyyat göndərilir...");
    const result = await seaport.fulfillOrder({ order: parsedOrder, accountAddress: buyerAddr });

    const exec = result.executeAllActions || result.execute || null;
    if (!exec) { notify("NFT alındı!"); await loadOrders(currentPage); return; }
    const txResponse = await exec();
    if (txResponse && typeof txResponse.wait === "function") await txResponse.wait();
    notify("NFT uğurla alındı ✅");
    await loadOrders(currentPage);
  } catch (err) { console.error("buyNFT error:", err); alert("Alış zamanı xəta: " + (err.message || String(err))); }
}

window.buyNFT = buyNFT;
window.loadOrders = loadOrders;