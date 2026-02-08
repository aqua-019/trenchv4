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
    } catch (e) { console.warn("DexScreener batch err:", e); }
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
    const tokenMoves = tx.tokenTransfers.filter(tt => tt.mint && tt.mint !== SOL_MINT);
    const myMoves = tokenMoves.filter(tt => (tt.toUserAccount === wallet || tt.fromUserAccount === wallet) && (tt.tokenAmount || 0) > 0);
    const numMoves = myMoves.length || 1;
    for (const tt of tokenMoves) {
      if (!tt.mint) continue;
      ensure(tt.mint);
      const amt = tt.tokenAmount || 0;
      if (amt <= 0) continue;
      const share = 1 / numMoves;
      if (tt.toUserAccount === wallet) {
        const cost = solOut * share;
        data[tt.mint].bought += amt;
        data[tt.mint].solSpent += cost;
        data[tt.mint].trades.push({ type: "BUY", amount: amt, sol: cost, ts, sig: tx.signature });
      } else if (tt.fromUserAccount === wallet) {
        const gain = solIn * share;
        data[tt.mint].sold += amt;
        data[tt.mint].solReceived += gain;
        data[tt.mint].trades.push({ type: "SELL", amount: amt, sol: gain, ts, sig: tx.signature });
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
    const baseMatches = matches.filter(p => p.baseToken?.address === a.mint);
    const sorted = (baseMatches.length > 0 ? baseMatches : matches).sort((x, y) => (y.liquidity?.usd || 0) - (x.liquidity?.usd || 0));
    const best = sorted[0];
    if (!best) return { ...a, symbol: null, name: null, priceUsd: 0, priceNative: 0, priceChange24h: 0, volume24h: 0, liquidity: 0, marketCap: 0, imageUrl: null, pairUrl: null, pairAddress: null, txns: {}, dexId: null };
    const isBase = best.baseToken?.address === a.mint;
    return {
      ...a,
      symbol: isBase ? best.baseToken?.symbol : best.quoteToken?.symbol,
      name: isBase ? best.baseToken?.name : best.quoteToken?.name,
      priceUsd: isBase ? parseFloat(best.priceUsd || 0) : 0,
      priceNative: isBase ? parseFloat(best.priceNative || 0) : 0,
      priceChange24h: best.priceChange?.h24 || 0,
      volume24h: best.volume?.h24 || 0,
      liquidity: best.liquidity?.usd || 0,
      marketCap: best.marketCap || best.fdv || 0,
      imageUrl: best.info?.imageUrl || null,
      pairUrl: best.url,
      pairAddress: best.pairAddress || null,
      txns: best.txns || {}, dexId: best.dexId,
    };
  });
}

// Fetch fresh prices for existing tokens (lightweight refresh)
export async function refreshTokenPrices(tokens) {
  const mints = tokens.map(t => t.mint).filter(Boolean);
  if (!mints.length) return tokens;
  const dx = await dexTokens(mints);
  return tokens.map(t => {
    const matches = dx.filter(p => p.baseToken?.address === t.mint);
    const best = matches.sort((x, y) => (y.liquidity?.usd || 0) - (x.liquidity?.usd || 0))[0];
    if (!best) return t;
    return {
      ...t,
      priceUsd: parseFloat(best.priceUsd || 0),
      priceNative: parseFloat(best.priceNative || 0),
      priceChange24h: best.priceChange?.h24 || 0,
      volume24h: best.volume?.h24 || 0,
      marketCap: best.marketCap || best.fdv || 0,
      imageUrl: best.info?.imageUrl || t.imageUrl,
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

export function buildHistoricalData(cb, tokens, solBal, solPrice) {
  const START_TS = new Date("2026-02-06T04:00:00Z").getTime() / 1000;
  const now = Date.now() / 1000;
  const allTrades = [];
  for (const [mint, c] of Object.entries(cb)) {
    const tok = tokens.find(t => t.mint === mint);
    for (const t of c.trades) {
      if (t.ts >= START_TS) allTrades.push({ ...t, mint, symbol: tok?.symbol || mint.slice(0, 6) });
    }
  }
  allTrades.sort((a, b) => a.ts - b.ts);
  const points = [];
  const interval = 4 * 3600; // 4-hour intervals for sharpness
  let runSol = 0;
  const holdings = {};
  for (let ts = START_TS; ts <= now; ts += interval) {
    const end = ts + interval;
    for (const t of allTrades) {
      if (t.ts >= ts && t.ts < end) {
        if (t.type === "BUY") { runSol -= t.sol; holdings[t.mint] = (holdings[t.mint] || 0) + t.amount; }
        if (t.type === "SELL") { runSol += t.sol; holdings[t.mint] = (holdings[t.mint] || 0) - t.amount; }
      }
    }
    let tokValSol = 0;
    for (const [mint, bal] of Object.entries(holdings)) {
      if (bal <= 0) continue;
      const tok = tokens.find(t => t.mint === mint);
      tokValSol += bal * (tok?.priceNative || 0);
    }
    const sb = Math.max(0, solBal + runSol);
    points.push({ ts, date: new Date(ts * 1000), solBal: sb, tokValSol, totalSol: sb + tokValSol });
  }
  return points;
}

export function solanPayUrl(recipient, amount) {
  let url = `solana:${recipient}`;
  if (amount) url += `?amount=${amount}`;
  return url;
}

// Total PnL for a token = realized + unrealized
export function tokenTotalPnl(cbEntry, token) {
  if (!cbEntry) return 0;
  const realized = cbEntry.solReceived - cbEntry.solSpent;
  const remaining = cbEntry.bought - cbEntry.sold;
  if (remaining <= 0 || !token?.priceNative) return realized;
  const avgCost = cbEntry.bought > 0 ? cbEntry.solSpent / cbEntry.bought : 0;
  const unrealized = (remaining * (token.priceNative || 0)) - (remaining * avgCost);
  return realized + unrealized;
}

// Find the single best SELL trade (highest SOL received in one trade)
export function findBestTrade(cb, tokens) {
  let best = null;
  for (const [mint, c] of Object.entries(cb)) {
    const tok = tokens.find(t => t.mint === mint);
    for (const t of c.trades) {
      if (t.type === "SELL" && t.sol > 0) {
        if (!best || t.sol > best.sol) {
          best = { mint, sol: t.sol, symbol: tok?.symbol || null, sig: t.sig };
        }
      }
    }
  }
  // Also check net PnL per token (in case no sells yet but holding is profitable)
  if (!best) {
    for (const [mint, c] of Object.entries(cb)) {
      const tok = tokens.find(t => t.mint === mint);
      const pnl = tokenTotalPnl(c, tok);
      if (!best || pnl > best.sol) {
        best = { mint, sol: pnl, symbol: tok?.symbol || null };
      }
    }
  }
  return best;
}
