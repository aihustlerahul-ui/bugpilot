import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )
  const { data: { user } } = await supabase.auth.getUser()
  const path = request.nextUrl.pathname
  // Signed-in users are sent away from these to /projects.
  const isAuthRoute   = /^\/(login|signup|forgot-password)(\/|$)/.test(path)
  // Reachable with or without a session. /accept-invite must stay reachable after the invite
  // link has created a session, so the user can set a password there.
  const isPublicRoute = /^\/replay\//.test(path) || /^\/accept-invite(\/|$)/.test(path)
  if (!user && !isAuthRoute && !isPublicRoute) return NextResponse.redirect(new URL('/login', request.url))
  if (user && isAuthRoute) return NextResponse.redirect(new URL('/projects', request.url))
  return supabaseResponse
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] }
