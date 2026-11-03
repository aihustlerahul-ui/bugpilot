import { Injectable } from '@nestjs/common'
import { ThrottlerGuard } from '@nestjs/throttler'

// Login is keyed on ip + email so one tester can't lock out others sharing an IP,
// while one address still can't brute-force a single account. Refresh has no email
// in the body, so it falls back to ip only.
@Injectable()
export class AuthThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const email = req.body?.email
    const ip = req.ip ?? 'unknown'
    return typeof email === 'string' && email
      ? `${ip}:${email.trim().toLowerCase()}`
      : ip
  }
}
