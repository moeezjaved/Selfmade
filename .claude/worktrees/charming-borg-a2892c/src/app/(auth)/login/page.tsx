'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import toast from 'react-hot-toast'

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      toast.error(error.message)
      setLoading(false)
    } else {
      router.push('/dashboard')
    }
  }

  const handleGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` }
    })
  }

  return (
    <div className="min-h-screen grid grid-cols-2">
      {/* Left panel */}
      <div className="bg-dark2 border-r border-white/10 flex flex-col p-12 relative overflow-hidden">
        <div className="text-lime font-black text-2xl tracking-tight font-serif italic mb-auto">
          Selfmade
        </div>
        <div className="mt-auto">
          <div className="text-4xl font-black text-white mb-4 tracking-tight leading-tight">
            Good to see<br/>
            <em className="font-serif font-normal text-lime">you again.</em>
          </div>
          <p className="text-white/50 text-base leading-relaxed mb-8">
            Your ads are waiting. Check recommendations, review performance, and approve actions.
          </p>
          <div className="bg-dark3 border border-white/10 rounded-2xl p-6">
            <p className="text-white/60 text-sm italic leading-relaxed mb-4">
              "CPL dropped 34% in 3 weeks. Selfmade caught creative fatigue before it tanked my best ad."
            </p>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-lime flex items-center justify-center text-dark text-sm font-black">AL</div>
              <div>
                <div className="text-sm font-bold text-white">Aisha L.</div>
                <div className="text-xs text-white/40">Lead Gen · Real Estate · $12k/mo</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right panel */}
      <div className="bg-dark flex flex-col items-center justify-center p-12">
        <div className="w-full max-w-md">
          <h2 className="text-3xl font-black text-white mb-2 tracking-tight">Welcome back</h2>
          <p className="text-white/40 text-base mb-8">Log in to your Selfmade account.</p>

          <button onClick={handleGoogle} className="w-full flex items-center justify-center gap-3 border border-white/10 bg-white/5 text-white font-semibold py-3 px-4 rounded-xl mb-4 hover:border-white/20 hover:bg-white/7 transition-all">
            <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            Continue with Google
          </button>

          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-white/10"/>
            <span className="text-xs text-white/30 font-semibold">or</span>
            <div className="flex-1 h-px bg-white/10"/>
          </div>

          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <div>
              <label className="label">Email address</label>
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                className="input" placeholder="alex@company.com"/>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="label" style={{margin:0}}>Password</label>
                <a href="#" className="text-xs text-white/40 hover:text-lime transition-colors">Forgot password?</a>
              </div>
              <input type="password" required value={password} onChange={e => setPassword(e.target.value)}
                className="input" placeholder="Your password"/>
            </div>
            <button type="submit" disabled={loading}
              className="w-full bg-lime text-dark font-bold py-3.5 rounded-xl text-base hover:bg-lime2 transition-all mt-2 disabled:opacity-50">
              {loading ? 'Logging in…' : 'Log In →'}
            </button>
          </form>

          <p className="text-center text-sm text-white/40 mt-6">
            Don't have an account?{' '}
            <Link href="/signup" className="text-lime font-semibold hover:underline">Start free trial</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
