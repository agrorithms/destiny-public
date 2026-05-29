import Link from 'next/link';

export default function AboutPage() {
  return (
    <section className="max-w-3xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold ui-text-primary">About</h1>
        <p className="ui-text-secondary text-sm leading-6">
          Destiny Farm Finder tracks who is farming raids in Destiny 2 right now, using Bungie&apos;s public API.
        </p>
      </header>

      <section className="space-y-5">
        <section className="space-y-3">
          <h2 className="text-xl font-semibold ui-text-primary">How It Works</h2>
          <div className="space-y-3 text-sm leading-6 ui-text-secondary">
            <p>
              <span className="font-medium ui-text-primary">Player Discovery</span> - Players are discovered organically through post game carnage reports (PGCRs). When the crawler processes a raid completion, every player in that activity gets added to the database. You do not sign up or register. If you have completed a raid that the crawler has seen, you are in.
            </p>
            <p>
              <span className="font-medium ui-text-primary">Leaderboard</span> - The crawler continuously fetches recent PGCRs. The leaderboard shows who has the most raid completions within a rolling time window. PGCRs older than 30 days are deleted.
            </p>
            <p>
              <span className="font-medium ui-text-primary">Active Sessions</span> - The site polls known players&apos; real-time activity status through the Bungie API. If you are currently in a raid, and the active sessions poll checks your session, it will show up on the Active Sessions page with your fireteam and how long you have been going. Polling is trial and error, so the Active Sessions page will not display all active raid sessions.
            </p>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold ui-text-primary">Privacy &amp; Data</h2>
          <div className="space-y-3 text-sm leading-6 ui-text-secondary">
            <p>All data comes from Bungie&apos;s public API. No scraping, no third-party sources.</p>
            <p>No login is required. The site never asks for or stores your Bungie credentials.</p>
            <p>
              The only data stored is your Bungie display name, membership ID, membership type, and recent raid completions (PGCRs). PGCRs are deleted after about 30 days.
            </p>
            <p>
              Active session data, such as what raid you are in and who is in your fireteam, is transient. It is polled in real time and not stored long term.
            </p>
            <p>
              This is not a lifetime raid tracker. It focuses on recency - who is completing raids now and who is active this moment. Data older than 30 days is discarded.
            </p>
          </div>
        </section>
      </section>

      <p className="ui-text-secondary text-sm leading-6">
        Questions? Check the <Link href="/faq" className="ui-accent-text">FAQ</Link>. Found a bug? Join the{' '}
        <a
          href="https://discord.gg/DndgAEqcEQ"
          target="_blank"
          rel="noopener noreferrer"
          className="ui-accent-text"
        >
          Discord
        </a>
        .
      </p>
    </section>
  );
}
