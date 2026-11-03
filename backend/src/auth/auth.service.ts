import { Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createClient, Session, SupabaseClient } from '@supabase/supabase-js'
import { LoginDto } from './dto/login.dto'
import { RefreshDto } from './dto/refresh.dto'

export interface AuthSession {
  access_token: string
  refresh_token: string
  expires_at: number
  user: { id: string; email: string }
}

@Injectable()
export class AuthService {
  private client?: SupabaseClient

  constructor(private config: ConfigService) {}

  // Dedicated anon-key client: never the service-role client, never persists sessions.
  private getClient(): SupabaseClient {
    if (this.client) return this.client
    const url = this.config.get<string>('SUPABASE_URL')
    const anonKey = this.config.get<string>('SUPABASE_ANON_KEY')
    if (!url) throw new Error('SUPABASE_URL is not configured')
    if (!anonKey) throw new Error('SUPABASE_ANON_KEY is not configured')
    this.client = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    return this.client
  }

  private invalid(): UnauthorizedException {
    return new UnauthorizedException('Invalid credentials')
  }

  private toSession(session: Session | null | undefined): AuthSession {
    if (!session || !session.user) throw this.invalid()
    return {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at:
        session.expires_at ??
        Math.floor(Date.now() / 1000) + (session.expires_in ?? 3600),
      user: { id: session.user.id, email: session.user.email ?? '' },
    }
  }

  async login(dto: LoginDto): Promise<AuthSession> {
    const client = this.getClient()
    let result
    try {
      result = await client.auth.signInWithPassword({
        email: dto.email,
        password: dto.password,
      })
    } catch {
      throw this.invalid()
    }
    if (result.error) throw this.invalid()
    return this.toSession(result.data?.session)
  }

  async refresh(dto: RefreshDto): Promise<AuthSession> {
    const client = this.getClient()
    let result
    try {
      result = await client.auth.refreshSession({
        refresh_token: dto.refresh_token,
      })
    } catch {
      throw this.invalid()
    }
    if (result.error) throw this.invalid()
    return this.toSession(result.data?.session)
  }
}
