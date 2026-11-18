export type TimeframeWindow = '1D' | '5D' | '20D' | '60D';
export type BaselinePeriod = '90D' | '252D';

export type PriceVolumeRegime =
  | 'Breakout Expansion'
  | 'Stealth Accumulation'
  | 'Institutional Accumulation'
  | 'High-Volume Churn'
  | 'Distribution Pressure'
  | 'Quiet Pullback'
  | 'Low-Volume Consolidation'
  | 'Neutral Flow';

export type VolumeDirectionBias =
  | 'UPSIDE_BREAKOUT'
  | 'UPSIDE_ACCUMULATION'
  | 'DOWNSIDE_DISTRIBUTION'
  | 'TWO_WAY_CHURN'
  | 'BULLISH_LOW_VOL_PULLBACK'
  | 'NEUTRAL';

export interface DailyBar {
  date: string; // YYYY-MM-DD
  sessionCloseTime: string; // e.g., "16:00 EST"
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  dollarVolume: number;
  changePct: number;
  isAccumulation: boolean;
  isDistribution: boolean;
  aboveBaseline90: boolean;
  aboveBaseline252: boolean;
  rvol90: number;
  rvol252: number;
  ma20Volume: number;
  ma90Volume: number;
}

export interface MultiTimeframeMetrics {
  rvol1D: number;
  rvol5D: number;
  rvol20D: number;
  rvol60D: number;
  avgVol1D: number;
  avgVol5D: number;
  avgVol20D: number;
  avgVol60D: number;
  baselineVol: number;
  volumeAcceleration: number; // 5D RVOL / 20D RVOL
  consistencyScore: number; // 0 to 100
  daysAboveBaseline20D: number; // out of 20
  daysAboveBaseline60D: number; // out of 60
  weeksAboveBaseline12W: number; // out of 12 weeks
  consecutiveAboveDays: number; // current streak of days > baseline
  accumulationDays20D: number;
  distributionDays20D: number;
  netAccDist20D: number; // accDays - distDays
  buyingVolumePct20D: number; // 0 to 100 (% of 20D volume on up days/buying pressure)
  sellingVolumePct20D: number; // 0 to 100 (% of 20D volume on down days/selling pressure)
  dollarVolume1D: number;
  avgDollarVolume20D: number;
  netDollarFlow20D: number; // signed institutional flow over 20D
  regime: PriceVolumeRegime;
  directionBias: VolumeDirectionBias;
  directionalSummary: string; // Short explicit label e.g. "▲ UPSIDE BREAKOUT (Bullish Vol)"
  expectedMoveText: string; // Plain English explanation of whether volume favors upside or downside
  regimeRationale: string;
}

export interface MarketInstrument {
  symbol: string;
  name: string;
  isSectorETF: boolean;
  sectorSymbol: string; // e.g., 'XLK'
  sectorName: string; // e.g., 'Technology'
  industry: string;
  price: number;
  change1DPct: number;
  change5DPct: number;
  change20DPct: number;
  change60DPct: number;
  dataSource: 'live' | 'calibrated';
  lastUpdated: string; // Market session date YYYY-MM-DD
  lastUpdatedTime: string; // e.g. "16:00 EST"
  metricsByBaseline: {
    '90D': MultiTimeframeMetrics;
    '252D': MultiTimeframeMetrics;
  };
  history: DailyBar[]; // Last 252 trading days for full 1Y expandable charting & coordinate inspection
  weeklyRvolSeries: {
    weekLabel: string;
    avgVol: number;
    rvol90: number;
    rvol252: number;
    returnPct: number;
  }[];
}

export interface CheckpointSnapshot {
  id: string;
  timestamp: string;
  dateLabel: string;
  cadence: 'Daily' | 'Weekly' | 'Monthly';
  title: string;
  notes: string;
  tags: string[];
  baselineUsed: BaselinePeriod;
  timeframeUsed: TimeframeWindow;
  topSectors: {
    symbol: string;
    name: string;
    rvol5D: number;
    rvol20D: number;
    consistencyScore: number;
    regime: PriceVolumeRegime;
    change5DPct: number;
  }[];
  topStocks: {
    symbol: string;
    name: string;
    sectorSymbol: string;
    price: number;
    rvol1D: number;
    rvol5D: number;
    rvol20D: number;
    consistencyScore: number;
    daysAboveBaseline20D: number;
    regime: PriceVolumeRegime;
  }[];
}

export interface VolumeAlertRule {
  id: string;
  name: string;
  scope: 'ALL' | 'SECTORS' | 'STOCKS' | string;
  timeframe: TimeframeWindow;
  baseline: BaselinePeriod;
  minRvol: number;
  minConsistency: number;
  minConsecutiveDays: number;
  regimeFilter: 'ANY' | PriceVolumeRegime;
  enabled: boolean;
  createdAt: string;
}

export interface TriggeredAlert {
  ruleId: string;
  ruleName: string;
  instrument: MarketInstrument;
  rvolValue: number;
  consistencyScore: number;
  consecutiveDays: number;
  regime: PriceVolumeRegime;
  directionBias: VolumeDirectionBias;
  directionalSummary: string;
}
