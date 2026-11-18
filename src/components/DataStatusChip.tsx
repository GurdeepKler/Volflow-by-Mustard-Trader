import React from 'react';
import { AlertCircle, AlertTriangle, ShieldCheck } from 'lucide-react';
import { MarketInstrument } from '../types/market';

interface DataStatusChipProps {
  instrument: Pick<MarketInstrument, 'dataStatus' | 'asOfSession' | 'errorReason'>;
  className?: string;
}

export const DataStatusChip: React.FC<DataStatusChipProps> = ({
  instrument,
  className = '',
}) => {
  if (instrument.dataStatus === 'ok') {
    return (
      <span
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/25 font-mono text-[10px] font-medium whitespace-nowrap ${className}`}
      >
        <ShieldCheck className="w-3 h-3 shrink-0" />
        <span>Live · {instrument.asOfSession || '—'}</span>
      </span>
    );
  }

  if (instrument.dataStatus === 'stale') {
    return (
      <span
        title={instrument.errorReason || 'Stale session data'}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/25 font-mono text-[10px] font-medium whitespace-nowrap ${className}`}
      >
        <AlertTriangle className="w-3 h-3 shrink-0" />
        <span>Stale · {instrument.asOfSession || '—'}</span>
      </span>
    );
  }

  return (
    <span
      title={instrument.errorReason || 'No market data available'}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-700 dark:text-rose-400 border border-rose-500/30 font-mono text-[10px] font-semibold whitespace-nowrap ${className}`}
    >
      <AlertCircle className="w-3 h-3 shrink-0" />
      <span>No data</span>
    </span>
  );
};
