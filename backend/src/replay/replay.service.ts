import { Injectable, NotFoundException } from '@nestjs/common'
import { SupabaseService } from '../supabase/supabase.service'

@Injectable()
export class ReplayService {
  constructor(private supabase: SupabaseService) {}

  async getReplayByToken(token: string) {
    const { data: tokenRow, error } = await this.supabase.db
      .from('replay_tokens')
      .select('id, issue_id, expires_at')
      .eq('id', token)
      .gte('expires_at', new Date().toISOString())
      .single();

    if (error || !tokenRow) throw new NotFoundException('Replay link not found or has expired');

    const { data: issue } = await this.supabase.db
      .from('issues')
      .select('title, severity, replay_storage_path')
      .eq('id', tokenRow.issue_id)
      .single();

    if (!issue?.replay_storage_path) throw new NotFoundException('Replay data not found');

    const { data: signed } = await this.supabase.db.storage
      .from('qa-replays')
      .createSignedUrl(issue.replay_storage_path, 60 * 60 * 24);

    if (!signed?.signedUrl) throw new NotFoundException('Could not generate replay URL');

    return {
      issue: { title: issue.title, severity: issue.severity },
      replayUrl: signed.signedUrl,
      expiresAt: tokenRow.expires_at,
    };
  }
}
