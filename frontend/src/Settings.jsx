export default function Settings({ onNavigate }) {
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
            <li className="hover:text-white cursor-pointer" onClick={() => onNavigate('History')}>History</li>
            <li className="hover:text-emerald-400 cursor-pointer border-b-2 border-emerald-400 pb-1" onClick={() => onNavigate('Settings')}>Settings</li>
          </ul>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto p-6">
        <h2 className="text-2xl font-bold mb-6 text-emerald-400">System Settings</h2>
        
        <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 mb-8">
          <h3 className="font-bold text-lg mb-4">Automation Status</h3>
          <p className="text-gray-400 text-sm">The BOT is currently running 24/7/365 in the background.</p>
          <p className="text-gray-400 text-sm mt-2">It automatically updates every hour and monitors for lineups every 15 minutes.</p>
        </div>

        <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
          <h3 className="font-bold text-lg mb-4">API Configuration</h3>
          <p className="text-gray-400 text-sm">Your SportMonks API key is securely stored in the backend `.env` file.</p>
          <p className="text-gray-400 text-sm mt-2">To change it, edit the `.env` file in the `backend` folder and restart the server.</p>
        </div>
      </div>
    </div>
  );
}