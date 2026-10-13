
import { useState } from 'react';
import axios from 'axios';

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:5001'
).replace(/\/+$/, '');

const PROVIDERS = [
  { value: 'sportmonks', label: 'SportMonks — Football' },
  { value: 'api-sports-football', label: 'API-Sports — Football' },
  { value: 'api-sports-basketball', label: 'API-Sports — Basketball' },
];

export default function Admin() {
  const [provider, setProvider] = useState('sportmonks');
  const [apiKey, setApiKey] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('idle');

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!apiKey.trim()) {
      setMessage('Please enter your API key.');
      setStatus('error');
      return;
    }

    setStatus('loading');
    setMessage('Connecting to the backend...');

    try {
      const response = await axios.post(
        `${API_BASE_URL}/api/admin/connect-api`,
        {
          provider,
          apiKey: apiKey.trim(),
        },
        {
          timeout: 15000,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      setMessage(
        response.data?.message ||
          'The server accepted the request.'
      );
      setApiKey('');
      setStatus('success');
    } catch (error) {
      const serverMessage =
        error.response?.data?.message ||
        error.response?.data?.error;

      setMessage(
        serverMessage ||
          (error.code === 'ECONNABORTED'
            ? 'The request timed out. Please try again.'
            : 'Unable to connect. Check the backend URL and server logs.')
      );
      setStatus('error');
    }
  };

  return (
    <main className="min-h-screen bg-gray-900 text-white p-6 md:p-8 flex flex-col items-center">
      <h1 className="text-2xl font-bold mb-6 text-emerald-400">
        Admin Dashboard
      </h1>

      <section className="bg-gray-800 p-6 rounded-lg shadow-lg w-full max-w-md">
        <h2 className="text-xl font-semibold mb-4">
          Connect Data Source
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="provider"
              className="block text-sm mb-1 text-gray-300"
            >
              API Provider
            </label>

            <select
              id="provider"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="w-full p-3 bg-gray-700 rounded text-white"
              disabled={status === 'loading'}
            >
              {PROVIDERS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="apiKey"
              className="block text-sm mb-1 text-gray-300"
            >
              API Key
            </label>

            <input
              id="apiKey"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full p-3 bg-gray-700 rounded text-white"
              placeholder="Enter your API key"
              autoComplete="off"
              required
              disabled={status === 'loading'}
            />
          </div>

          <button
            type="submit"
            disabled={status === 'loading'}
            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 py-3 rounded font-bold transition"
          >
            {status === 'loading'
              ? 'Connecting...'
              : 'Connect Data Source'}
          </button>
        </form>

        {message && (
          <p
            role="status"
            aria-live="polite"
            className={`mt-4 text-sm break-words ${
              status === 'error'
                ? 'text-red-400'
                : status === 'success'
                ? 'text-emerald-400'
                : 'text-gray-300'
            }`}
          >
            {message}
          </p>
        )}

        <p className="mt-4 text-xs text-gray-400">
          API credentials must be validated and stored securely by
          the backend. Never expose them in frontend code or logs.
        </p>
      </section>
    </main>
  );
}
