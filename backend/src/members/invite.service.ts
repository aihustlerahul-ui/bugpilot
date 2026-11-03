import { Injectable, Logger } from '@nestjs/common'
import { SupabaseService } from '../supabase/supabase.service'

export interface InviteResult {
  sent: boolean
  reason?: 'already-registered' | 'error'
}

@Injectable()
export class InviteService {
  private readonly logger = new Logger(InviteService.name)

  constructor(private readonly supabase: SupabaseService) {}

  /** Never throws: callers must not fail because an invite could not be sent. */
  async sendProjectInvite(email: string, projectName: string): Promise<InviteResult> {
    try {
      const platformUrl = process.env.PLATFORM_URL ?? 'http://localhost:3000'
      const { error } = await this.supabase.db.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${platformUrl}/login`,
      })
      if (!error) return { sent: true }

      if (this.isAlreadyRegistered(error)) {
        // No sender exists yet for existing users; they already have access via their account.
        this.logger.warn(`Invite skipped for project "${projectName}": user already registered (no notification sent)`)
        return { sent: false, reason: 'already-registered' }
      }
      this.logger.warn(`Invite failed for project "${projectName}": ${error.message ?? 'unknown error'}`)
      return { sent: false, reason: 'error' }
    } catch (err: any) {
      this.logger.warn(`Invite failed for project "${projectName}": ${err?.message ?? 'unknown error'}`)
      return { sent: false, reason: 'error' }
    }
  }

  private isAlreadyRegistered(error: { status?: number; code?: string; message?: string }): boolean {
    return (
      error.status === 422 ||
      error.code === 'email_exists' ||
      (error.message ?? '').toLowerCase().includes('already')
    )
  }
}
