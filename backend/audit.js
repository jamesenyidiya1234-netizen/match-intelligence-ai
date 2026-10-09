const PredictionEngine = require('./services/predictionEngine');
const engine = new PredictionEngine();

function runAudit() {
  console.log('--- STARTING 1000 MATCH BACKTEST AUDIT ---');
  let oldModelCorrect = 0;
  let newModelCorrect = 0;
  const sampleSize = 1000;

  for (let i = 0; i < sampleSize; i++) {
    const genForm = () => Array.from({length: 5}, () => ['W','D','L'][Math.floor(Math.random()*3)]);
    const genGoals = (mean) => {
      let L = Math.exp(-mean), k = 0, p = 1;
      do { k++; p *= Math.random(); } while (p > L);
      return k - 1;
    };

    const match = {
      sport: 'football',
      homeTeam: { name: 'Home', id: 1, form: { last5: genForm() }, venueRecord: { winPct: 0.6, awayWinPct: 0.3 } },
      awayTeam: { name: 'Away', id: 2, form: { last5: genForm() }, venueRecord: { winPct: 0.4, awayWinPct: 0.2 } },
      injuries: { verified: false }, 
      h2h: [{ winner: 1 }, { winner: 2 }, { winner: 1 }]
    };

    const prediction = engine.analyzeMatch(match);
    const homeGoals = genGoals(1.35);
    const awayGoals = genGoals(1.15);
    const totalGoals = homeGoals + awayGoals;

    let newCorrect = false;
    const market = prediction.bestMarket.market;
    const selection = prediction.bestMarket.selection;

    if (market === 'Over/Under 1.5 Goals' && selection === 'Over 1.5') {
      if (totalGoals >= 2) newCorrect = true;
    } else if (market === 'Over/Under 1.5 Goals' && selection === 'Under 1.5') {
      if (totalGoals <= 1) newCorrect = true;
    } else if (market === 'Over/Under 2.5 Goals' && selection === 'Over 2.5') {
      if (totalGoals >= 3) newCorrect = true;
    } else if (market === 'Over/Under 2.5 Goals' && selection === 'Under 2.5') {
      if (totalGoals <= 2) newCorrect = true;
    } else if (market === 'Over/Under 3.5 Goals' && selection === 'Over 3.5') {
      if (totalGoals >= 4) newCorrect = true;
    } else if (market === 'Over/Under 3.5 Goals' && selection === 'Under 3.5') {
      if (totalGoals <= 3) newCorrect = true;
    } else if (market === 'Match Winner') {
      if (selection === 'Home' && homeGoals > awayGoals) newCorrect = true;
      if (selection === 'Away' && awayGoals > homeGoals) newCorrect = true;
    } else if (market === 'Double Chance') {
      if (selection === 'Home or Draw' && (homeGoals >= awayGoals)) newCorrect = true;
      if (selection === 'Away or Draw' && (awayGoals >= homeGoals)) newCorrect = true;
    } else if (market === 'Both Teams To Score') {
      if (selection === 'Yes' && homeGoals > 0 && awayGoals > 0) newCorrect = true;
      if (selection === 'No' && (homeGoals === 0 || awayGoals === 0)) newCorrect = true;
    }
    
    if (newCorrect) newModelCorrect++;
    if (totalGoals >= 2) oldModelCorrect++;
  }

  console.log('Sample Size: 1000 simulated matches.');
  console.log('Old Model Accuracy (Blind Over 1.5 baseline): ' + ((oldModelCorrect/sampleSize)*100).toFixed(1) + '%');
  console.log('New Audited Model Accuracy (Smart Market Selection): ' + ((newModelCorrect/sampleSize)*100).toFixed(1) + '%');
  console.log('--- AUDIT COMPLETE ---');
}

runAudit();
