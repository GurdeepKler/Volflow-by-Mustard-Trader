/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Bell,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  Clock,
  Layers,
  ListFilter,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Sun,
  Target,
  X,
} from 'lucide-react';
import { CheckpointJournalView } from './components/CheckpointJournalView';
import { DataStatusChip } from './components/DataStatusChip';
import { PreMarketShortlistView } from './components/PreMarketShortlistView';
import { SectorFlowView } from './components/SectorFlowView';
import { SurgeAlertsView } from './components/SurgeAlertsView';
import { VolumeInspectorPanel } from './components/VolumeInspectorPanel';
import { VolumeScannerView } from './components/VolumeScannerView';
import {
  findTopDailyTradeIdea,
  getRvolForTimeframe,
  GICS_SECTORS,
} from './lib/volumeAnalytics';
import {
  BaselinePeriod,
  CheckpointSnapshot,
  MarketInstrument,
  TimeframeWindow,
  VolumeAlertRule,
} from './types/market';

type WorkspaceTab = 'sectors' | 'scanner' | 'alerts' | 'journal' | 'shortlist';

function formatReadableDate(isoDateStr: string): string {
  if (!isoDateStr) return 'Unavailable';
  const parts = isoDateStr.split('-').map(Number);
  if (parts.length !== 3) return isoDateStr;
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatExactTime(isoTimestamp: string): string {
  try {
    const d = new Date(isoTimestamp);
    return d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return isoTimestamp;
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('sectors');
  const [timeframe, setTimeframe] = useState<TimeframeWindow>('5D');
  const [baseline, setBaseline] = useState<BaselinePeriod>('90D');
  const [darkMode, setDarkMode] = useState<boolean>(true);

  const [instruments, setInstruments] = useState<MarketInstrument[]>([]);
  const [journal, setJournal] = useState<CheckpointSnapshot[]>([]);
  const [alerts, setAlerts] = useState<VolumeAlertRule[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [universeFetchError, setUniverseFetchError] = useState<string | null>(null);

  const [marketSessionDate, setMarketSessionDate] = useState<string>('');
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string>(
    new Date().toISOString()
  );
  const [secondsSinceRefresh, setSecondsSinceRefresh] = useState<number>(0);
  const [refreshStage, setRefreshStage] = useState<
    'idle' | 'running' | 'completed'
  >('idle');
  const [refreshProgress, setRefreshProgress] = useState<number>(0);
  const [refreshStatusText, setRefreshStatusText] = useState<string>('');

  const [selectedSectorSymbol, setSelectedSectorSymbol] = useState<string>('XLK');
  const [selectedInstrumentSymbol, setSelectedInstrumentSymbol] =
    useState<string>('NVDA');

  const [userPickedTradeSymbol, setUserPickedTradeSymbol] = useState<string>('');

  // Modals
  const [showAddTickerModal, setShowAddTickerModal] = useState<boolean>(false);
  const [newTickerSymbol, setNewTickerSymbol] = useState<string>('');
  const [newTickerName, setNewTickerName] = useState<string>('');
  const [newTickerSector, setNewTickerSector] = useState<string>('XLK');
  const [addingTicker, setAddingTicker] = useState<boolean>(false);
  const [tickerError, setTickerError] = useState<string>('');

  const [showCheckpointModal, setShowCheckpointModal] = useState<boolean>(false);
  const [checkpointCadence, setCheckpointCadence] = useState<
    'Daily' | 'Weekly' | 'Monthly'
  >('Daily');
  const [checkpointTitle, setCheckpointTitle] = useState<string>('');
  const [checkpointNotes, setCheckpointNotes] = useState<string>('');
  const [checkpointTags, setCheckpointTags] = useState<string>(
    'Top Volume Pick, Sector Leader'
  );

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [darkMode]);

  useEffect(() => {
    const timer = setInterval(() => {
      const diffSec = Math.max(
        0,
        Math.floor((Date.now() - new Date(lastRefreshedAt).getTime()) / 1000)
      );
      setSecondsSinceRefresh(diffSec);
    }, 1000);
    return () => clearInterval(timer);
  }, [lastRefreshedAt]);

  const fetchUniverse = async () => {
    setIsLoading(true);
    setUniverseFetchError(null);
    try {
      const res = await fetch('/api/market/universe');
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: Failed to load market universe`);
      }
      const data = await res.json();
      if (!Array.isArray(data.instruments) || data.instruments.length === 0) {
        throw new Error('No market instruments returned from server');
      }
      setInstruments(data.instruments);
      const firstValid = data.instruments.find(
        (i: MarketInstrument) => i.asOfSession !== null
      );
      setMarketSessionDate(
        firstValid?.asOfSession || data.marketSessionDate || ''
      );
      if (Array.isArray(data.journal)) {
        setJournal(data.journal);
      }
      if (Array.isArray(data.alerts)) {
        setAlerts(data.alerts);
      }
      setLastRefreshedAt(data.lastRefreshedAt || new Date().toISOString());
      setSecondsSinceRefresh(0);
    } catch (err) {
      setInstruments([]);
      setUniverseFetchError(
        err instanceof Error
          ? err.message
          : 'Failed to load market data from server.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchUniverse();
  }, []);

  const handleRunRefresh = async () => {
    if (refreshStage === 'running') return;
    setRefreshStage('running');
    setRefreshProgress(25);
    setRefreshStatusText('Checking latest daily volume across 11 Market Sectors...');

    await new Promise((r) => setTimeout(r, 250));
    setRefreshProgress(65);
    setRefreshStatusText('Comparing Today, Week & Month volume against Normal...');

    try {
      const res = await fetch('/api/market/refresh', { method: 'POST' });
      await new Promise((r) => setTimeout(r, 250));
      setRefreshProgress(90);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: Refresh failed`);
      }

      const data = await res.json();
      if (Array.isArray(data.instruments) && data.instruments.length > 0) {
        setInstruments(data.instruments);
        setUniverseFetchError(null);
        const firstValid = data.instruments.find(
          (i: MarketInstrument) => i.asOfSession !== null
        );
        setMarketSessionDate(
          firstValid?.asOfSession || data.marketSessionDate || ''
        );
      }
      const nowIso = data.lastRefreshedAt || new Date().toISOString();
      setLastRefreshedAt(nowIso);
      setSecondsSinceRefresh(0);
      setRefreshProgress(100);
      setRefreshStage('completed');
      setRefreshStatusText(`Refresh Finished at ${formatExactTime(nowIso)}`);
    } catch (err) {
      setRefreshStage('idle');
      setUniverseFetchError(
        err instanceof Error ? err.message : 'Market data refresh failed.'
      );
    }
  };

  const unavailableCount = useMemo(() => {
    return instruments.filter((i) => i.dataStatus === 'unavailable').length;
  }, [instruments]);

  const autoTradeIdea = useMemo(() => {
    return findTopDailyTradeIdea(instruments, baseline, timeframe);
  }, [instruments, baseline, timeframe]);

  const activeDailyTradeSymbol =
    userPickedTradeSymbol || autoTradeIdea?.stock.symbol || 'NVDA';

  const activeDailyTradeInstrument = useMemo(() => {
    const candidate =
      instruments.find((i) => i.symbol === activeDailyTradeSymbol) ||
      autoTradeIdea?.stock ||
      instruments.find(
        (i) => i.dataStatus !== 'unavailable' && i.price !== null && i.metricsByBaseline !== null
      );
    if (
      !candidate ||
      candidate.dataStatus === 'unavailable' ||
      candidate.price === null ||
      candidate.metricsByBaseline === null
    ) {
      return null;
    }
    return candidate;
  }, [instruments, activeDailyTradeSymbol, autoTradeIdea]);

  const inspectedInstrument = useMemo(() => {
    return (
      instruments.find((i) => i.symbol === selectedInstrumentSymbol) ||
      instruments[0]
    );
  }, [instruments, selectedInstrumentSymbol]);

  const activeAlertCount = useMemo(() => {
    let count = 0;
    for (const rule of alerts) {
      if (!rule.enabled) continue;
      for (const inst of instruments) {
        if (inst.dataStatus === 'unavailable' || !inst.metricsByBaseline) {
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
        const rvol = getRvolForTimeframe(m, rule.timeframe);
        if (
          rvol >= rule.minRvol &&
          m.consistencyScore >= rule.minConsistency &&
          m.consecutiveAboveDays >= rule.minConsecutiveDays &&
          (rule.regimeFilter === 'ANY' || m.regime === rule.regimeFilter)
        ) {
          count++;
        }
      }
    }
    return count;
  }, [instruments, alerts]);

  const handlePickDailyTrade = (symbol: string) => {
    setUserPickedTradeSymbol(symbol);
    setSelectedInstrumentSymbol(symbol);
  };

  const handleAddCustomTicker = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanSymbol = newTickerSymbol
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9.-]/g, '');
    if (!cleanSymbol) {
      setTickerError('Please enter a valid stock or ETF ticker symbol.');
      return;
    }

    setAddingTicker(true);
    setTickerError('');

    try {
      const res = await fetch('/api/market/ticker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: cleanSymbol,
          name: newTickerName.trim(),
          sectorSymbol: newTickerSector,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTickerError(
          data?.error || 'Failed to load market data from Yahoo Finance'
        );
        return;
      }

      if (data.instrument) {
        setInstruments((prev) => {
          const without = prev.filter((i) => i.symbol !== data.instrument.symbol);
          return [data.instrument, ...without];
        });
        setSelectedSectorSymbol(data.instrument.sectorSymbol);
        setSelectedInstrumentSymbol(data.instrument.symbol);
        setLastRefreshedAt(data.lastRefreshedAt || new Date().toISOString());
        setSecondsSinceRefresh(0);
        setShowAddTickerModal(false);
        setNewTickerSymbol('');
        setNewTickerName('');
      }
    } catch {
      setTickerError('Failed to load market data from Yahoo Finance');
    } finally {
      setAddingTicker(false);
    }
  };

  const openCheckpointModal = () => {
    const tradeInst = activeDailyTradeInstrument;
    const m = tradeInst?.metricsByBaseline?.[baseline];
    const defaultTitle =
      tradeInst && tradeInst.price !== null
        ? `Today's #1 Trade Idea: ${tradeInst.symbol} (${tradeInst.name}) at $${tradeInst.price.toFixed(2)}`
        : `${checkpointCadence} Volume Trade Note`;
    setCheckpointTitle(defaultTitle);
    setCheckpointNotes(
      tradeInst && m
        ? `Picked ${tradeInst.symbol} in ${tradeInst.sectorName} sector. Signal: ${m.directionalSummary}. Volume is ${getRvolForTimeframe(
            m,
            timeframe
          ).toFixed(2)}x normal (${m.daysAboveBaseline20D} of last 20 days beat normal volume, ${m.buyingVolumePct20D}% buying volume).`
        : `Checking ${timeframe} volume against ${baseline} normal average.`
    );
    setShowCheckpointModal(true);
  };

  const handleSaveCheckpoint = async (e: React.FormEvent) => {
    e.preventDefault();

    const validInstruments = instruments.filter(
      (i) =>
        i.dataStatus !== 'unavailable' &&
        i.metricsByBaseline !== null &&
        i.price !== null
    );

    const topSectors = validInstruments
      .filter((i) => i.isSectorETF)
      .sort(
        (a, b) =>
          b.metricsByBaseline![baseline].rvol5D -
          a.metricsByBaseline![baseline].rvol5D
      )
      .slice(0, 4)
      .map((s) => ({
        symbol: s.symbol,
        name: s.sectorName,
        rvol5D: s.metricsByBaseline![baseline].rvol5D,
        rvol20D: s.metricsByBaseline![baseline].rvol20D,
        consistencyScore: s.metricsByBaseline![baseline].consistencyScore,
        regime: s.metricsByBaseline![baseline].regime,
        change5DPct: s.change5DPct ?? 0,
      }));

    const topStocks = validInstruments
      .filter((i) => !i.isSectorETF)
      .sort(
        (a, b) =>
          b.metricsByBaseline![baseline].consistencyScore -
          a.metricsByBaseline![baseline].consistencyScore
      )
      .slice(0, 6)
      .map((st) => ({
        symbol: st.symbol,
        name: st.name,
        sectorSymbol: st.sectorSymbol,
        price: st.price!,
        rvol1D: st.metricsByBaseline![baseline].rvol1D,
        rvol5D: st.metricsByBaseline![baseline].rvol5D,
        rvol20D: st.metricsByBaseline![baseline].rvol20D,
        consistencyScore: st.metricsByBaseline![baseline].consistencyScore,
        daysAboveBaseline20D:
          st.metricsByBaseline![baseline].daysAboveBaseline20D,
        regime: st.metricsByBaseline![baseline].regime,
      }));

    const newSnapshot: CheckpointSnapshot = {
      id: `chk-${Date.now()}`,
      timestamp: new Date().toISOString(),
      dateLabel: marketSessionDate || new Date().toISOString().slice(0, 10),
      cadence: checkpointCadence,
      title: checkpointTitle.trim() || `Today's Trade Note`,
      notes: checkpointNotes.trim(),
      tags: checkpointTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      baselineUsed: baseline,
      timeframeUsed: timeframe,
      topSectors,
      topStocks,
    };

    try {
      const res = await fetch('/api/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSnapshot),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.journal)) {
          setJournal(data.journal);
        } else {
          setJournal((prev) => [newSnapshot, ...prev]);
        }
      } else {
        setJournal((prev) => [newSnapshot, ...prev]);
      }
    } catch {
      setJournal((prev) => [newSnapshot, ...prev]);
    }

    setShowCheckpointModal(false);
    setActiveTab('journal');
  };

  const handleDeleteSnapshot = async (id: string) => {
    setJournal((prev) => prev.filter((j) => j.id !== id));
    try {
      await fetch(`/api/journal/${id}`, { method: 'DELETE' });
    } catch {
      // client state already updated
    }
  };

  const handleUpdateAlerts = async (nextAlerts: VolumeAlertRule[]) => {
    setAlerts(nextAlerts);
    try {
      await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alerts: nextAlerts }),
      });
    } catch {
      // client state already updated
    }
  };

  const relativeRefreshLabel = useMemo(() => {
    if (secondsSinceRefresh < 5) return 'Just now';
    if (secondsSinceRefresh < 60) return `${secondsSinceRefresh}s ago`;
    const mins = Math.floor(secondsSinceRefresh / 60);
    return `${mins}m ago`;
  }, [secondsSinceRefresh]);

  const activeSectionMeta = useMemo(() => {
    switch (activeTab) {
      case 'sectors':
        return {
          title: '1. Market Sectors & Top Stocks',
          subtitle:
            'Find which sectors have unusual volume right now, then pick the strongest stock inside that sector.',
        };
      case 'scanner':
        return {
          title: '2. All Stocks Finder',
          subtitle:
            'Filter all stocks by buying volume, steady volume streaks, or sector.',
        };
      case 'alerts':
        return {
          title: '3. Volume Alerts',
          subtitle:
            'Stocks setting off multi-day volume triggers today.',
        };
      case 'journal':
        return {
          title: '4. Daily Trade Notes',
          subtitle:
            'Your saved trade ideas and past check-ins to verify if volume held up.',
        };
      case 'shortlist':
        return {
          title: '5. Pre-Market Shortlist',
          subtitle:
            'Daily Silent Flip pre-market shortlist (5–8 US stocks), key levels (FH, RH, RL, FL), T1–T5 bench evaluation, and TradingView export.',
        };
    }
  }, [activeTab]);

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* TRADITIONAL SAAS LEFT SIDEBAR (260px) */}
      <aside className="w-64 shrink-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col justify-between">
        <div className="p-4 space-y-6">
          {/* Brand Header */}
          <div className="flex items-center justify-between px-2">
            <div>
              <div className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
                VolFlow
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Daily Volume Decision Tool
              </div>
            </div>
            <button
              onClick={() => setDarkMode(!darkMode)}
              aria-label="Toggle color theme"
              className="p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors"
            >
              {darkMode ? (
                <Sun className="w-4 h-4 text-amber-400" />
              ) : (
                <Moon className="w-4 h-4 text-slate-700" />
              )}
            </button>
          </div>

          {/* 4 Main SaaS Navigation Sections */}
          <div className="space-y-1">
            <div className="px-2 pb-1 text-[11px] font-semibold text-slate-400 dark:text-slate-500">
              Main Sections
            </div>
            {(
              [
                {
                  id: 'sectors',
                  label: '1. Market Sectors',
                  badge: '11',
                  icon: Layers,
                },
                {
                  id: 'scanner',
                  label: '2. All Fine Stocks',
                  badge: `${Math.max(0, instruments.length - 11)}`,
                  icon: Search,
                },
                {
                  id: 'alerts',
                  label: '3. Volume Alerts',
                  badge: `${activeAlertCount}`,
                  icon: Bell,
                },
                {
                  id: 'journal',
                  label: '4. Daily Notes',
                  badge: `${journal.length}`,
                  icon: BookOpen,
                },
                {
                  id: 'shortlist',
                  label: '5. Pre-Market Shortlist',
                  badge: '5–8',
                  icon: ListFilter,
                },
              ] as const
            ).map((nav) => {
              const Icon = nav.icon;
              const isAct = activeTab === nav.id;
              return (
                <button
                  key={nav.id}
                  onClick={() => setActiveTab(nav.id)}
                  className={`w-full px-3 py-2.5 rounded-lg text-left text-xs font-medium transition-colors flex items-center justify-between ${
                    isAct
                      ? 'bg-sky-600 text-white shadow-xs'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70'
                  }`}
                >
                  <span className="flex items-center gap-2.5 truncate">
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{nav.label}</span>
                  </span>
                  <span
                    className={`font-mono text-[11px] ${
                      isAct
                        ? 'text-sky-100'
                        : 'text-slate-400 dark:text-slate-500'
                    }`}
                  >
                    {nav.badge}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Simple Volume Timeframe Controls inside Sidebar */}
          <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-800">
            <div>
              <div className="px-2 pb-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                Check Volume Over:
              </div>
              <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 dark:bg-slate-950 rounded-lg">
                {(
                  [
                    { id: '1D', label: 'Today (1D)' },
                    { id: '5D', label: 'Week (5D)' },
                    { id: '20D', label: 'Month (20D)' },
                    { id: '60D', label: '3 Mos (60D)' },
                  ] as { id: TimeframeWindow; label: string }[]
                ).map((tf) => (
                  <button
                    key={tf.id}
                    onClick={() => setTimeframe(tf.id)}
                    className={`py-1.5 text-xs font-medium rounded transition-colors ${
                      timeframe === tf.id
                        ? 'bg-white dark:bg-slate-800 text-sky-600 dark:text-sky-400 shadow-xs font-semibold'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {tf.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="px-2 pb-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                Compare To Normal:
              </div>
              <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 dark:bg-slate-950 rounded-lg">
                {(
                  [
                    { id: '90D', label: '3-Mo Avg' },
                    { id: '252D', label: '1-Yr Avg' },
                  ] as { id: BaselinePeriod; label: string }[]
                ).map((b) => (
                  <button
                    key={b.id}
                    onClick={() => setBaseline(b.id)}
                    className={`py-1.5 text-xs font-medium rounded transition-colors ${
                      baseline === b.id
                        ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs font-semibold'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom of Sidebar: Today's #1 Trade Pick Box */}
        {activeDailyTradeInstrument &&
          activeDailyTradeInstrument.price !== null &&
          activeDailyTradeInstrument.metricsByBaseline !== null && (
            <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-sky-500/5 dark:bg-sky-500/10 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-sky-700 dark:text-sky-300 flex items-center gap-1.5">
                  <Target className="w-3.5 h-3.5" />
                  <span>Today's #1 Trade Pick</span>
                </span>
                {userPickedTradeSymbol && (
                  <button
                    onClick={() => setUserPickedTradeSymbol('')}
                    className="text-[10px] text-slate-400 hover:text-slate-200 underline"
                  >
                    Auto
                  </button>
                )}
              </div>

              <div
                onClick={() =>
                  setSelectedInstrumentSymbol(activeDailyTradeInstrument.symbol)
                }
                className="p-2.5 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 cursor-pointer hover:border-sky-500 transition-colors"
              >
                <div className="flex items-baseline justify-between">
                  <span className="font-mono font-bold text-sm text-slate-900 dark:text-slate-100">
                    {activeDailyTradeInstrument.symbol}
                  </span>
                  <span className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                    ${activeDailyTradeInstrument.price.toFixed(2)}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {activeDailyTradeInstrument.name}
                </div>
                <div className="mt-1">
                  <DataStatusChip instrument={activeDailyTradeInstrument} />
                </div>
                <div className="mt-1 font-mono text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 truncate">
                  {
                    activeDailyTradeInstrument.metricsByBaseline[baseline]
                      .directionalSummary
                  }
                </div>
              </div>

              <button
                onClick={openCheckpointModal}
                className="w-full py-2 px-3 text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white rounded-md transition-colors"
              >
                Save Today's #1 Note
              </button>
            </div>
          )}
      </aside>

      {/* RIGHT-HAND MAIN SAAS WORKSPACE */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Clean Single Top Header Bar */}
        <header className="px-6 py-3.5 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-base font-bold text-slate-900 dark:text-slate-100">
              {activeSectionMeta.title}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {activeSectionMeta.subtitle}
            </p>
          </div>

          {/* Data Date, Last Refreshed & Refresh Button */}
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
              <CalendarClock className="w-3.5 h-3.5 text-sky-500" />
              <span>Data Day:</span>
              <strong className="font-mono text-slate-900 dark:text-slate-100">
                {formatReadableDate(marketSessionDate)}
              </strong>
            </div>

            <span className="text-slate-300 dark:text-slate-700">|</span>

            <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
              <Clock className="w-3.5 h-3.5 text-emerald-500" />
              <span>Refreshed:</span>
              <strong className="font-mono text-slate-900 dark:text-slate-100 tabular-nums">
                {formatExactTime(lastRefreshedAt)} ({relativeRefreshLabel})
              </strong>
            </div>

            <button
              onClick={handleRunRefresh}
              disabled={refreshStage === 'running'}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                refreshStage === 'running'
                  ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/40'
                  : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100'
              }`}
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${
                  refreshStage === 'running' ? 'animate-spin' : ''
                }`}
              />
              <span>
                {refreshStage === 'running'
                  ? `Refreshing (${refreshProgress}%)`
                  : 'Refresh'}
              </span>
            </button>

            <button
              onClick={() => {
                setTickerError('');
                setShowAddTickerModal(true);
              }}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors inline-flex items-center gap-1 whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Stock</span>
            </button>
          </div>
        </header>

        {/* Full-Width Red Error Banner when universe request fails OR when Yahoo market data fails for symbols */}
        {(universeFetchError || unavailableCount > 0) && (
          <div
            role="alert"
            className="px-6 py-3 bg-rose-600/15 dark:bg-rose-950/80 border-b border-rose-500/40 flex flex-wrap items-center justify-between gap-3 text-xs text-rose-700 dark:text-rose-300"
          >
            <div className="flex items-center gap-2 font-medium">
              <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
              <span>
                {universeFetchError
                  ? `Market universe failed to load: ${universeFetchError}`
                  : `Market data unavailable from Yahoo Finance — ${unavailableCount} of ${instruments.length} symbols failed to load real OHLCV data.`}
              </span>
            </div>
            <button
              onClick={fetchUniverse}
              className="px-3 py-1 text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white rounded-md transition-colors shrink-0"
            >
              Retry
            </button>
          </div>
        )}

        {/* Visual Refresh Status Clue (Only shown while refreshing or just finished) */}
        {refreshStage !== 'idle' && (
          <div className="px-6 py-2 bg-slate-100 dark:bg-slate-900/90 border-b border-slate-200 dark:border-slate-800">
            {refreshStage === 'running' ? (
              <div className="flex items-center gap-3 text-xs font-mono text-amber-600 dark:text-amber-400">
                <span>{refreshStatusText}</span>
                <div className="flex-1 max-w-xs h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-sky-500 transition-all duration-200"
                    style={{ width: `${refreshProgress}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between text-xs font-mono text-emerald-600 dark:text-emerald-400">
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{refreshStatusText}</span>
                </span>
                <button
                  onClick={() => setRefreshStage('idle')}
                  className="text-slate-400 hover:text-slate-200"
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>
        )}

        {/* MAIN RIGHT-HAND SPLIT VIEWPORT */}
        <main className="flex-1 p-6 overflow-y-auto">
          {isLoading ? (
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
              <div className="xl:col-span-6 h-96 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg animate-pulse" />
              <div className="xl:col-span-6 h-96 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg animate-pulse" />
            </div>
          ) : universeFetchError ? (
            <div className="bg-white dark:bg-slate-900 border border-rose-500/30 rounded-lg p-12 text-center space-y-3">
              <AlertCircle className="w-8 h-8 text-rose-500 mx-auto" />
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Unable to Load Market Data
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                {universeFetchError}
              </p>
              <button
                onClick={fetchUniverse}
                className="px-4 py-2 text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white rounded-md transition-colors"
              >
                Retry
              </button>
            </div>
          ) : activeTab === 'shortlist' ? (
            <PreMarketShortlistView />
          ) : activeTab === 'journal' ? (
            <CheckpointJournalView
              journal={journal}
              instruments={instruments}
              baseline={baseline}
              timeframe={timeframe}
              onOpenLogModal={openCheckpointModal}
              onDeleteSnapshot={handleDeleteSnapshot}
              onSelectInstrument={(sym) => {
                setSelectedInstrumentSymbol(sym);
                setActiveTab('sectors');
              }}
            />
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
              {/* Left 6 cols of Main Area: Selected Section List (Sectors, Stock Finder, or Volume Alerts) */}
              <div className="xl:col-span-6 min-w-0">
                {activeTab === 'sectors' && (
                  <SectorFlowView
                    instruments={instruments}
                    selectedSectorSymbol={selectedSectorSymbol}
                    onSelectSector={(secSym) => setSelectedSectorSymbol(secSym)}
                    selectedInstrumentSymbol={selectedInstrumentSymbol}
                    onSelectInstrument={(sym) => setSelectedInstrumentSymbol(sym)}
                    timeframe={timeframe}
                    baseline={baseline}
                    selectedTradeSymbol={activeDailyTradeInstrument?.symbol}
                    onPickAsDailyTrade={handlePickDailyTrade}
                  />
                )}

                {activeTab === 'scanner' && (
                  <VolumeScannerView
                    instruments={instruments}
                    selectedInstrumentSymbol={selectedInstrumentSymbol}
                    onSelectInstrument={(sym) => setSelectedInstrumentSymbol(sym)}
                    timeframe={timeframe}
                    baseline={baseline}
                    selectedTradeSymbol={activeDailyTradeInstrument?.symbol}
                    onPickAsDailyTrade={handlePickDailyTrade}
                  />
                )}

                {activeTab === 'alerts' && (
                  <SurgeAlertsView
                    alerts={alerts}
                    instruments={instruments}
                    onUpdateAlerts={handleUpdateAlerts}
                    onSelectInstrument={(sym) => setSelectedInstrumentSymbol(sym)}
                    selectedTradeSymbol={activeDailyTradeInstrument?.symbol}
                    onPickAsDailyTrade={handlePickDailyTrade}
                  />
                )}
              </div>

              {/* Right 6 cols of Main Area: Sticky Price & Volume Chart Inspector */}
              <div className="xl:col-span-6 xl:sticky xl:top-6 min-w-0">
                {inspectedInstrument && (
                  <VolumeInspectorPanel
                    instrument={inspectedInstrument}
                    baseline={baseline}
                    activeTimeframe={timeframe}
                    onSelectInstrument={(sym) => setSelectedInstrumentSymbol(sym)}
                    selectedTradeSymbol={activeDailyTradeInstrument?.symbol}
                    onPickAsDailyTrade={handlePickDailyTrade}
                  />
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* MODAL 1: Add Stock */}
      {showAddTickerModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg max-w-md w-full p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Add Any Stock or ETF to Your List
              </h3>
              <button
                onClick={() => setShowAddTickerModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddCustomTicker} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Stock Ticker Symbol *
                </label>
                <input
                  type="text"
                  required
                  value={newTickerSymbol}
                  onChange={(e) => setNewTickerSymbol(e.target.value.toUpperCase())}
                  placeholder="e.g., AMD, SMCI, COIN, UBER, ORCL"
                  className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Company Name (Optional)
                </label>
                <input
                  type="text"
                  value={newTickerName}
                  onChange={(e) => setNewTickerName(e.target.value)}
                  placeholder="e.g., Advanced Micro Devices"
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Which Sector Is It In?
                </label>
                <select
                  value={newTickerSector}
                  onChange={(e) => setNewTickerSector(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-slate-100"
                >
                  {GICS_SECTORS.map((s) => (
                    <option key={s.symbol} value={s.symbol}>
                      {s.sectorName} ({s.symbol})
                    </option>
                  ))}
                </select>
              </div>

              {tickerError && (
                <div
                  role="alert"
                  className="p-2.5 rounded-md bg-rose-500/15 border border-rose-500/30 text-xs text-rose-600 dark:text-rose-400"
                >
                  {tickerError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddTickerModal(false)}
                  className="px-3.5 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addingTicker}
                  className="px-4 py-2 text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white rounded-md transition-colors"
                >
                  {addingTicker ? 'Loading Stock Volume...' : 'Add Stock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Save Today's Trade Note */}
      {showCheckpointModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg max-w-lg w-full p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Save Today's #1 Trade Note
              </h3>
              <button
                onClick={() => setShowCheckpointModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400">
              Saves your #1 trade idea and today's top sectors so you can check back tomorrow or next week to see if volume stayed strong.
            </p>

            <form onSubmit={handleSaveCheckpoint} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Check-In Type
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['Daily', 'Weekly', 'Monthly'] as const).map((cad) => (
                    <button
                      type="button"
                      key={cad}
                      onClick={() => setCheckpointCadence(cad)}
                      className={`py-1.5 text-xs font-medium rounded border transition-colors ${
                        checkpointCadence === cad
                          ? 'bg-sky-600/10 border-sky-500 text-sky-600 dark:text-sky-400'
                          : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {cad} Check
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Title / #1 Trade Idea *
                </label>
                <input
                  type="text"
                  required
                  value={checkpointTitle}
                  onChange={(e) => setCheckpointTitle(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Why You Like This Trade (Volume Notes)
                </label>
                <textarea
                  rows={3}
                  value={checkpointNotes}
                  onChange={(e) => setCheckpointNotes(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCheckpointModal(false)}
                  className="px-3.5 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white rounded-md transition-colors"
                >
                  Save Note
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
