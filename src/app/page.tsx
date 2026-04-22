import Link from "next/link";

const features = [
  {
    title: "Voice & video rooms",
    description:
      "LiveKit-powered channels with presence, mute and per-participant volume. Floating window keeps faces in sight while you roll.",
  },
  {
    title: "Transparent dice",
    description:
      "Shared d4–d100 rolls with initiative tracking, crit/fumble highlights and a full roll history for your GM to scroll back through.",
  },
  {
    title: "Character sheets & chat",
    description:
      "Light-weight JSON character sheets, image-capable chat channels and recap tools. Zero downloads, everyone plays in the browser.",
  },
];

export default function Home() {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-5xl flex-col gap-14 px-6 py-16 md:py-24">
      <section className="flex flex-col gap-6">
        <span className="app-badge w-fit">Tabletop toolkit</span>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight md:text-5xl">
          Roll dice, keep secrets, and{" "}
          <span className="text-indigo-600 dark:text-indigo-400">blame the goblin</span>.
        </h1>
        <p className="max-w-2xl text-base text-[color:var(--foreground-muted)] md:text-lg">
          Spin up a TTRPG room in seconds. Invite players with a code, roll together, and
          keep voice, video and chat in one place &mdash; no downloads, no fuss.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/join" className="app-btn app-btn--primary">
            Enter the tavern
          </Link>
          <Link href="/account" className="app-btn app-btn--ghost">
            My account
          </Link>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {features.map((feature) => (
          <div key={feature.title} className="app-card p-6">
            <h2 className="text-base font-semibold">{feature.title}</h2>
            <p className="mt-2 text-sm text-[color:var(--foreground-muted)]">
              {feature.description}
            </p>
          </div>
        ))}
      </section>

      <section className="app-card flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--foreground-muted)]">
            How it works
          </p>
          <h2 className="mt-1 text-lg font-semibold">
            Sign in, create a room, share the invite.
          </h2>
          <p className="mt-1 text-sm text-[color:var(--foreground-muted)]">
            Everyone you invite gets a private session and can rejoin anytime from their
            recent sessions list.
          </p>
        </div>
        <Link href="/join" className="app-btn app-btn--accent self-start md:self-auto">
          Start a room
        </Link>
      </section>
    </div>
  );
}
