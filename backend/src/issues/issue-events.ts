import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthUser } from '../common/interfaces/auth-user.interface';

export interface IssueEvent {
  id: string;
  issue_id: string;
  event_type: 'status' | 'assignee';
  from_value: string | null;
  to_value: string | null;
  actor_name: string;
  source: 'web' | 'mcp';
  created_at: string;
}

const HISTORY_LIMIT = 200;

/**
 * Records a status/assignee change. History is secondary to the change itself, so a
 * failure here (e.g. migration not applied yet) is logged and never fails the request.
 */
export async function recordIssueEvent(
  db: SupabaseClient,
  user: AuthUser,
  issueId: string,
  eventType: IssueEvent['event_type'],
  from: string | null,
  to: string | null,
): Promise<void> {
  if ((from ?? null) === (to ?? null)) return;
  try {
    const { error } = await db.from('issue_events').insert({
      issue_id: issueId,
      event_type: eventType,
      from_value: from,
      to_value: to,
      actor_user_id: user.id,
      actor_name: (user.email ?? '').split('@')[0] || 'unknown',
      source: user.authMethod === 'api_key' ? 'mcp' : 'web',
    });
    if (error) console.warn(`issue_events insert failed: ${error.message}`);
  } catch (e) {
    console.warn(`issue_events insert failed: ${(e as Error).message}`);
  }
}

/** Newest-last history for the detail view; never throws. */
export async function listIssueEvents(db: SupabaseClient, issueId: string): Promise<IssueEvent[]> {
  try {
    const { data, error } = await db
      .from('issue_events')
      .select('*')
      .eq('issue_id', issueId)
      .order('created_at', { ascending: true })
      .limit(HISTORY_LIMIT);
    if (error || !data) return [];
    return data as IssueEvent[];
  } catch {
    return [];
  }
}
