# VolFlow — Daily Volume Decision Tool & Silent Flip Pre-Market Shortlister

VolFlow is a React 19 + Vite + Express (`server.ts`) market decision-support workstation for US equities and GICS sector ETFs. It combines multi-timeframe relative volume (RVOL) analysis with the **Silent Flip Pre-Market Shortlister** and **Silent Flip Setup & Outcome Log**.

---

## Views

1. **1. Market Sectors**: Ranks the 11 GICS sector ETFs (`XLK`, `XLF`, `XLV`, `XLY`, `XLC`, `XLI`, `XLE`, `XLP`, `XLU`, `XLRE`, `XLB`) and their constituent stocks by relative volume, consistency score, and directional buying/selling split.
2. **2. All Fine Stocks**: Multi-timeframe RVOL scanner across the tracked equity universe.
3. **3. Volume Alerts**: Rule-based volume regime and breakout trigger engine.
4. **4. Daily Notes**:
   - **Volume Trade Notes**: Saved snapshots comparing historical sector/stock RVOL against live follow-through.
   - **Silent Flip log**: Deterministic 15-minute 3-candle auto-grader, summary strip (Shortlisted vs. Not-shortlisted), editable manual trade fields, and full CSV export.
5. **5. Pre-Market Shortlist**: Daily pre-market shortlist (`5–8` US equities, max `2` per sector), key horizontal levels (`FH`, `RH`, `RL`, `FL`), `T1`–`T5` pass/fail bench table, bench health & data health panels, and TradingView watchlist `.txt` export.

---

## Silent Flip shortlist

### 1. Morning Routine (UK & New York Times)
All market session dates and intraday bars are computed in `America/New_York` and displayed alongside derived `Europe/London` (UK) times using the IANA time-zone database (automatically adjusting between the standard 5-hour offset and the 4-hour spring/autumn DST transition weeks):

| Checkpoint | New York (`America/New_York`) | UK (`Europe/London`, standard 5h gap) | Action |
|---|---|---|---|
| **Lock shortlist** | `09:15 NY` | `14:15 UK` | Review pre-market gaps, toggle any manual `"Exclude: news"` rows or `"08:30 US data release today"`, click **Lock shortlist**, and export the TradingView watchlist (`silent-flip-YYYY-MM-DD.txt`) + copy levels. |
| **Open** | `09:30 NY` | `14:30 UK` | Regular US session opens; first 15-minute candle (`C1`, `09:30–09:45 NY`) begins. |
| **Candle 1 closes** | `09:45 NY` | `14:45 UK` | Check whether `C1` strongly probed `RH`/`FH` (for `SELL`) or `RL`/`FL` (for `BUY`). |
| **Candle 2 closes** | `10:00 NY` | `15:00 UK` | Check whether `C2` (`09:45–10:00 NY`) formed an opposite-coloured **Silent Candle** that held the tested level. |
| **Trigger cut-off** | `10:45 NY` | `15:45 UK` | Entry must trigger on the `10:00`, `10:15`, or `10:30` 15-minute bar before `10:45 NY`, or the pending setup expires. After `10:45 NY` (and after `16:15 NY` for full session outcomes), run the **Silent Flip log** auto-grader. |

---

### 2. Level Calculation Rules (`computeLevels` in `src/lib/silentFlip.ts`)
Let `D-1` be the most recent completed US regular trading session before the session being prepared (today's partial session is never an input; raw `high` and `low` are used, never `adjclose`):
- **Range High (`RH`)**: High of `D-1`.
- **Range Low (`RL`)**: Low of `D-1`.
- **Flip High (`FH`)**: Walk backwards from `D-2`, one session at a time, for at most `120` sessions. Stop at the first session whose high is greater than `RH × 1.0005` (`0.05%` tolerance). If none is found, `FH = null` (*"No Flip High — sell side off"*).
- **Flip Low (`FL`)**: Walk backwards from `D-2`, one session at a time, for at most `120` sessions. Stop at the first session whose low is less than `RL × 0.9995` (`0.05%` tolerance). If none is found, `FL = null` (*"No Flip Low — buy side off"*).

---

### 3. The Five Daily Shortlist Tests (`T1`–`T5` in `buildShortlist`, `src/lib/silentFlip.ts`)
In the tests, `A = firstCandleAvg` (mean 09:30 15-minute candle range over the last 60 sessions) and `P` is the latest pre-market price:

| Test | Name | Pass Condition | Fail Label Shown |
|---|---|---|---|
| **T1** | **Data** | `dataStatus === 'ok'` for daily (1Y), 15-minute (60D), and pre-market (5m) feeds | `"No data: [feed]"` |
| **T2** | **No catalyst** | No earnings release after the close on `D-1`, before the open today, or during today; and the manual `"Exclude: news"` toggle is off | `"Earnings [date/time]"` or `"Excluded: news"` |
| **T3** | **Levels exist** | At least one side has complete levels (`FH` and `RH` for `SELL`, or `RL` and `FL` for `BUY`) | `"No Flip level"` |
| **T4** | **Room for target** | `rangeInCandles = (RH - RL) / A >= 3.0` | `"Range too narrow ([x] candles)"` |
| **T5** | **Within reach** | **Sell side** (`FH` & `RH` present): passes if `RH - A <= P <= FH + A` (`P > FH + A` fails as `"Gapped beyond levels"`). **Buy side** (`FL` & `RL` present): passes if `FL - A <= P <= RL + A` (`P < FL - A` fails as `"Gapped beyond levels"`). If `P` sits between `RL + A` and `RH - A`, fails as `"Mid-range, out of reach"`. | `"Mid-range, out of reach"` or `"Gapped beyond levels"` |

**Scoring & Selection (`0–100`, survivors only)**:
- **Reach (`0–40`)**: `40 × (1 - d / A)`, clipped to `0–40`, where `d` is `P`'s distance to the nearest level on that side (`0` if `P` is inside `[RH, FH]` or `[FL, RL]`).
- **Respect (`0–40`)**: `40 × respectRate` for that side from the 60-day first-hour touch history (uses `50%` if sample size `n < 5`).
- **Room (`0–20`)**: `20 × min(rangeInCandles / 6, 1)`.
- Survivors are ranked by score descending and selected up to **8 total** with at most **2 per sector**. Failures never pad the list.

---

### 4. Where Every Parameter Lives

| Parameter / Config | Location | Default / Purpose |
|---|---|---|
| `DEFAULT_SILENT_FLIP_BENCH` | `src/lib/silentFlip.ts` (persisted as `SILENT_FLIP_BENCH` in `.volflow-store.json`) | Default 22 liquid US large caps across 8 GICS sectors (`NVDA, AMD, MSFT, META, GOOGL, DIS, T, AMZN, HD, NKE, BAC, JPM, C, PFE, MRK, ABBV, XOM, CVX, UBER, CAT, GE, WMT`). Editable in UI via the Bench Health panel. |
| `LEVEL_TOLERANCE_PCT` | `src/lib/silentFlip.ts` | `0.0005` (`0.05%`) tolerance for `FH`/`FL` detection and 60-day first-hour level touch/respect statistics. |
| `FLIP_LOOKBACK_SESSIONS` | `src/lib/silentFlip.ts` | `120` trading sessions maximum backward walk from `D-2` for `FH` and `FL`. |
| `DEFAULT_SILENT_FLIP_RULES` / `SILENT_FLIP_RULES` | `src/lib/silentFlip.ts` (persisted as `silentFlipRules` in `.volflow-store.json`) | Auto-grader parameters (`rulesVersion: 1`, `strongBodyPct: 0.60`, `strongRangeMult: 1.0`, `levelTolPct: 0.0005`, `breakRule: 'close'`, `stopOffset: 0.02`, `targetMode: 'range'`, `triggerCutoff: '10:45'`). Changing any parameter via `updateSilentFlipRules` increments `rulesVersion` while existing `SetupLogEntry` rows retain the version they were graded under. |
| `NYSE_HOLIDAYS` & `NYSE_HALF_DAYS` | `src/lib/marketData.ts` | NYSE full-day holiday calendar and 13:00 ET early-close half-day detection used by `getMostRecentCompletedUSSession`. |
| `FINNHUB_API_KEY` | `.env.example` / AI Studio Secrets (`src/lib/marketData.ts`) | Optional free Finnhub API key for earnings calendar checks. Never stored in code. If absent or unauthorized, VolFlow displays `"Earnings check unavailable — verify manually"`. |
