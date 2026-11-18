import React, { useMemo } from 'react';
import { CheckCircle2, Target } from 'lucide-react';
import {
  getPriceChangeForTimeframe,
  getRvolForTimeframe,
  getTimeframePlainLabel,
} from '../lib/volumeAnalytics';
import {
  BaselinePeriod,
  MarketInstrument,
  TimeframeWindow,
} from '../types/market';

interface SectorFlowViewProps {
  instruments: MarketInstrument[];
  selectedSectorSymbol: string;
  onSelectSector: (sectorSymbol: string) => void;
  selectedInstrumentSymbol: string;
  onSelectInstrument: (symbol: string) => void;
  timeframe: TimeframeWindow;
  baseline: BaselinePeriod;
  selectedTradeSymbol?: string;
  onPickAsDailyTrade?: (symbol: string) => void;
}

export const SectorFlowView: React.FC<SectorFlowViewProps> = ({
  instruments,
  selectedSectorSymbol,
  onSelectSector,
  selectedInstrumentSymbol,
  onSelectInstrument,
  timeframe,
  baseline,
  selectedTradeSymbol,
  onPickAsDailyTrade,
}) => {
  const sectors = useMemo(() => {
    return instruments
      .filter((i) => i.isSectorETF)
      .sort((a, b) => {
        const rvolA = getRvolForTimeframe(a.metricsByBaseline[baseline], timeframe);
        const rvolB = getRvolForTimeframe(b.metricsByBaseline[baseline], timeframe);
        return rvolB - rvolA;
      });
  }, [instruments, baseline, timeframe]);

  const selectedSector = useMemo(() => {
    return sectors.find((s) => s.symbol === selectedSectorSymbol) || sectors[0];
  }, [sectors, selectedSectorSymbol]);

  const constituentStocks = useMemo(() => {
    if (!selectedSector) return [];
    return instruments
      .filter((i) => !i.isSectorETF && i.sectorSymbol === selectedSector.symbol)
      .sort((a, b) => {
        const rvolA = getRvolForTimeframe(a.metricsByBaseline[baseline], timeframe);
        const rvolB = getRvolForTimeframe(b.metricsByBaseline[baseline], timeframe);
        return rvolB - rvolA;
      });
  }, [instruments, selectedSector, baseline, timeframe]);

  const tfLabel = getTimeframePlainLabel(timeframe);

  return (
    <div className="space-y-5">
      {/* Step 1: Compact 11 Market Sectors List */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              11 Market Sectors — Ranked by {tfLabel} Volume
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Click any sector row to view its chart on the right and inspect its top stocks below.
            </p>
          </div>
        </div>

        <div className="divide-y divide-slate-200/70 dark:divide-slate-800/70">
          {sectors.map((sec, idx) => {
            const m = sec.metricsByBaseline[baseline];
            const activeRvol = getRvolForTimeframe(m, timeframe);
            const activeChange = getPriceChangeForTimeframe(sec, timeframe);
            const isSelected = sec.symbol === selectedSector?.symbol;

            const isBullishBias =
              m.directionBias === 'UPSIDE_BREAKOUT' ||
              m.directionBias === 'UPSIDE_ACCUMULATION' ||
              m.directionBias === 'BULLISH_LOW_VOL_PULLBACK';
            const isBearishBias = m.directionBias === 'DOWNSIDE_DISTRIBUTION';

            return (
              <div
                key={sec.symbol}
                onClick={() => {
                  onSelectSector(sec.symbol);
                  onSelectInstrument(sec.symbol);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectSector(sec.symbol);
                    onSelectInstrument(sec.symbol);
                  }
                }}
                className={`px-4 py-3 flex flex-wrap items-center justify-between gap-3 cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-sky-500/10 dark:bg-sky-500/15'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                }`}
              >
                <div className="min-w-[180px]">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-slate-400 w-5">
                      #{idx + 1}
                    </span>
                    <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      {sec.sectorName}
                    </span>
                    <span className="font-mono text-xs text-slate-500">
                      ({sec.symbol})
                    </span>
                  </div>
                  <div className="mt-0.5 pl-7 text-xs">
                    <span
                      className={`font-mono font-semibold ${
                        isBullishBias
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : isBearishBias
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-amber-600 dark:text-amber-400'
                      }`}
                    >
                      {m.directionalSummary}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-5 font-mono text-xs tabular-nums">
                  <div className="text-right">
                    <div className="text-[10px] font-sans text-slate-400">
                      Steady Days
                    </div>
                    <div className="text-slate-700 dark:text-slate-300 font-medium">
                      {m.daysAboveBaseline20D}/20d &gt; Normal
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-[10px] font-sans text-slate-400">
                      Buyers
                    </div>
                    <div className="text-emerald-600 dark:text-emerald-400 font-medium">
                      {m.buyingVolumePct20D}% Buy
                    </div>
                  </div>

                  <div className="text-right min-w-[85px]">
                    <div
                      className={`text-sm font-bold ${
                        activeRvol >= 1.25
                          ? isBearishBias
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-emerald-600 dark:text-emerald-400'
                          : 'text-slate-900 dark:text-slate-100'
                      }`}
                    >
                      {activeRvol.toFixed(2)}x Vol
                    </div>
                    <div
                      className={
                        activeChange >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }
                    >
                      {activeChange >= 0 ? '+' : ''}
                      {activeChange.toFixed(2)}%
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Step 2: Stocks Inside the Selected Sector */}
      {selectedSector && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Top Stocks Inside {selectedSector.sectorName} ({selectedSector.symbol})
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Click any stock to view its chart on the right, or click <strong>Pick #1</strong> to lock it in for today.
              </p>
            </div>
          </div>

          <div className="divide-y divide-slate-200/70 dark:divide-slate-800/70">
            {constituentStocks.map((st) => {
              const m = st.metricsByBaseline[baseline];
              const activeRvol = getRvolForTimeframe(m, timeframe);
              const chg = getPriceChangeForTimeframe(st, timeframe);
              const isCurrent = st.symbol === selectedInstrumentSymbol;
              const isPicked = st.symbol === selectedTradeSymbol;
              const isBullish =
                m.directionBias === 'UPSIDE_BREAKOUT' ||
                m.directionBias === 'UPSIDE_ACCUMULATION' ||
                m.directionBias === 'BULLISH_LOW_VOL_PULLBACK';
              const isBearish = m.directionBias === 'DOWNSIDE_DISTRIBUTION';

              return (
                <div
                  key={st.symbol}
                  onClick={() => onSelectInstrument(st.symbol)}
                  className={`px-4 py-3 flex flex-wrap items-center justify-between gap-3 cursor-pointer transition-colors ${
                    isCurrent
                      ? 'bg-sky-500/10 dark:bg-sky-500/15'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold text-slate-900 dark:text-slate-100">
                        {st.symbol}
                      </span>
                      <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                        {st.name}
                      </span>
                      <span className="font-mono text-xs text-slate-500">
                        ${st.price.toFixed(2)}
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

                    <div className="text-right min-w-[75px]">
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
                        {chg >= 0 ? '+' : ''}
                        {chg.toFixed(2)}%
                      </div>
                    </div>

                    {onPickAsDailyTrade && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onPickAsDailyTrade(st.symbol);
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
        </div>
      )}
    </div>
  );
};
