'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { api } from '@/lib/api/client'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [workspaceName, setWorkspaceName] = useState('')
  const supabase = createClient()

  useEffect(() => {
    api.get<{ name: string }>('/workspaces/me')
      .then(w => setWorkspaceName(w.name))
      .catch(() => {})
  }, [])

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col p-4 gap-1">
        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-2 mb-3">
          {workspaceName || '…'}
        </div>
        <Link href="/projects"
          className={`px-3 py-2 rounded-lg text-sm ${pathname.startsWith('/projects') ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-100'}`}>
          Projects
        </Link>
        <Link href="/connectors"
          className={`px-3 py-2 rounded-lg text-sm ${pathname.startsWith('/connectors') ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-100'}`}>
          Connectors
        </Link>
        <button onClick={handleSignOut}
          className="mt-auto px-3 py-2 rounded-lg text-sm text-left text-gray-500 hover:bg-gray-100">
          Sign out
        </button>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  )
}
