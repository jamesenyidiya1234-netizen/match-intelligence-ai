'use strict';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cron = require('node-cron');
const mongoose = require('mongoose');

const app = express();
app.use(express.json({ limit: '1mb' }));
const allowedOrigins = (process.env.CORS_ORIGINS || '*').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins.includes('*') ? '*' : allowedOrigins }));

const PORT = Number(process.env.PORT || 5001);
const MONGO_URI = process.env.MONGO_URI;
const API_SPORTS_KEY = process.env.API_SPORTS_KEY;
const FOOTBALL_BASE = 'https://v3.football.api-sports.io';
const BASKETBALL_BASE = 'https://v1.basketball.api-sports.io';
const FOOTBALL_DAILY_LIMIT = Math.max(1, Number(process.env.FOOTBALL_DAILY_LIMIT || 20));
const BASKETBALL_DAILY_LIMIT = Math.max(1, Number(process.env.BASKETBALL_DAILY_LIMIT || 10));
const CACHE_TTL_MS = Math.max(5, Number(process.env.STATS_CACHE_MINUTES || 60)) * 60 * 1000;
const MODEL_VERSION = 'real-form-poisson-v1.0';

const PredictionSchema = new mongoose.Schema({
  fixtureId: { type: String, required: true, unique: true, index: true },
  sport: { type: String, enum: ['football', 'basketball'], required: true, index: true },
  league: String, leagueId: Number, season: mongoose.Schema.Types.Mixed,
  homeTeam: String, awayTeam: String, homeTeamId: Number, awayTeamId: Number,
  date: { type: Date, index: true }, status: { type: String, default: 'Scheduled', index: true },
  predictedWinner: String, predictedScore: String, confidenceScore: { type: Number, default: 0 },
  winnerProbabilities: mongoose.Schema.Types.Mixed, allMarkets: [mongoose.Schema.Types.Mixed],
  bestMarketString: String, topCorrectScores: [mongoose.Schema.Types.Mixed],
  dataQuality: { type: String, enum: ['HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT'], default: 'INSUFFICIENT' },
  recommendation: String, aiExplanation: String, missingData: [String], modelVersion: { type: String, default: MODEL_VERSION },
  actualScore: String, actualWinner: String, isFinished: { type: Boolean, default: false },
  isCorrect: { type: Boolean, default: null }, errorDiagnosis: String
}, { timestamps: true, strict: true });

const HistorySchema = new mongoose.Schema({}, { strict: false, timestamps: true });
const Prediction = mongoose.models.Prediction || mongoose.model('Prediction', PredictionSchema);
const History = mongoose.models.History || mongoose.model('History', HistorySchema);
const statsCache = new Map();
let cycleRunning = false;

function dateString(date = new Date()) {
  // Use UTC consistently. Set TZ=... in the hosting environment if local-day behaviour is required.
  return date.toISOString().slice(0, 10);
}
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function factorial(n) { let value = 1; for (let i = 2; i <= n; i++) value *= i; return value; }
function poisson(lambda, goals) { return (Math.pow(lambda, goals) * Math.exp(-lambda)) / factorial(goals); }
function pct(n) { return Number((clamp(n, 0, 1) * 100).toFixed(1)); }
function isFootballFinished(status) { return ['FT', 'AET', 'PEN'].includes(status); }
function isBasketballFinished(status) { return ['FT', 'AOT', 'POST'].includes(status); }
function isLive(status, sport) {
  const football = ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'INT'];
  const basketball = ['Q1', 'Q2', 'Q3', 'Q4', 'OT', 'BT', 'HT', 'LIVE'];
  return (sport === 'football' ? football : basketball).includes(status);
}
function apiClient(baseURL) {
  return axios.create({ baseURL, timeout: 20000, headers: { 'x-apisports-key': API_SPORTS_KEY } });
}
const footballApi = apiClient(FOOTBALL_BASE);
const basketballApi = apiClient(BASKETBALL_BASE);

async function cached(key, loader) {
  const current = statsCache.get(key);
  if (current && current.expiresAt > Date.now()) return current.value;
  const value = await loader();
  statsCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}
async function apiResponse(client, path, params) {
  const response = await client.get(path, { params });
  if (response.data?.errors && Object.keys(response.data.errors).length) {
    throw new Error(`API-Sports error: ${JSON.stringify(response.data.errors)}`);
  }
  return Array.isArray(response.data?.response) ? response.data.response : [];
}

// Only completed matches before the upcoming fixture are used. No random form, mock injuries, or mock H2H.
async function footballRecent(teamId, beforeDate) {
  return cached(`football:${teamId}:${dateString(new Date(beforeDate))}`, async () => {
    const games = await apiResponse(footballApi, '/fixtures', { team: teamId, last: 10, status: 'FT' });
    return games.filter(g => new Date(g.fixture?.date) < new Date(beforeDate) && isFootballFinished(g.fixture?.status?.short))
      .sort((a, b) => new Date(b.fixture.date) - new Date(a.fixture.date)).slice(0, 5);
  });
}
function footballTeamStats(games, teamId) {
  let gf = 0, ga = 0, wins = 0, draws = 0, losses = 0, count = 0;
  for (const game of games) {
    const isHome = Number(game.teams?.home?.id) === Number(teamId);
    const own = isHome ? game.goals?.home : game.goals?.away;
    const against = isHome ? game.goals?.away : game.goals?.home;
    if (!Number.isFinite(own) || !Number.isFinite(against)) continue;
    gf += own; ga += against; count++;
    if (own > against) wins++; else if (own === against) draws++; else losses++;
  }
  if (!count) return null;
  return { played: count, goalsForPerMatch: gf / count, goalsAgainstPerMatch: ga / count, wins, draws, losses };
}
function normalize(values) {
  const sum = values.reduce((a, b) => a + b, 0);
  return sum > 0 ? values.map(v => v / sum) : values.map(() => 1 / values.length);
}
function footballPrediction(fixture, homeStats, awayStats) {
  const missing = [];
  if (!homeStats || homeStats.played < 3) missing.push('Home team has fewer than 3 usable recent results');
  if (!awayStats || awayStats.played < 3) missing.push('Away team has fewer than 3 usable recent results');
  const enough = homeStats?.played >= 3 && awayStats?.played >= 3;
  const leagueHomeAvg = 1.45, leagueAwayAvg = 1.15; // conservative fallback only; never represented as observed league data
  let homeXg, awayXg;
  if (enough) {
    const homeAttack = homeStats.goalsForPerMatch / leagueHomeAvg;
    const awayDefence = awayStats.goalsAgainstPerMatch / leagueHomeAvg;
    const awayAttack = awayStats.goalsForPerMatch / leagueAwayAvg;
    const homeDefence = homeStats.goalsAgainstPerMatch / leagueAwayAvg;
    homeXg = clamp(leagueHomeAvg * homeAttack * awayDefence, 0.2, 4.2);
    awayXg = clamp(leagueAwayAvg * awayAttack * homeDefence, 0.2, 4.2);
  } else {
    // Fixture can still be listed, but we explicitly do not present this fallback as a betting prediction.
    homeXg = leagueHomeAvg; awayXg = leagueAwayAvg;
  }
  const grid = [];
  let pHome = 0, pDraw = 0, pAway = 0, pOver15 = 0, pOver25 = 0, pUnder25 = 0, pBtts = 0;
  for (let h = 0; h <= 8; h++) for (let a = 0; a <= 8; a++) {
    const p = poisson(homeXg, h) * poisson(awayXg, a);
    grid.push({ score: `${h}-${a}`, home: h, away: a, p });
    if (h > a) pHome += p; else if (h === a) pDraw += p; else pAway += p;
    if (h + a >= 2) pOver15 += p;
    if (h + a >= 3) pOver25 += p; else pUnder25 += p;
    if (h > 0 && a > 0) pBtts += p;
  }
  const [homeProb, drawProb, awayProb] = normalize([pHome, pDraw, pAway]);
  const markets = [
    { market: 'Match Winner', selection: fixture.teams.home.name, probability: pct(homeProb) },
    { market: 'Match Winner', selection: 'Draw', probability: pct(drawProb) },
    { market: 'Match Winner', selection: fixture.teams.away.name, probability: pct(awayProb) },
    { market: 'Double Chance', selection: `${fixture.teams.home.name} or Draw`, probability: pct(homeProb + drawProb) },
    { market: 'Double Chance', selection: `${fixture.teams.away.name} or Draw`, probability: pct(awayProb + drawProb) },
    { market: 'Goals', selection: 'Over 1.5', probability: pct(pOver15) },
    { market: 'Goals', selection: 'Over 2.5', probability: pct(pOver25) },
    { market: 'Goals', selection: 'Under 2.5', probability: pct(pUnder25) },
    { market: 'Both Teams to Score', selection: 'Yes', probability: pct(pBtts) },
    { market: 'Both Teams to Score', selection: 'No', probability: pct(1 - pBtts) }
  ];
  // Compare market types separately; don't let Double Chance automatically win because it has a wider outcome.
  const winnerCandidates = markets.filter(m => m.market === 'Match Winner');
  const winnerBest = winnerCandidates.reduce((a, b) => a.probability >= b.probability ? a : b);
  const scoreBest = grid.slice().sort((a, b) => b.p - a.p).slice(0, 5);
  const dataQuality = !enough ? 'INSUFFICIENT' : (homeStats.played >= 5 && awayStats.played >= 5 ? 'MEDIUM' : 'LOW');
  const recommendation = !enough ? 'NO BET — insufficient recent data' : (winnerBest.probability >= 60 ? 'Consider only after checking lineups and odds; not a guarantee' : 'NO STRONG WINNER — high uncertainty');
  return {
    fixtureId: `football_${fixture.fixture.id}`, sport: 'football', league: fixture.league?.name || 'Unknown', leagueId: fixture.league?.id,
    season: fixture.league?.season, homeTeam: fixture.teams.home.name, awayTeam: fixture.teams.away.name,
    homeTeamId: fixture.teams.home.id, awayTeamId: fixture.teams.away.id, date: new Date(fixture.fixture.date), status: 'Scheduled',
    predictedWinner: enough ? (winnerBest.selection === 'Draw' ? 'Draw' : winnerBest.selection) : 'No reliable prediction',
    predictedScore: enough ? `${Math.round(homeXg)}-${Math.round(awayXg)}` : 'Not available',
    confidenceScore: enough ? winnerBest.probability : 0,
    winnerProbabilities: { home: pct(homeProb), draw: pct(drawProb), away: pct(awayProb) },
    allMarkets: markets, bestMarketString: enough ? `${winnerBest.selection} (match-winner estimate ${winnerBest.probability}%)` : 'No reliable market — insufficient data',
    topCorrectScores: enough ? scoreBest.map(s => ({ score: s.score, probability: pct(s.p) })) : [],
    dataQuality, recommendation, missingData: missing, modelVersion: MODEL_VERSION,
    aiExplanation: enough ? `Estimated from ${homeStats.played} recent completed home-team fixtures and ${awayStats.played} recent completed away-team fixtures. Probabilities are model estimates, not guarantees.` : 'Real fixture found, but insufficient recent completed-match data. No betting prediction is issued.'
  };
}

async function basketballRecent(teamId, season, beforeDate) {
  if (season === undefined || season === null || season === '') return [];
  return cached(`basketball:${teamId}:${season}:${dateString(new Date(beforeDate))}`, async () => {
    const games = await apiResponse(basketballApi, '/games', { team: teamId, season });
    return games.filter(g => new Date(g.date) < new Date(beforeDate) && isBasketballFinished(g.status?.short))
      .sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10);
  });
}
function basketballTeamStats(games, teamId) {
  let scored = 0, conceded = 0, wins = 0, count = 0;
  for (const g of games) {
    const homeId = Number(g.teams?.home?.id), awayId = Number(g.teams?.away?.id);
    const homeTotal = Number(g.scores?.home?.total), awayTotal = Number(g.scores?.away?.total);
    if (!Number.isFinite(homeTotal) || !Number.isFinite(awayTotal)) continue;
    const home = homeId === Number(teamId);
    if (!home && awayId !== Number(teamId)) continue;
    const own = home ? homeTotal : awayTotal, opp = home ? awayTotal : homeTotal;
    scored += own; conceded += opp; if (own > opp) wins++; count++;
  }
  return count ? { played: count, pointsFor: scored / count, pointsAgainst: conceded / count, winRate: wins / count } : null;
}
function basketballPrediction(game, homeStats, awayStats) {
  const enough = homeStats?.played >= 5 && awayStats?.played >= 5;
  const missing = [];
  if (!homeStats || homeStats.played < 5) missing.push('Insufficient recent completed games for home team');
  if (!awayStats || awayStats.played < 5) missing.push('Insufficient recent completed games for away team');
  const homePts = enough ? clamp((homeStats.pointsFor + awayStats.pointsAgainst) / 2, 60, 160) : null;
  const awayPts = enough ? clamp((awayStats.pointsFor + homeStats.pointsAgainst) / 2, 60, 160) : null;
  let homeProb = 0.5;
  if (enough) {
    const margin = homePts - awayPts;
    homeProb = 1 / (1 + Math.exp(-margin / 12));
    // Small form-strength adjustment based on actual win rates, capped to avoid overreacting.
    homeProb = clamp(homeProb + clamp((homeStats.winRate - awayStats.winRate) * 0.08, -0.04, 0.04), 0.05, 0.95);
  }
  const awayProb = 1 - homeProb;
  const winner = homeProb >= awayProb ? game.teams.home.name : game.teams.away.name;
  const winnerP = Math.max(homeProb, awayProb);
  return {
    fixtureId: `basketball_${game.id}`, sport: 'basketball', league: game.league?.name || 'Basketball', leagueId: game.league?.id,
    season: game.league?.season, homeTeam: game.teams.home.name, awayTeam: game.teams.away.name,
    homeTeamId: game.teams.home.id, awayTeamId: game.teams.away.id, date: new Date(game.date), status: 'Scheduled',
    predictedWinner: enough ? winner : 'No reliable prediction', predictedScore: enough ? `${Math.round(homePts)}-${Math.round(awayPts)}` : 'Not available',
    confidenceScore: enough ? pct(winnerP) : 0, winnerProbabilities: { home: pct(homeProb), away: pct(awayProb) },
    allMarkets: enough ? [
      { market: 'Match Winner', selection: game.teams.home.name, probability: pct(homeProb) },
      { market: 'Match Winner', selection: game.teams.away.name, probability: pct(awayProb) }
    ] : [], bestMarketString: enough ? `${winner} (match-winner estimate ${pct(winnerP)}%)` : 'No reliable market — insufficient data',
    topCorrectScores: [], dataQuality: enough ? 'MEDIUM' : 'INSUFFICIENT',
    recommendation: enough && winnerP >= 0.65 ? 'Model lean only; verify lineups and odds' : 'NO STRONG WINNER — high uncertainty',
    missingData: missing, modelVersion: MODEL_VERSION,
    aiExplanation: enough ? `Estimated from ${homeStats.played} recent completed games for each team. Probabilities are model estimates, not guarantees.` : 'Real fixture found, but insufficient recent completed-game data. No betting prediction is issued.'
  };
}

async function updateFinishedMatch(existing, sport, fixture) {
  const status = sport === 'football' ? fixture.fixture?.status?.short : fixture.status?.short;
  const finished = sport === 'football' ? isFootballFinished(status) : isBasketballFinished(status);
  if (!finished) return false;
  const homeScore = sport === 'football' ? fixture.goals?.home : fixture.scores?.home?.total;
  const awayScore = sport === 'football' ? fixture.goals?.away : fixture.scores?.away?.total;
  if (!Number.isFinite(Number(homeScore)) || !Number.isFinite(Number(awayScore))) return false;
  const actualWinner = Number(homeScore) > Number(awayScore) ? existing.homeTeam : Number(awayScore) > Number(homeScore) ? existing.awayTeam : 'Draw';
  existing.actualScore = `${homeScore}-${awayScore}`;
  existing.actualWinner = actualWinner;
  existing.isFinished = true;
  existing.isCorrect = existing.predictedWinner !== 'No reliable prediction' && actualWinner === existing.predictedWinner;
  existing.status = 'Finished';
  if (existing.predictedWinner === 'No reliable prediction') existing.errorDiagnosis = 'Prediction withheld due to insufficient data';
  else if (!existing.isCorrect) existing.errorDiagnosis = 'Model estimate did not match the final result';
  const obj = existing.toObject();
  delete obj._id;
  delete obj.__v;
  await History.updateOne({ fixtureId: existing.fixtureId }, { $set: obj }, { upsert: true });
  await Prediction.deleteOne({ _id: existing._id });
  return true;
}

async function runDailyCycle() {
  if (cycleRunning) return { skipped: true, reason: 'Cycle already running' };
  if (!API_SPORTS_KEY) throw new Error('API_SPORTS_KEY is missing from environment variables');
  cycleRunning = true;
  const counts = { football: 0, basketball: 0, errors: [] };
  try {
    const dates = [dateString(), dateString(new Date(Date.now() + 86400000))];
    const footballFixtures = [];
    for (const date of dates) {
      try { footballFixtures.push(...await apiResponse(footballApi, '/fixtures', { date })); }
      catch (e) { counts.errors.push(`Football fixtures ${date}: ${e.message}`); }
    }
    footballFixtures.sort((a, b) => new Date(a.fixture.date) - new Date(b.fixture.date));
    let acceptedFootball = 0;
    for (const fixture of footballFixtures) {
      const status = fixture.fixture?.status?.short;
      const id = `football_${fixture.fixture?.id}`;
      const existing = await Prediction.findOne({ fixtureId: id });
      if (existing && isLive(status, 'football')) {
        existing.status = 'LIVE'; existing.actualScore = `${fixture.goals?.home ?? 0}-${fixture.goals?.away ?? 0}`; await existing.save(); continue;
      }
      if (existing && isFootballFinished(status)) { await updateFinishedMatch(existing, 'football', fixture); continue; }
      if (status !== 'NS' && status !== 'TBD') continue;
      if (existing) continue;
      if (acceptedFootball >= FOOTBALL_DAILY_LIMIT) continue;
      acceptedFootball++;
      try {
        const beforeDate = fixture.fixture.date;
        const [hGames, aGames] = await Promise.all([
          footballRecent(fixture.teams.home.id, beforeDate), footballRecent(fixture.teams.away.id, beforeDate)
        ]);
        const prediction = footballPrediction(fixture, footballTeamStats(hGames, fixture.teams.home.id), footballTeamStats(aGames, fixture.teams.away.id));
        await Prediction.updateOne({ fixtureId: prediction.fixtureId }, { $setOnInsert: prediction }, { upsert: true });
        counts.football++;
      } catch (e) { counts.errors.push(`Football ${fixture.teams?.home?.name} vs ${fixture.teams?.away?.name}: ${e.message}`); }
    }

    const basketballFixtures = [];
    for (const date of dates) {
      try { basketballFixtures.push(...await apiResponse(basketballApi, '/games', { date })); }
      catch (e) { counts.errors.push(`Basketball fixtures ${date}: ${e.message}`); }
    }
    basketballFixtures.sort((a, b) => new Date(a.date) - new Date(b.date));
    let acceptedBasketball = 0;
    for (const game of basketballFixtures) {
      const status = game.status?.short;
      const id = `basketball_${game.id}`;
      const existing = await Prediction.findOne({ fixtureId: id });
      if (existing && isLive(status, 'basketball')) {
        existing.status = 'LIVE'; existing.actualScore = `${game.scores?.home?.total ?? 0}-${game.scores?.away?.total ?? 0}`; await existing.save(); continue;
      }
      if (existing && isBasketballFinished(status)) { await updateFinishedMatch(existing, 'basketball', game); continue; }
      if (status !== 'NS') continue;
      if (existing) continue;
      if (acceptedBasketball >= BASKETBALL_DAILY_LIMIT) continue;
      acceptedBasketball++;
      try {
        const season = game.league?.season;
        const [hGames, aGames] = await Promise.all([
          basketballRecent(game.teams.home.id, season, game.date), basketballRecent(game.teams.away.id, season, game.date)
        ]);
        const prediction = basketballPrediction(game, basketballTeamStats(hGames, game.teams.home.id), basketballTeamStats(aGames, game.teams.away.id));
        await Prediction.updateOne({ fixtureId: prediction.fixtureId }, { $setOnInsert: prediction }, { upsert: true });
        counts.basketball++;
      } catch (e) { counts.errors.push(`Basketball ${game.teams?.home?.name} vs ${game.teams?.away?.name}: ${e.message}`); }
    }
    console.log(`[cycle] Football added/checked: ${counts.football}; basketball added/checked: ${counts.basketball}; errors: ${counts.errors.length}`);
    if (counts.errors.length) console.error(counts.errors.slice(0, 10).join('\n'));
    return counts;
  } finally { cycleRunning = false; }
}

app.get('/health', (req, res) => res.json({ ok: true, modelVersion: MODEL_VERSION, database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' }));
app.get('/api/predictions', async (req, res) => {
  try {
    const filter = {};
    if (['football', 'basketball'].includes(req.query.sport)) filter.sport = req.query.sport;
    const predictions = await Prediction.find(filter).sort({ date: 1 }).limit(500).lean();
    res.json({ predictions, counts: { football: predictions.filter(p => p.sport === 'football').length, basketball: predictions.filter(p => p.sport === 'basketball').length } });
  } catch (e) { res.status(500).json({ error: 'Failed to fetch predictions' }); }
});
app.get('/api/history', async (req, res) => {
  try {
    const history = await History.find().sort({ date: -1 }).limit(200).lean();
    const evaluated = history.filter(p => p.predictedWinner && p.predictedWinner !== 'No reliable prediction' && typeof p.isCorrect === 'boolean');
    res.json({ history, sampleSize: evaluated.length, accuracy: evaluated.length ? Number((evaluated.filter(p => p.isCorrect).length / evaluated.length * 100).toFixed(1)) : null });
  } catch (e) { res.status(500).json({ error: 'Failed to fetch history' }); }
});
app.get('/api/analytics', async (req, res) => {
  try {
    const history = await History.find().lean();
    const evaluated = history.filter(p => p.predictedWinner && p.predictedWinner !== 'No reliable prediction' && typeof p.isCorrect === 'boolean');
    const bySport = sport => { const list = evaluated.filter(p => p.sport === sport); return { sampleSize: list.length, accuracy: list.length ? Number((list.filter(p => p.isCorrect).length / list.length * 100).toFixed(1)) : null }; };
    res.json({ sampleSize: evaluated.length, accuracy: evaluated.length ? Number((evaluated.filter(p => p.isCorrect).length / evaluated.length * 100).toFixed(1)) : null, football: bySport('football'), basketball: bySport('basketball'), note: 'Historical accuracy is not a promise of future performance. Only evaluated predictions are counted.' });
  } catch (e) { res.status(500).json({ error: 'Failed to calculate analytics' }); }
});
app.post('/api/admin/run-cycle', async (req, res) => {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected || req.get('x-admin-key') !== expected) return res.status(401).json({ error: 'Unauthorized' });
  try { res.json({ ok: true, result: await runDailyCycle() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

async function sendTelegramPredictions() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be configured');
  const picks = await Prediction.find({ status: 'Scheduled', recommendation: { $not: /NO BET|NO STRONG/i }, predictedWinner: { $ne: 'No reliable prediction' } })
    .sort({ confidenceScore: -1 }).limit(3).lean();
  if (!picks.length) return { sent: false, reason: 'No eligible predictions to send' };
  const lines = ['⚽🏀 *MATCH INTELLIGENCE AI — MODEL PICKS*', ''];
  picks.forEach((p, i) => {
    lines.push(`*${i + 1}. ${p.homeTeam} vs ${p.awayTeam}*`);
    lines.push(`Sport: ${p.sport} | League: ${p.league || 'Unknown'}`);
    lines.push(`Model lean: ${p.predictedWinner}`);
    lines.push(`Estimated score: ${p.predictedScore || 'Unavailable'}`);
    lines.push(`Model estimate: ${p.confidenceScore ?? 0}%`);
    lines.push('');
  });
  lines.push('⚠️ Estimates are not guarantees. Check confirmed lineups and odds; never stake money you cannot afford to lose.');
  await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, { chat_id: chatId, text: lines.join('\n'), parse_mode: 'Markdown' }, { timeout: 15000 });
  return { sent: true, count: picks.length };
}
app.post('/api/admin/trigger-telegram', async (req, res) => {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected || req.get('x-admin-key') !== expected) return res.status(401).json({ error: 'Unauthorized' });
  try { res.json({ ok: true, result: await sendTelegramPredictions() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

async function start() {
  if (!MONGO_URI) throw new Error('MONGO_URI is missing. Configure MongoDB in Render environment variables.');
  if (!API_SPORTS_KEY) throw new Error('API_SPORTS_KEY is missing. Configure your API-Sports key in Render environment variables.');
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  console.log('[startup] MongoDB connected');
  app.listen(PORT, () => console.log(`[startup] Match AI API listening on ${PORT}`));
  runDailyCycle().catch(e => console.error('[startup] Initial prediction cycle failed:', e.message));
  // Refresh every 30 minutes; cached team form limits repeated statistics requests.
  cron.schedule('*/30 * * * *', () => runDailyCycle().catch(e => console.error('[cron] cycle failed:', e.message)));
}
start().catch(e => { console.error('[startup] Fatal configuration/database error:', e.message); process.exit(1); });
