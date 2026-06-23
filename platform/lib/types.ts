export type SyncStatus = 'pending' | 'synced' | 'failed'
export type SyncMode = 'auto' | 'manual'

export interface Workspace { id: string; name: string; owner_id: string; created_at: string }
export interface Project { id: string; workspace_id: string; name: string; sync_mode: SyncMode; created_at: string }
export interface Issue {
  id: string; project_id: string; reporter_id: string
  description: string; url: string | null; route: string | null
  browser_info: Record<string, string> | null
  element_info: Record<string, string> | null
  screenshot_url: string | null; element_screenshot_url: string | null
  sync_status: SyncStatus; external_ticket_id: string | null
  external_ticket_url: string | null; created_at: string
}
