import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Crosshair,
  Maximize2,
  Minimize2,
  ShieldCheck,
  Target,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import {
  formatCompactNumber,
  getBaselinePlainLabel,
} from '../lib/volumeAnalytics';
import {
  BaselinePeriod,
  DailyBar,
  MarketInstrument,
  TimeframeWindow,
} from '../types/market';

interface VolumeInspectorPanelProps {
  instrument: MarketInstrument;
  baseline: BaselinePeriod;
  activeTimeframe: TimeframeWindow;
  onSelectInstrument?: (symbol: string) => void;
  peerInstruments?: MarketInstrument[];
  selectedTradeSymbol?: string;
  onPickAsDailyTrade?: (symbol: string) => void;
}

function formatShortDate(isoDate: string): string {
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const mIdx = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  return `${months[mIdx] || parts[1]} ${day}`;
}

export const VolumeInspectorPanel: React.FC<VolumeInspectorPanelProps> = ({
  instrument,
  baseline,
  selectedTradeSymbol,
  onPickAsDailyTrade,
}) => {
  const [chartWindowDays, setChartWindowDays] = useState<30 | 60 | 90 | 120 | 252>(90);
  const [chartStyle, setChartStyle] = useState<'candles' | 'line'>('candles');
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [hoveredBarIndex, setHoveredBarIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const metrics = instrument.metricsByBaseline[baseline];
  const baselineLabel = getBaselinePlainLabel(baseline);
  const isPickedAsDailyTrade = selectedTradeSymbol === instrument.symbol;

  const visibleHistory = useMemo(() => {
    return instrument.history.slice(-chartWindowDays);
  }, [instrument.history, chartWindowDays]);

  // Compute 20-day Simple Moving Average of Close price for every visible bar
  const priceMa20Series = useMemo(() => {
    const fullHistory = instrument.history;
    const totalLen = fullHistory.length;
    const startOffset = Math.max(0, totalLen - visibleHistory.length);

    return visibleHistory.map((_, visIdx) => {
      const fullIdx = startOffset + visIdx;
      const sliceStart = Math.max(0, fullIdx - 19);
      const windowBars = fullHistory.slice(sliceStart, fullIdx + 1);
      const sum = windowBars.reduce((acc, b) => acc + b.close, 0);
      return sum / Math.max(1, windowBars.length);
    });
  }, [instrument.history, visibleHistory]);

  const activeBar: DailyBar | undefined =
    hoveredBarIndex !== null && visibleHistory[hoveredBarIndex]
      ? visibleHistory[hoveredBarIndex]
      : visibleHistory[visibleHistory.length - 1];

  const chartStats = useMemo(() => {
    if (visibleHistory.length === 0) {
      return {
        minPrice: 0,
        maxPrice: 100,
        rawLow: 0,
        rawHigh: 100,
        maxVol: 1_000_000,
      };
    }
    let minPrice = Infinity;
    let maxPrice = -Infinity;
    let maxVol = 0;

    visibleHistory.forEach((b, idx) => {
      if (b.low < minPrice) minPrice = b.low;
      if (b.high > maxPrice) maxPrice = b.high;
      const maPrice = priceMa20Series[idx];
      if (maPrice && maPrice < minPrice) minPrice = maPrice;
      if (maPrice && maPrice > maxPrice) maxPrice = maPrice;

      if (b.volume > maxVol) maxVol = b.volume;
      if (b.ma20Volume > maxVol) maxVol = b.ma20Volume;
      if (b.ma90Volume > maxVol) maxVol = b.ma90Volume;
    });

    if (metrics.baselineVol > maxVol) {
      maxVol = metrics.baselineVol;
    }

    const rawLow = minPrice;
    const rawHigh = maxPrice;
    const pad = (maxPrice - minPrice) * 0.08 || 1;
    return {
      minPrice: Math.max(0, minPrice - pad),
      maxPrice: maxPrice + pad,
      rawLow,
      rawHigh,
      maxVol: maxVol * 1.15 || 1,
    };
  }, [visibleHistory, priceMa20Series, metrics.baselineVol]);

  const svgWidth = isExpanded ? 1140 : 680;
  const leftPad = 14;
  const rightAxisWidth = 68;
  const plotWidth = svgWidth - leftPad - rightAxisWidth;

  const priceTop = 14;
  const priceHeight = isExpanded ? 290 : 195;
  const volTop = priceTop + priceHeight + 24;
  const volHeight = isExpanded ? 150 : 105;
  const bottomAxisHeight = 26;
  const svgHeight = volTop + volHeight + bottomAxisHeight;

  const getBarX = (idx: number, total: number) => {
    if (total <= 1) return leftPad + plotWidth / 2;
    const step = plotWidth / total;
    return leftPad + step * (idx + 0.5);
  };

  const getPriceY = (priceVal: number) => {
    return (
      priceTop +
      priceHeight -
      ((priceVal - chartStats.minPrice) /
        Math.max(0.01, chartStats.maxPrice - chartStats.minPrice)) *
        priceHeight
    );
  };

  const priceLinePoints = useMemo(() => {
    const n = visibleHistory.length;
    if (n === 0) return '';
    return visibleHistory
      .map((b, idx) => {
        const x = getBarX(idx, n);
        const y = getPriceY(b.close);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [visibleHistory, chartStats, isExpanded]);

  const priceAreaPath = useMemo(() => {
    const n = visibleHistory.length;
    if (n === 0) return '';
    const coords = visibleHistory.map((b, idx) => ({
      x: getBarX(idx, n),
      y: getPriceY(b.close),
    }));
    const first = coords[0];
    const last = coords[coords.length - 1];
    const linePart = coords.map((pt) => `L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(' ');
    const bottomY = (priceTop + priceHeight).toFixed(1);
    return `M ${first.x.toFixed(1)} ${bottomY} ${linePart} L ${last.x.toFixed(1)} ${bottomY} Z`;
  }, [visibleHistory, chartStats, isExpanded]);

  const priceMa20Points = useMemo(() => {
    const n = visibleHistory.length;
    if (n === 0) return '';
    return priceMa20Series
      .map((maVal, idx) => {
        const x = getBarX(idx, n);
        const y = getPriceY(maVal);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [priceMa20Series, visibleHistory.length, chartStats, isExpanded]);

  const ma20VolPoints = useMemo(() => {
    const n = visibleHistory.length;
    if (n === 0) return '';
    return visibleHistory
      .map((b, idx) => {
        const x = getBarX(idx, n);
        const y =
          volTop +
          volHeight -
          (b.ma20Volume / chartStats.maxVol) * (volHeight - 8);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [visibleHistory, chartStats, isExpanded]);

  const baselineVolY = useMemo(() => {
    const bVol = metrics.baselineVol;
    return (
      volTop +
      volHeight -
      Math.min(1, bVol / chartStats.maxVol) * (volHeight - 8)
    );
  }, [metrics.baselineVol, chartStats.maxVol, isExpanded]);

  const xDateTicks = useMemo(() => {
    const n = visibleHistory.length;
    if (n === 0) return [];
    const tickCount = isExpanded ? 7 : 5;
    const indices: number[] = [];
    for (let i = 0; i < tickCount; i++) {
      indices.push(Math.round((i / (tickCount - 1)) * (n - 1)));
    }
    const uniqueIndices = Array.from(new Set(indices));
    return uniqueIndices.map((idx, pos) => ({
      idx,
      x: getBarX(idx, n),
      date: visibleHistory[idx].date,
      shortDate: formatShortDate(visibleHistory[idx].date),
      anchor:
        pos === 0
          ? ('start' as const)
          : pos === uniqueIndices.length - 1
          ? ('end' as const)
          : ('middle' as const),
    }));
  }, [visibleHistory, isExpanded]);

  const handleSvgMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || visibleHistory.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / Math.max(1, rect.width)) * svgWidth;

    const clampedX = Math.max(leftPad, Math.min(leftPad + plotWidth - 0.01, relX));
    const step = plotWidth / Math.max(1, visibleHistory.length);
    const idx = Math.min(
      visibleHistory.length - 1,
      Math.max(0, Math.floor((clampedX - leftPad) / step))
    );
    setHoveredBarIndex(idx);
  };

  const isUpsideBias =
    metrics.directionBias === 'UPSIDE_BREAKOUT' ||
    metrics.directionBias === 'UPSIDE_ACCUMULATION' ||
    metrics.directionBias === 'BULLISH_LOW_VOL_PULLBACK';
  const isDownsideBias = metrics.directionBias === 'DOWNSIDE_DISTRIBUTION';

  const latestCloseY = getPriceY(instrument.price);

  return (
    <div
      className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden flex flex-col ${
        isExpanded
          ? 'fixed inset-4 z-50 overflow-y-auto shadow-2xl ring-1 ring-sky-500/40'
          : ''
      }`}
    >
      {/* Header: Stock Name, Verified Price & Date, Pick #1 Button, Fullscreen */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-lg font-bold text-slate-900 dark:text-slate-100">
              {instrument.symbol}
            </span>
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              {instrument.name}
            </span>
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-mono text-[10px] font-medium">
              <ShieldCheck className="w-3 h-3" />
              <span>
                {instrument.dataSource === 'live'
                  ? `Verified Close (${instrument.lastUpdated})`
                  : `Calibrated (${instrument.lastUpdated})`}
              </span>
            </span>
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono tabular-nums">
            {instrument.isSectorETF ? 'Market Sector ETF' : `${instrument.sectorName} Sector`} · {chartWindowDays === 252 ? '1Y' : `${chartWindowDays}D`} Range: ${chartStats.rawLow.toFixed(2)} – ${chartStats.rawHigh.toFixed(2)}
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="text-right mr-1">
            <div className="font-mono text-base font-bold text-slate-900 dark:text-slate-100 tabular-nums">
              ${instrument.price.toFixed(2)}
            </div>
            <div
              className={`inline-flex items-center gap-0.5 font-mono text-xs font-medium tabular-nums ${
                instrument.change1DPct >= 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {instrument.change1DPct >= 0 ? (
                <ArrowUpRight className="w-3 h-3" />
              ) : (
                <ArrowDownRight className="w-3 h-3" />
              )}
              <span>
                {instrument.change1DPct >= 0 ? '+' : ''}
                {instrument.change1DPct.toFixed(2)}% (1D)
              </span>
            </div>
          </div>

          {onPickAsDailyTrade && (
            <button
              onClick={() => onPickAsDailyTrade(instrument.symbol)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                isPickedAsDailyTrade
                  ? 'bg-emerald-600 text-white'
                  : 'bg-sky-600 hover:bg-sky-500 text-white'
              }`}
            >
              {isPickedAsDailyTrade ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>#1 Pick</span>
                </>
              ) : (
                <>
                  <Target className="w-3.5 h-3.5" />
                  <span>Pick as #1 Trade</span>
                </>
              )}
            </button>
          )}

          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="px-2.5 py-1.5 text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-md transition-colors inline-flex items-center gap-1 whitespace-nowrap shrink-0"
          >
            {isExpanded ? (
              <>
                <Minimize2 className="w-3.5 h-3.5 text-sky-500" />
                <span>Shrink</span>
              </>
            ) : (
              <>
                <Maximize2 className="w-3.5 h-3.5 text-sky-500" />
                <span>Fullscreen</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Clear Verdict Banner: Is Volume Pointing UP or DOWN? */}
      <div
        className={`px-4 py-3 border-b border-slate-200 dark:border-slate-800 text-xs ${
          isUpsideBias
            ? 'bg-emerald-500/10'
            : isDownsideBias
            ? 'bg-rose-500/10'
            : 'bg-slate-50 dark:bg-slate-950/60'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {isUpsideBias ? (
              <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            ) : isDownsideBias ? (
              <TrendingDown className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
            ) : (
              <BarChart3 className="w-4 h-4 text-amber-500 shrink-0" />
            )}
            <span
              className={`font-mono font-bold ${
                isUpsideBias
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : isDownsideBias
                  ? 'text-rose-700 dark:text-rose-400'
                  : 'text-amber-700 dark:text-amber-400'
              }`}
            >
              {metrics.directionalSummary}
            </span>
          </div>
          <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            5D Price: {instrument.change5DPct >= 0 ? '+' : ''}
            {instrument.change5DPct.toFixed(2)}%
          </span>
        </div>
        <p className="mt-1 text-slate-700 dark:text-slate-300 font-medium">
          {metrics.expectedMoveText}
        </p>
        <p className="mt-0.5 text-slate-500 dark:text-slate-400">
          {metrics.regimeRationale}
        </p>
      </div>

      {/* 4 Simple Key Numbers Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800 border-b border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-950/30">
        <div className="p-3">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            Today vs. Normal
          </div>
          <div className="mt-0.5 font-mono text-base font-bold text-slate-900 dark:text-slate-100 tabular-nums">
            {metrics.rvol1D.toFixed(2)}x
          </div>
        </div>

        <div className="p-3">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            This Week vs. Normal
          </div>
          <div
            className={`mt-0.5 font-mono text-base font-bold tabular-nums ${
              metrics.rvol5D >= 1.2
                ? isDownsideBias
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-emerald-600 dark:text-emerald-400'
                : 'text-slate-900 dark:text-slate-100'
            }`}
          >
            {metrics.rvol5D.toFixed(2)}x
          </div>
        </div>

        <div className="p-3">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            Steady Days (Last 20d)
          </div>
          <div className="mt-0.5 font-mono text-base font-bold text-slate-900 dark:text-slate-100 tabular-nums">
            {metrics.daysAboveBaseline20D} of 20
          </div>
        </div>

        <div className="p-3">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            Buyers vs. Sellers
          </div>
          <div
            className={`mt-0.5 font-mono text-base font-bold tabular-nums ${
              metrics.buyingVolumePct20D >= 50
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            {metrics.buyingVolumePct20D}% Buy
          </div>
        </div>
      </div>

      {/* Interactive Price & Volume Coordinate Chart */}
      <div className="p-4 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200">
              <Crosshair className="w-3.5 h-3.5 text-sky-500" />
              <span>Daily OHLC Price &amp; Volume ({baselineLabel})</span>
            </div>

            {/* Chart Style Switcher: Candles vs Line */}
            <div className="flex items-center gap-0.5 p-0.5 bg-slate-100 dark:bg-slate-800 rounded">
              <button
                onClick={() => setChartStyle('candles')}
                className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors ${
                  chartStyle === 'candles'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                Candles
              </button>
              <button
                onClick={() => setChartStyle('line')}
                className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors ${
                  chartStyle === 'line'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                Line
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1 p-0.5 bg-slate-100 dark:bg-slate-800 rounded">
            {([30, 60, 90, 120, 252] as const).map((days) => (
              <button
                key={days}
                onClick={() => setChartWindowDays(days)}
                className={`px-2 py-0.5 text-[11px] font-mono font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  chartWindowDays === days
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {days === 252 ? '1Y' : `${days}D`}
              </button>
            ))}
          </div>
        </div>

        {/* Complete OHLC + Volume Readout Bar */}
        {activeBar && (
          <div className="px-2.5 py-1.5 rounded bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 font-mono text-[11px] text-slate-600 dark:text-slate-300 tabular-nums">
            <span className="text-sky-600 dark:text-sky-400 font-semibold">
              {activeBar.date} ({activeBar.sessionCloseTime})
            </span>
            <div className="flex flex-wrap items-center gap-2.5">
              <span>
                O:<strong className="text-slate-900 dark:text-slate-100 ml-0.5">${activeBar.open.toFixed(2)}</strong>
              </span>
              <span>
                H:<strong className="text-slate-900 dark:text-slate-100 ml-0.5">${activeBar.high.toFixed(2)}</strong>
              </span>
              <span>
                L:<strong className="text-slate-900 dark:text-slate-100 ml-0.5">${activeBar.low.toFixed(2)}</strong>
              </span>
              <span>
                C:
                <strong
                  className={`ml-0.5 ${
                    activeBar.changePct >= 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  ${activeBar.close.toFixed(2)} ({activeBar.changePct >= 0 ? '+' : ''}
                  {activeBar.changePct.toFixed(2)}%)
                </strong>
              </span>
            </div>
            <span>
              Vol:{' '}
              <strong className="text-slate-900 dark:text-slate-100">
                {formatCompactNumber(activeBar.volume)}
              </strong>{' '}
              (
              {(baseline === '90D' ? activeBar.rvol90 : activeBar.rvol252).toFixed(2)}x
              )
            </span>
          </div>
        )}

        <div className="relative w-full overflow-hidden select-none border border-slate-200/80 dark:border-slate-800 rounded-md bg-slate-50/40 dark:bg-slate-950/60 p-1">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="w-full h-auto overflow-visible cursor-crosshair"
            onMouseMove={handleSvgMouseMove}
            onMouseLeave={() => setHoveredBarIndex(null)}
          >
            <defs>
              <linearGradient id="priceAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.24" />
                <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Price Horizontal Grid Lines & Right-Axis Labels */}
            {[0.12, 0.36, 0.62, 0.86].map((ratio, idx) => {
              const y = Math.round(priceTop + priceHeight * ratio);
              const priceVal =
                chartStats.maxPrice -
                ratio * (chartStats.maxPrice - chartStats.minPrice);
              return (
                <g key={`p-grid-${idx}`}>
                  <line
                    x1={leftPad}
                    y1={y}
                    x2={leftPad + plotWidth}
                    y2={y}
                    stroke="currentColor"
                    className="text-slate-200 dark:text-slate-800/80"
                    strokeDasharray="3 3"
                  />
                  <text
                    x={leftPad + plotWidth + 6}
                    y={y + 3}
                    textAnchor="start"
                    className="fill-slate-500 dark:fill-slate-400 font-mono text-[10px]"
                  >
                    ${priceVal.toFixed(priceVal >= 100 ? 1 : 2)}
                  </text>
                </g>
              );
            })}

            {/* Vertical Date Grid & X-Axis Labels */}
            {xDateTicks.map((tick) => (
              <g key={`x-tick-${tick.idx}`}>
                <line
                  x1={tick.x}
                  y1={priceTop}
                  x2={tick.x}
                  y2={volTop + volHeight}
                  stroke="currentColor"
                  className="text-slate-200/60 dark:text-slate-800/40"
                  strokeDasharray="2 4"
                />
                <text
                  x={tick.x}
                  y={volTop + volHeight + 16}
                  textAnchor={tick.anchor}
                  className="fill-slate-500 dark:fill-slate-400 font-mono text-[10px]"
                >
                  {tick.shortDate}
                </text>
              </g>
            ))}

            {/* Right Axis Border & Volume Bottom Border */}
            <line
              x1={leftPad + plotWidth}
              y1={priceTop}
              x2={leftPad + plotWidth}
              y2={volTop + volHeight}
              stroke="currentColor"
              className="text-slate-300 dark:text-slate-700"
            />
            <line
              x1={leftPad}
              y1={volTop + volHeight}
              x2={leftPad + plotWidth}
              y2={volTop + volHeight}
              stroke="currentColor"
              className="text-slate-300 dark:text-slate-700"
            />

            {/* Divider between Price Pane and Volume Pane */}
            <line
              x1={leftPad}
              y1={volTop - 10}
              x2={leftPad + plotWidth}
              y2={volTop - 10}
              stroke="currentColor"
              className="text-slate-300 dark:text-slate-800"
            />
            <text
              x={leftPad + 4}
              y={volTop + 2}
              className="fill-slate-400 dark:fill-slate-500 font-mono text-[9px] uppercase tracking-wider"
            >
              Daily Volume vs. {baselineLabel} ({formatCompactNumber(metrics.baselineVol)})
            </text>

            {/* Volume Right-Axis Labels */}
            {[0.4, 0.8].map((vRatio, idx) => {
              const y = Math.round(volTop + volHeight * (1 - vRatio));
              const volVal = chartStats.maxVol * vRatio;
              return (
                <text
                  key={`v-tick-${idx}`}
                  x={leftPad + plotWidth + 6}
                  y={y + 3}
                  textAnchor="start"
                  className="fill-slate-400 dark:fill-slate-500 font-mono text-[10px]"
                >
                  {formatCompactNumber(volVal)}
                </text>
              );
            })}

            {/* 20-Day Price Moving Average (Purple Trend Line) */}
            <polyline
              fill="none"
              stroke="#a855f7"
              strokeWidth="1.5"
              strokeOpacity="0.8"
              points={priceMa20Points}
            />

            {/* Price Rendering: Candlesticks OR Area Line */}
            {chartStyle === 'line' ? (
              <>
                <path d={priceAreaPath} fill="url(#priceAreaGrad)" />
                <polyline
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth="2"
                  points={priceLinePoints}
                />
              </>
            ) : (
              visibleHistory.map((b, idx) => {
                const n = visibleHistory.length;
                const slotWidth = plotWidth / Math.max(1, n);
                const candleWidth = Math.max(2, Math.min(10, slotWidth * 0.68));
                const cx = getBarX(idx, n);
                const highY = getPriceY(b.high);
                const lowY = getPriceY(b.low);
                const openY = getPriceY(b.open);
                const closeY = getPriceY(b.close);
                const isUp = b.close >= b.open;
                const bodyTop = Math.min(openY, closeY);
                const bodyHeight = Math.max(1.5, Math.abs(closeY - openY));

                const strokeColor = isUp ? '#10b981' : '#f43f5e';

                return (
                  <g key={`candle-${b.date}`}>
                    <line
                      x1={cx}
                      y1={highY}
                      x2={cx}
                      y2={lowY}
                      stroke={strokeColor}
                      strokeWidth={1.1}
                    />
                    <rect
                      x={cx - candleWidth / 2}
                      y={bodyTop}
                      width={candleWidth}
                      height={bodyHeight}
                      rx={0.5}
                      fill={strokeColor}
                    />
                  </g>
                );
              })
            )}

            {/* Latest Close Price Reference Line & Right-Axis Pill (when not hovering) */}
            {hoveredBarIndex === null && (
              <g>
                <line
                  x1={leftPad}
                  y1={latestCloseY}
                  x2={leftPad + plotWidth}
                  y2={latestCloseY}
                  stroke="#0ea5e9"
                  strokeWidth="1"
                  strokeDasharray="2 3"
                  strokeOpacity="0.7"
                />
                <rect
                  x={leftPad + plotWidth + 2}
                  y={latestCloseY - 8}
                  width={rightAxisWidth - 4}
                  height={16}
                  rx={3}
                  className="fill-slate-800 dark:fill-slate-700"
                />
                <text
                  x={leftPad + plotWidth + 5}
                  y={latestCloseY + 3}
                  className="fill-white font-mono text-[9.5px] font-semibold"
                >
                  ${instrument.price.toFixed(2)}
                </text>
              </g>
            )}

            {/* Volume Bars */}
            {visibleHistory.map((b, idx) => {
              const n = visibleHistory.length;
              const slotWidth = plotWidth / Math.max(1, n);
              const barWidth = Math.max(1.5, Math.min(10, slotWidth * 0.72));
              const centerX = getBarX(idx, n);
              const x = centerX - barWidth / 2;
              const barH = Math.max(
                2,
                (b.volume / chartStats.maxVol) * (volHeight - 8)
              );
              const y = volTop + volHeight - barH;

              const isUp = b.close >= b.open;
              let fillClass = 'fill-slate-400/50 dark:fill-slate-600/60';
              if (b.isAccumulation) {
                fillClass = 'fill-emerald-500 dark:fill-emerald-400';
              } else if (b.isDistribution) {
                fillClass = 'fill-rose-500 dark:fill-rose-400';
              } else if (isUp) {
                fillClass = 'fill-emerald-500/45 dark:fill-emerald-500/40';
              } else {
                fillClass = 'fill-rose-500/45 dark:fill-rose-500/40';
              }

              return (
                <rect
                  key={`vol-${b.date}`}
                  x={x}
                  y={y}
                  width={barWidth}
                  height={barH}
                  rx={1}
                  className={fillClass}
                />
              );
            })}

            {/* 20-Day Volume Moving Average Line */}
            <polyline
              fill="none"
              stroke="#f59e0b"
              strokeWidth="1.5"
              points={ma20VolPoints}
            />

            {/* Normal Baseline Volume Line */}
            <line
              x1={leftPad}
              y1={baselineVolY}
              x2={leftPad + plotWidth}
              y2={baselineVolY}
              stroke="#94a3b8"
              strokeWidth="1.2"
              strokeDasharray="4 4"
            />

            {/* Snapped Hover Crosshair (Locked to Hovered Bar's Date & Close Price) */}
            {hoveredBarIndex !== null && visibleHistory[hoveredBarIndex] && (
              <g>
                {(() => {
                  const bar = visibleHistory[hoveredBarIndex];
                  const cx = getBarX(hoveredBarIndex, visibleHistory.length);
                  const cy = getPriceY(bar.close);
                  const boxW = 92;
                  const clampedBoxX = Math.max(
                    leftPad,
                    Math.min(leftPad + plotWidth - boxW, cx - boxW / 2)
                  );
                  return (
                    <>
                      {/* Vertical Crosshair Line */}
                      <line
                        x1={cx}
                        y1={priceTop}
                        x2={cx}
                        y2={volTop + volHeight}
                        stroke="#38bdf8"
                        strokeWidth="1"
                        strokeDasharray="3 3"
                      />

                      {/* Horizontal Snapped Close Price Line */}
                      <line
                        x1={leftPad}
                        y1={cy}
                        x2={leftPad + plotWidth}
                        y2={cy}
                        stroke="#38bdf8"
                        strokeWidth="1"
                        strokeDasharray="3 3"
                      />

                      {/* Highlighted Point on Bar Close */}
                      <circle
                        cx={cx}
                        cy={cy}
                        r={4}
                        className="fill-sky-400 stroke-slate-950 stroke-2"
                      />

                      {/* Right Axis Snapped Price Pill */}
                      <rect
                        x={leftPad + plotWidth + 2}
                        y={cy - 9}
                        width={rightAxisWidth - 4}
                        height={18}
                        rx={3}
                        className="fill-sky-600"
                      />
                      <text
                        x={leftPad + plotWidth + 5}
                        y={cy + 3}
                        className="fill-white font-mono text-[10px] font-semibold"
                      >
                        ${bar.close.toFixed(2)}
                      </text>

                      {/* Bottom Axis Snapped Date Pill */}
                      <rect
                        x={clampedBoxX}
                        y={volTop + volHeight + 3}
                        width={boxW}
                        height={18}
                        rx={3}
                        className="fill-sky-600"
                      />
                      <text
                        x={clampedBoxX + boxW / 2}
                        y={volTop + volHeight + 15}
                        textAnchor="middle"
                        className="fill-white font-mono text-[10px] font-semibold"
                      >
                        {bar.date}
                      </text>
                    </>
                  );
                })()}
              </g>
            )}
          </svg>

          {/* Compact Legend */}
          <div className="mt-2 px-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400 border-t border-slate-200/70 dark:border-slate-800/70 pt-1.5">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 bg-emerald-500 inline-block rounded-xs" />
                <span>Green = Up / Buying</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 bg-rose-500 inline-block rounded-xs" />
                <span>Red = Down / Selling</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2.5 h-0.5 bg-purple-500 inline-block" />
                <span>20D Price Trend</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2.5 h-0.5 bg-amber-500 inline-block" />
                <span>20D Volume Avg</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
