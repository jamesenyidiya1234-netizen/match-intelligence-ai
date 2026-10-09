import { useState } from 'react';
import axios from 'axios';

export default function Admin() {
  const [provider, setProvider] = useState('sportmonks');
  const [apiKey, setApiKey] = useState('');
  const [message, setMessage] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage('Sending...');
    try {
     const res = await axios.post('http://localhost:5001/api/admin/connect-api', { provider, apiKey });
      setMessage(res.data.message);
    } catch (err) {
      setMessage('Error: ' + err.message);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8 flex flex-col items-center">
      <h1 className="text-2xl font-bold mb-6 text-emerald-400">Admin Dashboard</h1>
      <div className="bg-gray-800 p-6 rounded-lg shadow-lg w-full max-w-md">
        <h2 className="text-xl font-semibold mb-4">Connect Data Source</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm mb-1 text-gray-400">Provider Name</label>
            <input type="text" value={provider} onChange={(e) => setProvider(e.target.value)} className="w-full p-2 bg-gray-700 rounded text-white outline-none" />
          </div>
          <div>
            <label className="block text-sm mb-1 text-gray-400">API Key</label>
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="w-full p-2 bg-gray-700 rounded text-white outline-none" placeholder="Paste your SportMonks key" required />
          </div>
          <button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 py-2 rounded font-bold transition">Securely Save API Key</button>
        </form>
        <p className="mt-4 text-emerald-400 text-sm break-words">{message}</p>
      </div>
    </div>
  );
}