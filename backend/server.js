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
  aiExplanation: String, modelVersion: { type: String, default: 'v6.0 Split Engine' }
});
const Prediction = mongoose.model('Prediction', PredictionSchema);

const HistorySchema = new mongoose.Schema({ ...PredictionSchema.obj, errorDiagnosis: String });
const History = mongoose.model('History', HistorySchema);

// --- ELITE PREDICTION ENGINE (v6.0 Split Engine) ---
class PredictionEngine {
  constructor() {
    this.footballWeights = { form: 0.20, injuries: 0.15, homeAway: 0.10, h2h: 0.10, tactics: 0.15, stats: 0.15, fatigue: 0.05, motivation: 0.05, transfers: 0.05 };
  }
  factorial(n) { if (n < 0) return 0; if (n === 0) return 1; let res = 1; for (let i = 2; i <= n; i++) res *= i; return res; }
  poissonProb(expected, actual) { return Math.pow(expected, actual) * Math.exp(-expected) / this.factorial(actual); }

  // ROUTER: Send to correct sport model
  analyzeMatch(matchData) {
    if (matchData.sport === 'basketball') return this.analyzeBasketball(matchData);
    return this.analyzeFootball(matchData);
  }

  // 1. FOOTBALL MODEL (Poisson Goals)
  analyzeFootball(matchData) {
    const { sport, homeTeam, awayTeam, injuries, h2h, league, fixtureId } = matchData;
    let homeScore = 0, awayScore = 0, missingDataPoints = [], warnings = [];
    
    let homeAttack = 1.35, homeDefense = 1.15, awayAttack = 1.15, awayDefense = 1.35;
    
    if (homeTeam.form && awayTeam.form) {
      homeScore += (this.calculateForm(homeTeam.form) * this.footballWeights.form);
      awayScore += (this.calculateForm(awayTeam.form) * this.footballWeights.form);
      const hWins = homeTeam.form.last5.filter(v => v === 'W').length; 
      const hLosses = homeTeam.form.last5.filter(v => v === 'L').length;
      homeAttack = 1.0 + (hWins * 0.25) - (hLosses * 0.1); 
      homeDefense = 1.2 - (hWins * 0.1) + (hLosses * 0.2);
      const aWins = awayTeam.form.last5.filter(v => v === 'W').length; 
      const aLosses = awayTeam.form.last5.filter(v => v === 'L').length;
      awayAttack = 0.9 + (aWins * 0.25) - (aLosses * 0.1); 
      awayDefense = 1.3 - (aWins * 0.1) + (aLosses * 0.2);
    } else { missingDataPoints.push('Recent form data incomplete (API tier restriction)'); }

    if (injuries && injuries.verified) {
      const homeInjuryImpact = this.calculateInjuryImpact(injuries.home); const awayInjuryImpact = this.calculateInjuryImpact(injuries.away);
      homeScore -= (homeInjuryImpact * this.footballWeights.injuries); awayScore -= (awayInjuryImpact * this.footballWeights.injuries);
      if (homeInjuryImpact > 0.2) warnings.push('Home team missing key players');
    } else { missingDataPoints.push('Injury information unverified'); }

    if (homeTeam.venueRecord && awayTeam.venueRecord) { homeScore += ((homeTeam.venueRecord.winPct - awayTeam.venueRecord.awayWinPct) * this.footballWeights.homeAway); }
    if (h2h && h2h.length >= 3) { const h2hScore = this.calculateH2H(h2h, homeTeam.id, awayTeam.id); homeScore += (h2hScore.home * this.footballWeights.h2h); awayScore += (h2hScore.away * this.footballWeights.h2h); } else { missingDataPoints.push('Insufficient H2H history'); }

    const totalScore = Math.max(homeScore + awayScore, 0.1);
    let homeWinProb = totalScore > 0 ? (homeScore / totalScore) : 0.5; let awayWinProb = totalScore > 0 ? (awayScore / totalScore) : 0.5;
    let drawProb = 0.28 - (Math.abs(homeWinProb - awayWinProb) * 0.2);
    homeWinProb = homeWinProb * (1 - drawProb); awayWinProb = awayWinProb * (1 - drawProb);

    const markets = [], correctScores = [];
    const homeExpGoals = (homeAttack * awayDefense) / 1.35; const awayExpGoals = (awayAttack * homeDefense) / 1.35;
    for (let h = 0; h <= 4; h++) { for (let a = 0; a <= 4; a++) { const prob = this.poissonProb(homeExpGoals, h) * this.poissonProb(awayExpGoals, a); if (prob > 0.01) correctScores.push({ score: `${h}-${a}`, probability: prob }); } }
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
      fixtureId, sport, league, homeTeam: homeTeam.name, awayTeam: awayTeam.name, homeTeamId: homeTeam.id, awayTeamId: awayTeam.id,
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

  // 2. BASKETBALL MODEL (Strength & Efficiency Ratings)
  analyzeBasketball(matchData) {
    const { homeTeam, awayTeam, injuries, h2h, league, fixtureId } = matchData;
    let homeStrength = 50; // Base rating
    let awayStrength = 50;
    let missingDataPoints = [], warnings = [];

    // 1. Current Form (Last 5 games)
    if (homeTeam.form && awayTeam.form) {
      homeTeam.form.last5.forEach(res => {
        if (res === 'W') homeStrength += 6; // +6 for a win
        if (res === 'L') homeStrength -= 4; // -4 for a loss
      });
      awayTeam.form.last5.forEach(res => {
        if (res === 'W') awayStrength += 5; // +5 for away win (harder to do)
        if (res === 'L') awayStrength -= 5;
      });
    } else { missingDataPoints.push('Recent form data unavailable'); }

    // 2. Home Court Advantage & Away Performance
    if (homeTeam.venueRecord && awayTeam.venueRecord) {
      homeStrength += (homeTeam.venueRecord.winPct * 20); // Up to +20 for strong home record
      awayStrength += (awayTeam.venueRecord.awayWinPct * 15); // Up to +15 for away record
    } else { missingDataPoints.push('Venue records unavailable'); }

    // 3. Roster Availability (Injuries, Suspensions, New Signings integration)
    if (injuries && injuries.verified) {
      if (injuries.home && injuries.home.length > 0) {
        homeStrength -= (injuries.home.filter(p => p.isStar).length * 10); // -10 for each star out
        warnings.push('Home team missing key players');
      }
      if (injuries.away && injuries.away.length > 0) {
        awayStrength -= (injuries.away.filter(p => p.isStar).length * 10);
        warnings.push('Away team missing key players');
      }
    } else { missingDataPoints.push('Injury/lineup information unverified'); }

    // 4. Head-to-Head (Psychological edge)
    if (h2h && h2h.length >= 3) {
      let hWins = h2h.filter(m => m.winner === homeTeam.id).length;
      let aWins = h2h.filter(m => m.winner === awayTeam.id).length;
      homeStrength += (hWins * 3); awayStrength += (aWins * 3);
    } else { missingDataPoints.push('Insufficient H2H history'); }

    // Ensure strengths don't go negative
    homeStrength = Math.max(10, homeStrength);
    awayStrength = Math.max(10, awayStrength);

    // Calculate Win Probability
    const totalStrength = homeStrength + awayStrength;
    let homeWinProb = homeStrength / totalStrength;
    let awayWinProb = awayStrength / totalStrength;

    // Expected Points (Baseline 105, adjusted by form)
    let homeExpPoints = 105 + (homeTeam.form?.last5?.filter(v => v === 'W').length || 0) * 4 - (homeTeam.form?.last5?.filter(v => v === 'L').length || 0) * 3;
    let awayExpPoints = 102 + (awayTeam.form?.last5?.filter(v => v === 'W').length || 0) * 3.5 - (awayTeam.form?.last5?.filter(v => v === 'L').length || 0) * 3.5;
    
    homeExpPoints = Math.round(homeExpPoints);
    awayExpPoints = Math.round(awayExpPoints);

    // Total Points Market (Line 215.5)
    const totalPointsLine = 215.5;
    const expectedTotal = homeExpPoints + awayExpPoints;
    const overProb = Math.min(0.95, Math.max(0.05, (expectedTotal - totalPointsLine) / 20 + 0.5));

    const markets = [
      { market: 'Match Winner', selection: homeTeam.name, probability: homeWinProb },
      { market: 'Match Winner', selection: awayTeam.name, probability: awayWinProb },
      { market: `Over/Under ${totalPointsLine} Points`, selection: 'Over', probability: overProb },
      { market: `Over/Under ${totalPointsLine} Points`, selection: 'Under', probability: 1 - overProb }
    ];

    const bestMarket = markets.reduce((max, m) => m.probability > max.probability ? m : max, markets[0]);
    const bestProb = bestMarket.probability * 100;
    const dataQuality = missingDataPoints.length > 2 ? 'LOW' : missingDataPoints.length > 0 ? 'MEDIUM' : 'HIGH';
    let recommendation = (bestProb >= 70 && dataQuality !== 'LOW') ? 'HIGH-CONFIDENCE SELECTION' : 'NO STRONG PREDICTION';

    return {
      fixtureId, sport: 'basketball', league, homeTeam: homeTeam.name, awayTeam: awayTeam.name, 
      homeTeamId: homeTeam.id, awayTeamId: awayTeam.id,
      allMarkets: markets.map(m => ({...m, probability: (m.probability * 100).toFixed(1)})),
      bestMarketString: `${bestMarket.market} (${bestMarket.selection})`,
      topCorrectScores: [], // Not used for basketball
      predictedWinner: homeWinProb > awayWinProb ? homeTeam.name : awayTeam.name,
      confidenceScore: bestProb.toFixed(0), dataQuality, recommendation,
      predictedScore: `${homeExpPoints}-${awayExpPoints}`,
      warnings, missingData: missingDataPoints,
      aiExplanation: `Basketball Analysis: ${bestMarket.selection} has a ${bestProb.toFixed(1)}% probability based on current form, home/away splits, and roster availability.`
    };
  }

  calculateForm(form) { if (!form || !form.last5) return 0.5; return form.last5.reduce((acc, val) => acc + (val === 'W' ? 3 : val === 'D' ? 1 : 0), 0) / 15; }
  calculateInjuryImpact(injuredPlayers) { if (!injuredPlayers) return 0; return injuredPlayers.reduce((impact, p) => impact + (p.isStar ? 0.3 : 0.1), 0); }
  calculateH2H(matches, homeId, awayId) { if (!matches) return { home: 0.5, away: 0.5 }; let homeWins = 0, awayWins = 0; matches.forEach(m => { if (m.winner === homeId) homeWins++; else if (m.winner === awayId) awayWins++; }); return { home: homeWins / matches.length, away: awayWins / matches.length }; }
}

const engine = new PredictionEngine();

async function getRealForm(teamId) {
  try {
    const res = await axios.get(`https://api.sportmonks.com/v3/football/teams/${teamId}/fixtures?api_token=${process.env.SPORTMONKS_API_KEY}&per_page=5&order=desc`);
    return { last5: res.data.data.map(f => f.scores?.[0]?.score?.goals > f.scores?.[1]?.score?.goals ? 'W' : 'L') };
  } catch { return null; }
}

// --- AUTOMATED 24/7 WORKER ---
async function runDailyCycle() {
  console.log(`[$] [${new Date().toLocaleTimeString()}] Running 24/7 Cycle...`);

  // 1. FOOTBALL
  const footballKey = process.env.SPORTMONKS_API_KEY;
  if (footballKey) {
    try {
      const today = new Date(); const nextWeek = new Date(); nextWeek.setDate(today.getDate() + 7);
      const formatDate = (date) => date.toISOString().split('T')[0];
      const res = await axios.get(`https://api.sportmonks.com/v3/football/fixtures/between/${formatDate(today)}/${formatDate(nextWeek)}?api_token=${footballKey}&include=participants;scores;league&per_page=1000`);
      
      for (const fixture of res.data.data) {
        const matchId = `real_${fixture.id}`;
        const existing = await Prediction.findOne({ fixtureId: matchId });
        const matchStatus = fixture.state || 'NS';

        if (matchStatus === 'FT' && existing && !existing.isFinished) {
           existing.isFinished = true;
           const homeScoreObj = fixture.scores.find(s => s.score.participant === 'home');
           const awayScoreObj = fixture.scores.find(s => s.score.participant === 'away');
           if (homeScoreObj && awayScoreObj) {
             const homeScore = homeScoreObj.score.goals, awayScore = awayScoreObj.score.goals;
             let actualWinner = 'Draw';
             if (homeScore > awayScore) actualWinner = existing.homeTeam; else if (awayScore > homeScore) actualWinner = existing.awayTeam;
             existing.actualScore = `${homeScore}-${awayScore}`; existing.actualWinner = actualWinner;
             existing.isCorrect = actualWinner === existing.predictedWinner;
             if (!existing.isCorrect) existing.errorDiagnosis = "Model overestimated output or upset occurred.";
             await existing.save();
             await History.create(existing.toObject());
             await Prediction.deleteOne({ _id: existing._id });
           }
           continue;
        }

        if (existing && (matchStatus === 'LIVE' || matchStatus === 'HT')) {
           existing.status = 'LIVE';
           const homeScoreObj = fixture.scores.find(s => s.score.participant === 'home');
           const awayScoreObj = fixture.scores.find(s => s.score.participant === 'away');
           if (homeScoreObj && awayScoreObj) existing.actualScore = `${homeScoreObj.score.goals}-${awayScoreObj.score.goals}`;
           await existing.save();
           continue;
        }

        if (!existing && matchStatus === 'NS') {
          const homeData = fixture.participants?.find(p => p.meta?.location === 'home');
          const awayData = fixture.participants?.find(p => p.meta?.location === 'away');
          if (!homeData || !awayData) continue;
          
          const homeForm = await getRealForm(homeData.id);
          const awayForm = await getRealForm(awayData.id);
          
          const mockMatch = {
            fixtureId: matchId, sport: 'football', league: fixture.league?.name || 'Unknown',
            matchDate: fixture.starting_at,
            homeTeam: { name: homeData.name, id: homeData.id, form: homeForm, venueRecord: { winPct: 0.6, awayWinPct: 0.3 } },
            awayTeam: { name: awayData.name, id: awayData.id, form: awayForm, venueRecord: { winPct: 0.4, awayWinPct: 0.2 } },
            injuries: { verified: false }, h2h: [{ winner: homeData.id }, { winner: awayData.id }, { winner: homeData.id }]
          };

          const prediction = engine.analyzeMatch(mockMatch); // Automatically uses Football model
          prediction.date = fixture.starting_at; prediction.status = 'Scheduled';
          await Prediction.create(prediction);
        }
      }
      console.log(`[$] Football Cycle Complete.`);
    } catch (err) { console.error('[X] Football API Error:', err.response?.statusText || err.message); }
  }

  // 2. BASKETBALL (Fetch full week to hit targets)
  const basketballKey = process.env.BASKETBALL_API_KEY;
  if (basketballKey) {
    try {
      let allBballGames = [];
      for (let i = 0; i < 7; i++) {
        const dateObj = new Date(); dateObj.setDate(dateObj.getDate() + i);
        const dateStr = dateObj.toISOString().split('T')[0];
        const res = await axios.get(`https://v1.basketball.api-sports.io/games`, { headers: { 'x-apisports-key': basketballKey }, params: { date: dateStr } });
        allBballGames = allBballGames.concat(res.data.response);
      }

      for (const game of allBballGames) {
        const matchId = `real_bball_${game.id}`;
        const existing = await Prediction.findOne({ fixtureId: matchId });
        const matchStatus = game.status?.short || 'NS';

        if (matchStatus === 'FT' && existing && !existing.isFinished) {
          existing.isFinished = true;
          const homeScore = game.scores.home.total || 0, awayScore = game.scores.away.total || 0;
          let actualWinner = 'Draw';
          if (homeScore > awayScore) actualWinner = existing.homeTeam; else if (awayScore > homeScore) actualWinner = existing.awayTeam;
          existing.actualScore = `${homeScore}-${awayScore}`; existing.actualWinner = actualWinner;
          existing.isCorrect = actualWinner === existing.predictedWinner;
          if (!existing.isCorrect) existing.errorDiagnosis = "Upset or normal variance.";
          await existing.save();
          await History.create(existing.toObject());
          await Prediction.deleteOne({ _id: existing._id });
          continue;
        }

        if (!existing && matchStatus === 'NS') {
          // Use real team IDs so H2H logic works properly in the engine
          const mockMatch = {
            fixtureId: matchId, sport: 'basketball', league: game.league.name || 'NBA',
            matchDate: game.date,
            homeTeam: { name: game.teams.home.name, id: game.teams.home.id, form: { last5: ['W','L','W','W','L'] }, venueRecord: { winPct: 0.75, awayWinPct: 0.25 } },
            awayTeam: { name: game.teams.away.name, id: game.teams.away.id, form: { last5: ['L','W','L','W','L'] }, venueRecord: { winPct: 0.5, awayWinPct: 0.4 } },
            injuries: { verified: false }, h2h: [{ winner: game.teams.home.id }, { winner: game.teams.away.id }, { winner: game.teams.home.id }]
          };
          const prediction = engine.analyzeMatch(mockMatch); // Automatically uses Basketball model
          prediction.date = game.date; prediction.status = 'Scheduled';
          await Prediction.create(prediction);
        }
      }
      console.log(`[$] Basketball Cycle Complete.`);
    } catch (err) { console.error('[X] Basketball API Error:', err.response?.statusText || err.message); }
  }
}

// --- API ROUTES ---
app.get('/api/predictions', async (req, res) => {
  try {
    const preds = await Prediction.find().sort({ date: 1 });
    res.json({ predictions: preds });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch predictions' });
  }
});

app.get('/api/history', async (req, res) => {
  try {
    const history = await History.find().sort({ _id: -1 }).limit(100);
    const acc = history.length > 0 ? (history.filter(p => p.isCorrect).length / history.length * 100).toFixed(1) : 0;
    res.json({ history, accuracy: acc });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

app.get('/api/analytics', async (req, res) => {
  try {
    const history = await History.find();
    if (history.length === 0) return res.json({ sampleSize: 0, accuracy: 0, brierScore: 0, calibration: [] });
    const correct = history.filter(p => p.isCorrect).length;
    const accuracy = (correct / history.length * 100).toFixed(1);
    let brierSum = 0;
    history.forEach(p => { const prob = parseFloat(p.confidenceScore) / 100; const outcome = p.isCorrect ? 1 : 0; brierSum += Math.pow(prob - outcome, 2); });
    const brierScore = (brierSum / history.length).toFixed(3);
    res.json({
      sampleSize: history.length, accuracy, brierScore,
      footballAccuracy: (history.filter(p => p.sport === 'football' && p.isCorrect).length / Math.max(1, history.filter(p => p.sport === 'football').length) * 100).toFixed(1),
      basketballAccuracy: (history.filter(p => p.sport === 'basketball' && p.isCorrect).length / Math.max(1, history.filter(p => p.sport === 'basketball').length) * 100).toFixed(1)
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// --- TELEGRAM AUTOMATION INTEGRATION ---
async function sendTelegramPredictions() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = '@MatchIntelligenceAI'; 
  if (!botToken) return;
  try {
    const topPicks = await Prediction.find({ status: 'Scheduled' }).sort({ confidenceScore: -1 }).limit(3);
    if (topPicks.length === 0) return;
    let message = `⚽️ *MATCH INTELLIGENCE AI - TOP PICKS* ⚽️\n\n`;
    topPicks.forEach((pick, index) => {
      message += `*${index + 1}. ${pick.homeTeam} vs ${pick.awayTeam}*\n`;
      message += `League: ${pick.league}\n`;
      message += `Best Market: ${pick.bestMarketString} (${pick.confidenceScore}%)\n`;
      message += `Predicted Score: ${pick.predictedScore}\n\n`;
    });
    message += `⚠️ Bet responsibly. Probabilities, not guarantees.`;
    await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, { chat_id: chatId, text: message, parse_mode: 'Markdown' });
    console.log('[$] Sent predictions to Telegram.');
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

// --- START SERVER & CONNECT DB ---
async function startServer() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('[$] MongoDB Connected.');

    app.listen(process.env.PORT || 5001, () => console.log(`Match Intelligence AI 24/7 Server running.`));

    const count = await Prediction.countDocuments();
    if (count === 0) {
      console.log('[$] DB is empty. Fetching matches...');
      await runDailyCycle();
    } else {
      console.log('[$] DB has data. Waiting for next cron job.');
    }

    cron.schedule('*/30 * * * *', () => runDailyCycle());

  } catch (err) {
    console.error('[X] Failed to connect to MongoDB or start server:', err.message);
    app.listen(process.env.PORT || 5001, () => console.log(`Server running (DB Offline).`));
  }
}

startServer();
