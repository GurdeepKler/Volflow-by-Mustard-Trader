import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Download,
  Play,
  RefreshCw,
  Shield,
} from 'lucide-react';
import { exportSetupLogToCsv } from '../lib/silentFlip';
import {
  SetupLogEntry,
  SetupLogGroupSummary,
  SetupLogSummary,
  SilentFlipRules,
} from '../types/market';

interface SetupLogApiResponse {
  entries: SetupLogEntry[];
  summary: SetupLogSummary;
  rules: SilentFlipRules;
  availableSessions: string[];
}

function formatPrice(val: number | null | undefined): string {
  if (val === null || val === undefined || Number.isNaN(val)) return '—';
  return val.toFixed(2);
}

function formatR(val: number | null | undefined): string {
  if (val === null || val === undefined || Number.isNaN(val)) return '—';
  const sign = val > 0 ? '+' : '';
  return `${sign}${val.toFixed(2)}R`;
}

export const SilentFlipLogPanel: React.FC = () => {
  const [data, setData] = useState<SetupLogApiResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isGrading, setIsGrading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedSessionToGrade, setSelectedSessionToGrade] =
    useState<string>('');
  const [dateFilter, setDateFilter] = useState<string>('ALL');
  const [groupFilter, setGroupFilter] = useState<
    'ALL' | 'SHORTLISTED' | 'SETUPS_ONLY'
  >('ALL');

  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [draftTaken, setDraftTaken] = useState<string>('');
  const [draftActualEntry, setDraftActualEntry] = useState<string>('');
  const [draftActualExit, setDraftActualExit] = useState<string>('');
  const [draftActualR, setDraftActualR] = useState<string>('');
  const [draftNotes, setDraftNotes] = useState<string>('');
  const [savingRowId, setSavingRowId] = useState<string | null>(null);

  const loadLog = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/silent-flip/log');
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: Failed to load Silent Flip setup log`);
      }
      const json = (await res.json()) as SetupLogApiResponse;
      setData(json);
      if (json.availableSessions.length > 0 && !selectedSessionToGrade) {
        setSelectedSessionToGrade(json.availableSessions[0]);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to load Silent Flip setup log.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [selectedSessionToGrade]);

  useEffect(() => {
    loadLog();
  }, [loadLog]);

  const handleGradeSession = async (datesToGrade: string[], forceRefresh15m = false) => {
    if (isGrading || datesToGrade.length === 0) return;
    setIsGrading(true);
    setError(null);
    try {
      const res = await fetch('/api/silent-flip/log/grade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dates: datesToGrade,
          forceRefresh15m,
        }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: Failed to grade session`);
      }
      const json = (await res.json()) as SetupLogApiResponse;
      setData(json);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to run auto-grader.'
      );
    } finally {
      setIsGrading(false);
    }
  };

  const handleStartEditManual = (entry: SetupLogEntry) => {
    setEditingRowId(entry.id);
    setDraftTaken(
      entry.taken === true ? 'Y' : entry.taken === false ? 'N' : ''
    );
    setDraftActualEntry(
      entry.actualEntry !== null ? String(entry.actualEntry) : ''
    );
    setDraftActualExit(
      entry.actualExit !== null ? String(entry.actualExit) : ''
    );
    setDraftActualR(entry.actualR !== null ? String(entry.actualR) : '');
    setDraftNotes(entry.notes || '');
  };

  const handleSaveManual = async (entryId: string) => {
    setSavingRowId(entryId);
    try {
      const takenVal =
        draftTaken === 'Y' ? true : draftTaken === 'N' ? false : null;
      const res = await fetch('/api/silent-flip/log/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: entryId,
          taken: takenVal,
          actualEntry: draftActualEntry.trim() === '' ? null : Number(draftActualEntry),
          actualExit: draftActualExit.trim() === '' ? null : Number(draftActualExit),
          actualR: draftActualR.trim() === '' ? null : Number(draftActualR),
          notes: draftNotes.trim(),
        }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: Failed to save manual fields`);
      }
      const json = await res.json();
      setData((prev) =>
        prev
          ? {
              ...prev,
              entries: json.entries,
              summary: json.summary,
            }
          : prev
      );
      setEditingRowId(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to save manual trade fields.'
      );
    } finally {
      setSavingRowId(null);
    }
  };

  const handleExportCsv = () => {
    if (!data) return;
    const csvContent = exportSetupLogToCsv(data.entries);
    const todayIso = new Date().toISOString().slice(0, 10);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `silent-flip-setup-log-${todayIso}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const distinctLoggedDates = useMemo(() => {
    if (!data) return [];
    const set = new Set(data.entries.map((e) => e.date));
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [data]);

  const filteredEntries = useMemo(() => {
    if (!data) return [];
    return data.entries.filter((e) => {
      if (dateFilter !== 'ALL' && e.date !== dateFilter) return false;
      if (
        groupFilter === 'SHORTLISTED' &&
        !(e.shortlistSource === 'locked' && e.inShortlist)
      ) {
        return false;
      }
      if (
        groupFilter === 'SETUPS_ONLY' &&
        e.stageReached !== 'Trigger' &&
        e.stageReached !== 'Outcome'
      ) {
        return false;
      }
      return true;
    });
  }, [data, dateFilter, groupFilter]);

  const renderSummaryGroupCard = (group: SetupLogGroupSummary, isShortlisted: boolean) => (
    <div
      className={`p-4 rounded-lg border ${
        isShortlisted
          ? 'bg-sky-500/5 dark:bg-sky-950/30 border-sky-500/30'
          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <span
          className={`text-xs font-bold uppercase tracking-wider ${
            isShortlisted
              ? 'text-sky-700 dark:text-sky-300'
              : 'text-slate-600 dark:text-slate-400'
          }`}
        >
          {group.groupLabel} Symbols
        </span>
        <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
          {group.entriesCount} symbol-days graded
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
        <div className="p-2.5 rounded bg-white/80 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            Sessions graded
          </div>
          <div className="mt-1 font-mono text-sm font-bold text-slate-900 dark:text-slate-100">
            {group.sessionsGraded}
          </div>
        </div>

        <div className="p-2.5 rounded bg-white/80 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            C1 pass rate
          </div>
          <div className="mt-1 font-mono text-sm font-bold text-slate-900 dark:text-slate-100">
            {group.c1PassRatePct !== null
              ? `${group.c1PassRatePct.toFixed(0)}%`
              : '—'}{' '}
            <span className="text-[11px] font-normal text-slate-500">
              (n={group.c1PassCount}/{group.entriesCount})
            </span>
          </div>
        </div>

        <div className="p-2.5 rounded bg-white/80 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            Full-setup rate
          </div>
          <div className="mt-1 font-mono text-sm font-bold text-slate-900 dark:text-slate-100">
            {group.fullSetupRatePct !== null
              ? `${group.fullSetupRatePct.toFixed(0)}%`
              : '—'}{' '}
            <span className="text-[11px] font-normal text-slate-500">
              (n={group.fullSetupCount}/{group.entriesCount})
            </span>
          </div>
        </div>

        <div className="p-2.5 rounded bg-white/80 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            Triggered count
          </div>
          <div className="mt-1 font-mono text-sm font-bold text-emerald-600 dark:text-emerald-400">
            {group.triggeredCount}
          </div>
        </div>

        <div className="p-2.5 rounded bg-white/80 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            Mech. expectancy
          </div>
          <div
            className={`mt-1 font-mono text-sm font-bold ${
              group.expectancyR !== null && group.expectancyR > 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : group.expectancyR !== null && group.expectancyR < 0
                ? 'text-rose-600 dark:text-rose-400'
                : 'text-slate-900 dark:text-slate-100'
            }`}
          >
            {group.expectancyR !== null ? formatR(group.expectancyR) : '—'}{' '}
            <span className="text-[11px] font-normal text-slate-500">
              (n={group.expectancySampleN})
            </span>
          </div>
        </div>

        <div className="p-2.5 rounded bg-white/80 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            Avg actual R (taken)
          </div>
          <div
            className={`mt-1 font-mono text-sm font-bold ${
              group.avgActualR !== null && group.avgActualR > 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : group.avgActualR !== null && group.avgActualR < 0
                ? 'text-rose-600 dark:text-rose-400'
                : 'text-slate-900 dark:text-slate-100'
            }`}
          >
            {group.avgActualR !== null ? formatR(group.avgActualR) : '—'}{' '}
            <span className="text-[11px] font-normal text-slate-500">
              (n={group.actualTakenCount})
            </span>
          </div>
        </div>
      </div>
    </div>
  );

  if (isLoading && !data) {
    return (
      <div className="p-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-center text-xs text-slate-500">
        Loading Silent Flip setup log &amp; auto-grader...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Section 10 Default: Red warning that local container JSON store resets on restart + CSV export */}
      <div
        role="alert"
        className="px-4 py-3 rounded-lg bg-rose-600/15 dark:bg-rose-950/80 border border-rose-500/40 flex flex-wrap items-center justify-between gap-3 text-xs text-rose-700 dark:text-rose-200"
      >
        <div className="flex items-center gap-2 font-medium">
          <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
          <span>
            <strong>Durable storage notice:</strong> The local JSON store (
            <code className="font-mono">.volflow-store.json</code>) resets when
            the Cloud Run container restarts. Export CSV after grading or
            updating trades to keep your permanent record of truth.
          </span>
        </div>
        <button
          onClick={handleExportCsv}
          disabled={!data || data.entries.length === 0}
          className="px-3 py-1.5 text-xs font-semibold bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white rounded-md transition-colors inline-flex items-center gap-1.5 shrink-0"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export CSV ({data?.entries.length ?? 0} rows)</span>
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="px-4 py-2.5 rounded-lg bg-rose-500/15 border border-rose-500/30 text-xs text-rose-600 dark:text-rose-400"
        >
          {error}
        </div>
      )}

      {/* Summary Strip: Separate for Shortlisted and Not-Shortlisted */}
      {data && (
        <div className="grid grid-cols-1 gap-3">
          {renderSummaryGroupCard(data.summary.shortlisted, true)}
          {renderSummaryGroupCard(data.summary.notShortlisted, false)}
        </div>
      )}

      {/* Read-only SILENT_FLIP_RULES Parameter Bar (Section 8) */}
      {data && (
        <div className="px-4 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-200">
            <Shield className="w-4 h-4 text-sky-500" />
            <span>SILENT_FLIP_RULES (Read-Only)</span>
            <span className="px-2 py-0.5 rounded bg-sky-500/15 text-sky-700 dark:text-sky-300 font-mono text-[11px]">
              rulesVersion v{data.rules.rulesVersion}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-slate-600 dark:text-slate-300">
            <span>
              strongBodyPct: <strong>{data.rules.strongBodyPct.toFixed(2)}</strong>
            </span>
            <span>·</span>
            <span>
              strongRangeMult: <strong>{data.rules.strongRangeMult.toFixed(1)}×A</strong>
            </span>
            <span>·</span>
            <span>
              levelTolPct: <strong>{data.rules.levelTolPct}</strong> (
              {(data.rules.levelTolPct * 100).toFixed(2)}%)
            </span>
            <span>·</span>
            <span>
              breakRule: <strong>{data.rules.breakRule}</strong>
            </span>
            <span>·</span>
            <span>
              stopOffset: <strong>${data.rules.stopOffset.toFixed(2)}</strong>
            </span>
            <span>·</span>
            <span>
              targetMode: <strong>{data.rules.targetMode}</strong>
            </span>
            <span>·</span>
            <span>
              triggerCutoff: <strong>{data.rules.triggerCutoff} NY</strong>
            </span>
          </div>
        </div>
      )}

      {/* Auto-Grader Action & Filter Bar */}
      <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-slate-600 dark:text-slate-300 font-medium">
            Session to grade:
          </label>
          <select
            value={selectedSessionToGrade}
            onChange={(e) => setSelectedSessionToGrade(e.target.value)}
            className="px-2.5 py-1.5 font-mono text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-slate-100"
          >
            {(data?.availableSessions ?? []).map((sess) => (
              <option key={sess} value={sess}>
                {sess}
              </option>
            ))}
          </select>

          <button
            onClick={() =>
              selectedSessionToGrade &&
              handleGradeSession([selectedSessionToGrade], false)
            }
            disabled={isGrading || !selectedSessionToGrade}
            className="px-3 py-1.5 text-xs font-semibold bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white rounded-md transition-colors inline-flex items-center gap-1.5"
          >
            {isGrading ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            <span>{isGrading ? 'Grading...' : 'Grade / Re-grade Day'}</span>
          </button>

          <button
            onClick={() =>
              data &&
              data.availableSessions.length > 0 &&
              handleGradeSession(data.availableSessions.slice(0, 5), false)
            }
            disabled={isGrading || !data || data.availableSessions.length === 0}
            className="px-3 py-1.5 text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-md transition-colors"
          >
            Grade Last 5 Sessions
          </button>
        </div>

        {/* Table Filters + Export CSV */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            aria-label="Filter setup log by date"
            className="px-2.5 py-1.5 font-mono text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-slate-100"
          >
            <option value="ALL">All Dates ({distinctLoggedDates.length})</option>
            {distinctLoggedDates.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>

          <select
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value as any)}
            aria-label="Filter setup log by group"
            className="px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-slate-100"
          >
            <option value="ALL">All Bench Symbols</option>
            <option value="SHORTLISTED">Shortlisted Only</option>
            <option value="SETUPS_ONLY">Full Setups (C1+C2 Passed)</option>
          </select>

          <button
            onClick={handleExportCsv}
            disabled={!data || data.entries.length === 0}
            className="px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-md transition-colors inline-flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Setup Log Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
          <div className="font-semibold text-slate-900 dark:text-slate-100">
            Silent Flip Setup &amp; Outcome Log ({filteredEntries.length} rows)
          </div>
          <div className="text-slate-500 dark:text-slate-400">
            Click &ldquo;Edit trade&rdquo; on any row to record Taken Y/N, Actual Entry/Exit/R, and Notes
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 text-[11px] text-slate-500 dark:text-slate-400">
                <th className="py-2.5 px-3">Date</th>
                <th className="py-2.5 px-3">Symbol / Sector</th>
                <th className="py-2.5 px-3">Shortlist</th>
                <th className="py-2.5 px-3">Side</th>
                <th className="py-2.5 px-3 text-right">FH / RH / RL / FL (A)</th>
                <th className="py-2.5 px-3">Stage &amp; Label</th>
                <th className="py-2.5 px-3 text-right">Entry / Stop / Target</th>
                <th className="py-2.5 px-3 text-right">Plan R</th>
                <th className="py-2.5 px-3 text-right">Mech R (MFE)</th>
                <th className="py-2.5 px-3">Ver</th>
                <th className="py-2.5 px-3">Trader Actual (Taken / Entry / Exit / R / Note)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/60 dark:divide-slate-800/60">
              {filteredEntries.map((entry) => {
                const isEditing = editingRowId === entry.id;
                const isTriggered = entry.stageReached === 'Outcome';
                const isFullSetup =
                  entry.stageReached === 'Trigger' ||
                  entry.stageReached === 'Outcome';

                return (
                  <tr
                    key={entry.id}
                    className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/40 ${
                      isTriggered
                        ? 'bg-emerald-500/5 dark:bg-emerald-950/20'
                        : entry.inShortlist
                        ? 'bg-sky-500/5 dark:bg-sky-950/15'
                        : ''
                    }`}
                  >
                    <td className="py-2.5 px-3 font-mono whitespace-nowrap text-slate-700 dark:text-slate-300">
                      {entry.date}
                    </td>

                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <div className="font-mono font-bold text-slate-900 dark:text-slate-100">
                        {entry.symbol}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {entry.sector} ({entry.sectorSymbol})
                      </div>
                    </td>

                    <td className="py-2.5 px-3 whitespace-nowrap font-mono">
                      {entry.shortlistSource === 'locked' && entry.inShortlist ? (
                        <span className="px-2 py-0.5 rounded bg-sky-500/15 text-sky-700 dark:text-sky-300 font-semibold text-[11px]">
                          Locked #{entry.shortlistRank ?? '—'} ·{' '}
                          {entry.shortlistScore !== null
                            ? entry.shortlistScore.toFixed(1)
                            : '—'}
                        </span>
                      ) : entry.shortlistSource === 'locked' ? (
                        <span className="text-slate-500 dark:text-slate-400 text-[11px]">
                          Locked (Bench)
                        </span>
                      ) : (
                        <span className="text-slate-400 dark:text-slate-500 text-[11px]">
                          No lock
                        </span>
                      )}
                    </td>

                    <td className="py-2.5 px-3 whitespace-nowrap font-mono">
                      {entry.side ? (
                        <span
                          className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${
                            entry.side === 'SELL'
                              ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                              : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                          }`}
                        >
                          {entry.side}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>

                    <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap text-[11px] text-slate-600 dark:text-slate-300">
                      <div>
                        FH {formatPrice(entry.fh)} | RH {formatPrice(entry.rh)}
                      </div>
                      <div>
                        RL {formatPrice(entry.rl)} | FL {formatPrice(entry.fl)}{' '}
                        <span className="text-slate-400">
                          (A={formatPrice(entry.firstCandleAvg)})
                        </span>
                      </div>
                    </td>

                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-bold ${
                            isTriggered
                              ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                              : isFullSetup
                              ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                              : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          {entry.stageReached}
                        </span>
                        {entry.touchedLevel && (
                          <span className="font-mono text-[11px] text-sky-600 dark:text-sky-400 font-semibold">
                            @{entry.touchedLevel}
                          </span>
                        )}
                      </div>
                      <div
                        className={`mt-0.5 text-[11px] font-medium ${
                          entry.failLabel === 'Target hit'
                            ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                            : entry.failLabel === 'Stop hit'
                            ? 'text-rose-600 dark:text-rose-400 font-semibold'
                            : 'text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {entry.failLabel ?? '—'}
                      </div>
                    </td>

                    <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap text-[11px]">
                      {entry.entry !== null ? (
                        <>
                          <div>
                            E: <strong>{formatPrice(entry.entry)}</strong> / S:{' '}
                            <span className="text-rose-600 dark:text-rose-400">
                              {formatPrice(entry.stop)}
                            </span>
                          </div>
                          <div>
                            T:{' '}
                            <span className="text-emerald-600 dark:text-emerald-400">
                              {formatPrice(entry.target)}
                            </span>
                          </div>
                        </>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>

                    <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                      {entry.plannedR !== null ? `${entry.plannedR.toFixed(2)}R` : '—'}
                    </td>

                    <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                      {entry.mechanicalResultR !== null ? (
                        <div>
                          <span
                            className={`font-bold ${
                              entry.mechanicalResultR > 0
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : entry.mechanicalResultR < 0
                                ? 'text-rose-600 dark:text-rose-400'
                                : 'text-slate-700 dark:text-slate-200'
                            }`}
                          >
                            {formatR(entry.mechanicalResultR)}
                          </span>
                          {entry.mfeR !== null && (
                            <div className="text-[10px] text-slate-400">
                              MFE: +{entry.mfeR.toFixed(2)}R
                            </div>
                          )}
                        </div>
                      ) : entry.mfeR !== null ? (
                        <span className="text-[11px] text-amber-600 dark:text-amber-400">
                          Ambig (MFE +{entry.mfeR.toFixed(2)}R)
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>

                    <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500">
                      v{entry.rulesVersion}
                    </td>

                    <td className="py-2.5 px-3 min-w-[260px]">
                      {isEditing ? (
                        <div className="space-y-1.5 bg-slate-50 dark:bg-slate-950 p-2 rounded border border-slate-200 dark:border-slate-800">
                          <div className="grid grid-cols-4 gap-1.5">
                            <select
                              value={draftTaken}
                              onChange={(e) => setDraftTaken(e.target.value)}
                              className="px-1.5 py-1 text-[11px] font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded"
                            >
                              <option value="">Taken?</option>
                              <option value="Y">Taken: Y</option>
                              <option value="N">Taken: N</option>
                            </select>
                            <input
                              type="number"
                              step="0.01"
                              placeholder="Entry $"
                              value={draftActualEntry}
                              onChange={(e) => setDraftActualEntry(e.target.value)}
                              className="px-1.5 py-1 text-[11px] font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded"
                            />
                            <input
                              type="number"
                              step="0.01"
                              placeholder="Exit $"
                              value={draftActualExit}
                              onChange={(e) => setDraftActualExit(e.target.value)}
                              className="px-1.5 py-1 text-[11px] font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded"
                            />
                            <input
                              type="number"
                              step="0.01"
                              placeholder="Actual R"
                              value={draftActualR}
                              onChange={(e) => setDraftActualR(e.target.value)}
                              className="px-1.5 py-1 text-[11px] font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded"
                            />
                          </div>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              placeholder="Trader note..."
                              value={draftNotes}
                              onChange={(e) => setDraftNotes(e.target.value)}
                              className="flex-1 px-2 py-1 text-[11px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded"
                            />
                            <button
                              onClick={() => handleSaveManual(entry.id)}
                              disabled={savingRowId === entry.id}
                              className="px-2.5 py-1 text-[11px] font-semibold bg-sky-600 hover:bg-sky-500 text-white rounded inline-flex items-center gap-1"
                            >
                              <Check className="w-3 h-3" />
                              <span>Save</span>
                            </button>
                            <button
                              onClick={() => setEditingRowId(null)}
                              className="px-2 py-1 text-[11px] text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[11px] space-y-0.5">
                            <div className="font-mono">
                              {entry.taken === true ? (
                                <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                                  Taken: Y
                                </span>
                              ) : entry.taken === false ? (
                                <span className="text-slate-500">Taken: N</span>
                              ) : (
                                <span className="text-slate-400">Taken: —</span>
                              )}
                              {entry.actualEntry !== null && (
                                <span className="ml-2">
                                  E: ${entry.actualEntry.toFixed(2)}
                                </span>
                              )}
                              {entry.actualExit !== null && (
                                <span className="ml-1.5">
                                  X: ${entry.actualExit.toFixed(2)}
                                </span>
                              )}
                              {entry.actualR !== null && (
                                <span
                                  className={`ml-2 font-bold ${
                                    entry.actualR >= 0
                                      ? 'text-emerald-600 dark:text-emerald-400'
                                      : 'text-rose-600 dark:text-rose-400'
                                  }`}
                                >
                                  ({formatR(entry.actualR)})
                                </span>
                              )}
                            </div>
                            {entry.notes && (
                              <div className="text-slate-600 dark:text-slate-300 truncate max-w-xs">
                                &ldquo;{entry.notes}&rdquo;
                              </div>
                            )}
                          </div>
                          <button
                            onClick={() => handleStartEditManual(entry)}
                            className="px-2 py-1 text-[11px] font-medium text-sky-600 dark:text-sky-400 hover:bg-sky-500/10 rounded transition-colors shrink-0"
                          >
                            Edit trade
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
