import {
  BaselinePeriod,
  DailyBar,
  DataStatus,
  MarketInstrument,
  MultiTimeframeMetrics,
  PriceVolumeRegime,
  TimeframeWindow,
  VolumeDirectionBias,
} from '../types/market';

export interface RawOHLCV {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isHalfDay?: boolean;
}

export interface InstrumentSeed {
  symbol: string;
  name: string;
  isSectorETF: boolean;
  sectorSymbol: string;
  sectorName: string;
  industry: string;
}

export const GICS_SECTORS: InstrumentSeed[] = [
  {
    symbol: 'XLK',
    name: 'Technology Sector ETF',
    isSectorETF: true,
    sectorSymbol: 'XLK',
    sectorName: 'Technology',
    industry: 'Market Sector ETF',
  },
  {
    symbol: 'XLE',
    name: 'Energy Sector ETF',
    isSectorETF: true,
    sectorSymbol: 'XLE',
    sectorName: 'Energy',
    industry: 'Market Sector ETF',
  },
  {
    symbol: 'XLF',
    name: 'Financials Sector ETF',
    isSectorETF: true,
    sectorSymbol: 'XLF',
    sectorName: 'Financials',
    industry: 'Market Sector ETF',
  },
  {
    symbol: 'XLI',
    name: 'Industrials Sector ETF',
    isSectorETF: true,
    sectorSymbol: 'XLI',
    sectorName: 'Industrials',
    industry: 'Market Sector ETF',
  },
  {
    symbol: 'XLC',
    name: 'Communication Services ETF',
    isSectorETF: true,
    sectorSymbol: 'XLC',
    sectorName: 'Comm Services',
    industry: 'Market Sector ETF',
  },
  {
    symbol: 'XLV',
    name: 'Health Care Sector ETF',
    isSectorETF: true,
    sectorSymbol: 'XLV',
    sectorName: 'Health Care',
    industry: 'Market Sector ETF',
  },
  {
    symbol: 'XLY',
    name: 'Consumer Discretionary ETF',
    isSectorETF: true,
    sectorSymbol: 'XLY',
    sectorName: 'Cons Discretionary',
    industry: 'Market Sector ETF',
  },
  {
    symbol: 'XLU',
    name: 'Utilities Sector ETF',
    isSectorETF: true,
    sectorSymbol: 'XLU',
    sectorName: 'Utilities',
    industry: 'Market Sector ETF',
  },
  {
    symbol: 'XLB',
    name: 'Materials Sector ETF',
    isSectorETF: true,
    sectorSymbol: 'XLB',
    sectorName: 'Materials',
    industry: 'Market Sector ETF',
  },
  {
    symbol: 'XLP',
    name: 'Consumer Staples ETF',
    isSectorETF: true,
    sectorSymbol: 'XLP',
    sectorName: 'Cons Staples',
    industry: 'Market Sector ETF',
  },
  {
    symbol: 'XLRE',
    name: 'Real Estate Sector ETF',
    isSectorETF: true,
    sectorSymbol: 'XLRE',
    sectorName: 'Real Estate',
    industry: 'Market Sector ETF',
  },
];

export const CORE_EQUITIES: InstrumentSeed[] = [
  // Technology (XLK)
  {
    symbol: 'NVDA',
    name: 'NVIDIA Corporation',
    isSectorETF: false,
    sectorSymbol: 'XLK',
    sectorName: 'Technology',
    industry: 'Semiconductors',
  },
  {
    symbol: 'AVGO',
    name: 'Broadcom Inc.',
    isSectorETF: false,
    sectorSymbol: 'XLK',
    sectorName: 'Technology',
    industry: 'Semiconductors',
  },
  {
    symbol: 'AMD',
    name: 'Advanced Micro Devices',
    isSectorETF: false,
    sectorSymbol: 'XLK',
    sectorName: 'Technology',
    industry: 'Semiconductors',
  },
  {
    symbol: 'ANET',
    name: 'Arista Networks Inc.',
    isSectorETF: false,
    sectorSymbol: 'XLK',
    sectorName: 'Technology',
    industry: 'Cloud Networking',
  },
  {
    symbol: 'PLTR',
    name: 'Palantir Technologies',
    isSectorETF: false,
    sectorSymbol: 'XLK',
    sectorName: 'Technology',
    industry: 'Enterprise AI Software',
  },
  {
    symbol: 'MSFT',
    name: 'Microsoft Corporation',
    isSectorETF: false,
    sectorSymbol: 'XLK',
    sectorName: 'Technology',
    industry: 'Cloud & Software',
  },
  {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    isSectorETF: false,
    sectorSymbol: 'XLK',
    sectorName: 'Technology',
    industry: 'Consumer Tech',
  },

  // Energy (XLE)
  {
    symbol: 'OXY',
    name: 'Occidental Petroleum',
    isSectorETF: false,
    sectorSymbol: 'XLE',
    sectorName: 'Energy',
    industry: 'Oil & Gas Exploration',
  },
  {
    symbol: 'EOG',
    name: 'EOG Resources Inc.',
    isSectorETF: false,
    sectorSymbol: 'XLE',
    sectorName: 'Energy',
    industry: 'Crude Oil & Nat Gas',
  },
  {
    symbol: 'XOM',
    name: 'Exxon Mobil Corporation',
    isSectorETF: false,
    sectorSymbol: 'XLE',
    sectorName: 'Energy',
    industry: 'Integrated Oil & Gas',
  },
  {
    symbol: 'TRGP',
    name: 'Targa Resources Corp.',
    isSectorETF: false,
    sectorSymbol: 'XLE',
    sectorName: 'Energy',
    industry: 'Natural Gas & LNG',
  },

  // Financials (XLF)
  {
    symbol: 'JPM',
    name: 'JPMorgan Chase & Co.',
    isSectorETF: false,
    sectorSymbol: 'XLF',
    sectorName: 'Financials',
    industry: 'Major Banks',
  },
  {
    symbol: 'GS',
    name: 'Goldman Sachs Group',
    isSectorETF: false,
    sectorSymbol: 'XLF',
    sectorName: 'Financials',
    industry: 'Investment Banking',
  },
  {
    symbol: 'KKR',
    name: 'KKR & Co. Inc.',
    isSectorETF: false,
    sectorSymbol: 'XLF',
    sectorName: 'Financials',
    industry: 'Asset Management',
  },

  // Industrials (XLI)
  {
    symbol: 'AXON',
    name: 'Axon Enterprise Inc.',
    isSectorETF: false,
    sectorSymbol: 'XLI',
    sectorName: 'Industrials',
    industry: 'Public Safety Tech',
  },
  {
    symbol: 'GEV',
    name: 'GE Vernova Inc.',
    isSectorETF: false,
    sectorSymbol: 'XLI',
    sectorName: 'Industrials',
    industry: 'Power Grid Equipment',
  },
  {
    symbol: 'CAT',
    name: 'Caterpillar Inc.',
    isSectorETF: false,
    sectorSymbol: 'XLI',
    sectorName: 'Industrials',
    industry: 'Heavy Machinery',
  },
  {
    symbol: 'ETN',
    name: 'Eaton Corporation plc',
    isSectorETF: false,
    sectorSymbol: 'XLI',
    sectorName: 'Industrials',
    industry: 'Electrical Grid Systems',
  },

  // Communication Services (XLC)
  {
    symbol: 'TTD',
    name: 'The Trade Desk Inc.',
    isSectorETF: false,
    sectorSymbol: 'XLC',
    sectorName: 'Comm Services',
    industry: 'AdTech Platform',
  },
  {
    symbol: 'META',
    name: 'Meta Platforms Inc.',
    isSectorETF: false,
    sectorSymbol: 'XLC',
    sectorName: 'Comm Services',
    industry: 'Social & Digital Ads',
  },
  {
    symbol: 'GOOGL',
    name: 'Alphabet Inc.',
    isSectorETF: false,
    sectorSymbol: 'XLC',
    sectorName: 'Comm Services',
    industry: 'Search & Cloud',
  },
  {
    symbol: 'NFLX',
    name: 'Netflix Inc.',
    isSectorETF: false,
    sectorSymbol: 'XLC',
    sectorName: 'Comm Services',
    industry: 'Streaming Media',
  },

  // Health Care (XLV)
  {
    symbol: 'LLY',
    name: 'Eli Lilly and Company',
    isSectorETF: false,
    sectorSymbol: 'XLV',
    sectorName: 'Health Care',
    industry: 'Pharmaceuticals',
  },
  {
    symbol: 'SYK',
    name: 'Stryker Corporation',
    isSectorETF: false,
    sectorSymbol: 'XLV',
    sectorName: 'Health Care',
    industry: 'Medical Devices',
  },
  {
    symbol: 'ISRG',
    name: 'Intuitive Surgical Inc.',
    isSectorETF: false,
    sectorSymbol: 'XLV',
    sectorName: 'Health Care',
    industry: 'Robotic Surgery',
  },

  // Consumer Discretionary (XLY)
  {
    symbol: 'DECK',
    name: 'Deckers Outdoor Corp.',
    isSectorETF: false,
    sectorSymbol: 'XLY',
    sectorName: 'Cons Discretionary',
    industry: 'Footwear & Apparel',
  },
  {
    symbol: 'TSLA',
    name: 'Tesla Inc.',
    isSectorETF: false,
    sectorSymbol: 'XLY',
    sectorName: 'Cons Discretionary',
    industry: 'Electric Vehicles & AI',
  },
  {
    symbol: 'AMZN',
    name: 'Amazon.com Inc.',
    isSectorETF: false,
    sectorSymbol: 'XLY',
    sectorName: 'Cons Discretionary',
    industry: 'E-Commerce & Cloud',
  },

  // Utilities (XLU)
  {
    symbol: 'SO',
    name: 'The Southern Company',
    isSectorETF: false,
    sectorSymbol: 'XLU',
    sectorName: 'Utilities',
    industry: 'Electric Utilities',
  },
  {
    symbol: 'DUK',
    name: 'Duke Energy Corporation',
    isSectorETF: false,
    sectorSymbol: 'XLU',
    sectorName: 'Utilities',
    industry: 'Electric & Gas Power',
  },
  {
    symbol: 'CEG',
    name: 'Constellation Energy',
    isSectorETF: false,
    sectorSymbol: 'XLU',
    sectorName: 'Utilities',
    industry: 'Nuclear Power',
  },

  // Materials (XLB)
  {
    symbol: 'SHW',
    name: 'Sherwin-Williams Co.',
    isSectorETF: false,
    sectorSymbol: 'XLB',
    sectorName: 'Materials',
    industry: 'Specialty Chemicals',
  },
  {
    symbol: 'FCX',
    name: 'Freeport-McMoRan Inc.',
    isSectorETF: false,
    sectorSymbol: 'XLB',
    sectorName: 'Materials',
    industry: 'Copper & Mining',
  },

  // Consumer Staples (XLP)
  {
    symbol: 'PEP',
    name: 'PepsiCo Inc.',
    isSectorETF: false,
    sectorSymbol: 'XLP',
    sectorName: 'Cons Staples',
    industry: 'Beverages & Snacks',
  },
  {
    symbol: 'COST',
    name: 'Costco Wholesale Corp.',
    isSectorETF: false,
    sectorSymbol: 'XLP',
    sectorName: 'Cons Staples',
    industry: 'Retail Warehouse',
  },
  {
    symbol: 'WMT',
    name: 'Walmart Inc.',
    isSectorETF: false,
    sectorSymbol: 'XLP',
    sectorName: 'Cons Staples',
    industry: 'Retail Stores',
  },

  // Real Estate (XLRE)
  {
    symbol: 'EQIX',
    name: 'Equinix Inc.',
    isSectorETF: false,
    sectorSymbol: 'XLRE',
    sectorName: 'Real Estate',
    industry: 'AI Data Centers',
  },
  {
    symbol: 'DLR',
    name: 'Digital Realty Trust',
    isSectorETF: false,
    sectorSymbol: 'XLRE',
    sectorName: 'Real Estate',
    industry: 'Data Center REIT',
  },
];

function average(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((acc, v) => acc + v, 0) / nums.length;
}

function computeMetricsForBaseline(
  bars: RawOHLCV[],
  baselineDays: 90 | 252
): MultiTimeframeMetrics {
  const n = bars.length;
  const baseSlice = bars.slice(Math.max(0, n - baselineDays));
  const baselineVol = Math.max(1, average(baseSlice.map((b) => b.volume)));

  const last1 = bars.slice(Math.max(0, n - 1));
  const last5 = bars.slice(Math.max(0, n - 5));
  const last20 = bars.slice(Math.max(0, n - 20));
  const last60 = bars.slice(Math.max(0, n - 60));

  const avgVol1D = average(last1.map((b) => b.volume));
  const avgVol5D = average(last5.map((b) => b.volume));
  const avgVol20D = average(last20.map((b) => b.volume));
  const avgVol60D = average(last60.map((b) => b.volume));

  const rvol1D = Number((avgVol1D / baselineVol).toFixed(2));
  const rvol5D = Number((avgVol5D / baselineVol).toFixed(2));
  const rvol20D = Number((avgVol20D / baselineVol).toFixed(2));
  const rvol60D = Number((avgVol60D / baselineVol).toFixed(2));

  const volumeAcceleration = Number((rvol5D / Math.max(0.1, rvol20D)).toFixed(2));

  const daysAboveBaseline20D = last20.filter((b) => b.volume >= baselineVol).length;
  const daysAboveBaseline60D = last60.filter((b) => b.volume >= baselineVol).length;

  let consecutiveAboveDays = 0;
  for (let i = n - 1; i >= 0; i--) {
    if (bars[i].volume >= baselineVol * 0.98) {
      consecutiveAboveDays++;
    } else {
      break;
    }
  }

  let weeksAboveBaseline12W = 0;
  const totalWeeks = Math.min(12, Math.floor(n / 5));
  for (let w = 0; w < totalWeeks; w++) {
    const startIdx = n - (w + 1) * 5;
    const weekSlice = bars.slice(startIdx, startIdx + 5);
    const weekAvg = average(weekSlice.map((b) => b.volume));
    if (weekAvg >= baselineVol) {
      weeksAboveBaseline12W++;
    }
  }

  let accumulationDays20D = 0;
  let distributionDays20D = 0;
  let netDollarFlow20D = 0;
  let upVolume20D = 0;
  let downVolume20D = 0;

  for (let i = Math.max(1, n - 20); i < n; i++) {
    const cur = bars[i];
    const prev = bars[i - 1];
    const dVol = cur.close * cur.volume;
    const isAbove = cur.volume >= baselineVol * 0.95;

    const spread = Math.max(0.01, cur.high - cur.low);
    const intradayBuyRatio = Math.max(0, Math.min(1, (cur.close - cur.low) / spread));
    const isUpDay = cur.close >= prev.close;

    const dayBuyShare = isUpDay
      ? 0.55 + 0.45 * intradayBuyRatio
      : 0.45 * intradayBuyRatio;

    upVolume20D += cur.volume * dayBuyShare;
    downVolume20D += cur.volume * (1 - dayBuyShare);

    if (isUpDay && isAbove) {
      accumulationDays20D++;
    } else if (!isUpDay && isAbove) {
      distributionDays20D++;
    }

    const closeLocation = (cur.close - cur.low - (cur.high - cur.close)) / spread;
    const directionSign = isUpDay ? 1 : -1;
    const weight = 0.6 * directionSign + 0.4 * closeLocation;
    netDollarFlow20D += dVol * weight;
  }

  const total20Vol = Math.max(1, upVolume20D + downVolume20D);
  const buyingVolumePct20D = Math.round((upVolume20D / total20Vol) * 100);
  const sellingVolumePct20D = 100 - buyingVolumePct20D;

  const netAccDist20D = accumulationDays20D - distributionDays20D;
  const dollarVolume1D = bars[n - 1].close * bars[n - 1].volume;
  const avgDollarVolume20D = average(last20.map((b) => b.close * b.volume));

  const closeNow = bars[n - 1].close;
  const close1D = bars[Math.max(0, n - 2)].close;
  const close5D = bars[Math.max(0, n - 6)].close;
  const close20D = bars[Math.max(0, n - 21)].close;
  const change1DPct = ((closeNow - close1D) / close1D) * 100;
  const change5DPct = ((closeNow - close5D) / close5D) * 100;
  const change20DPct = ((closeNow - close20D) / close20D) * 100;

  const freq20Ratio = (daysAboveBaseline20D / 20) * 50;
  const weekRatio = (weeksAboveBaseline12W / Math.max(1, totalWeeks)) * 25;
  const streakPts = Math.min(15, consecutiveAboveDays * 3);
  const rvolPts = Math.min(12, Math.max(0, (Math.max(rvol5D, rvol20D) - 0.85) * 16));
  const consistencyScore = Math.min(
    99,
    Math.max(10, Math.round(freq20Ratio + weekRatio + streakPts + rvolPts))
  );

  const peakRecentRvol = Math.max(rvol1D, rvol5D, rvol20D);

  let regime: PriceVolumeRegime = 'Neutral Flow';
  let directionBias: VolumeDirectionBias = 'NEUTRAL';
  let directionalSummary = '◆ NORMAL / MIXED VOLUME';
  let expectedMoveText = 'No clear edge yet — volume is near normal average.';
  let regimeRationale = `Trading at ${rvol5D.toFixed(2)}x weekly normal volume with ${buyingVolumePct20D}% buying split over the past 20 trading days.`;

  if (
    (rvol5D >= 1.2 || rvol1D >= 1.35 || rvol20D >= 1.25) &&
    change5DPct >= 2.2 &&
    (buyingVolumePct20D >= 43 || change5DPct >= 5.0)
  ) {
    regime = 'Breakout Expansion';
    directionBias = 'UPSIDE_BREAKOUT';
    directionalSummary = '▲ STRONG BUYING — BREAKING UP';
    expectedMoveText =
      'Bullish (Expect Upside) — Above-normal volume is pushing the price higher.';
    regimeRationale = `Volume reached ${peakRecentRvol.toFixed(
      2
    )}x normal while price gained +${change5DPct.toFixed(
      1
    )}% over the last 5 trading days (${daysAboveBaseline20D} of the last 20 days beat normal volume).`;
  } else if (
    (rvol1D >= 1.2 || rvol5D >= 1.08 || rvol20D >= 1.15) &&
    change5DPct >= -0.5 &&
    change5DPct < 2.5 &&
    buyingVolumePct20D >= 47
  ) {
    regime = 'Stealth Accumulation';
    directionBias = 'UPSIDE_ACCUMULATION';
    directionalSummary = '▲ QUIET BUYING — READY TO POP';
    expectedMoveText =
      'Bullish Watch (Expect Upside Breakout) — Volume is elevated while price holds steady in a tight range.';
    regimeRationale = `Volume is running at ${peakRecentRvol.toFixed(
      2
    )}x normal while price stayed tight (${
      change5DPct >= 0 ? '+' : ''
    }${change5DPct.toFixed(1)}% this week) with ${buyingVolumePct20D}% buying pressure.`;
  } else if (
    (rvol20D >= 1.05 || rvol5D >= 1.0 || daysAboveBaseline20D >= 9) &&
    change5DPct >= 0.5 &&
    (change5DPct >= 1.5 || change20DPct >= 1.5) &&
    buyingVolumePct20D >= 46
  ) {
    regime = 'Institutional Accumulation';
    directionBias = 'UPSIDE_ACCUMULATION';
    directionalSummary = '▲ STEADY BUYING — UPTREND';
    expectedMoveText =
      'Bullish Trend (Expect Upside) — Steady buying volume is supporting a consistent upward trend.';
    regimeRationale = `Price is up +${change5DPct.toFixed(
      1
    )}% over 5 days with ${buyingVolumePct20D}% buying volume and ${daysAboveBaseline20D} of 20 days above normal volume.`;
  } else if (
    (rvol1D >= 1.1 || rvol5D >= 1.0 || rvol20D >= 1.1) &&
    (change5DPct <= -1.2 || (change1DPct <= -2.0 && change5DPct <= 0.5))
  ) {
    regime = 'Distribution Pressure';
    directionBias = 'DOWNSIDE_DISTRIBUTION';
    directionalSummary = '▼ HEAVY SELLING — DROPPING';
    expectedMoveText =
      'Bearish (Expect Downside) — Heavy volume is showing up on red days as sellers push price down.';
    regimeRationale = `Volume hit ${peakRecentRvol.toFixed(
      2
    )}x normal while price fell ${change5DPct.toFixed(
      1
    )}% over 5 days (${sellingVolumePct20D}% selling volume). Avoid catching a falling knife.`;
  } else if (
    (rvol5D >= 1.15 || rvol20D >= 1.2) &&
    change5DPct > -1.2 &&
    change5DPct < 2.2
  ) {
    regime = 'High-Volume Churn';
    directionBias = 'TWO_WAY_CHURN';
    directionalSummary = '◆ STALLED ON HIGH VOLUME (Caution)';
    expectedMoveText =
      'Caution / Indecision — High volume is present, but sellers are matching buyers and capping the price.';
    regimeRationale = `Volume is elevated (${peakRecentRvol.toFixed(
      2
    )}x normal), but buying vs. selling is tug-of-war (${buyingVolumePct20D}% buy / ${sellingVolumePct20D}% sell).`;
  } else if (
    rvol5D <= 0.95 &&
    (change5DPct < 0 || change1DPct < -0.5) &&
    buyingVolumePct20D >= 45
  ) {
    regime = 'Quiet Pullback';
    directionBias = 'BULLISH_LOW_VOL_PULLBACK';
    directionalSummary = '▲ HEALTHY DIP — LOW SELLING';
    expectedMoveText =
      'Bullish Dip Watch — Price pulled back slightly on lighter-than-normal volume (no heavy panic selling).';
    regimeRationale = `Volume cooled off to ${rvol5D.toFixed(
      2
    )}x normal during this dip. Watch for volume to jump back above 1.2x on a green day to enter.`;
  } else if (rvol5D <= 0.8 && rvol20D <= 0.9) {
    regime = 'Low-Volume Consolidation';
    directionBias = 'NEUTRAL';
    directionalSummary = '◆ QUIET / SLEEPING VOLUME';
    expectedMoveText =
      'Wait on Sidelines — Volume is below normal right now; wait for volume expansion.';
    regimeRationale = `Weekly volume is quiet at ${rvol5D.toFixed(
      2
    )}x normal. Big traders are currently inactive in this name.`;
  }

  return {
    rvol1D,
    rvol5D,
    rvol20D,
    rvol60D,
    avgVol1D: Math.round(avgVol1D),
    avgVol5D: Math.round(avgVol5D),
    avgVol20D: Math.round(avgVol20D),
    avgVol60D: Math.round(avgVol60D),
    baselineVol: Math.round(baselineVol),
    volumeAcceleration,
    consistencyScore,
    daysAboveBaseline20D,
    daysAboveBaseline60D,
    weeksAboveBaseline12W,
    consecutiveAboveDays,
    accumulationDays20D,
    distributionDays20D,
    netAccDist20D,
    buyingVolumePct20D,
    sellingVolumePct20D,
    dollarVolume1D,
    avgDollarVolume20D,
    netDollarFlow20D,
    regime,
    directionBias,
    directionalSummary,
    expectedMoveText,
    regimeRationale,
  };
}

/**
 * Builds an explicit 'unavailable' MarketInstrument with NO price fields, NO levels, and NO scores.
 */
export function buildUnavailableMarketInstrument(
  seed: InstrumentSeed,
  fetchedAt: string,
  errorReason: string
): MarketInstrument {
  return {
    symbol: seed.symbol,
    name: seed.name,
    isSectorETF: seed.isSectorETF,
    sectorSymbol: seed.sectorSymbol,
    sectorName: seed.sectorName,
    industry: seed.industry,
    dataStatus: 'unavailable',
    asOfSession: null,
    fetchedAt,
    errorReason,
    price: null,
    lastPrice: null,
    change1DPct: null,
    change5DPct: null,
    change20DPct: null,
    change60DPct: null,
    lastUpdated: null,
    lastUpdatedTime: null,
    metricsByBaseline: null,
    history: [],
    weeklyRvolSeries: [],
  };
}

export function buildMarketInstrument(
  seed: InstrumentSeed,
  rawBars: RawOHLCV[],
  options: {
    dataStatus: Exclude<DataStatus, 'unavailable'>;
    asOfSession: string;
    fetchedAt: string;
    lastPrice?: number | null;
    exchangeName?: string;
  }
): MarketInstrument {
  const n = rawBars.length;
  const baseline90Vol = Math.max(
    1,
    average(rawBars.slice(Math.max(0, n - 90)).map((b) => b.volume))
  );
  const baseline252Vol = Math.max(
    1,
    average(rawBars.slice(Math.max(0, n - 252)).map((b) => b.volume))
  );

  const history: DailyBar[] = [];
  const startIdx = Math.max(1, n - 252);

  for (let i = startIdx; i < n; i++) {
    const cur = rawBars[i];
    const prev = rawBars[i - 1];
    const changePct = Number((((cur.close - prev.close) / prev.close) * 100).toFixed(2));
    const slice20 = rawBars.slice(Math.max(0, i - 19), i + 1);
    const slice90 = rawBars.slice(Math.max(0, i - 89), i + 1);
    const ma20Volume = Math.round(average(slice20.map((b) => b.volume)));
    const ma90Volume = Math.round(average(slice90.map((b) => b.volume)));
    const rvol90 = Number((cur.volume / baseline90Vol).toFixed(2));
    const rvol252 = Number((cur.volume / baseline252Vol).toFixed(2));
    const aboveBaseline90 = cur.volume >= baseline90Vol;
    const aboveBaseline252 = cur.volume >= baseline252Vol;

    history.push({
      date: cur.date,
      sessionCloseTime: cur.isHalfDay ? '13:00 EST (Half-Day)' : '16:00 EST',
      open: cur.open,
      high: cur.high,
      low: cur.low,
      close: cur.close,
      volume: cur.volume,
      dollarVolume: cur.close * cur.volume,
      changePct,
      isAccumulation: cur.close > prev.close && cur.volume >= ma90Volume * 0.98,
      isDistribution: cur.close < prev.close && cur.volume >= ma90Volume * 0.98,
      aboveBaseline90,
      aboveBaseline252,
      rvol90,
      rvol252,
      ma20Volume,
      ma90Volume,
      isHalfDay: cur.isHalfDay,
    });
  }

  const weeklyRvolSeries: MarketInstrument['weeklyRvolSeries'] = [];
  const weeksCount = Math.min(12, Math.floor(n / 5));
  for (let w = weeksCount - 1; w >= 0; w--) {
    const idxStart = n - (w + 1) * 5;
    const wkBars = rawBars.slice(idxStart, idxStart + 5);
    if (wkBars.length > 0) {
      const avgVol = Math.round(average(wkBars.map((b) => b.volume)));
      const firstOpen = wkBars[0].open;
      const lastClose = wkBars[wkBars.length - 1].close;
      const returnPct = Number((((lastClose - firstOpen) / firstOpen) * 100).toFixed(2));
      weeklyRvolSeries.push({
        weekLabel: wkBars[wkBars.length - 1].date.slice(5),
        avgVol,
        rvol90: Number((avgVol / baseline90Vol).toFixed(2)),
        rvol252: Number((avgVol / baseline252Vol).toFixed(2)),
        returnPct,
      });
    }
  }

  const lastBar = rawBars[n - 1];
  const prev1D = rawBars[Math.max(0, n - 2)];
  const prev5D = rawBars[Math.max(0, n - 6)];
  const prev20D = rawBars[Math.max(0, n - 21)];
  const prev60D = rawBars[Math.max(0, n - 61)];

  return {
    symbol: seed.symbol,
    name: seed.name,
    isSectorETF: seed.isSectorETF,
    sectorSymbol: seed.sectorSymbol,
    sectorName: seed.sectorName,
    industry: seed.industry,
    dataStatus: options.dataStatus,
    asOfSession: options.asOfSession,
    fetchedAt: options.fetchedAt,
    exchangeName: options.exchangeName,
    price: lastBar.close,
    lastPrice: options.lastPrice ?? lastBar.close,
    change1DPct: Number((((lastBar.close - prev1D.close) / prev1D.close) * 100).toFixed(2)),
    change5DPct: Number((((lastBar.close - prev5D.close) / prev5D.close) * 100).toFixed(2)),
    change20DPct: Number((((lastBar.close - prev20D.close) / prev20D.close) * 100).toFixed(2)),
    change60DPct: Number((((lastBar.close - prev60D.close) / prev60D.close) * 100).toFixed(2)),
    lastUpdated: lastBar.date,
    lastUpdatedTime: lastBar.isHalfDay ? '13:00 EST (Half-Day)' : '16:00 EST',
    metricsByBaseline: {
      '90D': computeMetricsForBaseline(rawBars, 90),
      '252D': computeMetricsForBaseline(rawBars, 252),
    },
    history,
    weeklyRvolSeries,
  };
}

export function getRvolForTimeframe(
  metrics: MultiTimeframeMetrics | null | undefined,
  timeframe: TimeframeWindow
): number {
  if (!metrics) return 0;
  switch (timeframe) {
    case '1D':
      return metrics.rvol1D;
    case '5D':
      return metrics.rvol5D;
    case '20D':
      return metrics.rvol20D;
    case '60D':
      return metrics.rvol60D;
  }
}

export function getPriceChangeForTimeframe(
  inst: MarketInstrument,
  timeframe: TimeframeWindow
): number | null {
  if (inst.dataStatus === 'unavailable' || inst.price === null) return null;
  switch (timeframe) {
    case '1D':
      return inst.change1DPct;
    case '5D':
      return inst.change5DPct;
    case '20D':
      return inst.change20DPct;
    case '60D':
      return inst.change60DPct;
  }
}

export function getTimeframePlainLabel(tf: TimeframeWindow): string {
  switch (tf) {
    case '1D':
      return 'Today (1D)';
    case '5D':
      return 'This Week (5D)';
    case '20D':
      return 'This Month (20D)';
    case '60D':
      return '3 Months (60D)';
  }
}

export function getBaselinePlainLabel(b: BaselinePeriod): string {
  return b === '90D' ? '3-Month Normal' : '1-Year Normal';
}

/**
 * Finds the single highest-conviction trade idea for the day across available stocks.
 * Never selects a stock with dataStatus === 'unavailable' or missing metrics.
 */
export function findTopDailyTradeIdea(
  instruments: MarketInstrument[],
  baseline: BaselinePeriod,
  timeframe: TimeframeWindow
): {
  stock: MarketInstrument;
  sector: MarketInstrument | undefined;
  convictionScore: number;
  reasons: string[];
} | null {
  const sectors = instruments.filter(
    (i) => i.isSectorETF && i.dataStatus !== 'unavailable' && i.metricsByBaseline
  );
  const stocks = instruments.filter(
    (i) =>
      !i.isSectorETF &&
      i.dataStatus !== 'unavailable' &&
      i.metricsByBaseline !== null &&
      i.price !== null
  );
  if (stocks.length === 0) return null;

  const sectorMap = new Map<string, MarketInstrument>(
    sectors.map((s) => [s.symbol, s])
  );

  let bestStock = stocks[0];
  let bestScore = -Infinity;

  for (const st of stocks) {
    const m = st.metricsByBaseline?.[baseline];
    if (!m) continue;
    const sec = sectorMap.get(st.sectorSymbol);
    const secM = sec?.metricsByBaseline?.[baseline];

    const rvol = getRvolForTimeframe(m, timeframe);
    const secRvol = secM ? getRvolForTimeframe(secM, timeframe) : 1.0;

    const isBullish =
      m.directionBias === 'UPSIDE_BREAKOUT' ||
      m.directionBias === 'UPSIDE_ACCUMULATION';
    const isBearish = m.directionBias === 'DOWNSIDE_DISTRIBUTION';
    const score =
      rvol * 30 +
      secRvol * 14 +
      m.consistencyScore * 0.45 +
      m.buyingVolumePct20D * 0.4 +
      (isBullish ? 25 : isBearish ? -40 : -10);

    if (score > bestScore) {
      bestScore = score;
      bestStock = st;
    }
  }

  const m = bestStock.metricsByBaseline![baseline];
  const sec = sectorMap.get(bestStock.sectorSymbol);
  const secM = sec?.metricsByBaseline?.[baseline];
  const activeRvol = getRvolForTimeframe(m, timeframe);

  const reasons: string[] = [
    `Sector Backing: ${bestStock.sectorName} (${bestStock.sectorSymbol}) is trading at ${
      secM ? getRvolForTimeframe(secM, timeframe).toFixed(2) : 'N/A'
    }x normal volume.`,
    `Consistent Activity: Volume beat its normal average on ${m.daysAboveBaseline20D} of the last 20 trading days.`,
    `Upside Buying Pressure: ${m.buyingVolumePct20D}% buying volume with ${activeRvol.toFixed(
      2
    )}x normal volume right now.`,
  ];

  return {
    stock: bestStock,
    sector: sec,
    convictionScore: Math.min(99, Math.max(72, Math.round(bestScore / 1.55))),
    reasons,
  };
}

export function formatCompactNumber(val: number): string {
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (abs >= 1_000_000_000) {
    return `${sign}${(abs / 1_000_000_000).toFixed(2)}B`;
  }
  if (abs >= 1_000_000) {
    return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    return `${sign}${(abs / 1_000).toFixed(1)}K`;
  }
  return `${sign}${abs.toFixed(0)}`;
}

export function formatDollarVolume(val: number): string {
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (abs >= 1_000_000_000) {
    return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  }
  if (abs >= 1_000_000) {
    return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  }
  return `${sign}$${(abs / 1_000).toFixed(0)}K`;
}
