import { useState, useEffect } from 'react';
import axios from 'axios';

export default function Dashboard({ onNavigate, pageFilter = 'all' }) {
  const [predictions, setPredictions] = useState([]);
  const [selectedMatch, setSelectedMatch] = useState(null);

  useEffect(() => {
    axios.get('https://match-intelligence-ai.onrender.com/api/predictions') // Use your Render URL
      .then(res => setPredictions(res.data.predictions))
      .catch(err => console.error(err));
  }, []);

  let filteredPredictions = [...predictions];
  // ... (keep existing filters if you want, or simplify to 'all')
  
  const groupedMatches = filteredPredictions.reduce((acc, match) => {
    const dateStr = new Date(match.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    if (!acc[dateStr]) acc[dateStr] = [];
    acc[dateStr].push(match);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      
      <nav className="bg-gray-950 border-b border-gray-800 p-4 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <h1 className="text-xl font-bold text-emerald-400 tracking-wider">MATCH INTELLIGENCE AI</h1>
          <ul className="hidden md:flex gap-6 text-sm text-gray-400">
            <li className="hover:text-emerald-400 cursor-pointer border-b-2 border-emerald-400 pb-1" onClick={() => onNavigate('Dashboard')}>Dashboard</li>
            <li className="hover:text-white cursor-pointer" onClick={() => onNavigate('History')}>History</li>
            <li className="hover:text-white cursor-pointer" onClick={() => onNavigate('Settings')}>Settings</li>
          </ul>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto p-6">
        <div className="mb-8 p-3 bg-yellow-900/30 border border-yellow-800 rounded text-yellow-200 text-xs text-center">
          ⚠️ Responsible Betting Notice: Sports predictions are probabilities, not guarantees.
        </div>

        {Object.keys(groupedMatches).length === 0 ? (
          <p className="text-gray-400 text-center text-xl py-10">Loading real matches...</p>
        ) : (
          Object.keys(groupedMatches).map(dateStr => (
            <div key={dateStr} className="mb-12">
              <h3 className="text-xl font-semibold mb-6 border-l-4 border-emerald-500 pl-3">{dateStr}</h3>
              
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {groupedMatches[dateStr].map((pred) => (
                  
                  <div key={pred.fixtureId} onClick={() => setSelectedMatch(pred)} className="bg-gray-800 rounded-xl shadow-lg p-5 border border-gray-700 hover:border-emerald-500 transition-all cursor-pointer">
                    
                    {/* Top Section: League & Status */}
                    <div className="flex justify-between items-center mb-4 border-b border-gray-700 pb-3">
                      <span className="text-xs text-gray-400 font-bold">{pred.league}</span>
                      <span className={`text-xs font-bold px-2 py-1 rounded ${pred.recommendation === 'NO STRONG PREDICTION' ? 'bg-gray-700 text-gray-400' : 'bg-emerald-900 text-emerald-400'}`}>
                        {pred.status || 'Scheduled'}
                      </span>
                    </div>

                    {/* Teams & Predicted Score */}
                    <div className="flex justify-between items-center mb-6">
                      <div className="text-left w-2/5">
                        <p className="font-bold text-xl">{pred.homeTeam}</p>
                        <p className="text-xs text-gray-500 mt-1">Home</p>
                      </div>
                      
                      <div className="text-center w-1/5">
                        <p className="text-xs text-gray-400 mb-1">Predicted Score</p>
                        <p className="text-2xl font-bold text-white bg-gray-900 px-3 py-1 rounded-lg border border-gray-700">{pred.predictedScore}</p>
                      </div>

                      <div className="text-right w-2/5">
                        <p className="font-bold text-xl">{pred.awayTeam}</p>
                        <p className="text-xs text-gray-500 mt-1">Away</p>
                      </div>
                    </div>

                    {/* Best Market & Probability */}
                    <div className="bg-gray-900/50 p-3 rounded-lg border border-gray-700 flex justify-between items-center">
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wider">Best Market</p>
                        <p className="text-sm text-white font-bold">{pred.bestMarket?.market} ({pred.bestMarket?.selection})</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-500 uppercase tracking-wider">Probability</p>
                        <span className="text-2xl font-mono text-emerald-400">{pred.confidenceScore}%</span>
                      </div>
                    </div>
                    
                    <p className="text-xs text-gray-500 mt-3 text-center">Click for full analysis & correct scores</p>

                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* MATCH DETAILS MODAL */}
      {selectedMatch && (
        <div className="fixed inset-0 bg-black/80 flex justify-center items-center z-[100] p-4" onClick={() => setSelectedMatch(null)}>
          <div className="bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-700 max-w-2xl w-full relative max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            
            <button className="absolute top-4 right-4 text-gray-400 hover:text-white text-xl" onClick={() => setSelectedMatch(null)}>✕</button>
            
            {/* Match Overview */}
            <div className="text-center mb-6 border-b border-gray-700 pb-4">
              <span className="text-xs font-semibold bg-blue-900 text-blue-300 px-2 py-1 rounded">{selectedMatch.league}</span>
              <h2 className="text-3xl font-bold mt-3">{selectedMatch.homeTeam} vs {selectedMatch.awayTeam}</h2>
              <p className="text-gray-400 text-sm mt-1">{new Date(selectedMatch.date).toLocaleString()}</p>
              <p className="text-xs text-gray-500 mt-1">Status: {selectedMatch.status || 'Scheduled'}</p>
            </div>

            {/* Correct Score Prediction */}
            <div className="mb-6">
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-3">Most Probable Scorelines</h3>
              <div className="grid grid-cols-1 gap-2">
                {selectedMatch.topCorrectScores?.map((s, i) => (
                  <div key={i} className="bg-gray-900 p-2 rounded text-sm flex justify-between border border-gray-700">
                    <span className="text-gray-400">Score: <b className="text-white">{s.score}</b></span>
                    <span className="text-emerald-400 font-bold">{s.probability}%</span>
                  </div>
                ))}
              </div>
            </div>

            {/* All Markets */}
            <div className="mb-6">
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-3">All Market Probabilities</h3>
              <div className="grid grid-cols-2 gap-2">
                {selectedMatch.allMarkets?.map((m, i) => (
                  <div key={i} className="bg-gray-900 p-2 rounded text-xs border border-gray-700">
                    <p className="text-gray-400">{m.market}</p>
                    <div className="flex justify-between mt-1">
                      <span className="text-white font-bold">{m.selection}</span>
                      <span className="text-emerald-400">{m.probability}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* AI Explanation & Stats */}
            <div className="bg-blue-900/20 border border-blue-800 p-4 rounded-lg">
              <p className="text-xs text-blue-300 uppercase tracking-wider mb-1">AI Tactical Analysis</p>
              <p className="text-sm text-gray-300 italic">"{selectedMatch.aiExplanation}"</p>
              <div className="mt-3 space-y-1 text-xs text-gray-500">
                {selectedMatch.missingData?.map((miss, i) => <p key={i}>• {miss}</p>)}
              </div>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
