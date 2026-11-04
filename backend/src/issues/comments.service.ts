import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service';
import { SupabaseService } from '../supabase/supabase.service';
import { AccessService } from '../access/access.service';
import type { AuthUser } from '../common/interfaces/auth-user.interface';

export interface IssueComment {
  id: string;
  issue_id: string;
  author_user_id: string | null;
  author_name: string;
  body: string;
  source: 'web' | 'mcp';
  created_at: string;
}

@Injectable()
export class CommentsService {
  constructor(
    private supabase: SupabaseService,
    private access: AccessService,
    @Optional() private notifications?: NotificationsService,
  ) {}

  private async assertAccess(user: AuthUser, issueId: string) {
    const { data: issue } = await this.supabase.db
      .from('issues')
      .select('id, project_id')
      .eq('id', issueId)
      .maybeSingle();
    if (!issue) throw new NotFoundException('Issue not found');
    const role = await this.access.getProjectRole(user, issue.project_id);
    if (!role) throw new NotFoundException('Issue not found');
  }

  async list(user: AuthUser, issueId: string): Promise<IssueComment[]> {
    await this.assertAccess(user, issueId);
    const { data, error } = await this.supabase.db
      .from('issue_comments')
      .select('*')
      .eq('issue_id', issueId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as IssueComment[];
  }

  async add(
    user: AuthUser,
    issueId: string,
    body: string,
    source: 'web' | 'mcp',
  ): Promise<IssueComment> {
    await this.assertAccess(user, issueId);
    const authorName = (user.email ?? '').split('@')[0] || 'unknown';
    const { data, error } = await this.supabase.db
      .from('issue_comments')
      .insert({
        issue_id: issueId,
        author_user_id: user.id,
        author_name: authorName,
        body,
        source,
      })
      .select()
      .single();
    if (error || !data) throw new Error(error?.message ?? 'Failed to add comment');
    void this.notifications?.notifyComment(user, issueId, body);
    return data as IssueComment;
  }
}
