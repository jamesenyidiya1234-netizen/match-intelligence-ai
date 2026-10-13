
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cron = require('node-cron');
const mongoose = require('mongoose');

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '1mb' }));

// --------------------------------------------------
// CONFIGURATION
// --------------------------------------------------

const PORT = process.env.PORT || 5001;
const MONGO_URI = process.env.MONGO_URI;
const API_KEY = process.env.API_SPORTS_KEY;

const FOOTBALL_LIMIT = Math.max(
  1,
  Math.min(20, Number(process.env.FOOTBALL_DAILY_LIMIT) || 20)
);

const BASKETBALL_LIMIT = Math.max(
  1,
  Math.min(10, Number(process.env.BASKETBALL_DAILY_LIMIT) || 10)
);

const DAYS_AHEAD = 14;
const REQUEST_TIMEOUT_MS = 15000;

const footballApi = axios.create({
  baseURL: 'https://v3.football.api-sports.io',
  timeout: REQUEST_TIMEOUT_MS,
  headers: { 'x-apisports-key': API_KEY || '' }
});

const basketballApi = axios.create({
  baseURL: 'https://v1.basketball.api-sports.io',
  timeout: REQUEST_TIMEOUT_MS,
  headers: { 'x-apisports-key': API_KEY || '' }
});

// --------------------------------------------------
// DATABASE
// --------------------------------------------------

const PredictionSchema = new mongoose.Schema({
  fixtureId: { type: String, required: true, unique: true, index: true },
  sport: { type: String, required: true, index: true },
  league: String,
  homeTeam: String,
  awayTeam: String,
  homeTeamId: Number,
  awayTeamId: Number,

  date: { type: Date, index: true },
  status: { type: String, default: 'Scheduled', index: true },
  actualScore: String,

  predictedWinner: String,
  isFinished: { type: Boolean, default: false },
  isCorrect: { type: Boolean, default: null },

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
    default: 'v19.0-diagnostic-baseline'
  },

  lastUpdated: { type: Date, default: Date.now }
}, { timestamps: true });

const Prediction = mongoose.model('Prediction', PredictionSchema);

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

// --------------------------------------------------
// DATE HELPERS
// --------------------------------------------------

function formatDateUTC(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function isValidDate(value) {
  return value && !Number.isNaN(new Date(value).getTime());
}

function apiHasErrors(errors) {
  if (!errors) return false;
  if (Array.isArray(errors)) return errors.length > 0;
  if (typeof errors === 'object') return Object.keys(errors).length > 0;
  return Boolean(errors);
}

function logQuota(response, sport) {
  const headers = response.headers || {};

  const dailyRemaining =
    headers['x-ratelimit-requests-remaining'];

  const minuteRemaining =
    headers['x-ratelimit-remaining'];

  console.log(
    `[QUOTA] ${sport}: daily remaining=${dailyRemaining ?? 'unknown'}, ` +
    `minute remaining=${minuteRemaining ?? 'unknown'}`
  );
}

async function getApiResponse(client, path, params, sport) {
  const response = await client.get(path, { params });

  logQuota(response, sport);

  const body = response.data || {};

  if (apiHasErrors(body.errors)) {
    throw new Error(
      `${sport} provider error: ${JSON.stringify(body.errors)}`
    );
  }

  if (!Array.isArray(body.response)) {
    throw new Error(
      `${sport} provider returned an unexpected response structure`
    );
  }

  return body.response;
}

// --------------------------------------------------
// BASELINE PREDICTION ENGINE
// IMPORTANT: This is not a trained predictive model.
// Replace it with verified team statistics before
// describing predictions as data-driven.
// --------------------------------------------------

class PredictionEngine {
  hashStrength(id) {
    let h = Number(id) || 1;

    for (let i = 0; i < 3; i++) {
      h = (h * 31) % 1000;
    }

    return 0.3 + (h / 1000) * 0.7;
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

  analyze(match) {
    if (
      !match.homeTeam?.name ||
      !match.awayTeam?.name ||
      !match.fixtureId
    ) {
      throw new Error('Invalid fixture data');
    }

    return match.sport === 'basketball'
      ? this.analyzeBasketball(match)
      : this.analyzeFootball(match);
  }

  analyzeFootball(match) {
    const homeStrength = this.hashStrength(match.homeTeam.id) + 0.15;
    const awayStrength = this.hashStrength(match.awayTeam.id);

    const total = homeStrength + awayStrength;

    const drawProbability = Math.max(
      0.15,
      0.28 - Math.abs(homeStrength - awayStrength) / total * 0.2
    );

    const homeProbability =
      homeStrength / total * (1 - drawProbability);

    const awayProbability =
      awayStrength / total * (1 - drawProbability);

    const homeGoals = Math.max(
      0.15,
      (0.5 + homeStrength * 2) * (2 - awayStrength) / 1.4
    );

    const awayGoals = Math.max(
      0.15,
      (0.5 + awayStrength * 2) * (2 - homeStrength) / 1.4
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

    const underOneGoal = this.poisson(totalGoals, 0);
    const exactlyOneGoal = this.poisson(totalGoals, 1);

    markets.push({
      market: 'Over/Under 1.5 Goals',
      selection: 'Over 1.5',
      probability: Math.max(
        0,
        Math.min(1, 1 - underOneGoal - exactlyOneGoal)
      )
    });

    const best = markets.reduce(
      (previous, current) =>
        current.probability > previous.probability
          ? current
          : previous
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

    correctScores.sort((a, b) => b.probability - a.probability);

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

      allMarkets: markets.map(m => ({
        ...m,
        probability: (m.probability * 100).toFixed(1)
      })),

      bestMarketString: `${best.market} (${best.selection})`,
      topCorrectScores: correctScores.slice(0, 5).map(s => ({
        score: s.score,
        probability: (s.probability * 100).toFixed(1)
      })),

      predictedWinner:
        homeProbability > awayProbability
          ? match.homeTeam.name
          : match.awayTeam.name,

      confidenceScore: (best.probability * 100).toFixed(1),
      dataQuality: 'LOW - BASELINE ONLY',
      recommendation: 'BASELINE ONLY - VERIFY TEAM STATISTICS',

      predictedScore: `${Math.round(homeGoals)}-${Math.round(awayGoals)}`,

      aiExplanation:
        'Baseline estimate derived from team IDs, not verified recent form, ' +
        'injuries, lineups or historical team performance.'
    };
  }

  analyzeBasketball(match) {
    const homeStrength = this.hashStrength(match.homeTeam.id) + 0.15;
    const awayStrength = this.hashStrength(match.awayTeam.id);

    const homeProbability =
      homeStrength / (homeStrength + awayStrength);

    const awayProbability = 1 - homeProbability;

    const markets = [
      {
        market: 'Match Winner',
        selection: match.homeTeam.name,
        probability: homeProbability
      },
      {
        market: 'Match Winner',
        selection: match.awayTeam.name,
        probability: awayProbability
      }
    ];

    const best = markets[0].probability >= markets[1].probability
      ? markets[0]
      : markets[1];

    return {
      fixtureId: match.fixtureId,
      sport: 'basketball',
      league: match.league,
      homeTeam: match.homeTeam.name,
      awayTeam: match.awayTeam.name,
      homeTeamId: match.homeTeam.id,
      awayTeamId: match.awayTeam.id,
      date: new Date(match.date),
      status: 'Scheduled',

      allMarkets: markets.map(m => ({
        ...m,
        probability: (m.probability * 100).toFixed(1)
      })),

      bestMarketString: `${best.market} (${best.selection})`,
      topCorrectScores: [],

      predictedWinner: best.selection,
      confidenceScore: (best.probability * 100).toFixed(1),
      dataQuality: 'LOW - BASELINE ONLY',
      recommendation: 'BASELINE ONLY - VERIFY TEAM STATISTICS',

      predictedScore: 'Not available',
      aiExplanation:
        'No verified basketball performance statistics were used. ' +
        'This is not a reliable score forecast.'
    };
  }
}

const engine = new PredictionEngine();

// --------------------------------------------------
// FIXTURE PROCESSING
// --------------------------------------------------

let cycleRunning = false;

async function saveFixture(game, sport) {
  const isFootball = sport === 'football';

  const fixtureId = isFootball
    ? game.fixture?.id
    : game.id;

  const date = isFootball
    ? game.fixture?.date
    : game.date;

  const homeTeam = isFootball
    ? game.teams?.home
    : game.teams?.home;

  const awayTeam = isFootball
    ? game.teams?.away
    : game.teams?.away;

  const league = isFootball
    ? game.league?.name
    : game.league?.name;

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

  const prefix = isFootball ? 'apifoot_' : 'apibball_';
  const id = `${prefix}${fixtureId}`;

  const existing = await Prediction.findOne({ fixtureId: id }).lean();

  // Never overwrite a finished match with a new prediction.
  if (existing?.isFinished) return 'finished';

  // Refresh existing scheduled records; insert new ones.
  const prediction = engine.analyze({
    fixtureId: id,
    sport,
    league: league || 'Unknown',
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
    { fixtureId: id, isFinished: { $ne: true } },
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
    { upsert: true, runValidators: true }
  );

  return existing ? 'updated' : 'inserted';
}

function isScheduledFootball(game) {
  const status = game.fixture?.status?.short;
  return ['NS', 'TBD'].includes(status);
}

function isScheduledBasketball(game) {
  const status = game.status?.short;
  return ['NS', 'TBD'].includes(status);
}

// --------------------------------------------------
// SAFE CYCLE
// --------------------------------------------------

async function runDailyCycle() {
  if (cycleRunning) {
    console.log('[CYCLE] Previous cycle still running; skipping overlap.');
    return;
  }

  if (mongoose.connection.readyState !== 1) {
    console.error('[CYCLE] MongoDB is not connected.');
    return;
  }

  if (!API_KEY) {
    console.error('[CYCLE] API_SPORTS_KEY is missing.');
    return;
  }

  cycleRunning = true;

  const startedAt = Date.now();

  console.log(`[CYCLE] Starting at ${new Date().toISOString()}`);

  const today = new Date();
  const endDate = addDays(today, DAYS_AHEAD - 1);

  const from = formatDateUTC(today);
  const to = formatDateUTC(endDate);

  const totals = {
    football: { fetched: 0, eligible: 0, inserted: 0, updated: 0, skipped: 0 },
    basketball: { fetched: 0, eligible: 0, inserted: 0, updated: 0, skipped: 0 }
  };

  try {
    // Football: one request for the full date range.
    try {
      const fixtures = await getApiResponse(
        footballApi,
        '/fixtures',
        { from, to, timezone: 'UTC' },
        'football'
      );

      totals.football.fetched = fixtures.length;

      const eligible = fixtures
        .filter(isScheduledFootball)
        .filter(g => isValidDate(g.fixture?.date))
        .sort((a, b) =>
          new Date(a.fixture.date) - new Date(b.fixture.date)
        )
        .slice(0, FOOTBALL_LIMIT);

      totals.football.eligible = eligible.length;

      for (const game of eligible) {
        try {
          const result = await saveFixture(game, 'football');

          if (result === 'inserted') totals.football.inserted++;
          else if (result === 'updated') totals.football.updated++;
          else totals.football.skipped++;
        } catch (err) {
          totals.football.skipped++;
          console.error(
            '[FOOTBALL] Fixture save failed:',
            game.fixture?.id,
            err.message
          );
        }
      }
    } catch (err) {
      console.error('[FOOTBALL] Fetch failed:', err.message);
    }

    // Basketball: one request per date, within the provider quota.
    const basketballGames = [];

    for (let day = 0; day < DAYS_AHEAD; day++) {
      const date = formatDateUTC(addDays(today, day));

      try {
        const games = await getApiResponse(
          basketballApi,
          '/games',
          { date },
          'basketball'
        );

        basketballGames.push(...games);
      } catch (err) {
        console.error(
          `[BASKETBALL] Fetch failed for ${date}:`,
          err.message
        );
      }
    }

    totals.basketball.fetched = basketballGames.length;

    const eligibleBasketball = basketballGames
      .filter(isScheduledBasketball)
      .filter(g => isValidDate(g.date))
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, BASKETBALL_LIMIT);

    totals.basketball.eligible = eligibleBasketball.length;

    for (const game of eligibleBasketball) {
      try {
        const result = await saveFixture(game, 'basketball');

        if (result === 'inserted') totals.basketball.inserted++;
        else if (result === 'updated') totals.basketball.updated++;
        else totals.basketball.skipped++;
      } catch (err) {
        totals.basketball.skipped++;
        console.error(
          '[BASKETBALL] Fixture save failed:',
          game.id,
          err.message
        );
      }
    }

    console.log('[CYCLE] Results:', JSON.stringify(totals));
    console.log(
      `[CYCLE] Finished in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`
    );

    await sendTelegramPredictions();
  } finally {
    cycleRunning = false;
  }
}

// --------------------------------------------------
// RETENTION
// Do not delete matches simply because kickoff passed.
// --------------------------------------------------

async function cleanupOldMatches() {
  console.log(
    '[CLEANUP] Automatic deletion disabled to preserve history.'
  );
}

// --------------------------------------------------
// API ROUTES
// --------------------------------------------------

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    db: mongoose.connection.readyState === 1,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/predictions', async (req, res) => {
  try {
    const filter = {};

    if (req.query.sport === 'football' ||
        req.query.sport === 'basketball') {
      filter.sport = req.query.sport;
    }

    if (req.query.from || req.query.to) {
      filter.date = {};

      if (req.query.from && isValidDate(req.query.from)) {
        filter.date.$gte = new Date(req.query.from);
      }

      if (req.query.to && isValidDate(req.query.to)) {
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
        football: predictions.filter(p => p.sport === 'football').length,
        basketball: predictions.filter(p => p.sport === 'basketball').length
      }
    });
  } catch (err) {
    console.error('[API] Predictions error:', err.message);
    res.status(500).json({ error: 'Failed to load predictions.' });
  }
});

app.get('/api/history', async (req, res) => {
  try {
    const history = await History.find()
      .sort({ _id: -1 })
      .limit(100)
      .lean();

    const correct = history.filter(p => p.isCorrect === true).length;
    const decided = history.filter(p => p.isCorrect === true || p.isCorrect === false).length;

    res.json({
      history,
      sampleSize: decided,
      accuracy: decided ? (correct / decided * 100).toFixed(1) : 0
    });
  } catch (err) {
    console.error('[API] History error:', err.message);
    res.status(500).json({ error: 'Failed to load history.' });
  }
});

app.get('/api/analytics', async (req, res) => {
  try {
    const history = await History.find({
      isCorrect: { $in: [true, false] }
    }).lean();

    const correct = history.filter(p => p.isCorrect === true).length;

    res.json({
      sampleSize: history.length,
      accuracy: history.length
        ? (correct / history.length * 100).toFixed(1)
        : 0,
      brierScore: null,
      note: 'Brier score is unavailable until outcome probabilities are recorded and evaluated.'
    });
  } catch (err) {
    console.error('[API] Analytics error:', err.message);
    res.status(500).json({ error: 'Failed to load analytics.' });
  }
});

// --------------------------------------------------
// ADMIN ROUTES
// --------------------------------------------------

function adminAuth(req, res, next) {
  const key = process.env.ADMIN_API_KEY;

  if (!key || req.headers['x-admin-key'] !== key) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

app.post('/api/admin/run-cycle', adminAuth, async (req, res) => {
  if (cycleRunning) {
    return res.status(409).json({
      error: 'A fixture cycle is already running.'
    });
  }

  runDailyCycle().catch(err =>
    console.error('[ADMIN] Cycle failed:', err.message)
  );

  res.status(202).json({
    message: 'Fixture cycle started. Check Render logs for results.'
  });
});

// --------------------------------------------------
// TELEGRAM
// --------------------------------------------------

async function sendTelegramPredictions() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID || '@MatchIntelligenceAI';

  if (!botToken) return;

  try {
    const picks = await Prediction.find({
      status: 'Scheduled',
      date: { $gte: new Date() }
    })
      .sort({ date: 1 })
      .limit(3)
      .lean();

    if (!picks.length) {
      console.log('[TELEGRAM] No upcoming predictions to send.');
      return;
    }

    let message = '🏟️ *MATCH INTELLIGENCE AI - FIXTURE ESTIMATES* 🏟️\n\n';

    for (let i = 0; i < picks.length; i++) {
      const p = picks[i];

      message += `*${i + 1}. ${p.homeTeam} vs ${p.awayTeam}*\n`;
      message += `Sport: ${p.sport}\n`;
      message += `League: ${p.league}\n`;
      message += `Baseline selection: ${p.predictedWinner}\n`;
      message += `Model quality: ${p.dataQuality}\n\n`;
    }

    message += '⚠️ Baseline estimates only, not guarantees. Bet responsibly.';

    await axios.post(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown'
      },
      { timeout: REQUEST_TIMEOUT_MS }
    );

    console.log('[TELEGRAM] Message sent.');
  } catch (err) {
    console.error(
      '[TELEGRAM] Send failed:',
      err.response?.data || err.message
    );
  }
}

// --------------------------------------------------
// STARTUP
// --------------------------------------------------

async function startServer() {
  if (!MONGO_URI) {
    console.error('[STARTUP] MONGO_URI is missing. Configure it in Render.');
    process.exit(1);
  }

  try {
    await mongoose.connect(MONGO_URI);
    console.log('[DATABASE] MongoDB connected.');

    app.listen(PORT, () => {
      console.log(`Match Intelligence AI listening on port ${PORT}.`);
    });

    // Start one initial cycle after the server starts.
    runDailyCycle().catch(err =>
      console.error('[STARTUP] Initial cycle failed:', err.message)
    );

    // Four scheduled cycles per day.
    // With 14 basketball date requests per cycle, this uses
    // approximately 56 basketball requests/day plus any startup run.
    cron.schedule('0 */6 * * *', () => {
      runDailyCycle().catch(err =>
        console.error('[CRON] Cycle failed:', err.message)
      );
    });

    console.log('[CRON] Fixture cycle scheduled every six hours.');
  } catch (err) {
    console.error('[STARTUP] Failed to connect to MongoDB:', err.message);
    process.exit(1);
  }
}

startServer();
