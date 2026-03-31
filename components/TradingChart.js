'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { TrendingUp, TrendingDown, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'

export default function TradingChart({
  candles = [],
  indicators = {},   // { ema9: [...], ema20: [...] }
  indicatorDefs = [], // [{ id, type, color }]
  overlays = [],     // trade markers
  height = 400,
}) {
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const seriesRef = useRef({})
  const [chartReady, setChartReady] = useState(false)
  const [info, setInfo] = useState(null)

  const initChart = useCallback(async () => {
    if (!containerRef.current || !candles.length) return

    const { createChart, ColorType, CrosshairMode, LineStyle } = await import('lightweight-charts')

    // Destroy existing
    if (chartRef.current) {
      chartRef.current.remove()
      chartRef.current = null
      seriesRef.current = {}
    }

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: height,
      layout: {
        background: { type: ColorType.Solid, color: '#0D1117' },
        textColor: '#94A3B8',
        fontSize: 11,
        fontFamily: '"IBM Plex Mono", monospace',
      },
      grid: {
        vertLines: { color: '#1E2330', style: LineStyle.Solid },
        horzLines: { color: '#1E2330', style: LineStyle.Solid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#00E5A0', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#0F1117' },
        horzLine: { color: '#00E5A0', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#0F1117' },
      },
      timeScale: {
        borderColor: '#1E2330',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
      },
      rightPriceScale: {
        borderColor: '#1E2330',
        scaleMargins: { top: 0.1, bottom: 0.2 },
      },
      handleScale: { mouseWheel: true, pinch: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true },
    })

    chartRef.current = chart

    // Candlestick series
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#00E5A0',
      downColor: '#FF4560',
      borderUpColor: '#00E5A0',
      borderDownColor: '#FF4560',
      wickUpColor: '#00E5A0',
      wickDownColor: '#FF4560',
    })

    const sortedCandles = [...candles].sort((a, b) => a.time - b.time)
    candleSeries.setData(sortedCandles)
    seriesRef.current.candle = candleSeries

    // Add indicator overlays (EMA, SMA on main chart)
    for (const def of indicatorDefs) {
      const vals = indicators[def.id]
      if (!vals || !vals.length) continue

      if (['EMA', 'SMA', 'VWAP'].includes(def.type)) {
        const lineSeries = chart.addLineSeries({
          color: def.color || '#FFB800',
          lineWidth: 1.5,
          lastValueVisible: true,
          priceLineVisible: false,
          title: `${def.type}(${def.period || ''})`,
        })

        const lineData = sortedCandles
          .map((c, i) => ({ time: c.time, value: vals[i] }))
          .filter(d => d.value != null)

        lineSeries.setData(lineData)
        seriesRef.current[def.id] = lineSeries
      }

      if (def.type === 'BB') {
        const upper = indicators[`${def.id}_upper`]
        const lower = indicators[`${def.id}_lower`]
        if (upper && lower) {
          const upSeries = chart.addLineSeries({ color: def.color || '#6366F1', lineWidth: 1, lastValueVisible: false, priceLineVisible: false, title: 'BB Upper' })
          const lowSeries = chart.addLineSeries({ color: def.color || '#6366F1', lineWidth: 1, lastValueVisible: false, priceLineVisible: false, title: 'BB Lower' })
          upSeries.setData(sortedCandles.map((c, i) => ({ time: c.time, value: upper[i] })).filter(d => d.value != null))
          lowSeries.setData(sortedCandles.map((c, i) => ({ time: c.time, value: lower[i] })).filter(d => d.value != null))
        }
      }
    }

    // Trade markers (buy/sell)
    if (overlays.length > 0) {
      const markers = overlays.map(o => ({
        time: o.time,
        position: o.type === 'buy' ? 'belowBar' : 'aboveBar',
        color: o.type === 'buy' ? '#00E5A0' : '#FF4560',
        shape: o.type === 'buy' ? 'arrowUp' : 'arrowDown',
        text: o.type === 'buy' ? 'B' : 'S',
        size: 1.5,
      }))
      candleSeries.setMarkers(markers)
    }

    // Crosshair info
    chart.subscribeCrosshairMove(param => {
      if (!param.point || !param.seriesData) { setInfo(null); return }
      const d = param.seriesData.get(candleSeries)
      if (d) {
        setInfo({
          time: new Date(d.time * 1000).toLocaleDateString('en-IN'),
          open: d.open, high: d.high, low: d.low, close: d.close,
          up: d.close >= d.open,
        })
      }
    })

    chart.timeScale().fitContent()

    // Resize observer
    const ro = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth })
      }
    })
    ro.observe(containerRef.current)

    setChartReady(true)
    return () => { ro.disconnect(); chart.remove() }
  }, [candles, indicators, indicatorDefs, overlays, height])

  useEffect(() => {
    initChart()
  }, [initChart])

  const fmt = v => v?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div className="relative chart-container">
      {/* OHLCV info bar */}
      {info && (
        <div className="absolute top-2 left-3 z-10 flex items-center gap-4 text-xs font-mono bg-surface/80 px-3 py-1.5 rounded-lg border border-border backdrop-blur">
          <span className="text-muted">{info.time}</span>
          <span>O <span className="text-textprimary">{fmt(info.open)}</span></span>
          <span>H <span className="text-accent">{fmt(info.high)}</span></span>
          <span>L <span className="text-danger">{fmt(info.low)}</span></span>
          <span>C <span className={info.up ? 'text-accent' : 'text-danger'}>{fmt(info.close)}</span></span>
        </div>
      )}

      {!chartReady && candles.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-muted text-sm font-mono">
          Select a symbol to load chart data
        </div>
      )}

      {!chartReady && candles.length > 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-accent text-sm font-mono">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-accent rounded-full animate-pulse" />
            Loading chart...
          </div>
        </div>
      )}

      <div ref={containerRef} style={{ height: `${height}px` }} />
    </div>
  )
}
