export type SyncStatus = 'pending' | 'synced' | 'failed'
export type SyncMode = 'auto' | 'manual'

export interface Workspace { id: string; name: string; owner_id: string; created_at: string }
export interface Project { id: string; workspace_id: string; name: string; sync_mode: SyncMode; created_at: string }

export interface IssueMetadata {
  pageContext?:        { route?: string; title?: string; hash?: string; queryParams?: Record<string, string>; scrollPosition?: { x: number; y: number }; localStorageKeys?: string[]; sessionStorageKeys?: string[]; cookieNames?: string[] } | null
  performanceMetrics?: { domContentLoadedMs?: number; pageLoadMs?: number; ttfbMs?: number; firstPaintMs?: number; firstContentfulPaintMs?: number; transferSizeBytes?: number; userTimingMarks?: { name: string; time: number }[] } | null
  appState?:           { reactRouterState?: { idx?: number; key?: string; usr?: unknown }; zustandStoreKeys?: string[] } | null
  consoleErrors?:      { level: string; message: string; timestamp: string }[]
  networkErrors?:      { method: string; url: string; status: number | string; duration: number; timestamp: string }[]
  navigationHistory?:  { url: string; timestamp: string }[]
  expectedResult?:     string | null
  actualResult?:       string | null
  priority?:           string | null
  environment?:        string | null
  labels?:             string[] | null
  sprint?:             string | null
  assignee?:           string | null
}

export interface TeamMember {
  id: string
  workspace_id: string
  name: string
  email: string
  created_at: string
}

export type MemberConflictCode = 'EMAIL_CONFLICT' | 'NAME_CONFLICT'
export interface MemberConflict {
  code: MemberConflictCode
  existing: TeamMember
}

export interface Issue {
  id: string; project_id: string; reporter_id: string
  title: string | null
  description: string
  severity: string | null
  url: string | null; route: string | null
  browser_info: Record<string, unknown> | null
  element_info: Record<string, unknown> | null
  screenshot_url: string | null; element_screenshot_url: string | null
  metadata: IssueMetadata | null
  sync_status: SyncStatus; external_ticket_id: string | null
  external_ticket_url: string | null; created_at: string
}
