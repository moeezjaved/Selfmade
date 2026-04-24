import Link from 'next/link'

export default function HomePage() {
  return (
    <div className="min-h-screen bg-dark flex flex-col items-center justify-center text-center px-6">
      <div className="text-lime font-black text-4xl mb-4 font-serif italic">Selfmade</div>
      <h1 className="text-5xl font-black text-white mb-4 tracking-tight">
        Stop guessing.<br/>
        <span className="text-lime">Start winning.</span>
      </h1>
      <p className="text-white/50 text-lg mb-10 max-w-lg leading-relaxed">
        AI-powered Meta ads co-pilot. Pause losers, scale winners, launch campaigns — all from one place.
      </p>
      <div className="flex gap-4">
        <Link href="/signup" className="bg-lime text-dark font-black text-base px-8 py-3 rounded-full hover:bg-lime2 transition-all">
          Start Free Trial →
        </Link>
        <Link href="/login" className="border border-white/20 text-white font-semibold text-base px-8 py-3 rounded-full hover:border-white/40 transition-all">
          Log In
        </Link>
      </div>
    </div>
  )
}
