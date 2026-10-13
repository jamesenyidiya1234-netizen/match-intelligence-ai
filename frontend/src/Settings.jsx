import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ||
  'https://match-intelligence-ai.onrender.com'
).replace(/\/+$/, '');

export default function Settings({ onNavigate = () => {} }) {
  const [serverStatus, setServerStatus] = useState('checking');
  const [lastChecked, setLastChecked] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [checking, setChecking] = useState(false);

  const checkServer = useCallback(async () => {
    setChecking(true);
    setErrorMessage('');

    try {
      // This checks the predictions endpoint because it is already
      // used by the Dashboard. It does not prove every background
      // automation job or data provider is working.
      const response = await axios.get(
        `${API_BASE_URL}/api/predictions`,
        {
          timeout: 20000,
          headers: { Accept: 'application/json' },
        }
      );

      if (
        !Array.isArray(response.data?.predictions) &&
        !Array.isArray(response.data)
      ) {
        setServerStatus('warning');
        setErrorMessage(
          'The server responded, but the predictions response has an unexpected format.'
        );
      } else {
        setServerStatus('online');
      }

      setLastChecked(new Date());
    } catch (error) {
      console.error('Backend health check failed:', error);

      setServerStatus('offline');
      setLastChecked(new Date());

      if (error.response) {
        setErrorMessage(
          `The server returned HTTP ${error.response.status}.`
        );
      } else if (error.code === 'ECONNABORTED') {
        setErrorMessage(
          'The server did not respond before the request timed out.'
        );
      } else {
        setErrorMessage(
          'Could not connect to the backend. Check the Render service, URL, and network connection.'
        );
      }
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    checkServer();
  }, [checkServer]);

  const statusDetails = {
    checking: {
      label: 'Checking connection',
      description: 'Testing the backend connection...',
      classes: 'bg-yellow-900/40 border-yellow-800 text-yellow-300',
      dot: 'bg-yellow-400',
    },
    online: {
      label: 'Backend responding',
      description: 'The predictions endpoint responded successfully.',
      classes: 'bg-emerald-900/30 border-emerald-800 text-emerald-300',
      dot: 'bg-emerald-400',
    },
    warning: {
      label: 'Response needs attention',
      description: 'The server responded, but its data format may need checking.',
      classes: 'bg-yellow-900/40 border-yellow-800 text-yellow-300',
      dot: 'bg-yellow-400',
    },
    offline: {
      label: 'Connection failed',
      description: 'The backend could not be reached successfully.',
      classes: 'bg-red-900/30 border-red-800 text-red-300',
      dot: 'bg-red-400',
    },
  };

  const currentStatus = statusDetails[serverStatus];

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
                className="hover:text-emerald-400"
              >
                History
              </button>
            </li>

            <li>
              <button
                type="button"
                onClick={() => onNavigate('Settings')}
                className="text-emerald-400 border-b-2 border-emerald-400 pb-1"
              >
                Settings
              </button>
            </li>
          </ul>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto p-4 sm:p-6">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-emerald-400">
            System Settings
          </h2>

          <p className="text-gray-400 text-sm mt-2">
            Monitor the backend connection and review your deployment
            configuration.
          </p>
        </div>

        <section className="bg-gray-800 p-5 sm:p-6 rounded-xl border border-gray-700 mb-6">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
            <div>
              <h3 className="font-bold text-lg">Backend Connection</h3>

              <p className="text-gray-400 text-sm mt-2">
                This check requests data from the predictions endpoint.
              </p>
            </div>

            <button
              type="button"
              onClick={checkServer}
              disabled={checking}
              className="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 rounded-lg font-semibold text-sm"
            >
              {checking ? 'Checking...' : 'Check connection'}
            </button>
          </div>

          <div className={`mt-5 p-4 rounded-lg border ${currentStatus.classes}`}>
            <div className="flex items-center gap-3">
              <span
                className={`w-3 h-3 rounded-full shrink-0 ${currentStatus.dot} ${
                  serverStatus === 'checking' ? 'animate-pulse' : ''
                }`}
              />

              <div>
                <p className="font-bold">{currentStatus.label}</p>
                <p className="text-sm mt-1">
                  {currentStatus.description}
                </p>
              </div>
            </div>

            {errorMessage && (
              <p className="text-sm mt-3 break-words">
                {errorMessage}
              </p>
            )}

            {lastChecked && (
              <p className="text-xs mt-3 opacity-80">
                Last checked: {lastChecked.toLocaleString()}
              </p>
            )}
          </div>
        </section>

        <section className="bg-gray-800 p-5 sm:p-6 rounded-xl border border-gray-700 mb-6">
          <h3 className="font-bold text-lg mb-3">Deployment Configuration</h3>

          <p className="text-gray-400 text-sm mb-4">
            Your frontend connects to the backend URL configured below.
            This page does not expose or edit secret API keys.
          </p>

          <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">
              Backend address
            </p>

            <p className="text-sm text-emerald-300 break-all">
              {API_BASE_URL}
            </p>
          </div>

          <p className="text-xs text-gray-500 mt-4">
            Set VITE_API_BASE_URL in your frontend environment configuration
            if your backend uses a different address. Restart or redeploy
            the frontend after changing it.
          </p>
        </section>

        <section className="bg-gray-800 p-5 sm:p-6 rounded-xl border border-gray-700 mb-6">
          <h3 className="font-bold text-lg mb-3">API Key Security</h3>

          <p className="text-gray-400 text-sm leading-6">
            Store provider API keys as environment variables in your backend
            hosting service, such as Render. Do not place private keys in
            frontend source code or variables beginning with VITE_, because
            frontend values can be visible to visitors.
          </p>

          <p className="text-gray-400 text-sm leading-6 mt-3">
            This page does not verify that SportMonks, a basketball data
            provider, or any other external API is connected. Those services
            require separate backend checks.
          </p>
        </section>

        <section className="bg-gray-800 p-5 sm:p-6 rounded-xl border border-gray-700">
          <h3 className="font-bold text-lg mb-3">Automation Status</h3>

          <p className="text-gray-400 text-sm leading-6">
            A successful backend response confirms only that the tested
            endpoint responded. It does not prove that scheduled jobs,
            fixture collection, prediction generation, database persistence,
            or final-score settlement are running continuously.
          </p>

          <p className="text-gray-400 text-sm leading-6 mt-3">
            To verify unattended automation, the backend needs a real health
            endpoint and job-status reporting that confirms the last
            successful fixture update and prediction run.
          </p>
        </section>

        <footer className="mt-10 pt-5 border-t border-gray-800 text-center text-xs text-gray-500">
          Match Intelligence AI · System status is based on the checks
          available to this page.
        </footer>
      </main>
    </div>
  );
}
