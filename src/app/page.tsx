import StatsBar from '@/components/StatsBar';

export default function Home() {
  return (
    <div className="space-y-8">
      <div className="text-center py-12">
        <h1 className="text-4xl font-bold mb-4">Destiny Farm Finder</h1>
        <p className="text-gray-600 dark:text-gray-400 text-lg max-w-2xl mx-auto">
          Track who is farming raids right now. See real-time leaderboards of
          the most completed raid activities in the past few hours, and browse
          active raid sessions across Destiny 2.
        </p>
      </div>

      <StatsBar />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <a
          href="/leaderboard"
          className="block bg-white border border-gray-200 rounded-lg p-6 hover:border-blue-500 transition-colors group dark:bg-gray-800 dark:border-gray-700"
        >
          <h2 className="text-xl font-bold mb-2 text-gray-900 dark:text-white group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors">
            Leaderboard
          </h2>
          <p className="text-gray-600 dark:text-gray-400 text-sm">
            See which players have completed the most raid clears in the past
            few hours. Filter by raid and adjust the time window.
          </p>
        </a>

        <a
          href="/active-sessions"
          className="block bg-white border border-gray-200 rounded-lg p-6 hover:border-blue-500 transition-colors group dark:bg-gray-800 dark:border-gray-700"
        >
          <h2 className="text-xl font-bold mb-2 text-gray-900 dark:text-white group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors">
            Active Sessions
          </h2>
          <p className="text-gray-600 dark:text-gray-400 text-sm">
            Browse fireteams currently running raids. See who is in each
            session and how long they have been going.
          </p>
        </a>
      </div>
    </div>
  );
}
