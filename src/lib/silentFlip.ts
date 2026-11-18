import {
  BenchHealthMetrics,
  ComputedLevels,
  DataStatus,
  EarningsFeedResult,
  Intraday15mBar,
  Intraday15mFeedResult,
  IntradaySession15m,
  PreMarketQuoteResult,
  SetupLogEntry,
  SetupLogGroupSummary,
  SetupLogStage,
  SetupLogSummary,
  ShortlistBuildResult,
  ShortlistCandidateRow,
  ShortlistOverrides,
  ShortlistSide,
  SideScoreDetail,
  SilentFlipBenchItem,
  SilentFlipRules,
  SingleTestResult,
  WinningSide,
} from '../types/market';
import { DailyFeedFetchResult, nextNYSETradingDay, toNewYorkDateTime } from './marketData';
import { RawOHLCV } from './volumeAnalytics';

/**
 * Section 4: The default Silent Flip bench (22 liquid large caps across 8 GICS sectors).
 * Separate from CORE_EQUITIES.
 */
export const DEFAULT_SILENT_FLIP_BENCH: SilentFlipBenchItem[] = [
  // Technology (XLK)
  { symbol: 'NVDA', name: 'NVIDIA Corporation', sectorSymbol: 'XLK', sectorName: 'Technology' },
  { symbol: 'AMD', name: 'Advanced Micro Devices', sectorSymbol: 'XLK', sectorName: 'Technology' },
  { symbol: 'MSFT', name: 'Microsoft Corporation', sectorSymbol: 'XLK', sectorName: 'Technology' },

  // Communication Services (XLC)
  { symbol: 'META', name: 'Meta Platforms Inc.', sectorSymbol: 'XLC', sectorName: 'Comm Services' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', sectorSymbol: 'XLC', sectorName: 'Comm Services' },
  { symbol: 'DIS', name: 'The Walt Disney Company', sectorSymbol: 'XLC', sectorName: 'Comm Services' },
  { symbol: 'T', name: 'AT&T Inc.', sectorSymbol: 'XLC', sectorName: 'Comm Services' },

  // Consumer Discretionary (XLY)
  { symbol: 'AMZN', name: 'Amazon.com Inc.', sectorSymbol: 'XLY', sectorName: 'Cons Discretionary' },
  { symbol: 'HD', name: 'The Home Depot Inc.', sectorSymbol: 'XLY', sectorName: 'Cons Discretionary' },
  { symbol: 'NKE', name: 'NIKE Inc.', sectorSymbol: 'XLY', sectorName: 'Cons Discretionary' },

  // Financials (XLF)
  { symbol: 'BAC', name: 'Bank of America Corp.', sectorSymbol: 'XLF', sectorName: 'Financials' },
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.', sectorSymbol: 'XLF', sectorName: 'Financials' },
  { symbol: 'C', name: 'Citigroup Inc.', sectorSymbol: 'XLF', sectorName: 'Financials' },

  // Health Care (XLV)
  { symbol: 'PFE', name: 'Pfizer Inc.', sectorSymbol: 'XLV', sectorName: 'Health Care' },
  { symbol: 'MRK', name: 'Merck & Co. Inc.', sectorSymbol: 'XLV', sectorName: 'Health Care' },
  { symbol: 'ABBV', name: 'AbbVie Inc.', sectorSymbol: 'XLV', sectorName: 'Health Care' },

  // Energy (XLE)
  { symbol: 'XOM', name: 'Exxon Mobil Corporation', sectorSymbol: 'XLE', sectorName: 'Energy' },
  { symbol: 'CVX', name: 'Chevron Corporation', sectorSymbol: 'XLE', sectorName: 'Energy' },

  // Industrials (XLI)
  { symbol: 'UBER', name: 'Uber Technologies Inc.', sectorSymbol: 'XLI', sectorName: 'Industrials' },
  { symbol: 'CAT', name: 'Caterpillar Inc.', sectorSymbol: 'XLI', sectorName: 'Industrials' },
  { symbol: 'GE', name: 'GE Aerospace', sectorSymbol: 'XLI', sectorName: 'Industrials' },

  // Consumer Staples (XLP)
  { symbol: 'WMT', name: 'Walmart Inc.', sectorSymbol: 'XLP', sectorName: 'Cons Staples' },
];

export const LEVEL_TOLERANCE_PCT = 0.0005; // 0.05% tolerance
export const FLIP_LOOKBACK_SESSIONS = 120; // At most 120 sessions back from D-2

/**
 * Section 5: Pure function computeLevels(dailyBars, asOfSession, firstCandleAvg).
 * - Filters strictly to completed daily bars with date <= asOfSession (ignoring any partial bar > asOfSession).
 * - Uses raw high and low fields only.
 * - Let D-1 be the most recent completed session (date <= asOfSession):
 *   1. RH = high of D-1
 *   2. RL = low of D-1
 *   3. FH = walk backwards from D-2, one session at a time, for at most 120 sessions.
 *      Stop at the first session whose high > RH * 1.0005. Store flipHigh and flipHighDate.
 *   4. FL = walk backwards from D-2, one session at a time, for at most 120 sessions.
 *      Stop at the first session whose low < RL * 0.9995. Store flipLow and flipLowDate.
 *   5. If not found within 120 sessions, level is null.
 * - Keeps full precision internally.
 */
export function computeLevels(
  dailyBars: RawOHLCV[],
  asOfSession: string,
  firstCandleAvg: number | null = null
): ComputedLevels | null {
  if (!Array.isArray(dailyBars) || dailyBars.length === 0 || !asOfSession) {
    return null;
  }

  // Deduplicate by date and filter out any bar newer than asOfSession (e.g. today's partial bar)
  const byDate = new Map<string, RawOHLCV>();
  for (const bar of dailyBars) {
    if (
      bar &&
      typeof bar.date === 'string' &&
      bar.date <= asOfSession &&
      typeof bar.high === 'number' &&
      typeof bar.low === 'number' &&
      typeof bar.close === 'number' &&
      !Number.isNaN(bar.high) &&
      !Number.isNaN(bar.low)
    ) {
      byDate.set(bar.date, bar);
    }
  }

  const completed = Array.from(byDate.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  if (completed.length === 0) {
    return null;
  }

  const dMinus1Idx = completed.length - 1;
  const dMinus1 = completed[dMinus1Idx];

  const rangeHigh = dMinus1.high;
  const rangeHighDate = dMinus1.date;
  const rangeLow = dMinus1.low;
  const rangeLowDate = dMinus1.date;

  const fhThreshold = rangeHigh * (1 + LEVEL_TOLERANCE_PCT); // RH * 1.0005
  const flThreshold = rangeLow * (1 - LEVEL_TOLERANCE_PCT); // RL * 0.9995

  let flipHigh: number | null = null;
  let flipHighDate: string | null = null;
  let flipLow: number | null = null;
  let flipLowDate: string | null = null;

  const startWalkIdx = dMinus1Idx - 1; // D-2
  const minWalkIdx = Math.max(0, dMinus1Idx - FLIP_LOOKBACK_SESSIONS);

  for (let i = startWalkIdx; i >= minWalkIdx; i--) {
    const candidate = completed[i];
    if (flipHigh === null && candidate.high > fhThreshold) {
      flipHigh = candidate.high;
      flipHighDate = candidate.date;
    }
    if (flipLow === null && candidate.low < flThreshold) {
      flipLow = candidate.low;
      flipLowDate = candidate.date;
    }
    if (flipHigh !== null && flipLow !== null) {
      break;
    }
  }

  const rangeWidth = rangeHigh - rangeLow;
  const rangeWidthPct =
    dMinus1.close > 0 ? (rangeWidth / dMinus1.close) * 100 : 0;

  const sellZoneWidth = flipHigh !== null ? flipHigh - rangeHigh : null;
  const buyZoneWidth = flipLow !== null ? rangeLow - flipLow : null;

  const validFirstCandleAvg =
    typeof firstCandleAvg === 'number' && firstCandleAvg > 0
      ? firstCandleAvg
      : null;

  const rangeInCandles =
    validFirstCandleAvg !== null ? rangeWidth / validFirstCandleAvg : null;

  return {
    asOfSession: dMinus1.date,
    dMinus1Close: dMinus1.close,
    isHalfDaySession: Boolean(dMinus1.isHalfDay),
    rangeHigh,
    rangeHighDate,
    rangeLow,
    rangeLowDate,
    flipHigh,
    flipHighDate,
    flipLow,
    flipLowDate,
    rangeWidth,
    rangeWidthPct,
    sellZoneWidth,
    buyZoneWidth,
    firstCandleAvg: validFirstCandleAvg,
    rangeInCandles,
  };
}

/**
 * Computes Wilder's ATR(14) over completed daily bars.
 */
export function computeWilderATR14(completedBars: RawOHLCV[]): number | null {
  if (completedBars.length < 15) return null;

  const trs: number[] = [];
  for (let i = 1; i < completedBars.length; i++) {
    const cur = completedBars[i];
    const prev = completedBars[i - 1];
    const hl = cur.high - cur.low;
    const hc = Math.abs(cur.high - prev.close);
    const lc = Math.abs(cur.low - prev.close);
    trs.push(Math.max(hl, hc, lc));
  }

  if (trs.length < 14) return null;

  let atr = 0;
  for (let i = 0; i < 14; i++) {
    atr += trs[i];
  }
  atr /= 14;

  for (let i = 14; i < trs.length; i++) {
    atr = (atr * 13 + trs[i]) / 14;
  }

  return atr;
}

const FIRST_HOUR_TIMES = new Set(['09:30:00', '09:45:00', '10:00:00', '10:15:00']);

/**
 * Helper to count historical 3-candle Silent Flip setups across the 60-day 15m sessions
 * for the Section 4 Bench Health table ("Historical setups (60D)") using the Section 8 auto-grader.
 */
function countHistoricalThreeCandleSetups60D(
  symbol: string,
  completedDaily: RawOHLCV[],
  sessions: IntradaySession15m[],
  firstCandleAvg: number | null,
  rules: SilentFlipRules = DEFAULT_SILENT_FLIP_RULES
): number {
  if (!firstCandleAvg || firstCandleAvg <= 0 || completedDaily.length < 2) {
    return 0;
  }

  let setupCount = 0;

  for (const sess of sessions) {
    // Prior completed daily session before sess.sessionDate
    let priorIdx = -1;
    for (let i = completedDaily.length - 1; i >= 0; i--) {
      if (completedDaily[i].date < sess.sessionDate) {
        priorIdx = i;
        break;
      }
    }
    if (priorIdx < 0) continue;

    const priorSessionDate = completedDaily[priorIdx].date;
    const lvls = computeLevels(
      completedDaily.slice(0, priorIdx + 1),
      priorSessionDate,
      firstCandleAvg
    );
    if (!lvls) continue;

    const entry = gradeSilentFlipSession({
      date: sess.sessionDate,
      symbol,
      sectorSymbol: '',
      sector: '',
      inShortlist: false,
      shortlistRank: null,
      shortlistScore: null,
      levels: lvls,
      sessionBars15m: sess.bars,
      rules,
    });

    // A full 3-candle setup means C1 probed a level, C2 held as a Silent Candle, and C3 triggered by 10:45 NY
    if (entry.stageReached === 'Outcome') {
      setupCount++;
    }
  }

  return setupCount;
}

/**
 * Section 4: Computes BenchHealthMetrics for a bench symbol from its completed daily bars
 * and 60-day 15-minute intraday sessions.
 */
export function computeBenchHealth(
  symbol: string,
  dailyBars: RawOHLCV[],
  intradaySessions: IntradaySession15m[],
  asOfSession: string | null
): BenchHealthMetrics {
  const completedDaily = asOfSession
    ? dailyBars
        .filter((b) => b.date <= asOfSession)
        .sort((a, b) => a.date.localeCompare(b.date))
    : [...dailyBars].sort((a, b) => a.date.localeCompare(b.date));

  const lastBar =
    completedDaily.length > 0
      ? completedDaily[completedDaily.length - 1]
      : null;
  const price = lastBar ? lastBar.close : null;

  const last20 = completedDaily.slice(-20);
  const avgVolume20D =
    last20.length > 0
      ? last20.reduce((sum, b) => sum + b.volume, 0) / last20.length
      : null;

  const atr14 = computeWilderATR14(completedDaily);
  const atrPct14 =
    atr14 !== null && price !== null && price > 0 ? (atr14 / price) * 100 : null;

  // Filter intraday sessions up to last 60 sessions
  const recent60Sessions = [...intradaySessions]
    .sort((a, b) => a.sessionDate.localeCompare(b.sessionDate))
    .slice(-60);

  // Rule 2: A session's first candle is the 15-minute bar starting 09:30:00 New York.
  // If it's missing for a day, exclude that day from statistics; don't approximate it.
  const firstCandles = recent60Sessions
    .map((s) => s.firstCandle)
    .filter((c): c is Intraday15mBar => c !== null && c.high >= c.low);

  const firstCandleAvgDollar =
    firstCandles.length > 0
      ? firstCandles.reduce((sum, c) => sum + (c.high - c.low), 0) /
        firstCandles.length
      : null;

  const firstCandleAvgPct =
    firstCandleAvgDollar !== null && price !== null && price > 0
      ? (firstCandleAvgDollar / price) * 100
      : null;

  // Level touches (60D) & Respect rate:
  // Sessions where any of the first four 15-minute candles (09:30–10:30) reached the prior day's high or low
  // within a tolerance of 0.05% of price.
  // Of those touches: share where no first-hour 15-minute candle closed beyond the touched level by more than the tolerance.
  let levelTouches60D = 0;
  let levelRespCount60D = 0;
  let highSideTouches60D = 0;
  let highSideRespCount60D = 0;
  let lowSideTouches60D = 0;
  let lowSideRespCount60D = 0;

  for (const sess of recent60Sessions) {
    const firstHourBars = sess.bars.filter((b) =>
      FIRST_HOUR_TIMES.has(b.nyTime)
    );
    if (firstHourBars.length === 0) continue;

    // Find prior completed daily bar before sess.sessionDate
    let priorBar: RawOHLCV | null = null;
    for (let i = completedDaily.length - 1; i >= 0; i--) {
      if (completedDaily[i].date < sess.sessionDate) {
        priorBar = completedDaily[i];
        break;
      }
    }
    if (!priorBar) continue;

    const priorHigh = priorBar.high;
    const priorLow = priorBar.low;

    const highTouchThreshold = priorHigh * (1 - LEVEL_TOLERANCE_PCT);
    const highCloseBreakThreshold = priorHigh * (1 + LEVEL_TOLERANCE_PCT);

    const lowTouchThreshold = priorLow * (1 + LEVEL_TOLERANCE_PCT);
    const lowCloseBreakThreshold = priorLow * (1 - LEVEL_TOLERANCE_PCT);

    const touchedHigh = firstHourBars.some((b) => b.high >= highTouchThreshold);
    const respectedHigh =
      touchedHigh &&
      firstHourBars.every((b) => b.close <= highCloseBreakThreshold);

    const touchedLow = firstHourBars.some((b) => b.low <= lowTouchThreshold);
    const respectedLow =
      touchedLow &&
      firstHourBars.every((b) => b.close >= lowCloseBreakThreshold);

    if (touchedHigh) {
      highSideTouches60D++;
      if (respectedHigh) highSideRespCount60D++;
    }

    if (touchedLow) {
      lowSideTouches60D++;
      if (respectedLow) lowSideRespCount60D++;
    }

    if (touchedHigh || touchedLow) {
      levelTouches60D++;
      const highBroke = touchedHigh && !respectedHigh;
      const lowBroke = touchedLow && !respectedLow;
      if (!highBroke && !lowBroke) {
        levelRespCount60D++;
      }
    }
  }

  const respectRate60D =
    levelTouches60D > 0 ? levelRespCount60D / levelTouches60D : null;
  const highSideRespectRate60D =
    highSideTouches60D > 0 ? highSideRespCount60D / highSideTouches60D : null;
  const lowSideRespectRate60D =
    lowSideTouches60D > 0 ? lowSideRespCount60D / lowSideTouches60D : null;

  const historicalSetups60D = countHistoricalThreeCandleSetups60D(
    symbol,
    completedDaily,
    recent60Sessions,
    firstCandleAvgDollar
  );

  const lowVolume = avgVolume20D !== null ? avgVolume20D < 5_000_000 : false;
  const lowPrice = price !== null ? price < 15 : false;
  const atrOutOfBounds =
    atrPct14 !== null ? atrPct14 < 1.5 || atrPct14 > 4.0 : false;
  const lowTouches = levelTouches60D < 10;
  const lowRespectRate =
    respectRate60D !== null ? respectRate60D < 0.5 : false;

  return {
    symbol,
    avgVolume20D,
    price,
    atr14,
    atrPct14,
    firstCandleAvgDollar,
    firstCandleAvgPct,
    firstCandleSampleSize: firstCandles.length,
    levelTouches60D,
    levelRespCount60D,
    respectRate60D,
    highSideTouches60D,
    highSideRespCount60D,
    highSideRespectRate60D,
    lowSideTouches60D,
    lowSideRespCount60D,
    lowSideRespectRate60D,
    historicalSetups60D,
    flags: {
      lowVolume,
      lowPrice,
      atrOutOfBounds,
      lowTouches,
      lowRespectRate,
      anyAmber:
        lowVolume ||
        lowPrice ||
        atrOutOfBounds ||
        lowTouches ||
        lowRespectRate,
    },
  };
}

/**
 * Section 7.4: Maps Yahoo's meta.exchangeName to TradingView prefixes:
 * NMS / NGM / NCM -> NASDAQ
 * NYQ -> NYSE
 * ASE / PCX -> AMEX
 * Unmapped codes return null and an error string rather than guessing.
 */
export function mapExchangeToTradingView(
  exchangeName?: string | null
): {
  prefix: 'NASDAQ' | 'NYSE' | 'AMEX' | null;
  error?: string;
} {
  const code = (exchangeName || '').trim().toUpperCase();
  if (!code) {
    return { prefix: null, error: 'Missing exchange code from Yahoo Finance' };
  }
  if (code === 'NMS' || code === 'NGM' || code === 'NCM' || code === 'NASDAQ') {
    return { prefix: 'NASDAQ' };
  }
  if (code === 'NYQ' || code === 'NYSE') {
    return { prefix: 'NYSE' };
  }
  if (code === 'ASE' || code === 'PCX' || code === 'AMEX') {
    return { prefix: 'AMEX' };
  }
  return {
    prefix: null,
    error: `Unmapped exchange code: ${code}`,
  };
}

/**
 * Formats one row's Copy Levels line per Section 7.3:
 * e.g. "UBER FH 78.60 | RH 78.12 | RL 75.36 | FL 75.10 (side SELL)"
 */
export function formatCopyLevelsLine(row: {
  symbol: string;
  levels: ComputedLevels | null;
  passingSide: ShortlistSide | null;
  winningSide: WinningSide | null;
}): string {
  if (!row.levels) {
    return `${row.symbol} — No levels available`;
  }
  const fhStr =
    row.levels.flipHigh !== null ? row.levels.flipHigh.toFixed(2) : '—';
  const rhStr = row.levels.rangeHigh.toFixed(2);
  const rlStr = row.levels.rangeLow.toFixed(2);
  const flStr =
    row.levels.flipLow !== null ? row.levels.flipLow.toFixed(2) : '—';
  const sideLabel = row.passingSide || row.winningSide || 'NONE';
  return `${row.symbol} FH ${fhStr} | RH ${rhStr} | RL ${rlStr} | FL ${flStr} (side ${sideLabel})`;
}

/**
 * Computes the score detail for a single passing side ('SELL' or 'BUY') per Section 6:
 * - Reach (0–40) = 40 * (1 - d / A), clipped to 0–40. d is P's distance to the nearest level on that side;
 *   zero if P is already inside the zone.
 * - Respect (0–40) = 40 * that side's respect rate from section 4. Use high-side rate for SELL and low-side rate for BUY.
 *   If n < 5, use 50%.
 * - Room (0–20) = 20 * min(rangeInCandles / 6, 1).
 */
export function scoreSide(
  side: WinningSide,
  P: number,
  levels: ComputedLevels,
  health: BenchHealthMetrics
): SideScoreDetail {
  const A = levels.firstCandleAvg || 1;
  const rangeInCandles = levels.rangeInCandles || 0;

  let distanceDollar = 0;
  let nearestLevel = levels.rangeHigh;
  let nearestLevelName: 'RH' | 'FH' | 'RL' | 'FL' = 'RH';

  if (side === 'SELL') {
    const rh = levels.rangeHigh;
    const fh = levels.flipHigh!;
    if (P >= rh && P <= fh) {
      distanceDollar = 0;
      if (Math.abs(P - rh) <= Math.abs(fh - P)) {
        nearestLevel = rh;
        nearestLevelName = 'RH';
      } else {
        nearestLevel = fh;
        nearestLevelName = 'FH';
      }
    } else if (P < rh) {
      distanceDollar = rh - P;
      nearestLevel = rh;
      nearestLevelName = 'RH';
    } else {
      distanceDollar = P - fh;
      nearestLevel = fh;
      nearestLevelName = 'FH';
    }
  } else {
    const rl = levels.rangeLow;
    const fl = levels.flipLow!;
    if (P >= fl && P <= rl) {
      distanceDollar = 0;
      if (Math.abs(rl - P) <= Math.abs(P - fl)) {
        nearestLevel = rl;
        nearestLevelName = 'RL';
      } else {
        nearestLevel = fl;
        nearestLevelName = 'FL';
      }
    } else if (P > rl) {
      distanceDollar = P - rl;
      nearestLevel = rl;
      nearestLevelName = 'RL';
    } else {
      distanceDollar = fl - P;
      nearestLevel = fl;
      nearestLevelName = 'FL';
    }
  }

  const distanceInA = A > 0 ? distanceDollar / A : 0;
  const rawReach = 40 * (1 - distanceDollar / A);
  const reachScore = Math.max(0, Math.min(40, rawReach));

  const sampleN =
    side === 'SELL' ? health.highSideTouches60D : health.lowSideTouches60D;
  const rawRate =
    side === 'SELL'
      ? health.highSideRespectRate60D
      : health.lowSideRespectRate60D;
  const respectRateUsed =
    sampleN >= 5 && rawRate !== null ? rawRate : 0.5;
  const respectScore = Math.max(0, Math.min(40, 40 * respectRateUsed));

  const roomScore = Math.max(
    0,
    Math.min(20, 20 * Math.min(rangeInCandles / 6, 1))
  );

  const totalScore = Number(
    (reachScore + respectScore + roomScore).toFixed(1)
  );

  return {
    side,
    nearestLevel,
    nearestLevelName,
    distanceDollar,
    distanceInA,
    reachScore: Number(reachScore.toFixed(1)),
    respectRateUsed,
    respectSampleN: sampleN,
    respectRateRaw: rawRate,
    respectScore: Number(respectScore.toFixed(1)),
    roomScore: Number(roomScore.toFixed(1)),
    totalScore,
  };
}

export interface SymbolShortlistInput {
  daily: DailyFeedFetchResult;
  intraday15m: Intraday15mFeedResult;
  premarket: PreMarketQuoteResult;
  earnings: EarningsFeedResult;
  levels: ComputedLevels | null;
  health: BenchHealthMetrics;
}

/**
 * Section 6: Pure function buildShortlist(bench, inputsBySymbol, overrides, sessionBeingPrepared).
 * Evaluates T1–T5 in order for every bench symbol, scores survivors (0–100),
 * ranks descending, caps at 8 with at most 2 per sector, and never pads with failures.
 */
export function buildShortlist(
  bench: SilentFlipBenchItem[],
  inputsBySymbol: Record<string, SymbolShortlistInput>,
  overrides: ShortlistOverrides = {
    excludeNewsBySymbol: {},
    usDataRelease0830: false,
  },
  sessionBeingPreparedOverride?: string
): ShortlistBuildResult {
  const generatedAt = new Date().toISOString();

  // Determine D-1 (asOfCompletedSession) and D (sessionBeingPrepared)
  let asOfCompletedSession: string | null = null;
  for (const item of bench) {
    const inp = inputsBySymbol[item.symbol];
    if (inp?.daily?.asOfSession) {
      if (
        !asOfCompletedSession ||
        inp.daily.asOfSession > asOfCompletedSession
      ) {
        asOfCompletedSession = inp.daily.asOfSession;
      }
    }
  }

  const sessionBeingPrepared =
    sessionBeingPreparedOverride ||
    (asOfCompletedSession
      ? nextNYSETradingDay(asOfCompletedSession)
      : toNewYorkDateTime(new Date()).nyDate);

  let failedFeedSymbolCount = 0;
  let anyEarningsUnavailable = false;

  const benchRows: ShortlistCandidateRow[] = bench.map((benchItem) => {
    const symbol = benchItem.symbol;
    const inp = inputsBySymbol[symbol];

    const dailyStatus: DataStatus = inp?.daily?.dataStatus ?? 'unavailable';
    const intradayStatus: DataStatus =
      inp?.intraday15m?.dataStatus ?? 'unavailable';
    const premarketStatus: DataStatus =
      inp?.premarket?.dataStatus ?? 'unavailable';

    const levels = inp?.levels ?? null;
    const health: BenchHealthMetrics =
      inp?.health ??
      computeBenchHealth(symbol, [], [], asOfCompletedSession);

    const A = levels?.firstCandleAvg ?? health.firstCandleAvgDollar ?? null;
    const P =
      premarketStatus === 'ok' && typeof inp?.premarket?.price === 'number'
        ? inp.premarket.price
        : null;

    // Track feed failures for the >20% failure red banner
    if (
      dailyStatus === 'unavailable' ||
      intradayStatus === 'unavailable' ||
      premarketStatus === 'unavailable'
    ) {
      failedFeedSymbolCount++;
    }

    if (!inp?.earnings || inp.earnings.dataStatus === 'unavailable') {
      anyEarningsUnavailable = true;
    }

    // ==========================================
    // T1: Data (dataStatus is ok for daily, 15-minute and pre-market feeds)
    // ==========================================
    const failedFeeds: string[] = [];
    if (dailyStatus !== 'ok') failedFeeds.push('daily');
    if (intradayStatus !== 'ok' || A === null || A <= 0) {
      failedFeeds.push('15-minute');
    }
    if (premarketStatus !== 'ok' || P === null) {
      failedFeeds.push('pre-market');
    }

    const t1Passed = failedFeeds.length === 0;
    const T1: SingleTestResult = {
      id: 'T1',
      name: 'Data',
      passed: t1Passed,
      failLabel: t1Passed ? null : `No data: ${failedFeeds.join(', ')}`,
    };

    // ==========================================
    // T2: No catalyst (No earnings after close on D-1, before open today, or during today; and manual "Exclude: news" is off)
    // ==========================================
    const excludeNews = Boolean(overrides.excludeNewsBySymbol?.[symbol]);
    const dMinus1Date = levels?.asOfSession || asOfCompletedSession;

    let catalystEventLabel: string | null = null;
    if (inp?.earnings?.dataStatus === 'ok' && Array.isArray(inp.earnings.events)) {
      for (const ev of inp.earnings.events) {
        const hr = (ev.hour || '').toLowerCase();
        const isDMinus1AfterClose =
          dMinus1Date && ev.date === dMinus1Date && hr === 'amc';
        const isTodaySession =
          ev.date === sessionBeingPrepared &&
          (hr === 'bmo' || hr === 'dmh' || hr === 'amc' || hr === '');
        if (isDMinus1AfterClose || isTodaySession) {
          const hrTag = hr ? ` ${hr.toUpperCase()}` : '';
          catalystEventLabel = `Earnings ${ev.date}${hrTag}`;
          break;
        }
      }
    }

    let t2Passed = true;
    let t2FailLabel: string | null = null;
    if (excludeNews) {
      t2Passed = false;
      t2FailLabel = 'Excluded: news';
    } else if (catalystEventLabel) {
      t2Passed = false;
      t2FailLabel = catalystEventLabel;
    }

    const T2: SingleTestResult = {
      id: 'T2',
      name: 'No catalyst',
      passed: t2Passed,
      failLabel: t2FailLabel,
    };

    let earningsStatusLabel = 'Clear';
    const earningsUnavailable =
      !inp?.earnings || inp.earnings.dataStatus === 'unavailable';
    if (excludeNews) {
      earningsStatusLabel = 'Excluded: news';
    } else if (catalystEventLabel) {
      earningsStatusLabel = catalystEventLabel;
    } else if (earningsUnavailable) {
      earningsStatusLabel = 'Verify manually';
    }

    // ==========================================
    // T3: Levels exist (At least one side is complete: FH and RH for sell side, or RL and FL for buy side)
    // ==========================================
    const hasSellLevels =
      levels !== null &&
      typeof levels.rangeHigh === 'number' &&
      levels.flipHigh !== null;
    const hasBuyLevels =
      levels !== null &&
      typeof levels.rangeLow === 'number' &&
      levels.flipLow !== null;
    const t3Passed = hasSellLevels || hasBuyLevels;
    const T3: SingleTestResult = {
      id: 'T3',
      name: 'Levels exist',
      passed: t3Passed,
      failLabel: t3Passed ? null : 'No Flip level',
    };

    // ==========================================
    // T4: Room for target (rangeInCandles >= 3.0)
    // ==========================================
    const rangeInCandles = levels?.rangeInCandles ?? null;
    const t4Passed =
      rangeInCandles !== null && rangeInCandles >= 3.0;
    const T4: SingleTestResult = {
      id: 'T4',
      name: 'Room for target',
      passed: t4Passed,
      failLabel: t4Passed
        ? null
        : rangeInCandles !== null
        ? `Range too narrow (${rangeInCandles.toFixed(1)} candles)`
        : 'No data: 15-minute',
    };

    // ==========================================
    // T5: Within reach
    // - Sell side (FH and RH present): Passes if RH - A <= P <= FH + A. P > FH + A fails as "Gapped beyond levels".
    // - Buy side (FL and RL present): Passes if FL - A <= P <= RL + A. P < FL - A fails as "Gapped beyond levels".
    // - If P sits between RL + A and RH - A, both sides fail as "Mid-range, out of reach".
    // ==========================================
    let sellSideReachPass = false;
    let sellSideFailReason: 'Gapped beyond levels' | 'Mid-range, out of reach' | null =
      null;
    let buySideReachPass = false;
    let buySideFailReason: 'Gapped beyond levels' | 'Mid-range, out of reach' | null =
      null;

    if (levels !== null && A !== null && A > 0 && P !== null) {
      if (hasSellLevels && levels.flipHigh !== null) {
        const rh = levels.rangeHigh;
        const fh = levels.flipHigh;
        if (P >= rh - A && P <= fh + A) {
          sellSideReachPass = true;
        } else if (P > fh + A) {
          sellSideFailReason = 'Gapped beyond levels';
        } else {
          sellSideFailReason = 'Mid-range, out of reach';
        }
      } else if (P > levels.rangeHigh) {
        sellSideFailReason = 'Gapped beyond levels';
      }

      if (hasBuyLevels && levels.flipLow !== null) {
        const rl = levels.rangeLow;
        const fl = levels.flipLow;
        if (P >= fl - A && P <= rl + A) {
          buySideReachPass = true;
        } else if (P < fl - A) {
          buySideFailReason = 'Gapped beyond levels';
        } else {
          buySideFailReason = 'Mid-range, out of reach';
        }
      } else if (P < levels.rangeLow) {
        buySideFailReason = 'Gapped beyond levels';
      }
    }

    let passingSide: ShortlistSide | null = null;
    if (sellSideReachPass && buySideReachPass) {
      passingSide = 'BOTH';
    } else if (sellSideReachPass) {
      passingSide = 'SELL';
    } else if (buySideReachPass) {
      passingSide = 'BUY';
    }

    const t5Passed = passingSide !== null;
    let t5FailLabel: string | null = null;
    if (!t5Passed) {
      if (levels === null || A === null || P === null) {
        t5FailLabel = T1.failLabel || 'No data: pre-market';
      } else if (!hasSellLevels && !hasBuyLevels) {
        t5FailLabel = 'No Flip level';
      } else if (
        sellSideFailReason === 'Gapped beyond levels' ||
        buySideFailReason === 'Gapped beyond levels'
      ) {
        t5FailLabel = 'Gapped beyond levels';
      } else {
        t5FailLabel = 'Mid-range, out of reach';
      }
    }

    const T5: SingleTestResult = {
      id: 'T5',
      name: 'Within reach',
      passed: t5Passed,
      failLabel: t5FailLabel,
    };

    const orderedTests = [T1, T2, T3, T4, T5];
    const firstFailed = orderedTests.find((t) => !t.passed) ?? null;
    const allTestsPassed = firstFailed === null;

    // Score survivors (0–100) using the passing side with the higher score
    let winningSide: WinningSide | null = null;
    let scoreDetail: SideScoreDetail | null = null;
    let score: number | null = null;

    if (allTestsPassed && levels !== null && P !== null && passingSide !== null) {
      if (passingSide === 'SELL') {
        winningSide = 'SELL';
        scoreDetail = scoreSide('SELL', P, levels, health);
        score = scoreDetail.totalScore;
      } else if (passingSide === 'BUY') {
        winningSide = 'BUY';
        scoreDetail = scoreSide('BUY', P, levels, health);
        score = scoreDetail.totalScore;
      } else {
        const sellDetail = scoreSide('SELL', P, levels, health);
        const buyDetail = scoreSide('BUY', P, levels, health);
        if (sellDetail.totalScore >= buyDetail.totalScore) {
          winningSide = 'SELL';
          scoreDetail = sellDetail;
          score = sellDetail.totalScore;
        } else {
          winningSide = 'BUY';
          scoreDetail = buyDetail;
          score = buyDetail.totalScore;
        }
      }
    }

    const tvMap = mapExchangeToTradingView(inp?.daily?.exchangeName);
    const dMinus1Close = levels?.dMinus1Close ?? null;
    const gapPctFromClose =
      P !== null && dMinus1Close !== null && dMinus1Close > 0
        ? ((P - dMinus1Close) / dMinus1Close) * 100
        : null;

    const overallRowDataStatus: DataStatus =
      dailyStatus === 'unavailable' ||
      intradayStatus === 'unavailable' ||
      premarketStatus === 'unavailable'
        ? 'unavailable'
        : dailyStatus === 'stale' ||
          intradayStatus === 'stale' ||
          premarketStatus === 'stale'
        ? 'stale'
        : 'ok';

    return {
      symbol,
      name: inp?.daily?.shortName || benchItem.name,
      sectorSymbol: benchItem.sectorSymbol,
      sectorName: benchItem.sectorName,
      exchangeName: inp?.daily?.exchangeName,
      tradingViewPrefix: tvMap.prefix,
      tradingViewError: tvMap.error,
      dataStatus: overallRowDataStatus,
      asOfSession: levels?.asOfSession ?? inp?.daily?.asOfSession ?? null,
      isHalfDay: Boolean(levels?.isHalfDaySession),
      levels,
      health,
      premarketPrice: P,
      premarketTimeNY: inp?.premarket?.nyTime ?? null,
      premarketSourceWindow: inp?.premarket?.sourceWindow ?? 'none',
      gapPctFromClose,
      earningsStatusLabel,
      earningsUnavailable,
      excludeNews,
      tests: { T1, T2, T3, T4, T5 },
      allTestsPassed,
      firstFailLabel: firstFailed ? firstFailed.failLabel : null,
      passingSide,
      winningSide,
      scoreDetail,
      score,
      selectedInShortlist: false,
      shortlistRank: null,
      cappedBySectorOrMax: false,
    };
  });

  // Selection:
  // Sort survivors by score descending. Walk the list and take each stock unless its sector already has 2.
  // Stop at 8. If fewer than 5 survive, show only those, with the note "Only [n] candidates today".
  // Never pad the list with failures.
  const survivors = benchRows
    .filter((r) => r.allTestsPassed && r.score !== null)
    .sort((a, b) => {
      if ((b.score ?? 0) !== (a.score ?? 0)) {
        return (b.score ?? 0) - (a.score ?? 0);
      }
      return a.symbol.localeCompare(b.symbol);
    });

  const sectorCounts = new Map<string, number>();
  const shortlist: ShortlistCandidateRow[] = [];

  for (const surv of survivors) {
    const currentSectorCount = sectorCounts.get(surv.sectorSymbol) ?? 0;
    if (shortlist.length < 8 && currentSectorCount < 2) {
      surv.selectedInShortlist = true;
      surv.shortlistRank = shortlist.length + 1;
      sectorCounts.set(surv.sectorSymbol, currentSectorCount + 1);
      shortlist.push(surv);
    } else {
      surv.cappedBySectorOrMax = true;
    }
  }

  const onlyNCandidatesNote =
    shortlist.length < 5
      ? `Only ${shortlist.length} candidates today`
      : null;

  // Direction balance (display only): If 6 or more selected stocks share one side, show a hint
  const sellCount = shortlist.filter(
    (s) => s.passingSide === 'SELL' || s.winningSide === 'SELL'
  ).length;
  const buyCount = shortlist.filter(
    (s) => s.passingSide === 'BUY' || s.winningSide === 'BUY'
  ).length;

  let directionBalanceHint: string | null = null;
  if (sellCount >= 6) {
    directionBalanceHint =
      'Shortlist leans SELL: a strong market move could fail them together.';
  } else if (buyCount >= 6) {
    directionBalanceHint =
      'Shortlist leans BUY: a strong market move could fail them together.';
  }

  const earningsBanner = anyEarningsUnavailable
    ? 'Earnings check unavailable — verify manually'
    : null;

  const failureRatio =
    bench.length > 0 ? failedFeedSymbolCount / bench.length : 0;
  const yahooFailureBanner =
    failureRatio > 0.2
      ? `Market data warning: ${failedFeedSymbolCount} of ${bench.length} bench symbols (${Math.round(
          failureRatio * 100
        )}%) failed to load one or more Yahoo Finance feeds.`
      : null;

  const dataDayBanner = overrides.usDataRelease0830
    ? 'Data day: consider half size'
    : null;

  return {
    sessionBeingPrepared,
    asOfCompletedSession,
    generatedAt,
    shortlist,
    benchRows,
    survivorCount: survivors.length,
    onlyNCandidatesNote,
    directionBalanceHint,
    earningsBanner,
    yahooFailureBanner,
    dataDayBanner,
  };
}

/**
 * Time-zone helper for Section 1 & Section 7:
 * Given a session date (YYYY-MM-DD) and a New York time ("HH:mm"),
 * finds the exact UTC Date instant for that New York wall-clock time using the IANA
 * time-zone database (America/New_York and Europe/London), never hard-coding the 4h/5h offset.
 */
export function resolveNewYorkWallTimeToInstant(
  nyDateStr: string,
  nyTimeHHMM: string
): Date {
  const [y, m, d] = nyDateStr.split('-').map(Number);
  const [targetHour, targetMin] = nyTimeHHMM.split(':').map(Number);

  // Start with an initial UTC guess at +5h from target NY wall clock
  let guessMs = Date.UTC(y, m - 1, d, targetHour + 5, targetMin, 0);

  // Refine twice using toNewYorkDateTime so DST transitions (EST vs EDT) are exact to the minute
  for (let iter = 0; iter < 2; iter++) {
    const { nyDate, nyTime } = toNewYorkDateTime(new Date(guessMs));
    const [gy, gm, gd] = nyDate.split('-').map(Number);
    const [gh, gmin] = nyTime.split(':').map(Number);
    const targetVirtual = Date.UTC(y, m - 1, d, targetHour, targetMin, 0);
    const gotVirtual = Date.UTC(gy, gm - 1, gd, gh, gmin, 0);
    const diffMs = targetVirtual - gotVirtual;
    guessMs += diffMs;
  }

  return new Date(guessMs);
}

const ukTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const nyShortTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export interface MorningCheckpoint {
  id: string;
  label: string;
  nyTime: string; // Derived via America/New_York
  ukTime: string; // Derived via Europe/London
  instantMs: number;
}

/**
 * Section 7.2: Derives the five morning timeline checkpoints in both UK and New York time
 * from the time-zone database for the given session date.
 */
export function deriveMorningCheckpoints(
  sessionDate: string
): MorningCheckpoint[] {
  const specs = [
    { id: 'lock', label: 'Lock shortlist', nyWall: '09:15' },
    { id: 'open', label: 'Open', nyWall: '09:30' },
    { id: 'c1', label: 'Candle 1 closes', nyWall: '09:45' },
    { id: 'c2', label: 'Candle 2 closes', nyWall: '10:00' },
    { id: 'cutoff', label: 'Trigger cut-off', nyWall: '10:45' },
  ];

  return specs.map((sp) => {
    const instant = resolveNewYorkWallTimeToInstant(sessionDate, sp.nyWall);
    return {
      id: sp.id,
      label: sp.label,
      nyTime: nyShortTimeFormatter.format(instant),
      ukTime: ukTimeFormatter.format(instant),
      instantMs: instant.getTime(),
    };
  });
}

// =========================================================
// Phase 3 (Section 8): Setup Log & Auto-Grader Pure Logic
// =========================================================

export const DEFAULT_SILENT_FLIP_RULES: SilentFlipRules = {
  rulesVersion: 1,
  strongBodyPct: 0.6,
  strongRangeMult: 1.0,
  levelTolPct: 0.0005,
  breakRule: 'close',
  stopOffset: 0.02,
  targetMode: 'range',
  triggerCutoff: '10:45',
};

export const SILENT_FLIP_RULES: SilentFlipRules = {
  ...DEFAULT_SILENT_FLIP_RULES,
};

/**
 * Updates SILENT_FLIP_RULES parameters and increments rulesVersion whenever any parameter changes.
 * Old SetupLogEntry records retain the rulesVersion they were graded under.
 */
export function updateSilentFlipRules(
  current: SilentFlipRules,
  patch: Partial<Omit<SilentFlipRules, 'rulesVersion'>>
): SilentFlipRules {
  const next: SilentFlipRules = {
    ...current,
    ...patch,
  };

  const changed =
    next.strongBodyPct !== current.strongBodyPct ||
    next.strongRangeMult !== current.strongRangeMult ||
    next.levelTolPct !== current.levelTolPct ||
    next.breakRule !== current.breakRule ||
    next.stopOffset !== current.stopOffset ||
    next.targetMode !== current.targetMode ||
    next.triggerCutoff !== current.triggerCutoff;

  if (changed) {
    next.rulesVersion = current.rulesVersion + 1;
  }
  return next;
}

export interface GradeSilentFlipInput {
  date: string; // YYYY-MM-DD session being graded
  symbol: string;
  sectorSymbol: string;
  sector: string;
  inShortlist: boolean;
  shortlistRank: number | null;
  shortlistScore: number | null;
  shortlistSide?: WinningSide | null;
  levels: ComputedLevels | null;
  sessionBars15m: Intraday15mBar[];
  rules?: SilentFlipRules;
  existingManual?: {
    taken: boolean | null;
    actualEntry: number | null;
    actualExit: number | null;
    actualR: number | null;
    notes: string;
  };
}

/**
 * Section 8: Pure deterministic auto-grader for a single bench symbol on a given US session date.
 * Grades the 4 steps in order:
 * 1. Candle 1 probe (09:30 bar): body >= strongBodyPct * range and range >= strongRangeMult * A;
 *    bullish C1 high reaching RH or FH (within levelTolPct) -> SELL candidate;
 *    bearish C1 low reaching RL or FL (within levelTolPct) -> BUY candidate;
 *    else "C1 weak" or "C1 no level".
 * 2. Candle 2 silence (09:45 bar): opposite colour to C1 and does not break the touched level under breakRule;
 *    else "C2 same colour" or "C2 broke level".
 * 3. Trigger (10:00, 10:15, 10:30 bars up to triggerCutoff = 10:45 NY):
 *    For SELL: Entry = C2 low, Stop = C2 high + stopOffset, Target = RL (or FL if targetMode === 'flip').
 *    Checks bars in order:
 *    - Both exceeds C2 extreme and reaches entry in same bar -> "Ambiguous: check 1-minute"
 *    - Exceeds C2 extreme before reaching entry -> "Invalidated"
 *    - Reaches entry -> "Triggered" (proceeds to Step 4)
 *    - No touch by cut-off -> "Expired"
 * 4. Mechanical outcome (triggered only): walks forward through 15-minute bars to 16:00 close:
 *    - Both stop and target hit in same bar -> "Ambiguous"
 *    - First of stop or target hit -> -1R ("Stop hit") or +[planned R] ("Target hit")
 *    - Neither hit -> exit at 16:00 close ("Close exit"), recorded in R
 *    - Records furthest favourable move in R (mfeR).
 */
export function gradeSilentFlipSession(
  input: GradeSilentFlipInput
): SetupLogEntry {
  const rules = input.rules ?? SILENT_FLIP_RULES;
  const id = `${input.date}::${input.symbol}`;
  const manual = input.existingManual ?? {
    taken: null,
    actualEntry: null,
    actualExit: null,
    actualR: null,
    notes: '',
  };

  const lvls = input.levels;
  const A = lvls?.firstCandleAvg ?? null;

  const baseEntry = (
    overrides: Partial<SetupLogEntry>
  ): SetupLogEntry => ({
    id,
    date: input.date,
    symbol: input.symbol,
    sectorSymbol: input.sectorSymbol,
    sector: input.sector,
    inShortlist: input.inShortlist,
    shortlistRank: input.shortlistRank,
    shortlistScore: input.shortlistScore,
    side: input.shortlistSide ?? null,
    fh: lvls?.flipHigh ?? null,
    rh: lvls?.rangeHigh ?? null,
    rl: lvls?.rangeLow ?? null,
    fl: lvls?.flipLow ?? null,
    firstCandleAvg: A !== null ? Number(A.toFixed(4)) : null,
    stageReached: 'C1',
    touchedLevel: null,
    failLabel: null,
    entry: null,
    stop: null,
    target: null,
    plannedR: null,
    mechanicalResultR: null,
    mfeR: null,
    rulesVersion: rules.rulesVersion,
    taken: manual.taken,
    actualEntry: manual.actualEntry,
    actualExit: manual.actualExit,
    actualR: manual.actualR,
    notes: manual.notes,
    ...overrides,
  });

  const sortedBars = [...input.sessionBars15m].sort((a, b) =>
    a.nyTime.localeCompare(b.nyTime)
  );
  const c1 = sortedBars.find((b) => b.nyTime === '09:30:00');
  const c2 = sortedBars.find((b) => b.nyTime === '09:45:00');

  if (!lvls || A === null || A <= 0 || !c1) {
    return baseEntry({
      stageReached: 'C1',
      failLabel: 'No data',
    });
  }

  // ==========================================
  // Step 1: Candle 1 probe (09:30 bar)
  // ==========================================
  const c1Range = c1.high - c1.low;
  const c1Body = Math.abs(c1.close - c1.open);
  const isStrongC1 =
    c1Range > 0 &&
    c1.close !== c1.open &&
    c1Body >= rules.strongBodyPct * c1Range - 1e-9 &&
    c1Range >= rules.strongRangeMult * A - 1e-9;

  if (!isStrongC1) {
    return baseEntry({
      stageReached: 'C1',
      failLabel: 'C1 weak',
    });
  }

  const isBullishC1 = c1.close > c1.open;
  let candidateSide: WinningSide | null = null;
  let touchedLevel: 'RH' | 'FH' | 'RL' | 'FL' | null = null;
  let testedLevelPrice: number | null = null;

  if (isBullishC1) {
    const reachedFH =
      lvls.flipHigh !== null &&
      c1.high >= lvls.flipHigh * (1 - rules.levelTolPct);
    const reachedRH = c1.high >= lvls.rangeHigh * (1 - rules.levelTolPct);

    if (reachedFH && lvls.flipHigh !== null) {
      candidateSide = 'SELL';
      touchedLevel = 'FH';
      testedLevelPrice = lvls.flipHigh;
    } else if (reachedRH) {
      candidateSide = 'SELL';
      touchedLevel = 'RH';
      testedLevelPrice = lvls.rangeHigh;
    }
  } else {
    const reachedFL =
      lvls.flipLow !== null &&
      c1.low <= lvls.flipLow * (1 + rules.levelTolPct);
    const reachedRL = c1.low <= lvls.rangeLow * (1 + rules.levelTolPct);

    if (reachedFL && lvls.flipLow !== null) {
      candidateSide = 'BUY';
      touchedLevel = 'FL';
      testedLevelPrice = lvls.flipLow;
    } else if (reachedRL) {
      candidateSide = 'BUY';
      touchedLevel = 'RL';
      testedLevelPrice = lvls.rangeLow;
    }
  }

  if (!candidateSide || !touchedLevel || testedLevelPrice === null) {
    return baseEntry({
      stageReached: 'C1',
      failLabel: 'C1 no level',
    });
  }

  // ==========================================
  // Step 2: Candle 2 silence (09:45 bar)
  // ==========================================
  if (!c2) {
    return baseEntry({
      side: candidateSide,
      stageReached: 'C2',
      touchedLevel,
      failLabel: 'No data',
    });
  }

  if (candidateSide === 'SELL') {
    const isBearishC2 = c2.close < c2.open;
    if (!isBearishC2) {
      return baseEntry({
        side: candidateSide,
        stageReached: 'C2',
        touchedLevel,
        failLabel: 'C2 same colour',
      });
    }

    const maxAllowed = testedLevelPrice * (1 + rules.levelTolPct);
    const brokeLevel =
      rules.breakRule === 'wick' ? c2.high > maxAllowed : c2.close > maxAllowed;
    if (brokeLevel) {
      return baseEntry({
        side: candidateSide,
        stageReached: 'C2',
        touchedLevel,
        failLabel: 'C2 broke level',
      });
    }
  } else {
    const isBullishC2 = c2.close > c2.open;
    if (!isBullishC2) {
      return baseEntry({
        side: candidateSide,
        stageReached: 'C2',
        touchedLevel,
        failLabel: 'C2 same colour',
      });
    }

    const minAllowed = testedLevelPrice * (1 - rules.levelTolPct);
    const brokeLevel =
      rules.breakRule === 'wick' ? c2.low < minAllowed : c2.close < minAllowed;
    if (brokeLevel) {
      return baseEntry({
        side: candidateSide,
        stageReached: 'C2',
        touchedLevel,
        failLabel: 'C2 broke level',
      });
    }
  }

  // ==========================================
  // Step 3: Trigger (10:00, 10:15, 10:30 bars up to triggerCutoff)
  // ==========================================
  let entry: number;
  let stop: number;
  let target: number;
  let risk: number;

  if (candidateSide === 'SELL') {
    entry = Number(c2.low.toFixed(4));
    stop = Number((c2.high + rules.stopOffset).toFixed(4));
    target =
      rules.targetMode === 'flip' && lvls.flipLow !== null
        ? lvls.flipLow
        : lvls.rangeLow;
    risk = stop - entry;
  } else {
    entry = Number(c2.high.toFixed(4));
    stop = Number((c2.low - rules.stopOffset).toFixed(4));
    target =
      rules.targetMode === 'flip' && lvls.flipHigh !== null
        ? lvls.flipHigh
        : lvls.rangeHigh;
    risk = entry - stop;
  }

  const plannedR =
    risk > 0
      ? Number(
          (
            (candidateSide === 'SELL' ? entry - target : target - entry) / risk
          ).toFixed(2)
        )
      : null;

  const cutoffHHMM = (rules.triggerCutoff || '10:45').trim().slice(0, 5);
  const triggerWindowBars = sortedBars.filter((b) => {
    const hhmm = b.nyTime.slice(0, 5);
    return hhmm >= '10:00' && hhmm < cutoffHHMM;
  });

  if (triggerWindowBars.length === 0) {
    return baseEntry({
      side: candidateSide,
      stageReached: 'Trigger',
      touchedLevel,
      failLabel: 'Expired',
      entry,
      stop,
      target,
      plannedR,
    });
  }

  let triggeredBar: Intraday15mBar | null = null;

  for (const bar of triggerWindowBars) {
    if (candidateSide === 'SELL') {
      const exceedsC2High = bar.high > c2.high;
      const reachesEntry = bar.low <= entry;
      if (exceedsC2High && reachesEntry) {
        return baseEntry({
          side: candidateSide,
          stageReached: 'Trigger',
          touchedLevel,
          failLabel: 'Ambiguous: check 1-minute',
          entry,
          stop,
          target,
          plannedR,
        });
      }
      if (exceedsC2High) {
        return baseEntry({
          side: candidateSide,
          stageReached: 'Trigger',
          touchedLevel,
          failLabel: 'Invalidated',
          entry,
          stop,
          target,
          plannedR,
        });
      }
      if (reachesEntry) {
        triggeredBar = bar;
        break;
      }
    } else {
      const breaksC2Low = bar.low < c2.low;
      const reachesEntry = bar.high >= entry;
      if (breaksC2Low && reachesEntry) {
        return baseEntry({
          side: candidateSide,
          stageReached: 'Trigger',
          touchedLevel,
          failLabel: 'Ambiguous: check 1-minute',
          entry,
          stop,
          target,
          plannedR,
        });
      }
      if (breaksC2Low) {
        return baseEntry({
          side: candidateSide,
          stageReached: 'Trigger',
          touchedLevel,
          failLabel: 'Invalidated',
          entry,
          stop,
          target,
          plannedR,
        });
      }
      if (reachesEntry) {
        triggeredBar = bar;
        break;
      }
    }
  }

  if (!triggeredBar) {
    return baseEntry({
      side: candidateSide,
      stageReached: 'Trigger',
      touchedLevel,
      failLabel: 'Expired',
      entry,
      stop,
      target,
      plannedR,
    });
  }

  // ==========================================
  // Step 4: Mechanical outcome (triggered only)
  // Walk forward through 15-minute bars to the 16:00 close
  // ==========================================
  if (risk <= 0 || plannedR === null) {
    return baseEntry({
      side: candidateSide,
      stageReached: 'Outcome',
      touchedLevel,
      failLabel: 'Ambiguous',
      entry,
      stop,
      target,
      plannedR,
      mechanicalResultR: null,
      mfeR: 0,
    });
  }

  let maxFavDollar =
    candidateSide === 'SELL'
      ? Math.max(0, entry - triggeredBar.low)
      : Math.max(0, triggeredBar.high - entry);

  // Check if target was already reached on the trigger bar itself
  const triggerBarHitTarget =
    candidateSide === 'SELL'
      ? triggeredBar.low <= target
      : triggeredBar.high >= target;
  if (triggerBarHitTarget) {
    const mfeR = Number((maxFavDollar / risk).toFixed(2));
    return baseEntry({
      side: candidateSide,
      stageReached: 'Outcome',
      touchedLevel,
      failLabel: 'Target hit',
      entry,
      stop,
      target,
      plannedR,
      mechanicalResultR: plannedR,
      mfeR,
    });
  }

  const postTriggerBars = sortedBars.filter(
    (b) => b.nyTime > triggeredBar!.nyTime && b.nyTime < '16:00:00'
  );

  for (const bar of postTriggerBars) {
    const barFavDollar =
      candidateSide === 'SELL'
        ? Math.max(0, entry - bar.low)
        : Math.max(0, bar.high - entry);
    maxFavDollar = Math.max(maxFavDollar, barFavDollar);

    const stopHit =
      candidateSide === 'SELL' ? bar.high >= stop : bar.low <= stop;
    const targetHit =
      candidateSide === 'SELL' ? bar.low <= target : bar.high >= target;

    if (stopHit && targetHit) {
      return baseEntry({
        side: candidateSide,
        stageReached: 'Outcome',
        touchedLevel,
        failLabel: 'Ambiguous',
        entry,
        stop,
        target,
        plannedR,
        mechanicalResultR: null,
        mfeR: Number((maxFavDollar / risk).toFixed(2)),
      });
    }

    if (stopHit) {
      return baseEntry({
        side: candidateSide,
        stageReached: 'Outcome',
        touchedLevel,
        failLabel: 'Stop hit',
        entry,
        stop,
        target,
        plannedR,
        mechanicalResultR: -1,
        mfeR: Number((maxFavDollar / risk).toFixed(2)),
      });
    }

    if (targetHit) {
      return baseEntry({
        side: candidateSide,
        stageReached: 'Outcome',
        touchedLevel,
        failLabel: 'Target hit',
        entry,
        stop,
        target,
        plannedR,
        mechanicalResultR: plannedR,
        mfeR: Number((maxFavDollar / risk).toFixed(2)),
      });
    }
  }

  // Neither hit by the 16:00 close -> exit at the 16:00 close (last regular-session bar's close)
  const lastSessionBar =
    postTriggerBars.length > 0
      ? postTriggerBars[postTriggerBars.length - 1]
      : triggeredBar;
  const closeDollarMove =
    candidateSide === 'SELL'
      ? entry - lastSessionBar.close
      : lastSessionBar.close - entry;
  const closeResultR = Number((closeDollarMove / risk).toFixed(2));
  const mfeR = Number((maxFavDollar / risk).toFixed(2));

  return baseEntry({
    side: candidateSide,
    stageReached: 'Outcome',
    touchedLevel,
    failLabel: 'Close exit',
    entry,
    stop,
    target,
    plannedR,
    mechanicalResultR: closeResultR,
    mfeR,
  });
}

function summarizeGroup(
  groupLabel: 'Shortlisted' | 'Not shortlisted',
  entries: SetupLogEntry[]
): SetupLogGroupSummary {
  const graded = entries.filter((e) => e.failLabel !== 'No data');
  const distinctDates = new Set(graded.map((e) => e.date));

  const c1Passed = graded.filter(
    (e) =>
      e.stageReached === 'C2' ||
      e.stageReached === 'Trigger' ||
      e.stageReached === 'Outcome'
  );
  const fullSetups = graded.filter(
    (e) => e.stageReached === 'Trigger' || e.stageReached === 'Outcome'
  );
  const triggered = graded.filter((e) => e.stageReached === 'Outcome');

  const withMechR = triggered.filter(
    (e): e is SetupLogEntry & { mechanicalResultR: number } =>
      typeof e.mechanicalResultR === 'number' &&
      !Number.isNaN(e.mechanicalResultR)
  );
  const expectancyR =
    withMechR.length > 0
      ? Number(
          (
            withMechR.reduce((sum, e) => sum + e.mechanicalResultR, 0) /
            withMechR.length
          ).toFixed(2)
        )
      : null;

  const takenWithActualR = entries.filter(
    (e): e is SetupLogEntry & { actualR: number } =>
      e.taken === true &&
      typeof e.actualR === 'number' &&
      !Number.isNaN(e.actualR)
  );
  const avgActualR =
    takenWithActualR.length > 0
      ? Number(
          (
            takenWithActualR.reduce((sum, e) => sum + e.actualR, 0) /
            takenWithActualR.length
          ).toFixed(2)
        )
      : null;

  return {
    groupLabel,
    entriesCount: graded.length,
    sessionsGraded: distinctDates.size,
    c1PassCount: c1Passed.length,
    c1PassRatePct:
      graded.length > 0
        ? Number(((c1Passed.length / graded.length) * 100).toFixed(1))
        : null,
    fullSetupCount: fullSetups.length,
    fullSetupRatePct:
      graded.length > 0
        ? Number(((fullSetups.length / graded.length) * 100).toFixed(1))
        : null,
    triggeredCount: triggered.length,
    expectancyR,
    expectancySampleN: withMechR.length,
    avgActualR,
    actualTakenCount: takenWithActualR.length,
  };
}

/**
 * Section 8: Computes the summary strip metrics separately for shortlisted and not-shortlisted symbols.
 */
export function summarizeSetupLog(entries: SetupLogEntry[]): SetupLogSummary {
  const shortlisted = entries.filter((e) => e.inShortlist);
  const notShortlisted = entries.filter((e) => !e.inShortlist);
  return {
    shortlisted: summarizeGroup('Shortlisted', shortlisted),
    notShortlisted: summarizeGroup('Not shortlisted', notShortlisted),
  };
}

export const SETUP_LOG_CSV_COLUMNS: (keyof SetupLogEntry)[] = [
  'id',
  'date',
  'symbol',
  'sectorSymbol',
  'sector',
  'inShortlist',
  'shortlistRank',
  'shortlistScore',
  'side',
  'fh',
  'rh',
  'rl',
  'fl',
  'firstCandleAvg',
  'stageReached',
  'touchedLevel',
  'failLabel',
  'entry',
  'stop',
  'target',
  'plannedR',
  'mechanicalResultR',
  'mfeR',
  'rulesVersion',
  'taken',
  'actualEntry',
  'actualExit',
  'actualR',
  'notes',
];

function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  const str = String(val);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Section 8: Exports the entire setup log to CSV with one row per entry and every stored field as a column.
 */
export function exportSetupLogToCsv(entries: SetupLogEntry[]): string {
  const header = SETUP_LOG_CSV_COLUMNS.join(',');
  const sorted = [...entries].sort((a, b) => {
    if (b.date !== a.date) return b.date.localeCompare(a.date);
    if (a.inShortlist !== b.inShortlist) return a.inShortlist ? -1 : 1;
    if ((a.shortlistRank ?? 999) !== (b.shortlistRank ?? 999)) {
      return (a.shortlistRank ?? 999) - (b.shortlistRank ?? 999);
    }
    return a.symbol.localeCompare(b.symbol);
  });

  const rows = sorted.map((entry) =>
    SETUP_LOG_CSV_COLUMNS.map((col) => escapeCsvCell(entry[col])).join(',')
  );
  return [header, ...rows].join('\n');
}

