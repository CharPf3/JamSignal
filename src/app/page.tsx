export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-20">
      <div className="w-full max-w-2xl text-center space-y-4">
        <h1 className="text-4xl font-bold tracking-tight">JamSignal</h1>
        <p className="text-[var(--muted)] text-lg">
          Find Grateful Dead & jam band shows near you.
        </p>
        {/* Search form coming in Phase 1 */}
      </div>
    </main>
  )
}
