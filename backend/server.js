'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cron = require('node-cron');
const mongoose = require('mongoose');
const crypto = require('crypto');

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '1mb' }));

const PORT = Number(process.env.PORT) || 5001;
const MONGO_URI = process.env.MONGO_URI;
const FOOTBALL_DATA_API_KEY = process.env.FOOTBALL_DATA_API_KEY;
const SPORTMONKS_API_TOKEN = process.env.SPORTMONKS_API_TOKEN;
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const FOOTBALL_LIMIT = Math.max(
  1,
  Math.min(20, Number(process.env.FOOTBALL_DAILY_LIMIT) || 20)
);

const DAYS_AHEAD = Math.max(
  1,
  Math.min(14, Number(process.env.DAYS_AHEAD) || 7)
);

const REQUEST_TIMEOUT_MS = 15000;

const footballApi = axios.create({
  baseURL: 'https://api.football-data.org/v4',
  timeout: REQUEST_TIMEOUT_MS,
  headers: {
    'X-Auth-Token': FOOTBALL_DATA_API_KEY || ''
  }
});

const sportmonksApi = axios.create({
  baseURL: 'https://api.sportmonks.com/v3/football',
  timeout: REQUEST_TIMEOUT_MS,
  headers: SPORTMONKS_API_TOKEN
    ? { Authorization: SPORTMONKS_API_TOKEN }
    : {}
});

// ============================================================
// DATABASE MODELS
// ============================================================

const predictionSchema = new mongoose.Schema({
  fixtureId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },

  sport: {
    type: String,
    default: 'football',
    index: true
  },

  league: String,
  homeTeam: { type: String, required: true },
  awayTeam: { type: String, required: true },

  homeTeamId: mongoose.Schema.Types.Mixed,
  awayTeamId: mongoose.Schema.Types.Mixed,

  date: { type: Date, index: true },

  status: {
    type: String,
    default: 'SCHEDULED',
    index: true
  },

  actualScore: mongoose.Schema.Types.Mixed,
  predictedWinner: String,

  isFinished: {
    type: Boolean,
    default: false,
    index: true
  },

  isCorrect: Boolean,
  allMarkets: mongoose.Schema.Types.Mixed,
  bestMarketString: String,
  topCorrectScores: [mongoose.Schema.Types.Mixed],
  confidenceScore: Number,
  dataQuality: String,
  recommendation: String,
  predictedScore: String,
  aiExplanation: String,

  modelVersion: {
    type: String,
    default: 'football-data-form-v21'
  },

  source: String,
  sourceData: mongoose.Schema.Types.Mixed,

  lastUpdated: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  minimize: false
});

const historySchema = new mongoose.Schema({
  fixtureId: { type: String, index: true },
  sport: { type: String, default: 'football' },
  league: String,
  homeTeam: String,
  awayTeam: String,
  date: Date,
  status: String,
  actualScore: mongoose.Schema.Types.Mixed,
  predictedWinner: String,
  isCorrect: Boolean,
  allMarkets: mongoose.Schema.Types.Mixed,
  bestMarketString: String,
  confidenceScore: Number,
  dataQuality: String,
  modelVersion: String,
  errorDiagnosis: String,

  settledAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  minimize: false
});

const Prediction = mongoose.models.Prediction ||
  mongoose.model('Prediction', predictionSchema);

const History = mongoose.models.History ||
  mongoose.model('History', historySchema);

// ============================================================
// APPLICATION STATE
// ============================================================

let refreshInProgress = false;
let lastCycle = null;
let lastCycleError = null;

let lastProviderStatus = {
  footballData: 'not_checked',
  sportmonks: 'not_checked'
};

const recentFormCache = new Map();

// ============================================================
// GENERAL HELPERS
// ============================================================

function formatDateUTC(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function addDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(fc|cf|sc|afc|ac|club|football|women|wfc)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function poisson(lambda, goals) {
  let factorial = 1;

  for (let i = 2; i <= goals; i++) {
    factorial *= i;
  }

  return (
    Math.exp(-lambda) *
    Math.pow(lambda, goals)
  ) / factorial;
}

// ============================================================
// RECENT-FORM CALCULATIONS
// ============================================================

function teamScoreFromRecentMatches(teamId, recentMatches) {
  if (!Array.isArray(recentMatches) || !recentMatches.length) {
    return null;
  }

  let points = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;
  let played = 0;

  for (const match of recentMatches) {
    const homeId = String(match.homeTeamId ?? '');
    const awayId = String(match.awayTeamId ?? '');
    const target = String(teamId ?? '');

    const homeGoals = Number(match.homeGoals);
    const awayGoals = Number(match.awayGoals);

    if (
      !Number.isFinite(homeGoals) ||
      !Number.isFinite(awayGoals)
    ) {
      continue;
    }

    if (homeId !== target && awayId !== target) {
      continue;
    }

    const isHome = homeId === target;

    const scored = isHome ? homeGoals : awayGoals;
    const conceded = isHome ? awayGoals : homeGoals;

    goalsFor += scored;
    goalsAgainst += conceded;

    if (scored > conceded) {
      points += 3;
    } else if (scored === conceded) {
      points += 1;
    }

    played++;
  }

  if (!played) {
    return null;
  }

  return {
    played,
    pointsPerGame: points / played,
    goalsFor: goalsFor / played,
    goalsAgainst: goalsAgainst / played
  };
}

// ============================================================
// FOOTBALL-DATA.ORG FIXTURES
// ============================================================

async function fetchFootballFixtures(from, to) {
  if (!FOOTBALL_DATA_API_KEY) {
    throw new Error(
      'FOOTBALL_DATA_API_KEY is not configured'
    );
  }

  const response = await footballApi.get('/matches', {
    params: {
      dateFrom: from,
      dateTo: to
    }
  });

  lastProviderStatus.footballData = 'ok';

  return Array.isArray(response.data?.matches)
    ? response.data.matches
    : [];
}

// ============================================================
// OPTIONAL SPORTMONKS FIXTURE ENRICHMENT
// ============================================================

async function fetchSportmonksFixtures(from, to) {
  if (!SPORTMONKS_API_TOKEN) {
    return [];
  }

  try {
    const response = await sportmonksApi.get(
      `/fixtures/between/${from}/${to}`,
      {
        params: {
          include: 'participants;scores;league;statistics',
          per_page: 50
        }
      }
    );

    lastProviderStatus.sportmonks = 'ok';

    return Array.isArray(response.data?.data)
      ? response.data.data
      : [];
  } catch (error) {
    lastProviderStatus.sportmonks =
      `error_${error.response?.status || 'request'}`;

    console.warn(
      '[SPORTMONKS] Optional fixture enrichment unavailable:',
      error.response?.status || error.message
    );

    return [];
  }
}

function sportmonksParticipants(fixture) {
  const participants = Array.isArray(fixture?.participants)
    ? fixture.participants
    : [];

  let home = null;
  let away = null;

  for (const participant of participants) {
    const location = participant?.meta?.location;

    if (location === 'home') home = participant;
    if (location === 'away') away = participant;
  }

  return { home, away };
}

function mapSportmonksFixtures(fixtures) {
  const map = new Map();

  for (const fixture of fixtures) {
    const { home, away } = sportmonksParticipants(fixture);

    if (!home?.name || !away?.name) {
      continue;
    }

    const key =
      `${normalizeName(home.name)}|${normalizeName(away.name)}`;

    map.set(key, fixture);
  }

  return map;
}

function getScoreFromSportmonks(fixture) {
  const scores = Array.isArray(fixture?.scores)
    ? fixture.scores
    : [];

  let home = null;
  let away = null;

  for (const item of scores) {
    const description =
      String(item?.description || '').toLowerCase();

    const score = item?.score?.goals;
    const location = item?.score?.participant;

    if (
      description.includes('current') ||
      description.includes('2nd half') ||
      description.includes('fulltime')
    ) {
      if (location === 'home') {
        home = safeNumber(score, home);
      }

      if (location === 'away') {
        away = safeNumber(score, away);
      }
    }
  }

  if (home !== null && away !== null) {
    return { home, away };
  }

  return null;
}

// ============================================================
// PREDICTION ENGINE
// ============================================================

function analyzeFootball(match, recentForm = {}) {
  const homeForm = recentForm.home || null;
  const awayForm = recentForm.away || null;

  // General starting estimates; these are not live team statistics.
  let homeLambda = 1.42;
  let awayLambda = 1.12;

  // Adjust estimates modestly when both teams have recent-form data.
  if (homeForm && awayForm) {
    const homeAttack = clamp(
      homeForm.goalsFor / 1.35,
      0.55,
      1.65
    );

    const homeDefence = clamp(
      homeForm.goalsAgainst / 1.25,
      0.55,
      1.65
    );

    const awayAttack = clamp(
      awayForm.goalsFor / 1.15,
      0.55,
      1.65
    );

    const awayDefence = clamp(
      awayForm.goalsAgainst / 1.35,
      0.55,
      1.65
    );

    homeLambda *=
      0.65 * homeAttack + 0.35 * awayDefence;

    awayLambda *=
      0.65 * awayAttack + 0.35 * homeDefence;

    homeLambda *= clamp(
      1 + (
        homeForm.pointsPerGame -
        awayForm.pointsPerGame
      ) * 0.035,
      0.88,
      1.12
    );

    awayLambda *= clamp(
      1 + (
        awayForm.pointsPerGame -
        homeForm.pointsPerGame
      ) * 0.035,
      0.88,
      1.12
    );
  }

  const grid = [];

  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  let over15 = 0;
  let over25 = 0;
  let btts = 0;

  for (let homeGoals = 0; homeGoals <= 6; homeGoals++) {
    for (let awayGoals = 0; awayGoals <= 6; awayGoals++) {
      const probability =
        poisson(homeLambda, homeGoals) *
        poisson(awayLambda, awayGoals);

      grid.push({
        score: `${homeGoals}-${awayGoals}`,
        home: homeGoals,
        away: awayGoals,
        probability
      });

      if (homeGoals > awayGoals) {
        homeWin += probability;
      } else if (homeGoals === awayGoals) {
        draw += probability;
      } else {
        awayWin += probability;
      }

      if (homeGoals + awayGoals >= 2) {
        over15 += probability;
      }

      if (homeGoals + awayGoals >= 3) {
        over25 += probability;
      }

      if (homeGoals > 0 && awayGoals > 0) {
        btts += probability;
      }
    }
  }

  const total = homeWin + draw + awayWin || 1;

  homeWin /= total;
  draw /= total;
  awayWin /= total;

  const choices = [
    {
      name: match.homeTeam,
      probability: homeWin
    },
    {
      name: 'Draw',
      probability: draw
    },
    {
      name: match.awayTeam,
      probability: awayWin
    }
  ].sort((a, b) => b.probability - a.probability);

  const confidenceScore = Math.round(
    choices[0].probability * 100
  );

  const formAvailable = Boolean(homeForm && awayForm);

  const topScores = grid
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 5)
    .map(item => ({
      score: item.score,
      probability: Math.round(
        item.probability * 1000
      ) / 10
    }));

  const markets = {
    matchWinner: {
      home: Math.round(homeWin * 1000) / 10,
      draw: Math.round(draw * 1000) / 10,
      away: Math.round(awayWin * 1000) / 10
    },

    overUnder15: {
      over: Math.round(over15 * 1000) / 10,
      under: Math.round((1 - over15) * 1000) / 10
    },

    overUnder25: {
      over: Math.round(over25 * 1000) / 10,
      under: Math.round((1 - over25) * 1000) / 10
    },

    bothTeamsToScore: {
      yes: Math.round(btts * 1000) / 10,
      no: Math.round((1 - btts) * 1000) / 10
    }
  };

  const best = choices[0];

  return {
    predictedWinner: best.name,
    confidenceScore,
    allMarkets: markets,
    bestMarketString:
      `${best.name} ${confidenceScore}%`,
    topCorrectScores: topScores,
    predictedScore: topScores[0]?.score || '1-1',

    dataQuality: formAvailable
      ? 'MEDIUM - RECENT FORM AVAILABLE'
      : 'LOW - FORM DATA UNAVAILABLE',

    recommendation: confidenceScore >= 58
      ? 'Consider only after reviewing team news and odds.'
      : 'No strong winner edge; consider avoiding this market.',

    aiExplanation: formAvailable
      ? 'Poisson-based estimate using modest recent-form adjustments and a home advantage prior. It does not include verified injuries, confirmed lineups, bookmaker odds, or xG unless separately available.'
      : 'Baseline Poisson estimate using general home advantage. Verified recent team form was unavailable, so confidence should be treated cautiously. This is not a guarantee.'
  };
}

// ============================================================
// LOAD RECENT MATCHES FOR EACH TEAM
// ============================================================

async function getRecentFormFromFootballData(
  teamId,
  from,
  to
) {
  if (!FOOTBALL_DATA_API_KEY || !teamId) {
    return null;
  }

  const cacheKey = `${teamId}:${from}:${to}`;
  const cached = recentFormCache.get(cacheKey);

  if (
    cached &&
    Date.now() - cached.at < 6 * 60 * 60 * 1000
  ) {
    return cached.value;
  }

  try {
    const response = await footballApi.get(
      `/teams/${teamId}/matches`,
      {
        params: {
          dateFrom: from,
          dateTo: to,
          status: 'FINISHED',
          limit: 10
        }
      }
    );

    const matches = (response.data?.matches || []).map(item => ({
      homeTeamId: item.homeTeam?.id,
      awayTeamId: item.awayTeam?.id,
      homeGoals: item.score?.fullTime?.home,
      awayGoals: item.score?.fullTime?.away
    }));

    const value = teamScoreFromRecentMatches(
      teamId,
      matches
    );

    recentFormCache.set(cacheKey, {
      value,
      at: Date.now()
    });

    return value;
  } catch (error) {
    console.warn(
      `[FORM] Could not load recent form for team ${teamId}:`,
      error.response?.status || error.message
    );

    return null;
  }
}

// ============================================================
// SAVE AND UPDATE FIXTURE PREDICTIONS
// ============================================================

async function saveFootballFixture(match, smFixture = null) {
  const homeId = match.homeTeam?.id;
  const awayId = match.awayTeam?.id;
  const now = new Date();
  const date = new Date(match.utcDate);

  const recentStart = formatDateUTC(
    addDays(now, -60)
  );

  const recentEnd = formatDateUTC(now);

  const [homeForm, awayForm] = await Promise.all([
    getRecentFormFromFootballData(
      homeId,
      recentStart,
      recentEnd
    ),

    getRecentFormFromFootballData(
      awayId,
      recentStart,
      recentEnd
    )
  ]);

  const result = analyzeFootball(
    {
      homeTeam: match.homeTeam?.name,
      awayTeam: match.awayTeam?.name
    },
    {
      home: homeForm,
      away: awayForm
    }
  );

  const smScore = smFixture
    ? getScoreFromSportmonks(smFixture)
    : null;

  const finished =
    String(match.status || '').toUpperCase() === 'FINISHED';

  const actualHome = match.score?.fullTime?.home;
  const actualAway = match.score?.fullTime?.away;

  const actualScore =
    Number.isFinite(actualHome) &&
    Number.isFinite(actualAway)
      ? {
          home: actualHome,
          away: actualAway,
          display: `${actualHome}-${actualAway}`
        }
      : smScore
        ? {
            home: smScore.home,
            away: smScore.away,
            display: `${smScore.home}-${smScore.away}`
          }
        : null;

  const fixtureId = `fdorg_${match.id}`;

  const document = {
    fixtureId,
    sport: 'football',

    league: match.competition?.name || 'Football',

    homeTeam: match.homeTeam?.name || 'Home team',
    awayTeam: match.awayTeam?.name || 'Away team',

    homeTeamId: homeId,
    awayTeamId: awayId,

    date: Number.isNaN(date.getTime()) ? null : date,
    status: match.status || 'SCHEDULED',
    actualScore,

    predictedWinner: result.predictedWinner,
    isFinished: finished,

    allMarkets: result.allMarkets,
    bestMarketString: result.bestMarketString,
    topCorrectScores: result.topCorrectScores,
    confidenceScore: result.confidenceScore,

    dataQuality: result.dataQuality,
    recommendation: result.recommendation,
    predictedScore: result.predictedScore,
    aiExplanation: result.aiExplanation,

    modelVersion: 'football-data-form-v21',

    source: smFixture
      ? 'Football-Data.org + Sportmonks fixture match'
      : 'Football-Data.org',

    sourceData: smFixture
      ? {
          sportmonksFixtureId: smFixture.id,
          sportmonksStatus:
            smFixture.state || smFixture.status || null,

          sportmonksHasStatistics:
            Array.isArray(smFixture.statistics) &&
            smFixture.statistics.length > 0,

          sportmonksHasScores:
            Array.isArray(smFixture.scores) &&
            smFixture.scores.length > 0
        }
      : {
          sportmonksMatched: false
        },

    lastUpdated: new Date()
  };

  const saved = await Prediction.findOneAndUpdate(
    { fixtureId },
    { $set: document },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true
    }
  );

  if (finished && actualScore) {
    await settlePrediction(saved);
  }

  return saved;
}

// ============================================================
// RECORD COMPLETED MATCHES
// ============================================================

async function settlePrediction(prediction) {
  if (
    !prediction ||
    !prediction.isFinished ||
    !prediction.actualScore
  ) {
    return;
  }

  const score = prediction.actualScore;

  const actualWinner =
    score.home > score.away
      ? prediction.homeTeam
      : score.home < score.away
        ? prediction.awayTeam
        : 'Draw';

  const isCorrect =
    prediction.predictedWinner === actualWinner;

  await Prediction.updateOne(
    { _id: prediction._id },
    {
      $set: {
        isCorrect,
        isFinished: true
      }
    }
  );

  await History.findOneAndUpdate(
    { fixtureId: prediction.fixtureId },
    {
      $set: {
        fixtureId: prediction.fixtureId,
        sport: 'football',
        league: prediction.league,

        homeTeam: prediction.homeTeam,
        awayTeam: prediction.awayTeam,
        date: prediction.date,
        status: prediction.status,

        actualScore: score,
        predictedWinner: prediction.predictedWinner,
        isCorrect,

        allMarkets: prediction.allMarkets,
        bestMarketString: prediction.bestMarketString,
        confidenceScore: prediction.confidenceScore,
        dataQuality: prediction.dataQuality,
        modelVersion: prediction.modelVersion,

        errorDiagnosis: isCorrect
          ? 'Correct match-winner prediction'
          : `Predicted ${prediction.predictedWinner}; actual outcome ${actualWinner}`,

        settledAt: new Date()
      }
    },
    {
      upsert: true,
      new: true
    }
  );
}

// ============================================================
// TELEGRAM NOTIFICATIONS
// ============================================================

async function sendTelegramPredictions() {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    return {
      sent: false,
      reason: 'Telegram not configured'
    };
  }

  try {
    const upcoming = await Prediction.find({
      sport: 'football',
      isFinished: false,
      date: { $gte: new Date() }
    })
      .sort({ confidenceScore: -1, date: 1 })
      .limit(3)
      .lean();

    if (!upcoming.length) {
      return {
        sent: false,
        reason: 'No upcoming predictions'
      };
    }

    const lines = [
      '⚽ Match Intelligence AI — Football predictions',
      ''
    ];

    for (const item of upcoming) {
      lines.push(
        `${item.homeTeam} vs ${item.awayTeam}`
      );

      lines.push(
        `Pick: ${item.predictedWinner} (${item.confidenceScore ?? 'N/A'}%)`
      );

      lines.push(
        `Score estimate: ${item.predictedScore || 'N/A'} | Quality: ${item.dataQuality || 'Unknown'}`
      );

      lines.push(
        item.date
          ? new Date(item.date).toUTCString()
          : 'Kickoff TBC',
        ''
      );
    }

    lines.push(
      'Probabilities are estimates, not guarantees. Verify team news before acting.'
    );

    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        chat_id: TELEGRAM_CHAT_ID,
        text: lines.join('\n'),
        disable_web_page_preview: true
      },
      {
        timeout: REQUEST_TIMEOUT_MS
      }
    );

    console.log('[TELEGRAM] Football predictions sent.');

    return {
      sent: true,
      count: upcoming.length
    };
  } catch (error) {
    console.warn(
      '[TELEGRAM] Send failed:',
      error.response?.status || error.message
    );

    return {
      sent: false,
      reason: 'Telegram send failed'
    };
  }
}

// ============================================================
// AUTOMATIC FOOTBALL DATA REFRESH
// ============================================================

async function runDailyCycle() {
  if (refreshInProgress) {
    return {
      skipped: true,
      reason: 'Cycle already running'
    };
  }

  refreshInProgress = true;
  const started = Date.now();

  try {
    const from = formatDateUTC(new Date());

    const to = formatDateUTC(
      addDays(new Date(), DAYS_AHEAD)
    );

    console.log(
      `[CYCLE] Starting football-only cycle ${new Date().toISOString()}`
    );

    console.log(
      `[FOOTBALL] Requesting fixtures from ${from} to ${to}.`
    );

    const [fixtures, smFixtures] = await Promise.all([
      fetchFootballFixtures(from, to),
      fetchSportmonksFixtures(from, to)
    ]);

    const smMap = mapSportmonksFixtures(smFixtures);

    const eligible = fixtures
      .filter(item => {
        const status = String(item.status || '').toUpperCase();

        return (
          ['SCHEDULED', 'TIMED', 'IN_PLAY', 'PAUSED'].includes(status) &&
          new Date(item.utcDate) >= new Date()
        );
      })
      .sort(
        (a, b) => new Date(a.utcDate) - new Date(b.utcDate)
      )
      .slice(0, FOOTBALL_LIMIT);

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let settled = 0;

    for (const match of eligible) {
      try {
        const key =
          `${normalizeName(match.homeTeam?.name)}|${normalizeName(match.awayTeam?.name)}`;

        const before = await Prediction.exists({
          fixtureId: `fdorg_${match.id}`
        });

        const saved = await saveFootballFixture(
          match,
          smMap.get(key) || null
        );

        if (before) {
          updated++;
        } else {
          inserted++;
        }

        if (saved.isFinished && saved.actualScore) {
          settled++;
        }
      } catch (error) {
        skipped++;

        console.warn(
          `[FOOTBALL] Could not process fixture ${match.id}:`,
          error.message
        );
      }
    }

    // Preserve older predictions and their history.
    const upcoming = await Prediction.find({
      sport: 'football',
      isFinished: false,
      date: { $gte: new Date() }
    })
      .sort({ date: 1 })
      .limit(FOOTBALL_LIMIT)
      .select('_id')
      .lean();

    const keepIds = upcoming.map(item => item._id);

    const telegram = await sendTelegramPredictions();

    lastCycle = {
      at: new Date().toISOString(),
      provider: 'Football-Data.org',
      sportmonksFixtures: smFixtures.length,
      fetched: fixtures.length,
      eligible: eligible.length,
      inserted,
      updated,
      skipped,
      settled,
      upcomingWithinLimit: keepIds.length,
      telegram,
      durationMs: Date.now() - started
    };

    lastCycleError = null;

    console.log(
      `[CYCLE] Football results: ${JSON.stringify(lastCycle)}`
    );

    return lastCycle;
  } catch (error) {
    lastCycleError = {
      at: new Date().toISOString(),
      message: error.message,
      status: error.response?.status || null
    };

    console.error(
      '[CYCLE] Failed:',
      error.response?.status || '',
      error.message
    );

    throw error;
  } finally {
    refreshInProgress = false;
  }
}

// ============================================================
// ADMIN AUTHENTICATION
// ============================================================

function requireAdmin(req, res, next) {
  if (!ADMIN_API_KEY) {
    return res.status(503).json({
      ok: false,
      error: 'Admin endpoint is not configured'
    });
  }

  const supplied =
    req.get('x-admin-key') ||
    req.get('authorization')?.replace(/^Bearer\s+/i, '');

  const suppliedBuffer = Buffer.from(String(supplied || ''));
  const expectedBuffer = Buffer.from(String(ADMIN_API_KEY));

  if (
    !supplied ||
    suppliedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    return res.status(401).json({
      ok: false,
      error: 'Unauthorized'
    });
  }

  next();
}

// ============================================================
// API ROUTES
// ============================================================

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    name: 'Match Intelligence AI',
    sport: 'football',
    status: 'running'
  });
});

app.get('/health', async (_req, res) => {
  res.json({
    ok: true,
    db: mongoose.connection.readyState === 1,
    sport: 'football',
    provider: 'Football-Data.org',
    sportmonksConfigured: Boolean(SPORTMONKS_API_TOKEN),
    refreshInProgress,
    lastCycle,
    lastCycleError,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/health', async (_req, res) => {
  const [predictionCount, historyCount] = await Promise.all([
    Prediction.countDocuments({ sport: 'football' }).catch(() => 0),
    History.countDocuments({ sport: 'football' }).catch(() => 0)
  ]);

  res.json({
    ok: true,
    stage: 'football-fixtures',
    provider: 'Football-Data.org',
    apiKeyConfigured: Boolean(FOOTBALL_DATA_API_KEY),
    sportmonksConfigured: Boolean(SPORTMONKS_API_TOKEN),
    refreshInProgress,
    predictionCount,
    historyCount,
    lastCycle,
    lastCycleError,
    checkedAt: new Date().toISOString()
  });
});

app.get('/api/sportmonks/health', async (_req, res) => {
  if (!SPORTMONKS_API_TOKEN) {
    return res.status(200).json({
      ok: false,
      provider: 'Sportmonks',
      authenticated: false,
      error: 'SPORTMONKS_API_TOKEN is not configured'
    });
  }

  try {
    const response = await sportmonksApi.get('/fixtures', {
      params: {
        per_page: 1
      }
    });

    res.json({
      ok: true,
      provider: 'Sportmonks',
      authenticated: true,
      fixturesReturned: Array.isArray(response.data?.data)
        ? response.data.data.length
        : 0
    });
  } catch (error) {
    res.status(502).json({
      ok: false,
      provider: 'Sportmonks',
      authenticated: false,
      status: error.response?.status || null,
      error: error.response?.data?.message || error.message
    });
  }
});

app.get('/api/predictions', async (req, res) => {
  try {
    const limit = clamp(
      parseInt(req.query.limit, 10) || 100,
      1,
      300
    );

    const query = {
      sport: 'football'
    };

    if (req.query.status === 'upcoming') {
      query.isFinished = false;
      query.date = { $gte: new Date() };
    }

    if (req.query.status === 'finished') {
      query.isFinished = true;
    }

    const predictions = await Prediction.find(query)
      .sort({ date: 1 })
      .limit(limit)
      .lean();

    res.json({
      ok: true,
      count: predictions.length,
      predictions,
      data: predictions
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: 'Could not load predictions'
    });
  }
});

app.get('/api/history', async (req, res) => {
  try {
    const limit = clamp(
      parseInt(req.query.limit, 10) || 100,
      1,
      300
    );

    const history = await History.find({
      sport: 'football'
    })
      .sort({ settledAt: -1 })
      .limit(limit)
      .lean();

    res.json({
      ok: true,
      count: history.length,
      history,
      data: history
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: 'Could not load history'
    });
  }
});

app.get('/api/analytics', async (_req, res) => {
  try {
    const [
      total,
      finished,
      historyCount,
      correct,
      avgConfidence
    ] = await Promise.all([
      Prediction.countDocuments({
        sport: 'football'
      }),

      Prediction.countDocuments({
        sport: 'football',
        isFinished: true
      }),

      History.countDocuments({
        sport: 'football'
      }),

      History.countDocuments({
        sport: 'football',
        isCorrect: true
      }),

      Prediction.aggregate([
        {
          $match: {
            sport: 'football',
            confidenceScore: { $type: 'number' }
          }
        },
        {
          $group: {
            _id: null,
            average: { $avg: '$confidenceScore' }
          }
        }
      ])
    ]);

    res.json({
      ok: true,
      sport: 'football',
      totalPredictions: total,
      finishedPredictions: finished,
      historyCount,
      correctPredictions: correct,

      accuracy: historyCount
        ? Math.round(correct / historyCount * 1000) / 10
        : null,

      averageConfidence: avgConfidence[0]?.average == null
        ? null
        : Math.round(avgConfidence[0].average * 10) / 10
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: 'Could not calculate analytics'
    });
  }
});

app.post(
  '/api/admin/run-cycle',
  requireAdmin,
  async (_req, res) => {
    try {
      const result = await runDailyCycle();

      res.json({
        ok: true,
        result
      });
    } catch (error) {
      res.status(502).json({
        ok: false,
        error: 'Cycle failed',
        detail: error.response?.status || error.message
      });
    }
  }
);

app.get(
  '/api/admin/run-cycle',
  requireAdmin,
  async (_req, res) => {
    try {
      const result = await runDailyCycle();

      res.json({
        ok: true,
        result
      });
    } catch (error) {
      res.status(502).json({
        ok: false,
        error: 'Cycle failed',
        detail: error.response?.status || error.message
      });
    }
  }
);

// ============================================================
// ERROR HANDLER
// ============================================================

app.use((error, _req, res, _next) => {
  console.error('[HTTP] Unhandled error:', error.message);

  res.status(500).json({
    ok: false,
    error: 'Internal server error'
  });
});

// ============================================================
// START SERVER
// ============================================================

async function startServer() {
  if (!MONGO_URI) {
    throw new Error('MONGO_URI is required');
  }

  await mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 15000
  });

  console.log('[DATABASE] MongoDB connected.');

  app.listen(PORT, () => {
    console.log(
      `Match Intelligence AI listening on port ${PORT}.`
    );

    console.log('[STARTUP] Active sport: football only.');

    console.log(
      '[STARTUP] Provider: Football-Data.org; Sportmonks enrichment: ' +
      (SPORTMONKS_API_TOKEN ? 'configured' : 'not configured')
    );
  });

  runDailyCycle().catch(error => {
    console.error(
      '[STARTUP] Initial cycle failed:',
      error.message
    );
  });

  cron.schedule('0 */6 * * *', () => {
    runDailyCycle().catch(error => {
      console.error('[CRON] Cycle failed:', error.message);
    });
  });

  console.log(
    '[CRON] Football fixture cycle scheduled every six hours.'
  );
}

startServer().catch(error => {
  console.error('[STARTUP] Fatal error:', error.message);
  process.exit(1);
});
