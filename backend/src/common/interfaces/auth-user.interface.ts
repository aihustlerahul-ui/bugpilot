export interface AuthUser {
  id: string
  email: string
  /**
   * True only when Supabase reports the email as confirmed (email_confirmed_at set).
   * Email-based (member) access requires this; owner access does not.
   */
  emailVerified?: boolean
  /** Set for API-key requests: the workspace (X-Workspace-Id) all access is confined to. */
  workspaceId?: string
  authMethod?: 'jwt' | 'api_key'
}
