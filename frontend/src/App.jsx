import { useState } from 'react';
import Dashboard from './Dashboard';
import History from './History';
import Settings from './Settings';

function App() {
  const [currentPage, setCurrentPage] = useState('Dashboard');

  const renderPage = () => {
    if (currentPage === 'History') return <History onNavigate={setCurrentPage} />;
    if (currentPage === 'Settings') return <Settings onNavigate={setCurrentPage} />;
    
    // For all other pages, we pass the filter to the Dashboard
    let filter = 'all';
    if (currentPage === 'Football') filter = 'football';
    else if (currentPage === 'Basketball') filter = 'basketball';
    else if (currentPage === "Today's Matches") filter = 'today';
    else if (currentPage === 'Match of the Day') filter = 'motd';
    else if (currentPage === 'Value Opportunities') filter = 'value';

    return <Dashboard onNavigate={setCurrentPage} pageFilter={filter} />;
  };

  return <div>{renderPage()}</div>;
}

export default App;
