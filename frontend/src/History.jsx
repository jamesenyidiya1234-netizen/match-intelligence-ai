import { useState, useEffect } from 'react';
import axios from 'axios';

export default function History({ onNavigate }) {
  const [history, setHistory] = useState([]);
  const [accuracy, setAccuracy] = useState(0);

  useEffect(() => {
    axios.get('http://localhost:5001/api/history')
      .then(res => {
        setHistory(res.data.history);
        setAccuracy(res.data.accuracy);
      })
      .catch(err => console.error(err));
  }, []);

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <nav className="bg-gray-950 border-b border-gray-800 p-4 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <h1 className="text-xl font-bold text-emerald-400 tracking-wider">MATCH INTELLIGENCE AI</h1>
          <ul className="hidden md:flex gap-6 text-sm text-gray-400">
            <li className="hover:text-emerald-400 cursor-pointer" onClick={() => onNavigate('Dashboard')}>Dashboard</li>
            <li className="hover:text-white cursor-pointer">Football</li>
            <li className="hover:text-white cursor-pointer">Basketball</li>
            <li className="hover:text-white cursor-pointer">Today's Matches</li>
            <li className="hover:text-white cursor-pointer">Match of the Day</li>
            <li className="hover:text-white cursor-pointer">Value Opportunities</li>
            <li className="hover:text-emerald-400 cursor-pointer border-b-2 border-emerald-400 pb-1" onClick={() => onNavigate('History')}>History</li>
            <li className="hover:text-white cursor-pointer" onClick={() => onNavigate('Settings')}>Settings</li>
          </ul>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto p-6">
        <h2 className="text-2xl font-bold mb-6 text-emerald-400">Prediction History & Error Correction Report</h2>
        
        <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 mb-8">
          <p className="text-gray-400 text-sm uppercase tracking-wider">Overall Model Accuracy</p>
          <p className="text-4xl font-bold text-emerald-400 mt-2">{accuracy}%</p>
          <p className="text-gray-500 text-sm mt-2">Based on {history.length} recorded finished matches. The system automatically diagnoses every incorrect prediction.</p>
        </div>

        {history.length === 0 ? (
          <p className="text-gray-400 text-center text-xl py-10">No finished matches recorded yet. The BOT records results automatically after matches end.</p>
        ) : (
          <div className="space-y-4">
            {history.map((match, i) => (
              <div key={i} className="bg-gray-800 p-4 rounded-lg border border-gray-700">
                <div className="flex justify-between items-center mb-2">
                  <p className="font-bold text-lg">{match.homeTeam} vs {match.awayTeam}</p>
                  <div className={`px-4 py-2 rounded font-bold text-sm ${match.isCorrect ? 'bg-emerald-900 text-emerald-400' : 'bg-red-900 text-red-400'}`}>
                    {match.isCorrect ? 'CORRECT' : 'INCORRECT'}
                  </div>
                </div>
                <div className="text-sm text-gray-400 grid grid-cols-2 gap-2">
                  <p><span className="text-gray-500">Prediction:</span> {match.bestMarket?.selection || match.predictedWinner} ({match.confidenceScore}%)</p>
                  <p><span className="text-gray-500">Actual Result:</span> {match.actualResult?.homeScore} - {match.actualResult?.awayScore} ({match.actualResult?.winner})</p>
                </div>
                
                {/* AUTOMATIC ERROR DIAGNOSIS REPORT */}
                {!match.isCorrect && match.errorDiagnosis && (
                  <div className="mt-4 bg-red-900/20 border border-red-800 p-3 rounded">
                    <p className="text-xs text-red-400 uppercase tracking-wider mb-1">Correction Report</p>
                    <p className="text-sm text-gray-300">Diagnosis: {match.errorDiagnosis}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}