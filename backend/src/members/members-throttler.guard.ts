import { Injectable } from '@nestjs/common'
import { ThrottlerGuard } from '@nestjs/throttler'

/** Routes that can send invite emails: 20 per user per hour. */
export const INVITE_THROTTLE = { default: { limit: 20, ttl: 60 * 60 * 1000 } }

// Keyed on the authenticated user (SupabaseAuthGuard runs first, as a class-level guard,
// and sets req.user); falls back to ip if no user is present.
@Injectable()
export class MembersThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const userId = req.user?.id
    return typeof userId === 'string' && userId ? `user:${userId}` : `ip:${req.ip ?? 'unknown'}`
  }
}
