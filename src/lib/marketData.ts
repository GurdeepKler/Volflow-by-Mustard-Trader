import {
  DataStatus,
  EarningsEvent,
  EarningsFeedResult,
  FeedFetchError,
  FeedType,
  Intraday15mBar,
  Intraday15mFeedResult,
  IntradaySession15m,
  PreMarketQuoteResult,
} from '../types/market';
import { RawOHLCV } from './volumeAnalytics';

const nyDateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const nyWeekdayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
});

/**
 * Converts a Date or Unix timestamp (in seconds) into America/New_York date (YYYY-MM-DD)
 * and time (HH:mm:ss) without ever using UTC .toISOString().slice(0, 10).
 */
export function toNewYorkDateTime(input: Date | number): {
  nyDate: string;
  nyTime: string;
  weekday: string;
} {
  const dateObj = typeof input === 'number' ? new Date(input * 1000) : input;
  const parts = nyDateTimeFormatter.formatToParts(dateObj);
  let year = '1970';
  let month = '01';
  let day = '01';
  let hour = '00';
  let minute = '00';
  let second = '00';

  for (const p of parts) {
    if (p.type === 'year') year = p.value;
    else if (p.type === 'month') month = p.value;
    else if (p.type === 'day') day = p.value;
    else if (p.type === 'hour') hour = p.value === '24' ? '00' : p.value;
    else if (p.type === 'minute') minute = p.value;
    else if (p.type === 'second') second = p.value;
  }

  const weekday = nyWeekdayFormatter.format(dateObj);
  return {
    nyDate: `${year}-${month}-${day}`,
    nyTime: `${hour}:${minute}:${second}`,
    weekday,
  };
}

/**
 * Known NYSE full-day holidays for 2025-2027.
 */
const NYSE_HOLIDAYS = new Set<string>([
  // 2025
  '2025-01-01',
  '2025-01-09',
  '2025-01-20',
  '2025-02-17',
  '2025-04-18',
  '2025-05-26',
  '2025-06-19',
  '2025-07-04',
  '2025-09-01',
  '2025-11-27',
  '2025-12-25',
  // 2026
  '2026-01-01',
  '2026-01-19',
  '2026-02-16',
  '2026-04-03',
  '2026-05-25',
  '2026-06-19',
  '2026-07-03',
  '2026-09-07',
  '2026-11-26',
  '2026-12-25',
  // 2027
  '2027-01-01',
  '2027-01-18',
  '2027-02-15',
  '2027-03-26',
  '2027-05-31',
  '2027-06-18',
  '2027-07-05',
  '2027-09-06',
  '2027-11-25',
  '2027-12-24',
]);

/**
 * Known NYSE 13:00 ET early-close half-days (Day after Thanksgiving, Christmas Eve, July 3rd).
 */
const NYSE_HALF_DAYS = new Set<string>([
  '2025-07-03',
  '2025-11-28',
  '2025-12-24',
  '2026-11-27',
  '2026-12-24',
  '2027-11-26',
]);

export function isNYSEHalfDay(nyDate: string): boolean {
  return NYSE_HALF_DAYS.has(nyDate);
}

export function isNYSETradingDay(nyDate: string): boolean {
  if (NYSE_HOLIDAYS.has(nyDate)) return false;
  const [y, m, d] = nyDate.split('-').map(Number);
  const utcNoon = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const dow = utcNoon.getUTCDay();
  return dow !== 0 && dow !== 6;
}

export function previousNYSETradingDay(nyDate: string): string {
  const [y, m, d] = nyDate.split('-').map(Number);
  const cursor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  for (let i = 0; i < 15; i++) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const candidate = cursor.toISOString().slice(0, 10);
    if (isNYSETradingDay(candidate)) {
      return candidate;
    }
  }
  return nyDate;
}

export function nextNYSETradingDay(nyDate: string): string {
  const [y, m, d] = nyDate.split('-').map(Number);
  const cursor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  for (let i = 0; i < 15; i++) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const candidate = cursor.toISOString().slice(0, 10);
    if (isNYSETradingDay(candidate)) {
      return candidate;
    }
  }
  return nyDate;
}

/**
 * Returns the YYYY-MM-DD (in America/New_York) of the most recent COMPLETED US regular trading session.
 * If today is a trading day in New York, today's session is only considered completed at or after
 * 16:00:00 New York time (or 13:00:00 on an NYSE half-day). Before that, the most recent completed
 * session is the prior trading day (D-1).
 */
export function getMostRecentCompletedUSSession(now: Date = new Date()): string {
  const { nyDate, nyTime } = toNewYorkDateTime(now);
  const closeCutoff = isNYSEHalfDay(nyDate) ? '13:00:00' : '16:00:00';

  if (isNYSETradingDay(nyDate) && nyTime >= closeCutoff) {
    return nyDate;
  }
  return previousNYSETradingDay(nyDate);
}

/**
 * In-memory error ring buffer and per-feed last fetch status for Section 3 Rule 6 ("Data health").
 */
const MAX_ERROR_LOG = 200;
const feedErrorLog: FeedFetchError[] = [];

const feedLastStatus: Record<
  FeedType,
  {
    lastFetchAt: string | null;
    okCount: number;
    failCount: number;
    lastError: string | null;
  }
> = {
  daily_1y: { lastFetchAt: null, okCount: 0, failCount: 0, lastError: null },
  intraday_15m_60d: { lastFetchAt: null, okCount: 0, failCount: 0, lastError: null },
  premarket_5m_1d: { lastFetchAt: null, okCount: 0, failCount: 0, lastError: null },
  earnings_finnhub: { lastFetchAt: null, okCount: 0, failCount: 0, lastError: null },
};

export function logFeedError(
  symbol: string,
  feed: FeedType,
  httpStatus: number | null,
  reason: string
): void {
  const timestamp = new Date().toISOString();
  const entry: FeedFetchError = {
    symbol,
    feed,
    httpStatus,
    reason,
    timestamp,
  };
  console.log(
    `[VolFlow Feed Diagnostic] time=${timestamp} symbol=${symbol} feed=${feed} status=${
      httpStatus ?? 'N/A'
    } reason=${reason}`
  );
  feedErrorLog.unshift(entry);
  if (feedErrorLog.length > MAX_ERROR_LOG) {
    feedErrorLog.length = MAX_ERROR_LOG;
  }
  feedLastStatus[feed].lastFetchAt = timestamp;
  feedLastStatus[feed].failCount += 1;
  feedLastStatus[feed].lastError = `${symbol}: ${reason}`;
}

export function recordFeedSuccess(feed: FeedType): void {
  feedLastStatus[feed].lastFetchAt = new Date().toISOString();
  feedLastStatus[feed].okCount += 1;
}

export function getDataHealthReport() {
  return {
    feeds: feedLastStatus,
    recentErrors: feedErrorLog.slice(0, 50),
  };
}

export function resetFeedHealthCounters(): void {
  for (const key of Object.keys(feedLastStatus) as FeedType[]) {
    feedLastStatus[key] = {
      lastFetchAt: null,
      okCount: 0,
      failCount: 0,
      lastError: null,
    };
  }
}

function getYahooBaseUrl(): string {
  return (process.env.YAHOO_BASE_URL || 'https://query1.finance.yahoo.com').replace(
    /\/+$/,
    ''
  );
}

export interface DailyFeedFetchResult {
  symbol: string;
  dataStatus: DataStatus;
  asOfSession: string | null;
  fetchedAt: string;
  errorReason?: string;
  bars: RawOHLCV[];
  lastPrice: number | null;
  exchangeName?: string;
  shortName?: string;
}

/**
 * Feed 1: Daily bars, 1 year (Yahoo v8 chart, interval=1d&range=1y).
 * - Converts bar timestamps to America/New_York dates.
 * - Uses raw open, high, low, close, volume (never adjclose).
 * - Excludes today's unfinished partial bar if fetched before the session's NY close (16:00 NY / 13:00 half-day).
 * - Never overwrites the last completed daily bar's close with regularMarketPrice.
 * - Exposes live / pre-market price as a separate `lastPrice` field.
 */
export async function fetchDailyBars1Y(
  symbol: string,
  options?: { now?: Date }
): Promise<DailyFeedFetchResult> {
  const fetchedAt = new Date().toISOString();
  const now = options?.now ?? new Date();
  const expectedCompletedSession = getMostRecentCompletedUSSession(now);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const baseUrl = getYahooBaseUrl();
    const url = `${baseUrl}/v8/finance/chart/${encodeURIComponent(
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

    if (!res.ok) {
      const reason = `Yahoo HTTP ${res.status} (${res.statusText || 'Fetch failed'})`;
      logFeedError(symbol, 'daily_1y', res.status, reason);
      return {
        symbol,
        dataStatus: 'unavailable',
        asOfSession: null,
        fetchedAt,
        errorReason: reason,
        bars: [],
        lastPrice: null,
      };
    }

    const data = (await res.json()) as any;
    const result = data?.chart?.result?.[0];
    if (!result || !Array.isArray(result.timestamp) || result.timestamp.length === 0) {
      const reason = 'No daily chart bars returned by Yahoo Finance';
      logFeedError(symbol, 'daily_1y', 404, reason);
      return {
        symbol,
        dataStatus: 'unavailable',
        asOfSession: null,
        fetchedAt,
        errorReason: reason,
        bars: [],
        lastPrice: null,
      };
    }

    const timestamps: number[] = result.timestamp;
    const quote = result.indicators?.quote?.[0];
    if (!quote) {
      const reason = 'Missing OHLCV quote payload from Yahoo Finance';
      logFeedError(symbol, 'daily_1y', 502, reason);
      return {
        symbol,
        dataStatus: 'unavailable',
        asOfSession: null,
        fetchedAt,
        errorReason: reason,
        bars: [],
        lastPrice: null,
      };
    }

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
        const { nyDate } = toNewYorkDateTime(timestamps[i]);
        // Exclude any partial daily bar whose date is newer than the most recent completed US session
        if (nyDate > expectedCompletedSession) {
          continue;
        }

        byDate.set(nyDate, {
          date: nyDate,
          open: Number(open.toFixed(4)),
          high: Number(high.toFixed(4)),
          low: Number(low.toFixed(4)),
          close: Number(close.toFixed(4)),
          volume: Math.round(volume),
          isHalfDay: isNYSEHalfDay(nyDate),
        });
      }
    }

    const bars = Array.from(byDate.values()).sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    if (bars.length < 20) {
      const reason = `Insufficient completed daily history (${bars.length} bars)`;
      logFeedError(symbol, 'daily_1y', 502, reason);
      return {
        symbol,
        dataStatus: 'unavailable',
        asOfSession: null,
        fetchedAt,
        errorReason: reason,
        bars: [],
        lastPrice: null,
      };
    }

    const asOfSession = bars[bars.length - 1].date;
    const dataStatus: DataStatus =
      asOfSession < expectedCompletedSession ? 'stale' : 'ok';

    const rawRegPrice = result.meta?.regularMarketPrice;
    const lastPrice =
      typeof rawRegPrice === 'number' && rawRegPrice > 0
        ? Number(rawRegPrice.toFixed(2))
        : bars[bars.length - 1].close;

    const shortName = result.meta?.shortName || result.meta?.longName;
    const exchangeName = result.meta?.exchangeName;

    recordFeedSuccess('daily_1y');
    return {
      symbol,
      dataStatus,
      asOfSession,
      fetchedAt,
      bars,
      lastPrice,
      exchangeName,
      shortName,
    };
  } catch (err: any) {
    clearTimeout(timeout);
    const reason = err?.message || 'Network failure connecting to Yahoo Finance';
    logFeedError(symbol, 'daily_1y', null, reason);
    return {
      symbol,
      dataStatus: 'unavailable',
      asOfSession: null,
      fetchedAt,
      errorReason: reason,
      bars: [],
      lastPrice: null,
    };
  }
}

/**
 * Feed 2: 15-minute bars, 60 days (Yahoo v8 chart, interval=15m&range=60d).
 * - Converts every intraday timestamp to America/New_York before bucketing into sessions.
 * - A session's first candle is the 15-minute bar starting 09:30:00 New York.
 *   If missing for a day, firstCandle is null (never approximated).
 * - Flags half-day sessions.
 */
export async function fetchIntraday15m60D(
  symbol: string,
  options?: { now?: Date }
): Promise<Intraday15mFeedResult> {
  const fetchedAt = new Date().toISOString();
  const now = options?.now ?? new Date();
  const expectedCompletedSession = getMostRecentCompletedUSSession(now);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    const baseUrl = getYahooBaseUrl();
    const url = `${baseUrl}/v8/finance/chart/${encodeURIComponent(
      symbol
    )}?range=60d&interval=15m`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const reason = `Yahoo 15m HTTP ${res.status}`;
      logFeedError(symbol, 'intraday_15m_60d', res.status, reason);
      return {
        symbol,
        dataStatus: 'unavailable',
        fetchedAt,
        asOfSession: null,
        errorReason: reason,
        sessions: [],
      };
    }

    const data = (await res.json()) as any;
    const result = data?.chart?.result?.[0];
    if (!result || !Array.isArray(result.timestamp) || result.timestamp.length === 0) {
      const reason = 'No 15-minute bars returned by Yahoo Finance';
      logFeedError(symbol, 'intraday_15m_60d', 404, reason);
      return {
        symbol,
        dataStatus: 'unavailable',
        fetchedAt,
        asOfSession: null,
        errorReason: reason,
        sessions: [],
      };
    }

    const timestamps: number[] = result.timestamp;
    const quote = result.indicators?.quote?.[0];
    if (!quote) {
      const reason = 'Missing 15-minute quote indicators';
      logFeedError(symbol, 'intraday_15m_60d', 502, reason);
      return {
        symbol,
        dataStatus: 'unavailable',
        fetchedAt,
        asOfSession: null,
        errorReason: reason,
        sessions: [],
      };
    }

    const sessionsMap = new Map<string, Intraday15mBar[]>();

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
        typeof volume === 'number'
      ) {
        const { nyDate, nyTime } = toNewYorkDateTime(timestamps[i]);
        // Regular market session bars only (09:30:00 through 15:45:00 NY, or 12:45:00 on half days)
        const closeLimit = isNYSEHalfDay(nyDate) ? '13:00:00' : '16:00:00';
        if (nyTime < '09:30:00' || nyTime >= closeLimit) {
          continue;
        }

        const bar: Intraday15mBar = {
          timestamp: timestamps[i],
          nyDate,
          nyTime,
          open: Number(open.toFixed(4)),
          high: Number(high.toFixed(4)),
          low: Number(low.toFixed(4)),
          close: Number(close.toFixed(4)),
          volume: Math.round(volume),
        };

        const list = sessionsMap.get(nyDate) ?? [];
        list.push(bar);
        sessionsMap.set(nyDate, list);
      }
    }

    const sortedDates = Array.from(sessionsMap.keys()).sort((a, b) =>
      a.localeCompare(b)
    );

    if (sortedDates.length === 0) {
      const reason = 'No valid regular-session 15-minute bars found';
      logFeedError(symbol, 'intraday_15m_60d', 502, reason);
      return {
        symbol,
        dataStatus: 'unavailable',
        fetchedAt,
        asOfSession: null,
        errorReason: reason,
        sessions: [],
      };
    }

    const sessions: IntradaySession15m[] = sortedDates.map((sessionDate) => {
      const bars = (sessionsMap.get(sessionDate) ?? []).sort((a, b) =>
        a.nyTime.localeCompare(b.nyTime)
      );
      const firstCandle = bars.find((b) => b.nyTime === '09:30:00') ?? null;
      return {
        sessionDate,
        isHalfDay: isNYSEHalfDay(sessionDate),
        firstCandle,
        bars,
      };
    });

    const asOfSession = sessions[sessions.length - 1].sessionDate;
    const dataStatus: DataStatus =
      asOfSession < expectedCompletedSession ? 'stale' : 'ok';

    recordFeedSuccess('intraday_15m_60d');
    return {
      symbol,
      dataStatus,
      fetchedAt,
      asOfSession,
      sessions,
    };
  } catch (err: any) {
    clearTimeout(timeout);
    const reason = err?.message || 'Network failure fetching 15-minute bars';
    logFeedError(symbol, 'intraday_15m_60d', null, reason);
    return {
      symbol,
      dataStatus: 'unavailable',
      fetchedAt,
      asOfSession: null,
      errorReason: reason,
      sessions: [],
    };
  }
}

/**
 * Feed 3: Pre-market last price (Yahoo v8 chart, interval=5m&range=1d&includePrePost=true).
 * Takes the latest bar between 04:00:00 and 09:30:00 New York.
 */
export async function fetchPreMarketLastPrice(
  symbol: string
): Promise<PreMarketQuoteResult> {
  const fetchedAt = new Date().toISOString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const baseUrl = getYahooBaseUrl();
    const url = `${baseUrl}/v8/finance/chart/${encodeURIComponent(
      symbol
    )}?range=1d&interval=5m&includePrePost=true`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const reason = `Yahoo 5m pre-market HTTP ${res.status}`;
      logFeedError(symbol, 'premarket_5m_1d', res.status, reason);
      return {
        symbol,
        dataStatus: 'unavailable',
        fetchedAt,
        nyDate: null,
        nyTime: null,
        price: null,
        volume: null,
        sourceWindow: 'none',
        errorReason: reason,
      };
    }

    const data = (await res.json()) as any;
    const result = data?.chart?.result?.[0];
    if (!result || !Array.isArray(result.timestamp) || result.timestamp.length === 0) {
      const reason = 'No 5-minute pre-market bars returned by Yahoo Finance';
      logFeedError(symbol, 'premarket_5m_1d', 404, reason);
      return {
        symbol,
        dataStatus: 'unavailable',
        fetchedAt,
        nyDate: null,
        nyTime: null,
        price: null,
        volume: null,
        sourceWindow: 'none',
        errorReason: reason,
      };
    }

    const timestamps: number[] = result.timestamp;
    const quote = result.indicators?.quote?.[0];
    if (!quote) {
      const reason = 'Missing 5-minute quote payload';
      logFeedError(symbol, 'premarket_5m_1d', 502, reason);
      return {
        symbol,
        dataStatus: 'unavailable',
        fetchedAt,
        nyDate: null,
        nyTime: null,
        price: null,
        volume: null,
        sourceWindow: 'none',
        errorReason: reason,
      };
    }

    let latestPreMarket: {
      nyDate: string;
      nyTime: string;
      price: number;
      volume: number;
    } | null = null;

    let latestAnyBar: {
      nyDate: string;
      nyTime: string;
      price: number;
      volume: number;
    } | null = null;

    for (let i = 0; i < timestamps.length; i++) {
      const close = quote.close?.[i];
      const volume = quote.volume?.[i] ?? 0;
      if (typeof close === 'number' && close > 0) {
        const { nyDate, nyTime } = toNewYorkDateTime(timestamps[i]);
        const item = {
          nyDate,
          nyTime,
          price: Number(close.toFixed(2)),
          volume: Math.round(volume),
        };
        latestAnyBar = item;
        if (nyTime >= '04:00:00' && nyTime < '09:30:00') {
          latestPreMarket = item;
        }
      }
    }

    recordFeedSuccess('premarket_5m_1d');

    if (latestPreMarket) {
      return {
        symbol,
        dataStatus: 'ok',
        fetchedAt,
        nyDate: latestPreMarket.nyDate,
        nyTime: latestPreMarket.nyTime,
        price: latestPreMarket.price,
        volume: latestPreMarket.volume,
        sourceWindow: 'premarket_0400_0930',
      };
    }

    if (latestAnyBar) {
      return {
        symbol,
        dataStatus: 'ok',
        fetchedAt,
        nyDate: latestAnyBar.nyDate,
        nyTime: latestAnyBar.nyTime,
        price: latestAnyBar.price,
        volume: latestAnyBar.volume,
        sourceWindow: 'regular_or_post',
      };
    }

    const reason = 'No valid price bars in 5m range=1d response';
    logFeedError(symbol, 'premarket_5m_1d', 502, reason);
    return {
      symbol,
      dataStatus: 'unavailable',
      fetchedAt,
      nyDate: null,
      nyTime: null,
      price: null,
      volume: null,
      sourceWindow: 'none',
      errorReason: reason,
    };
  } catch (err: any) {
    clearTimeout(timeout);
    const reason = err?.message || 'Network failure fetching 5-minute pre-market price';
    logFeedError(symbol, 'premarket_5m_1d', null, reason);
    return {
      symbol,
      dataStatus: 'unavailable',
      fetchedAt,
      nyDate: null,
      nyTime: null,
      price: null,
      volume: null,
      sourceWindow: 'none',
      errorReason: reason,
    };
  }
}

function getSanitizedFinnhubKey(): string | null {
  const raw = (process.env.FINNHUB_API_KEY || '')
    .trim()
    .replace(/^FINNHUB_API_KEY\s*=\s*/i, '')
    .replace(/^["']+|["']+$/g, '')
    .trim();

  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (
    upper === 'YOUR_FINNHUB_API_KEY_HERE' ||
    upper === 'MY_FINNHUB_API_KEY' ||
    upper === 'PLACEHOLDER' ||
    upper === 'NONE' ||
    upper === 'NULL' ||
    upper === 'UNDEFINED' ||
    upper.includes('YOUR_') ||
    upper.includes('MY_')
  ) {
    return null;
  }
  return raw;
}

let verifiedFinnhubKeyStatus: {
  key: string;
  authorized: boolean;
  httpStatus: number | null;
} | null = null;
let inFlightFinnhubProbe: Promise<void> | null = null;

async function performSingleFinnhubEarningsFetch(
  symbol: string,
  fromDate: string,
  toDate: string,
  apiKey: string,
  fetchedAt: string
): Promise<EarningsFeedResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const url = `https://finnhub.io/api/v1/calendar/earnings?from=${encodeURIComponent(
      fromDate
    )}&to=${encodeURIComponent(toDate)}&symbol=${encodeURIComponent(
      symbol
    )}&token=${encodeURIComponent(apiKey)}`;

    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.status === 401 || res.status === 403) {
      const wasAlreadyFlagged =
        verifiedFinnhubKeyStatus?.key === apiKey &&
        verifiedFinnhubKeyStatus.authorized === false;
      verifiedFinnhubKeyStatus = {
        key: apiKey,
        authorized: false,
        httpStatus: res.status,
      };
      const reason = 'Earnings check unavailable — verify manually';
      if (!wasAlreadyFlagged) {
        logFeedError(
          symbol,
          'earnings_finnhub',
          res.status,
          `Finnhub API key unauthorized (HTTP ${res.status}) — verify FINNHUB_API_KEY in Secrets`
        );
      }
      return {
        symbol,
        dataStatus: 'unavailable',
        fetchedAt,
        providerConfigured: false,
        events: [],
        errorReason: reason,
      };
    }

    if (!res.ok) {
      const reason = 'Earnings check unavailable — verify manually';
      logFeedError(
        symbol,
        'earnings_finnhub',
        res.status,
        `Finnhub HTTP ${res.status}`
      );
      return {
        symbol,
        dataStatus: 'unavailable',
        fetchedAt,
        providerConfigured: true,
        events: [],
        errorReason: reason,
      };
    }

    verifiedFinnhubKeyStatus = {
      key: apiKey,
      authorized: true,
      httpStatus: 200,
    };

    const data = (await res.json()) as any;
    const rawList = Array.isArray(data?.earningsCalendar)
      ? data.earningsCalendar
      : [];

    const events: EarningsEvent[] = rawList
      .filter((item: any) => item && typeof item.date === 'string')
      .map((item: any) => ({
        symbol: String(item.symbol || symbol).toUpperCase(),
        date: item.date,
        hour: String(item.hour || ''),
        epsEstimate:
          typeof item.epsEstimate === 'number' ? item.epsEstimate : null,
        epsActual: typeof item.epsActual === 'number' ? item.epsActual : null,
      }));

    recordFeedSuccess('earnings_finnhub');
    return {
      symbol,
      dataStatus: 'ok',
      fetchedAt,
      providerConfigured: true,
      events,
    };
  } catch (err: any) {
    clearTimeout(timeout);
    const reason = 'Earnings check unavailable — verify manually';
    logFeedError(
      symbol,
      'earnings_finnhub',
      null,
      err?.message || 'Finnhub fetch failed'
    );
    return {
      symbol,
      dataStatus: 'unavailable',
      fetchedAt,
      providerConfigured: true,
      events: [],
      errorReason: reason,
    };
  }
}

/**
 * Feed 4: Earnings dates (Finnhub earnings calendar using FINNHUB_API_KEY from AI Studio Secrets / env).
 * If key is absent or call fails, returns dataStatus: 'unavailable' with
 * "Earnings check unavailable — verify manually".
 */
export async function fetchEarningsCalendar(
  symbol: string,
  fromDate: string,
  toDate: string
): Promise<EarningsFeedResult> {
  const fetchedAt = new Date().toISOString();
  const apiKey = getSanitizedFinnhubKey();

  if (!apiKey) {
    const reason = 'Earnings check unavailable — verify manually';
    feedLastStatus.earnings_finnhub.lastFetchAt = fetchedAt;
    feedLastStatus.earnings_finnhub.lastError =
      'FINNHUB_API_KEY not configured (optional)';
    return {
      symbol,
      dataStatus: 'unavailable',
      fetchedAt,
      providerConfigured: false,
      events: [],
      errorReason: reason,
    };
  }

  // If another concurrent request is currently verifying this key for the first time, wait for it
  if (verifiedFinnhubKeyStatus?.key !== apiKey && inFlightFinnhubProbe) {
    await inFlightFinnhubProbe;
  }

  // If this exact key was already rejected with 401/403, short-circuit without spamming Finnhub
  if (
    verifiedFinnhubKeyStatus?.key === apiKey &&
    verifiedFinnhubKeyStatus.authorized === false
  ) {
    return {
      symbol,
      dataStatus: 'unavailable',
      fetchedAt,
      providerConfigured: false,
      events: [],
      errorReason: 'Earnings check unavailable — verify manually',
    };
  }

  if (verifiedFinnhubKeyStatus?.key !== apiKey) {
    let resolveProbe!: () => void;
    inFlightFinnhubProbe = new Promise<void>((r) => {
      resolveProbe = r;
    });
    try {
      return await performSingleFinnhubEarningsFetch(
        symbol,
        fromDate,
        toDate,
        apiKey,
        fetchedAt
      );
    } finally {
      inFlightFinnhubProbe = null;
      resolveProbe();
    }
  }

  return performSingleFinnhubEarningsFetch(
    symbol,
    fromDate,
    toDate,
    apiKey,
    fetchedAt
  );
}

