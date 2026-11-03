'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'

// Landing page for Supabase invite and password-recovery links. Supports the three link forms:
//   ?code=...                      (PKCE, e.g. resetPasswordForEmail from this browser)
//   ?token_hash=...&type=invite    (custom email template using {{ .TokenHash }})
//   #access_token=...&refresh_token=...  (implicit, e.g. admin inviteUserByEmail)
// Then lets the user set a password. Tokens are never logged and are stripped from the URL.

type Phase = 'verifying' | 'ready' | 'invalid' | 'done'

const OTP_TYPES: EmailOtpType[] = ['invite', 'recovery', 'signup', 'magiclink', 'email', 'email_change']
const MIN_PASSWORD = 8

export default function AcceptInvitePage() {
  const router = useRouter()
  const [supabase] = useState(() => createClient())
  const [phase, setPhase] = useState<Phase>('verifying')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    async function establishSession(): Promise<boolean> {
      const search = new URLSearchParams(window.location.search)
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
      // Remove tokens from the address bar / history before doing anything else.
      if (window.location.search || window.location.hash) {
        window.history.replaceState(null, '', window.location.pathname)
      }

      if (hash.get('error') || hash.get('error_description') || search.get('error_description')) {
        return false
      }

      const tokenHash = search.get('token_hash')
      const type = search.get('type') as EmailOtpType | null
      if (tokenHash && type && OTP_TYPES.includes(type)) {
        const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
        return !error
      }

      const accessToken = hash.get('access_token')
      const refreshToken = hash.get('refresh_token')
      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
        return !error
      }

      const code = search.get('code')
      if (code) {
        // The client may already have exchanged the code on init (same-browser PKCE).
        const { data } = await supabase.auth.getSession()
        if (data.session) return true
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        return !error
      }

      // No callback params: allow an already signed-in user to set a password here.
      const { data } = await supabase.auth.getSession()
      return !!data.session
    }

    establishSession()
      .then(async (ok) => {
        if (!ok) return setPhase('invalid')
        const { data } = await supabase.auth.getUser()
        if (!data.user) return setPhase('invalid')
        setEmail(data.user.email ?? '')
        setPhase('ready')
      })
      .catch(() => setPhase('invalid'))
  }, [supabase])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < MIN_PASSWORD) return setError(`Password must be at least ${MIN_PASSWORD} characters.`)
    if (password !== confirm) return setError('Passwords do not match.')
    setSaving(true)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setError(error.message)
      setSaving(false)
      return
    }
    const { data } = await supabase.auth.getSession()
    if (data.session) sessionStorage.setItem('qa_token', data.session.access_token)
    else sessionStorage.removeItem('qa_token')
    setPhase('done')
    router.push('/projects')
    router.refresh()
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm bg-white rounded-xl shadow p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Set your password</h1>

        {phase === 'verifying' && <p className="text-sm text-gray-600">Checking your link…</p>}

        {phase === 'invalid' && (
          <div className="space-y-4">
            <p className="text-sm text-red-600">This link is invalid or has expired.</p>
            <p className="text-sm text-gray-600">
              Request a new one with{' '}
              <Link href="/forgot-password" className="text-blue-600 hover:underline">Forgot password</Link>
              , using the email address you were invited with.
            </p>
          </div>
        )}

        {phase === 'done' && <p className="text-sm text-gray-600">Password saved. Redirecting…</p>}

        {phase === 'ready' && (
          <form onSubmit={handleSubmit} className="space-y-4">
            {email && (
              <p className="text-sm text-gray-600">
                Signing in as <span className="font-medium text-gray-900">{email}</span>
              </p>
            )}
            <div>
              <label htmlFor="new-password" className="block text-sm font-medium text-gray-700 mb-1">New password</label>
              <input id="new-password" type="password" required minLength={MIN_PASSWORD} autoComplete="new-password"
                value={password} onChange={e => setPassword(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <p className="mt-1 text-xs text-gray-500">At least {MIN_PASSWORD} characters.</p>
            </div>
            <div>
              <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700 mb-1">Confirm password</label>
              <input id="confirm-password" type="password" required minLength={MIN_PASSWORD} autoComplete="new-password"
                value={confirm} onChange={e => setConfirm(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <button type="submit" disabled={saving}
              className="w-full bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving...' : 'Set password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
