import packageJson from '../../../package.json';

const todayIsoDate = new Date().toISOString().slice(0, 10);

export default function ChangelogPage() {
  return (
    <section className="max-w-3xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold ui-text-primary">Changelog</h1>
      </header>

      <article className="ui-card p-6 space-y-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="text-xl font-semibold ui-text-primary">v{packageJson.version}</h2>
          <span className="text-sm ui-text-muted">{todayIsoDate}</span>
        </div>
        <ul className="list-disc pl-5 space-y-2 ui-text-secondary text-sm">
          <li>Pre build</li>
        </ul>
      </article>
    </section>
  );
}
