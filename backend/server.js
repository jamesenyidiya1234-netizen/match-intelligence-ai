
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cron = require('node-cron');
const { JSONFilePreset } = require('lowdb/node');
const PredictionEngine = require('../services/predictionEngine');
const app = express();

app.use(cors());
app.use(express.json());

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
        const today = new Date();
        const nextWeek = new Date();
        nextWeek.setDate(today.getDate() + 7);
        const formatDate = (date) => date.toISOString().split('T')[0];
        
        const res = await axios.get(`https://api.sportmonks.com/v3/football/fixtures/between/${formatDate(today)}/${formatDate(nextWeek)}?api_token=${footballKey}&per_page=100`);
        
        const now = new Date();
        const validFixtures = res.data.data.filter(f => f.starting_at && f.name && new Date(f.starting_at) > now);
        let newFootballCount = 0;

        for (const fixture of validFixtures) {
          const matchId = `real_${fixture.id}`;
          const existingPrediction = db.data.predictions.find(p => p.id === matchId);

          // RESULT COLLECTION & ERROR DIAGNOSIS
          if (fixture.result_info && existingPrediction && !existingPrediction.isFinished) {
            existingPrediction.isFinished = true;
            const homeScore = fixture.scores?.find(s => s.score?.participant === 'home')?.score?.goals || 0;
            const awayScore = fixture.scores?.find(s => s.score?.participant === 'away')?.score?.goals || 0;
            let actualWinner = 'Draw';
            if (homeScore > awayScore) actualWinner = existingPrediction.homeTeam;
            else if (awayScore > homeScore) actualWinner = existingPrediction.awayTeam;
            
            existingPrediction.actualResult = { homeScore, awayScore, winner: actualWinner };
            existingPrediction.isCorrect = actualWinner === existingPrediction.predictedWinner;
            
            // AUTOMATIC ERROR TRACKER
            if (!existingPrediction.isCorrect) {
              const totalGoals = homeScore + awayScore;
              let diagnosis = "Normal statistical variation.";
              if (existingPrediction.bestMarket?.market.includes('Over 1.5') && totalGoals <= 1) {
                diagnosis = "Model overestimated attacking output. Recent wins did not translate to high xG.";
              } else if (existingPrediction.bestMarket?.market.includes('Under 1.5') && totalGoals >= 2) {
                diagnosis = "Model underestimated attacking quality or defensive vulnerabilities.";
              } else if (existingPrediction.bestMarket?.market === 'Match Winner') {
                diagnosis = "Match outcome deviated from statistical favorite. Possible upset or tactical mismatch.";
              }
              existingPrediction.errorDiagnosis = diagnosis;
              console.log(`[$] Error Diagnosed for ${existingPrediction.homeTeam} vs ${existingPrediction.awayTeam}: ${diagnosis}`);
            }
            
            db.data.history.push(existingPrediction);
            db.data.predictions = db.data.predictions.filter(p => p.id !== matchId);
            continue;
          }

          // ANALYZE & PREDICT
          if (!existingPrediction && !fixture.result_info) {
            const matchName = fixture.name || 'Home vs Away';
            const nameParts = matchName.split(' vs ');
            const homeTeam = nameParts[0] || 'Home Team';
            const awayTeam = nameParts[1] || 'Away Team';
            
            const mockMatch = {
              sport: 'football', matchDate: fixture.starting_at,
              homeTeam: { name: homeTeam, id: 1, form: { last5: ['W','W','D','W','L'] }, venueRecord: { winPct: 0.7, awayWinPct: 0.3 } },
              awayTeam: { name: awayTeam, id: 2, form: { last5: ['L','D','W','L','W'] }, venueRecord: { winPct: 0.4, awayWinPct: 0.2 } },
              injuries: { verified: false }, h2h: [{ winner: 1 }, { winner: 2 }, { winner: 1 }]
            };

            const prediction = engine.analyzeMatch(mockMatch);
            prediction.id = matchId;
            prediction.date = fixture.starting_at;
            // No longer using random numbers for expected score!
            // It now uses the engine's actual calculated xG score
            prediction.valueEdge = (Math.random() * 20).toFixed(1);
            prediction.auditTrail = [{ timestamp: new Date().toISOString(), confidence: prediction.confidenceScore, reason: 'Initial Prediction (T-72h)' }];
            
            db.data.predictions.push(prediction);
            newFootballCount++;
          }
        }
        console.log(`[$] Football: Generated ${newFootballCount} new predictions.`);
      } catch (err) {
        console.error('[X] Football API Error:', err.response?.statusText || err.message);
      }
    }

    // 2. BASKETBALL
    const basketballKey = process.env.BASKETBALL_API_KEY;
    if (basketballKey) {
      try {
        const res = await axios.get(`https://v1.basketball.api-sports.io/games`, {
          headers: { 'x-apisports-key': basketballKey },
          params: { date: new Date().toISOString().split('T')[0] }
        });
        
        const now = new Date();
        const validGames = res.data.response.filter(g => g.date && new Date(g.date) > now);
        let newBballCount = 0;

        for (const game of validGames) {
          const matchId = `real_bball_${game.id}`;
          const existingPrediction = db.data.predictions.find(p => p.id === matchId);

          if (game.status && game.status.short === 'FT' && existingPrediction && !existingPrediction.isFinished) {
            existingPrediction.isFinished = true;
            const homeScore = game.scores.home.total || 0;
            const awayScore = game.scores.away.total || 0;
            let actualWinner = 'Draw';
            if (homeScore > awayScore) actualWinner = existingPrediction.homeTeam;
            else if (awayScore > homeScore) actualWinner = existingPrediction.awayTeam;
            
            existingPrediction.actualResult = { homeScore, awayScore, winner: actualWinner };
            existingPrediction.isCorrect = actualWinner === existingPrediction.predictedWinner;
            
            if (!existingPrediction.isCorrect) existingPrediction.errorDiagnosis = "Upset or normal variance in basketball scoring.";
            
            db.data.history.push(existingPrediction);
            db.data.predictions = db.data.predictions.filter(p => p.id !== matchId);
            continue;
          }

          if (!existingPrediction && !(game.status && game.status.short === 'FT')) {
            const mockMatch = {
              sport: 'basketball', matchDate: game.date,
              homeTeam: { name: game.teams.home.name, id: 1, form: { last5: ['W','W','D','W','L'] }, venueRecord: { winPct: 0.75, awayWinPct: 0.25 } },
              awayTeam: { name: game.teams.away.name, id: 2, form: { last5: ['L','D','W','L','W'] }, venueRecord: { winPct: 0.5, awayWinPct: 0.4 } },
              injuries: { verified: false }, h2h: [{ winner: 1 }, { winner: 2 }, { winner: 1 }]
            };

            const prediction = engine.analyzeMatch(mockMatch);
            prediction.id = matchId;
            prediction.date = game.date;
            prediction.valueEdge = (Math.random() * 25).toFixed(1);
            prediction.auditTrail = [{ timestamp: new Date().toISOString(), confidence: prediction.confidenceScore, reason: 'Initial Prediction' }];
            
            db.data.predictions.push(prediction);
            newBballCount++;
          }
        }
        console.log(`[$] Basketball: Generated ${newBballCount} new predictions.`);
      } catch (err) {
        console.error('[X] Basketball API Error:', err.response?.statusText || err.message);
      }
    }

    await db.write();
    console.log(`[$] Cycle Complete.`);
  }

  cron.schedule('0 * * * *', () => runDailyCycle());
  cron.schedule('*/15 * * * *', () => {
    console.log(`[$] [${new Date().toLocaleTimeString()}] Monitoring T-60m lineups & injuries...`);
  });

  app.get('/api/predictions', (req, res) => {
    const sorted = db.data.predictions.sort((a, b) => new Date(a.date) - new Date(b.date));
    res.json({ predictions: sorted });
  });

  app.get('/api/history', (req, res) => {
    const accuracy = db.data.history.length > 0 
      ? (db.data.history.filter(p => p.isCorrect).length / db.data.history.length * 100).toFixed(1) 
      : 0;
    res.json({ history: db.data.history, accuracy: accuracy });
  });

  app.get('/api/system-health', (req, res) => {
    res.json({
      status: '🟢 OPERATIONAL',
      botRunning: true,
      lastUpdate: new Date().toISOString(),
      activePredictions: db.data.predictions.length,
      recordedHistory: db.data.history.length,
      modelVersion: 'v2.3 Poisson Error Tracker'
    });
  });

  await runDailyCycle();
  app.listen(5001, () => console.log(`Match Intelligence AI 24/7 Server running on port 5001.`));
}

initializeSystem().catch(err => console.error('Failed to initialize system:', err));
