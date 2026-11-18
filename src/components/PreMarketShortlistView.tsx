import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpDown,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Download,
  Lock,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Unlock,
} from 'lucide-react';
import { toNewYorkDateTime } from '../lib/marketData';
import {
  deriveMorningCheckpoints,
  formatCopyLevelsLine,
  resolveNewYorkWallTimeToInstant,
} from '../lib/silentFlip';
import { formatCompactNumber, GICS_SECTORS } from '../lib/volumeAnalytics';
import {
  FeedFetchError,
  FeedType,
  LockedShortlistRecord,
  ShortlistBuildResult,
  ShortlistCandidateRow,
  ShortlistOverrides,
  SilentFlipBenchItem,
} from '../types/market';
import { DataStatusChip } from './DataStatusChip';

interface DataHealthReport {
  feeds: Record<
    FeedType,
    {
      lastFetchAt: string | null;
      okCount: number;
      failCount: number;
      lastError: string | null;
    }
  >;
  recentErrors: FeedFetchError[];
}

interface ShortlistApiResponse {
  result: ShortlistBuildResult;
  bench: SilentFlipBenchItem[];
  overrides: ShortlistOverrides;
  lockedRecord: LockedShortlistRecord | null;
  dataHealth: DataHealthReport;
}

const nyLiveClockFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const ukLiveClockFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function formatSessionHeaderDate(isoDateStr: string): string {
  if (!isoDateStr) return 'Upcoming US Session';
  const parts = isoDateStr.split('-').map(Number);
  if (parts.length !== 3) return isoDateStr;
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatCountdownToOpen(now: Date, sessionDate: string): string {
  if (!sessionDate) return '—';
  const openInstant = resolveNewYorkWallTimeToInstant(sessionDate, '09:30');
  const diffSec = Math.floor((openInstant.getTime() - now.getTime()) / 1000);
  if (diffSec <= 0) {
    const { nyDate, nyTime } = toNewYorkDateTime(now);
    if (nyDate === sessionDate && nyTime >= '09:30:00' && nyTime < '16:00:00') {
      return 'Market Open';
    }
    return 'Session Open Passed';
  }
  const hrs = Math.floor(diffSec / 3600);
  const mins = Math.floor((diffSec % 3600) / 60);
  const secs = diffSec % 60;
  if (hrs > 24) {
    const days = Math.floor(hrs / 24);
    const remHrs = hrs % 24;
    return `${days}d ${remHrs}h ${mins}m to 09:30 NY`;
  }
  return `${String(hrs).padStart(2, '0')}h ${String(mins).padStart(
    2,
    '0'
  )}m ${String(secs).padStart(2, '0')}s`;
}

function formatPremarketSourceLabel(
  sourceWindow: 'premarket_0400_0930' | 'regular_or_post' | 'none'
): string {
  if (sourceWindow === 'premarket_0400_0930') {
    return '04:00–09:30 pre-mkt';
  }
  if (sourceWindow === 'regular_or_post') {
    return 'Regular/Post (stale)';
  }
  return 'No pre-mkt bar';
}

type BenchSortKey =
  | 'status'
  | 'symbol'
  | 'sector'
  | 'score'
  | 'rangeInCandles'
  | 'respectRate';

export const PreMarketShortlistView: React.FC = () => {
  const [data, setData] = useState<ShortlistApiResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [now, setNow] = useState<Date>(() => new Date());
  const [copiedSymbol, setCopiedSymbol] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState<boolean>(false);
  const [tvExportError, setTvExportError] = useState<string | null>(null);

  // Full bench table sorting
  const [benchSortKey, setBenchSortKey] = useState<BenchSortKey>('score');
  const [benchSortAsc, setBenchSortAsc] = useState<boolean>(false);

  // Collapsible panels
  const [showBenchHealth, setShowBenchHealth] = useState<boolean>(false);
  const [showDataHealth, setShowDataHealth] = useState<boolean>(false);

  // Add bench symbol form
  const [newBenchSymbol, setNewBenchSymbol] = useState<string>('');
  const [newBenchName, setNewBenchName] = useState<string>('');
  const [newBenchSector, setNewBenchSector] = useState<string>('XLK');
  const [addingBenchSymbol, setAddingBenchSymbol] = useState<boolean>(false);
  const [benchFormError, setBenchFormError] = useState<string>('');

  const loadShortlist = useCallback(
    async (opts?: { refreshPremarket?: boolean; forceAll?: boolean }) => {
      if (opts?.refreshPremarket || opts?.forceAll) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setFetchError(null);

      try {
        const params = new URLSearchParams();
        if (opts?.refreshPremarket) params.set('refreshPremarket', '1');
        if (opts?.forceAll) params.set('forceAll', '1');
        const qs = params.toString() ? `?${params.toString()}` : '';
        const res = await fetch(`/api/silent-flip/shortlist${qs}`);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: Failed to load shortlist`);
        }
        const payload = (await res.json()) as ShortlistApiResponse;
        setData(payload);

        // Auto-open Data Health panel if a market data feed has failures
        const fh = payload.dataHealth?.feeds;
        if (
          fh &&
          ((fh.daily_1y.failCount > 0 && fh.daily_1y.okCount === 0) ||
            (fh.intraday_15m_60d.failCount > 0 &&
              fh.intraday_15m_60d.okCount === 0) ||
            (fh.premarket_5m_1d.failCount > 0 &&
              fh.premarket_5m_1d.okCount === 0))
        ) {
          setShowDataHealth(true);
        }
      } catch (err) {
        setFetchError(
          err instanceof Error
            ? err.message
            : 'Failed to load Silent Flip shortlist.'
        );
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    []
  );

  useEffect(() => {
    loadShortlist();
  }, [loadShortlist]);

  // Live NY & UK 1-second clock tick
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Section 3 table: Auto-refresh pre-market every 5 minutes from 08:00 to 09:30 New York while the view is open
  useEffect(() => {
    const interval = setInterval(() => {
      const { nyTime } = toNewYorkDateTime(new Date());
      if (nyTime >= '08:00:00' && nyTime <= '09:30:00') {
        loadShortlist({ refreshPremarket: true });
      }
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [loadShortlist]);

  const activeResult = data?.result ?? null;
  const lockedRecord = data?.lockedRecord ?? null;

  // Section 6 Lock rule:
  // "A 'Lock shortlist' button freezes the selection with a timestamp and writes it to the setup log.
  // The view shows 'Locked at 14:16 UK' afterwards. Pre-market prices can keep refreshing for display,
  // but the locked list does not change."
  const displayedShortlist: ShortlistCandidateRow[] = useMemo(() => {
    if (!activeResult) return [];
    if (!lockedRecord) return activeResult.shortlist;

    const liveBySym = new Map<string, ShortlistCandidateRow>(
      activeResult.benchRows.map((r) => [r.symbol, r])
    );

    return lockedRecord.result.shortlist.map((lockedRow) => {
      const liveRow = liveBySym.get(lockedRow.symbol);
      if (!liveRow) return lockedRow;
      return {
        ...lockedRow,
        premarketPrice: liveRow.premarketPrice ?? lockedRow.premarketPrice,
        premarketDateNY: liveRow.premarketDateNY ?? lockedRow.premarketDateNY,
        premarketTimeNY: liveRow.premarketTimeNY ?? lockedRow.premarketTimeNY,
        premarketSourceWindow:
          liveRow.premarketSourceWindow ?? lockedRow.premarketSourceWindow,
        premarketStatus: liveRow.premarketStatus ?? lockedRow.premarketStatus,
        gapPctFromClose: liveRow.gapPctFromClose ?? lockedRow.gapPctFromClose,
      };
    });
  }, [activeResult, lockedRecord]);

  const sessionDate =
    activeResult?.sessionBeingPrepared || toNewYorkDateTime(now).nyDate;

  const checkpoints = useMemo(() => {
    return deriveMorningCheckpoints(sessionDate);
  }, [sessionDate]);

  const nextCheckpointId = useMemo(() => {
    const nowMs = now.getTime();
    const upcoming = checkpoints.find((cp) => cp.instantMs > nowMs);
    return upcoming ? upcoming.id : null;
  }, [checkpoints, now]);

  const overallHealthStatus = useMemo((): 'ok' | 'stale' | 'unavailable' => {
    if (!activeResult) return 'unavailable';
    if (activeResult.yahooFailureBanner) return 'unavailable';
    const unavailCount = activeResult.benchRows.filter(
      (r) => r.dataStatus === 'unavailable'
    ).length;
    if (unavailCount > 0) return 'stale';
    if (activeResult.earningsBanner) return 'stale';
    return 'ok';
  }, [activeResult]);

  const handleToggleDataDay = async () => {
    if (!data) return;
    const nextVal = !data.overrides.usDataRelease0830;
    try {
      const res = await fetch('/api/silent-flip/overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usDataRelease0830: nextVal }),
      });
      if (res.ok) {
        const payload = (await res.json()) as ShortlistApiResponse;
        setData(payload);
      }
    } catch {
      // ignore transient error
    }
  };

  const handleToggleExcludeNews = async (symbol: string, current: boolean) => {
    try {
      const res = await fetch('/api/silent-flip/overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, excludeNews: !current }),
      });
      if (res.ok) {
        const payload = (await res.json()) as ShortlistApiResponse;
        setData(payload);
      }
    } catch {
      // ignore
    }
  };

  const handleLockOrUnlock = async (action: 'lock' | 'unlock') => {
    try {
      const res = await fetch('/api/silent-flip/lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        const payload = (await res.json()) as ShortlistApiResponse;
        setData(payload);
      }
    } catch {
      // ignore
    }
  };

  const handleCopySingleRow = async (row: ShortlistCandidateRow) => {
    const line = formatCopyLevelsLine(row);
    try {
      await navigator.clipboard.writeText(line);
      setCopiedSymbol(row.symbol);
      setTimeout(() => setCopiedSymbol(null), 1800);
    } catch {
      // ignore
    }
  };

  const handleCopyAllLevels = async () => {
    if (displayedShortlist.length === 0) return;
    const lines = displayedShortlist
      .map((r) => formatCopyLevelsLine(r))
      .join('\n');
    try {
      await navigator.clipboard.writeText(lines);
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 1800);
    } catch {
      // ignore
    }
  };

  const handleDownloadTradingViewWatchlist = () => {
    setTvExportError(null);
    if (displayedShortlist.length === 0) {
      setTvExportError('No shortlisted stocks to export.');
      return;
    }

    const unmapped = displayedShortlist.filter(
      (r) => !r.tradingViewPrefix || r.tradingViewError
    );
    if (unmapped.length > 0) {
      const details = unmapped
        .map(
          (r) =>
            `${r.symbol} (${r.tradingViewError || 'Unmapped exchange code'})`
        )
        .join(', ');
      setTvExportError(`Cannot export unmapped exchange codes: ${details}`);
      return;
    }

    const entries = displayedShortlist.map(
      (r) => `${r.tradingViewPrefix}:${r.symbol}`
    );
    const content = entries.join(',');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `silent-flip-${sessionDate}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleAddBenchSymbol = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanSymbol = newBenchSymbol
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9.-]/g, '');
    if (!cleanSymbol) {
      setBenchFormError('Enter a valid ticker symbol.');
      return;
    }

    setAddingBenchSymbol(true);
    setBenchFormError('');
    try {
      const res = await fetch('/api/silent-flip/bench', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add',
          symbol: cleanSymbol,
          name: newBenchName.trim(),
          sectorSymbol: newBenchSector,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBenchFormError(
          body?.error || 'Failed to load market data from Yahoo Finance'
        );
        return;
      }
      setData(body as ShortlistApiResponse);
      setNewBenchSymbol('');
      setNewBenchName('');
    } catch {
      setBenchFormError('Failed to load market data from Yahoo Finance');
    } finally {
      setAddingBenchSymbol(false);
    }
  };

  const handleRemoveBenchSymbol = async (symbol: string) => {
    try {
      const res = await fetch('/api/silent-flip/bench', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove', symbol }),
      });
      if (res.ok) {
        const payload = (await res.json()) as ShortlistApiResponse;
        setData(payload);
      }
    } catch {
      // ignore
    }
  };

  const sortedBenchRows = useMemo(() => {
    if (!activeResult) return [];
    const rows = [...activeResult.benchRows];
    rows.sort((a, b) => {
      let cmp = 0;
      if (benchSortKey === 'symbol') {
        cmp = a.symbol.localeCompare(b.symbol);
      } else if (benchSortKey === 'sector') {
        cmp =
          a.sectorName.localeCompare(b.sectorName) ||
          a.symbol.localeCompare(b.symbol);
      } else if (benchSortKey === 'status') {
        const rankA = a.selectedInShortlist ? 2 : a.allTestsPassed ? 1 : 0;
        const rankB = b.selectedInShortlist ? 2 : b.allTestsPassed ? 1 : 0;
        cmp = rankA - rankB;
      } else if (benchSortKey === 'rangeInCandles') {
        cmp =
          (a.levels?.rangeInCandles ?? -1) - (b.levels?.rangeInCandles ?? -1);
      } else if (benchSortKey === 'respectRate') {
        cmp =
          (a.health.respectRate60D ?? -1) - (b.health.respectRate60D ?? -1);
      } else {
        // score
        const scoreA = a.score ?? -1;
        const scoreB = b.score ?? -1;
        cmp = scoreA - scoreB;
      }
      return benchSortAsc ? cmp : -cmp;
    });
    return rows;
  }, [activeResult, benchSortKey, benchSortAsc]);

  const toggleSort = (key: BenchSortKey) => {
    if (benchSortKey === key) {
      setBenchSortAsc(!benchSortAsc);
    } else {
      setBenchSortKey(key);
      setBenchSortAsc(key === 'symbol' || key === 'sector');
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-24 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg animate-pulse" />
        <div className="h-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg animate-pulse" />
        <div className="h-96 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg animate-pulse" />
      </div>
    );
  }

  if (fetchError || !activeResult) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-rose-500/40 rounded-lg p-10 text-center space-y-3">
        <AlertCircle className="w-8 h-8 text-rose-500 mx-auto" />
        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Silent Flip Shortlist Unavailable
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
          {fetchError || 'Could not compute pre-market shortlist from Yahoo Finance.'}
        </p>
        <button
          onClick={() => loadShortlist({ forceAll: true })}
          className="px-4 py-2 text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white rounded-md transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* 1. HEADER BAR */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* Session Being Prepared & Clocks */}
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Session Being Prepared
              </div>
              <div className="text-base font-bold font-mono text-slate-900 dark:text-slate-100">
                {formatSessionHeaderDate(sessionDate)}
                {activeResult.asOfCompletedSession && (
                  <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">
                    (Levels from D−1: {activeResult.asOfCompletedSession})
                  </span>
                )}
              </div>
            </div>

            <div className="h-8 w-px bg-slate-200 dark:bg-slate-800 hidden sm:block" />

            {/* Live Clocks for UK and New York + Countdown */}
            <div className="flex flex-wrap items-center gap-3 font-mono text-xs tabular-nums">
              <div className="px-2.5 py-1.5 rounded bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <span className="text-slate-500 dark:text-slate-400 mr-1.5">
                  UK:
                </span>
                <strong className="text-slate-900 dark:text-slate-100">
                  {ukLiveClockFormatter.format(now)}
                </strong>
              </div>
              <div className="px-2.5 py-1.5 rounded bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <span className="text-slate-500 dark:text-slate-400 mr-1.5">
                  New York:
                </span>
                <strong className="text-slate-900 dark:text-slate-100">
                  {nyLiveClockFormatter.format(now)}
                </strong>
              </div>
              <div className="px-2.5 py-1.5 rounded bg-sky-500/10 border border-sky-500/25 text-sky-700 dark:text-sky-300 font-semibold flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 shrink-0" />
                <span>{formatCountdownToOpen(now, sessionDate)}</span>
              </div>
            </div>
          </div>

          {/* Right Controls: Overall Data-Health Chip, Data-Day Switch, Refresh, Lock */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Overall Data-Health Chip */}
            {overallHealthStatus === 'ok' ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/25 text-xs font-mono font-medium">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Data Health: OK</span>
              </span>
            ) : overallHealthStatus === 'stale' ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/25 text-xs font-mono font-medium">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Data Health: Check</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/30 text-xs font-mono font-semibold">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>Data Health: Error</span>
              </span>
            )}

            {/* 08:30 US Data Release Switch */}
            <label className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs cursor-pointer select-none">
              <input
                type="checkbox"
                checked={Boolean(data?.overrides.usDataRelease0830)}
                onChange={handleToggleDataDay}
                className="rounded border-slate-300 text-amber-600 focus:ring-amber-500"
              />
              <span className="text-slate-700 dark:text-slate-300 font-medium">
                US data release at 08:30 NY today (CPI, payrolls, etc.)
              </span>
            </label>

            {/* Refresh Button */}
            <button
              onClick={() => loadShortlist({ refreshPremarket: true })}
              disabled={isRefreshing}
              className="px-3 py-1.5 text-xs font-semibold rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 transition-colors inline-flex items-center gap-1.5"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`}
              />
              <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
            </button>

            {/* Lock Shortlist Button */}
            {lockedRecord ? (
              <div className="inline-flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-mono font-semibold">
                  <Lock className="w-3.5 h-3.5" />
                  <span>Locked at {lockedRecord.lockedAtUkTime}</span>
                </span>
                <button
                  onClick={() => handleLockOrUnlock('unlock')}
                  title="Unlock shortlist"
                  className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded border border-slate-200 dark:border-slate-800"
                >
                  <Unlock className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => handleLockOrUnlock('lock')}
                className="px-3 py-1.5 text-xs font-semibold rounded-md bg-sky-600 hover:bg-sky-500 text-white transition-colors inline-flex items-center gap-1.5"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Lock shortlist</span>
              </button>
            )}
          </div>
        </div>

        {/* 2. MORNING TIMELINE STRIP */}
        <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {checkpoints.map((cp) => {
              const isNext = cp.id === nextCheckpointId;
              return (
                <div
                  key={cp.id}
                  className={`px-3 py-2 rounded-md border text-xs flex flex-col justify-between transition-colors ${
                    isNext
                      ? 'bg-sky-500/10 border-sky-500/50 text-sky-900 dark:text-sky-200 ring-1 ring-sky-500/30'
                      : 'bg-slate-50 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {cp.label}
                    </span>
                    {isNext && (
                      <span className="px-1.5 py-0.5 text-[10px] font-mono font-bold uppercase bg-sky-600 text-white rounded">
                        Next
                      </span>
                    )}
                  </div>
                  <div className="mt-1 font-mono text-[11px] tabular-nums">
                    <strong className="text-slate-900 dark:text-slate-100">
                      {cp.ukTime} UK
                    </strong>{' '}
                    <span className="text-slate-400">·</span>{' '}
                    <span>{cp.nyTime} NY</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* BANNERS (Yahoo >20% Failure Red Banner, Earnings Amber Banner, Data Day Banner, Direction Balance Hint) */}
      {activeResult.yahooFailureBanner && (
        <div
          role="alert"
          className="px-4 py-2.5 rounded-lg bg-rose-500/15 border border-rose-500/40 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2 font-medium"
        >
          <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
          <span>{activeResult.yahooFailureBanner}</span>
        </div>
      )}

      {activeResult.earningsBanner && (
        <div
          role="status"
          className="px-4 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2 font-medium"
        >
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
          <span>{activeResult.earningsBanner}</span>
        </div>
      )}

      {activeResult.dataDayBanner && (
        <div
          role="status"
          className="px-4 py-2.5 rounded-lg bg-amber-500/15 border border-amber-500/40 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2 font-semibold"
        >
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
          <span>{activeResult.dataDayBanner}</span>
        </div>
      )}

      {activeResult.directionBalanceHint && (
        <div
          role="status"
          className="px-4 py-2.5 rounded-lg bg-sky-500/10 border border-sky-500/30 text-xs text-sky-800 dark:text-sky-300 flex items-center gap-2 font-medium"
        >
          <AlertTriangle className="w-4 h-4 text-sky-500 shrink-0" />
          <span>{activeResult.directionBalanceHint}</span>
        </div>
      )}

      {/* 3. SHORTLIST TABLE (THE 5–8 SELECTED) + 4. EXPORT CONTROLS */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <div className="px-4 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Pre-Market Shortlist ({displayedShortlist.length} selected)
              </h2>
              {activeResult.onlyNCandidatesNote && (
                <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 font-mono text-xs font-semibold">
                  {activeResult.onlyNCandidatesNote}
                </span>
              )}
              {lockedRecord && (
                <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 font-mono text-xs font-semibold">
                  Frozen Selection ({lockedRecord.lockedAtUkTime})
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Ranked by Reach (0–40) + Respect (0–40) + Room (0–20). Max 8 stocks, at most 2 per sector. Hover any level to view its session date.
            </p>
          </div>

          {/* 4. Export buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleCopyAllLevels}
              disabled={displayedShortlist.length === 0}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-colors inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              {copiedAll ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Copied all levels</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy all levels</span>
                </>
              )}
            </button>

            <button
              onClick={handleDownloadTradingViewWatchlist}
              disabled={displayedShortlist.length === 0}
              className="px-3 py-1.5 text-xs font-semibold rounded-md bg-sky-600 hover:bg-sky-500 text-white transition-colors inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download TradingView watchlist</span>
            </button>
          </div>
        </div>

        {tvExportError && (
          <div className="px-4 py-2 bg-rose-500/15 border-b border-rose-500/30 text-xs text-rose-600 dark:text-rose-400 font-mono">
            {tvExportError}
          </div>
        )}

        {displayedShortlist.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
            No bench symbols passed all five pre-market tests (T1–T5) right now. Inspect the Full Bench Table below to see each symbol&apos;s fail label.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 text-[11px] text-slate-500 dark:text-slate-400 font-semibold">
                  <th className="py-2.5 px-3">Rank</th>
                  <th className="py-2.5 px-3">Symbol &amp; Sector</th>
                  <th className="py-2.5 px-3">Side</th>
                  <th className="py-2.5 px-3 text-right">Score</th>
                  <th className="py-2.5 px-3 text-right">P (Gap %)</th>
                  <th className="py-2.5 px-3 text-right">FH</th>
                  <th className="py-2.5 px-3 text-right">RH</th>
                  <th className="py-2.5 px-3 text-right">RL</th>
                  <th className="py-2.5 px-3 text-right">FL</th>
                  <th className="py-2.5 px-3 text-right">Dist to Level</th>
                  <th className="py-2.5 px-3 text-right">A ($)</th>
                  <th className="py-2.5 px-3 text-right">Respect (n)</th>
                  <th className="py-2.5 px-3 text-right">Range (Candles)</th>
                  <th className="py-2.5 px-3">Earnings</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800/70 font-mono">
                {displayedShortlist.map((row) => {
                  const lv = row.levels;
                  const sd = row.scoreDetail;
                  const side = row.passingSide || row.winningSide;
                  const respectPct =
                    sd && sd.respectRateRaw !== null
                      ? `${Math.round(sd.respectRateRaw * 100)}% (n=${
                          sd.respectSampleN
                        })`
                      : row.health.respectRate60D !== null
                      ? `${Math.round(row.health.respectRate60D * 100)}% (n=${
                          row.health.levelTouches60D
                        })`
                      : '—';

                  return (
                    <tr
                      key={row.symbol}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                    >
                      <td className="py-3 px-3 font-bold text-slate-900 dark:text-slate-100">
                        #{row.shortlistRank}
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-bold text-sm text-slate-900 dark:text-slate-100">
                            {row.symbol}
                          </span>
                          <span className="font-sans text-xs text-slate-500 dark:text-slate-400">
                            {row.sectorName} ({row.sectorSymbol})
                          </span>
                          <DataStatusChip instrument={row} />
                          {row.isHalfDay && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 text-[10px]">
                              Half-day
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                            side === 'SELL'
                              ? 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/30'
                              : side === 'BUY'
                              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30'
                              : 'bg-sky-500/15 text-sky-700 dark:text-sky-400 border border-sky-500/30'
                          }`}
                        >
                          {side}
                        </span>
                      </td>
                      <td
                        className="py-3 px-3 text-right font-bold text-sm text-slate-900 dark:text-slate-100 tabular-nums"
                        title={
                          sd
                            ? `Reach: ${sd.reachScore}/40 | Respect: ${sd.respectScore}/40 | Room: ${sd.roomScore}/20`
                            : ''
                        }
                      >
                        {row.score !== null ? row.score.toFixed(1) : '—'}
                      </td>
                      <td className="py-3 px-3 text-right tabular-nums">
                        {row.premarketPrice !== null ? (
                          <div>
                            <div className="font-bold text-slate-900 dark:text-slate-100">
                              ${row.premarketPrice.toFixed(2)}
                            </div>
                            {row.gapPctFromClose !== null && (
                              <div
                                className={`text-[11px] ${
                                  row.gapPctFromClose >= 0
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : 'text-rose-600 dark:text-rose-400'
                                }`}
                              >
                                {row.gapPctFromClose >= 0 ? '+' : ''}
                                {row.gapPctFromClose.toFixed(2)}%
                              </div>
                            )}
                            <div className="text-[10px] text-slate-500 dark:text-slate-400">
                              {row.premarketDateNY
                                ? `${row.premarketDateNY} `
                                : ''}
                              {row.premarketTimeNY
                                ? `${row.premarketTimeNY.slice(0, 5)} NY`
                                : 'No time'}
                            </div>
                            <div
                              className={`text-[10px] ${
                                row.premarketStatus === 'ok'
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-amber-600 dark:text-amber-400'
                              }`}
                            >
                              {formatPremarketSourceLabel(
                                row.premarketSourceWindow
                              )}
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div>—</div>
                            <div className="text-[10px] text-slate-400">
                              {formatPremarketSourceLabel(
                                row.premarketSourceWindow
                              )}
                            </div>
                          </div>
                        )}
                      </td>
                      <td
                        className="py-3 px-3 text-right tabular-nums"
                        title={
                          lv?.flipHighDate
                            ? `Flip High date: ${lv.flipHighDate}`
                            : 'No Flip High — sell side off'
                        }
                      >
                        {lv?.flipHigh !== null && lv?.flipHigh !== undefined ? (
                          <div>
                            <div className="font-semibold text-rose-600 dark:text-rose-400">
                              ${lv.flipHigh.toFixed(2)}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {lv.flipHighDate}
                            </div>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400">
                            No Flip High — sell side off
                          </span>
                        )}
                      </td>
                      <td
                        className="py-3 px-3 text-right tabular-nums"
                        title={
                          lv?.rangeHighDate
                            ? `Range High date: ${lv.rangeHighDate}`
                            : ''
                        }
                      >
                        {lv ? (
                          <div>
                            <div className="font-semibold text-slate-900 dark:text-slate-100">
                              ${lv.rangeHigh.toFixed(2)}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {lv.rangeHighDate}
                            </div>
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td
                        className="py-3 px-3 text-right tabular-nums"
                        title={
                          lv?.rangeLowDate
                            ? `Range Low date: ${lv.rangeLowDate}`
                            : ''
                        }
                      >
                        {lv ? (
                          <div>
                            <div className="font-semibold text-slate-900 dark:text-slate-100">
                              ${lv.rangeLow.toFixed(2)}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {lv.rangeLowDate}
                            </div>
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td
                        className="py-3 px-3 text-right tabular-nums"
                        title={
                          lv?.flipLowDate
                            ? `Flip Low date: ${lv.flipLowDate}`
                            : 'No Flip Low — buy side off'
                        }
                      >
                        {lv?.flipLow !== null && lv?.flipLow !== undefined ? (
                          <div>
                            <div className="font-semibold text-emerald-600 dark:text-emerald-400">
                              ${lv.flipLow.toFixed(2)}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {lv.flipLowDate}
                            </div>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400">
                            No Flip Low — buy side off
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right tabular-nums">
                        {sd ? (
                          <div>
                            <div className="text-slate-900 dark:text-slate-100">
                              ${sd.distanceDollar.toFixed(2)} ({sd.nearestLevelName})
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {sd.distanceInA.toFixed(2)}x A
                            </div>
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-3 px-3 text-right tabular-nums text-slate-900 dark:text-slate-100">
                        {lv?.firstCandleAvg !== null &&
                        lv?.firstCandleAvg !== undefined
                          ? `$${lv.firstCandleAvg.toFixed(2)}`
                          : '—'}
                      </td>
                      <td className="py-3 px-3 text-right tabular-nums text-slate-900 dark:text-slate-100">
                        {respectPct}
                      </td>
                      <td className="py-3 px-3 text-right tabular-nums text-slate-900 dark:text-slate-100">
                        {lv?.rangeInCandles !== null &&
                        lv?.rangeInCandles !== undefined
                          ? `${lv.rangeInCandles.toFixed(1)} candles`
                          : '—'}
                      </td>
                      <td className="py-3 px-3 font-sans">
                        <span
                          className={`text-[11px] ${
                            row.earningsUnavailable
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-emerald-600 dark:text-emerald-400'
                          }`}
                        >
                          {row.earningsStatusLabel}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-sans">
                        <button
                          onClick={() => handleCopySingleRow(row)}
                          className="px-2.5 py-1 text-xs font-medium rounded bg-slate-100 dark:bg-slate-800 hover:bg-sky-600 hover:text-white text-slate-700 dark:text-slate-200 transition-colors inline-flex items-center gap-1 whitespace-nowrap"
                        >
                          {copiedSymbol === row.symbol ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-400" />
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>Copy levels</span>
                            </>
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 5. FULL BENCH TABLE (Every bench symbol with pass/fail chip for T1-T5 and its fail label) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <div className="px-4 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Full Bench Evaluation ({activeResult.benchRows.length} symbols)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Every bench symbol evaluated through T1–T5. Failed rows are dimmed and show their exact fail label.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 text-[11px] text-slate-500 dark:text-slate-400 font-semibold">
                <th className="py-2.5 px-3">
                  <button
                    onClick={() => toggleSort('symbol')}
                    className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100"
                  >
                    <span>Symbol</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
                <th className="py-2.5 px-3">
                  <button
                    onClick={() => toggleSort('sector')}
                    className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100"
                  >
                    <span>Sector</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
                <th className="py-2.5 px-3 text-right">P</th>
                <th className="py-2.5 px-3 text-right">FH</th>
                <th className="py-2.5 px-3 text-right">RH</th>
                <th className="py-2.5 px-3 text-right">RL</th>
                <th className="py-2.5 px-3 text-right">FL</th>
                <th className="py-2.5 px-3 text-right">
                  <button
                    onClick={() => toggleSort('rangeInCandles')}
                    className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100"
                  >
                    <span>Candles</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
                <th className="py-2.5 px-3 text-center">T1–T5 Tests</th>
                <th className="py-2.5 px-3">
                  <button
                    onClick={() => toggleSort('status')}
                    className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100"
                  >
                    <span>Result / Fail Label</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
                <th className="py-2.5 px-3 text-right">
                  <button
                    onClick={() => toggleSort('score')}
                    className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100"
                  >
                    <span>Score</span>
                    <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
                <th className="py-2.5 px-3 text-center">Exclude: news</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800/70 font-mono">
              {sortedBenchRows.map((row) => {
                const lv = row.levels;
                const isFailed = !row.allTestsPassed;

                return (
                  <tr
                    key={row.symbol}
                    className={`transition-colors ${
                      isFailed
                        ? 'opacity-65 hover:opacity-95 bg-slate-50/30 dark:bg-slate-950/30'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <td className="py-2.5 px-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-bold text-slate-900 dark:text-slate-100">
                          {row.symbol}
                        </span>
                        <DataStatusChip instrument={row} />
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-sans text-slate-600 dark:text-slate-400">
                      {row.sectorName} ({row.sectorSymbol})
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums">
                      {row.premarketPrice !== null ? (
                        <div>
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            ${row.premarketPrice.toFixed(2)}
                          </div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400">
                            {row.premarketDateNY
                              ? `${row.premarketDateNY} `
                              : ''}
                            {row.premarketTimeNY
                              ? `${row.premarketTimeNY.slice(0, 5)} NY`
                              : 'No time'}
                          </div>
                          <div
                            className={`text-[10px] ${
                              row.premarketStatus === 'ok'
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-amber-600 dark:text-amber-400'
                            }`}
                          >
                            {formatPremarketSourceLabel(
                              row.premarketSourceWindow
                            )}
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div>—</div>
                          <div className="text-[10px] text-slate-400">
                            {formatPremarketSourceLabel(
                              row.premarketSourceWindow
                            )}
                          </div>
                        </div>
                      )}
                    </td>
                    <td
                      className="py-2.5 px-3 text-right tabular-nums"
                      title={
                        lv?.flipHighDate
                          ? `FH date: ${lv.flipHighDate}`
                          : 'No Flip High — sell side off'
                      }
                    >
                      {lv?.flipHigh !== null && lv?.flipHigh !== undefined
                        ? `$${lv.flipHigh.toFixed(2)}`
                        : 'No FH'}
                    </td>
                    <td
                      className="py-2.5 px-3 text-right tabular-nums"
                      title={lv?.rangeHighDate ? `RH date: ${lv.rangeHighDate}` : ''}
                    >
                      {lv ? `$${lv.rangeHigh.toFixed(2)}` : '—'}
                    </td>
                    <td
                      className="py-2.5 px-3 text-right tabular-nums"
                      title={lv?.rangeLowDate ? `RL date: ${lv.rangeLowDate}` : ''}
                    >
                      {lv ? `$${lv.rangeLow.toFixed(2)}` : '—'}
                    </td>
                    <td
                      className="py-2.5 px-3 text-right tabular-nums"
                      title={
                        lv?.flipLowDate
                          ? `FL date: ${lv.flipLowDate}`
                          : 'No Flip Low — buy side off'
                      }
                    >
                      {lv?.flipLow !== null && lv?.flipLow !== undefined
                        ? `$${lv.flipLow.toFixed(2)}`
                        : 'No FL'}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums">
                      {lv?.rangeInCandles !== null &&
                      lv?.rangeInCandles !== undefined
                        ? lv.rangeInCandles.toFixed(1)
                        : '—'}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center justify-center gap-1">
                        {(['T1', 'T2', 'T3', 'T4', 'T5'] as const).map((tid) => {
                          const t = row.tests[tid];
                          return (
                            <span
                              key={tid}
                              title={`${t.id} (${t.name}): ${
                                t.passed ? 'PASS' : t.failLabel
                              }`}
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                t.passed
                                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30'
                                  : 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/30'
                              }`}
                            >
                              {tid}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-sans">
                      {row.selectedInShortlist ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>
                            Shortlisted #{row.shortlistRank} ({row.passingSide})
                          </span>
                        </span>
                      ) : row.allTestsPassed && row.cappedBySectorOrMax ? (
                        <span className="text-amber-600 dark:text-amber-400 font-medium">
                          Passed (Capped: max 2/sector or top 8)
                        </span>
                      ) : (
                        <span className="text-rose-600 dark:text-rose-400 font-medium">
                          {row.firstFailLabel || 'Failed'}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums font-bold">
                      {row.score !== null ? row.score.toFixed(1) : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-center font-sans">
                      <input
                        type="checkbox"
                        checked={row.excludeNews}
                        onChange={() =>
                          handleToggleExcludeNews(row.symbol, row.excludeNews)
                        }
                        aria-label={`Exclude ${row.symbol} due to news`}
                        className="rounded border-slate-300 text-rose-600 focus:ring-rose-500 cursor-pointer"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 6. BENCH HEALTH PANEL (Section 4), collapsed by default, plus add/remove-symbol controls */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <button
          onClick={() => setShowBenchHealth(!showBenchHealth)}
          className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            {showBenchHealth ? (
              <ChevronDown className="w-4 h-4 text-slate-400" />
            ) : (
              <ChevronRight className="w-4 h-4 text-slate-400" />
            )}
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Bench Health Panel ({activeResult.benchRows.length} bench symbols)
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              — 60-day level respect rate, first-candle range, Wilder ATR%(14), and bench management
            </span>
          </div>
          <span className="text-xs font-mono text-sky-600 dark:text-sky-400">
            {showBenchHealth ? 'Hide' : 'Expand'}
          </span>
        </button>

        {showBenchHealth && (
          <div className="border-t border-slate-200 dark:border-slate-800 p-4 space-y-4">
            {/* Add Bench Symbol Form */}
            <form
              onSubmit={handleAddBenchSymbol}
              className="flex flex-wrap items-end gap-2.5 p-3 rounded-lg bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800"
            >
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Add Symbol to Bench
                </label>
                <input
                  type="text"
                  value={newBenchSymbol}
                  onChange={(e) =>
                    setNewBenchSymbol(e.target.value.toUpperCase())
                  }
                  placeholder="e.g. AAPL, TSLA"
                  className="px-2.5 py-1.5 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded text-slate-900 dark:text-slate-100 w-32"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Company Name (Optional)
                </label>
                <input
                  type="text"
                  value={newBenchName}
                  onChange={(e) => setNewBenchName(e.target.value)}
                  placeholder="e.g. Apple Inc."
                  className="px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded text-slate-900 dark:text-slate-100 w-44"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Sector
                </label>
                <select
                  value={newBenchSector}
                  onChange={(e) => setNewBenchSector(e.target.value)}
                  className="px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded text-slate-900 dark:text-slate-100"
                >
                  {GICS_SECTORS.map((s) => (
                    <option key={s.symbol} value={s.symbol}>
                      {s.sectorName} ({s.symbol})
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                disabled={addingBenchSymbol}
                className="px-3 py-1.5 text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white rounded transition-colors inline-flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{addingBenchSymbol ? 'Validating...' : 'Add to Bench'}</span>
              </button>
              {benchFormError && (
                <span className="text-xs text-rose-500 font-medium">
                  {benchFormError}
                </span>
              )}
            </form>

            {/* Bench Health Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 font-semibold">
                    <th className="py-2 px-3">Symbol</th>
                    <th className="py-2 px-3">Sector</th>
                    <th className="py-2 px-3 text-right">Avg Volume (20D)</th>
                    <th className="py-2 px-3 text-right">Price</th>
                    <th className="py-2 px-3 text-right">ATR% (14)</th>
                    <th className="py-2 px-3 text-right">Avg First Candle</th>
                    <th className="py-2 px-3 text-right">Level Touches (60D)</th>
                    <th className="py-2 px-3 text-right">Respect Rate</th>
                    <th className="py-2 px-3 text-right">Historical Setups (60D)</th>
                    <th className="py-2 px-3 text-right">Remove</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800/70 font-mono">
                  {activeResult.benchRows.map((row) => {
                    const h = row.health;
                    return (
                      <tr
                        key={row.symbol}
                        className={
                          h.flags.anyAmber
                            ? 'bg-amber-500/5 dark:bg-amber-500/10'
                            : ''
                        }
                      >
                        <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-slate-100">
                          {row.symbol}
                        </td>
                        <td className="py-2.5 px-3 font-sans text-slate-500 dark:text-slate-400">
                          {row.sectorName} ({row.sectorSymbol})
                        </td>
                        <td
                          className={`py-2.5 px-3 text-right tabular-nums ${
                            h.flags.lowVolume
                              ? 'text-amber-600 dark:text-amber-400 font-bold'
                              : ''
                          }`}
                        >
                          {h.avgVolume20D !== null
                            ? formatCompactNumber(h.avgVolume20D)
                            : '—'}
                        </td>
                        <td
                          className={`py-2.5 px-3 text-right tabular-nums ${
                            h.flags.lowPrice
                              ? 'text-amber-600 dark:text-amber-400 font-bold'
                              : ''
                          }`}
                        >
                          {h.price !== null ? `$${h.price.toFixed(2)}` : '—'}
                        </td>
                        <td
                          className={`py-2.5 px-3 text-right tabular-nums ${
                            h.flags.atrOutOfBounds
                              ? 'text-amber-600 dark:text-amber-400 font-bold'
                              : ''
                          }`}
                        >
                          {h.atrPct14 !== null
                            ? `${h.atrPct14.toFixed(2)}%`
                            : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums">
                          {h.firstCandleAvgDollar !== null &&
                          h.firstCandleAvgPct !== null
                            ? `$${h.firstCandleAvgDollar.toFixed(2)} (${h.firstCandleAvgPct.toFixed(
                                2
                              )}%)`
                            : '—'}
                        </td>
                        <td
                          className={`py-2.5 px-3 text-right tabular-nums ${
                            h.flags.lowTouches
                              ? 'text-amber-600 dark:text-amber-400 font-bold'
                              : ''
                          }`}
                        >
                          {h.levelTouches60D}
                        </td>
                        <td
                          className={`py-2.5 px-3 text-right tabular-nums ${
                            h.flags.lowRespectRate
                              ? 'text-amber-600 dark:text-amber-400 font-bold'
                              : 'text-emerald-600 dark:text-emerald-400 font-semibold'
                          }`}
                        >
                          {h.respectRate60D !== null
                            ? `${Math.round(h.respectRate60D * 100)}% (n=${
                                h.levelTouches60D
                              })`
                            : `— (n=0)`}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums">
                          {h.historicalSetups60D}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            onClick={() => handleRemoveBenchSymbol(row.symbol)}
                            title={`Remove ${row.symbol} from bench`}
                            className="p-1 text-slate-400 hover:text-rose-500 rounded"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* 7. DATA HEALTH PANEL (Per-feed fetch status, last fetch time and recent errors) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <button
          onClick={() => setShowDataHealth(!showDataHealth)}
          className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            {showDataHealth ? (
              <ChevronDown className="w-4 h-4 text-slate-400" />
            ) : (
              <ChevronRight className="w-4 h-4 text-slate-400" />
            )}
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Data Health Panel
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              — Per-feed fetch status, timestamps, and error log
            </span>
          </div>
          <span className="text-xs font-mono text-sky-600 dark:text-sky-400">
            {showDataHealth ? 'Hide' : 'Expand'}
          </span>
        </button>

        {showDataHealth && data?.dataHealth && (
          <div className="border-t border-slate-200 dark:border-slate-800 p-4 space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 font-mono">
              {(
                [
                  { id: 'daily_1y', label: 'Daily Bars (1Y)' },
                  { id: 'intraday_15m_60d', label: '15-Minute Bars (60D)' },
                  { id: 'premarket_5m_1d', label: 'Pre-Market 5m (1D)' },
                  { id: 'earnings_finnhub', label: 'Earnings (Finnhub)' },
                ] as { id: FeedType; label: string }[]
              ).map((f) => {
                const st = data.dataHealth.feeds[f.id];
                const isErr = st.failCount > 0 && st.okCount === 0;
                return (
                  <div
                    key={f.id}
                    className={`p-3 rounded-lg border ${
                      isErr
                        ? 'bg-rose-500/10 border-rose-500/30'
                        : 'bg-slate-50 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    <div className="font-sans font-semibold text-slate-900 dark:text-slate-100">
                      {f.label}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                      OK: <strong className="text-emerald-500">{st.okCount}</strong>{' '}
                      | Fail:{' '}
                      <strong className="text-rose-500">{st.failCount}</strong>
                    </div>
                    <div className="mt-0.5 text-[10px] text-slate-400 truncate">
                      Last: {st.lastFetchAt || 'Never'}
                    </div>
                    {st.lastError && (
                      <div
                        className="mt-1 text-[10px] text-rose-500 truncate"
                        title={st.lastError}
                      >
                        {st.lastError}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {data.dataHealth.recentErrors.length > 0 && (
              <div>
                <div className="font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Recent Feed Errors ({data.dataHealth.recentErrors.length})
                </div>
                <div className="max-h-40 overflow-y-auto rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-2 font-mono text-[11px] space-y-1">
                  {data.dataHealth.recentErrors.slice(0, 15).map((err, i) => (
                    <div
                      key={`${err.symbol}-${err.feed}-${i}`}
                      className="text-rose-600 dark:text-rose-400"
                    >
                      [{err.timestamp}] {err.symbol} ({err.feed}): {err.reason}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
