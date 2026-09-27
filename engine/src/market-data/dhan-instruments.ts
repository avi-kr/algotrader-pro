// Dhan has no symbol-string API — every order and data request is keyed by a
// numeric `securityId`, resolved from a published CSV instrument master
// (https://dhanhq.co/docs/v2/instruments/). This module fetches and caches
// that CSV in memory for the process lifetime (it's tens of thousands of
// rows and changes rarely — refetching per-request would be wasteful and
// would burn into the Non-Trading API rate limit for no reason) and maps our
// existing Yahoo-style symbols (e.g. "RELIANCE.NS", see lib/constants.js)
// onto Dhan's (securityId, exchangeSegment) pair.

export interface DhanInstrument {
  securityId: string
  symbol: string // Dhan's own SEM_TRADING_SYMBOL, no ".NS" suffix
  exchangeSegment: string // e.g. "NSE_EQ"
  instrument: string // e.g. "EQUITY"
  lotSize: number
}

const COMPACT_CSV_URL = 'https://images.dhan.co/api-data/api-scrip-master.csv'

// Compact CSV column names, per https://dhanhq.co/docs/v2/instruments/
const COL = {
  exchangeId: 'SEM_EXM_EXCH_ID',
  securityId: 'SEM_SMST_SECURITY_ID',
  symbol: 'SEM_TRADING_SYMBOL',
  instrumentName: 'SEM_INSTRUMENT_NAME',
  lotUnits: 'SEM_LOT_UNITS',
} as const

function parseCsvLine(line: string): string[] {
  // The Dhan scrip master doesn't quote-escape embedded commas in the fields
  // this module reads (symbol/segment/id/lot size are all plain tokens), so
  // a plain split is safe here — this is not a general-purpose CSV parser.
  return line.split(',')
}

let cache: Map<string, DhanInstrument> | null = null
let cachePromise: Promise<Map<string, DhanInstrument>> | null = null

async function loadInstruments(): Promise<Map<string, DhanInstrument>> {
  const res = await fetch(COMPACT_CSV_URL)
  if (!res.ok) throw new Error(`Dhan instrument master fetch failed: ${res.status}`)
  const text = await res.text()
  const lines = text.split('\n').filter(l => l.trim().length > 0)
  const header = parseCsvLine(lines[0]).map(h => h.trim())
  const idx = (col: string) => header.indexOf(col)

  const iExch = idx(COL.exchangeId)
  const iSecId = idx(COL.securityId)
  const iSymbol = idx(COL.symbol)
  const iInstrument = idx(COL.instrumentName)
  const iLot = idx(COL.lotUnits)

  // Filtering to NSE + EQUITY rows means every surviving row is unambiguously
  // NSE_EQ — this app doesn't trade F&O/currency/commodity segments (or any
  // exchange but NSE) yet, so there's no need for a general
  // exchange+segment-code composer here (see docs/ARCHITECTURE.md).
  const byNseSymbol = new Map<string, DhanInstrument>()
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i])
    if (cols[iExch] !== 'NSE' || cols[iInstrument] !== 'EQUITY') continue
    const symbol = (cols[iSymbol] || '').trim()
    if (!symbol) continue
    byNseSymbol.set(symbol.toUpperCase(), {
      securityId: cols[iSecId],
      symbol,
      exchangeSegment: 'NSE_EQ',
      instrument: 'EQUITY',
      lotSize: Number(cols[iLot]) || 1,
    })
  }
  return byNseSymbol
}

/** Strips the ".NS"/".BO" suffix this codebase uses everywhere else
 * (lib/constants.js NIFTY50, US_EQUITIES etc. are Yahoo-style tickers) down
 * to Dhan's bare trading symbol. */
function toBareSymbol(symbol: string): string {
  return symbol.replace(/\.(NS|BO)$/i, '').toUpperCase()
}

/** Resolves one of our own symbols (e.g. "RELIANCE.NS") to the
 * (securityId, exchangeSegment) pair every Dhan order/data request needs.
 * Throws rather than silently trading the wrong instrument if the symbol
 * isn't found in the master — a bad securityId is a live-money mistake. */
export async function resolveDhanInstrument(symbol: string): Promise<DhanInstrument> {
  if (!cache) {
    if (!cachePromise) cachePromise = loadInstruments()
    cache = await cachePromise
  }
  const found = cache.get(toBareSymbol(symbol))
  if (!found) {
    throw new Error(`No Dhan NSE equity instrument found for symbol "${symbol}" (looked up as "${toBareSymbol(symbol)}")`)
  }
  return found
}

/** Test/ops hook to force a re-fetch (the master file is refreshed by Dhan
 * periodically, e.g. after corporate actions or new listings). */
export function clearDhanInstrumentCache(): void {
  cache = null
  cachePromise = null
}
