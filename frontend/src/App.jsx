import { useState } from 'react';
import Dashboard from './Dashboard';
import History from './History';
import Settings from './Settings';

function App() {
  const [currentPage, setCurrentPage] = useState('Dashboard');

  const renderPage = () => {
    if (currentPage === 'History') return <History onNavigate={setCurrentPage} />;
    if (currentPage === 'Settings') return <Settings onNavigate={setCurrentPage} />;
    
    // All these pages will use the Dashboard, but pass a filter to it
    if (currentPage === 'Football') return <Dashboard onNavigate={setCurrentPage} pageFilter="football" />;
    if (currentPage === 'Basketball') return <Dashboard onNavigate={setCurrentPage} pageFilter="basketball" />;
    if (currentPage === 'Today\'s Matches') return <Dashboard onNavigate={setCurrentPage} pageFilter="today" />;
    if (currentPage === 'Match of the Day') return <Dashboard onNavigate={setCurrentPage} pageFilter="motd" />;
    if (currentPage === 'Value Opportunities') return <Dashboard onNavigate={setCurrentPage} pageFilter="value" />;
    
    // Default Dashboard
    return <Dashboard onNavigate={setCurrentPage} pageFilter="all" />;
  };

  return (
    <div>
      {renderPage()}
    </div>
  );
}

export default App;