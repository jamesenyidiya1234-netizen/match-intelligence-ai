
import { useState } from 'react';
import Dashboard from './Dashboard';
import History from './History';
import Settings from './Settings';

const PAGE_FILTERS = {
  Dashboard: 'all',
  Football: 'football',
  Basketball: 'basketball',
  "Today's Matches": 'today',
  'Match of the Day': 'motd',
  'Value Opportunities': 'value',
};

function App() {
  const [currentPage, setCurrentPage] = useState('Dashboard');

  if (currentPage === 'History') {
    return <History onNavigate={setCurrentPage} />;
  }

  if (currentPage === 'Settings') {
    return <Settings onNavigate={setCurrentPage} />;
  }

  const pageFilter = PAGE_FILTERS[currentPage];

  if (!pageFilter) {
    return (
      <main className="min-h-screen bg-gray-900 p-8 text-white">
        <h1 className="text-xl font-bold">Page not found</h1>
        <button
          type="button"
          onClick={() => setCurrentPage('Dashboard')}
          className="mt-4 rounded bg-emerald-600 px-4 py-2"
        >
          Return to Dashboard
        </button>
      </main>
    );
  }

  return (
    <Dashboard
      onNavigate={setCurrentPage}
      pageFilter={pageFilter}
    />
  );
}

export default App;
