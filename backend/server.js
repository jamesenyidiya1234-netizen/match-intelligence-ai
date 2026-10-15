
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cron = require('node-cron');
const mongoose = require('mongoose');

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '1mb' }));

// ==================================================
// 1. CONFIGURATION — FOOTBALL ONLY
// ==================================================

const PORT = process.env.PORT || 5001;
const MONGO_URI = process.env.MONGO_URI;
const FOOTBALL_DATA_API_KEY = process.env.FOOTBALL_DATA_API_KEY;
const SPORTMONKS_API_TOKEN = process.env.SPORTMONKS_API_TOKEN;

const FOOTBALL_LIMIT = Math.max(
  1,
  Math.min(20, Number(process.env.FOOTBALL_DAILY_LIMIT) || 20)
);

// Request the next seven days of fixtures.
const DAYS_AHEAD = 7;
const REQUEST_TIMEOUT_MS = 15000;

const footballApi = axios.create({
  baseURL: 'https://api.football-data.org/v4',
  timeout: REQUEST_TIMEOUT_MS,
  headers: {
    'X-Auth-Token': FOOTBALL_DATA_API_KEY || ''
  }
});

// ==================================================
// 2. DATABASE SCHEMAS
// ==================================================

const PredictionSchema = new mongoose.Schema({
  fixtureId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },

  sport: {
    type: String,
    default: 'football',
    required: true,
    index: true
  },

  league: String,
  homeTeam: String,
  awayTeam: String,
  homeTeamId: Number,
  awayTeamId: Number,

  date: {
    type: Date,
    index: true
  },

  status: {
    type: String,
    default: 'Scheduled',
    index: true
  },

  actualScore: String,
  predictedWinner: String,

  isFinished: {
    type: Boolean,
    default: false
  },

  isCorrect: {
    type: Boolean,
    default: null
  },

  allMarkets: Array,
  bestMarketString: String,
  topCorrectScores: Array,

  confidenceScore: String,
  dataQuality: String,
  recommendation: String,
  predictedScore: String,
  aiExplanation: String,

  modelVersion: {
    type: String,
    default: 'football-baseline-v20'
  },

  lastUpdated: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

const Prediction = mongoose.model(
  'Prediction',
  PredictionSchema
);

const HistorySchema = new mongoose.Schema({
  fixtureId: String,
  sport: String,
  league: String,
  homeTeam: String,
  awayTeam: String,
  homeTeamId: Number,
  awayTeamId: Number,
  date: Date,
  status: String,
  actualScore: String,
  predictedWinner: String,
  isFinished: Boolean,
  isCorrect: Boolean,
  allMarkets: Array,
  bestMarketString: String,
  topCorrectScores: Array,
  confidenceScore: String,
  dataQuality: String,
  recommendation: String,
  predictedScore: String,
  aiExplanation: String,
  modelVersion: String,
  errorDiagnosis: String
}, { timestamps: true });

const History = mongoose.model('History', HistorySchema);

// ==================================================
// 3. GENERAL HELPERS
// ==================================================

function formatDateUTC(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function isValidDate(value) {
  return Boolean(
    value && !Number.isNaN(new Date(value).getTime())
  );
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// ==================================================
// 4. FOOTBALL-DATA.ORG CONNECTION
// ==================================================

async function fetchFootballFixtures(from, to) {
  if (!FOOTBALL_DATA_API_KEY) {
    throw new Error(
      'FOOTBALL_DATA_API_KEY is missing from the environment.'
    );
  }

  const response = await footballApi.get('/matches', {
    params: {
      dateFrom: from,
      dateTo: to
    }
  });

  const matches = response.data?.matches;

  if (!Array.isArray(matches)) {
    throw new Error(
      'Football provider returned an unexpected response structure.'
    );
  }

  return matches;
}

// ==================================================
// 5. BASELINE PREDICTION ENGINE
// IMPORTANT:
// This is a basic placeholder model. It does not use
// verified form, injuries, lineups, or team statistics.
// ==================================================

class PredictionEngine {
  hashStrength(id) {
    let hash = Number(id) || 1;

    for (let i = 0; i < 3; i++) {
      hash = (hash * 31) % 1000;
    }

    return 0.3 + (hash / 1000) * 0.7;
  }

  factorial(n) {
    if (n < 0) return 0;
    if (n === 0) return 1;

    let result = 1;

    for (let i = 2; i <= n; i++) {
      result *= i;
    }

    return result;
  }

  poisson(expected, actual) {
    return (
      Math.pow(expected, actual) *
      Math.exp(-expected) /
      this.factorial(actual)
    );
  }

  analyzeFootball(match) {
    if (
      !match.fixtureId ||
      !match.homeTeam?.name ||
      !match.awayTeam?.name
    ) {
      throw new Error('Invalid football fixture.');
    }

    const homeStrength =
      this.hashStrength(match.homeTeam.id) + 0.15;

    const awayStrength =
      this.hashStrength(match.awayTeam.id);

    const totalStrength = homeStrength + awayStrength;

    const drawProbability = clamp(
      0.28 -
      (Math.abs(homeStrength - awayStrength) /
        totalStrength) * 0.2,
      0.15,
      0.30
    );

    const homeProbability =
      (homeStrength / totalStrength) *
      (1 - drawProbability);

    const awayProbability =
      (awayStrength / totalStrength) *
      (1 - drawProbability);

    const homeGoals = Math.max(
      0.15,
      (0.5 + homeStrength * 2) *
      (2 - awayStrength) / 1.4
    );

    const awayGoals = Math.max(
      0.15,
      (0.5 + awayStrength * 2) *
      (2 - homeStrength) / 1.4
    );

    const markets = [
      {
        market: 'Match Winner',
        selection: match.homeTeam.name,
        probability: homeProbability
      },
      {
        market: 'Match Winner',
        selection: 'Draw',
        probability: drawProbability
      },
      {
        market: 'Match Winner',
        selection: match.awayTeam.name,
        probability: awayProbability
      }
    ];

    const totalGoals = homeGoals + awayGoals;

    const probabilityUnderOneGoal =
      this.poisson(totalGoals, 0);

    const probabilityExactlyOneGoal =
      this.poisson(totalGoals, 1);

    markets.push({
      market: 'Over/Under 1.5 Goals',
      selection: 'Over 1.5',
      probability: clamp(
        1 -
        probabilityUnderOneGoal -
        probabilityExactlyOneGoal,
        0,
        1
      )
    });

    const bestMarket = markets.reduce(
      (best, current) =>
        current.probability > best.probability
          ? current
          : best
    );

    const correctScores = [];

    for (let home = 0; home <= 5; home++) {
      for (let away = 0; away <= 5; away++) {
        correctScores.push({
          score: `${home}-${away}`,
          probability:
            this.poisson(homeGoals, home) *
            this.poisson(awayGoals, away)
        });
      }
    }

    correctScores.sort(
      (a, b) => b.probability - a.probability
    );

    return {
      fixtureId: match.fixtureId,
      sport: 'football',
      league: match.league,
      homeTeam: match.homeTeam.name,
      awayTeam: match.awayTeam.name,
      homeTeamId: match.homeTeam.id,
      awayTeamId: match.awayTeam.id,
      date: new Date(match.date),
      status: 'Scheduled',

      allMarkets: markets.map(market => ({
        ...market,
        probability: (
          market.probability * 100
        ).toFixed(1)
      })),

      bestMarketString:
        `${bestMarket.market} (${bestMarket.selection})`,

      topCorrectScores: correctScores
        .slice(0, 5)
        .map(item => ({
          score: item.score,
          probability: (
            item.probability * 100
          ).toFixed(1)
        })),

      predictedWinner:
        homeProbability > awayProbability
          ? match.homeTeam.name
          : awayProbability > homeProbability
            ? match.awayTeam.name
            : 'Draw',

      confidenceScore: (
        bestMarket.probability * 100
      ).toFixed(1),

      dataQuality: 'LOW - BASELINE ONLY',

      recommendation:
        'BASELINE ONLY - VERIFY TEAM STATISTICS',

      predictedScore:
        `${Math.round(homeGoals)}-${Math.round(awayGoals)}`,

      aiExplanation:
        'This is a baseline estimate derived from team IDs. ' +
        'It does not use verified recent form, injuries, ' +
        'confirmed lineups, odds, or historical performance.',

      modelVersion: 'football-baseline-v20'
    };
  }
}

const engine = new PredictionEngine();

// ==================================================
// 6. SAVE OR UPDATE A FOOTBALL FIXTURE
// ==================================================

async function saveFootballFixture(match) {
  const fixtureId = match.id;
  const date = match.utcDate;
  const homeTeam = match.homeTeam;
  const awayTeam = match.awayTeam;
  const league = match.competition?.name || 'Unknown';

  if (
    fixtureId == null ||
    !isValidDate(date) ||
    !homeTeam?.name ||
    !awayTeam?.name ||
    homeTeam.id == null ||
    awayTeam.id == null
  ) {
    return 'invalid';
  }

  // Keep new provider IDs separate from older records.
  const databaseFixtureId = `fdorg_${fixtureId}`;

  const existing = await Prediction.findOne({
    fixtureId: databaseFixtureId
  }).lean();

  // Do not replace a finished match's prediction.
  if (existing?.isFinished) {
    return 'finished';
  }

  const prediction = engine.analyzeFootball({
    fixtureId: databaseFixtureId,
    league,
    date,
    homeTeam: {
      name: String(homeTeam.name),
      id: Number(homeTeam.id)
    },
    awayTeam: {
      name: String(awayTeam.name),
      id: Number(awayTeam.id)
    }
  });

  await Prediction.updateOne(
    {
      fixtureId: databaseFixtureId,
      isFinished: { $ne: true }
    },
    {
      $set: {
        ...prediction,
        date: new Date(date),
        status: 'Scheduled',
        lastUpdated: new Date()
      },
      $setOnInsert: {
        isFinished: false,
        isCorrect: null
      }
    },
    {
      upsert: true,
      runValidators: true
    }
  );

  return existing ? 'updated' : 'inserted';
}

// ==================================================
// 7. FOOTBALL-ONLY FIXTURE CYCLE
// ==================================================

let cycleRunning = false;

async function runDailyCycle() {
  if (cycleRunning) {
    console.log(
      '[CYCLE] Previous cycle is still running; skipping overlap.'
    );
    return;
  }

  if (mongoose.connection.readyState !== 1) {
    console.error('[CYCLE] MongoDB is not connected.');
    return;
  }

  if (!FOOTBALL_DATA_API_KEY) {
    console.error(
      '[CYCLE] FOOTBALL_DATA_API_KEY is missing.'
    );
    return;
  }

  cycleRunning = true;
  const startedAt = Date.now();

  try {
    console.log(
      `[CYCLE] Starting football-only cycle at ${new Date().toISOString()}`
    );

    const today = new Date();
    const from = formatDateUTC(today);
    const to = formatDateUTC(
      addDays(today, DAYS_AHEAD - 1)
    );

    console.log(
      `[FOOTBALL] Requesting fixtures from ${from} to ${to}.`
    );

    const matches = await fetchFootballFixtures(from, to);

    console.log(
      `[FOOTBALL] Provider returned ${matches.length} matches.`
    );

    const now = Date.now();

    const eligible = matches
      .filter(match =>
        ['SCHEDULED', 'TIMED'].includes(match.status)
      )
      .filter(match => isValidDate(match.utcDate))
      .filter(match =>
        new Date(match.utcDate).getTime() >= now
      )
      .sort((a, b) =>
        new Date(a.utcDate) - new Date(b.utcDate)
      )
      .slice(0, FOOTBALL_LIMIT);

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const match of eligible) {
      try {
        const result = await saveFootballFixture(match);

        if (result === 'inserted') {
          inserted++;
        } else if (result === 'updated') {
          updated++;
        } else {
          skipped++;
        }
      } catch (error) {
        skipped++;

        console.error(
          `[FOOTBALL] Failed to save fixture ${match.id}:`,
          error.message
        );
      }
    }

    const resultSummary = {
      sport: 'football',
      fetched: matches.length,
      eligible: eligible.length,
      inserted,
      updated,
      skipped
    };

    console.log(
      '[CYCLE] Football results:',
      JSON.stringify(resultSummary)
    );

    if (matches.length === 0) {
      console.warn(
        '[FOOTBALL] No fixtures were returned. Check your API token, ' +
        'date range, and free-plan competition coverage.'
      );
    } else if (eligible.length === 0) {
      console.warn(
        '[FOOTBALL] Fixtures were returned, but none qualified as ' +
        'upcoming scheduled matches in the selected date range.'
      );
    }

    await sendTelegramPredictions();
  } catch (error) {
    console.error(
      '[FOOTBALL] Fetch failed:',
      error.response?.status || '',
      JSON.stringify(
        error.response?.data || error.message
      )
    );
  } finally {
    console.log(
      `[CYCLE] Finished in ${
        ((Date.now() - startedAt) / 1000).toFixed(1)
      } seconds.`
    );

    cycleRunning = false;
  }
}

// ==================================================
// 8. RETENTION
// Preserve old records and prediction history.
// ==================================================

async function cleanupOldMatches() {
  console.log(
    '[CLEANUP] Automatic deletion disabled to preserve history.'
  );
}

// ==================================================
// 9. HEALTH CHECK
// ==================================================

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    db: mongoose.connection.readyState === 1,
    sport: 'football',
    provider: 'Football-Data.org',
    timestamp: new Date().toISOString()
  });
});

// ==================================================
// 10. PREDICTIONS API — FOOTBALL ONLY
// ==================================================
app.get('/api/sportmonks/health', async (req, res) => {
  if (!SPORTMONKS_API_TOKEN) {
    return res.status(503).json({
      ok: false,
      error: 'SPORTMONKS_API_TOKEN is missing.'
    });
  }

  try {
    const response = await axios.get(
      'https://api.sportmonks.com/v3/football/fixtures',
      {
        headers: {
          Authorization: SPORTMONKS_API_TOKEN
        },
        params: {
          per_page: 1
        },
        timeout: REQUEST_TIMEOUT_MS
      }
    );

    res.json({
      ok: true,
      provider: 'Sportmonks',
      authenticated: true,
      fixturesReturned: Array.isArray(response.data?.data)
        ? response.data.data.length
        : 0
    });
  } catch (error) {
    console.error(
      '[SPORTMONKS] Connection test failed:',
      error.response?.status || '',
      JSON.stringify(error.response?.data || error.message)
    );

    res.status(502).json({
      ok: false,
      provider: 'Sportmonks',
      error: 'Connection test failed. Check Render logs.'
    });
  }
});
app.get('/api/predictions', async (req, res) => {
  try {
    const filter = {
      sport: 'football'
    };

    if (req.query.from || req.query.to) {
      filter.date = {};

      if (
        req.query.from &&
        isValidDate(req.query.from)
      ) {
        filter.date.$gte = new Date(req.query.from);
      }

      if (
        req.query.to &&
        isValidDate(req.query.to)
      ) {
        const end = new Date(req.query.to);
        end.setUTCHours(23, 59, 59, 999);
        filter.date.$lte = end;
      }
    }

    const predictions = await Prediction.find(filter)
      .sort({ date: 1 })
      .lean();

    res.json({
      predictions,
      counts: {
        football: predictions.length,
        basketball: 0
      }
    });
  } catch (error) {
    console.error(
      '[API] Predictions error:',
      error.message
    );

    res.status(500).json({
      error: 'Failed to load football predictions.'
    });
  }
});

// ==================================================
// 11. PREDICTION HISTORY
// ==================================================

app.get('/api/history', async (req, res) => {
  try {
    const history = await History.find({
      sport: 'football'
    })
      .sort({ _id: -1 })
      .limit(100)
      .lean();

    const correct = history.filter(
      item => item.isCorrect === true
    ).length;

    const decided = history.filter(
      item =>
        item.isCorrect === true ||
        item.isCorrect === false
    ).length;

    res.json({
      history,
      sampleSize: decided,
      accuracy: decided
        ? (correct / decided * 100).toFixed(1)
        : 0
    });
  } catch (error) {
    console.error(
      '[API] History error:',
      error.message
    );

    res.status(500).json({
      error: 'Failed to load football history.'
    });
  }
});

// ==================================================
// 12. ANALYTICS
// ==================================================

app.get('/api/analytics', async (req, res) => {
  try {
    const history = await History.find({
      sport: 'football',
      isCorrect: { $in: [true, false] }
    }).lean();

    const correct = history.filter(
      item => item.isCorrect === true
    ).length;

    res.json({
      sampleSize: history.length,
      accuracy: history.length
        ? (correct / history.length * 100).toFixed(1)
        : 0,
      brierScore: null,
      note:
        'Accuracy is based only on recorded, evaluated football ' +
        'outcomes. Brier score is unavailable until outcome ' +
        'probabilities are recorded and evaluated.'
    });
  } catch (error) {
    console.error(
      '[API] Analytics error:',
      error.message
    );

    res.status(500).json({
      error: 'Failed to load football analytics.'
    });
  }
});

// ==================================================
// 13. ADMIN AUTHENTICATION
// ==================================================

function adminAuth(req, res, next) {
  const key = process.env.ADMIN_API_KEY;

  if (!key || req.headers['x-admin-key'] !== key) {
    return res.status(401).json({
      error: 'Unauthorized'
    });
  }

  next();
}

app.post(
  '/api/admin/run-cycle',
  adminAuth,
  async (req, res) => {
    if (cycleRunning) {
      return res.status(409).json({
        error: 'A football fixture cycle is already running.'
      });
    }

    // Run asynchronously so the request can return immediately.
    runDailyCycle().catch(error => {
      console.error(
        '[ADMIN] Cycle failed:',
        error.message
      );
    });

    res.status(202).json({
      message:
        'Football fixture cycle started. Check Render logs for results.'
    });
  }
);

// ==================================================
// 14. TELEGRAM NOTIFICATIONS — FOOTBALL ONLY
// ==================================================

async function sendTelegramPredictions() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId =
    process.env.TELEGRAM_CHAT_ID ||
    '@MatchIntelligenceAI';

  if (!botToken) {
    return;
  }

  try {
    const picks = await Prediction.find({
      sport: 'football',
      status: 'Scheduled',
      date: { $gte: new Date() }
    })
      .sort({ date: 1 })
      .limit(3)
      .lean();

    if (!picks.length) {
      console.log(
        '[TELEGRAM] No upcoming football predictions to send.'
      );
      return;
    }

    let message =
      '⚽ *MATCH INTELLIGENCE AI - FOOTBALL ESTIMATES* ⚽\n\n';

    for (let i = 0; i < picks.length; i++) {
      const prediction = picks[i];

      message +=
        `*${i + 1}. ${prediction.homeTeam} vs ${prediction.awayTeam}*\n`;

      message += `League: ${prediction.league}\n`;

      message +=
        `Kickoff: ${new Date(prediction.date).toUTCString()}\n`;

      message +=
        `Baseline selection: ${prediction.predictedWinner}\n`;

      message +=
        `Model quality: ${prediction.dataQuality}\n\n`;
    }

    message +=
      '⚠️ Baseline estimates only, not guarantees. Bet responsibly.';

    await axios.post(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown'
      },
      {
        timeout: REQUEST_TIMEOUT_MS
      }
    );

    console.log(
      '[TELEGRAM] Football predictions sent.'
    );
  } catch (error) {
    console.error(
      '[TELEGRAM] Send failed:',
      JSON.stringify(
        error.response?.data || error.message
      )
    );
  }
}

// ==================================================
// 15. START SERVER
// ==================================================

async function startServer() {
  if (!MONGO_URI) {
    console.error(
      '[STARTUP] MONGO_URI is missing. Configure it in Render.'
    );
    process.exit(1);
  }

  if (!FOOTBALL_DATA_API_KEY) {
    console.error(
      '[STARTUP] FOOTBALL_DATA_API_KEY is missing. ' +
      'Add it to Render Environment variables.'
    );
  }

  try {
    await mongoose.connect(MONGO_URI);

    console.log('[DATABASE] MongoDB connected.');

    app.listen(PORT, () => {
      console.log(
        `Match Intelligence AI listening on port ${PORT}.`
      );
      console.log('[STARTUP] Active sport: football only.');
      console.log('[STARTUP] Provider: Football-Data.org.');
    });

    // Run one cycle after startup.
    if (FOOTBALL_DATA_API_KEY) {
      runDailyCycle().catch(error => {
        console.error(
          '[STARTUP] Initial cycle failed:',
          error.message
        );
      });
    }

    // Repeat every six hours.
    cron.schedule('0 */6 * * *', () => {
      runDailyCycle().catch(error => {
        console.error(
          '[CRON] Football cycle failed:',
          error.message
        );
      });
    });

    console.log(
      '[CRON] Football fixture cycle scheduled every six hours.'
    );
  } catch (error) {
    console.error(
      '[STARTUP] Failed to connect to MongoDB:',
      error.message
    );
    process.exit(1);
  }
}

startServer();
