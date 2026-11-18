import React, { useMemo, useState } from 'react';
import { CheckCircle2, Plus, Target, Trash2, X } from 'lucide-react';
import { getRvolForTimeframe, GICS_SECTORS } from '../lib/volumeAnalytics';
import {
  BaselinePeriod,
  MarketInstrument,
  PriceVolumeRegime,
  TimeframeWindow,
  TriggeredAlert,
  VolumeAlertRule,
} from '../types/market';
import { DataStatusChip } from './DataStatusChip';

interface SurgeAlertsViewProps {
  alerts: VolumeAlertRule[];
  instruments: MarketInstrument[];
  onUpdateAlerts: (nextAlerts: VolumeAlertRule[]) => void;
  onSelectInstrument: (symbol: string) => void;
  selectedTradeSymbol?: string;
  onPickAsDailyTrade?: (symbol: string) => void;
}

export const SurgeAlertsView: React.FC<SurgeAlertsViewProps> = ({
  alerts,
  instruments,
  onUpdateAlerts,
  onSelectInstrument,
  selectedTradeSymbol,
  onPickAsDailyTrade,
}) => {
  const [showBuilder, setShowBuilder] = useState(false);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<string>('ALL');
  const [timeframe, setTimeframe] = useState<TimeframeWindow>('5D');
  const [baseline] = useState<BaselinePeriod>('90D');
  const [minRvol, setMinRvol] = useState<number>(1.35);
  const [minConsistency] = useState<number>(65);
  const [minConsecutiveDays, setMinConsecutiveDays] = useState<number>(3);
  const [regimeFilter, setRegimeFilter] = useState<'ANY' | PriceVolumeRegime>('ANY');

  const triggeredAlerts = useMemo(() => {
    const results: TriggeredAlert[] = [];
    for (const rule of alerts) {
      if (!rule.enabled) continue;
      for (const inst of instruments) {
        if (inst.dataStatus === 'unavailable' || !inst.metricsByBaseline || inst.price === null) {
          continue;
        }
        if (rule.scope === 'SECTORS' && !inst.isSectorETF) continue;
        if (rule.scope === 'STOCKS' && inst.isSectorETF) continue;
        if (
          rule.scope !== 'ALL' &&
          rule.scope !== 'SECTORS' &&
          rule.scope !== 'STOCKS' &&
          inst.sectorSymbol !== rule.scope
        ) {
          continue;
        }

        const m = inst.metricsByBaseline[rule.baseline];
        const rvolVal = getRvolForTimeframe(m, rule.timeframe);

        if (rvolVal < rule.minRvol) continue;
        if (m.consistencyScore < rule.minConsistency) continue;
        if (m.consecutiveAboveDays < rule.minConsecutiveDays) continue;
        if (rule.regimeFilter !== 'ANY' && m.regime !== rule.regimeFilter) continue;

        results.push({
          ruleId: rule.id,
          ruleName: rule.name,
          instrument: inst,
          rvolValue: rvolVal,
          consistencyScore: m.consistencyScore,
          consecutiveDays: m.consecutiveAboveDays,
          regime: m.regime,
          directionBias: m.directionBias,
          directionalSummary: m.directionalSummary,
        });
      }
    }
    return results.sort((a, b) => b.rvolValue - a.rvolValue);
  }, [alerts, instruments]);

  const handleAddRule = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName =
      name.trim() || `${timeframe} Volume >= ${minRvol}x Normal`;
    const newRule: VolumeAlertRule = {
      id: `alert-${Date.now()}`,
      name: cleanName,
      scope,
      timeframe,
      baseline,
      minRvol,
      minConsistency,
      minConsecutiveDays,
      regimeFilter,
      enabled: true,
      createdAt: new Date().toISOString().slice(0, 10),
    };
    onUpdateAlerts([newRule, ...alerts]);
    setName('');
    setShowBuilder(false);
  };

  const toggleRule = (id: string) => {
    const next = alerts.map((r) =>
      r.id === id ? { ...r, enabled: !r.enabled } : r
    );
    onUpdateAlerts(next);
  };

  const deleteRule = (id: string) => {
    const next = alerts.filter((r) => r.id !== id);
    onUpdateAlerts(next);
  };

  return (
    <div className="space-y-4">
      {/* Triggered Stocks Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <div className="px-4 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Stocks Setting Off Volume Alerts ({triggeredAlerts.length})
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Click any alerted stock to inspect its chart on the right.
            </p>
          </div>
          <button
            onClick={() => setShowBuilder((v) => !v)}
            className="px-2.5 py-1.5 text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white rounded-md transition-colors inline-flex items-center gap-1 shrink-0"
          >
            {showBuilder ? (
              <>
                <X className="w-3.5 h-3.5" />
                <span>Close Form</span>
              </>
            ) : (
              <>
                <Plus className="w-3.5 h-3.5" />
                <span>New Alert Rule</span>
              </>
            )}
          </button>
        </div>

        {/* Collapsible Rule Builder */}
        {showBuilder && (
          <form
            onSubmit={handleAddRule}
            className="p-4 bg-slate-50 dark:bg-slate-950/80 border-b border-slate-200 dark:border-slate-800 space-y-3"
          >
            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              Create Volume Alert Rule
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Rule Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Strong Tech Breakout"
                  className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  What to Watch
                </label>
                <select
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded text-slate-900 dark:text-slate-100"
                >
                  <option value="ALL">All Stocks &amp; Sectors</option>
                  <option value="STOCKS">Stocks Only</option>
                  <option value="SECTORS">11 Sectors Only</option>
                  {GICS_SECTORS.map((s) => (
                    <option key={s.symbol} value={s.symbol}>
                      {s.sectorName} ({s.symbol})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Timeframe
                </label>
                <select
                  value={timeframe}
                  onChange={(e) => setTimeframe(e.target.value as TimeframeWindow)}
                  className="w-full px-2 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded text-slate-900 dark:text-slate-100"
                >
                  <option value="1D">Today (1D)</option>
                  <option value="5D">This Week (5D)</option>
                  <option value="20D">This Month (20D)</option>
                  <option value="60D">3 Months (60D)</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Min Volume vs Normal
                </label>
                <input
                  type="number"
                  step="0.05"
                  min="0.5"
                  max="5.0"
                  value={minRvol}
                  onChange={(e) => setMinRvol(parseFloat(e.target.value) || 1.0)}
                  className="w-full px-2 py-1.5 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Days in a Row &gt; Normal
                </label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  max="15"
                  value={minConsecutiveDays}
                  onChange={(e) =>
                    setMinConsecutiveDays(parseInt(e.target.value, 10) || 0)
                  }
                  className="w-full px-2 py-1.5 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            <div className="flex items-end gap-2.5">
              <div className="flex-1">
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Direction Signal
                </label>
                <select
                  value={regimeFilter}
                  onChange={(e) => setRegimeFilter(e.target.value as any)}
                  className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded text-slate-900 dark:text-slate-100"
                >
                  <option value="ANY">Any Signal</option>
                  <option value="Breakout Expansion">▲ Strong Buying — Breaking Up</option>
                  <option value="Stealth Accumulation">▲ Quiet Buying — Ready to Pop</option>
                  <option value="Institutional Accumulation">▲ Steady Buying — Uptrend</option>
                  <option value="Distribution Pressure">▼ Heavy Selling — Dropping</option>
                </select>
              </div>
              <button
                type="submit"
                className="px-4 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded transition-colors shrink-0"
              >
                Save Rule
              </button>
            </div>
          </form>
        )}

        {triggeredAlerts.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
            No stocks match your active alert rules right now.
          </div>
        ) : (
          <div className="divide-y divide-slate-200/70 dark:divide-slate-800/70 max-h-[420px] overflow-y-auto">
            {triggeredAlerts.map((trig, idx) => {
              const isBullish =
                trig.directionBias === 'UPSIDE_BREAKOUT' ||
                trig.directionBias === 'UPSIDE_ACCUMULATION' ||
                trig.directionBias === 'BULLISH_LOW_VOL_PULLBACK';
              const isBearish = trig.directionBias === 'DOWNSIDE_DISTRIBUTION';
              const isPicked = trig.instrument.symbol === selectedTradeSymbol;

              return (
                <div
                  key={`${trig.ruleId}-${trig.instrument.symbol}-${idx}`}
                  onClick={() => onSelectInstrument(trig.instrument.symbol)}
                  className="px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-bold text-xs text-slate-900 dark:text-slate-100">
                        {trig.instrument.symbol}
                      </span>
                      <span className="text-xs text-slate-700 dark:text-slate-300 truncate">
                        {trig.instrument.name}
                      </span>
                      <DataStatusChip instrument={trig.instrument} />
                      <span className="text-[11px] text-sky-600 dark:text-sky-400 font-medium truncate">
                        · {trig.ruleName}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px]">
                      <span
                        className={`font-mono font-semibold ${
                          isBullish
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : isBearish
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {trig.directionalSummary}
                      </span>
                      <span className="text-slate-400">·</span>
                      <span className="font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                        {trig.consecutiveDays}d in a row
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0">
                    <div className="text-right font-mono tabular-nums">
                      <div
                        className={`text-xs font-bold ${
                          isBearish
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        {trig.rvolValue.toFixed(2)}x
                      </div>
                      {trig.instrument.price !== null && (
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          ${trig.instrument.price.toFixed(2)}
                        </div>
                      )}
                    </div>

                    {onPickAsDailyTrade && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onPickAsDailyTrade(trig.instrument.symbol);
                        }}
                        className={`px-2 py-1 text-[11px] font-medium rounded transition-colors inline-flex items-center gap-1 whitespace-nowrap ${
                          isPicked
                            ? 'bg-emerald-600 text-white'
                            : 'bg-slate-100 dark:bg-slate-800 hover:bg-sky-600 hover:text-white text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {isPicked ? (
                          <>
                            <CheckCircle2 className="w-3 h-3" />
                            <span>#1</span>
                          </>
                        ) : (
                          <>
                            <Target className="w-3 h-3" />
                            <span>Pick</span>
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

      {/* Compact Active Alert Rules List */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-900 dark:text-slate-100">
          Your Active Alert Rules ({alerts.length})
        </div>
        <div className="divide-y divide-slate-200/70 dark:divide-slate-800/70">
          {alerts.map((rule) => (
            <div
              key={rule.id}
              className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs"
            >
              <div>
                <div className="font-medium text-slate-900 dark:text-slate-100">
                  {rule.name}
                </div>
                <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                  {rule.timeframe} Vol &ge; {rule.minRvol.toFixed(2)}x Normal · {rule.minConsecutiveDays}+ days in a row
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => toggleRule(rule.id)}
                  className={`px-2 py-0.5 text-[11px] font-medium rounded border transition-colors ${
                    rule.enabled
                      ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
                      : 'border-slate-300 dark:border-slate-700 text-slate-400'
                  }`}
                >
                  {rule.enabled ? 'On' : 'Off'}
                </button>
                <button
                  onClick={() => deleteRule(rule.id)}
                  aria-label="Delete rule"
                  className="p-1 text-slate-400 hover:text-rose-500 rounded"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
