import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common'
import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { SupabaseService } from '../supabase/supabase.service'

const KEY_PREFIX_LEN = 12

function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

@Injectable()
export class ApiKeysService {
  constructor(private readonly supabase: SupabaseService) {}

  async create(userId: string, name: string) {
    const key = `bp_live_${randomBytes(32).toString('base64url')}`
    const { data, error } = await this.supabase.db
      .from('api_keys')
      .insert({ user_id: userId, name, key_hash: hashKey(key), key_prefix: key.slice(0, KEY_PREFIX_LEN) })
      .select('id, name, key_prefix')
      .single()
    if (error || !data) throw new InternalServerErrorException('Failed to create API key')
    return { id: data.id as string, name: data.name as string, keyPrefix: data.key_prefix as string, key }
  }

  async list(userId: string) {
    const { data, error } = await this.supabase.db
      .from('api_keys')
      .select('id, name, key_prefix, last_used_at, revoked_at, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
    if (error) throw new InternalServerErrorException('Failed to list API keys')
    return (data ?? []).map((r: any) => ({
      id: r.id,
      name: r.name,
      keyPrefix: r.key_prefix,
      lastUsedAt: r.last_used_at ?? null,
      revokedAt: r.revoked_at ?? null,
      createdAt: r.created_at,
    }))
  }

  async revoke(userId: string, id: string): Promise<{ ok: true }> {
    const { data } = await this.supabase.db
      .from('api_keys')
      .select('id, revoked_at')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle()
    if (!data) throw new NotFoundException('API key not found')
    if (!data.revoked_at) {
      const { error } = await this.supabase.db
        .from('api_keys')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', id)
        .eq('user_id', userId)
      if (error) throw new InternalServerErrorException('Failed to revoke API key')
    }
    return { ok: true }
  }

  async verify(rawKey: string): Promise<{ userId: string; keyId: string } | null> {
    if (typeof rawKey !== 'string' || !rawKey.startsWith('bp_live_')) return null
    const hash = hashKey(rawKey)
    const { data } = await this.supabase.db
      .from('api_keys')
      .select('id, user_id, key_hash, revoked_at')
      .eq('key_hash', hash)
      .maybeSingle()
    if (!data || data.revoked_at) return null
    const a = Buffer.from(hash)
    const b = Buffer.from(String(data.key_hash))
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
    await this.supabase.db
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', data.id)
    return { userId: data.user_id, keyId: data.id }
  }
}
