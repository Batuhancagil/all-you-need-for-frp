export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <main className="mx-auto flex min-h-screen w-full max-w-2xl items-center px-6 py-16">
        <section className="w-full rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
            AllYouNeedForFRP
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            Roll dice. Keep secrets. Blame the goblin.
          </h1>
          <p className="mt-3 text-sm text-zinc-600">
            Minimal room setup with voice, video, and chat channels. Jump in with Google and start playing.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <a
              className="inline-flex h-11 items-center justify-center rounded-full bg-zinc-900 px-6 text-sm font-semibold text-white"
              href="/join"
            >
              Enter tavern
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}
