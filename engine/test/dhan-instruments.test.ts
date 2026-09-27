import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveDhanInstrument, clearDhanInstrumentCache } from '../src/market-data/dhan-instruments'

const CSV = [
  'SEM_EXM_EXCH_ID,SEM_SEGMENT,SEM_SMST_SECURITY_ID,SEM_TRADING_SYMBOL,SEM_INSTRUMENT_NAME,SEM_LOT_UNITS',
  'NSE,E,1333,RELIANCE,EQUITY,1',
  'NSE,E,11536,TCS,EQUITY,1',
  'BSE,E,500325,RELIANCE,EQUITY,1', // same symbol on another exchange — must not be picked
  'NSE,D,49081,RELIANCE-FUT,FUTSTK,500', // derivative row — must not be picked for an equity lookup
].join('\n')

describe('resolveDhanInstrument', () => {
  beforeEach(() => {
    clearDhanInstrumentCache()
    vi.unstubAllGlobals()
  })

  it('resolves a Yahoo-style symbol (with .NS suffix) to Dhan securityId/exchangeSegment, filtering to NSE equity only', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => CSV }))
    const result = await resolveDhanInstrument('RELIANCE.NS')
    expect(result.securityId).toBe('1333')
    expect(result.exchangeSegment).toBe('NSE_EQ')
    expect(result.instrument).toBe('EQUITY')
  })

  it('is case-insensitive and works without a .NS suffix', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => CSV }))
    const result = await resolveDhanInstrument('tcs')
    expect(result.securityId).toBe('11536')
  })

  it('caches the instrument master across calls — only fetches once', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => CSV })
    vi.stubGlobal('fetch', fetchMock)
    await resolveDhanInstrument('RELIANCE.NS')
    await resolveDhanInstrument('TCS.NS')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws for a symbol not found in the NSE equity master (fail loud, never guess a securityId)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => CSV }))
    await expect(resolveDhanInstrument('NOTREAL.NS')).rejects.toThrow(/No Dhan NSE equity instrument found/)
  })
})
