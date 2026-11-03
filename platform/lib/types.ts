export type SyncStatus = 'pending' | 'synced' | 'failed'
export type SyncMode = 'auto' | 'manual'

export interface Workspace { id: string; name: string; owner_id: string; created_at: string }

export interface ProjectSettings {
  default_view?: 'table' | 'kanban' | 'gallery'
  description?: string
  [key: string]: unknown
}

export interface Project {
  id: string
  workspace_id: string
  name: string
  sync_mode: SyncMode
  settings?: ProjectSettings
  created_at: string
}


export interface NetworkTransaction {
  id?: string
  method: string
  url: string
  status: number | string
  statusText?: string
  duration: number
  timestamp?: string
  requestHeaders?: Record<string, string>
  requestBody?: string | null
  responseHeaders?: Record<string, string>
  responseBody?: string | null
  error?: string | null
  initiator?: string
}

export interface IssueMetadata {
  is_pinned?: boolean
  pinned?: boolean
  retention_cleaned_at?: string
  screenshots?: { label: string; url: string }[]
  pageContext?:        { route?: string; title?: string; hash?: string; queryParams?: Record<string, string>; scrollPosition?: { x: number; y: number }; localStorageKeys?: string[]; sessionStorageKeys?: string[]; cookieNames?: string[] } | null
  performanceMetrics?: { domContentLoadedMs?: number; pageLoadMs?: number; ttfbMs?: number; firstPaintMs?: number; firstContentfulPaintMs?: number; transferSizeBytes?: number; userTimingMarks?: { name: string; time: number }[] } | null
  appState?:           { reactRouterState?: { idx?: number; key?: string; usr?: unknown }; zustandStoreKeys?: string[] } | null
  consoleErrors?:      { level: string; message: string; timestamp: string }[]
  networkErrors?:      NetworkTransaction[] | { method: string; url: string; status: number | string; duration: number; timestamp?: string }[]
  networkTransactions?: NetworkTransaction[]
  navigationHistory?:  { url: string; timestamp: string }[]
  expectedResult?:     string | null
  actualResult?:       string | null
  priority?:           string | null
  environment?:        string | null
  labels?:             string[] | null
  sprint?:             string | null
  assignee?:           string | null
  domContext?:         { tag?: string; id?: string; className?: string; role?: string; textSnippet?: string; attributes?: Record<string, string>; parentTag?: string; siblingCount?: number; [key: string]: unknown } | null
  recordedSteps?:      Array<{ type: string; selector?: string; targetTag?: string; text?: string; value?: string; url?: string; route?: string; timestamp?: string; [key: string]: unknown }> | null
}

export interface TeamMember {
  id: string
  workspace_id: string
  name: string
  email: string
  role?: string
  created_at: string
}

export type MemberConflictCode = 'EMAIL_CONFLICT' | 'NAME_CONFLICT'
export interface MemberConflict {
  code: MemberConflictCode
  existing: TeamMember
}

export type IssueTriageStatus =
  | 'Incoming'
  | 'In Triage'
  | 'Confirmed'
  | 'In Dev'
  | 'Resolved'
  | 'Closed'

export const ISSUE_TRIAGE_STATUSES: IssueTriageStatus[] = [
  'Incoming',
  'In Triage',
  'Confirmed',
  'In Dev',
  'Resolved',
  'Closed',
]

export interface Issue {
  id: string
  project_id: string
  reporter_id: string
  title: string | null
  description: string
  status?: IssueTriageStatus
  triage_status?: IssueTriageStatus
  severity: string | null
  url: string | null
  route: string | null
  browser_info: Record<string, unknown> | null
  element_info: Record<string, unknown> | null
  screenshot_url: string | null
  element_screenshot_url: string | null
  metadata: IssueMetadata | null
  sync_status: SyncStatus
  external_ticket_id: string | null
  external_ticket_url: string | null
  created_at: string
  replay_storage_path?: string | null
  video_storage_path?: string | null
  replayUrl?: string | null
  videoUrl?: string | null
  webcamUrl?: string | null
  thumbnailUrl?: string | null
  projectName?: string
}

export interface DashboardMetrics {
  total: number
  open: number
  critical: number
  resolved: number
  trend: { date: string; count: number }[]
  recentIssues: Issue[]
}
