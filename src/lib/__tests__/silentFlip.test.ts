import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildShortlist,
  computeBenchHealth,
  computeLevels,
  DEFAULT_SILENT_FLIP_RULES,
  deriveMorningCheckpoints,
  exportSetupLogToCsv,
  formatCopyLevelsLine,
  gradeSilentFlipSession,
  mapExchangeToTradingView,
  SETUP_LOG_CSV_COLUMNS,
  summarizeSetupLog,
  SymbolShortlistInput,
  updateSilentFlipRules,
} from '../silentFlip.ts';
import { RawOHLCV } from '../volumeAnalytics.ts';
import {
  ComputedLevels,
  Intraday15mBar,
  SilentFlipBenchItem,
} from '../../types/market.ts';

function makeBar(
  date: string,
  high: number,
  low: number,
  close = (high + low) / 2,
  open = (high + low) / 2,
  volume = 10_000_000
): RawOHLCV {
  return { date, open, high, low, close, volume };
}

test('computeLevels: strategy video Nvidia sanity case yields RH 228, RL 218, FH 230, FL 216', () => {
  const bars: RawOHLCV[] = [
    makeBar('2026-11-12', 235, 212, 220),
    makeBar('2026-11-13', 230, 219, 224), // D-3: high 230 > 228 * 1.0005 -> FH = 230
    makeBar('2026-11-16', 227, 216, 221), // D-2: low 216 < 218 * 0.9995 -> FL = 216
    makeBar('2026-11-17', 228, 218, 225), // D-1: RH = 228, RL = 218
  ];

  const levels = computeLevels(bars, '2026-11-17', 2.5);
  assert.ok(levels);
  assert.equal(levels.rangeHigh, 228);
  assert.equal(levels.rangeLow, 218);
  assert.equal(levels.flipHigh, 230);
  assert.equal(levels.flipHighDate, '2026-11-13');
  assert.equal(levels.flipLow, 216);
  assert.equal(levels.flipLowDate, '2026-11-16');
  assert.equal(levels.rangeWidth, 10);
  assert.equal(levels.sellZoneWidth, 2);
  assert.equal(levels.buyZoneWidth, 2);
  assert.equal(levels.firstCandleAvg, 2.5);
  assert.equal(levels.rangeInCandles, 4);
});

test('computeLevels: normal case picks nearest earlier high/low, not the biggest', () => {
  const bars: RawOHLCV[] = [
    makeBar('2026-11-10', 150, 80, 110), // Bigger high/low earlier in history
    makeBar('2026-11-11', 105, 92, 98),  // Nearest higher high (105) & lower low (92)
    makeBar('2026-11-12', 100, 95, 97),  // D-1: RH = 100, RL = 95
  ];

  const levels = computeLevels(bars, '2026-11-12', 1.0);
  assert.ok(levels);
  assert.equal(levels.rangeHigh, 100);
  assert.equal(levels.rangeLow, 95);
  assert.equal(levels.flipHigh, 105);
  assert.equal(levels.flipHighDate, '2026-11-11');
  assert.equal(levels.flipLow, 92);
  assert.equal(levels.flipLowDate, '2026-11-11');
});

test('computeLevels: no Flip High within 120 sessions returns flipHigh = null', () => {
  const bars: RawOHLCV[] = [];
  // Session 121 back from D-1 has a higher high (300), which is outside the 120-session walk from D-2
  const baseDate = new Date(Date.UTC(2026, 0, 1));
  for (let i = 0; i <= 125; i++) {
    const d = new Date(baseDate.getTime() + i * 86400_000)
      .toISOString()
      .slice(0, 10);
    if (i === 0) {
      // 125 sessions before D-1 (outside 120-session lookback)
      bars.push(makeBar(d, 300, 90, 150));
    } else if (i < 125) {
      // All 120 sessions before D-1 have highs <= 180 and lows >= 100
      bars.push(makeBar(d, 180, 105, 150));
    } else {
      // D-1 (index 125) is at a 6-month high: RH = 200, RL = 110
      bars.push(makeBar(d, 200, 110, 195));
    }
  }

  const dMinus1Date = bars[bars.length - 1].date;
  const levels = computeLevels(bars, dMinus1Date, 2.0);
  assert.ok(levels);
  assert.equal(levels.rangeHigh, 200);
  assert.equal(levels.flipHigh, null);
  assert.equal(levels.flipHighDate, null);
  assert.equal(levels.sellZoneWidth, null);
  assert.equal(levels.flipLow, 105);
});

test('computeLevels: ignores today partial bar when present in array', () => {
  const bars: RawOHLCV[] = [
    makeBar('2026-11-13', 112, 96, 104),
    makeBar('2026-11-16', 108, 99, 103),
    makeBar('2026-11-17', 110, 100, 105), // D-1 completed session
    makeBar('2026-11-18', 125, 85, 120),  // Today's partial bar — MUST be ignored when asOfSession = 2026-11-17
  ];

  const levels = computeLevels(bars, '2026-11-17', 2.0);
  assert.ok(levels);
  assert.equal(levels.asOfSession, '2026-11-17');
  assert.equal(levels.rangeHigh, 110);
  assert.equal(levels.rangeLow, 100);
  assert.equal(levels.flipHigh, 112);
  assert.equal(levels.flipHighDate, '2026-11-13');
  assert.equal(levels.flipLow, 99);
  assert.equal(levels.flipLowDate, '2026-11-16');
});

test('computeLevels: skips old high/low within 0.05% tolerance of RH/RL', () => {
  // RH = 100.00 -> threshold is 100 * 1.0005 = 100.05
  // RL = 90.00 -> threshold is 90 * 0.9995 = 89.955
  const bars: RawOHLCV[] = [
    makeBar('2026-11-12', 100.06, 89.95, 95), // Outside 0.05% tolerance -> valid FH & FL
    makeBar('2026-11-13', 100.05, 89.96, 95), // Equal to / inside 0.05% tolerance -> MUST be skipped
    makeBar('2026-11-16', 100.02, 89.99, 95), // Inside 0.05% tolerance -> MUST be skipped
    makeBar('2026-11-17', 100.0, 90.0, 95),   // D-1
  ];

  const levels = computeLevels(bars, '2026-11-17', 1.5);
  assert.ok(levels);
  assert.equal(levels.flipHigh, 100.06);
  assert.equal(levels.flipHighDate, '2026-11-12');
  assert.equal(levels.flipLow, 89.95);
  assert.equal(levels.flipLowDate, '2026-11-12');
});

test('computeLevels: handles weekend and holiday gap between D-1 and D-2 seamlessly', () => {
  // Thanksgiving 2026-11-26 + Black Friday 2026-11-27 + Weekend -> Monday 2026-11-30
  const bars: RawOHLCV[] = [
    makeBar('2026-11-24', 158, 142, 150),
    makeBar('2026-11-25', 155, 145, 149), // Wednesday before Thanksgiving (D-2 if Friday absent or D-3)
    makeBar('2026-11-30', 152, 146, 150), // Monday D-1 after multi-day gap
  ];

  const levels = computeLevels(bars, '2026-11-30', 1.5);
  assert.ok(levels);
  assert.equal(levels.rangeHigh, 152);
  assert.equal(levels.rangeLow, 146);
  assert.equal(levels.flipHigh, 155);
  assert.equal(levels.flipHighDate, '2026-11-25');
  assert.equal(levels.flipLow, 145);
  assert.equal(levels.flipLowDate, '2026-11-25');
});

function buildMockInput(params: {
  symbol: string;
  dailyStatus?: 'ok' | 'stale' | 'unavailable';
  intradayStatus?: 'ok' | 'stale' | 'unavailable';
  premarketStatus?: 'ok' | 'stale' | 'unavailable';
  premarketPrice?: number | null;
  rh?: number;
  rl?: number;
  fh?: number | null;
  fl?: number | null;
  firstCandleAvg?: number | null;
  highRespectRate?: number;
  highTouches?: number;
  lowRespectRate?: number;
  lowTouches?: number;
  earningsEvents?: { symbol: string; date: string; hour: string }[];
  exchangeName?: string;
}): SymbolShortlistInput {
  const rh = params.rh ?? 228;
  const rl = params.rl ?? 218;
  const fh = params.fh === undefined ? 230 : params.fh;
  const fl = params.fl === undefined ? 216 : params.fl;
  const A = params.firstCandleAvg === undefined ? 2.5 : params.firstCandleAvg;
  const rangeWidth = rh - rl;
  const rangeInCandles = A && A > 0 ? rangeWidth / A : null;

  return {
    daily: {
      symbol: params.symbol,
      dataStatus: params.dailyStatus ?? 'ok',
      asOfSession: '2026-11-17',
      fetchedAt: '2026-11-18T13:00:00Z',
      bars: [],
      lastPrice: 225,
      exchangeName: params.exchangeName ?? 'NMS',
    },
    intraday15m: {
      symbol: params.symbol,
      dataStatus: params.intradayStatus ?? 'ok',
      asOfSession: '2026-11-17',
      fetchedAt: '2026-11-18T13:00:00Z',
      sessions: [],
    },
    premarket: {
      symbol: params.symbol,
      dataStatus: params.premarketStatus ?? 'ok',
      fetchedAt: '2026-11-18T13:00:00Z',
      nyDate: '2026-11-18',
      nyTime: '09:10:00',
      price: params.premarketPrice === undefined ? 228.5 : params.premarketPrice,
      volume: 150000,
      sourceWindow: 'premarket_0400_0930',
    },
    earnings: {
      symbol: params.symbol,
      dataStatus: 'ok',
      fetchedAt: '2026-11-18T13:00:00Z',
      providerConfigured: true,
      events: params.earningsEvents ?? [],
    },
    levels: {
      asOfSession: '2026-11-17',
      dMinus1Close: 225,
      isHalfDaySession: false,
      rangeHigh: rh,
      rangeHighDate: '2026-11-17',
      rangeLow: rl,
      rangeLowDate: '2026-11-17',
      flipHigh: fh,
      flipHighDate: fh !== null ? '2026-11-13' : null,
      flipLow: fl,
      flipLowDate: fl !== null ? '2026-11-16' : null,
      rangeWidth,
      rangeWidthPct: (rangeWidth / 225) * 100,
      sellZoneWidth: fh !== null ? fh - rh : null,
      buyZoneWidth: fl !== null ? rl - fl : null,
      firstCandleAvg: A,
      rangeInCandles,
    },
    health: {
      symbol: params.symbol,
      avgVolume20D: 25_000_000,
      price: 225,
      atr14: 5.5,
      atrPct14: 2.44,
      firstCandleAvgDollar: A,
      firstCandleAvgPct: A ? (A / 225) * 100 : null,
      firstCandleSampleSize: 60,
      levelTouches60D: 20,
      levelRespCount60D: 14,
      respectRate60D: 0.7,
      highSideTouches60D: params.highTouches ?? 10,
      highSideRespCount60D: Math.round(
        (params.highTouches ?? 10) * (params.highRespectRate ?? 0.7)
      ),
      highSideRespectRate60D: params.highRespectRate ?? 0.7,
      lowSideTouches60D: params.lowTouches ?? 10,
      lowSideRespCount60D: Math.round(
        (params.lowTouches ?? 10) * (params.lowRespectRate ?? 0.6)
      ),
      lowSideRespectRate60D: params.lowRespectRate ?? 0.6,
      historicalSetups60D: 4,
      flags: {
        lowVolume: false,
        lowPrice: false,
        atrOutOfBounds: false,
        lowTouches: false,
        lowRespectRate: false,
        anyAmber: false,
      },
    },
  };
}

test('buildShortlist: evaluates T1-T5 fail labels accurately and never includes a failing stock', () => {
  const bench: SilentFlipBenchItem[] = [
    { symbol: 'FAIL_T1', name: 'Fail Data', sectorSymbol: 'XLK', sectorName: 'Technology' },
    { symbol: 'FAIL_T2_EARN', name: 'Fail Earnings', sectorSymbol: 'XLK', sectorName: 'Technology' },
    { symbol: 'FAIL_T2_NEWS', name: 'Fail News', sectorSymbol: 'XLC', sectorName: 'Comm Services' },
    { symbol: 'FAIL_T3', name: 'Fail Flip', sectorSymbol: 'XLF', sectorName: 'Financials' },
    { symbol: 'FAIL_T4', name: 'Fail Narrow', sectorSymbol: 'XLV', sectorName: 'Health Care' },
    { symbol: 'FAIL_T5_MID', name: 'Fail Midrange', sectorSymbol: 'XLE', sectorName: 'Energy' },
    { symbol: 'FAIL_T5_GAP', name: 'Fail Gapped', sectorSymbol: 'XLI', sectorName: 'Industrials' },
    { symbol: 'PASS_SELL', name: 'Pass Sell', sectorSymbol: 'XLY', sectorName: 'Cons Discretionary' },
  ];

  const inputs: Record<string, SymbolShortlistInput> = {
    FAIL_T1: buildMockInput({ symbol: 'FAIL_T1', premarketStatus: 'unavailable', premarketPrice: null }),
    FAIL_T2_EARN: buildMockInput({
      symbol: 'FAIL_T2_EARN',
      earningsEvents: [{ symbol: 'FAIL_T2_EARN', date: '2026-11-18', hour: 'bmo' }],
    }),
    FAIL_T2_NEWS: buildMockInput({ symbol: 'FAIL_T2_NEWS' }),
    FAIL_T3: buildMockInput({ symbol: 'FAIL_T3', fh: null, fl: null }),
    FAIL_T4: buildMockInput({ symbol: 'FAIL_T4', rh: 222, rl: 218, firstCandleAvg: 2.0 }), // rangeWidth=4, A=2 -> 2.0 candles < 3.0
    FAIL_T5_MID: buildMockInput({ symbol: 'FAIL_T5_MID', premarketPrice: 223.0 }), // Between RL+A (220.5) and RH-A (225.5)
    FAIL_T5_GAP: buildMockInput({ symbol: 'FAIL_T5_GAP', premarketPrice: 235.0 }), // > FH + A (232.5)
    PASS_SELL: buildMockInput({ symbol: 'PASS_SELL', premarketPrice: 228.5 }), // Inside [RH, FH]
  };

  const res = buildShortlist(
    bench,
    inputs,
    { excludeNewsBySymbol: { FAIL_T2_NEWS: true }, usDataRelease0830: true },
    '2026-11-18'
  );

  assert.equal(res.shortlist.length, 1);
  assert.equal(res.shortlist[0].symbol, 'PASS_SELL');
  assert.equal(res.onlyNCandidatesNote, 'Only 1 candidates today');
  assert.equal(res.dataDayBanner, 'Data day: consider half size');

  const bySym = Object.fromEntries(res.benchRows.map((r) => [r.symbol, r]));
  assert.equal(bySym.FAIL_T1.tests.T1.failLabel, 'No data: pre-market');
  assert.equal(bySym.FAIL_T2_EARN.tests.T2.failLabel, 'Earnings 2026-11-18 BMO');
  assert.equal(bySym.FAIL_T2_NEWS.tests.T2.failLabel, 'Excluded: news');
  assert.equal(bySym.FAIL_T3.tests.T3.failLabel, 'No Flip level');
  assert.equal(bySym.FAIL_T4.tests.T4.failLabel, 'Range too narrow (2.0 candles)');
  assert.equal(bySym.FAIL_T5_MID.tests.T5.failLabel, 'Mid-range, out of reach');
  assert.equal(bySym.FAIL_T5_GAP.tests.T5.failLabel, 'Gapped beyond levels');
});

test('buildShortlist: enforces max 2 per sector and max 8 total cap, and computes scores accurately', () => {
  // Create 11 passing candidates across 5 sectors (3 in XLK, 2 in each of XLC, XLY, XLF, XLV)
  const bench: SilentFlipBenchItem[] = [
    { symbol: 'XLK1', name: 'Tech 1', sectorSymbol: 'XLK', sectorName: 'Technology' },
    { symbol: 'XLK2', name: 'Tech 2', sectorSymbol: 'XLK', sectorName: 'Technology' },
    { symbol: 'XLK3', name: 'Tech 3', sectorSymbol: 'XLK', sectorName: 'Technology' },
    { symbol: 'XLC1', name: 'Comm 1', sectorSymbol: 'XLC', sectorName: 'Comm Services' },
    { symbol: 'XLC2', name: 'Comm 2', sectorSymbol: 'XLC', sectorName: 'Comm Services' },
    { symbol: 'XLY1', name: 'Disc 1', sectorSymbol: 'XLY', sectorName: 'Cons Discretionary' },
    { symbol: 'XLY2', name: 'Disc 2', sectorSymbol: 'XLY', sectorName: 'Cons Discretionary' },
    { symbol: 'XLF1', name: 'Fin 1', sectorSymbol: 'XLF', sectorName: 'Financials' },
    { symbol: 'XLF2', name: 'Fin 2', sectorSymbol: 'XLF', sectorName: 'Financials' },
    { symbol: 'XLV1', name: 'Health 1', sectorSymbol: 'XLV', sectorName: 'Health Care' },
    { symbol: 'XLV2', name: 'Health 2', sectorSymbol: 'XLV', sectorName: 'Health Care' },
  ];

  const inputs: Record<string, SymbolShortlistInput> = {};
  bench.forEach((b, idx) => {
    // Give descending respect rates so order matches bench order
    inputs[b.symbol] = buildMockInput({
      symbol: b.symbol,
      premarketPrice: 228.5, // Inside [228, 230] -> Reach = 40
      highRespectRate: 0.9 - idx * 0.03,
      highTouches: 10,
    });
  });

  const res = buildShortlist(
    bench,
    inputs,
    { excludeNewsBySymbol: {}, usDataRelease0830: false },
    '2026-11-18'
  );

  // Should cap at 8 total, and XLK3 must be skipped because XLK already has 2 (XLK1, XLK2)
  assert.equal(res.shortlist.length, 8);
  const selectedSymbols = res.shortlist.map((s) => s.symbol);
  assert.ok(!selectedSymbols.includes('XLK3'));

  const xlkCount = res.shortlist.filter((s) => s.sectorSymbol === 'XLK').length;
  assert.equal(xlkCount, 2);

  // Since all 8 selected are SELL side (>= 6 share one side), directionBalanceHint should trigger
  assert.equal(
    res.directionBalanceHint,
    'Shortlist leans SELL: a strong market move could fail them together.'
  );
});

test('mapExchangeToTradingView and deriveMorningCheckpoints follow Section 7 rules', () => {
  assert.deepEqual(mapExchangeToTradingView('NMS'), { prefix: 'NASDAQ' });
  assert.deepEqual(mapExchangeToTradingView('NGM'), { prefix: 'NASDAQ' });
  assert.deepEqual(mapExchangeToTradingView('NCM'), { prefix: 'NASDAQ' });
  assert.deepEqual(mapExchangeToTradingView('NYQ'), { prefix: 'NYSE' });
  assert.deepEqual(mapExchangeToTradingView('ASE'), { prefix: 'AMEX' });
  assert.deepEqual(mapExchangeToTradingView('PCX'), { prefix: 'AMEX' });
  assert.equal(mapExchangeToTradingView('LSE').prefix, null);
  assert.ok(mapExchangeToTradingView('LSE').error);

  // Standard winter date (5h gap: 09:15 NY -> 14:15 UK)
  const novCheckpoints = deriveMorningCheckpoints('2026-11-18');
  assert.equal(novCheckpoints[0].nyTime, '09:15');
  assert.equal(novCheckpoints[0].ukTime, '14:15');
  assert.equal(novCheckpoints[1].nyTime, '09:30');
  assert.equal(novCheckpoints[1].ukTime, '14:30');
  assert.equal(novCheckpoints[4].nyTime, '10:45');
  assert.equal(novCheckpoints[4].ukTime, '15:45');

  // US/UK DST transition week in March (US is on EDT UTC-4, UK still on GMT UTC+0 -> 4h gap: 09:15 NY -> 13:15 UK)
  const marCheckpoints = deriveMorningCheckpoints('2026-03-16');
  assert.equal(marCheckpoints[0].nyTime, '09:15');
  assert.equal(marCheckpoints[0].ukTime, '13:15');
});

// =========================================================
// Phase 3 (Section 8 & 9): Auto-Grader & Setup Log Tests
// =========================================================

const BASE_GRADER_LEVELS: ComputedLevels = {
  asOfSession: '2026-11-17',
  dMinus1Close: 225,
  isHalfDaySession: false,
  rangeHigh: 228,
  rangeHighDate: '2026-11-17',
  rangeLow: 218,
  rangeLowDate: '2026-11-17',
  flipHigh: 230,
  flipHighDate: '2026-11-13',
  flipLow: 216,
  flipLowDate: '2026-11-16',
  rangeWidth: 10,
  rangeWidthPct: (10 / 225) * 100,
  sellZoneWidth: 2,
  buyZoneWidth: 2,
  firstCandleAvg: 2.0, // A = 2.0
  rangeInCandles: 5.0,
};

function make15mBar(
  nyTime: string,
  open: number,
  high: number,
  low: number,
  close: number,
  nyDate = '2026-11-18'
): Intraday15mBar {
  return {
    timestamp: 1763476200,
    nyDate,
    nyTime,
    open,
    high,
    low,
    close,
    volume: 500_000,
  };
}

test('gradeSilentFlipSession: covers C1 weak and C1 no level', () => {
  // 1) C1 weak: range = 1.5 < 1.0 * A (2.0), or body/range < 0.60
  const weakBars: Intraday15mBar[] = [
    make15mBar('09:30:00', 227.0, 228.2, 226.8, 227.3), // range=1.4 < 2.0, body=0.3
    make15mBar('09:45:00', 227.3, 227.5, 226.5, 226.8),
  ];
  const weakRes = gradeSilentFlipSession({
    date: '2026-11-18',
    symbol: 'NVDA',
    sectorSymbol: 'XLK',
    sector: 'Technology',
    inShortlist: true,
    shortlistRank: 1,
    shortlistScore: 82.5,
    levels: BASE_GRADER_LEVELS,
    sessionBars15m: weakBars,
  });
  assert.equal(weakRes.stageReached, 'C1');
  assert.equal(weakRes.failLabel, 'C1 weak');

  // 2) C1 no level: strong bullish candle (range=2.5 >= 2.0, body=2.0 >= 0.6*2.5),
  //    but high=225.5 does not reach RH (228) within 0.05% tolerance
  const noLevelBars: Intraday15mBar[] = [
    make15mBar('09:30:00', 223.0, 225.5, 223.0, 225.0),
    make15mBar('09:45:00', 225.0, 225.2, 224.0, 224.2),
  ];
  const noLevelRes = gradeSilentFlipSession({
    date: '2026-11-18',
    symbol: 'NVDA',
    sectorSymbol: 'XLK',
    sector: 'Technology',
    inShortlist: true,
    shortlistRank: 1,
    shortlistScore: 82.5,
    levels: BASE_GRADER_LEVELS,
    sessionBars15m: noLevelBars,
  });
  assert.equal(noLevelRes.stageReached, 'C1');
  assert.equal(noLevelRes.failLabel, 'C1 no level');
});

test('gradeSilentFlipSession: covers C2 same colour and C2 broke level', () => {
  // Strong bullish C1 reaching RH=228: open=225.5, low=225.5, high=228.1, close=227.9 (range=2.6, body=2.4)
  const strongC1 = make15mBar('09:30:00', 225.5, 228.1, 225.5, 227.9);

  // 1) C2 same colour: C2 is also bullish (close 228.0 > open 227.5)
  const sameColourRes = gradeSilentFlipSession({
    date: '2026-11-18',
    symbol: 'NVDA',
    sectorSymbol: 'XLK',
    sector: 'Technology',
    inShortlist: true,
    shortlistRank: 1,
    shortlistScore: 82.5,
    levels: BASE_GRADER_LEVELS,
    sessionBars15m: [
      strongC1,
      make15mBar('09:45:00', 227.5, 228.1, 227.4, 228.0),
    ],
  });
  assert.equal(sameColourRes.stageReached, 'C2');
  assert.equal(sameColourRes.failLabel, 'C2 same colour');
  assert.equal(sameColourRes.touchedLevel, 'RH');

  // 2) C2 broke level under default breakRule='close':
  //    C2 is bearish (open 229.0, close 228.50 > RH * 1.0005 = 228.114)
  const brokeLevelRes = gradeSilentFlipSession({
    date: '2026-11-18',
    symbol: 'NVDA',
    sectorSymbol: 'XLK',
    sector: 'Technology',
    inShortlist: true,
    shortlistRank: 1,
    shortlistScore: 82.5,
    levels: BASE_GRADER_LEVELS,
    sessionBars15m: [
      strongC1,
      make15mBar('09:45:00', 229.0, 229.2, 228.4, 228.5),
    ],
  });
  assert.equal(brokeLevelRes.stageReached, 'C2');
  assert.equal(brokeLevelRes.failLabel, 'C2 broke level');
});

test('gradeSilentFlipSession: covers Invalidated, Expired, and Trigger Ambiguous bar', () => {
  // Strong bullish C1 touching RH=228
  const c1 = make15mBar('09:30:00', 225.5, 228.1, 225.5, 227.9);
  // Valid bearish C2 holding below RH=228: open=227.9, high=228.0, low=227.0, close=227.2
  // -> For SELL: Entry = 227.0, Stop = 228.02, Target = RL (218.0), Risk = 1.02, PlannedR = (227-218)/1.02 = 8.82
  const c2 = make15mBar('09:45:00', 227.9, 228.0, 227.0, 227.2);

  // 1) Invalidated: 10:00 bar high (228.2) exceeds C2 high (228.0) before low (227.3) reaches Entry (227.0)
  const invalidatedRes = gradeSilentFlipSession({
    date: '2026-11-18',
    symbol: 'NVDA',
    sectorSymbol: 'XLK',
    sector: 'Technology',
    inShortlist: true,
    shortlistRank: 1,
    shortlistScore: 82.5,
    levels: BASE_GRADER_LEVELS,
    sessionBars15m: [
      c1,
      c2,
      make15mBar('10:00:00', 227.4, 228.2, 227.3, 228.1),
      make15mBar('10:15:00', 228.1, 228.3, 226.5, 226.8),
    ],
  });
  assert.equal(invalidatedRes.stageReached, 'Trigger');
  assert.equal(invalidatedRes.failLabel, 'Invalidated');
  assert.equal(invalidatedRes.entry, 227.0);
  assert.equal(invalidatedRes.stop, 228.02);

  // 2) Expired: 10:00, 10:15, 10:30 bars neither exceed C2 high (228.0) nor reach Entry (227.0)
  const expiredRes = gradeSilentFlipSession({
    date: '2026-11-18',
    symbol: 'NVDA',
    sectorSymbol: 'XLK',
    sector: 'Technology',
    inShortlist: true,
    shortlistRank: 1,
    shortlistScore: 82.5,
    levels: BASE_GRADER_LEVELS,
    sessionBars15m: [
      c1,
      c2,
      make15mBar('10:00:00', 227.3, 227.8, 227.1, 227.5),
      make15mBar('10:15:00', 227.5, 227.9, 227.2, 227.4),
      make15mBar('10:30:00', 227.4, 227.7, 227.05, 227.3),
    ],
  });
  assert.equal(expiredRes.stageReached, 'Trigger');
  assert.equal(expiredRes.failLabel, 'Expired');

  // 3) Ambiguous trigger bar: 10:00 bar BOTH exceeds C2 high (228.2 > 228.0) AND reaches Entry (226.8 <= 227.0)
  const ambigTriggerRes = gradeSilentFlipSession({
    date: '2026-11-18',
    symbol: 'NVDA',
    sectorSymbol: 'XLK',
    sector: 'Technology',
    inShortlist: true,
    shortlistRank: 1,
    shortlistScore: 82.5,
    levels: BASE_GRADER_LEVELS,
    sessionBars15m: [
      c1,
      c2,
      make15mBar('10:00:00', 227.5, 228.2, 226.8, 227.0),
    ],
  });
  assert.equal(ambigTriggerRes.stageReached, 'Trigger');
  assert.equal(ambigTriggerRes.failLabel, 'Ambiguous: check 1-minute');
});

test('gradeSilentFlipSession: covers Triggered then target, Triggered then stop, Outcome Ambiguous bar, and Close exit', () => {
  // Setup SELL with risk = 1.00:
  // C1 strong bullish touching RH=228
  const c1 = make15mBar('09:30:00', 225.5, 228.1, 225.5, 227.9);
  // C2 bearish holding RH=228: low=227.02 (Entry=227.02), high=228.00 (Stop=228.02 -> risk=1.00), Target=RL=218.00 -> plannedR = 9.02
  const c2 = make15mBar('09:45:00', 227.9, 228.0, 227.02, 227.2);
  // 10:00 bar triggers entry cleanly (high=227.8 <= 228.0, low=226.5 <= 227.02)
  const triggerBar = make15mBar('10:00:00', 227.2, 227.8, 226.5, 226.6);

  // 1) Triggered then target: 10:30 bar reaches RL=218.00 without hitting Stop=228.02
  const targetHitRes = gradeSilentFlipSession({
    date: '2026-11-18',
    symbol: 'NVDA',
    sectorSymbol: 'XLK',
    sector: 'Technology',
    inShortlist: true,
    shortlistRank: 1,
    shortlistScore: 82.5,
    levels: BASE_GRADER_LEVELS,
    sessionBars15m: [
      c1,
      c2,
      triggerBar,
      make15mBar('10:15:00', 226.6, 227.0, 222.0, 222.5),
      make15mBar('10:30:00', 222.5, 223.0, 217.8, 218.2), // low 217.8 <= 218.0 -> Target hit!
    ],
  });
  assert.equal(targetHitRes.stageReached, 'Outcome');
  assert.equal(targetHitRes.failLabel, 'Target hit');
  assert.equal(targetHitRes.mechanicalResultR, 9.02);
  assert.ok((targetHitRes.mfeR ?? 0) >= 9.02);

  // 2) Triggered then stop: 10:15 bar moves favourably to 225.02 (+2R MFE), then 10:30 bar hits Stop=228.02
  const stopHitRes = gradeSilentFlipSession({
    date: '2026-11-18',
    symbol: 'NVDA',
    sectorSymbol: 'XLK',
    sector: 'Technology',
    inShortlist: true,
    shortlistRank: 1,
    shortlistScore: 82.5,
    levels: BASE_GRADER_LEVELS,
    sessionBars15m: [
      c1,
      c2,
      triggerBar,
      make15mBar('10:15:00', 226.6, 226.9, 225.02, 226.0), // +2.00R MFE
      make15mBar('10:30:00', 226.0, 228.1, 225.8, 228.05), // high 228.10 >= 228.02 -> Stop hit (-1R)
    ],
  });
  assert.equal(stopHitRes.stageReached, 'Outcome');
  assert.equal(stopHitRes.failLabel, 'Stop hit');
  assert.equal(stopHitRes.mechanicalResultR, -1);
  assert.equal(stopHitRes.mfeR, 2);

  // 3) Outcome Ambiguous bar: 10:15 bar hits BOTH Stop (high 228.5 >= 228.02) and Target (low 217.5 <= 218.0)
  const ambigOutcomeRes = gradeSilentFlipSession({
    date: '2026-11-18',
    symbol: 'NVDA',
    sectorSymbol: 'XLK',
    sector: 'Technology',
    inShortlist: true,
    shortlistRank: 1,
    shortlistScore: 82.5,
    levels: BASE_GRADER_LEVELS,
    sessionBars15m: [
      c1,
      c2,
      triggerBar,
      make15mBar('10:15:00', 226.6, 228.5, 217.5, 223.0),
    ],
  });
  assert.equal(ambigOutcomeRes.stageReached, 'Outcome');
  assert.equal(ambigOutcomeRes.failLabel, 'Ambiguous');
  assert.equal(ambigOutcomeRes.mechanicalResultR, null);

  // 4) Close exit: neither Stop (228.02) nor Target (218.00) hit by 16:00 close (15:45 bar closes at 223.02 -> +4.00R)
  const closeExitRes = gradeSilentFlipSession({
    date: '2026-11-18',
    symbol: 'NVDA',
    sectorSymbol: 'XLK',
    sector: 'Technology',
    inShortlist: true,
    shortlistRank: 1,
    shortlistScore: 82.5,
    levels: BASE_GRADER_LEVELS,
    sessionBars15m: [
      c1,
      c2,
      triggerBar,
      make15mBar('10:15:00', 226.6, 227.0, 221.02, 222.5), // low 221.02 -> +6.00R MFE
      make15mBar('15:45:00', 222.5, 224.0, 222.0, 223.02), // closes at 223.02 -> (227.02 - 223.02) / 1.00 = +4.00R
    ],
  });
  assert.equal(closeExitRes.stageReached, 'Outcome');
  assert.equal(closeExitRes.failLabel, 'Close exit');
  assert.equal(closeExitRes.mechanicalResultR, 4);
  assert.equal(closeExitRes.mfeR, 6);
});

test('Phase 3 checklist: re-grading is deterministic, rulesVersion increments without mutating old entries, and CSV exports all columns', () => {
  const c1 = make15mBar('09:30:00', 225.5, 228.1, 225.5, 227.9);
  const c2 = make15mBar('09:45:00', 227.9, 228.0, 227.02, 227.2);
  const triggerBar = make15mBar('10:00:00', 227.2, 227.8, 226.5, 226.6);
  const targetBar = make15mBar('10:30:00', 222.5, 223.0, 217.8, 218.2);

  // 1) Re-grading a day gives identical output (deterministic)
  const firstGrade = gradeSilentFlipSession({
    date: '2026-11-18',
    symbol: 'NVDA',
    sectorSymbol: 'XLK',
    sector: 'Technology',
    inShortlist: true,
    shortlistRank: 1,
    shortlistScore: 82.5,
    levels: BASE_GRADER_LEVELS,
    sessionBars15m: [c1, c2, triggerBar, targetBar],
    rules: DEFAULT_SILENT_FLIP_RULES,
  });

  const secondGrade = gradeSilentFlipSession({
    date: '2026-11-18',
    symbol: 'NVDA',
    sectorSymbol: 'XLK',
    sector: 'Technology',
    inShortlist: true,
    shortlistRank: 1,
    shortlistScore: 82.5,
    levels: BASE_GRADER_LEVELS,
    sessionBars15m: [c1, c2, triggerBar, targetBar],
    rules: DEFAULT_SILENT_FLIP_RULES,
  });

  assert.deepEqual(firstGrade, secondGrade);
  assert.equal(firstGrade.rulesVersion, 1);

  // 2) Changing a parameter in SILENT_FLIP_RULES increments rulesVersion; old entries keep their old version
  const updatedRules = updateSilentFlipRules(DEFAULT_SILENT_FLIP_RULES, {
    targetMode: 'flip',
  });
  assert.equal(updatedRules.rulesVersion, 2);
  assert.equal(firstGrade.rulesVersion, 1);

  const newEntryWithV2 = gradeSilentFlipSession({
    date: '2026-11-19',
    symbol: 'UBER',
    sectorSymbol: 'XLI',
    sector: 'Industrials',
    inShortlist: false,
    shortlistRank: null,
    shortlistScore: null,
    levels: BASE_GRADER_LEVELS,
    sessionBars15m: [c1, c2],
    rules: updatedRules,
    existingManual: {
      taken: true,
      actualEntry: 227.0,
      actualExit: 220.0,
      actualR: 6.86,
      notes: 'Clean silent candle hold, took 1/2 size',
    },
  });
  assert.equal(newEntryWithV2.rulesVersion, 2);
  assert.equal(firstGrade.rulesVersion, 1);

  // 3) Summary strip separates shortlisted vs not-shortlisted
  const summary = summarizeSetupLog([firstGrade, newEntryWithV2]);
  assert.equal(summary.shortlisted.entriesCount, 1);
  assert.equal(summary.shortlisted.triggeredCount, 1);
  assert.equal(summary.shortlisted.expectancyR, 9.02);
  assert.equal(summary.notShortlisted.entriesCount, 1);
  assert.equal(summary.notShortlisted.avgActualR, 6.86);

  // 4) CSV export opens in Excel/Sheets with one row per entry and every stored field as a column
  const csv = exportSetupLogToCsv([firstGrade, newEntryWithV2]);
  const lines = csv.split('\n');
  assert.equal(lines.length, 3); // Header + 2 entries
  assert.equal(lines[0], SETUP_LOG_CSV_COLUMNS.join(','));
  // Every stored field on SetupLogEntry is present in SETUP_LOG_CSV_COLUMNS
  const entryKeys = Object.keys(firstGrade);
  for (const k of entryKeys) {
    assert.ok(
      SETUP_LOG_CSV_COLUMNS.includes(k as any),
      `Missing field ${k} in CSV export columns`
    );
  }
});

