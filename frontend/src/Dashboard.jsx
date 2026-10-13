import { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ||
  'https://match-intelligence-ai.onrender.com'
).replace(/\/+$/, '');

const REFRESH_INTERVAL = 30000;

const DAYS_OF_WEEK = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

function getMonday(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);

  const day = result.getDay();
  const difference = day === 0 ? -6 : 1 - day;

  result.setDate(result.getDate() + difference);
  return result;
}

function isValidDate(value) {
  return value != null && !Number.isNaN(new Date(value).getTime());
}

function formatDate(value) {
  if (!isValidDate(value)) return 'Date unavailable';

  return new Date(value).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatTime(value) {
  if (!isValidDate(value)) return 'Time unavailable';

  return new Date(value).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getConfidence(prediction) {
  const value = Number(prediction?.confidenceScore);

  if (!Number.isFinite(value)) return null;

  return Math.max(0, Math.min(100, value));
}

function getMatchId(prediction, index) {
  return (
    prediction?.fixtureId ??
    prediction?.id ??
    `${prediction?.homeTeam || 'home'}-${prediction?.awayTeam || 'away'}-${prediction?.date || index}`
  );
}

function getStatus(prediction) {
  return String(prediction?.status || 'Scheduled').toUpperCase();
}

function getStatusClasses(status) {
  if (['LIVE', 'IN PLAY', '1ST HALF', '2ND HALF', 'HT'].includes(status)) {
    return 'bg-red-900 text-red-300';
  }

  if (['FT', 'AET', 'PEN', 'FINISHED'].includes(status)) {
    return 'bg-gray-700 text-gray-300';
  }

  return 'bg-emerald-900 text-emerald-300';
}

function getMarkets(prediction) {
  return Array.isArray(prediction?.allMarkets)
    ? prediction.allMarkets.filter(
        (market) =>
          market &&
          market.market &&
          market.selection &&
          Number.isFinite(Number(market.probability))
      )
    : [];
}

function isValueOpportunity(prediction) {
  const description = String(
    prediction?.bestMarketString || ''
  ).toLowerCase();

  const marketDescriptions = getMarkets(prediction)
    .map((market) => `${market.market} ${market.selection}`.toLowerCase())
    .join(' ');

  const combined = `${description} ${marketDescriptions}`;

  return (
    combined.includes('over') ||
    combined.includes('btts') ||
    combined.includes('both teams to score')
  );
}

function normalizePredictions(responseData) {
  // Accept the API format used by this project.
  if (Array.isArray(responseData?.predictions)) {
    return responseData.predictions;
  }

  // Also support APIs that return the array directly.
  if (Array.isArray(responseData)) {
    return responseData;
  }

  throw new Error(
    'The server response does not contain a valid predictions list.'
  );
}

export default function Dashboard({
  onNavigate = () => {},
  pageFilter = 'all',
}) {
  const [predictions, setPredictions] = useState([]);
  const [selectedMatch, setSelectedMatch] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentWeekStart, setCurrentWeekStart] = useState(() =>
    getMonday(new Date())
  );
  const [lastUpdated, setLastUpdated] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const fetchData = useCallback(async (manual = false) => {
    if (manual) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const response = await axios.get(
        `${API_BASE_URL}/api/predictions`,
        {
          timeout: 20000,
          headers: {
            Accept: 'application/json',
          },
        }
      );

      const receivedPredictions = normalizePredictions(response.data);

      setPredictions(receivedPredictions);
      setLastUpdated(new Date());
      setErrorMessage('');

      // Keep the selected match synchronized with the latest response.
      setSelectedMatch((previous) => {
        if (!previous) return null;

        const previousId = String(
          previous.fixtureId ?? previous.id ?? ''
        );

        return (
          receivedPredictions.find(
            (prediction) =>
              String(prediction.fixtureId ?? prediction.id ?? '') ===
              previousId
          ) || previous
        );
      });
    } catch (error) {
      console.error('Failed to load predictions:', error);

      if (error.response) {
        setErrorMessage(
          `The predictions server returned HTTP ${error.response.status}. Please try again.`
        );
      } else if (error.code === 'ECONNABORTED') {
        setErrorMessage(
          'The server took too long to respond. Please try again.'
        );
      } else {
        setErrorMessage(
          'Unable to connect to the predictions server. Check your internet connection and backend deployment.'
        );
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();

    const intervalId = setInterval(() => {
      fetchData();
    }, REFRESH_INTERVAL);

    return () => clearInterval(intervalId);
  }, [fetchData]);

  const filteredPredictions = useMemo(() => {
    let results = [...predictions];

    if (pageFilter === 'football') {
      results = results.filter(
        (prediction) =>
          String(prediction.sport || '').toLowerCase() === 'football'
      );
    } else if (pageFilter === 'basketball') {
      results = results.filter(
        (prediction) =>
          String(prediction.sport || '').toLowerCase() === 'basketball'
      );
    } else if (pageFilter === 'today') {
      const today = new Date();

      results = results.filter((prediction) => {
        if (!isValidDate(prediction.date)) return false;

        const matchDate = new Date(prediction.date);

        return (
          matchDate.getFullYear() === today.getFullYear() &&
          matchDate.getMonth() === today.getMonth() &&
          matchDate.getDate() === today.getDate()
        );
      });
    } else if (pageFilter === 'value') {
      results = results.filter(isValueOpportunity);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase();

      results = results.filter((prediction) => {
        const home = String(prediction.homeTeam || '').toLowerCase();
        const away = String(prediction.awayTeam || '').toLowerCase();
        const league = String(prediction.league || '').toLowerCase();

        return (
          home.includes(query) ||
          away.includes(query) ||
          league.includes(query) ||
          `${home} vs ${away}`.includes(query) ||
          `${away} vs ${home}`.includes(query)
        );
      });
    }

    if (pageFilter === 'motd') {
      results.sort(
        (a, b) =>
          (getConfidence(b) ?? -1) - (getConfidence(a) ?? -1)
      );

      results = results.slice(0, 1);
    }

    return results;
  }, [predictions, pageFilter, searchQuery]);

  const weekEnd = useMemo(() => {
    const result = new Date(currentWeekStart);
    result.setDate(result.getDate() + 7);
    return result;
  }, [currentWeekStart]);

  const weekMatches = useMemo(() => {
    // Today's Matches should show today's fixtures, not an entire week.
    if (pageFilter === 'today') {
      return filteredPredictions;
    }

    return filteredPredictions.filter((prediction) => {
      if (!isValidDate(prediction.date)) return false;

      const matchDate = new Date(prediction.date);

      return (
        matchDate >= currentWeekStart &&
        matchDate < weekEnd
      );
    });
  }, [
    filteredPredictions,
    currentWeekStart,
    weekEnd,
    pageFilter,
  ]);

  const groupedMatches = useMemo(() => {
    const groups = {};

    DAYS_OF_WEEK.forEach((dayName, index) => {
      const dayDate = new Date(currentWeekStart);
      dayDate.setDate(dayDate.getDate() + index);

      const dayMatches = weekMatches
        .filter((prediction) => {
          if (!isValidDate(prediction.date)) return false;

          const matchDate = new Date(prediction.date);

          return (
            matchDate.getFullYear() === dayDate.getFullYear() &&
            matchDate.getMonth() === dayDate.getMonth() &&
            matchDate.getDate() === dayDate.getDate()
          );
        })
        .sort(
          (a, b) =>
            new Date(a.date).getTime() -
            new Date(b.date).getTime()
        );

      groups[dayName] = {
        date: dayDate,
        matches: dayMatches,
        football: dayMatches.filter(
          (prediction) =>
            String(prediction.sport || '').toLowerCase() === 'football'
        ),
        basketball: dayMatches.filter(
          (prediction) =>
            String(prediction.sport || '').toLowerCase() === 'basketball'
        ),
      };
    });

    return groups;
  }, [weekMatches, currentWeekStart]);

  const changeWeek = (numberOfWeeks) => {
    setCurrentWeekStart((previous) => {
      const result = new Date(previous);
      result.setDate(result.getDate() + numberOfWeeks * 7);
      return result;
    });
  };

  const isToday = (date) => {
    const today = new Date();

    return (
      date.getFullYear() === today.getFullYear() &&
      date.getMonth() === today.getMonth() &&
      date.getDate() === today.getDate()
    );
  };

  const renderMatchCard = (prediction, index) => {
    const status = getStatus(prediction);
    const confidence = getConfidence(prediction);
    const markets = getMarkets(prediction);
    const matchKey = getMatchId(prediction, index);

    const bestMarket =
      prediction.bestMarketString ||
      (markets.length > 0
        ? `${markets[0].market}: ${markets[0].selection}`
        : 'No market supplied by the server');

    const actualScore =
      prediction.actualScore ??
      prediction.score ??
      null;

    return (
      <button
        type="button"
        key={matchKey}
        onClick={() => setSelectedMatch(prediction)}
        className="w-full text-left bg-gray-800 rounded-xl shadow-lg p-5 border border-gray-700 hover:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all"
        aria-label={`View details for ${prediction.homeTeam || 'Home team'} versus ${prediction.awayTeam || 'Away team'}`}
      >
        <div className="flex justify-between items-start gap-3 mb-4 border-b border-gray-700 pb-3">
          <span className="text-xs text-gray-400 font-bold">
            {prediction.league || 'League unavailable'}
          </span>

          <span
            className={`shrink-0 text-xs font-bold px-2 py-1 rounded ${getStatusClasses(status)}`}
          >
            {formatTime(prediction.date)} · {status}
          </span>
        </div>

        <div className="flex justify-between items-center gap-2 mb-6">
          <div className="text-left w-2/5 min-w-0">
            <p className="font-bold text-lg sm:text-xl break-words">
              {prediction.homeTeam || 'Home team unavailable'}
            </p>
            <p className="text-xs text-gray-500 mt-1">Home</p>
          </div>

          <div className="text-center w-1/5 shrink-0">
            <p className="text-xs mb-1 text-gray-400">
              {actualScore !== null ? 'Score' : 'Predicted score'}
            </p>

            <p
              className={`text-lg sm:text-2xl font-bold px-2 py-1 rounded-lg border ${
                actualScore !== null
                  ? 'bg-gray-900 border-gray-600 text-white'
                  : 'bg-gray-900 border-gray-700 text-gray-200'
              }`}
            >
              {actualScore !== null
                ? typeof actualScore === 'object'
                  ? `${actualScore.home ?? '?'} - ${actualScore.away ?? '?'}`
                  : actualScore
                : prediction.predictedScore || 'N/A'}
            </p>
          </div>

          <div className="text-right w-2/5 min-w-0">
            <p className="font-bold text-lg sm:text-xl break-words">
              {prediction.awayTeam || 'Away team unavailable'}
            </p>
            <p className="text-xs text-gray-500 mt-1">Away</p>
          </div>
        </div>

        <div className="bg-gray-900/70 p-3 rounded-lg border border-gray-700 flex justify-between items-center gap-3">
          <div className="min-w-0">
            <p className="text-xs text-gray-500 uppercase tracking-wider">
              Best market
            </p>
            <p className="text-sm text-white font-bold mt-1 break-words">
              {bestMarket}
            </p>
          </div>

          <div className="text-right shrink-0">
            <p className="text-xs text-gray-500 uppercase tracking-wider">
              Confidence
            </p>
            <span className="text-xl sm:text-2xl font-mono text-emerald-400">
              {confidence === null ? 'N/A' : `${confidence}%`}
            </span>
          </div>
        </div>

        <p className="text-xs text-gray-500 mt-3">
          {formatDate(prediction.date)}
        </p>
      </button>
    );
  };

  const renderDaySection = (dayName) => {
    const dayData = groupedMatches[dayName];

    if (!dayData) return null;

    const showFootball = pageFilter !== 'basketball';
    const showBasketball = pageFilter !== 'football';

    return (
      <section key={dayName}>
        <h3 className="text-xl font-semibold mb-6 border-l-4 border-emerald-500 pl-3">
          {dayName} — {formatDate(dayData.date)}
          {isToday(dayData.date) && (
            <span className="ml-2 text-xs text-emerald-400">
              TODAY
            </span>
          )}
        </h3>

        {dayData.matches.length === 0 ? (
          <p className="text-gray-500 text-center py-5 bg-gray-800/50 rounded-lg border border-gray-800">
            No matches supplied by the server for this day.
          </p>
        ) : (
          <div className="space-y-8">
            {showFootball && (
              <div>
                <h4 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">
                  FOOTBALL — {dayData.football.length} MATCHES
                </h4>

                {dayData.football.length === 0 ? (
                  <p className="text-gray-500 text-sm text-center py-3 bg-gray-800/30 rounded">
                    No football fixtures returned for this day.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {dayData.football.map(renderMatchCard)}
                  </div>
                )}
              </div>
            )}

            {showBasketball && (
              <div>
                <h4 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">
                  BASKETBALL — {dayData.basketball.length} MATCHES
                </h4>

                {dayData.basketball.length === 0 ? (
                  <p className="text-gray-500 text-sm text-center py-3 bg-gray-800/30 rounded">
                    No basketball fixtures returned for this day.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {dayData.basketball.map(renderMatchCard)}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>
    );
  };

  const pageTitle = {
    all: 'WEEKLY MATCH FIXTURES & AI PREDICTIONS',
    football: 'FOOTBALL FIXTURES & AI PREDICTIONS',
    basketball: 'BASKETBALL FIXTURES & AI PREDICTIONS',
    today: "TODAY'S MATCHES & AI PREDICTIONS",
    motd: 'MATCH OF THE DAY',
    value: 'VALUE OPPORTUNITIES',
  }[pageFilter] || 'MATCH FIXTURES & AI PREDICTIONS';

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <nav className="bg-gray-950 border-b border-gray-800 p-4 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex flex-col lg:flex-row justify-between items-center gap-4">
          <button
            type="button"
            onClick={() => onNavigate('Dashboard')}
            className="text-xl font-bold text-emerald-400 tracking-wider"
          >
            MATCH INTELLIGENCE AI
          </button>

          <ul className="flex flex-wrap justify-center gap-x-5 gap-y-3 text-sm text-gray-400">
            {[
              ['Dashboard', 'all'],
              ['Football', 'football'],
              ['Basketball', 'basketball'],
              ["Today's Matches", 'today'],
              ['Match of the Day', 'motd'],
              ['Value Opportunities', 'value'],
            ].map(([label, filter]) => (
              <li key={label}>
                <button
                  type="button"
                  onClick={() => onNavigate(label)}
                  className={`hover:text-emerald-400 ${
                    pageFilter === filter
                      ? 'text-emerald-400 border-b-2 border-emerald-400 pb-1'
                      : ''
                  }`}
                >
                  {label}
                </button>
              </li>
            ))}

            <li>
              <button
                type="button"
                onClick={() => onNavigate('History')}
                className="hover:text-emerald-400"
              >
                History
              </button>
            </li>

            <li>
              <button
                type="button"
                onClick={() => onNavigate('Analytics')}
                className="hover:text-emerald-400"
              >
                Analytics
              </button>
            </li>

            <li>
              <button
                type="button"
                onClick={() => onNavigate('Settings')}
                className="hover:text-emerald-400"
              >
                Settings
              </button>
            </li>
          </ul>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto p-4 sm:p-6">
        <div className="mb-6 p-3 bg-yellow-900/30 border border-yellow-800 rounded-lg text-yellow-200 text-xs text-center">
          Responsible betting notice: predictions are estimates based on
          available data, not guarantees. Never risk money you cannot afford
          to lose.
        </div>

        <div className="mb-6 flex flex-col md:flex-row gap-4 items-center justify-between bg-gray-800 p-4 rounded-xl border border-gray-700">
          <div className="relative w-full md:w-2/3">
            <input
              type="search"
              placeholder="Search any team, match, or league..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="w-full bg-gray-900 text-white rounded-lg py-3 pl-4 pr-4 border border-gray-700 focus:border-emerald-500 outline-none"
              aria-label="Search matches"
            />

            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-3 text-gray-400 hover:text-white text-xl"
                aria-label="Clear search"
              >
                &times;
              </button>
            )}
          </div>

          <div className="flex items-center justify-between md:justify-end gap-4 w-full md:w-auto">
            <div className="text-sm text-gray-400 md:text-right">
              <span className="block">
                {weekMatches.length}{' '}
                {weekMatches.length === 1 ? 'match' : 'matches'} displayed
              </span>

              {lastUpdated && (
                <span className="block text-xs text-gray-500 mt-1">
                  Updated {lastUpdated.toLocaleTimeString()}
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={() => fetchData(true)}
              disabled={refreshing}
              className="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 rounded-lg text-sm font-bold"
            >
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="mb-6 p-4 rounded-lg bg-red-950/60 border border-red-800 text-red-200"
          >
            <p className="font-semibold">Unable to update predictions</p>
            <p className="text-sm mt-1">{errorMessage}</p>
            <button
              type="button"
              onClick={() => fetchData(true)}
              className="mt-3 text-sm underline hover:text-white"
            >
              Try again
            </button>
          </div>
        )}

        <div className="mb-8 flex items-center justify-between gap-3 bg-gray-800 p-4 rounded-xl border border-gray-700">
          <button
            type="button"
            onClick={() => changeWeek(-1)}
            className="px-3 sm:px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm font-bold"
          >
            ← Previous
          </button>

          <div className="text-center min-w-0">
            <p className="text-sm text-gray-400">Selected week</p>
            <p className="font-bold text-emerald-400 text-sm sm:text-base">
              {formatDate(currentWeekStart)}
            </p>
            <p className="text-xs text-gray-500">
              to {formatDate(new Date(weekEnd.getTime() - 86400000))}
            </p>
          </div>

          <button
            type="button"
            onClick={() => changeWeek(1)}
            className="px-3 sm:px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm font-bold"
          >
            Next →
          </button>
        </div>

        <button
          type="button"
          onClick={() => setCurrentWeekStart(getMonday(new Date()))}
          className="mb-8 mx-auto block text-xs text-blue-400 hover:text-blue-300 underline"
        >
          Return to current week
        </button>

        <h2 className="text-xl sm:text-2xl font-bold mb-6 text-white text-center border-b border-gray-800 pb-4">
          {pageTitle}
        </h2>

        {loading && predictions.length === 0 ? (
          <div className="text-center py-16">
            <div className="animate-pulse text-emerald-400 text-lg font-semibold">
              Loading match predictions...
            </div>
            <p className="text-sm text-gray-500 mt-3">
              Waiting for the server to respond.
            </p>
          </div>
        ) : weekMatches.length === 0 ? (
          <div className="text-center py-12 px-4 bg-gray-800/50 rounded-xl border border-gray-800">
            <h3 className="text-lg font-semibold text-gray-200">
              No matching fixtures found
            </h3>
            <p className="text-sm text-gray-400 mt-2">
              The server may not have supplied fixtures for this selection,
              week, or search term.
            </p>
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="mt-4 text-emerald-400 underline"
              >
                Clear search
              </button>
            )}
          </div>
        ) : pageFilter === 'today' || pageFilter === 'motd' || pageFilter === 'value' ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {weekMatches.map(renderMatchCard)}
          </div>
        ) : (
          <div className="space-y-12">
            {DAYS_OF_WEEK.map(renderDaySection)}
          </div>
        )}

        <footer className="mt-12 border-t border-gray-800 pt-5 pb-6 text-center text-xs text-gray-500">
          Match Intelligence AI · Predictions depend on the data returned by
          the connected providers.
        </footer>
      </main>

      {selectedMatch && (
        <div
          className="fixed inset-0 bg-black/80 flex justify-center items-center z-[100] p-3 sm:p-4"
          onClick={() => setSelectedMatch(null)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="match-dialog-title"
            className="bg-gray-800 rounded-xl shadow-lg p-5 sm:p-6 border border-gray-700 max-w-2xl w-full relative max-h-[90vh] overflow-y-auto"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="absolute top-3 right-4 text-gray-400 hover:text-white text-2xl"
              onClick={() => setSelectedMatch(null)}
              aria-label="Close match details"
            >
              &times;
            </button>

            <div className="text-center mb-6 border-b border-gray-700 pb-4 pr-6 pl-6">
              <span className="text-xs font-semibold bg-blue-900 text-blue-300 px-2 py-1 rounded">
                {selectedMatch.league || 'League unavailable'}
              </span>

              <h2
                id="match-dialog-title"
                className="text-2xl sm:text-3xl font-bold mt-3"
              >
                {selectedMatch.homeTeam || 'Home team'} vs{' '}
                {selectedMatch.awayTeam || 'Away team'}
              </h2>

              <p className="text-gray-400 text-sm mt-2">
                {formatDate(selectedMatch.date)} ·{' '}
                {formatTime(selectedMatch.date)}
              </p>

              <p className="text-xs text-gray-500 mt-1">
                Status: {getStatus(selectedMatch)}
              </p>
            </div>

            <div className="mb-6">
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-3">
                Most probable scorelines
              </h3>

              {Array.isArray(selectedMatch.topCorrectScores) &&
              selectedMatch.topCorrectScores.length > 0 ? (
                <div className="grid grid-cols-1 gap-2">
                  {selectedMatch.topCorrectScores.map((score, index) => (
                    <div
                      key={`${score.score || 'score'}-${index}`}
                      className="bg-gray-900 p-3 rounded text-sm flex justify-between gap-3 border border-gray-700"
                    >
                      <span className="text-gray-400">
                        Score:{' '}
                        <b className="text-white">
                          {score.score || 'Unavailable'}
                        </b>
                      </span>

                      <span className="text-emerald-400 font-bold">
                        {Number.isFinite(Number(score.probability))
                          ? `${score.probability}%`
                          : 'N/A'}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500 bg-gray-900 p-3 rounded">
                  No correct-score probabilities were supplied by the server.
                </p>
              )}
            </div>

            <div className="mb-6">
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-3">
                Market probabilities
              </h3>

              {getMarkets(selectedMatch).length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {getMarkets(selectedMatch).map((market, index) => (
                    <div
                      key={`${market.market}-${market.selection}-${index}`}
                      className="bg-gray-900 p-3 rounded text-xs border border-gray-700"
                    >
                      <p className="text-gray-400">{market.market}</p>
                      <div className="flex justify-between items-start gap-2 mt-2">
                        <span className="text-white font-bold">
                          {market.selection}
                        </span>
                        <span className="text-emerald-400 font-bold">
                          {Math.max(
                            0,
                            Math.min(100, Number(market.probability))
                          )}
                          %
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500 bg-gray-900 p-3 rounded">
                  No market probabilities were supplied by the server.
                </p>
              )}
            </div>

            <div className="bg-blue-900/20 border border-blue-800 p-4 rounded-lg">
              <p className="text-xs text-blue-300 uppercase tracking-wider mb-2">
                AI tactical analysis
              </p>

              <p className="text-sm text-gray-300">
                {selectedMatch.aiExplanation ||
                  'No tactical explanation was supplied by the backend for this match.'}
              </p>
            </div>

            <div className="mt-4 text-xs text-gray-500">
              Confidence is an estimate, not a guarantee of the outcome.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
