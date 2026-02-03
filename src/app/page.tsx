export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-16 px-6 py-16">
        <header className="flex flex-col gap-6">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">
            AllYouNeedForFRP
          </p>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            Start a tabletop session in minutes — call, dice, and room in one
            place.
          </h1>
          <p className="max-w-2xl text-lg text-zinc-600">
            Invite your party, join instantly, and roll without switching tools.
            Built for fast, frictionless sessions with voice, video, and real-time
            dice.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <a
              className="inline-flex h-12 items-center justify-center rounded-full bg-zinc-900 px-6 text-sm font-semibold text-white transition hover:bg-zinc-800"
              href="/join"
            >
              Join with Invite Link
            </a>
            <a
              className="inline-flex h-12 items-center justify-center rounded-full border border-zinc-200 px-6 text-sm font-semibold text-zinc-800 transition hover:border-zinc-300 hover:bg-white"
              href="#how-it-works"
            >
              See how it works
            </a>
          </div>
        </header>

        <section className="grid gap-6 sm:grid-cols-3">
          {[
            {
              title: "Instant room setup",
              body: "Create a room and invite players in seconds. No accounts required to join.",
            },
            {
              title: "Call + dice together",
              body: "Voice/video and dice live in the same room with zero tool switching.",
            },
            {
              title: "Stay in the flow",
              body: "Presence, rolls, and session status update in real time for everyone.",
            },
          ].map((item) => (
            <div
              key={item.title}
              className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"
            >
              <h2 className="text-lg font-semibold">{item.title}</h2>
              <p className="mt-2 text-sm text-zinc-600">{item.body}</p>
            </div>
          ))}
        </section>

        <section id="how-it-works" className="rounded-3xl bg-white p-8 shadow-sm">
          <h2 className="text-2xl font-semibold">How it works</h2>
          <ol className="mt-6 grid gap-6 sm:grid-cols-3">
            <li className="space-y-2">
              <p className="text-sm font-semibold text-zinc-500">01</p>
              <p className="font-semibold">Share invite</p>
              <p className="text-sm text-zinc-600">
                GM creates a room and drops a link into the group chat.
              </p>
            </li>
            <li className="space-y-2">
              <p className="text-sm font-semibold text-zinc-500">02</p>
              <p className="font-semibold">Join instantly</p>
              <p className="text-sm text-zinc-600">
                Players enter a name and land directly in the session.
              </p>
            </li>
            <li className="space-y-2">
              <p className="text-sm font-semibold text-zinc-500">03</p>
              <p className="font-semibold">Call + roll</p>
              <p className="text-sm text-zinc-600">
                Start the call, roll dice, and keep the session moving.
              </p>
            </li>
          </ol>
        </section>

        <section className="rounded-3xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
          <h2 className="text-2xl font-semibold">Ready to start a session?</h2>
          <p className="mt-2 text-sm text-zinc-600">
            Drop an invite link and meet your party in a single room.
          </p>
          <a
            className="mt-6 inline-flex h-12 items-center justify-center rounded-full bg-zinc-900 px-6 text-sm font-semibold text-white transition hover:bg-zinc-800"
            href="/join"
          >
            Join with Invite Link
          </a>
        </section>
      </main>
    </div>
  );
}
