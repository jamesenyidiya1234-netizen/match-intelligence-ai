class PredictionEngine {
  constructor() {
    this.footballWeights = {
      form: 0.20, injuries: 0.15, homeAway: 0.10, h2h: 0.10,
      tactics: 0.15, stats: 0.15, fatigue: 0.05, motivation: 0.05, transfers: 0.05
    };
  }

  factorial(n) {
    if (n < 0) return 0;
    if (n === 0) return 1;
    let res = 1;
    for (let i = 2; i <= n; i++) res *= i;
    return res;
  }

  poissonProb(expected, actual) {
    return Math.pow(expected, actual) * Math.exp(-expected) / this.factorial(actual);
  }

  analyzeMatch(matchData) {
    const { sport, homeTeam, awayTeam, injuries, h2h } = matchData;
    let homeScore = 0;
    let awayScore = 0;
    let missingDataPoints = [];
    let warnings = [];

    // 1. FORM & STATISTICS (Audit Fix: Realistic Attack vs Defense)
    // Baseline average goals is 1.35 per team. 
    // We now calculate both Attack and Defense ratings.
    let homeAttack = 1.35; 
    let homeDefense = 1.15; // Expected Goals Against
    let awayAttack = 1.15;
    let awayDefense = 1.35;
    
    if (homeTeam.form && awayTeam.form) {
      homeScore += (this.calculateForm(homeTeam.form) * this.footballWeights.form);
      awayScore += (this.calculateForm(awayTeam.form) * this.footballWeights.form);
      
      if (sport === 'football') {
        // Audit Fix #3: Better xG formula based on wins/losses affecting attack/defense
        const hWins = homeTeam.form.last5.filter(v => v === 'W').length;
        const hLosses = homeTeam.form.last5.filter(v => v === 'L').length;
        homeAttack = 1.0 + (hWins * 0.25) - (hLosses * 0.1);
        homeDefense = 1.2 - (hWins * 0.1) + (hLosses * 0.2);

        const aWins = awayTeam.form.last5.filter(v => v === 'W').length;
        const aLosses = awayTeam.form.last5.filter(v => v === 'L').length;
        awayAttack = 0.9 + (aWins * 0.25) - (aLosses * 0.1);
        awayDefense = 1.3 - (aWins * 0.1) + (aLosses * 0.2);
      }
    } else {
      missingDataPoints.push('Recent form data incomplete');
    }

    if (injuries && injuries.verified) {
      const homeInjuryImpact = this.calculateInjuryImpact(injuries.home);
      const awayInjuryImpact = this.calculateInjuryImpact(injuries.away);
      homeScore -= (homeInjuryImpact * this.footballWeights.injuries);
      awayScore -= (awayInjuryImpact * this.footballWeights.injuries);
      if (homeInjuryImpact > 0.2) warnings.push('Home team missing key players');
    } else {
      missingDataPoints.push('Injury information unverified');
    }

    if (homeTeam.venueRecord && awayTeam.venueRecord) {
      const homeAdv = homeTeam.venueRecord.winPct - awayTeam.venueRecord.awayWinPct;
      homeScore += (homeAdv * this.footballWeights.homeAway);
    }

    if (h2h && h2h.length >= 3) {
      const h2hScore = this.calculateH2H(h2h, homeTeam.id, awayTeam.id);
      homeScore += (h2hScore.home * this.footballWeights.h2h);
      awayScore += (h2hScore.away * this.footballWeights.h2h);
    } else {
      missingDataPoints.push('Insufficient H2H history');
    }

    // --- PROBABILITY CALCULATIONS ---
    const totalScore = Math.max(homeScore + awayScore, 0.1);
    let homeWinProb = totalScore > 0 ? (homeScore / totalScore) : 0.5;
    let awayWinProb = totalScore > 0 ? (awayScore / totalScore) : 0.5;
    
    let drawProb = 0;
    if (sport === 'football') {
      drawProb = 0.28 - (Math.abs(homeWinProb - awayWinProb) * 0.2);
      homeWinProb = homeWinProb * (1 - drawProb);
      awayWinProb = awayWinProb * (1 - drawProb);
    }

    // --- MULTI-MARKET ANALYSIS ---
    const markets = [];
    markets.push({ market: 'Match Winner', selection: homeTeam.name, probability: homeWinProb });
    markets.push({ market: 'Match Winner', selection: awayTeam.name, probability: awayWinProb });

    if (sport === 'football') {
      markets.push({ market: 'Double Chance', selection: `${homeTeam.name} or Draw`, probability: homeWinProb + drawProb });
      markets.push({ market: 'Double Chance', selection: `${awayTeam.name} or Draw`, probability: awayWinProb + drawProb });
      
      // Audit Fix #2: Attack vs Defense interaction for Expected Goals
      const homeExpGoals = (homeAttack * awayDefense) / 1.35; 
      const awayExpGoals = (awayAttack * homeDefense) / 1.35;
      const totalExpGoals = homeExpGoals + awayExpGoals;

      const p0 = this.poissonProb(totalExpGoals, 0);
      const p1 = this.poissonProb(totalExpGoals, 1);
      const p2 = this.poissonProb(totalExpGoals, 2);
      const p3 = this.poissonProb(totalExpGoals, 3);

      const over05 = 1 - p0;
      const over15 = 1 - (p0 + p1);
      const over25 = 1 - (p0 + p1 + p2);
      const over35 = 1 - (p0 + p1 + p2 + p3);

      markets.push({ market: 'Over/Under 0.5 Goals', selection: 'Over 0.5', probability: over05 });
      markets.push({ market: 'Over/Under 1.5 Goals', selection: 'Over 1.5', probability: over15 });
      markets.push({ market: 'Over/Under 2.5 Goals', selection: 'Over 2.5', probability: over25 });
      markets.push({ market: 'Over/Under 3.5 Goals', selection: 'Over 3.5', probability: over35 });

      markets.push({ market: 'Over/Under 0.5 Goals', selection: 'Under 0.5', probability: p0 });
      markets.push({ market: 'Over/Under 1.5 Goals', selection: 'Under 1.5', probability: p0 + p1 });
      markets.push({ market: 'Over/Under 2.5 Goals', selection: 'Under 2.5', probability: p0 + p1 + p2 });
      markets.push({ market: 'Over/Under 3.5 Goals', selection: 'Under 3.5', probability: p0 + p1 + p2 + p3 });

      const bttsProb = Math.min(0.90, Math.max(0.10, 1 - (this.poissonProb(homeExpGoals, 0) + this.poissonProb(awayExpGoals, 0))));
      markets.push({ market: 'Both Teams To Score', selection: 'Yes', probability: bttsProb });
      markets.push({ market: 'Both Teams To Score', selection: 'No', probability: 1 - bttsProb });
    }

    // Audit Fix #5: Smarter Best Market Selection
    // We ignore Over/Under 0.5 as it's too high probability to be useful.
    // For Over 1.5, we require >75% to be a "Best Market" because average baseline is ~70%.
    const validMarketsForBest = markets.filter(m => {
      if (m.market.includes('0.5 Goals')) return false;
      if (m.market === 'Over/Under 1.5 Goals' && m.selection === 'Over 1.5' && m.probability < 0.75) return false;
      return true;
    });
    
    const bestMarket = validMarketsForBest.reduce((max, m) => m.probability > max.probability ? m : max, validMarketsForBest[0]);
    const bestProb = bestMarket.probability * 100;

    const dataQuality = missingDataPoints.length > 2 ? 'LOW' : missingDataPoints.length > 0 ? 'MEDIUM' : 'HIGH';
    
    let confidenceCategory = 'Low Confidence (<60%)';
    if (bestProb >= 90) confidenceCategory = 'Extremely High (90-100%)';
    else if (bestProb >= 80) confidenceCategory = 'High (80-89%)';
    else if (bestProb >= 70) confidenceCategory = 'Moderately High (70-79%)';
    else if (bestProb >= 60) confidenceCategory = 'Moderate (60-69%)';

    let recommendation = 'NO STRONG PREDICTION';
    if (bestProb >= 70 && dataQuality !== 'LOW') {
      recommendation = 'HIGH-CONFIDENCE SELECTION';
    } else if (bestProb >= 60 && dataQuality === 'HIGH') {
      recommendation = 'MODERATE SELECTION';
    }

    const explanation = `Elite Analysis: ${bestMarket.market} (${bestMarket.selection}) is statistically the strongest outcome with an estimated ${bestProb.toFixed(1)}% probability. Attack vs Defense xG interaction calculated.`;

    return {
      homeTeam: homeTeam.name,
      awayTeam: awayTeam.name,
      sport,
      bestMarket: bestMarket,
      allMarkets: markets.map(m => ({...m, probability: (m.probability * 100).toFixed(1)})),
      predictedWinner: homeWinProb > awayWinProb ? homeTeam.name : awayTeam.name,
      confidenceScore: bestProb.toFixed(0),
      confidenceCategory: confidenceCategory,
      dataQuality: dataQuality,
      recommendation: recommendation,
      expectedScore: `${homeAttack.toFixed(1)} - ${awayAttack.toFixed(1)}`,
      warnings: warnings,
      missingData: missingDataPoints,
      aiExplanation: explanation,
      modelVersion: 'v3.0 Audited Poisson'
    };
  }

  calculateForm(form) {
    if (!form || !form.last5) return 0.5;
    return form.last5.reduce((acc, val) => acc + (val === 'W' ? 3 : val === 'D' ? 1 : 0), 0) / 15;
  }

  calculateInjuryImpact(injuredPlayers) {
    if (!injuredPlayers) return 0;
    return injuredPlayers.reduce((impact, p) => impact + (p.isStar ? 0.3 : 0.1), 0);
  }

  calculateH2H(matches, homeId, awayId) {
    if (!matches) return { home: 0.5, away: 0.5 };
    let homeWins = 0, awayWins = 0;
    matches.forEach(m => {
      if (m.winner === homeId) homeWins++;
      else if (m.winner === awayId) awayWins++;
    });
    return { home: homeWins / matches.length, away: awayWins / matches.length };
  }
}

module.exports = PredictionEngine;