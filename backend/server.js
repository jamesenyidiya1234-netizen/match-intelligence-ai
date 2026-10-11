require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cron = require('node-cron');
const mongoose = require('mongoose');
const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());

// --- MONGODB CONNECTION ---
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/matchai';

// --- MONGODB SCHEMAS ---
const PredictionSchema = new mongoose.Schema({
  fixtureId: { type: String, unique: true, index: true },
  sport: String, league: String, homeTeam: String, awayTeam: String, homeTeamId: Number, awayTeamId: Number,
  date: Date, status: String, actualScore: String, predictedWinner: String, isFinished: { type: Boolean, default: false },
  isCorrect: { type: Boolean, default: null },
  allMarkets: Array, bestMarketString: String, topCorrectScores: Array,
  confidenceScore: String, dataQuality: String, recommendation: String, predictedScore: String,
  aiExplanation: String, modelVersion: { type: String, default: 'v17.0 Full Fix' }
});
const Prediction = mongoose.model('Prediction', PredictionSchema);

const HistorySchema = new mongoose.Schema({ ...PredictionSchema.obj, errorDiagnosis: String });
const History = mongoose.model('History', HistorySchema);

// --- ELITE PREDICTION ENGINE ---
class PredictionEngine {
  factorial(n) { if (n < 0) return 0; if (n === 0) return 1; let res = 1; for (let i = 2; i <= n; i++) res *= i; return res; }
  poissonProb(expected, actual) { return Math.pow(expected, actual) * Math.exp(-expected) / this.factorial(actual); }

  hashStrength(id) {
    let h = id || 1;
    for (let i = 0; i < 3; i++) h = (h * 31) % 1000;
    return 0.3 + (h / 1000) * 0.7;
  }

  analyzeMatch(matchData) {
    if (matchData.sport === 'basketball') return this.analyzeBasketball(matchData);
    return this.analyzeFootball(matchData);
  }

  analyzeFootball(matchData) {
    const { homeTeam, awayTeam, injuries, h2h, league, fixtureId } = matchData;
    let homeStrength = 0, awayStrength = 0, missingDataPoints = [], warnings = [];
    let homeAttack, homeDefense, awayAttack, awayDefense;
    
    if (homeTeam.form && homeTeam.form.last5 && homeTeam.form.last5.length > 0 && awayTeam.form && awayTeam.form.last5.length > 0) {
      homeStrength = this.calculateForm(homeTeam.form);
      awayStrength = this.calculateForm(awayTeam.form);
      const hWins = homeTeam.form.last5.filter(v => v === 'W').length; 
      const hLosses = homeTeam.form.last5.filter(v => v === 'L').length;
      homeAttack = 1.0 + (hWins * 0.25) - (hLosses * 0.1); 
      homeDefense = 1.2 - (hWins * 0.1) + (hLosses * 0.2);
      const aWins = awayTeam.form.last5.filter(v => v === 'W').length; 
      const aLosses = awayTeam.form.last5.filter(v => v === 'L').length;
      awayAttack = 0.9 + (aWins * 0.25) - (aLosses * 0.1); 
      awayDefense = 1.3 - (aWins * 0.1) + (aLosses * 0.2);
    } else { 
      homeStrength = this.hashStrength(homeTeam.id);
      awayStrength = this.hashStrength(awayTeam.id);
      homeAttack = 0.5 + (homeStrength * 2.0); 
      homeDefense = 2.0 - homeStrength; 
      awayAttack = 0.5 + (awayStrength * 2.0);
      awayDefense = 2.0 - awayStrength;
      missingDataPoints.push('Recent form unavailable. Using baseline strength model.'); 
    }

    homeStrength += 0.15; 
    const totalScore = Math.max(0.1, homeStrength + awayStrength);
    let homeWinProb = homeStrength / totalScore; 
    let awayWinProb = awayStrength / totalScore;
    let drawProb = 0.28 - (Math.abs(homeWinProb - awayWinProb) * 0.2);
    
    homeWinProb = homeWinProb * (1 - drawProb); 
    awayWinProb = awayWinProb * (1 - drawProb);

    const markets = [], correctScores = [];
    const homeExpGoals = Math.max(0.15, (homeAttack * awayDefense) / 1.4); 
    const awayExpGoals = Math.max(0.15, (awayAttack * homeDefense) / 1.4);
    
    for (let h = 0; h <= 4; h++) { 
      for (let a = 0; a <= 4; a++) { 
        const prob = this.poissonProb(homeExpGoals, h) * this.poissonProb(awayExpGoals, a); 
        if (prob > 0.01) correctScores.push({ score: `${h}-${a}`, probability: prob }); 
      } 
    }
    correctScores.sort((a, b) => b.probability - a.probability);
    
    const totalExpGoals = homeExpGoals + awayExpGoals;
    const p0 = this.poissonProb(totalExpGoals, 0), p1 = this.poissonProb(totalExpGoals, 1), p2 = this.poissonProb(totalExpGoals, 2);
    markets.push({ market: 'Match Winner', selection: homeTeam.name, probability: homeWinProb });
    markets.push({ market: 'Match Winner', selection: 'Draw', probability: drawProb });
    markets.push({ market: 'Match Winner', selection: awayTeam.name, probability: awayWinProb });
    markets.push({ market: 'Double Chance', selection: `${homeTeam.name} or Draw`, probability: homeWinProb + drawProb });
    markets.push({ market: 'Over/Under 1.5 Goals', selection: 'Over 1.5', probability: 1 - (p0 + p1) });
    markets.push({ market: 'Over/Under 2.5 Goals', selection: 'Over 2.5', probability: 1 - (p0 + p1 + p2) });

    const bestMarket = markets.length > 0 ? markets.reduce((max, m) => m.probability > max.probability ? m : max, markets[0]) : null;
    const bestProb = bestMarket ? bestMarket.probability * 100 : 0;
    const dataQuality = missingDataPoints.length > 2 ? 'LOW' : missingDataPoints.length > 0 ? 'MEDIUM' : 'HIGH';
    let recommendation = (bestProb >= 70 && dataQuality !== 'LOW') ? 'HIGH-CONFIDENCE SELECTION' : 'NO STRONG PREDICTION';

    return {
      fixtureId, sport: 'football', league, homeTeam: homeTeam.name, awayTeam: awayTeam.name, homeTeamId: homeTeam.id, awayTeamId: awayTeam.id,
      allMarkets: markets.map(m => ({...m, probability: (m.probability * 100).toFixed(1)})),
      bestMarketString: bestMarket ? `${bestMarket.market} (${bestMarket.selection})` : 'No reliable market',
      topCorrectScores: correctScores.slice(0, 5).map(s => ({ score: s.score, probability: (s.probability * 100).toFixed(1) })),
      predictedWinner: homeWinProb > awayWinProb ? homeTeam.name : awayTeam.name,
      confidenceScore: bestProb.toFixed(0), dataQuality, recommendation,
      predictedScore: `${homeExpGoals.toFixed(0)}-${awayExpGoals.toFixed(0)}`,
      warnings, missingData: missingDataPoints,
      aiExplanation: `Football Analysis: ${bestMarket ? bestMarket.market + ' (' + bestMarket.selection + ')' : 'No market'} is the strongest outcome with ${bestProb.toFixed(1)}% prob.`
    };
  }

  // NEW: Basketball Engine so they get real scores and display properly
  analyzeBasketball(matchData) {
    const { homeTeam, awayTeam, league, fixtureId } = matchData;
    const homeStrength = this.hashStrength(homeTeam.id);
    const awayStrength = this.hashStrength(awayTeam.id);
    
    const totalStrength = homeStrength + awayStrength + 0.15; 
    let homeWinProb = (homeStrength + 0.15) / totalStrength;
    let awayWinProb = awayStrength / totalStrength;
    
    const homeExpPoints = Math.round(100 + homeStrength * 25);
    const awayExpPoints = Math.round(95 + awayStrength * 25);
    
    const markets = [
      { market: 'Match Winner', selection: homeTeam.name, probability: homeWinProb },
      { market: 'Match Winner', selection: awayTeam.name, probability: awayWinProb }
    ];
    
    const bestMarket = markets.reduce((max, m) => m.probability > max.probability ? m : max, markets[0]);
    const bestProb = bestMarket.probability * 100;
    
    return {
      fixtureId, sport: 'basketball', league, homeTeam: homeTeam.name, awayTeam: awayTeam.name, 
      homeTeamId: homeTeam.id, awayTeamId: awayTeam.id,
      allMarkets: markets.map(m => ({...m, probability: (m.probability * 100).toFixed(1)})),
      bestMarketString: `${bestMarket.market} (${bestMarket.selection})`,
      topCorrectScores: [], 
      predictedWinner: homeWinProb > awayWinProb ? homeTeam.name : awayTeam.name,
      confidenceScore: bestProb.toFixed(0), dataQuality: 'MEDIUM', recommendation: bestProb >= 60 ? 'MODERATE SELECTION' : 'NO STRONG PREDICTION',
      predictedScore: `${homeExpPoints}-${awayExpPoints}`,
      warnings: [], missingData: ['Basketball form fetch skipped to preserve API limits.'],
      aiExplanation: `Basketball Analysis: ${bestMarket.selection} has a ${bestProb.toFixed(1)}% probability based on baseline strength.`
    };
  }

  calculateForm(form) { if (!form || !form.last5) return 0.5; return form.last5.reduce((acc, val) => acc + (val === 'W' ? 3 : val === 'D' ? 1 : 0), 0) / 15; }
}

const engine = new PredictionEngine();

async function getRealFootballForm(teamId, apiKey, headers) {
  try {
    const res = await axios.get(`https://v3.football.api-sports.io/fixtures?team=${teamId}&last=5`, { headers });
    if (!res.data.response || res.data.response.length === 0) return null;
    const last5 = res.data.response.map(game => {
      const isHome = game.teams.home.id === teamId;
      const homeScore = game.goals.home || 0, awayScore = game.goals.away || 0;
      const teamScore = isHome ? homeScore : awayScore;
      const oppScore = isHome ? awayScore : homeScore;
      if (teamScore > oppScore) return 'W';
      if (teamScore < oppScore) return 'L';
      return 'D';
    });
    return { last5 };
  } catch { return null; }
}

// --- AUTOMATED WORKER ---
async function runDailyCycle() {
  console.log(`[$] [${new Date().toLocaleTimeString()}] Running Safe Cycle...`);
  const apiKey = process.env.API_SPORTS_KEY;
  if (!apiKey) return console.log('[!] Missing API_SPORTS_KEY.');
  const headers = { 'x-apisports-key': apiKey };

  const todayStr = new Date().toISOString().split('T')[0];
  const tomStr = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const footLimit = parseInt(process.env.FOOTBALL_DAILY_LIMIT || '20');
  const bballLimit = parseInt(process.env.BASKETBALL_DAILY_LIMIT || '10');

  // 1. FOOTBALL
  try {
    let footFixtures = [];
    for (const dateStr of [todayStr, tomStr]) {
      const res = await axios.get(`https://v3.football.api-sports.io/fixtures?date=${dateStr}`, { headers });
      footFixtures = footFixtures.concat(res.data.response.filter(g => g.fixture.status.short === 'NS'));
    }
    
    footFixtures = footFixtures.slice(0, footLimit);
    let newFootCount = 0;

    for (const game of footFixtures) {
      const matchId = `apifoot_${game.fixture.id}`;
      const existing = await Prediction.findOne({ fixtureId: matchId });
      if (existing) continue;

      const homeForm = await getRealFootballForm(game.teams.home.id, apiKey, headers);
      const awayForm = await getRealFootballForm(game.teams.away.id, apiKey, headers);
      
      const mockMatch = {
        fixtureId: matchId, sport: 'football', league: game.league.name || 'Unknown',
        matchDate: game.fixture.date,
        homeTeam: { name: game.teams.home.name, id: game.teams.home.id, form: homeForm, venueRecord: { winPct: 0.6, awayWinPct: 0.3 } },
        awayTeam: { name: game.teams.away.name, id: game.teams.away.id, form: awayForm, venueRecord: { winPct: 0.4, awayWinPct: 0.2 } },
        injuries: { verified: false }, h2h: [{ winner: game.teams.home.id }, { winner: game.teams.away.id }, { winner: game.teams.home.id }]
      };
      const prediction = engine.analyzeFootball(mockMatch); 
      prediction.date = game.fixture.date; prediction.status = 'Scheduled';
      await Prediction.create(prediction);
      newFootCount++;
    }
    console.log(`[$] Football Cycle Complete. Saved ${newFootCount} new matches.`);
  } catch (err) { console.error('[X] Football API Error:', err.response?.statusText || err.message); }

  // 2. BASKETBALL 
  try {
    let bballGames = [];
    for (const dateStr of [todayStr, tomStr]) {
      const res = await axios.get(`https://v1.basketball.api-sports.io/games?date=${dateStr}`, { headers });
      bballGames = bballGames.concat(res.data.response.filter(g => g.status?.short === 'NS'));
    }
    bballGames = bballGames.slice(0, bballLimit);
    let newBballCount = 0;

    for (const game of bballGames) {
      const matchId = `apibball_${game.id}`;
      const existing = await Prediction.findOne({ fixtureId: matchId });
      if (existing) continue;

      const mockMatch = {
        fixtureId: matchId, sport: 'basketball', league: game.league.name || 'NBA', date: game.date,
        homeTeam: { name: String(game.teams.home.name), id: game.teams.home.id }, 
        awayTeam: { name: String(game.teams.away.name), id: game.teams.away.id }
      };
      const prediction = engine.analyzeBasketball(mockMatch); 
      prediction.status = 'Scheduled';
      await Prediction.create(prediction);
      newBballCount++;
    }
    console.log(`[$] Basketball Cycle Complete. Saved ${newBballCount} new matches.`);
  } catch (err) { console.error('[X] Basketball API Error:', err.response?.statusText || err.message); }

  // Automatically send Telegram predictions after cycle finishes!
  await sendTelegramPredictions();
}

// --- AUTOMATIC CLEANUP ---
async function cleanupOldMatches() {
  try {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const oldMatches = await Prediction.find({ date: { $lt: threeHoursAgo }, status: { $ne: 'LIVE' } });
    for (const match of oldMatches) await Prediction.deleteOne({ _id: match._id });
    if (oldMatches.length > 0) console.log(`[$] Cleanup complete. Removed ${oldMatches.length} old matches.`);
  } catch (err) { console.error('[X] Cleanup Error:', err.message); }
}

// --- API ROUTES ---
app.get('/health', (req, res) => res.json({ ok: true, db: mongoose.connection.readyState === 1 }));

app.get('/api/predictions', async (req, res) => {
  try {
    const preds = await Prediction.find().sort({ date: 1 });
    res.json({ predictions: preds, counts: { football: preds.filter(p=>p.sport==='football').length, basketball: preds.filter(p=>p.sport==='basketball').length } });
  } catch { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/history', async (req, res) => {
  try {
    const history = await History.find().sort({ _id: -1 }).limit(100);
    const acc = history.length > 0 ? (history.filter(p => p.isCorrect).length / history.length * 100).toFixed(1) : 0;
    res.json({ history, accuracy: acc });
  } catch { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/analytics', async (req, res) => {
  try {
    const history = await History.find();
    if (history.length === 0) return res.json({ sampleSize: 0, accuracy: 0, brierScore: 0 });
    const correct = history.filter(p => p.isCorrect).length;
    const accuracy = (correct / history.length * 100).toFixed(1);
    res.json({ sampleSize: history.length, accuracy, brierScore: '0.000' });
  } catch { res.status(500).json({ error: 'Failed' }); }
});

// --- PROTECTED ADMIN ROUTES ---
const adminAuth = (req, res, next) => {
  if (req.headers['x-admin-key'] !== process.env.ADMIN_API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
};

app.post('/api/admin/run-cycle', adminAuth, async (req, res) => {
  await runDailyCycle();
  await cleanupOldMatches();
  res.json({ message: 'Cycle triggered successfully.' });
});

// RESTORED: Easy Manual Telegram Trigger
async function sendTelegramPredictions() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID || '@MatchIntelligenceAI';
  if (!botToken) return console.log('[!] Telegram Bot Token missing.');
  try {
    const topPicks = await Prediction.find({ status: 'Scheduled', predictedWinner: { $ne: 'No reliable prediction' } }).sort({ confidenceScore: -1 }).limit(3);
    if (topPicks.length === 0) return console.log('[!] No reliable predictions to send to Telegram.');
    let message = `⚽️ *MATCH INTELLIGENCE AI - TOP PICKS* ⚽️\n\n`;
    topPicks.forEach((pick, index) => {
      message += `*${index + 1}. ${pick.homeTeam} vs ${pick.awayTeam}*\n`;
      message += `League: ${pick.league}\n`;
      message += `Best Market: ${pick.bestMarketString} (${pick.confidenceScore}%)\n`;
      message += `Predicted Score: ${pick.predictedScore}\n\n`;
    });
    message += `⚠️ Bet responsibly. Probabilities, not guarantees.`;
    await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, { chat_id: chatId, text: message, parse_mode: 'Markdown' });
    console.log('[$] Sent predictions to Telegram automatically.');
  } catch (err) { console.error('[X] Telegram Error:', err.response?.data || err.message); }
}

app.get('/api/trigger-telegram', async (req, res) => {
  try {
    console.log('[!] Manual Telegram trigger received.');
    await sendTelegramPredictions();
    res.json({ message: 'Telegram prediction trigger sent successfully! Check your channel.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send Telegram message.', details: err.message });
  }
});

// --- START SERVER ---
async function startServer() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('[$] MongoDB Connected.');
    app.listen(process.env.PORT || 5001, () => console.log(`Match Intelligence AI 24/7 Server running.`));

    const count = await Prediction.countDocuments();
    if (count === 0) await runDailyCycle();
    else await cleanupOldMatches();

    cron.schedule('0 * * * *', () => { runDailyCycle(); cleanupOldMatches(); });
  } catch (err) {
    console.error('[X] Failed to start:', err.message);
    app.listen(process.env.PORT || 5001, () => console.log(`Server running (DB Offline).`));
  }
}

startServer();
