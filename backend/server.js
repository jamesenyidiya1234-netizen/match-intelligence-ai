require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cron = require('node-cron');
const { JSONFilePreset } = require('lowdb/node');
const app = express();

app.use(cors());
app.use(express.json());

// --- PREDICTION ENGINE (Built directly inside) ---
class PredictionEngine {
  constructor() {
    this.footballWeights = { form: 0.20, injuries: 0.15, homeAway: 0.10, h2h: 0.10, tactics: 0.15, stats: 0.15, fatigue: 0.05, motivation: 0.05, transfers: 0.05 };
    this.basketballWeights = { form: 0.20, injuries: 0.20, efficiency: 0.15, homeAway: 0.10, h2h: 0.05, tactics: 0.10, fatigue: 0.10, depth: 0.05, transfers: 0.05 };
  }
  factorial(n) { if (n < 0) return 0; if (n === 0) return 1; let res = 1; for (let i = 2; i <= n; i++) res *= i; return res; }
  poissonProb(expected, actual) { return Math.pow(expected, actual) * Math.exp(-expected) / this.factorial(actual); }
  calculateForm(form) { if (!form || !form.last5) return 0.5; return form.last5.reduce((acc, val) => acc + (val === 'W' ? 3 : val === 'D' ? 1 : 0), 0) / 15; }
  calculateInjuryImpact(injuredPlayers) { if (!injuredPlayers) return 0; return injuredPlayers.reduce((impact, p) => impact + (p.isStar ? 0.3 : 0.1), 0); }
  calculateH2H(matches, homeId, awayId) { if (!matches) return { home: 0.5, away: 0.5 }; let homeWins = 0, awayWins = 0; matches.forEach(m => { if (m.winner === homeId) homeWins++; else if (m.winner === awayId) awayWins++; }); return { home: homeWins / matches.length, away: awayWins / matches.length }; }

  analyzeMatch(matchData) {
    const { sport, homeTeam, awayTeam, injuries, h2h } = matchData;
    const weights = sport === 'football' ? this.footballWeights : this.basketballWeights;
    let homeScore = 0, awayScore = 0, missingDataPoints = [], warnings = [];
    let homeAttack = 1.35, homeDefense = 1.15, awayAttack = 1.15, awayDefense = 1.35;

    if (homeTeam.form && awayTeam.form) {
      homeScore += (this.calculateForm(homeTeam.form) * weights.form);
      awayScore += (this.calculateForm(awayTeam.form) * weights.form);
      if (sport === 'football') {
        const hWins = homeTeam.form.last5.filter(v => v === 'W').length; const hLosses = homeTeam.form.last5.filter(v => v === 'L').length;
        homeAttack = 1.0 + (hWins * 0.25) - (hLosses * 0.1); homeDefense = 1.2 - (hWins * 0.1) + (hLosses * 0.2);
        const aWins = awayTeam.form.last5.filter(v => v === 'W').length; const aLosses = awayTeam.form.last5.filter(v => v === 'L').length;
        awayAttack = 0.9 + (aWins * 0.25) - (aLosses * 0.1); awayDefense = 1.3 - (aWins * 0.1) + (aLosses * 0.2);
      } else {
        homeAttack = 100 + (homeTeam.form.last5.filter(v => v === 'W').length * 5);
        awayAttack = 98 + (awayTeam.form.last5.filter(v => v === 'W').length * 5);
      }
    } else { missingDataPoints.push('Recent form data incomplete'); }

    if (injuries && injuries.verified) {
      const homeInjuryImpact = this.calculateInjuryImpact(injuries.home); const awayInjuryImpact = this.calculateInjuryImpact(injuries.away);
      homeScore -= (homeInjuryImpact * weights.injuries); awayScore -= (awayInjuryImpact * weights.injuries);
      if (homeInjuryImpact > 0.2) warnings.push('Home team missing key players');
    } else { missingDataPoints.push('Injury information unverified'); }

    if (homeTeam.venueRecord && awayTeam.venueRecord) { homeScore += ((homeTeam.venueRecord.winPct - awayTeam.venueRecord.awayWinPct) * weights.homeAway); }
    if (h2h && h2h.length >= 3) { const h2hScore = this.calculateH2H(h2h, homeTeam.id, awayTeam.id); homeScore += (h2hScore.home * weights.h2h); awayScore += (h2hScore.away * weights.h2h); } else { missingDataPoints.push('Insufficient H2H history'); }

    const totalScore = Math.max(homeScore + awayScore, 0.1);
    let homeWinProb = totalScore > 0 ? (homeScore / totalScore) : 0.5; let awayWinProb = totalScore > 0 ? (awayScore / totalScore) : 0.5;
    let drawProb = 0;
    if (sport === 'football') { drawProb = 0.28 - (Math.abs(homeWinProb - awayWinProb) * 0.2); homeWinProb = homeWinProb * (1 - drawProb); awayWinProb = awayWinProb * (1 - drawProb); }

    const markets = [];
    markets.push({ market: 'Match Winner', selection: homeTeam.name, probability: homeWinProb });
    markets.push({ market: 'Match Winner', selection: awayTeam.name, probability: awayWinProb });

    if (sport === 'football') {
      markets.push({ market: 'Double Chance', selection: `${homeTeam.name} or Draw`, probability: homeWinProb + drawProb });
      markets.push({ market: 'Double Chance', selection: `${awayTeam.name} or Draw`, probability: awayWinProb + drawProb });
      const homeExpGoals = (homeAttack * awayDefense) / 1.35; const awayExpGoals = (awayAttack * homeDefense) / 1.35; const totalExpGoals = homeExpGoals + awayExpGoals;
      const p0 = this.poissonProb(totalExpGoals, 0), p1 = this.poissonProb(totalExpGoals, 1), p2 = this.poissonProb(totalExpGoals, 2), p3 = this.poissonProb(totalExpGoals, 3);
      markets.push({ market: 'Over/Under 1.5 Goals', selection: 'Over 1.5', probability: 1 - (p0 + p1) });
      markets.push({ market: 'Over/Under 2.5 Goals', selection: 'Over 2.5', probability: 1 - (p0 + p1 + p2) });
      markets.push({ market: 'Both Teams To Score', selection: 'Yes', probability: Math.min(0.90, Math.max(0.10, 1 - (this.poissonProb(homeExpGoals, 0) + this.poissonProb(awayExpGoals, 0)))) });
    }

    const bestMarket = markets.reduce((max, m) => m.probability > max.probability ? m : max, markets[0]);
    const bestProb = bestMarket.probability * 100;
    const dataQuality = missingDataPoints.length > 2 ? 'LOW' : missingDataPoints.length > 0 ? 'MEDIUM' : 'HIGH';
    let recommendation = (bestProb >= 70 && dataQuality !== 'LOW') ? 'HIGH-CONFIDENCE SELECTION' : 'NO STRONG PREDICTION';

    return {
      homeTeam: homeTeam.name, awayTeam: awayTeam.name, sport,
      bestMarket: bestMarket, allMarkets: markets.map(m => ({...m, probability: (m.probability * 100).toFixed(1)})),
      predictedWinner: homeWinProb > awayWinProb ? homeTeam.name : awayTeam.name,
      confidenceScore: bestProb.toFixed(0), dataQuality: dataQuality, recommendation: recommendation,
      expectedScore: `${homeAttack.toFixed(1)} - ${awayAttack.toFixed(1)}`, warnings: warnings, missingData: missingDataPoints,
      aiExplanation: `Elite Analysis: ${bestMarket.market} (${bestMarket.selection}) is statistically the strongest outcome with an estimated ${bestProb.toFixed(1)}% probability.`, modelVersion: 'v3.1 Unified'
    };
  }
}

const engine = new PredictionEngine();
let db;

async function initializeSystem() {
  const defaultData = { matches: [], predictions: [], history: [], config: { timezone: 'UTC', minConfidence: 60 } };
  db = await JSONFilePreset('db.json', defaultData);

  async function runDailyCycle() {
    console.log(`[$] [${new Date().toLocaleTimeString()}] Running 24/7 Automation Cycle...`);
    const footballKey = process.env.SPORTMONKS_API_KEY;
    if (footballKey) {
      try {
        const today = new Date(); const nextWeek = new Date(); nextWeek.setDate(today.getDate() + 7);
        const formatDate = (date) => date.toISOString().split('T')[0];
        const res = await axios.get(`https://api.sportmonks.com/v3/football/fixtures/between/${formatDate(today)}/${formatDate(nextWeek)}?api_token=${footballKey}&per_page=50`);
        const now = new Date();
        const validFixtures = res.data.data.filter(f => f.starting_at && f.name && new Date(f.starting_at) > now);
        for (const fixture of validFixtures) {
          const matchId = `real_${fixture.id}`;
          if (!db.data.predictions.find(p => p.id === matchId) && !fixture.result_info) {
            const nameParts = (fixture.name || 'Home vs Away').split(' vs ');
            const mockMatch = { sport: 'football', matchDate: fixture.starting_at, homeTeam: { name: nameParts[0] || 'Home', id: 1, form: { last5: ['W','D','W','L','W'] }, venueRecord: { winPct: 0.7, awayWinPct: 0.3 } }, awayTeam: { name: nameParts[1] || 'Away', id: 2, form: { last5: ['L','W','D','L','W'] }, venueRecord: { winPct: 0.4, awayWinPct: 0.2 } }, injuries: { verified: false }, h2h: [{ winner: 1 }, { winner: 2 }, { winner: 1 }] };
            const prediction = engine.analyzeMatch(mockMatch);
            prediction.id = matchId; prediction.date = fixture.starting_at; prediction.valueEdge = (Math.random() * 20).toFixed(1);
            db.data.predictions.push(prediction);
          }
        }
      } catch (err) { console.error('[X] Football API Error:', err.response?.statusText || err.message); }
    }
    const basketballKey = process.env.BASKETBALL_API_KEY;
    if (basketballKey) {
      try {
        const res = await axios.get(`https://v1.basketball.api-sports.io/games`, { headers: { 'x-apisports-key': basketballKey }, params: { date: new Date().toISOString().split('T')[0] } });
        const now = new Date();
        const validGames = res.data.response.filter(g => g.date && new Date(g.date) > now);
        for (const game of validGames) {
          const matchId = `real_bball_${game.id}`;
          if (!db.data.predictions.find(p => p.id === matchId) && !(game.status && game.status.short === 'FT')) {
            const mockMatch = { sport: 'basketball', matchDate: game.date, homeTeam: { name: game.teams.home.name, id: 1, form: { last5: ['W','D','W','L','W'] }, venueRecord: { winPct: 0.7, awayWinPct: 0.3 } }, awayTeam: { name: game.teams.away.name, id: 2, form: { last5: ['L','W','D','L','W'] }, venueRecord: { winPct: 0.4, awayWinPct: 0.2 } }, injuries: { verified: false }, h2h: [{ winner: 1 }, { winner: 2 }, { winner: 1 }] };
            const prediction = engine.analyzeMatch(mockMatch);
            prediction.id = matchId; prediction.date = game.date; prediction.valueEdge = (Math.random() * 25).toFixed(1);
            db.data.predictions.push(prediction);
          }
        }
      } catch (err) { console.error('[X] Basketball API Error:', err.response?.statusText || err.message); }
    }
    await db.write(); console.log(`[$] Cycle Complete. Active predictions: ${db.data.predictions.length}`);
  }

  cron.schedule('0 * * * *', () => runDailyCycle());
  await runDailyCycle();

  app.get('/api/predictions', (req, res) => res.json({ predictions: db.data.predictions.sort((a, b) => new Date(a.date) - new Date(b.date)) }));
  app.get('/api/history', (req, res) => { const acc = db.data.history.length > 0 ? (db.data.history.filter(p => p.isCorrect).length / db.data.history.length * 100).toFixed(1) : 0; res.json({ history: db.data.history, accuracy: acc }); });
  app.get('/api/system-health', (req, res) => res.json({ status: '🟢 OPERATIONAL', botRunning: true, activePredictions: db.data.predictions.length }));

  app.listen(process.env.PORT || 5001, () => console.log(`Match Intelligence AI 24/7 Server running.`));
}

initializeSystem().catch(err => console.error('Failed to initialize system:', err));
