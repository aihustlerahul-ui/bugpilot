export interface AuthUser {
  id: string
  email: string
  /**
   * True only when Supabase reports the email as confirmed (email_confirmed_at set).
   * Email-based (member) access requires this; owner access does not.
   */
  emailVerified?: boolean
}
