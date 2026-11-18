export type TimeframeWindow = '1D' | '5D' | '20D' | '60D';
export type BaselinePeriod = '90D' | '252D';

export type DataStatus = 'ok' | 'stale' | 'unavailable';

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
  date: string; // YYYY-MM-DD in America/New_York
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
  isHalfDay?: boolean;
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
  buyingVolumePct20D: number; // 0 to 100
  sellingVolumePct20D: number; // 0 to 100
  dollarVolume1D: number;
  avgDollarVolume20D: number;
  netDollarFlow20D: number;
  regime: PriceVolumeRegime;
  directionBias: VolumeDirectionBias;
  directionalSummary: string;
  expectedMoveText: string;
  regimeRationale: string;
}

export interface MarketInstrument {
  symbol: string;
  name: string;
  isSectorETF: boolean;
  sectorSymbol: string; // e.g., 'XLK'
  sectorName: string; // e.g., 'Technology'
  industry: string;
  dataStatus: DataStatus;
  asOfSession: string | null; // Last completed session YYYY-MM-DD in America/New_York
  fetchedAt: string; // ISO timestamp
  errorReason?: string;
  exchangeName?: string; // e.g. 'NMS', 'NYQ'
  price: number | null; // Last completed daily close (null if unavailable)
  lastPrice: number | null; // Live or pre-market price (separate from completed daily close)
  change1DPct: number | null;
  change5DPct: number | null;
  change20DPct: number | null;
  change60DPct: number | null;
  lastUpdated: string | null; // Same as asOfSession
  lastUpdatedTime: string | null; // e.g. "16:00 EST"
  metricsByBaseline: {
    '90D': MultiTimeframeMetrics;
    '252D': MultiTimeframeMetrics;
  } | null;
  history: DailyBar[];
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

// Section 3 Data Feed Types
export type FeedType = 'daily_1y' | 'intraday_15m_60d' | 'premarket_5m_1d' | 'earnings_finnhub';

export interface FeedFetchError {
  symbol: string;
  feed: FeedType;
  httpStatus: number | null;
  reason: string;
  timestamp: string; // ISO
}

export interface Intraday15mBar {
  timestamp: number; // Unix seconds
  nyDate: string; // YYYY-MM-DD in America/New_York
  nyTime: string; // HH:mm:ss in America/New_York
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IntradaySession15m {
  sessionDate: string; // YYYY-MM-DD in America/New_York
  isHalfDay: boolean;
  firstCandle: Intraday15mBar | null; // Must be 09:30:00 New York bar, or null if missing
  bars: Intraday15mBar[];
}

export interface Intraday15mFeedResult {
  symbol: string;
  dataStatus: DataStatus;
  fetchedAt: string;
  asOfSession: string | null;
  errorReason?: string;
  sessions: IntradaySession15m[];
}

export interface PreMarketQuoteResult {
  symbol: string;
  dataStatus: DataStatus;
  fetchedAt: string;
  nyDate: string | null;
  nyTime: string | null; // HH:mm:ss of latest bar between 04:00 and 09:30 NY
  price: number | null;
  volume: number | null;
  sourceWindow: 'premarket_0400_0930' | 'regular_or_post' | 'none';
  errorReason?: string;
}

export interface EarningsEvent {
  symbol: string;
  date: string; // YYYY-MM-DD
  hour: 'bmo' | 'amc' | 'dmh' | string; // before market open, after market close, during market hours
  epsEstimate?: number | null;
  epsActual?: number | null;
}

export interface EarningsFeedResult {
  symbol: string;
  dataStatus: DataStatus;
  fetchedAt: string;
  providerConfigured: boolean;
  events: EarningsEvent[];
  errorReason?: string;
}

// ==========================================
// Phase 2 (Sections 4–7): Silent Flip Types
// ==========================================

export interface SilentFlipBenchItem {
  symbol: string;
  name: string;
  sectorSymbol: string; // One of GICS_SECTORS ETF symbols (e.g. 'XLK')
  sectorName: string;
}

export interface ComputedLevels {
  asOfSession: string; // D-1 date (YYYY-MM-DD)
  dMinus1Close: number;
  isHalfDaySession: boolean;
  rangeHigh: number; // RH: high of D-1
  rangeHighDate: string; // D-1 date
  rangeLow: number; // RL: low of D-1
  rangeLowDate: string; // D-1 date
  flipHigh: number | null; // FH: nearest earlier high > RH * 1.0005 within 120 sessions
  flipHighDate: string | null;
  flipLow: number | null; // FL: nearest earlier low < RL * 0.9995 within 120 sessions
  flipLowDate: string | null;
  rangeWidth: number; // RH - RL in $
  rangeWidthPct: number; // (RH - RL) / dMinus1Close * 100
  sellZoneWidth: number | null; // FH - RH (null if FH null)
  buyZoneWidth: number | null; // RL - FL (null if FL null)
  firstCandleAvg: number | null; // A: mean 09:30 15m candle range over last 60 sessions
  rangeInCandles: number | null; // rangeWidth / firstCandleAvg
}

export interface BenchHealthMetrics {
  symbol: string;
  avgVolume20D: number | null; // Flag amber when < 5,000,000
  price: number | null; // Last completed close; flag amber when < $15
  atr14: number | null; // Wilder ATR(14) in $
  atrPct14: number | null; // Wilder ATR(14) / close * 100; flag amber when < 1.5% or > 4.0%
  firstCandleAvgDollar: number | null; // Mean range (high-low) of 09:30 15m candle, last 60 sessions
  firstCandleAvgPct: number | null; // firstCandleAvgDollar / price * 100
  firstCandleSampleSize: number; // Count of valid 09:30 candles in last 60 sessions
  levelTouches60D: number; // Sessions where first 4 15m candles (09:30-10:30) reached prior day's high or low within 0.05%
  levelRespCount60D: number; // Of those touches, count where no first-hour candle closed beyond touched level by > 0.05%
  respectRate60D: number | null; // 0..1 share (null if 0 touches); flag amber when < 0.50
  highSideTouches60D: number; // High-side (SELL) touches in 60D
  highSideRespCount60D: number;
  highSideRespectRate60D: number | null; // 0..1
  lowSideTouches60D: number; // Low-side (BUY) touches in 60D
  lowSideRespCount60D: number;
  lowSideRespectRate60D: number | null; // 0..1
  historicalSetups60D: number; // Count of full 3-candle patterns found in 60D history
  flags: {
    lowVolume: boolean;
    lowPrice: boolean;
    atrOutOfBounds: boolean;
    lowTouches: boolean;
    lowRespectRate: boolean;
    anyAmber: boolean;
  };
}

export type ShortlistSide = 'SELL' | 'BUY' | 'BOTH';
export type WinningSide = 'SELL' | 'BUY';

export interface SingleTestResult {
  id: 'T1' | 'T2' | 'T3' | 'T4' | 'T5';
  name: string;
  passed: boolean;
  failLabel: string | null;
}

export interface SideScoreDetail {
  side: WinningSide;
  nearestLevel: number;
  nearestLevelName: 'RH' | 'FH' | 'RL' | 'FL';
  distanceDollar: number; // d: 0 if P is inside [RH, FH] or [FL, RL], else distance to nearest level
  distanceInA: number; // d / A
  reachScore: number; // 0..40
  respectRateUsed: number; // 0..1 (uses 0.50 if side sample n < 5)
  respectSampleN: number;
  respectRateRaw: number | null;
  respectScore: number; // 0..40
  roomScore: number; // 0..20
  totalScore: number; // 0..100
}

export interface ShortlistCandidateRow {
  symbol: string;
  name: string;
  sectorSymbol: string;
  sectorName: string;
  exchangeName?: string;
  tradingViewPrefix: 'NASDAQ' | 'NYSE' | 'AMEX' | null;
  tradingViewError?: string;
  dataStatus: DataStatus;
  asOfSession: string | null;
  isHalfDay: boolean;
  levels: ComputedLevels | null;
  health: BenchHealthMetrics;
  premarketPrice: number | null; // P
  premarketTimeNY: string | null;
  premarketSourceWindow: PreMarketQuoteResult['sourceWindow'];
  gapPctFromClose: number | null; // (P - dMinus1Close) / dMinus1Close * 100
  earningsStatusLabel: string; // e.g., "Clear", "Earnings 2026-11-18 (amc)", "Verify manually"
  earningsUnavailable: boolean;
  excludeNews: boolean;
  tests: {
    T1: SingleTestResult;
    T2: SingleTestResult;
    T3: SingleTestResult;
    T4: SingleTestResult;
    T5: SingleTestResult;
  };
  allTestsPassed: boolean;
  firstFailLabel: string | null;
  passingSide: ShortlistSide | null; // 'SELL' | 'BUY' | 'BOTH' if T5 passed
  winningSide: WinningSide | null; // Side with higher score ('SELL' or 'BUY')
  scoreDetail: SideScoreDetail | null;
  score: number | null; // 0..100 (rounded to 1 decimal or integer)
  selectedInShortlist: boolean;
  shortlistRank: number | null; // 1..8 if selected
  cappedBySectorOrMax: boolean; // True if passed all T1-T5 but excluded due to 2/sector or top-8 cap
}

export interface ShortlistOverrides {
  excludeNewsBySymbol: Record<string, boolean>;
  usDataRelease0830: boolean;
}

export interface ShortlistBuildResult {
  sessionBeingPrepared: string; // YYYY-MM-DD (next trading session after D-1)
  asOfCompletedSession: string | null; // D-1
  generatedAt: string; // ISO
  shortlist: ShortlistCandidateRow[]; // 0..8 ranked winners
  benchRows: ShortlistCandidateRow[]; // All bench rows with T1-T5 results
  survivorCount: number;
  onlyNCandidatesNote: string | null; // "Only [n] candidates today" when < 5 selected
  directionBalanceHint: string | null; // "Shortlist leans [SELL/BUY]: a strong market move could fail them together." when >= 6 share one side
  earningsBanner: string | null; // "Earnings check unavailable — verify manually"
  yahooFailureBanner: string | null; // Red banner if > 20% of bench fetches fail
  dataDayBanner: string | null; // "Data day: consider half size"
}

export interface LockedShortlistRecord {
  sessionDate: string; // Session being prepared YYYY-MM-DD
  lockedAtIso: string;
  lockedAtUkTime: string; // e.g. "14:16 UK"
  lockedAtNyTime: string; // e.g. "09:16 NY"
  result: ShortlistBuildResult;
}

// ==========================================
// Phase 3 (Section 8): Setup Log & Auto-Grader
// ==========================================

export interface SilentFlipRules {
  rulesVersion: number;
  strongBodyPct: number; // Default 0.60: Candle 1 body / range >= this
  strongRangeMult: number; // Default 1.0: Candle 1 range >= this * A
  levelTolPct: number; // Default 0.0005: Touch / break tolerance as fraction of price
  breakRule: 'close' | 'wick'; // Default 'close': Candle 2 fails if it closes beyond tested level ('wick': any trade beyond it)
  stopOffset: number; // Default 0.02: $ added beyond Silent Candle's extreme for the stop
  targetMode: 'range' | 'flip'; // Default 'range': SELL targets RL, BUY targets RH ('flip': FL / FH)
  triggerCutoff: string; // Default '10:45': New York cut-off where pending entries expire
}

export type SetupLogStage = 'C1' | 'C2' | 'Trigger' | 'Outcome';

export interface SetupLogEntry {
  id: string; // Deterministic "${date}::${symbol}"
  // Identity
  date: string; // YYYY-MM-DD session date
  symbol: string;
  sectorSymbol: string;
  sector: string;
  inShortlist: boolean;
  shortlistRank: number | null;
  shortlistScore: number | null;
  side: WinningSide | null; // 'SELL' | 'BUY' | null
  // Levels
  fh: number | null;
  rh: number | null;
  rl: number | null;
  fl: number | null;
  firstCandleAvg: number | null; // A
  // Grading
  stageReached: SetupLogStage;
  touchedLevel: 'RH' | 'FH' | 'RL' | 'FL' | null;
  failLabel: string | null; // e.g. "C1 weak", "C1 no level", "C2 same colour", "C2 broke level", "Invalidated", "Triggered", "Ambiguous: check 1-minute", "Expired", "Target hit", "Stop hit", "Ambiguous", "Close exit", "Pending 10:45 NY", "No data"
  entry: number | null;
  stop: number | null;
  target: number | null;
  plannedR: number | null;
  // Outcome
  mechanicalResultR: number | null;
  mfeR: number | null;
  rulesVersion: number;
  // Manual fields (trader fills these)
  taken: boolean | null;
  actualEntry: number | null;
  actualExit: number | null;
  actualR: number | null;
  notes: string;
}

export interface SetupLogGroupSummary {
  groupLabel: 'Shortlisted' | 'Not shortlisted';
  entriesCount: number; // Symbol-session rows graded
  sessionsGraded: number; // Distinct session dates graded
  c1PassCount: number;
  c1PassRatePct: number | null; // 0..100
  fullSetupCount: number; // Reached Trigger or Outcome (C1 + C2 passed)
  fullSetupRatePct: number | null; // 0..100
  triggeredCount: number; // Reached Outcome (entry triggered by 10:45 cut-off)
  expectancyR: number | null; // Mean mechanicalResultR over triggered entries with numeric R
  expectancySampleN: number;
  avgActualR: number | null; // Mean actualR on trades taken (taken === true && actualR !== null)
  actualTakenCount: number;
}

export interface SetupLogSummary {
  shortlisted: SetupLogGroupSummary;
  notShortlisted: SetupLogGroupSummary;
}

