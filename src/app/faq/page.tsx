import Link from 'next/link';

const usageFaq = [
  {
    question: 'How do I find myself?',
    answer:
      'Use the search bar in the nav. Search by your Bungie name, for example Guardian#1234. If you are in the database, your profile page shows your recent raid completions, a raid summary, and your most frequent teammates.',
  },
  {
    question: 'I searched my name and nothing came up. Why?',
    answer:
      'You have not been discovered yet. Players are only added when they appear in a PGCR that the crawler has processed. If you recently completed a raid, give it some time. The crawler will eventually process an activity you were in and you will appear.',
  },
  {
    question: 'What does the leaderboard show?',
    answer:
      'Raid completions within a rolling time window. It measures recent full raid activity, started from the beginning and completed in the same instance.',
  },
  {
    question: 'What counts as a completion?',
    answer:
      'A PGCR where at least one player has a completed flag. The leaderboard only counts full clears that started from the beginning.',
  },
  {
    question: 'What does the Active Sessions page show?',
    answer:
      'Players currently in a raid right now, their fireteam members, which raid they are in, and how long they have been going. This data is polled in real time and disappears when the session ends.',
  },
  {
    question: "I'm raiding right now but I don't show up on Active Sessions.",
    answer:
      'The site polls a subset of known players each cycle. If you were only recently discovered, you might not be polled yet. Also, if your Bungie privacy settings block activity status, the API returns nothing. Polling is trial and error, so the Active Sessions page will not display all active raid sessions.',
  },
];

const privacyFaq = [
  {
    question: 'Can you see my inventory, vault, or private messages?',
    answer:
      'No. The site only accesses public activity history (PGCRs) and real-time activity status, meaning what you are currently playing.',
  },
  {
    question: 'Do you track non-raid activities?',
    answer:
      'No. Only raid activities, using activity mode type 4, are tracked.',
  },
];

function FaqGroup({
  title,
  items,
}: {
  title: string;
  items: { question: string; answer: string }[];
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold ui-text-primary">{title}</h2>
      <div className="space-y-5">
        {items.map((item) => (
          <article key={item.question} className="space-y-2">
            <h3 className="text-base font-semibold ui-text-primary">{item.question}</h3>
            <p className="text-sm leading-6 ui-text-secondary">{item.answer}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export default function FaqPage() {
  return (
    <section className="max-w-3xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold ui-text-primary">FAQ</h1>
        <p className="ui-text-secondary text-sm leading-6">
          A quick guide to how discovery, leaderboards, and live sessions work.
        </p>
      </header>

      <div className="space-y-6">
        <FaqGroup title="Using the Site" items={usageFaq} />
        <FaqGroup title="Privacy &amp; Data" items={privacyFaq} />
      </div>

      <p className="ui-text-secondary text-sm leading-6">
        Want the bigger picture? Read the{' '}
        <Link href="/about" className="ui-accent-text">
          About
        </Link>{' '}
        page or join the{' '}
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
