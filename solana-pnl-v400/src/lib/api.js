import { HELIUS_RPC, HELIUS_API, HELIUS_KEY, LAMPORTS, SOL_MINT } from "./config";

export async function rpc(method, params, endpoint = HELIUS_RPC) {
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) console.warn("RPC error:", j.error);
  return j.result;
}

export async function getSolBalance(wallet) {
  const r = await rpc("getBalance", [wallet]);
  return (r?.value || 0) / LAMPORTS;
}

// Fetch ALL token accounts - both SPL Token AND Token-2022 programs
export async function getTokenAccounts(wallet) {
  const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

  const [r1, r2] = await Promise.all([
    rpc("getTokenAccountsByOwner", [wallet, { programId: TOKEN_PROGRAM }, { encoding: "jsonParsed" }]),
    rpc("getTokenAccountsByOwner", [wallet, { programId: TOKEN_2022 }, { encoding: "jsonParsed" }]).catch(() => null),
  ]);

  const all = [...(r1?.value || []), ...(r2?.value || [])];
  return all
    .map((a) => {
      try {
        const i = a.account.data.parsed.info;
        return {
          mint: i.mint,
          balance: parseFloat(i.tokenAmount.uiAmountString || "0"),
          decimals: i.tokenAmount.decimals,
        };
      } catch (e) { return null; }
    })
    .filter((t) => t && t.balance > 0);
}

// DexScreener - try multiple API endpoints for robustness
export async function dexTokens(mints) {
  if (!mints.length) return [];
  const out = [];

  for (let i = 0; i < mints.length; i += 30) {
    const batch = mints.slice(i, i + 30);

    // Try the v1 endpoint first
    let gotData = false;
    try {
      const r = await fetch("https://api.dexscreener.com/tokens/v1/solana/" + batch.join(","));
      if (r.ok) {
        const d = await r.json();
        const pairs = Array.isArray(d) ? d : d.pairs || [];
        if (pairs.length > 0) { out.push(...pairs); gotData = true; }
      }
    } catch (e) { console.warn("DexScreener v1 err:", e); }

    // Fallback: try latest/dex/tokens for each mint individually
    if (!gotData) {
      for (const mint of batch) {
        try {
          const r = await fetch("https://api.dexscreener.com/latest/dex/tokens/" + mint);
          if (r.ok) {
            const d = await r.json();
            const pairs = d.pairs || [];
            if (pairs.length > 0) out.push(...pairs);
          }
        } catch (e) {}
        await new Promise(r => setTimeout(r, 200));
      }
    }

    if (i + 30 < mints.length) await new Promise(r => setTimeout(r, 350));
  }
  return out;
}

export async function dexPairs(mint) {
  // Try v1 first, then latest
  try {
    const r = await fetch("https://api.dexscreener.com/token-pairs/v1/solana/" + mint);
    if (r.ok) {
      const d = await r.json();
      const pairs = Array.isArray(d) ? d : d.pairs || [];
      if (pairs.length > 0) return pairs;
    }
  } catch (e) {}
  try {
    const r = await fetch("https://api.dexscreener.com/latest/dex/tokens/" + mint);
    if (r.ok) {
      const d = await r.json();
      if (d.pairs?.length > 0) return d.pairs;
    }
  } catch (e) {}
  return [];
}

export async function getSolPrice() {
  try {
    const r = await fetch("https://api.dexscreener.com/latest/dex/tokens/" + SOL_MINT);
    if (r.ok) {
      const d = await r.json();
      const p = (d.pairs || [])[0];
      if (p) return parseFloat(p.priceUsd || 0);
    }
  } catch (e) {}
  // Fallback to v1
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
    await new Promise(r => setTimeout(r, 150));
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
    await new Promise(r => setTimeout(r, 150));
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

// Enrich tokens with DexScreener data
export function enrichTokens(accounts, dexData) {
  return accounts.map((a) => {
    const matches = dexData.filter((p) => p.baseToken?.address === a.mint || p.quoteToken?.address === a.mint);
    const baseMatches = matches.filter(p => p.baseToken?.address === a.mint);
    const sorted = (baseMatches.length > 0 ? baseMatches : matches).sort((x, y) => (y.liquidity?.usd || 0) - (x.liquidity?.usd || 0));
    const best = sorted[0];
    if (!best) {
      return { ...a, symbol: null, name: null, priceUsd: 0, priceNative: 0, priceChange24h: 0, volume24h: 0, liquidity: 0, marketCap: 0, imageUrl: null, pairUrl: null, pairAddress: null, dextoolsUrl: null };
    }
    const isBase = best.baseToken?.address === a.mint;
    const sym = isBase ? best.baseToken?.symbol : best.quoteToken?.symbol;
    const nam = isBase ? best.baseToken?.name : best.quoteToken?.name;
    const pairAddr = best.pairAddress || null;
    // Build dextools URL from pair address
    const dextoolsUrl = pairAddr ? `https://www.dextools.io/app/solana/pair-explorer/${pairAddr}` : null;
    return {
      ...a,
      symbol: sym, name: nam,
      priceUsd: isBase ? parseFloat(best.priceUsd || 0) : 0,
      priceNative: isBase ? parseFloat(best.priceNative || 0) : 0,
      priceChange24h: best.priceChange?.h24 || 0,
      volume24h: best.volume?.h24 || 0,
      liquidity: best.liquidity?.usd || 0,
      marketCap: best.marketCap || best.fdv || 0,
      imageUrl: best.info?.imageUrl || null,
      pairUrl: best.url,
      pairAddress: pairAddr,
      dextoolsUrl,
    };
  });
}

// Lightweight price refresh for existing tokens
export async function refreshTokenPrices(tokens) {
  const mints = tokens.map(t => t.mint).filter(Boolean);
  if (!mints.length) return tokens;
  const dx = await dexTokens(mints);
  return tokens.map(t => {
    const matches = dx.filter(p => p.baseToken?.address === t.mint);
    const best = matches.sort((x, y) => (y.liquidity?.usd || 0) - (x.liquidity?.usd || 0))[0];
    if (!best) return t;
    const pairAddr = best.pairAddress || t.pairAddress;
    return {
      ...t,
      priceUsd: parseFloat(best.priceUsd || 0),
      priceNative: parseFloat(best.priceNative || 0),
      priceChange24h: best.priceChange?.h24 || 0,
      volume24h: best.volume?.h24 || 0,
      marketCap: best.marketCap || best.fdv || 0,
      imageUrl: best.info?.imageUrl || t.imageUrl,
      pairAddress: pairAddr,
      dextoolsUrl: pairAddr ? `https://www.dextools.io/app/solana/pair-explorer/${pairAddr}` : t.dextoolsUrl,
    };
  });
}

// Full re-fetch of token accounts + enrichment (for 5-min refresh)
export async function refreshHoldings(wallet) {
  const accs = await getTokenAccounts(wallet);
  if (!accs.length) return [];
  const dx = await dexTokens(accs.map(a => a.mint));
  return enrichTokens(accs, dx);
}

export function buildSnapshot(tokens, solBal, solPrice) {
  const tv = tokens.reduce((s, t) => s + t.balance * (t.priceUsd || 0), 0);
  const sv = solBal * (solPrice || 0);
  return { totalValue: tv + sv, solBal, tokenCount: tokens.length, tokenVal: tv };
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
  const interval = 4 * 3600;
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
  return amount ? `solana:${recipient}?amount=${amount}` : `solana:${recipient}`;
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

// Find best single sell trade
export function findBestTrade(cb, tokens) {
  let best = null;
  for (const [mint, c] of Object.entries(cb)) {
    const tok = tokens.find(t => t.mint === mint);
    for (const t of c.trades) {
      if (t.type === "SELL" && t.sol > 0) {
        if (!best || t.sol > best.sol) best = { mint, sol: t.sol, symbol: tok?.symbol || null, sig: t.sig };
      }
    }
  }
  if (!best) {
    for (const [mint, c] of Object.entries(cb)) {
      const tok = tokens.find(t => t.mint === mint);
      const pnl = tokenTotalPnl(c, tok);
      if (!best || pnl > best.sol) best = { mint, sol: pnl, symbol: tok?.symbol || null };
    }
  }
  return best;
}
