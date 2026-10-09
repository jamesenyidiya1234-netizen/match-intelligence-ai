export default function Settings({ onNavigate }) {
  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <nav className="bg-gray-950 border-b border-gray-800 p-4 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <h1 className="text-xl font-bold text-emerald-400 tracking-wider">MATCH INTELLIGENCE AI</h1>
          <ul className="hidden md:flex gap-6 text-sm text-gray-400">
            <li className="hover:text-emerald-400 cursor-pointer" onClick={() => onNavigate('Dashboard')}>Dashboard</li>
            <li className="hover:text-white cursor-pointer" onClick={() => onNavigate('History')}>History</li>
            <li className="hover:text-emerald-400 cursor-pointer border-b-2 border-emerald-400 pb-1" onClick={() => onNavigate('Settings')}>Settings</li>
          </ul>
        </div>
      </nav>
      <div className="max-w-7xl mx-auto p-6">
        <h2 className="text-2xl font-bold mb-6 text-emerald-400">System Settings</h2>
        <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 mb-8">
          <h3 className="font-bold text-lg mb-4">Automation Status</h3>
          <p className="text-gray-400 text-sm">The BOT is running 24/7 on Render.</p>
        </div>
        <div className="bg-gray-800 p-6 rounded-lg border border-gray-700">
          <h3 className="font-bold text-lg mb-4">API Configuration</h3>
          <p className="text-gray-400 text-sm">API Keys are securely stored in Render Environment Variables.</p>
        </div>
      </div>
    </div>
  );
}
