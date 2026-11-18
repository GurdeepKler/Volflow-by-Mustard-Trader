import React, { useState } from 'react';
import { BookOpen, Calendar, Plus, Trash2 } from 'lucide-react';
import {
  BaselinePeriod,
  CheckpointSnapshot,
  MarketInstrument,
  TimeframeWindow,
} from '../types/market';

interface CheckpointJournalViewProps {
  journal: CheckpointSnapshot[];
  instruments: MarketInstrument[];
  baseline: BaselinePeriod;
  timeframe: TimeframeWindow;
  onOpenLogModal: () => void;
  onDeleteSnapshot: (id: string) => void;
  onSelectInstrument: (symbol: string) => void;
}

export const CheckpointJournalView: React.FC<CheckpointJournalViewProps> = ({
  journal,
  instruments,
  baseline,
  onOpenLogModal,
  onDeleteSnapshot,
  onSelectInstrument,
}) => {
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string>(
    journal[0]?.id || ''
  );

  const activeSnapshot =
    journal.find((j) => j.id === selectedSnapshotId) || journal[0];

  const instMap = new Map<string, MarketInstrument>(
    instruments.map((i) => [i.symbol, i])
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Daily &amp; Weekly Trade Notes (Did the Volume Hold Up?)
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Save a quick snapshot of today's top sectors and your #1 trade idea. Come back tomorrow or next week to see if the buying volume kept going.
          </p>
        </div>

        <button
          onClick={onOpenLogModal}
          className="px-4 py-2 text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Save Today's Note</span>
        </button>
      </div>

      {journal.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-12 text-center space-y-3">
          <BookOpen className="w-8 h-8 text-slate-400 mx-auto" />
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            No Daily Notes Saved Yet
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            Save your first daily note to track your #1 trade pick and check how its volume performs over the coming days.
          </p>
          <button
            onClick={onOpenLogModal}
            className="px-4 py-2 text-xs font-medium bg-sky-600 text-white rounded-md hover:bg-sky-500 transition-colors"
          >
            Save First Note
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left 4 cols: Saved Notes List */}
          <div className="lg:col-span-4 space-y-2.5">
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 px-1">
              Past Saved Notes ({journal.length})
            </div>
            {journal.map((entry) => {
              const isSelected = entry.id === activeSnapshot?.id;
              return (
                <div
                  key={entry.id}
                  onClick={() => setSelectedSnapshotId(entry.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedSnapshotId(entry.id);
                    }
                  }}
                  className={`p-4 rounded-lg border transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-white dark:bg-slate-900 border-sky-500 dark:border-sky-400 ring-1 ring-sky-500/20'
                      : 'bg-white/70 dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono">
                    <span className="inline-flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-sky-500" />
                      <span>{entry.dateLabel}</span>
                      <span>·</span>
                      <span className="text-slate-700 dark:text-slate-300 font-sans font-medium">
                        {entry.cadence} Check
                      </span>
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteSnapshot(entry.id);
                      }}
                      aria-label="Delete note"
                      className="text-slate-400 hover:text-rose-500 p-1 rounded"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <h3 className="mt-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {entry.title}
                  </h3>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 line-clamp-2">
                    {entry.notes}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Right 8 cols: Then vs. Now Comparison */}
          {activeSnapshot && (
            <div className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
              <div className="p-5 border-b border-slate-200 dark:border-slate-800">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <div className="flex items-center gap-2 font-mono">
                    <span>Saved on {activeSnapshot.dateLabel}</span>
                    <span>·</span>
                    <span>{activeSnapshot.cadence} Check</span>
                  </div>
                  <div className="text-slate-500 dark:text-slate-400">
                    {activeSnapshot.tags.join(' · ')}
                  </div>
                </div>

                <h3 className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {activeSnapshot.title}
                </h3>
                <p className="mt-2 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                  {activeSnapshot.notes}
                </p>
              </div>

              {/* Sector Then vs Now */}
              <div className="p-5 border-b border-slate-200 dark:border-slate-800">
                <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-3">
                  01. Top Sectors — Then vs. Right Now
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
                        <th className="py-2 pr-3">Sector</th>
                        <th className="py-2 px-3 text-right">Volume Then</th>
                        <th className="py-2 px-3 text-right">Volume Now</th>
                        <th className="py-2 pl-3">What Volume Expects Now</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/60 dark:divide-slate-800/60">
                      {activeSnapshot.topSectors.map((sec) => {
                        const liveInst = instMap.get(sec.symbol);
                        const liveM = liveInst?.metricsByBaseline[baseline];
                        const liveRvol5D = liveM ? liveM.rvol5D : sec.rvol5D;
                        const rvolDelta = liveRvol5D - sec.rvol5D;

                        return (
                          <tr
                            key={sec.symbol}
                            onClick={() => onSelectInstrument(sec.symbol)}
                            className="h-9 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer"
                          >
                            <td className="py-2 pr-3 font-semibold text-slate-900 dark:text-slate-100">
                              {sec.name} ({sec.symbol})
                            </td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                              {sec.rvol5D.toFixed(2)}x Normal
                            </td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums font-semibold">
                              <span
                                className={
                                  liveRvol5D >= 1.35
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : 'text-slate-900 dark:text-slate-100'
                                }
                              >
                                {liveRvol5D.toFixed(2)}x Normal
                              </span>
                              <span
                                className={`ml-1.5 text-[11px] ${
                                  rvolDelta >= 0
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : 'text-rose-600 dark:text-rose-400'
                                }`}
                              >
                                ({rvolDelta >= 0 ? '+' : ''}
                                {rvolDelta.toFixed(2)}x)
                              </span>
                            </td>
                            <td className="py-2 pl-3 font-mono text-slate-700 dark:text-slate-300">
                              {liveM ? liveM.directionalSummary : sec.regime}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Stocks Then vs Now */}
              <div className="p-5">
                <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-3">
                  02. Top Stocks — Price &amp; Volume Follow-Through
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
                        <th className="py-2 pr-3">Stock</th>
                        <th className="py-2 px-3 text-right">Price Then</th>
                        <th className="py-2 px-3 text-right">Price Now</th>
                        <th className="py-2 px-3 text-right">Volume Now</th>
                        <th className="py-2 pl-3">Current Signal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/60 dark:divide-slate-800/60">
                      {activeSnapshot.topStocks.map((st) => {
                        const liveInst = instMap.get(st.symbol);
                        const liveM = liveInst?.metricsByBaseline[baseline];
                        const livePrice = liveInst ? liveInst.price : st.price;
                        const pctDiff =
                          ((livePrice - st.price) / Math.max(0.01, st.price)) * 100;

                        return (
                          <tr
                            key={st.symbol}
                            onClick={() => onSelectInstrument(st.symbol)}
                            className="h-9 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer"
                          >
                            <td className="py-2 pr-3 font-mono font-semibold text-slate-900 dark:text-slate-100">
                              {st.symbol} ·{' '}
                              <span className="font-sans font-normal text-slate-500 dark:text-slate-400">
                                {st.name}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                              ${st.price.toFixed(2)}
                            </td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums font-medium">
                              <span className="text-slate-900 dark:text-slate-100">
                                ${livePrice.toFixed(2)}
                              </span>
                              <span
                                className={`ml-1.5 text-[11px] ${
                                  pctDiff >= 0
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : 'text-rose-600 dark:text-rose-400'
                                }`}
                              >
                                ({pctDiff >= 0 ? '+' : ''}
                                {pctDiff.toFixed(1)}%)
                              </span>
                            </td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                              {(liveM ? liveM.rvol5D : st.rvol5D).toFixed(2)}x Normal
                            </td>
                            <td className="py-2 pl-3 font-mono text-slate-700 dark:text-slate-300">
                              {liveM ? liveM.directionalSummary : st.regime}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
