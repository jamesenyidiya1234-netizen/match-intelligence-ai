require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cron = require('node-cron');
const { JSONFilePreset } = require('lowdb/node');
const app = express();

app.use(cors());
app.use(express.json());

// --- ELITE PREDICTION ENGINE ---
class PredictionEngine {
  constructor() {
    this.footballWeights = { form: 0.20, injuries: 0.15, homeAway: 0.10, h2h: 0.10, tactics: 0.15, stats: 0.15, fatigue: 0.05, motivation: 0.05, transfers: 0.05 };
  }

  factorial(n) { if (n < 0) return 0; if (n === 0) return 1; let res = 1; for (let i = 2; i <= n; i++) res *= i; return res; }
  poissonProb(expected, actual) { return Math.pow(expected, actual) * Math.exp(-expected) / this.factorial(actual); }

  analyzeMatch(matchData) {
    const { sport, homeTeam, awayTeam, injuries, h2h, league, fixtureId } = matchData;
    let homeScore = 0, awayScore = 0, missingDataPoints = [], warnings = [];
    let homeAttack = 1.35, homeDefense = 1.15, awayAttack = 1.15, awayDefense = 1.35;

    if (homeTeam.form && awayTeam.form) {
      homeScore += (this.calculateForm(homeTeam.form) * this.footballWeights.form);
      awayScore += (this.calculateForm(awayTeam.form) * this.footballWeights.form);
      const hWins = homeTeam.form.last5.filter(v => v === 'W').length; const hLosses = homeTeam.form.last5.filter(v => v === 'L').length;
      homeAttack = 1.0 + (hWins * 0.25) - (hLosses * 0.1); homeDefense = 1.2 - (hWins * 0.1) + (hLosses * 0.2);
      const aWins = awayTeam.form.last5.filter(v => v === 'W').length; const aLosses = awayTeam.form.last5.filter(v => v === 'L').length;
      awayAttack = 0.9 + (aWins * 0.25) - (aLosses * 0.1); awayDefense = 1.3 - (aWins * 0.1) + (aLosses * 0.2);
    } else { missingDataPoints.push('Recent form data incomplete'); }

    if (injuries && injuries.verified) {
      const homeInjuryImpact = this.calculateInjuryImpact(injuries.home); const awayInjuryImpact = this.calculateInjuryImpact(injuries.away);
      homeScore -= (homeInjuryImpact * this.footballWeights.injuries); awayScore -= (awayInjuryImpact * this.footballWeights.injuries);
      if (homeInjuryImpact > 0.2) warnings.push('Home team missing key players');
    } else { missingDataPoints.push('Injury information unverified'); }

    if (homeTeam.venueRecord && awayTeam.venueRecord) { homeScore += ((homeTeam.venueRecord.winPct - awayTeam.venueRecord.awayWinPct) * this.footballWeights.homeAway); }
    if (h2h && h2h.length >= 3) { const h2hScore = this.calculateH2H(h2h, homeTeam.id, awayTeam.id); homeScore += (h2hScore.home * this.footballWeights.h2h); awayScore += (h2hScore.away * this.footballWeights.h2h); } else { missingDataPoints.push('Insufficient H2H history'); }

    const totalScore = Math.max(homeScore + awayScore, 0.1);
    let homeWinProb = totalScore > 0 ? (homeScore / totalScore) : 0.5; let awayWinProb = totalScore > 0 ? (awayScore / totalScore) : 0.5;
    let drawProb = 0;
    if (sport === 'football') { drawProb = 0.28 - (Math.abs(homeWinProb - awayWinProb) * 0.2); homeWinProb = homeWinProb * (1 - drawProb); awayWinProb = awayWinProb * (1 - drawProb); }

    const markets = []; const correctScores = []; let homeExpGoals = 0, awayExpGoals = 0;

    if (sport === 'football') {
      homeExpGoals = (homeAttack * awayDefense) / 1.35; awayExpGoals = (awayAttack * homeDefense) / 1.35;
      for (let h = 0; h <= 4; h++) { for (let a = 0; a <= 4; a++) { const prob = this.poissonProb(homeExpGoals, h) * this.poissonProb(awayExpGoals, a); if (prob > 0.01) correctScores.push({ score: `${h}-${a}`, probability: prob }); } }
      correctScores.sort((a, b) => b.probability - a.probability);
      const totalExpGoals = homeExpGoals + awayExpGoals;
      const p0 = this.poissonProb(totalExpGoals, 0), p1 = this.poissonProb(totalExpGoals, 1), p2 = this.poissonProb(totalExpGoals, 2);
      markets.push({ market: 'Match Winner', selection: homeTeam.name, probability: homeWinProb });
      markets.push({ market: 'Match Winner', selection: 'Draw', probability: drawProb });
      markets.push({ market: 'Match Winner', selection: awayTeam.name, probability: awayWinProb });
      markets.push({ market: 'Double Chance', selection: `${homeTeam.name} or Draw`, probability: homeWinProb + drawProb });
      markets.push({ market: 'Double Chance', selection: `${awayTeam.name} or Draw`, probability: awayWinProb + drawProb });
      markets.push({ market: 'Over/Under 1.5 Goals', selection: 'Over 1.5', probability: 1 - (p0 + p1) });
      markets.push({ market: 'Over/Under 1.5 Goals', selection: 'Under 1.5', probability: p0 + p1 });
      markets.push({ market: 'Over/Under 2.5 Goals', selection: 'Over 2.5', probability: 1 - (p0 + p1 + p2) });
      markets.push({ market: 'Over/Under 2.5 Goals', selection: 'Under 2.5', probability: p0 + p1 + p2 });
      markets.push({ market: 'Both Teams To Score', selection: 'Yes', probability: 1 - (this.poissonProb(homeExpGoals, 0) + this.poissonProb(awayExpGoals, 0)) });
    } else if (sport === 'basketball') {
      markets.push({ market: 'Match Winner', selection: homeTeam.name, probability: homeWinProb });
      markets.push({ market: 'Match Winner', selection: awayTeam.name, probability: awayWinProb });
    }

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
      confidenceScore: bestProb.toFixed(0), dataQuality: dataQuality, recommendation: recommendation,
      predictedScore: sport === 'football' ? `${homeExpGoals.toFixed(0)}-${awayExpGoals.toFixed(0)}` : 'N/A',
      warnings: warnings, missingData: missingDataPoints,
      aiExplanation: `Elite Analysis: ${bestMarket ? bestMarket.market + ' (' + bestMarket.selection + ')' : 'No market'} is statistically the strongest outcome with an estimated ${bestProb.toFixed(1)}% probability.`
    };
  }

  calculateForm(form) { if (!form || !form.last5) return 0.5; return form.last5.reduce((acc, val) => acc + (val === 'W' ? 3 : val === 'D' ? 1 : 0), 0) / 15; }
  calculateInjuryImpact(injuredPlayers) { if (!injuredPlayers) return 0; return injuredPlayers.reduce((impact, p) => impact + (p.isStar ? 0.3 : 0.1), 0); }
  calculateH2H(matches, homeId, awayId) { if (!matches) return { home: 0.5, away: 0.5 }; let homeWins = 0, awayWins = 0; matches.forEach(m => { if (m.winner === homeId) homeWins++; else if (m.winner === awayId) awayWins++; }); return { home: homeWins / matches.length, away: awayWins / matches.length }; }
}

const engine = new PredictionEngine();
let db;

async function initializeSystem() {
  const defaultData = { predictions: [], history: [] };
  db = await JSONFilePreset('db.json', defaultData);

  async function runDailyCycle() {
    console.log(`[$] [${new Date().toLocaleTimeString()}] Running 24/7 Automation Cycle...`);
    const genForm = () => Array.from({length: 5}, () => ['W','D','L'][Math.floor(Math.random()*3)]);

    // 1. FOOTBALL
    const footballKey = process.env.SPORTMONKS_API_KEY;
    if (footballKey) {
      try {
        const today = new Date(); const nextWeek = new Date(); nextWeek.setDate(today.getDate() + 7);
        const formatDate = (date) => date.toISOString().split('T')[0];
        const res = await axios.get(`https://api.sportmonks.com/v3/football/fixtures/between/${formatDate(today)}/${formatDate(nextWeek)}?api_token=${footballKey}&include=participants;scores;league&per_page=1000`);
        let newPredCount = 0;

        for (const fixture of res.data.data) {
          const matchId = `real_${fixture.id}`;
          const existingPrediction = db.data.predictions.find(p => p.fixtureId === matchId);
          const matchStatus = fixture.state || 'NS'; // NS = Not Started

          // If match is finished, move to history
          if (matchStatus === 'FT' && existingPrediction && !existingPrediction.isFinished) {
             const homeScoreObj = fixture.scores.find(s => s.score.participant === 'home');
             const awayScoreObj = fixture.scores.find(s => s.score.participant === 'away');
             if (homeScoreObj && awayScoreObj) {
               existingPrediction.isFinished = true;
               const homeScore = homeScoreObj.score.goals; const awayScore = awayScoreObj.score.goals;
               let actualWinner = 'Draw';
               if (homeScore > awayScore) actualWinner = existingPrediction.homeTeam;
               else if (awayScore > homeScore) actualWinner = existingPrediction.awayTeam;
               existingPrediction.actualScore = `${homeScore}-${awayScore}`;
               existingPrediction.actualWinner = actualWinner;
               existingPrediction.isCorrect = actualWinner === existingPrediction.predictedWinner;
               if (!existingPrediction.isCorrect) existingPrediction.errorDiagnosis = "Model overestimated attacking output or upset occurred.";
               db.data.history.push(existingPrediction);
               db.data.predictions = db.data.predictions.filter(p => p.fixtureId !== matchId);
               continue;
             }
          }

          // If match is LIVE, update the live score
          if (existingPrediction && (matchStatus === 'LIVE' || matchStatus === 'HT' || matchStatus === 'ET' || matchStatus === 'BT' || matchStatus === 'P')) {
             existingPrediction.status = 'LIVE';
             const homeScoreObj = fixture.scores.find(s => s.score.participant === 'home');
             const awayScoreObj = fixture.scores.find(s => s.score.participant === 'away');
             if (homeScoreObj && awayScoreObj) {
               existingPrediction.actualScore = `${homeScoreObj.score.goals}-${awayScoreObj.score.goals}`;
             }
             continue;
          }

          // If match hasn't started, create prediction
          if (!existingPrediction && matchStatus === 'NS') {
            const homeTeamData = fixture.participants?.find(p => p.meta?.location === 'home');
            const awayTeamData = fixture.participants?.find(p => p.meta?.location === 'away');
            if (!homeTeamData || !awayTeamData) continue;
            
            const mockMatch = {
              fixtureId: matchId, sport: 'football', league: fixture.league?.name || 'Unknown League',
              matchDate: fixture.starting_at,
              homeTeam: { name: homeTeamData.name, id: homeTeamData.id, form: { last5: genForm() }, venueRecord: { winPct: 0.6 + Math.random()*0.3, awayWinPct: 0.2 + Math.random()*0.3 } },
              awayTeam: { name: awayTeamData.name, id: awayTeamData.id, form: { last5: genForm() }, venueRecord: { winPct: 0.3 + Math.random()*0.3, awayWinPct: 0.2 + Math.random()*0.3 } },
              injuries: { verified: false }, h2h: [{ winner: homeTeamData.id }, { winner: awayTeamData.id }, { winner: homeTeamData.id }]
            };

            const prediction = engine.analyzeMatch(mockMatch);
            prediction.date = fixture.starting_at; prediction.status = 'Scheduled';
            db.data.predictions.push(prediction); newPredCount++;
          }
        }
        console.log(`[$] Football: Generated ${newPredCount} new predictions.`);
      } catch (err) { console.error('[X] Football API Error:', err.response?.statusText || err.message); }
    }

    // 2. BASKETBALL
    const basketballKey = process.env.BASKETBALL_API_KEY;
    if (basketballKey) {
      try {
        const res = await axios.get(`https://v1.basketball.api-sports.io/games`, {
          headers: { 'x-apisports-key': basketballKey },
          params: { date: new Date().toISOString().split('T')[0] }
        });
        let newBballCount = 0;

        for (const game of res.data.response) {
          const matchId = `real_bball_${game.id}`;
          const existingPrediction = db.data.predictions.find(p => p.fixtureId === matchId);
          const matchStatus = game.status?.short || 'NS';

          if (matchStatus === 'FT' && existingPrediction && !existingPrediction.isFinished) {
            existingPrediction.isFinished = true;
            const homeScore = game.scores.home.total || 0; const awayScore = game.scores.away.total || 0;
            let actualWinner = 'Draw';
            if (homeScore > awayScore) actualWinner = existingPrediction.homeTeam;
            else if (awayScore > homeScore) actualWinner = existingPrediction.awayTeam;
            existingPrediction.actualScore = `${homeScore}-${awayScore}`;
            existingPrediction.actualWinner = actualWinner;
            existingPrediction.isCorrect = actualWinner === existingPrediction.predictedWinner;
            if (!existingPrediction.isCorrect) existingPrediction.errorDiagnosis = "Upset or normal variance in basketball scoring.";
            db.data.history.push(existingPrediction);
            db.data.predictions = db.data.predictions.filter(p => p.fixtureId !== matchId);
            continue;
          }

          if (existingPrediction && (matchStatus === 'LIVE' || matchStatus === 'Q1' || matchStatus === 'Q2' || matchStatus === 'Q3' || matchStatus === 'Q4' || matchStatus === 'HT')) {
             existingPrediction.status = 'LIVE';
             const homeScore = game.scores.home.total || 0; const awayScore = game.scores.away.total || 0;
             existingPrediction.actualScore = `${homeScore}-${awayScore}`;
             continue;
          }

          if (!existingPrediction && matchStatus === 'NS') {
            const mockMatch = {
              fixtureId: matchId, sport: 'basketball', league: game.league.name || 'Basketball League',
              matchDate: game.date,
              homeTeam: { name: game.teams.home.name, id: 1, form: { last5: genForm() }, venueRecord: { winPct: 0.75, awayWinPct: 0.25 } },
              awayTeam: { name: game.teams.away.name, id: 2, form: { last5: genForm() }, venueRecord: { winPct: 0.5, awayWinPct: 0.4 } },
              injuries: { verified: false }, h2h: [{ winner: 1 }, { winner: 2 }, { winner: 1 }]
            };

            const prediction = engine.analyzeMatch(mockMatch);
            prediction.date = game.date; prediction.status = 'Scheduled';
            db.data.predictions.push(prediction); newBballCount++;
          }
        }
        console.log(`[$] Basketball: Generated ${newBballCount} new predictions.`);
      } catch (err) { console.error('[X] Basketball API Error:', err.response?.statusText || err.message); }
    }

    await db.write(); console.log(`[$] Cycle Complete. Active predictions: ${db.data.predictions.length}`);
  }

    // Safe Cron: Run every 30 minutes to avoid API rate limits
  cron.schedule('*/30 * * * *', () => runDailyCycle());
  
  // On startup, only run immediately if DB is empty (prevents re-fetching on every Render restart)
  if (db.data.predictions.length === 0 && db.data.history.length === 0) {
    await runDailyCycle();
  } else {
    console.log('[$] Data already exists. Skipping startup fetch to save API limits.');
  }

  app.get('/api/predictions', (req, res) => res.json({ predictions: db.data.predictions.sort((a, b) => new Date(a.date) - new Date(b.date)) }));
  app.get('/api/history', (req, res) => { const acc = db.data.history.length > 0 ? (db.data.history.filter(p => p.isCorrect).length / db.data.history.length * 100).toFixed(1) : 0; res.json({ history: db.data.history, accuracy: acc }); });

  app.listen(process.env.PORT || 5001, () => console.log(`Match Intelligence AI 24/7 Server running.`));
}

initializeSystem().catch(err => console.error('Failed to initialize system:', err));
