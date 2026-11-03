'use client'
import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

// Sends a password-reset link that lands on /accept-invite. Also the fallback for invited
// testers whose invite email never arrived. Always shows the same neutral confirmation so the
// page does not reveal which addresses have accounts.
export default function ForgotPasswordPage() {
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/accept-invite`,
      })
    } catch {
      // Deliberately ignored: the response is the same either way.
    }
    setLoading(false)
    setSent(true)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm bg-white rounded-xl shadow p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Reset your password</h1>
        {sent ? (
          <p className="text-sm text-gray-600" role="status">
            If an account exists for that address, we&apos;ve sent a link to set a new password. Check your inbox
            (and spam folder).
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-gray-600">
              Enter your email and we&apos;ll send you a link to set a new password. Invited testers can use this to
              set their first password.
            </p>
            <div>
              <label htmlFor="reset-email" className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input id="reset-email" type="email" required value={email} onChange={e => setEmail(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <button type="submit" disabled={loading}
              className="w-full bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {loading ? 'Sending...' : 'Send reset link'}
            </button>
          </form>
        )}
        <p className="mt-4 text-sm text-gray-600 text-center">
          <Link href="/login" className="text-blue-600 hover:underline">Back to sign in</Link>
        </p>
      </div>
    </div>
  )
}
