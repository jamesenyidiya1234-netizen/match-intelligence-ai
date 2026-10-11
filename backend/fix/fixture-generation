require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cron = require('node-cron');
const mongoose = require('mongoose');

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',').map(s => s.trim()) : '*' }));
app.use(express.json({ limit: '1mb' }));

const PORT = Number(process.env.PORT || 5001);
const MONGO_URI = process.env.MONGO_URI;
const API_SPORTS_KEY = process.env.API_SPORTS_KEY;
const FOOTBALL_DAILY_LIMIT = Math.max(1, Number.parseInt(process.env.FOOTBALL_DAILY_LIMIT || '20', 10));
const BASKETBALL_DAILY_LIMIT = Math.max(1, Number.parseInt(process.env.BASKETBALL_DAILY_LIMIT || '10', 10));
const FIXTURE_DAYS_AHEAD = Math.min(7, Math.max(1, Number.parseInt(process.env.FIXTURE_DAYS_AHEAD || '3', 10)));
const API_TIMEOUT_MS = Math.max(5000, Number.parseInt(process.env.API_TIMEOUT_MS || '20000', 10));

const PredictionSchema = new mongoose.Schema({
  fixtureId: { type: String, required: true, unique: true, index: true },
  sport: { type: String, enum: ['football', 'basketball'], required: true, index: true },
  league: { type: String, default: 'Unknown' },
  homeTeam: { type: String, required: true },
  awayTeam: { type: String, required: true },
  homeTeamId: Number,
  awayTeamId: Number,
  date: { type: Date, required: true, index: true },
  status: { type: String, default: 'Scheduled', index: true },
  actualScore: { type: String, default: null },
  actualWinner: { type: String, default: null },
  predictedWinner: { type: String, default: 'No reliable prediction' },
  isFinished: { type: Boolean, default: false, index: true },
  isCorrect: { type: Boolean, default: null },
  allMarkets: { type: Array, default: [] },
  bestMarketString: { type: String, default: 'No reliable market' },
  topCorrectScores: { type: Array, default: [] },
  confidenceScore: { type: String, default: '0' },
  dataQuality: { type: String, default: 'LOW' },
  recommendation: { type: String, default: 'NO STRONG PREDICTION' },
  predictedScore: { type: String, default: 'N/A' },
  aiExplanation: { type: String, default: '' },
  missingData: { type: Array, default: [] },
  modelVersion: { type: String, default: 'v19.0-fixture-fix' },
  lastSyncedAt: { type: Date, default: Date.now },
  errorDiagnosis: { type: String, default: null }
}, { timestamps: true, strict: true });

const HistorySchema = new mongoose.Schema({ ...PredictionSchema.obj }, { timestamps: true, strict: true });
const Prediction = mongoose.models.Prediction || mongoose.model('Prediction', PredictionSchema);
const History = mongoose.models.History || mongoose.model('History', HistorySchema);

function dateStringUTC(date) {
  return date.toISOString().slice(0, 10);
}

function getDateStrings(daysAhead) {
  const dates = [];
  const now = new Date();
  for (let i = 0; i < daysAhead; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i));
    dates.push(dateStringUTC(d));
  }
  return dates;
}

function poisson(lambda, goals) {
  if (!Number.isFinite(lambda) || lambda < 0 || goals < 0) return 0;
  let factorial = 1;
  for (let i = 2; i <= goals; i++) factorial *= i;
  return (Math.pow(lambda, goals) * Math.exp(-lambda)) / factorial;
}

// This baseline only creates a clearly-labelled estimate. It does not claim to use form,
// injuries, lineups, odds, or other statistics that this service has not fetched.
function makeFootballPrediction(game) {
  const home = game.teams.home.name;
  const away = game.teams.away.name;
  const league = game.league?.name || 'Unknown';
  const homeXG = 1.45;
  const awayXG = 1.15;
  let homeWin = 0, draw = 0, awayWin = 0;
  const scores = [];
  for (let h = 0; h <= 8; h++) {
    for (let a = 0; a <= 8; a++) {
      const p = poisson(homeXG, h) * poisson(awayXG, a);
      scores.push({ score: `${h}-${a}`, probability: p });
      if (h > a) homeWin += p;
      else if (h === a) draw += p;
      else awayWin += p;
    }
  }
  const total = homeWin + draw + awayWin || 1;
  homeWin /= total; draw /= total; awayWin /= total;
  const totalGoals = homeXG + awayXG;
  const p0 = poisson(totalGoals, 0);
  const p1 = poisson(totalGoals, 1);
  const p2 = poisson(totalGoals, 2);
  const over15 = Math.max(0, Math.min(1, 1 - p0 - p1));
  const over25 = Math.max(0, Math.min(1, 1 - p0 - p1 - p2));
  const markets = [
    { market: 'Match Winner', selection: home, probability: homeWin },
    { market: 'Match Winner', selection: 'Draw', probability: draw },
    { market: 'Match Winner', selection: away, probability: awayWin },
    { market: 'Double Chance', selection: `${home} or Draw`, probability: homeWin + draw },
    { market: 'Over/Under 1.5 Goals', selection: 'Over 1.5', probability: over15 },
    { market: 'Over/Under 2.5 Goals', selection: 'Over 2.5', probability: over25 }
  ];
  // Keep market comparisons within a market type; do not call a double-chance percentage
  // the probability that a team wins.
  const winnerMarkets = markets.filter(m => m.market === 'Match Winner');
  const likelyWinner = winnerMarkets.reduce((best, item) => item.probability > best.probability ? item : best, winnerMarkets[0]);
  const bestMarket = markets.reduce((best, item) => item.probability > best.probability ? item : best, markets[0]);
  scores.sort((a, b) => b.probability - a.probability);
  return {
    fixtureId: `apifoot_${game.fixture.id}`,
    sport: 'football', league, homeTeam: home, awayTeam: away,
    homeTeamId: game.teams.home.id, awayTeamId: game.teams.away.id,
    date: new Date(game.fixture.date), status: 'Scheduled', isFinished: false,
    allMarkets: markets.map(m => ({ ...m, probability: (m.probability * 100).toFixed(1) })),
    bestMarketString: `${bestMarket.market} (${bestMarket.selection})`,
    topCorrectScores: scores.slice(0, 5).map(s => ({ score: s.score, probability: (s.probability * 100).toFixed(1) })),
    predictedWinner: likelyWinner.probability >= 0.45 ? likelyWinner.selection : 'No reliable prediction',
    confidenceScore: (likelyWinner.probability * 100).toFixed(1),
    dataQuality: 'LOW',
    recommendation: 'BASELINE ONLY — VERIFY REAL TEAM DATA',
    predictedScore: `${Math.round(homeXG)}-${Math.round(awayXG)}`,
    missingData: ['Real team form, goals for/against, injuries, lineups, and odds were not fetched.'],
    aiExplanation: 'Baseline Poisson estimate using generic expected-goal values only. It is not a verified, form-based prediction.',
    modelVersion: 'v19.0-fixture-fix'
  };
}

function makeBasketballPrediction(game) {
  const home = game.teams?.home?.name || 'Home team';
  const away = game.teams?.away?.name || 'Away team';
  return {
    fixtureId: `apibball_${game.id}`,
    sport: 'basketball', league: game.league?.name || 'Unknown', homeTeam: home, awayTeam: away,
    homeTeamId: game.teams?.home?.id, awayTeamId: game.teams?.away?.id,
    date: new Date(game.date), status: 'Scheduled', isFinished: false,
    allMarkets: [], bestMarketString: 'No reliable market', topCorrectScores: [],
    predictedWinner: 'No reliable prediction', confidenceScore: '0', dataQuality: 'LOW',
    recommendation: 'NO PREDICTION — REAL BASKETBALL STATS REQUIRED', predictedScore: 'N/A',
    missingData: ['Recent team scores and team statistics have not been fetched.'],
    aiExplanation: 'Fixture found, but a prediction is withheld because this code does not yet fetch basketball performance data.',
    modelVersion: 'v19.0-fixture-fix'
  };
}

async function fetchFootballFixtures(headers, dateStr) {
  const url = 'https://v3.football.api-sports.io/fixtures';
  const response = await axios.get(url, { headers, params: { date: dateStr }, timeout: API_TIMEOUT_MS });
  if (response.data?.errors && Object.keys(response.data.errors).length) {
    throw new Error(`Football API errors for ${dateStr}: ${JSON.stringify(response.data.errors)}`);
  }
  if (!Array.isArray(response.data?.response)) {
    throw new Error(`Unexpected football API response for ${dateStr}`);
  }
  return response.data.response;
}

async function fetchBasketballGames(headers, dateStr) {
  const url = 'https://v1.basketball.api-sports.io/games';
  const response = await axios.get(url, { headers, params: { date: dateStr }, timeout: API_TIMEOUT_MS });
  if (response.data?.errors && Object.keys(response.data.errors).length) {
    throw new Error(`Basketball API errors for ${dateStr}: ${JSON.stringify(response.data.errors)}`);
  }
  if (!Array.isArray(response.data?.response)) {
    throw new Error(`Unexpected basketball API response for ${dateStr}`);
  }
  return response.data.response;
}

async function saveNewPredictions(fixtures, sport, limit) {
  const candidates = fixtures.filter(item => item && item.fixtureId && item.date && new Date(item.date) >= new Date());
  candidates.sort((a, b) => new Date(a.date) - new Date(b.date));
  if (!candidates.length) return { eligible: 0, saved: 0, duplicates: 0, dailyRemaining: limit };

  // Enforce the configured number of newly-created predictions per UTC calendar day.
  const now = new Date();
  const utcDayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const createdToday = await Prediction.countDocuments({ sport, createdAt: { $gte: utcDayStart } });
  const dailyRemaining = Math.max(0, limit - createdToday);
  if (dailyRemaining === 0) {
    return { eligible: candidates.length, saved: 0, duplicates: 0, dailyRemaining: 0, dailyLimitReached: true };
  }

  const ids = candidates.map(item => item.fixtureId);
  const existing = await Prediction.find({ fixtureId: { $in: ids } }).select('fixtureId').lean();
  const existingIds = new Set(existing.map(item => item.fixtureId));
  const newItems = candidates.filter(item => !existingIds.has(item.fixtureId)).slice(0, dailyRemaining);
  let saved = 0;
  let duplicates = 0;
  for (const item of newItems) {
    try {
      // Upsert makes the save idempotent if two worker runs overlap.
      const result = await Prediction.updateOne(
        { fixtureId: item.fixtureId },
        { $setOnInsert: item, $set: { lastSyncedAt: new Date() } },
        { upsert: true, runValidators: true }
      );
      if (result.upsertedCount > 0) saved++;
      else duplicates++;
    } catch (err) {
      if (err.code === 11000) duplicates++;
      else throw err;
    }
  }
  return { eligible: candidates.length, saved, duplicates, dailyRemaining: Math.max(0, dailyRemaining - saved) };
}

let cycleRunning = false;
async function runDailyCycle() {
  if (cycleRunning) {
    console.log('[Worker] A cycle is already running; skipping overlapping run.');
    return { skipped: true };
  }
  if (!API_SPORTS_KEY) throw new Error('Missing API_SPORTS_KEY environment variable.');
  if (mongoose.connection.readyState !== 1) throw new Error('MongoDB is not connected.');
  cycleRunning = true;
  const headers = { 'x-apisports-key': API_SPORTS_KEY };
  const dates = getDateStrings(FIXTURE_DAYS_AHEAD);
  const summary = { dates, football: null, basketball: null };
  try {
    const footballFixtures = [];
    for (const dateStr of dates) {
      try {
        const rows = await fetchFootballFixtures(headers, dateStr);
        footballFixtures.push(...rows.filter(g => ['NS', 'TBD'].includes(g.fixture?.status?.short)));
      } catch (err) {
        console.error(`[Football] ${dateStr}: ${err.message}`);
      }
    }
    const footballItems = footballFixtures.map(makeFootballPrediction);
    summary.football = await saveNewPredictions(footballItems, 'football', FOOTBALL_DAILY_LIMIT);
    console.log(`[Football] Dates=${dates.join(',')} eligible=${summary.football.eligible} saved=${summary.football.saved} duplicates=${summary.football.duplicates}`);

    const basketballGames = [];
    for (const dateStr of dates) {
      try {
        const rows = await fetchBasketballGames(headers, dateStr);
        basketballGames.push(...rows.filter(g => ['NS', 'TBD'].includes(g.status?.short)));
      } catch (err) {
        console.error(`[Basketball] ${dateStr}: ${err.message}`);
      }
    }
    const basketballItems = basketballGames.map(makeBasketballPrediction);
    summary.basketball = await saveNewPredictions(basketballItems, 'basketball', BASKETBALL_DAILY_LIMIT);
    console.log(`[Basketball] Dates=${dates.join(',')} eligible=${summary.basketball.eligible} saved=${summary.basketball.saved} duplicates=${summary.basketball.duplicates}`);
    await sendTelegramPredictions();
    return summary;
  } finally {
    cycleRunning = false;
  }
}

// Never automatically delete a fixture simply because kickoff is in the past.
// Completed-result syncing should be implemented before moving records to History.
async function cleanupOldMatches() {
  console.log('[Cleanup] Automatic deletion is disabled to preserve predictions and history.');
  return { deleted: 0 };
}

app.get('/health', (req, res) => res.json({
  ok: true,
  dbConnected: mongoose.connection.readyState === 1,
  apiKeyConfigured: Boolean(API_SPORTS_KEY),
  time: new Date().toISOString()
}));

app.get('/api/predictions', async (req, res) => {
  try {
    const filter = {};
    if (['football', 'basketball'].includes(req.query.sport)) filter.sport = req.query.sport;
    const preds = await Prediction.find(filter).sort({ date: 1 }).limit(1000).lean();
    res.json({ predictions: preds, counts: {
      football: preds.filter(p => p.sport === 'football').length,
      basketball: preds.filter(p => p.sport === 'basketball').length,
      total: preds.length
    } });
  } catch (err) {
    console.error('[Route] /api/predictions:', err.message);
    res.status(500).json({ error: 'Failed to retrieve predictions.' });
  }
});

app.get('/api/history', async (req, res) => {
  try {
    const history = await History.find().sort({ date: -1 }).limit(200).lean();
    const settled = history.filter(p => typeof p.isCorrect === 'boolean');
    const accuracy = settled.length ? (settled.filter(p => p.isCorrect).length / settled.length * 100).toFixed(1) : '0.0';
    res.json({ history, accuracy, sampleSize: settled.length });
  } catch (err) {
    console.error('[Route] /api/history:', err.message);
    res.status(500).json({ error: 'Failed to retrieve history.' });
  }
});

app.get('/api/analytics', async (req, res) => {
  try {
    const settled = await Prediction.find({ isFinished: true, isCorrect: { $ne: null } }).select('sport isCorrect').lean();
    const correct = settled.filter(p => p.isCorrect).length;
    res.json({ sampleSize: settled.length, correct, accuracy: settled.length ? Number((correct / settled.length * 100).toFixed(1)) : null, note: 'Accuracy is calculated only from records marked finished with a settled correctness value. Calibration metrics are not calculated by this endpoint.' });
  } catch (err) {
    console.error('[Route] /api/analytics:', err.message);
    res.status(500).json({ error: 'Failed to calculate analytics.' });
  }
});

const adminAuth = (req, res, next) => {
  const configuredKey = process.env.ADMIN_API_KEY;
  if (!configuredKey) return res.status(503).json({ error: 'ADMIN_API_KEY is not configured.' });
  if (req.get('x-admin-key') !== configuredKey) return res.status(401).json({ error: 'Unauthorized.' });
  next();
};

app.post('/api/admin/run-cycle', adminAuth, async (req, res) => {
  try {
    const result = await runDailyCycle();
    res.json({ message: result.skipped ? 'Cycle already running.' : 'Cycle completed.', result });
  } catch (err) {
    console.error('[Admin] run-cycle failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

async function sendTelegramPredictions() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID || '@MatchIntelligenceAI';
  if (!botToken) return;
  try {
    const picks = await Prediction.find({ status: 'Scheduled', sport: 'football', dataQuality: 'HIGH' }).sort({ confidenceScore: -1 }).limit(3).lean();
    if (!picks.length) {
      console.log('[Telegram] No high-quality football picks to send; no message sent.');
      return;
    }
    const lines = ['⚽ MATCH INTELLIGENCE AI — TOP PICKS', ''];
    picks.forEach((p, i) => {
      lines.push(`${i + 1}. ${p.homeTeam} vs ${p.awayTeam}`);
      lines.push(`League: ${p.league}`);
      lines.push(`Selection: ${p.bestMarketString}`);
      lines.push(`Confidence estimate: ${p.confidenceScore}%`);
      lines.push('');
    });
    lines.push('Probabilities are estimates, not guarantees. Bet responsibly.');
    await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      chat_id: chatId, text: lines.join('\n'), disable_web_page_preview: true
    }, { timeout: API_TIMEOUT_MS });
    console.log('[Telegram] Picks sent.');
  } catch (err) {
    console.error('[Telegram] Send failed:', err.response?.data || err.message);
  }
}

async function startServer() {
  if (!MONGO_URI) {
    console.error('[Startup] MONGO_URI is missing. Server will not start without a database.');
    process.exit(1);
  }
  try {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 15000 });
    console.log('[Startup] MongoDB connected.');
    app.listen(PORT, () => console.log(`[Startup] Match Intelligence AI listening on port ${PORT}.`));
    // Fetch immediately regardless of whether the database already has records.
    runDailyCycle().catch(err => console.error('[Startup] Initial fixture cycle failed:', err.message));
    cron.schedule('0 * * * *', () => {
      runDailyCycle().catch(err => console.error('[Scheduler] Fixture cycle failed:', err.message));
    });
  } catch (err) {
    console.error('[Startup] Failed to connect to MongoDB:', err.message);
    process.exit(1);
  }
}

if (require.main === module) startServer();
module.exports = { app, runDailyCycle, makeFootballPrediction, makeBasketballPrediction, getDateStrings };
