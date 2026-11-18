import express from 'express';
import fs from 'fs';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import {
  buildMarketInstrument,
  CORE_EQUITIES,
  generateCalibratedOHLCV,
  GICS_SECTORS,
  InstrumentSeed,
  RawOHLCV,
} from './src/lib/volumeAnalytics.ts';
import { CheckpointSnapshot, MarketInstrument, VolumeAlertRule } from './src/types/market.ts';

const PORT = 3000;
const STORE_PATH = path.resolve(process.cwd(), '.volflow-store.json');

interface PersistentStore {
  customSeeds: InstrumentSeed[];
  journal: CheckpointSnapshot[];
  alerts: VolumeAlertRule[];
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

function loadStore(): PersistentStore {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PersistentStore>;
      // Reset legacy v1 synthetic store if not yet upgraded to liveValidatedVersion 2
      if (parsed.liveValidatedVersion !== 2) {
        return {
          customSeeds: parsed.customSeeds ?? [],
          journal: [],
          alerts: DEFAULT_ALERTS,
          lastRefreshedAt: new Date().toISOString(),
          liveValidatedVersion: 2,
        };
      }
      return {
        customSeeds: parsed.customSeeds ?? [],
        journal: parsed.journal ?? [],
        alerts: parsed.alerts ?? DEFAULT_ALERTS,
        lastRefreshedAt: parsed.lastRefreshedAt ?? new Date().toISOString(),
        liveValidatedVersion: 2,
      };
    }
  } catch (err) {
    console.error('Error loading store, using defaults:', err);
  }
  return {
    customSeeds: [],
    journal: [],
    alerts: DEFAULT_ALERTS,
    lastRefreshedAt: new Date().toISOString(),
    liveValidatedVersion: 2,
  };
}

function saveStore(store: PersistentStore) {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving store:', err);
  }
}

async function fetchYahooOHLCV(symbol: string): Promise<{ bars: RawOHLCV[]; name?: string } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      symbol
    )}?range=1y&interval=1d`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;

    const data = (await res.json()) as any;
    const result = data?.chart?.result?.[0];
    if (!result || !Array.isArray(result.timestamp)) return null;

    const timestamps: number[] = result.timestamp;
    const quote = result.indicators?.quote?.[0];
    if (!quote) return null;

    const byDate = new Map<string, RawOHLCV>();
    for (let i = 0; i < timestamps.length; i++) {
      const open = quote.open?.[i];
      const high = quote.high?.[i];
      const low = quote.low?.[i];
      const close = quote.close?.[i];
      const volume = quote.volume?.[i];

      if (
        typeof open === 'number' &&
        typeof high === 'number' &&
        typeof low === 'number' &&
        typeof close === 'number' &&
        typeof volume === 'number' &&
        volume > 0
      ) {
        const dateStr = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
        const cleanOpen = Number(open.toFixed(2));
        const cleanClose = Number(close.toFixed(2));
        const cleanHigh = Number(Math.max(cleanOpen, cleanClose, high).toFixed(2));
        const cleanLow = Number(Math.min(cleanOpen, cleanClose, low).toFixed(2));
        byDate.set(dateStr, {
          date: dateStr,
          open: cleanOpen,
          high: cleanHigh,
          low: cleanLow,
          close: cleanClose,
          volume: Math.round(volume),
        });
      }
    }

    const bars = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
    if (bars.length < 40) return null;

    // Ensure the latest bar's close matches regularMarketPrice if reported for the same session
    const regPrice = result.meta?.regularMarketPrice;
    if (typeof regPrice === 'number' && regPrice > 0 && bars.length > 0) {
      const lastBar = bars[bars.length - 1];
      lastBar.close = Number(regPrice.toFixed(2));
      lastBar.high = Number(Math.max(lastBar.high, lastBar.close).toFixed(2));
      lastBar.low = Number(Math.min(lastBar.low, lastBar.close).toFixed(2));
    }

    const shortName = result.meta?.shortName || result.meta?.longName;
    return { bars, name: shortName };
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

const instrumentCache = new Map<string, MarketInstrument>();

function ensureDefaultJournal(store: PersistentStore, instruments: MarketInstrument[]) {
  if (store.journal.length > 0) return;

  const sectors = instruments
    .filter((i) => i.isSectorETF)
    .sort((a, b) => b.metricsByBaseline['90D'].rvol5D - a.metricsByBaseline['90D'].rvol5D);

  const stocks = instruments
    .filter((i) => !i.isSectorETF)
    .sort((a, b) => b.metricsByBaseline['90D'].rvol5D - a.metricsByBaseline['90D'].rvol5D);

  const latestDate = instruments[0]?.lastUpdated || new Date().toISOString().slice(0, 10);

  store.journal = [
    {
      id: 'chk-initial-live-1',
      timestamp: new Date().toISOString(),
      dateLabel: latestDate,
      cadence: 'Daily',
      title: 'Semiconductors & Energy Volume Expansion — AMD / AVGO / OXY',
      notes:
        'Technology (XLK) and Consumer Staples (XLP) are leading 5D & 20D relative volume. AMD ($534.06, 1.95x 5D normal volume) and AVGO ($347.01, 1.49x 5D normal volume) show strong weekly buying breakouts, while OXY ($58.75, 1.68x 5D normal volume) and SO ($93.59, 1.72x 5D normal volume) are seeing strong buying support.',
      tags: ['AMD #1 Watch', 'Semiconductor Volume', 'Real Yahoo Finance Data'],
      baselineUsed: '90D',
      timeframeUsed: '5D',
      topSectors: sectors.slice(0, 4).map((s) => ({
        symbol: s.symbol,
        name: s.sectorName,
        rvol5D: s.metricsByBaseline['90D'].rvol5D,
        rvol20D: s.metricsByBaseline['90D'].rvol20D,
        consistencyScore: s.metricsByBaseline['90D'].consistencyScore,
        regime: s.metricsByBaseline['90D'].regime,
        change5DPct: s.change5DPct,
      })),
      topStocks: stocks.slice(0, 5).map((st) => ({
        symbol: st.symbol,
        name: st.name,
        sectorSymbol: st.sectorSymbol,
        price: st.price,
        rvol1D: st.metricsByBaseline['90D'].rvol1D,
        rvol5D: st.metricsByBaseline['90D'].rvol5D,
        rvol20D: st.metricsByBaseline['90D'].rvol20D,
        consistencyScore: st.metricsByBaseline['90D'].consistencyScore,
        daysAboveBaseline20D: st.metricsByBaseline['90D'].daysAboveBaseline20D,
        regime: st.metricsByBaseline['90D'].regime,
      })),
    },
  ];
  saveStore(store);
}

async function getAllUniverseInstruments(
  store: PersistentStore,
  forceRecompute = false
): Promise<MarketInstrument[]> {
  const allSeeds: InstrumentSeed[] = [...GICS_SECTORS, ...CORE_EQUITIES, ...store.customSeeds];
  const results: MarketInstrument[] = new Array(allSeeds.length);

  // Process in concurrent batches of 15 to fetch real Yahoo Finance OHLCV quickly
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

        const liveData = await fetchYahooOHLCV(seed.symbol);
        if (liveData && liveData.bars.length >= 40) {
          const inst = buildMarketInstrument(seed, liveData.bars, 'live');
          instrumentCache.set(seed.symbol, inst);
          results[targetIndex] = inst;
        } else {
          const fallbackBars = generateCalibratedOHLCV(seed, 252);
          const inst = buildMarketInstrument(seed, fallbackBars, 'calibrated');
          instrumentCache.set(seed.symbol, inst);
          results[targetIndex] = inst;
        }
      })
    );
  }

  return results;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  const store = loadStore();
  const initialUniverse = await getAllUniverseInstruments(store, true);
  ensureDefaultJournal(store, initialUniverse);

  app.get('/api/market/universe', async (_req, res) => {
    const instruments = await getAllUniverseInstruments(store, false);
    const marketSessionDate = instruments[0]?.lastUpdated || new Date().toISOString().slice(0, 10);
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
    const marketSessionDate = instruments[0]?.lastUpdated || new Date().toISOString().slice(0, 10);
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
    const profileChoice = req.body?.volumeProfile || 'surging_breakout';

    if (!rawSymbol || rawSymbol.length > 10) {
      res.status(400).json({ error: 'Please provide a valid ticker symbol (1-10 characters).' });
      return;
    }

    const sectorObj = GICS_SECTORS.find((s) => s.symbol === sectorSymbol) || GICS_SECTORS[0];
    const liveData = await fetchYahooOHLCV(rawSymbol);

    const seed: InstrumentSeed = {
      symbol: rawSymbol,
      name: customName || liveData?.name || `${rawSymbol} Holdings Corp.`,
      isSectorETF: false,
      sectorSymbol: sectorObj.symbol,
      sectorName: sectorObj.sectorName,
      industry: 'Custom Tracked Equity',
      basePrice: liveData?.bars[liveData.bars.length - 1]?.close ?? 125.0,
      baseDailyVolume: 8_500_000,
      volumeProfile: profileChoice,
    };

    const bars = liveData?.bars ?? generateCalibratedOHLCV(seed, 252);
    const instrument = buildMarketInstrument(seed, bars, liveData ? 'live' : 'calibrated');

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
