import React, { useMemo, useState } from 'react';
import { CheckCircle2, RotateCcw, Search, SlidersHorizontal, Target } from 'lucide-react';
import {
  getPriceChangeForTimeframe,
  getRvolForTimeframe,
  GICS_SECTORS,
} from '../lib/volumeAnalytics';
import {
  BaselinePeriod,
  MarketInstrument,
  TimeframeWindow,
} from '../types/market';

interface VolumeScannerViewProps {
  instruments: MarketInstrument[];
  selectedInstrumentSymbol: string;
  onSelectInstrument: (symbol: string) => void;
  timeframe: TimeframeWindow;
  baseline: BaselinePeriod;
  selectedTradeSymbol?: string;
  onPickAsDailyTrade?: (symbol: string) => void;
}

type ScannerPreset =
  | 'ALL'
  | 'BREAKOUT_SURGE'
  | 'STEALTH_COIL'
  | 'SUSTAINED_INFLOW'
  | 'DISTRIBUTION_WARNING';

export const VolumeScannerView: React.FC<VolumeScannerViewProps> = ({
  instruments,
  selectedInstrumentSymbol,
  onSelectInstrument,
  timeframe,
  baseline,
  selectedTradeSymbol,
  onPickAsDailyTrade,
}) => {
  const [preset, setPreset] = useState<ScannerPreset>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [sectorFilter, setSectorFilter] = useState<string>('ALL');
  const [minRvol, setMinRvol] = useState<number>(0);

  const applyPreset = (nextPreset: ScannerPreset) => {
    setPreset(nextPreset);
    if (nextPreset === 'ALL') {
      setMinRvol(0);
    } else if (nextPreset === 'BREAKOUT_SURGE') {
      setMinRvol(1.3);
    } else if (nextPreset === 'STEALTH_COIL') {
      setMinRvol(1.2);
    } else if (nextPreset === 'SUSTAINED_INFLOW') {
      setMinRvol(1.15);
    } else if (nextPreset === 'DISTRIBUTION_WARNING') {
      setMinRvol(1.15);
    }
  };

  const resetFilters = () => {
    setPreset('ALL');
    setSearchQuery('');
    setSectorFilter('ALL');
    setMinRvol(0);
  };

  const filteredAndSorted = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    const filtered = instruments.filter((inst) => {
      if (inst.isSectorETF) return false; // Focus on tradeable stocks in Stock Finder

      if (sectorFilter !== 'ALL' && inst.sectorSymbol !== sectorFilter) {
        return false;
      }

      const m = inst.metricsByBaseline[baseline];
      const activeRvol = getRvolForTimeframe(m, timeframe);
      if (activeRvol < minRvol) return false;

      if (preset === 'BREAKOUT_SURGE' && m.regime !== 'Breakout Expansion') {
        return false;
      }
      if (preset === 'STEALTH_COIL' && m.regime !== 'Stealth Accumulation') {
        return false;
      }
      if (preset === 'SUSTAINED_INFLOW' && m.daysAboveBaseline20D < 13) {
        return false;
      }
      if (
        preset === 'DISTRIBUTION_WARNING' &&
        m.regime !== 'Distribution Pressure'
      ) {
        return false;
      }

      if (q) {
        const matchSym = inst.symbol.toLowerCase().includes(q);
        const matchName = inst.name.toLowerCase().includes(q);
        const matchSec = inst.sectorName.toLowerCase().includes(q);
        if (!matchSym && !matchName && !matchSec) return false;
      }

      return true;
    });

    return filtered.sort((a, b) => {
      const rvolA = getRvolForTimeframe(a.metricsByBaseline[baseline], timeframe);
      const rvolB = getRvolForTimeframe(b.metricsByBaseline[baseline], timeframe);
      return rvolB - rvolA;
    });
  }, [instruments, preset, sectorFilter, minRvol, searchQuery, baseline, timeframe]);

  return (
    <div className="space-y-4">
      {/* Simple Filter Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Find Stocks by Volume Signal
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Pick a quick filter below to narrow down stocks, then click any stock to inspect its chart on the right.
            </p>
          </div>
          <button
            onClick={resetFilters}
            className="px-2.5 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded inline-flex items-center gap-1 whitespace-nowrap shrink-0"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset</span>
          </button>
        </div>

        {/* One-Click Filter Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100 dark:bg-slate-950 rounded-lg">
          {(
            [
              { id: 'ALL', label: 'All Stocks' },
              { id: 'BREAKOUT_SURGE', label: '▲ Strong Buying (Breaking Up)' },
              { id: 'STEALTH_COIL', label: '▲ Quiet Buying (Ready to Pop)' },
              { id: 'SUSTAINED_INFLOW', label: '▲ Most Steady Volume' },
              { id: 'DISTRIBUTION_WARNING', label: '▼ Heavy Selling (Dropping)' },
            ] as { id: ScannerPreset; label: string }[]
          ).map((tab) => (
            <button
              key={tab.id}
              onClick={() => applyPreset(tab.id)}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                preset === tab.id
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search & Sector Filter */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search ticker or company..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-sky-500"
            />
          </div>

          <select
            value={sectorFilter}
            onChange={(e) => setSectorFilter(e.target.value)}
            aria-label="Filter by sector"
            className="w-full px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
          >
            <option value="ALL">All 11 Market Sectors</option>
            {GICS_SECTORS.map((s) => (
              <option key={s.symbol} value={s.symbol}>
                {s.sectorName} ({s.symbol})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Clean Stock List */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <span>
            <strong className="font-mono text-slate-900 dark:text-slate-100">{filteredAndSorted.length}</strong> stocks found
          </span>
          <span>Click any stock to view its chart &rarr;</span>
        </div>

        {filteredAndSorted.length === 0 ? (
          <div className="p-10 text-center space-y-2.5">
            <SlidersHorizontal className="w-6 h-6 text-slate-400 mx-auto" />
            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              No stocks match those filters
            </div>
            <button
              onClick={resetFilters}
              className="px-3 py-1.5 text-xs font-medium bg-sky-600 text-white rounded-md hover:bg-sky-500"
            >
              Show All Stocks
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-200/70 dark:divide-slate-800/70">
            {filteredAndSorted.map((inst) => {
              const m = inst.metricsByBaseline[baseline];
              const activeRvol = getRvolForTimeframe(m, timeframe);
              const chg = getPriceChangeForTimeframe(inst, timeframe);
              const isSelected = inst.symbol === selectedInstrumentSymbol;
              const isPicked = inst.symbol === selectedTradeSymbol;
              const isBullish =
                m.directionBias === 'UPSIDE_BREAKOUT' ||
                m.directionBias === 'UPSIDE_ACCUMULATION' ||
                m.directionBias === 'BULLISH_LOW_VOL_PULLBACK';
              const isBearish = m.directionBias === 'DOWNSIDE_DISTRIBUTION';

              return (
                <div
                  key={inst.symbol}
                  onClick={() => onSelectInstrument(inst.symbol)}
                  className={`px-4 py-3 flex flex-wrap items-center justify-between gap-3 cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-sky-500/10 dark:bg-sky-500/15'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold text-slate-900 dark:text-slate-100">
                        {inst.symbol}
                      </span>
                      <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                        {inst.name}
                      </span>
                      <span className="text-xs text-slate-400">
                        · {inst.sectorName}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs">
                      <span
                        className={`font-mono font-semibold ${
                          isBullish
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : isBearish
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {m.directionalSummary}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 font-mono text-xs tabular-nums">
                    <div className="text-right">
                      <div className="text-[10px] font-sans text-slate-400">
                        Steady
                      </div>
                      <div>{m.daysAboveBaseline20D}/20d</div>
                    </div>

                    <div className="text-right min-w-[80px]">
                      <div
                        className={`font-bold ${
                          activeRvol >= 1.3
                            ? isBearish
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-emerald-600 dark:text-emerald-400'
                            : 'text-slate-900 dark:text-slate-100'
                        }`}
                      >
                        {activeRvol.toFixed(2)}x Vol
                      </div>
                      <div
                        className={
                          chg >= 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }
                      >
                        ${inst.price.toFixed(2)} ({chg >= 0 ? '+' : ''}
                        {chg.toFixed(1)}%)
                      </div>
                    </div>

                    {onPickAsDailyTrade && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onPickAsDailyTrade(inst.symbol);
                        }}
                        className={`px-2.5 py-1.5 text-xs font-sans font-medium rounded transition-colors inline-flex items-center gap-1 whitespace-nowrap shrink-0 ${
                          isPicked
                            ? 'bg-emerald-600 text-white'
                            : 'bg-slate-100 dark:bg-slate-800 hover:bg-sky-600 hover:text-white text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {isPicked ? (
                          <>
                            <CheckCircle2 className="w-3 h-3" />
                            <span>#1 Pick</span>
                          </>
                        ) : (
                          <>
                            <Target className="w-3 h-3" />
                            <span>Pick #1</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
