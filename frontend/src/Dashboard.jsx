import { useState, useEffect } from 'react';
import axios from 'axios';

export default function Dashboard({ onNavigate, pageFilter = 'all' }) {
  const [predictions, setPredictions] = useState([]);
  const [selectedMatch, setSelectedMatch] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentWeekStart, setCurrentWeekStart] = useState(getMonday(new Date()));

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await axios.get('https://match-intelligence-ai.onrender.com/api/predictions');
        setPredictions(res.data.predictions);
      } catch (err) {
        console.error("API Error:", err);
        setPredictions([]);
      }
    };
    
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  function getMonday(d) {
    d = new Date(d);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
  }

  function formatDate(date) {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    return date.toLocaleDateString('en-US', options).toUpperCase();
  }

  let filteredPredictions = [...predictions];

  if (pageFilter === 'football') filteredPredictions = filteredPredictions.filter(p => p.sport === 'football');
  else if (pageFilter === 'basketball') filteredPredictions = filteredPredictions.filter(p => p.sport === 'basketball');
  else if (pageFilter === 'motd') filteredPredictions = filteredPredictions.sort((a, b) => b.confidenceScore - a.confidenceScore).slice(0, 1);
  else if (pageFilter === 'value') filteredPredictions = filteredPredictions.filter(p => p.bestMarketString?.includes('Over') || p.bestMarketString?.includes('BTTS'));

  if (searchQuery.trim() !== '') {
    const q = searchQuery.toLowerCase();
    filteredPredictions = filteredPredictions.filter(p => {
      const home = p.homeTeam?.toLowerCase() || '';
      const away = p.awayTeam?.toLowerCase() || '';
      const league = p.league?.toLowerCase() || '';
      return home.includes(q) || away.includes(q) || league.includes(q) || (home + ' vs ' + away).includes(q) || (away + ' vs ' + home).includes(q);
    });
  }

  const weekEnd = new Date(currentWeekStart);
  weekEnd.setDate(currentWeekStart.getDate() + 7);

  const weekMatches = filteredPredictions.filter(p => {
    const matchDate = new Date(p.date);
    return matchDate >= currentWeekStart && matchDate < weekEnd;
  });

  const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const groupedMatches = {};

  daysOfWeek.forEach((dayName, index) => {
    const dayDate = new Date(currentWeekStart);
    dayDate.setDate(currentWeekStart.getDate() + index);
    const dateString = dayDate.toDateString();
    
    groupedMatches[dayName] = {
      date: formatDate(dayDate),
      matches: weekMatches.filter(p => new Date(p.date).toDateString() === dateString)
                           .sort((a,b) => new Date(a.date) - new Date(b.date))
    };
  });

  const changeWeek = (weeks) => {
    const newDate = new Date(currentWeekStart);
    newDate.setDate(newDate.getDate() + (weeks * 7));
    setCurrentWeekStart(newDate);
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <nav className="bg-gray-950 border-b border-gray-800 p-4 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <h1 className="text-xl font-bold text-emerald-400 tracking-wider">MATCH INTELLIGENCE AI</h1>
          <ul className="hidden md:flex gap-6 text-sm text-gray-400">
            <li className={`hover:text-emerald-400 cursor-pointer ${pageFilter === 'all' ? 'border-b-2 border-emerald-400 pb-1' : ''}`} onClick={() => onNavigate('Dashboard')}>Dashboard</li>
            <li className={`hover:text-white cursor-pointer ${pageFilter === 'football' ? 'border-b-2 border-emerald-400 pb-1' : ''}`} onClick={() => onNavigate('Football')}>Football</li>
            <li className={`hover:text-white cursor-pointer ${pageFilter === 'basketball' ? 'border-b-2 border-emerald-400 pb-1' : ''}`} onClick={() => onNavigate('Basketball')}>Basketball</li>
            <li className={`hover:text-white cursor-pointer ${pageFilter === 'motd' ? 'border-b-2 border-emerald-400 pb-1' : ''}`} onClick={() => onNavigate('Match of the Day')}>Match of the Day</li>
            <li className={`hover:text-white cursor-pointer ${pageFilter === 'value' ? 'border-b-2 border-emerald-400 pb-1' : ''}`} onClick={() => onNavigate('Value Opportunities')}>Value Opportunities</li>
            <li className="hover:text-white cursor-pointer" onClick={() => onNavigate('History')}>History</li>
            <li className="hover:text-white cursor-pointer" onClick={() => onNavigate('Analytics')}>Analytics</li>
            <li className="hover:text-white cursor-pointer" onClick={() => onNavigate('Settings')}>Settings</li>
          </ul>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto p-6">
        <div className="mb-8 p-3 bg-yellow-900/30 border border-yellow-800 rounded text-yellow-200 text-xs text-center">
          ⚠️ Responsible Betting Notice: Sports predictions are probabilities, not guarantees.
        </div>

        <div className="mb-8 flex flex-col md:flex-row gap-4 items-center justify-between bg-gray-800 p-4 rounded-xl border border-gray-700">
          <div className="relative w-full md:w-2/3">
            <input type="text" placeholder="Search any team, match, or league..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-gray-900 text-white rounded-lg py-3 pl-10 pr-4 border border-gray-700 focus:border-emerald-500 outline-none transition" />
            <svg className="absolute left-3 top-3.5 h-5 w-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            {searchQuery && (<button onClick={() => setSearchQuery('')} className="absolute right-3 top-3.5 text-gray-500 hover:text-white text-xl">&times;</button>)}
          </div>
          <div className="text-sm text-gray-400">{weekMatches.length} {weekMatches.length === 1 ? 'match' : 'matches'} this week</div>
        </div>

        <div className="mb-8 flex items-center justify-between bg-gray-800 p-4 rounded-xl border border-gray-700">
          <button onClick={() => changeWeek(-1)} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm font-bold">← Previous Week</button>
          <div className="text-center">
            <p className="text-sm text-gray-400">Selected Week</p>
            <p className="font-bold text-emerald-400">{formatDate(currentWeekStart)}</p>
          </div>
          <button onClick={() => changeWeek(1)} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm font-bold">Next Week →</button>
        </div>
        
        <button onClick={() => setCurrentWeekStart(getMonday(new Date()))} className="mb-8 mx-auto block text-xs text-blue-400 hover:text-blue-300 underline">Return to Current Week</button>

        <h2 className="text-2xl font-bold mb-6 text-white text-center border-b border-gray-800 pb-4">WEEKLY MATCH FIXTURES & AI PREDICTIONS</h2>

        <div className="space-y-12">
          {daysOfWeek.map((dayName) => {
            const dayData = groupedMatches[dayName];
            return (
              <div key={dayName}>
                <h3 className="text-xl font-semibold mb-6 border-l-4 border-emerald-500 pl-3">{dayName} — {dayData.date}</h3>
                
                {dayData.matches.length === 0 ? (
                  <p className="text-gray-500 text-center py-4 bg-gray-800/50 rounded-lg border border-gray-800">No matches scheduled for this day.</p>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {dayData.matches.map((pred) => (
                      <div key={pred.fixtureId} onClick={() => setSelectedMatch(pred)} className="bg-gray-800 rounded-xl shadow-lg p-5 border border-gray-700 hover:border-emerald-500 transition-all cursor-pointer">
                        <div className="flex justify-between items-center mb-4 border-b border-gray-700 pb-3">
                          <span className="text-xs text-gray-400 font-bold">{pred.league}</span>
                          <span className={`text-xs font-bold px-2 py-1 rounded ${pred.status === 'LIVE' ? 'bg-red-900 text-red-400 animate-pulse' : pred.status === 'FT' ? 'bg-gray-700 text-gray-400' : 'bg-emerald-900 text-emerald-400'}`}>
                            {new Date(pred.date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} - {pred.status || 'Scheduled'}
                          </span>
                        </div>
                        <div className="flex justify-between items-center mb-6">
                          <div className="text-left w-2/5"><p className="font-bold text-xl">{pred.homeTeam}</p><p className="text-xs text-gray-500 mt-1">Home</p></div>
                          <div className="text-center w-1/5">
                            <p className="text-xs mb-1 text-gray-400">{pred.actualScore ? 'Score' : 'Pred. Score'}</p>
                            <p className={`text-2xl font-bold px-3 py-1 rounded-lg border ${pred.actualScore ? 'bg-gray-900 border-red-700 text-red-400' : 'bg-gray-900 border-gray-700 text-white'}`}>
                              {pred.actualScore || pred.predictedScore || 'N/A'}
                            </p>
                          </div>
                          <div className="text-right w-2/5"><p className="font-bold text-xl">{pred.awayTeam}</p><p className="text-xs text-gray-500 mt-1">Away</p></div>
                        </div>
                        <div className="bg-gray-900/50 p-3 rounded-lg border border-gray-700 flex justify-between items-center">
                          <div><p className="text-xs text-gray-500 uppercase tracking-wider">Best Market</p><p className="text-sm text-white font-bold">{pred.bestMarketString || 'No reliable market'}</p></div>
                          <div className="text-right"><p className="text-xs text-gray-500 uppercase tracking-wider">Probability</p><span className="text-2xl font-mono text-emerald-400">{pred.confidenceScore || '0'}%</span></div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {selectedMatch && (
        <div className="fixed inset-0 bg-black/80 flex justify-center items-center z-[100] p-4" onClick={() => setSelectedMatch(null)}>
          <div className="bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-700 max-w-2xl w-full relative max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <button className="absolute top-4 right-4 text-gray-400 hover:text-white text-xl" onClick={() => setSelectedMatch(null)}>✕</button>
            <div className="text-center mb-6 border-b border-gray-700 pb-4">
              <span className="text-xs font-semibold bg-blue-900 text-blue-300 px-2 py-1 rounded">{selectedMatch.league}</span>
              <h2 className="text-3xl font-bold mt-3">{selectedMatch.homeTeam} vs {selectedMatch.awayTeam}</h2>
              <p className="text-gray-400 text-sm mt-1">{new Date(selectedMatch.date).toLocaleString()}</p>
            </div>
            <div className="mb-6">
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-3">Most Probable Scorelines</h3>
              <div className="grid grid-cols-1 gap-2">
                {selectedMatch.topCorrectScores?.map((s, i) => (
                  <div key={i} className="bg-gray-900 p-2 rounded text-sm flex justify-between border border-gray-700"><span className="text-gray-400">Score: <b className="text-white">{s.score}</b></span><span className="text-emerald-400 font-bold">{s.probability}%</span></div>
                ))}
              </div>
            </div>
            <div className="mb-6">
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-3">All Market Probabilities</h3>
              <div className="grid grid-cols-2 gap-2">
                {selectedMatch.allMarkets?.map((m, i) => (
                  <div key={i} className="bg-gray-900 p-2 rounded text-xs border border-gray-700"><p className="text-gray-400">{m.market}</p><div className="flex justify-between mt-1"><span className="text-white font-bold">{m.selection}</span><span className="text-emerald-400">{m.probability}%</span></div></div>
                ))}
              </div>
            </div>
            <div className="bg-blue-900/20 border border-blue-800 p-4 rounded-lg">
              <p className="text-xs text-blue-300 uppercase tracking-wider mb-1">AI Tactical Analysis</p>
              <p className="text-sm text-gray-300 italic">"{selectedMatch.aiExplanation}"</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
