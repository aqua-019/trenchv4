import { HELIUS_RPC, HELIUS_API, HELIUS_KEY, LAMPORTS, SOL_MINT } from "./config";

export async function rpc(method, params, endpoint = HELIUS_RPC) {
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return (await r.json()).result;
}

export async function getSolBalance(wallet) {
  const r = await rpc("getBalance", [wallet]);
  return (r?.value || 0) / LAMPORTS;
}

export async function getTokenAccounts(wallet) {
  const r = await rpc("getTokenAccountsByOwner", [
    wallet,
    { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
    { encoding: "jsonParsed" },
  ]);
  return (r?.value || [])
    .map((a) => {
      const i = a.account.data.parsed.info;
      return { mint: i.mint, balance: parseFloat(i.tokenAmount.uiAmountString || "0"), decimals: i.tokenAmount.decimals };
    })
    .filter((t) => t.balance > 0);
}

export async function dexTokens(mints) {
  if (!mints.length) return [];
  const out = [];
  for (let i = 0; i < mints.length; i += 30) {
    const batch = mints.slice(i, i + 30);
    try {
      const r = await fetch("https://api.dexscreener.com/tokens/v1/solana/" + batch.join(","));
      if (r.ok) { const d = await r.json(); out.push(...(Array.isArray(d) ? d : d.pairs || [])); }
    } catch (e) { console.warn("DexScreener err:", e); }
    if (i + 30 < mints.length) await new Promise((r) => setTimeout(r, 350));
  }
  return out;
}

export async function dexPairs(mint) {
  try {
    const r = await fetch("https://api.dexscreener.com/token-pairs/v1/solana/" + mint);
    if (r.ok) { const d = await r.json(); return Array.isArray(d) ? d : d.pairs || []; }
  } catch (e) {}
  return [];
}

export async function getSolPrice() {
  try {
    const r = await fetch("https://api.dexscreener.com/tokens/v1/solana/" + SOL_MINT);
    if (r.ok) {
      const d = await r.json();
      const p = (Array.isArray(d) ? d : d.pairs || [])[0];
      if (p) return parseFloat(p.priceUsd || 0);
    }
  } catch (e) {}
  return 0;
}

export async function fetchSwaps(wallet, maxPages = 8) {
  if (!HELIUS_KEY) return [];
  const all = [];
  let lastSig = null;
  for (let p = 0; p < maxPages; p++) {
    let url = HELIUS_API + "/addresses/" + wallet + "/transactions?api-key=" + HELIUS_KEY + "&type=SWAP";
    if (lastSig) url += "&before=" + lastSig;
    try {
      const r = await fetch(url);
      if (!r.ok) break;
      const txns = await r.json();
      if (!txns?.length) break;
      all.push(...txns);
      lastSig = txns[txns.length - 1].signature;
      if (txns.length < 100) break;
    } catch (e) { break; }
    await new Promise((r) => setTimeout(r, 150));
  }
  return all;
}

export async function fetchTransfers(wallet, maxPages = 4) {
  if (!HELIUS_KEY) return [];
  const all = [];
  let lastSig = null;
  for (let p = 0; p < maxPages; p++) {
    let url = HELIUS_API + "/addresses/" + wallet + "/transactions?api-key=" + HELIUS_KEY + "&type=TRANSFER";
    if (lastSig) url += "&before=" + lastSig;
    try {
      const r = await fetch(url);
      if (!r.ok) break;
      const txns = await r.json();
      if (!txns?.length) break;
      all.push(...txns);
      lastSig = txns[txns.length - 1].signature;
      if (txns.length < 100) break;
    } catch (e) { break; }
    await new Promise((r) => setTimeout(r, 150));
  }
  return all;
}

export function buildCostBasis(swapTxns, transferTxns, wallet) {
  const data = {};
  const ensure = (mint) => {
    if (!data[mint]) data[mint] = { solSpent: 0, solReceived: 0, bought: 0, sold: 0, trades: [], transfers: [] };
  };
  for (const tx of swapTxns) {
    if (!tx.tokenTransfers?.length) continue;
    const ts = tx.timestamp;
    let solOut = 0, solIn = 0;
    for (const nt of tx.nativeTransfers || []) {
      if (nt.fromUserAccount === wallet) solOut += (nt.amount || 0) / LAMPORTS;
      if (nt.toUserAccount === wallet) solIn += (nt.amount || 0) / LAMPORTS;
    }
    for (const tt of tx.tokenTransfers) {
      if (tt.mint === SOL_MINT) {
        if (tt.fromUserAccount === wallet) solOut += tt.tokenAmount || 0;
        if (tt.toUserAccount === wallet) solIn += tt.tokenAmount || 0;
      }
    }
    for (const tt of tx.tokenTransfers) {
      if (!tt.mint || tt.mint === SOL_MINT) continue;
      ensure(tt.mint);
      const amt = tt.tokenAmount || 0;
      if (tt.toUserAccount === wallet && amt > 0) {
        data[tt.mint].bought += amt;
        data[tt.mint].solSpent += solOut;
        data[tt.mint].trades.push({ type: "BUY", amount: amt, sol: solOut, ts, sig: tx.signature });
      } else if (tt.fromUserAccount === wallet && amt > 0) {
        data[tt.mint].sold += amt;
        data[tt.mint].solReceived += solIn;
        data[tt.mint].trades.push({ type: "SELL", amount: amt, sol: solIn, ts, sig: tx.signature });
      }
    }
  }
  for (const tx of transferTxns) {
    for (const tt of tx.tokenTransfers || []) {
      if (!tt.mint || tt.mint === SOL_MINT) continue;
      ensure(tt.mint);
      const amt = tt.tokenAmount || 0;
      if (tt.toUserAccount === wallet && amt > 0) {
        data[tt.mint].transfers.push({ type: "IN", amount: amt, ts: tx.timestamp, sig: tx.signature });
      } else if (tt.fromUserAccount === wallet && amt > 0) {
        data[tt.mint].transfers.push({ type: "OUT", amount: amt, ts: tx.timestamp, sig: tx.signature });
      }
    }
  }
  return data;
}

export function enrichTokens(accounts, dexData) {
  return accounts.map((a) => {
    const matches = dexData.filter((p) => p.baseToken?.address === a.mint || p.quoteToken?.address === a.mint);
    const best = matches.sort((x, y) => (y.liquidity?.usd || 0) - (x.liquidity?.usd || 0))[0];
    const isBase = best?.baseToken?.address === a.mint;
    const sym = isBase ? best?.baseToken?.symbol : best?.quoteToken?.symbol;
    const nam = isBase ? best?.baseToken?.name : best?.quoteToken?.name;
    return {
      ...a, symbol: sym, name: nam,
      priceUsd: best ? parseFloat(best.priceUsd || 0) : 0,
      priceNative: best ? parseFloat(best.priceNative || 0) : 0,
      priceChange24h: best?.priceChange?.h24 || 0,
      volume24h: best?.volume?.h24 || 0, liquidity: best?.liquidity?.usd || 0,
      marketCap: best?.marketCap || best?.fdv || 0,
      imageUrl: best?.info?.imageUrl, pairUrl: best?.url,
      pairAddress: best?.pairAddress || null,
      txns: best?.txns || {}, dexId: best?.dexId,
    };
  });
}

export function buildSnapshot(tokens, solBal, solPrice) {
  const tv = tokens.reduce((s, t) => s + t.balance * (t.priceUsd || 0), 0);
  const sv = solBal * (solPrice || 0);
  const sorted = [...tokens].sort((a, b) => b.balance * (b.priceUsd || 0) - a.balance * (a.priceUsd || 0));
  const topPct = tv > 0 && sorted.length ? (sorted[0].balance * (sorted[0].priceUsd || 0)) / tv * 100 : 0;
  return { totalValue: tv + sv, solBal, tokenCount: tokens.length, tokenVal: tv, topPct, avgVal: tokens.length ? tv / tokens.length : 0 };
}

// Build simulated historical portfolio data from cost-basis trades
// Assumes 0 balance at 2/5/26, cost-basis starts 2/6/26
export function buildHistoricalData(cb, tokens, solBal, solPrice) {
  const START_TS = new Date("2026-02-06T04:00:00Z").getTime() / 1000; // 2/6/26 11PM EST = 4AM UTC 2/6
  const now = Date.now() / 1000;
  const allTrades = [];
  for (const [mint, c] of Object.entries(cb)) {
    const tok = tokens.find(t => t.mint === mint);
    for (const t of c.trades) {
      if (t.ts >= START_TS) allTrades.push({ ...t, mint, symbol: tok?.symbol || mint.slice(0, 6) });
    }
  }
  allTrades.sort((a, b) => a.ts - b.ts);
  // Build daily snapshots
  const days = [];
  const dayMs = 86400;
  let runSol = 0;
  const holdings = {};
  for (let ts = START_TS; ts <= now; ts += dayMs) {
    const dayEnd = ts + dayMs;
    for (const t of allTrades) {
      if (t.ts >= ts && t.ts < dayEnd) {
        if (t.type === "BUY") { runSol -= t.sol; holdings[t.mint] = (holdings[t.mint] || 0) + t.amount; }
        if (t.type === "SELL") { runSol += t.sol; holdings[t.mint] = (holdings[t.mint] || 0) - t.amount; }
      }
    }
    // Current token values in SOL using priceNative
    let tokValSol = 0;
    for (const [mint, bal] of Object.entries(holdings)) {
      if (bal <= 0) continue;
      const tok = tokens.find(t => t.mint === mint);
      tokValSol += bal * (tok?.priceNative || 0);
    }
    days.push({ ts, date: new Date(ts * 1000), solBal: Math.max(0, solBal + runSol), tokValSol, totalSol: Math.max(0, solBal + runSol) + tokValSol });
  }
  return days;
}

// Generate Solana Pay QR code URL
export function solanPayUrl(recipient, amount) {
  let url = `solana:${recipient}`;
  if (amount) url += `?amount=${amount}`;
  return url;
}
