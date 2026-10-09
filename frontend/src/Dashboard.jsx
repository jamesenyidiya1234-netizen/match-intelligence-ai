import { useState, useEffect } from 'react';
import axios from 'axios';

export default function Dashboard({ onNavigate, pageFilter = 'all' }) {
  const [predictions, setPredictions] = useState([]);
  const [selectedMatch, setSelectedMatch] = useState(null);

  useEffect(() => {
   axios.get('https://match-intelligence-ai.onrender.com/api/predictions')
      .then(res => setPredictions(res.data.predictions))
      .catch(err => console.error(err));
  }, []);

  let filteredPredictions = [...predictions];
  const todayStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  if (pageFilter === 'football') {
    filteredPredictions = filteredPredictions.filter(p => p.sport === 'football');
  } else if (pageFilter === 'basketball') {
    filteredPredictions = filteredPredictions.filter(p => p.sport === 'basketball');
  } else if (pageFilter === 'today') {
    filteredPredictions = filteredPredictions.filter(p => new Date(p.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) === todayStr);
  } else if (pageFilter === 'motd') {
    filteredPredictions = filteredPredictions.sort((a, b) => b.confidenceScore - a.confidenceScore).slice(0, 1);
  } else if (pageFilter === 'value') {
    filteredPredictions = filteredPredictions.filter(p => parseFloat(p.valueEdge) > 15.0);
  }

  const groupedMatches = filteredPredictions.reduce((acc, match) => {
    const dateObj = new Date(match.date);
    const dateStr = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    if (!acc[dateStr]) acc[dateStr] = [];
    acc[dateStr].push(match);
    return acc;
  }, {});

  const highConfidenceMatches = filteredPredictions.filter(p => p.confidenceScore >= 60).slice(0, 3);
  const valueBets = filteredPredictions.filter(p => parseFloat(p.valueEdge) > 15.0).slice(0, 3);

  const pageTitle = pageFilter === 'motd' ? 'Match of the Day' : 
                    pageFilter === 'value' ? 'Value Opportunities' :
                    pageFilter === 'today' ? "Today's Matches" :
                    pageFilter === 'football' ? 'Football Predictions' :
                    pageFilter === 'basketball' ? 'Basketball Predictions' : 'Dashboard';

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      
      <nav className="bg-gray-950 border-b border-gray-800 p-4 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <h1 className="text-xl font-bold text-emerald-400 tracking-wider">MATCH INTELLIGENCE AI</h1>
          <ul className="hidden md:flex gap-6 text-sm text-gray-400">
            <li className={`hover:text-emerald-400 cursor-pointer ${pageFilter === 'all' ? 'border-b-2 border-emerald-400 pb-1' : ''}`} onClick={() => onNavigate('Dashboard')}>Dashboard</li>
            <li className={`hover:text-white cursor-pointer ${pageFilter === 'football' ? 'border-b-2 border-emerald-400 pb-1' : ''}`} onClick={() => onNavigate('Football')}>Football</li>
            <li className={`hover:text-white cursor-pointer ${pageFilter === 'basketball' ? 'border-b-2 border-emerald-400 pb-1' : ''}`} onClick={() => onNavigate('Basketball')}>Basketball</li>
            <li className={`hover:text-white cursor-pointer ${pageFilter === 'today' ? 'border-b-2 border-emerald-400 pb-1' : ''}`} onClick={() => onNavigate('Today\'s Matches')}>Today's Matches</li>
            <li className={`hover:text-white cursor-pointer ${pageFilter === 'motd' ? 'border-b-2 border-emerald-400 pb-1' : ''}`} onClick={() => onNavigate('Match of the Day')}>Match of the Day</li>
            <li className={`hover:text-white cursor-pointer ${pageFilter === 'value' ? 'border-b-2 border-emerald-400 pb-1' : ''}`} onClick={() => onNavigate('Value Opportunities')}>Value Opportunities</li>
            <li className="hover:text-white cursor-pointer" onClick={() => onNavigate('History')}>History</li>
            <li className="hover:text-white cursor-pointer" onClick={() => onNavigate('Settings')}>Settings</li>
          </ul>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto p-6">
        
        <div className="mb-8 p-3 bg-yellow-900/30 border border-yellow-800 rounded text-yellow-200 text-xs text-center">
          ⚠️ Responsible Betting Notice: Sports predictions are probabilities, not guarantees. Past performance does not guarantee future results.
        </div>

        <h2 className="text-2xl font-bold mb-6 text-white">{pageTitle}</h2>

        {pageFilter === 'all' && (
          <>
            <section className="mb-10">
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 border-b border-gray-800 pb-2">Weekly High-Confidence Anchors</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {highConfidenceMatches.map(match => (
                  <div key={match.id} onClick={() => setSelectedMatch(match)} className="bg-gray-800 p-4 rounded-lg border border-gray-700 hover:border-emerald-500 cursor-pointer transition-all">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs text-gray-400">{match.sport?.toUpperCase()}</span>
                      <span className="text-xs text-emerald-400 font-bold">Conf {match.confidenceScore}%</span>
                    </div>
                    <h4 className="font-bold text-lg">{match.homeTeam} vs {match.awayTeam}</h4>
                    <p className="text-xs text-gray-400 mt-1">Expected: {match.expectedScore || 'N/A'}</p>
                    <div className="mt-2 h-1 bg-gray-700 rounded-full">
                      <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${match.confidenceScore}%` }}></div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="mb-10">
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4 border-b border-gray-800 pb-2">Weekly Asymmetric Value Bets</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {valueBets.map(match => (
                  <div key={match.id} onClick={() => setSelectedMatch(match)} className="bg-gray-800 p-4 rounded-lg border border-gray-700 hover:border-emerald-500 cursor-pointer transition-all">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs text-gray-400">{match.sport?.toUpperCase()}</span>
                      <span className="text-xs text-blue-400 font-bold">Value +{match.valueEdge}%</span>
                    </div>
                    <h4 className="font-bold text-lg">{match.homeTeam} vs {match.awayTeam}</h4>
                    <p className="text-xs text-gray-400 mt-1">Predicted Winner: {match.predictedWinner}</p>
                    <p className="text-xs text-gray-500 mt-1">Risk: {match.riskLevel}</p>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}

        {Object.keys(groupedMatches).length === 0 ? (
          <p className="text-gray-400 text-center text-xl py-10">No matches found for this filter. Waiting for next API cycle...</p>
        ) : (
          Object.keys(groupedMatches).map(dateStr => (
            <div key={dateStr} className="mb-12">
              <h3 className="text-xl font-semibold mb-6 border-l-4 border-emerald-500 pl-3">{dateStr}</h3>
              
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {groupedMatches[dateStr].map((pred) => (
                  
                  <div key={pred.id} onClick={() => setSelectedMatch(pred)} className="bg-gray-800 rounded-xl shadow-lg p-5 border border-gray-700 hover:border-emerald-500 transition-all cursor-pointer">
                    
                    <div className="flex justify-between items-center mb-4 border-b border-gray-700 pb-3">
                      <span className="text-xs font-semibold bg-emerald-900 text-emerald-300 px-2 py-1 rounded">{pred.sport?.toUpperCase()}</span>
                      <span className={`text-xs font-bold px-2 py-1 rounded ${pred.recommendation === 'NO STRONG PREDICTION' ? 'bg-gray-700 text-gray-400' : 'bg-emerald-900 text-emerald-400'}`}>
                        {pred.recommendation || 'NO STRONG PREDICTION'}
                      </span>
                    </div>

                    <div className="flex justify-between items-center mb-4">
                      <div className="text-left w-2/5">
                        <p className="font-bold text-xl">{pred.homeTeam}</p>
                        <p className="text-2xl font-mono text-white mt-1">{pred.probabilities?.homeWin || 'N/A'}%</p>
                      </div>
                      
                      <div className="text-center w-1/5">
                        <p className="text-gray-500 text-xs mb-1">{new Date(pred.date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</p>
                        <p className="text-gray-600 text-xl">VS</p>
                        <p className="text-gray-400 text-sm mt-1 font-bold">{pred.expectedScore || 'N/A'}</p>
                      </div>

                      <div className="text-right w-2/5">
                        <p className="font-bold text-xl">{pred.awayTeam}</p>
                        <p className="text-2xl font-mono text-white mt-1">{pred.probabilities?.awayWin || 'N/A'}%</p>
                      </div>
                    </div>

                    <div className="bg-gray-900/50 p-3 rounded-lg border border-gray-700 mb-3">
                      <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Elite Best Market</p>
                      <div className="flex justify-between items-center">
                        <p className="text-sm text-white font-bold">{pred.bestMarket?.selection || 'Match Winner'}</p>
                        <span className="text-emerald-400 font-mono text-lg">{pred.confidenceScore}%</span>
                      </div>
                      <p className="text-xs text-gray-400 mt-1">Category: {pred.confidenceCategory || 'Standard'}</p>
                    </div>

                    <div className="bg-blue-900/20 border border-blue-800 p-3 rounded-lg">
                      <p className="text-xs text-blue-300 uppercase tracking-wider mb-1">AI Justification</p>
                      <p className="text-xs text-gray-300 italic">"{pred.aiExplanation}"</p>
                    </div>

                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* MATCH DETAIL MODAL */}
      {selectedMatch && (
        <div className="fixed inset-0 bg-black/70 flex justify-center items-center z-[100] p-4" onClick={() => setSelectedMatch(null)}>
          <div className="bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-700 max-w-lg w-full relative max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            
            <button className="absolute top-4 right-4 text-gray-400 hover:text-white text-xl" onClick={() => setSelectedMatch(null)}>
              ✕
            </button>
            
            <div className="text-center mb-6">
              <span className="text-xs font-semibold bg-emerald-900 text-emerald-300 px-2 py-1 rounded">{selectedMatch.sport?.toUpperCase()}</span>
              <h2 className="text-2xl font-bold mt-2">{selectedMatch.homeTeam} vs {selectedMatch.awayTeam}</h2>
              <p className="text-gray-400 text-sm mt-1">{new Date(selectedMatch.date).toLocaleString()}</p>
            </div>

            <div className="flex justify-between items-center mb-6 bg-gray-900 p-4 rounded-lg">
              <div className="text-left w-2/5">
                <p className="font-bold text-lg">{selectedMatch.homeTeam}</p>
                <p className="text-3xl font-mono text-emerald-400 mt-1">{selectedMatch.probabilities?.homeWin || 'N/A'}%</p>
              </div>
              <div className="text-center w-1/5">
                <p className="text-gray-600 text-xl">VS</p>
                <p className="text-gray-400 text-sm mt-1 font-bold">{selectedMatch.expectedScore || 'N/A'}</p>
              </div>
              <div className="text-right w-2/5">
                <p className="font-bold text-lg">{selectedMatch.awayTeam}</p>
                <p className="text-3xl font-mono text-emerald-400 mt-1">{selectedMatch.probabilities?.awayWin || 'N/A'}%</p>
              </div>
            </div>

            {/* ALL MARKETS SECTION */}
            {selectedMatch.allMarkets && selectedMatch.allMarkets.length > 0 && (
              <div className="mb-6">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">All Calculated Markets (Based on Form)</p>
                <div className="grid grid-cols-2 gap-2">
                  {selectedMatch.allMarkets.map((m, i) => (
                    <div key={i} className="bg-gray-900 p-2 rounded text-xs flex justify-between border border-gray-700">
                      <span className="text-gray-400">{m.market} ({m.selection})</span>
                      <span className="text-white font-bold">{m.probability}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-4 text-center mb-6">
              <div className="bg-gray-900 p-2 rounded">
                <p className="text-xs text-gray-500">Best Market</p>
                <p className="font-bold text-white text-sm mt-1">{selectedMatch.bestMarket?.selection || selectedMatch.predictedWinner}</p>
              </div>
              <div className="bg-gray-900 p-2 rounded">
                <p className="text-xs text-gray-500">Confidence</p>
                <p className="font-bold text-white text-sm mt-1">{selectedMatch.confidenceScore}%</p>
              </div>
              <div className="bg-gray-900 p-2 rounded">
                <p className="text-xs text-gray-500">Data Quality</p>
                <p className="font-bold text-white text-sm mt-1">{selectedMatch.dataQuality}</p>
              </div>
            </div>

            <div className="bg-blue-900/20 border border-blue-800 p-4 rounded-lg mb-4">
              <p className="text-xs text-blue-300 uppercase tracking-wider mb-1">AI Explanation</p>
              <p className="text-sm text-gray-300 italic">"{selectedMatch.aiExplanation}"</p>
            </div>

            <div className="space-y-2 text-sm">
              {selectedMatch.warnings?.map((warn, i) => (
                <p key={i} className="text-yellow-400">⚠️ {warn}</p>
              ))}
              {selectedMatch.missingData?.map((miss, i) => (
                <p key={i} className="text-gray-500">• {miss}</p>
              ))}
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
