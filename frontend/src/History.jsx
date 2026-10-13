import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ||
  'https://match-intelligence-ai.onrender.com'
).replace(/\/+$/, '');

function formatScore(score) {
  if (score === null || score === undefined || score === '') {
    return 'Unavailable';
  }

  if (typeof score === 'object') {
    const home = score.home ?? score.homeScore;
    const away = score.away ?? score.awayScore;

    if (home !== undefined && away !== undefined) {
      return `${home} - ${away}`;
    }

    return 'Unavailable';
  }

  return String(score);
}

function formatDate(value) {
  if (!value || Number.isNaN(new Date(value).getTime())) {
    return 'Date unavailable';
  }

  return new Date(value).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function normalizeHistory(data) {
  if (Array.isArray(data?.history)) {
    return data.history;
  }

  if (Array.isArray(data)) {
    return data;
  }

  throw new Error('The server did not return a valid history list.');
}

export default function History({ onNavigate = () => {} }) {
  const [history, setHistory] = useState([]);
  const [accuracy, setAccuracy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const fetchHistory = useCallback(async (manual = false) => {
    if (manual) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const response = await axios.get(
        `${API_BASE_URL}/api/history`,
        {
          timeout: 20000,
          headers: { Accept: 'application/json' },
        }
      );

      const records = normalizeHistory(response.data);

      setHistory(records);

      const accuracyValue = Number(response.data?.accuracy);

      setAccuracy(
        response.data?.accuracy !== null &&
        response.data?.accuracy !== undefined &&
        response.data?.accuracy !== '' &&
        Number.isFinite(accuracyValue)
          ? Math.max(0, Math.min(100, accuracyValue))
          : null
      );

      setErrorMessage('');
    } catch (error) {
      console.error('Failed to load prediction history:', error);

      if (error.response) {
        setErrorMessage(
          `The server returned HTTP ${error.response.status}. Please try again.`
        );
      } else if (error.code === 'ECONNABORTED') {
        setErrorMessage(
          'The history request timed out. Please try again.'
        );
      } else {
        setErrorMessage(
          'Unable to connect to the history server. Check your connection and backend deployment.'
        );
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const finishedCount = history.length;

  const correctCount = history.filter(
    (match) => match.isCorrect === true
  ).length;

  const incorrectCount = history.filter(
    (match) => match.isCorrect === false
  ).length;

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <nav className="bg-gray-950 border-b border-gray-800 p-4 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4">
          <button
            type="button"
            onClick={() => onNavigate('Dashboard')}
            className="text-xl font-bold text-emerald-400 tracking-wider"
          >
            MATCH INTELLIGENCE AI
          </button>

          <ul className="flex flex-wrap justify-center gap-5 text-sm text-gray-400">
            <li>
              <button
                type="button"
                onClick={() => onNavigate('Dashboard')}
                className="hover:text-emerald-400"
              >
                Dashboard
              </button>
            </li>

            <li>
              <button
                type="button"
                onClick={() => onNavigate('Football')}
                className="hover:text-emerald-400"
              >
                Football
              </button>
            </li>

            <li>
              <button
                type="button"
                onClick={() => onNavigate('Basketball')}
                className="hover:text-emerald-400"
              >
                Basketball
              </button>
            </li>

            <li>
              <button
                type="button"
                onClick={() => onNavigate('History')}
                className="text-emerald-400 border-b-2 border-emerald-400 pb-1"
              >
                History
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
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h2 className="text-2xl font-bold text-emerald-400">
              Prediction History
            </h2>

            <p className="text-sm text-gray-400 mt-2">
              Review recorded match predictions and their actual outcomes.
            </p>
          </div>

          <button
            type="button"
            onClick={() => fetchHistory(true)}
            disabled={refreshing}
            className="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 rounded-lg font-semibold text-sm"
          >
            {refreshing ? 'Refreshing...' : 'Refresh history'}
          </button>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="mb-6 p-4 rounded-lg bg-red-950/60 border border-red-800 text-red-200"
          >
            <p className="font-semibold">
              Could not load prediction history
            </p>

            <p className="text-sm mt-1">{errorMessage}</p>

            <button
              type="button"
              onClick={() => fetchHistory(true)}
              className="mt-3 underline text-sm hover:text-white"
            >
              Try again
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="bg-gray-800 p-5 rounded-xl border border-gray-700">
            <p className="text-gray-400 text-xs uppercase tracking-wider">
              Recorded matches
            </p>

            <p className="text-3xl font-bold text-white mt-2">
              {finishedCount}
            </p>
          </div>

          <div className="bg-gray-800 p-5 rounded-xl border border-gray-700">
            <p className="text-gray-400 text-xs uppercase tracking-wider">
              Overall accuracy
            </p>

            <p className="text-3xl font-bold text-emerald-400 mt-2">
              {accuracy === null ? 'N/A' : `${accuracy}%`}
            </p>
          </div>

          <div className="bg-gray-800 p-5 rounded-xl border border-gray-700">
            <p className="text-gray-400 text-xs uppercase tracking-wider">
              Correct predictions
            </p>

            <p className="text-3xl font-bold text-emerald-400 mt-2">
              {correctCount}
            </p>
          </div>

          <div className="bg-gray-800 p-5 rounded-xl border border-gray-700">
            <p className="text-gray-400 text-xs uppercase tracking-wider">
              Incorrect predictions
            </p>

            <p className="text-3xl font-bold text-red-400 mt-2">
              {incorrectCount}
            </p>
          </div>
        </div>

        <div className="mb-5">
          <h3 className="text-lg font-bold text-white">
            Completed match results
          </h3>

          <p className="text-xs text-gray-500 mt-1">
            Accuracy is only meaningful when predictions are compared with
            verified final results.
          </p>
        </div>

        {loading && history.length === 0 ? (
          <div className="text-center py-16 bg-gray-800/50 rounded-xl border border-gray-800">
            <p className="text-emerald-400 font-semibold animate-pulse">
              Loading prediction history...
            </p>

            <p className="text-sm text-gray-500 mt-2">
              Connecting to the history server.
            </p>
          </div>
        ) : !errorMessage && history.length === 0 ? (
          <div className="text-center py-14 px-4 bg-gray-800/50 rounded-xl border border-gray-800">
            <h3 className="text-lg font-semibold text-gray-200">
              No finished matches recorded yet
            </h3>

            <p className="text-sm text-gray-400 mt-2">
              Completed matches will appear here when your backend records
              their verified results and settles the predictions.
            </p>

            <button
              type="button"
              onClick={() => onNavigate('Dashboard')}
              className="mt-5 px-4 py-2 bg-emerald-700 hover:bg-emerald-600 rounded-lg text-sm font-semibold"
            >
              Return to dashboard
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {history.map((match, index) => {
              const hasResult = typeof match.isCorrect === 'boolean';

              const resultClasses = !hasResult
                ? 'bg-gray-700 text-gray-300'
                : match.isCorrect
                  ? 'bg-emerald-900 text-emerald-300'
                  : 'bg-red-900 text-red-300';

              const resultLabel = !hasResult
                ? 'UNSETTLED'
                : match.isCorrect
                  ? 'CORRECT'
                  : 'INCORRECT';

              return (
                <article
                  key={
                    match.fixtureId ??
                    match.id ??
                    `${match.homeTeam}-${match.awayTeam}-${index}`
                  }
                  className="bg-gray-800 p-4 sm:p-5 rounded-xl border border-gray-700"
                >
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
                    <div className="min-w-0">
                      <p className="font-bold text-lg break-words">
                        {match.homeTeam || 'Home team'} vs{' '}
                        {match.awayTeam || 'Away team'}
                      </p>

                      <p className="text-xs text-gray-400 mt-1">
                        {match.league || 'League unavailable'}
                        {' · '}
                        {formatDate(match.date)}
                      </p>

                      <div className="text-sm text-gray-300 mt-3 space-y-1">
                        <p>
                          <span className="text-gray-500">
                            Predicted outcome:{' '}
                          </span>
                          {match.predictedWinner || 'Not recorded'}
                        </p>

                        <p>
                          <span className="text-gray-500">
                            Actual score:{' '}
                          </span>
                          {formatScore(match.actualScore)}
                        </p>

                        <p>
                          <span className="text-gray-500">
                            Actual outcome:{' '}
                          </span>
                          {match.actualWinner || 'Not recorded'}
                        </p>
                      </div>
                    </div>

                    <span
                      className={`self-start shrink-0 px-3 py-2 rounded-lg font-bold text-xs ${resultClasses}`}
                    >
                      {resultLabel}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <footer className="mt-10 pt-5 border-t border-gray-800 text-center text-xs text-gray-500">
          Match Intelligence AI · Historical accuracy reflects recorded
          outcomes and is not a guarantee of future performance.
        </footer>
      </main>
    </div>
  );
}
