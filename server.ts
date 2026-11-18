import express from 'express';
import fs from 'fs';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import {
  DailyFeedFetchResult,
  fetchDailyBars1Y,
  fetchEarningsCalendar,
  fetchIntraday15m60D,
  fetchPreMarketLastPrice,
  getDataHealthReport,
  getMostRecentCompletedUSSession,
  nextNYSETradingDay,
  resetFeedHealthCounters,
} from './src/lib/marketData.ts';
import {
  buildShortlist,
  computeBenchHealth,
  computeLevels,
  DEFAULT_SILENT_FLIP_BENCH,
  DEFAULT_SILENT_FLIP_RULES,
  exportSetupLogToCsv,
  gradeSilentFlipSession,
  summarizeSetupLog,
  SymbolShortlistInput,
  updateSilentFlipRules,
} from './src/lib/silentFlip.ts';
import {
  buildMarketInstrument,
  buildUnavailableMarketInstrument,
  CORE_EQUITIES,
  GICS_SECTORS,
  InstrumentSeed,
} from './src/lib/volumeAnalytics.ts';
import {
  CheckpointSnapshot,
  EarningsFeedResult,
  Intraday15mFeedResult,
  LockedShortlistRecord,
  MarketInstrument,
  PreMarketQuoteResult,
  SetupLogEntry,
  ShortlistBuildResult,
  ShortlistOverrides,
  SilentFlipBenchItem,
  SilentFlipRules,
  VolumeAlertRule,
} from './src/types/market.ts';

const PORT = 3000;
const STORE_PATH = path.resolve(process.cwd(), '.volflow-store.json');

interface PersistentStore {
  customSeeds: InstrumentSeed[];
  journal: CheckpointSnapshot[];
  alerts: VolumeAlertRule[];
  SILENT_FLIP_BENCH: SilentFlipBenchItem[];
  silentFlipOverrides: ShortlistOverrides;
  lockedShortlists: Record<string, LockedShortlistRecord>;
  silentFlipRules: SilentFlipRules;
  setupLog: SetupLogEntry[];
  lastRefreshedAt?: string;
  liveValidatedVersion?: number;
}

const DEFAULT_ALERTS: VolumeAlertRule[] = [
  {
    id: 'alert-sustained-breakout',
    name: 'Strong Weekly Buying Breakout',
    scope: 'ALL',
    timeframe: '5D',
    baseline: '90D',
    minRvol: 1.25,
    minConsistency: 55,
    minConsecutiveDays: 1,
    regimeFilter: 'Breakout Expansion',
    enabled: true,
    createdAt: '2026-11-10',
  },
  {
    id: 'alert-stealth-coil',
    name: 'Quiet Buying / Stealth Accumulation',
    scope: 'ALL',
    timeframe: '5D',
    baseline: '90D',
    minRvol: 1.15,
    minConsistency: 50,
    minConsecutiveDays: 1,
    regimeFilter: 'Stealth Accumulation',
    enabled: true,
    createdAt: '2026-11-10',
  },
  {
    id: 'alert-sector-rotation',
    name: 'Sector Monthly Volume Inflow (20D)',
    scope: 'SECTORS',
    timeframe: '20D',
    baseline: '90D',
    minRvol: 1.15,
    minConsistency: 50,
    minConsecutiveDays: 0,
    regimeFilter: 'ANY',
    enabled: true,
    createdAt: '2026-11-11',
  },
  {
    id: 'alert-distribution-warning',
    name: 'Heavy Selling Warning',
    scope: 'STOCKS',
    timeframe: '5D',
    baseline: '90D',
    minRvol: 1.15,
    minConsistency: 40,
    minConsecutiveDays: 0,
    regimeFilter: 'Distribution Pressure',
    enabled: true,
    createdAt: '2026-11-11',
  },
];

function sanitizeCustomSeed(raw: any): InstrumentSeed | null {
  if (!raw || typeof raw.symbol !== 'string' || !raw.symbol.trim()) return null;
  return {
    symbol: raw.symbol.trim().toUpperCase(),
    name:
      typeof raw.name === 'string' && raw.name.trim()
        ? raw.name.trim()
        : raw.symbol.trim().toUpperCase(),
    isSectorETF: Boolean(raw.isSectorETF),
    sectorSymbol:
      typeof raw.sectorSymbol === 'string' ? raw.sectorSymbol : 'XLK',
    sectorName:
      typeof raw.sectorName === 'string' ? raw.sectorName : 'Technology',
    industry:
      typeof raw.industry === 'string'
        ? raw.industry
        : 'Custom Tracked Equity',
  };
}

function sanitizeBenchItem(raw: any): SilentFlipBenchItem | null {
  if (!raw || typeof raw.symbol !== 'string' || !raw.symbol.trim()) return null;
  const sym = raw.symbol.trim().toUpperCase();
  const secSym =
    typeof raw.sectorSymbol === 'string' ? raw.sectorSymbol.toUpperCase() : 'XLK';
  const secObj = GICS_SECTORS.find((s) => s.symbol === secSym) || GICS_SECTORS[0];
  return {
    symbol: sym,
    name:
      typeof raw.name === 'string' && raw.name.trim()
        ? raw.name.trim()
        : sym,
    sectorSymbol: secObj.symbol,
    sectorName: secObj.sectorName,
  };
}

function loadStore(): PersistentStore {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PersistentStore>;
      const cleanCustomSeeds = Array.isArray(parsed.customSeeds)
        ? (parsed.customSeeds.map(sanitizeCustomSeed).filter(Boolean) as InstrumentSeed[])
        : [];
      const cleanBench =
        Array.isArray(parsed.SILENT_FLIP_BENCH) &&
        parsed.SILENT_FLIP_BENCH.length > 0
          ? (parsed.SILENT_FLIP_BENCH.map(sanitizeBenchItem).filter(
              Boolean
            ) as SilentFlipBenchItem[])
          : [...DEFAULT_SILENT_FLIP_BENCH];

      const cleanOverrides: ShortlistOverrides = {
        excludeNewsBySymbol:
          parsed.silentFlipOverrides?.excludeNewsBySymbol ?? {},
        usDataRelease0830: Boolean(
          parsed.silentFlipOverrides?.usDataRelease0830
        ),
      };

      const cleanLocks: Record<string, LockedShortlistRecord> =
        parsed.lockedShortlists && typeof parsed.lockedShortlists === 'object'
          ? parsed.lockedShortlists
          : {};

      const cleanRules: SilentFlipRules =
        parsed.silentFlipRules &&
        typeof parsed.silentFlipRules === 'object' &&
        typeof parsed.silentFlipRules.rulesVersion === 'number'
          ? {
              ...DEFAULT_SILENT_FLIP_RULES,
              ...parsed.silentFlipRules,
            }
          : { ...DEFAULT_SILENT_FLIP_RULES };

      const cleanSetupLog: SetupLogEntry[] = Array.isArray(parsed.setupLog)
        ? parsed.setupLog
        : [];

      if (parsed.liveValidatedVersion !== 3) {
        return {
          customSeeds: cleanCustomSeeds,
          journal: [],
          alerts: DEFAULT_ALERTS,
          SILENT_FLIP_BENCH: cleanBench,
          silentFlipOverrides: cleanOverrides,
          lockedShortlists: cleanLocks,
          silentFlipRules: cleanRules,
          setupLog: cleanSetupLog,
          lastRefreshedAt: new Date().toISOString(),
          liveValidatedVersion: 3,
        };
      }
      return {
        customSeeds: cleanCustomSeeds,
        journal: parsed.journal ?? [],
        alerts: parsed.alerts ?? DEFAULT_ALERTS,
        SILENT_FLIP_BENCH: cleanBench,
        silentFlipOverrides: cleanOverrides,
        lockedShortlists: cleanLocks,
        silentFlipRules: cleanRules,
        setupLog: cleanSetupLog,
        lastRefreshedAt: parsed.lastRefreshedAt ?? new Date().toISOString(),
        liveValidatedVersion: 3,
      };
    }
  } catch (err) {
    console.log('Notice: loading store fallback to defaults:', err);
  }
  return {
    customSeeds: [],
    journal: [],
    alerts: DEFAULT_ALERTS,
    SILENT_FLIP_BENCH: [...DEFAULT_SILENT_FLIP_BENCH],
    silentFlipOverrides: {
      excludeNewsBySymbol: {},
      usDataRelease0830: false,
    },
    lockedShortlists: {},
    silentFlipRules: { ...DEFAULT_SILENT_FLIP_RULES },
    setupLog: [],
    lastRefreshedAt: new Date().toISOString(),
    liveValidatedVersion: 3,
  };
}

function saveStore(store: PersistentStore) {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
  } catch (err) {
    console.log('Notice: saving store failed:', err);
  }
}

const instrumentCache = new Map<string, MarketInstrument>();
const dailyFeedCache = new Map<string, DailyFeedFetchResult>();
const intraday15mCache = new Map<string, Intraday15mFeedResult>();
const premarketCache = new Map<string, PreMarketQuoteResult>();
const earningsCache = new Map<string, EarningsFeedResult>();

function ensureDefaultJournal(store: PersistentStore, instruments: MarketInstrument[]) {
  if (store.journal.length > 0) return;

  const validInstruments = instruments.filter(
    (i) => i.dataStatus !== 'unavailable' && i.metricsByBaseline !== null && i.price !== null
  );
  if (validInstruments.length === 0) return;

  const sectors = validInstruments
    .filter((i) => i.isSectorETF)
    .sort((a, b) => b.metricsByBaseline!['90D'].rvol5D - a.metricsByBaseline!['90D'].rvol5D);

  const stocks = validInstruments
    .filter((i) => !i.isSectorETF)
    .sort((a, b) => b.metricsByBaseline!['90D'].rvol5D - a.metricsByBaseline!['90D'].rvol5D);

  const latestDate =
    validInstruments[0]?.asOfSession || getMostRecentCompletedUSSession();

  store.journal = [
    {
      id: 'chk-initial-live-1',
      timestamp: new Date().toISOString(),
      dateLabel: latestDate,
      cadence: 'Daily',
      title: 'Live Market Volume Snapshot',
      notes:
        'Initial snapshot computed strictly from real completed daily OHLCV bars via Yahoo Finance.',
      tags: ['Real Market Data', 'Completed Session'],
      baselineUsed: '90D',
      timeframeUsed: '5D',
      topSectors: sectors.slice(0, 4).map((s) => ({
        symbol: s.symbol,
        name: s.sectorName,
        rvol5D: s.metricsByBaseline!['90D'].rvol5D,
        rvol20D: s.metricsByBaseline!['90D'].rvol20D,
        consistencyScore: s.metricsByBaseline!['90D'].consistencyScore,
        regime: s.metricsByBaseline!['90D'].regime,
        change5DPct: s.change5DPct ?? 0,
      })),
      topStocks: stocks.slice(0, 5).map((st) => ({
        symbol: st.symbol,
        name: st.name,
        sectorSymbol: st.sectorSymbol,
        price: st.price!,
        rvol1D: st.metricsByBaseline!['90D'].rvol1D,
        rvol5D: st.metricsByBaseline!['90D'].rvol5D,
        rvol20D: st.metricsByBaseline!['90D'].rvol20D,
        consistencyScore: st.metricsByBaseline!['90D'].consistencyScore,
        daysAboveBaseline20D: st.metricsByBaseline!['90D'].daysAboveBaseline20D,
        regime: st.metricsByBaseline!['90D'].regime,
      })),
    },
  ];
  saveStore(store);
}

async function getAllUniverseInstruments(
  store: PersistentStore,
  forceRecompute = false,
  nowOverride?: Date
): Promise<MarketInstrument[]> {
  const allSeeds: InstrumentSeed[] = [...GICS_SECTORS, ...CORE_EQUITIES, ...store.customSeeds];
  const results: MarketInstrument[] = new Array(allSeeds.length);

  if (forceRecompute) {
    resetFeedHealthCounters();
  }

  const batchSize = 15;
  for (let start = 0; start < allSeeds.length; start += batchSize) {
    const slice = allSeeds.slice(start, start + batchSize);
    await Promise.all(
      slice.map(async (seed, idx) => {
        const targetIndex = start + idx;
        const cached = !forceRecompute ? instrumentCache.get(seed.symbol) : undefined;
        if (cached) {
          results[targetIndex] = cached;
          return;
        }

        const feedRes = await fetchDailyBars1Y(seed.symbol, { now: nowOverride });
        if (feedRes.dataStatus === 'unavailable' || feedRes.bars.length < 40) {
          const unavail = buildUnavailableMarketInstrument(
            seed,
            feedRes.fetchedAt,
            feedRes.errorReason || 'Failed to load market data from Yahoo Finance'
          );
          instrumentCache.delete(seed.symbol);
          dailyFeedCache.delete(seed.symbol);
          results[targetIndex] = unavail;
        } else {
          dailyFeedCache.set(seed.symbol, feedRes);
          const inst = buildMarketInstrument(seed, feedRes.bars, {
            dataStatus: feedRes.dataStatus === 'stale' ? 'stale' : 'ok',
            asOfSession:
              feedRes.asOfSession || feedRes.bars[feedRes.bars.length - 1].date,
            fetchedAt: feedRes.fetchedAt,
            lastPrice: feedRes.lastPrice,
            exchangeName: feedRes.exchangeName,
          });
          instrumentCache.set(seed.symbol, inst);
          results[targetIndex] = inst;
        }
      })
    );
  }

  return results;
}

/**
 * Fetches or retrieves cached feeds for all symbols in SILENT_FLIP_BENCH
 * and runs computeBenchHealth, computeLevels, and buildShortlist.
 */
async function evaluateSilentFlipShortlist(
  store: PersistentStore,
  options?: {
    forceAll?: boolean;
    refreshPremarket?: boolean;
    now?: Date;
  }
) {
  const bench = store.SILENT_FLIP_BENCH;
  const forceAll = Boolean(options?.forceAll);
  const refreshPremarket = Boolean(options?.refreshPremarket || forceAll);
  const now = options?.now;
  const dMinus1Default = getMostRecentCompletedUSSession(now);
  const sessionBeingPrepared = nextNYSETradingDay(dMinus1Default);

  const inputsBySymbol: Record<string, SymbolShortlistInput> = {};

  const batchSize = 8;
  for (let start = 0; start < bench.length; start += batchSize) {
    const slice = bench.slice(start, start + batchSize);
    await Promise.all(
      slice.map(async (item) => {
        const sym = item.symbol;

        let daily = !forceAll ? dailyFeedCache.get(sym) : undefined;
        if (!daily || daily.dataStatus === 'unavailable') {
          daily = await fetchDailyBars1Y(sym, { now });
          if (daily.dataStatus !== 'unavailable') {
            dailyFeedCache.set(sym, daily);
          } else {
            dailyFeedCache.delete(sym);
          }
        }

        let intraday15m = !forceAll ? intraday15mCache.get(sym) : undefined;
        if (!intraday15m || intraday15m.dataStatus === 'unavailable') {
          intraday15m = await fetchIntraday15m60D(sym, { now });
          if (intraday15m.dataStatus !== 'unavailable') {
            intraday15mCache.set(sym, intraday15m);
          } else {
            intraday15mCache.delete(sym);
          }
        }

        let premarket = !refreshPremarket ? premarketCache.get(sym) : undefined;
        if (!premarket || premarket.dataStatus === 'unavailable') {
          premarket = await fetchPreMarketLastPrice(sym);
          if (premarket.dataStatus !== 'unavailable') {
            premarketCache.set(sym, premarket);
          } else {
            premarketCache.delete(sym);
          }
        }

        let earnings = !forceAll ? earningsCache.get(sym) : undefined;
        if (!earnings) {
          const fromDate = daily.asOfSession || dMinus1Default;
          const toDate = sessionBeingPrepared;
          earnings = await fetchEarningsCalendar(sym, fromDate, toDate);
          earningsCache.set(sym, earnings);
        }

        const asOfSession = daily.asOfSession || dMinus1Default;
        const health = computeBenchHealth(
          sym,
          daily.bars,
          intraday15m.sessions,
          asOfSession
        );
        const levels =
          daily.dataStatus !== 'unavailable' && daily.bars.length > 0
            ? computeLevels(
                daily.bars,
                asOfSession,
                health.firstCandleAvgDollar
              )
            : null;

        inputsBySymbol[sym] = {
          daily,
          intraday15m,
          premarket,
          earnings,
          levels,
          health,
        };
      })
    );
  }

  const result = buildShortlist(
    bench,
    inputsBySymbol,
    store.silentFlipOverrides,
    sessionBeingPrepared
  );

  const lockedRecord =
    store.lockedShortlists[result.sessionBeingPrepared] ?? null;

  return {
    result,
    bench,
    overrides: store.silentFlipOverrides,
    lockedRecord,
    dataHealth: getDataHealthReport(),
  };
}

const ukClockFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const nyClockFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  const store = loadStore();
  const initialUniverse = await getAllUniverseInstruments(store, true);
  ensureDefaultJournal(store, initialUniverse);

  app.get('/api/market/universe', async (req, res) => {
    const force = req.query.force === '1' || req.query.force === 'true';
    const simNow =
      typeof req.query.simulateNow === 'string' && req.query.simulateNow
        ? new Date(req.query.simulateNow)
        : undefined;
    const instruments = await getAllUniverseInstruments(
      store,
      force || Boolean(simNow),
      simNow
    );
    const firstValid = instruments.find((i) => i.asOfSession !== null);
    const marketSessionDate =
      firstValid?.asOfSession || getMostRecentCompletedUSSession(simNow);
    res.json({
      instruments,
      journal: store.journal,
      alerts: store.alerts,
      lastRefreshedAt: store.lastRefreshedAt || new Date().toISOString(),
      marketSessionDate,
    });
  });

  app.post('/api/market/refresh', async (_req, res) => {
    const instruments = await getAllUniverseInstruments(store, true);
    store.lastRefreshedAt = new Date().toISOString();
    saveStore(store);
    const firstValid = instruments.find((i) => i.asOfSession !== null);
    const marketSessionDate =
      firstValid?.asOfSession || getMostRecentCompletedUSSession();
    res.json({
      instruments,
      lastRefreshedAt: store.lastRefreshedAt,
      marketSessionDate,
      updatedCount: instruments.length,
    });
  });

  app.post('/api/market/ticker', async (req, res) => {
    const rawSymbol = String(req.body?.symbol || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9.-]/g, '');
    const sectorSymbol = String(req.body?.sectorSymbol || 'XLK').toUpperCase();
    const customName = String(req.body?.name || '').trim();

    if (!rawSymbol || rawSymbol.length > 10) {
      res.status(400).json({ error: 'Please provide a valid ticker symbol (1-10 characters).' });
      return;
    }

    const sectorObj = GICS_SECTORS.find((s) => s.symbol === sectorSymbol) || GICS_SECTORS[0];
    const feedRes = await fetchDailyBars1Y(rawSymbol);

    if (feedRes.dataStatus === 'unavailable' || feedRes.bars.length < 40) {
      res.status(502).json({
        error: feedRes.errorReason
          ? `Failed to load market data from Yahoo Finance (${feedRes.errorReason})`
          : 'Failed to load market data from Yahoo Finance',
      });
      return;
    }

    dailyFeedCache.set(rawSymbol, feedRes);

    const seed: InstrumentSeed = {
      symbol: rawSymbol,
      name: customName || feedRes.shortName || rawSymbol,
      isSectorETF: false,
      sectorSymbol: sectorObj.symbol,
      sectorName: sectorObj.sectorName,
      industry: 'Custom Tracked Equity',
    };

    const instrument = buildMarketInstrument(seed, feedRes.bars, {
      dataStatus: feedRes.dataStatus === 'stale' ? 'stale' : 'ok',
      asOfSession: feedRes.asOfSession || feedRes.bars[feedRes.bars.length - 1].date,
      fetchedAt: feedRes.fetchedAt,
      lastPrice: feedRes.lastPrice,
      exchangeName: feedRes.exchangeName,
    });

    instrumentCache.set(rawSymbol, instrument);

    const existsInDefault =
      GICS_SECTORS.some((s) => s.symbol === rawSymbol) ||
      CORE_EQUITIES.some((s) => s.symbol === rawSymbol);

    if (!existsInDefault && !store.customSeeds.some((s) => s.symbol === rawSymbol)) {
      store.customSeeds.push(seed);
    }
    store.lastRefreshedAt = new Date().toISOString();
    saveStore(store);

    res.json({ instrument, lastRefreshedAt: store.lastRefreshedAt });
  });

  app.get('/api/market/health', (_req, res) => {
    res.json(getDataHealthReport());
  });

  app.get('/api/market/feeds/:symbol', async (req, res) => {
    const symbol = String(req.params.symbol || '')
      .trim()
      .toUpperCase();
    const simNow =
      typeof req.query.simulateNow === 'string' && req.query.simulateNow
        ? new Date(req.query.simulateNow)
        : undefined;
    const todayStr = getMostRecentCompletedUSSession(simNow);
    const [daily, intraday15m, premarket, earnings] = await Promise.all([
      fetchDailyBars1Y(symbol, { now: simNow }),
      fetchIntraday15m60D(symbol, { now: simNow }),
      fetchPreMarketLastPrice(symbol),
      fetchEarningsCalendar(symbol, todayStr, todayStr),
    ]);

    res.json({
      symbol,
      daily: {
        dataStatus: daily.dataStatus,
        asOfSession: daily.asOfSession,
        lastPrice: daily.lastPrice,
        barCount: daily.bars.length,
        latestBar: daily.bars[daily.bars.length - 1] || null,
        errorReason: daily.errorReason,
      },
      intraday15m: {
        dataStatus: intraday15m.dataStatus,
        asOfSession: intraday15m.asOfSession,
        sessionCount: intraday15m.sessions.length,
        latestSession: intraday15m.sessions[intraday15m.sessions.length - 1]
          ? {
              sessionDate:
                intraday15m.sessions[intraday15m.sessions.length - 1].sessionDate,
              isHalfDay:
                intraday15m.sessions[intraday15m.sessions.length - 1].isHalfDay,
              firstCandle:
                intraday15m.sessions[intraday15m.sessions.length - 1].firstCandle,
              barCount:
                intraday15m.sessions[intraday15m.sessions.length - 1].bars.length,
            }
          : null,
        errorReason: intraday15m.errorReason,
      },
      premarket,
      earnings,
    });
  });

  // =========================================================
  // Phase 2: Silent Flip Pre-Market Shortlist Endpoints
  // =========================================================

  app.get('/api/silent-flip/shortlist', async (req, res) => {
    const forceAll = req.query.forceAll === '1' || req.query.forceAll === 'true';
    const refreshPremarket =
      req.query.refreshPremarket === '1' ||
      req.query.refreshPremarket === 'true' ||
      forceAll;
    const payload = await evaluateSilentFlipShortlist(store, {
      forceAll,
      refreshPremarket,
    });
    res.json(payload);
  });

  app.post('/api/silent-flip/bench', async (req, res) => {
    const action = String(req.body?.action || 'add');

    if (action === 'remove') {
      const sym = String(req.body?.symbol || '')
        .trim()
        .toUpperCase();
      store.SILENT_FLIP_BENCH = store.SILENT_FLIP_BENCH.filter(
        (b) => b.symbol !== sym
      );
      saveStore(store);
      const payload = await evaluateSilentFlipShortlist(store);
      res.json(payload);
      return;
    }

    if (action === 'reset') {
      store.SILENT_FLIP_BENCH = [...DEFAULT_SILENT_FLIP_BENCH];
      saveStore(store);
      const payload = await evaluateSilentFlipShortlist(store);
      res.json(payload);
      return;
    }

    // action === 'add'
    const rawSymbol = String(req.body?.symbol || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9.-]/g, '');
    const sectorSymbol = String(req.body?.sectorSymbol || 'XLK').toUpperCase();
    const customName = String(req.body?.name || '').trim();

    if (!rawSymbol || rawSymbol.length > 10) {
      res.status(400).json({
        error: 'Please provide a valid ticker symbol (1-10 characters).',
      });
      return;
    }

    const [daily, intraday] = await Promise.all([
      fetchDailyBars1Y(rawSymbol),
      fetchIntraday15m60D(rawSymbol),
    ]);

    if (daily.dataStatus === 'unavailable' || daily.bars.length < 20) {
      res.status(502).json({
        error: daily.errorReason
          ? `Failed to load market data from Yahoo Finance (${daily.errorReason})`
          : 'Failed to load market data from Yahoo Finance',
      });
      return;
    }

    dailyFeedCache.set(rawSymbol, daily);
    if (intraday.dataStatus !== 'unavailable') {
      intraday15mCache.set(rawSymbol, intraday);
    }

    const sectorObj =
      GICS_SECTORS.find((s) => s.symbol === sectorSymbol) || GICS_SECTORS[0];
    const newItem: SilentFlipBenchItem = {
      symbol: rawSymbol,
      name: customName || daily.shortName || rawSymbol,
      sectorSymbol: sectorObj.symbol,
      sectorName: sectorObj.sectorName,
    };

    const existingIdx = store.SILENT_FLIP_BENCH.findIndex(
      (b) => b.symbol === rawSymbol
    );
    if (existingIdx >= 0) {
      store.SILENT_FLIP_BENCH[existingIdx] = newItem;
    } else {
      store.SILENT_FLIP_BENCH.push(newItem);
    }
    saveStore(store);

    const payload = await evaluateSilentFlipShortlist(store);
    res.json(payload);
  });

  app.post('/api/silent-flip/overrides', async (req, res) => {
    if (
      req.body?.excludeNewsBySymbol &&
      typeof req.body.excludeNewsBySymbol === 'object'
    ) {
      store.silentFlipOverrides.excludeNewsBySymbol = {
        ...store.silentFlipOverrides.excludeNewsBySymbol,
        ...req.body.excludeNewsBySymbol,
      };
    }
    if (typeof req.body?.symbol === 'string') {
      const sym = req.body.symbol.trim().toUpperCase();
      store.silentFlipOverrides.excludeNewsBySymbol[sym] = Boolean(
        req.body.excludeNews
      );
    }
    if (typeof req.body?.usDataRelease0830 === 'boolean') {
      store.silentFlipOverrides.usDataRelease0830 = req.body.usDataRelease0830;
    }
    saveStore(store);

    const payload = await evaluateSilentFlipShortlist(store);
    res.json(payload);
  });

  /**
   * Upserts SetupLogEntry items into store.setupLog by deterministic id ("${date}::${symbol}"),
   * preserving manual trader fields if already entered.
   */
  function upsertSetupLogEntries(entriesToUpsert: SetupLogEntry[]) {
    const byId = new Map<string, SetupLogEntry>(
      store.setupLog.map((e) => [e.id, e])
    );

    for (const incoming of entriesToUpsert) {
      const existing = byId.get(incoming.id);
      if (existing) {
        byId.set(incoming.id, {
          ...incoming,
          taken: existing.taken,
          actualEntry: existing.actualEntry,
          actualExit: existing.actualExit,
          actualR: existing.actualR,
          notes: existing.notes,
        });
      } else {
        byId.set(incoming.id, incoming);
      }
    }

    store.setupLog = Array.from(byId.values()).sort((a, b) => {
      if (b.date !== a.date) return b.date.localeCompare(a.date);
      if (a.inShortlist !== b.inShortlist) return a.inShortlist ? -1 : 1;
      if ((a.shortlistRank ?? 999) !== (b.shortlistRank ?? 999)) {
        return (a.shortlistRank ?? 999) - (b.shortlistRank ?? 999);
      }
      return a.symbol.localeCompare(b.symbol);
    });
  }

  /**
   * Returns sorted unique session dates available across cached 15-minute feeds.
   */
  function getAvailable15mSessions(): string[] {
    const dateSet = new Set<string>();
    for (const item of store.SILENT_FLIP_BENCH) {
      const feed = intraday15mCache.get(item.symbol);
      if (feed && Array.isArray(feed.sessions)) {
        for (const s of feed.sessions) {
          if (s.sessionDate) dateSet.add(s.sessionDate);
        }
      }
    }
    return Array.from(dateSet).sort((a, b) => b.localeCompare(a));
  }

  /**
   * Section 8: Grades all bench symbols for a specific US session date (YYYY-MM-DD)
   * using that day's 15-minute bars and levels as of the prior completed session (D-1).
   */
  async function gradeBenchForSessionDate(
    targetSessionDate: string,
    options?: {
      forceRefresh15m?: boolean;
      shortlistResultForDate?: ShortlistBuildResult;
    }
  ): Promise<SetupLogEntry[]> {
    const bench = store.SILENT_FLIP_BENCH;
    const force15m = Boolean(options?.forceRefresh15m);

    // Ensure daily and 15m caches are populated for all bench symbols
    const batchSize = 8;
    for (let start = 0; start < bench.length; start += batchSize) {
      const slice = bench.slice(start, start + batchSize);
      await Promise.all(
        slice.map(async (item) => {
          const sym = item.symbol;
          let daily = dailyFeedCache.get(sym);
          if (!daily || daily.dataStatus === 'unavailable') {
            daily = await fetchDailyBars1Y(sym);
            if (daily.dataStatus !== 'unavailable') {
              dailyFeedCache.set(sym, daily);
            }
          }

          let intraday = !force15m ? intraday15mCache.get(sym) : undefined;
          if (!intraday || intraday.dataStatus === 'unavailable') {
            intraday = await fetchIntraday15m60D(sym);
            if (intraday.dataStatus !== 'unavailable') {
              intraday15mCache.set(sym, intraday);
            }
          }
        })
      );
    }

    // Determine shortlist membership for targetSessionDate:
    // 1. If a locked shortlist exists for targetSessionDate, use it.
    // 2. If options.shortlistResultForDate was passed for targetSessionDate, use it.
    // 3. Otherwise, build the historical shortlist as of targetSessionDate using D-1 daily bars and the 09:30 open as P.
    let shortlistForDate: ShortlistBuildResult | null =
      store.lockedShortlists[targetSessionDate]?.result ??
      (options?.shortlistResultForDate?.sessionBeingPrepared ===
      targetSessionDate
        ? options.shortlistResultForDate
        : null);

    const perSymbolHistoricalInputs: Record<string, SymbolShortlistInput> = {};

    for (const item of bench) {
      const sym = item.symbol;
      const daily = dailyFeedCache.get(sym);
      const intraday = intraday15mCache.get(sym);

      const priorDailyBars = (daily?.bars ?? [])
        .filter((b) => b.date < targetSessionDate)
        .sort((a, b) => a.date.localeCompare(b.date));
      const dMinus1Date =
        priorDailyBars.length > 0
          ? priorDailyBars[priorDailyBars.length - 1].date
          : null;

      const priorIntradaySessions = (intraday?.sessions ?? []).filter(
        (s) => s.sessionDate < targetSessionDate
      );

      const health = computeBenchHealth(
        sym,
        priorDailyBars,
        priorIntradaySessions,
        dMinus1Date
      );

      const levels =
        dMinus1Date && priorDailyBars.length > 0
          ? computeLevels(
              priorDailyBars,
              dMinus1Date,
              health.firstCandleAvgDollar
            )
          : null;

      const targetSession =
        intraday?.sessions.find((s) => s.sessionDate === targetSessionDate) ??
        null;
      const openPrice =
        targetSession?.firstCandle?.open ??
        targetSession?.bars?.[0]?.open ??
        premarketCache.get(sym)?.price ??
        null;

      perSymbolHistoricalInputs[sym] = {
        daily: {
          symbol: sym,
          dataStatus:
            daily?.dataStatus === 'ok' && priorDailyBars.length > 0
              ? 'ok'
              : 'unavailable',
          asOfSession: dMinus1Date,
          fetchedAt: daily?.fetchedAt || new Date().toISOString(),
          bars: priorDailyBars,
          lastPrice: openPrice,
          exchangeName: daily?.exchangeName,
          shortName: daily?.shortName,
        },
        intraday15m: {
          symbol: sym,
          dataStatus:
            intraday?.dataStatus === 'ok' && priorIntradaySessions.length > 0
              ? 'ok'
              : 'unavailable',
          asOfSession: dMinus1Date,
          fetchedAt: intraday?.fetchedAt || new Date().toISOString(),
          sessions: priorIntradaySessions,
        },
        premarket: {
          symbol: sym,
          dataStatus: openPrice !== null ? 'ok' : 'unavailable',
          fetchedAt: new Date().toISOString(),
          nyDate: targetSessionDate,
          nyTime: '09:15:00',
          price: openPrice,
          volume: 0,
          sourceWindow: 'premarket_0400_0930',
        },
        earnings: {
          symbol: sym,
          dataStatus: 'unavailable',
          fetchedAt: new Date().toISOString(),
          providerConfigured: false,
          events: [],
        },
        levels,
        health,
      };
    }

    if (!shortlistForDate) {
      shortlistForDate = buildShortlist(
        bench,
        perSymbolHistoricalInputs,
        store.silentFlipOverrides,
        targetSessionDate
      );
    }

    const rowBySymbol = new Map(
      shortlistForDate.benchRows.map((r) => [r.symbol, r])
    );
    const existingById = new Map(store.setupLog.map((e) => [e.id, e]));

    const gradedEntries: SetupLogEntry[] = bench.map((item) => {
      const sym = item.symbol;
      const id = `${targetSessionDate}::${sym}`;
      const existing = existingById.get(id);
      const shortlistRow = rowBySymbol.get(sym);
      const histInp = perSymbolHistoricalInputs[sym];
      const levels = shortlistRow?.levels ?? histInp?.levels ?? null;

      const intraday = intraday15mCache.get(sym);
      const targetSession =
        intraday?.sessions.find((s) => s.sessionDate === targetSessionDate) ??
        null;
      const sessionBars = targetSession?.bars ?? [];

      const existingManual = existing
        ? {
            taken: existing.taken,
            actualEntry: existing.actualEntry,
            actualExit: existing.actualExit,
            actualR: existing.actualR,
            notes: existing.notes,
          }
        : undefined;

      // If no 15m bars exist yet for targetSessionDate (e.g. locked pre-market before 09:30 NY open),
      // record the locked shortlist state as Pending 10:45 NY
      if (sessionBars.length === 0) {
        return {
          id,
          date: targetSessionDate,
          symbol: sym,
          sectorSymbol: item.sectorSymbol,
          sector: item.sectorName,
          inShortlist: Boolean(shortlistRow?.selectedInShortlist),
          shortlistRank: shortlistRow?.shortlistRank ?? null,
          shortlistScore: shortlistRow?.score ?? null,
          side: shortlistRow?.winningSide ?? null,
          fh: levels?.flipHigh ?? null,
          rh: levels?.rangeHigh ?? null,
          rl: levels?.rangeLow ?? null,
          fl: levels?.flipLow ?? null,
          firstCandleAvg:
            levels?.firstCandleAvg !== null &&
            levels?.firstCandleAvg !== undefined
              ? Number(levels.firstCandleAvg.toFixed(4))
              : null,
          stageReached: 'C1',
          touchedLevel: null,
          failLabel: 'Pending 10:45 NY',
          entry: null,
          stop: null,
          target: null,
          plannedR: null,
          mechanicalResultR: null,
          mfeR: null,
          rulesVersion: store.silentFlipRules.rulesVersion,
          taken: existingManual?.taken ?? null,
          actualEntry: existingManual?.actualEntry ?? null,
          actualExit: existingManual?.actualExit ?? null,
          actualR: existingManual?.actualR ?? null,
          notes: existingManual?.notes ?? '',
        };
      }

      return gradeSilentFlipSession({
        date: targetSessionDate,
        symbol: sym,
        sectorSymbol: item.sectorSymbol,
        sector: item.sectorName,
        inShortlist: Boolean(shortlistRow?.selectedInShortlist),
        shortlistRank: shortlistRow?.shortlistRank ?? null,
        shortlistScore: shortlistRow?.score ?? null,
        shortlistSide: shortlistRow?.winningSide ?? null,
        levels,
        sessionBars15m: sessionBars,
        rules: store.silentFlipRules,
        existingManual,
      });
    });

    upsertSetupLogEntries(gradedEntries);
    saveStore(store);
    return gradedEntries;
  }

  app.post('/api/silent-flip/lock', async (req, res) => {
    const action = String(req.body?.action || 'lock');
    const payload = await evaluateSilentFlipShortlist(store);
    const sessionDate = payload.result.sessionBeingPrepared;

    if (action === 'unlock') {
      delete store.lockedShortlists[sessionDate];
      saveStore(store);
      res.json({ ...payload, lockedRecord: null });
      return;
    }

    const now = new Date();
    const lockedRecord: LockedShortlistRecord = {
      sessionDate,
      lockedAtIso: now.toISOString(),
      lockedAtUkTime: `${ukClockFormatter.format(now)} UK`,
      lockedAtNyTime: `${nyClockFormatter.format(now)} NY`,
      result: payload.result,
    };

    store.lockedShortlists[sessionDate] = lockedRecord;

    // Section 6 & 8: Locking freezes the selection and writes it to the setup log
    await gradeBenchForSessionDate(sessionDate, {
      shortlistResultForDate: payload.result,
    });

    saveStore(store);
    res.json({ ...payload, lockedRecord });
  });

  // =========================================================
  // Phase 3 (Section 8): Setup Log & Auto-Grader Endpoints
  // =========================================================

  app.get('/api/silent-flip/log', async (_req, res) => {
    // Ensure 15m cache is loaded so availableSessions is populated
    if (intraday15mCache.size === 0) {
      await evaluateSilentFlipShortlist(store);
    }
    const availableSessions = getAvailable15mSessions();

    // If setupLog is empty on first visit, automatically grade the most recent completed session
    if (store.setupLog.length === 0 && availableSessions.length > 0) {
      await gradeBenchForSessionDate(availableSessions[0]);
    }

    res.json({
      entries: store.setupLog,
      summary: summarizeSetupLog(store.setupLog),
      rules: store.silentFlipRules,
      availableSessions,
    });
  });

  app.post('/api/silent-flip/log/grade', async (req, res) => {
    const forceRefresh15m = Boolean(req.body?.forceRefresh15m);
    if (intraday15mCache.size === 0 || forceRefresh15m) {
      await evaluateSilentFlipShortlist(store, { forceAll: forceRefresh15m });
    }
    const availableSessions = getAvailable15mSessions();

    const datesToGrade: string[] = Array.isArray(req.body?.dates)
      ? req.body.dates.filter((d: unknown) => typeof d === 'string' && d.trim())
      : typeof req.body?.date === 'string' && req.body.date.trim()
      ? [req.body.date.trim()]
      : availableSessions.length > 0
      ? [availableSessions[0]]
      : [];

    for (const d of datesToGrade) {
      await gradeBenchForSessionDate(d, { forceRefresh15m: false });
    }

    res.json({
      gradedDates: datesToGrade,
      entries: store.setupLog,
      summary: summarizeSetupLog(store.setupLog),
      rules: store.silentFlipRules,
      availableSessions: getAvailable15mSessions(),
    });
  });

  app.post('/api/silent-flip/log/manual', (req, res) => {
    const id = String(req.body?.id || '').trim();
    const idx = store.setupLog.findIndex((e) => e.id === id);
    if (idx < 0) {
      res.status(404).json({ error: `Setup log entry not found: ${id}` });
      return;
    }

    const current = store.setupLog[idx];
    const taken =
      req.body?.taken === true
        ? true
        : req.body?.taken === false
        ? false
        : req.body?.taken === null
        ? null
        : current.taken;

    const parseNullableNum = (
      raw: unknown,
      fallback: number | null
    ): number | null => {
      if (raw === null || raw === '') return null;
      if (raw === undefined) return fallback;
      const num = Number(raw);
      return Number.isFinite(num) ? Number(num.toFixed(4)) : fallback;
    };

    const actualEntry = parseNullableNum(
      req.body?.actualEntry,
      current.actualEntry
    );
    const actualExit = parseNullableNum(
      req.body?.actualExit,
      current.actualExit
    );

    let actualR = parseNullableNum(req.body?.actualR, current.actualR);
    // If trader entered actualEntry & actualExit without explicitly typing actualR, derive actualR from planned stop risk if available
    if (
      (req.body?.actualR === undefined || req.body?.actualR === '') &&
      actualEntry !== null &&
      actualExit !== null &&
      current.entry !== null &&
      current.stop !== null &&
      current.side !== null
    ) {
      const risk = Math.abs(current.entry - current.stop);
      if (risk > 0) {
        const move =
          current.side === 'SELL'
            ? actualEntry - actualExit
            : actualExit - actualEntry;
        actualR = Number((move / risk).toFixed(2));
      }
    }

    const notes =
      typeof req.body?.notes === 'string' ? req.body.notes : current.notes;

    const updated: SetupLogEntry = {
      ...current,
      taken,
      actualEntry,
      actualExit,
      actualR,
      notes,
    };

    store.setupLog[idx] = updated;
    saveStore(store);

    res.json({
      entry: updated,
      entries: store.setupLog,
      summary: summarizeSetupLog(store.setupLog),
    });
  });

  app.post('/api/silent-flip/rules', (req, res) => {
    const patch: Partial<Omit<SilentFlipRules, 'rulesVersion'>> = {};
    if (
      typeof req.body?.strongBodyPct === 'number' &&
      req.body.strongBodyPct > 0 &&
      req.body.strongBodyPct <= 1
    ) {
      patch.strongBodyPct = req.body.strongBodyPct;
    }
    if (
      typeof req.body?.strongRangeMult === 'number' &&
      req.body.strongRangeMult > 0
    ) {
      patch.strongRangeMult = req.body.strongRangeMult;
    }
    if (
      typeof req.body?.levelTolPct === 'number' &&
      req.body.levelTolPct >= 0
    ) {
      patch.levelTolPct = req.body.levelTolPct;
    }
    if (req.body?.breakRule === 'close' || req.body?.breakRule === 'wick') {
      patch.breakRule = req.body.breakRule;
    }
    if (typeof req.body?.stopOffset === 'number' && req.body.stopOffset >= 0) {
      patch.stopOffset = req.body.stopOffset;
    }
    if (req.body?.targetMode === 'range' || req.body?.targetMode === 'flip') {
      patch.targetMode = req.body.targetMode;
    }
    if (
      typeof req.body?.triggerCutoff === 'string' &&
      req.body.triggerCutoff.trim()
    ) {
      patch.triggerCutoff = req.body.triggerCutoff.trim();
    }

    store.silentFlipRules = updateSilentFlipRules(
      store.silentFlipRules,
      patch
    );
    saveStore(store);

    res.json({
      rules: store.silentFlipRules,
      entries: store.setupLog,
    });
  });

  app.get('/api/silent-flip/log/csv', (_req, res) => {
    const csv = exportSetupLogToCsv(store.setupLog);
    const todayIso = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="silent-flip-setup-log-${todayIso}.csv"`
    );
    res.send(csv);
  });

  app.post('/api/journal', (req, res) => {
    const snapshot = req.body as CheckpointSnapshot;
    if (!snapshot || !snapshot.title) {
      res.status(400).json({ error: 'Snapshot title is required.' });
      return;
    }
    const newEntry: CheckpointSnapshot = {
      ...snapshot,
      id: snapshot.id || `chk-${Date.now()}`,
      timestamp: new Date().toISOString(),
    };
    store.journal = [newEntry, ...store.journal];
    saveStore(store);
    res.json({ snapshot: newEntry, journal: store.journal });
  });

  app.delete('/api/journal/:id', (req, res) => {
    const { id } = req.params;
    store.journal = store.journal.filter((j) => j.id !== id);
    saveStore(store);
    res.json({ journal: store.journal });
  });

  app.post('/api/alerts', (req, res) => {
    const alerts = req.body?.alerts as VolumeAlertRule[];
    if (!Array.isArray(alerts)) {
      res.status(400).json({ error: 'Invalid alerts list.' });
      return;
    }
    store.alerts = alerts;
    saveStore(store);
    res.json({ alerts: store.alerts });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`VolFlow Terminal server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
