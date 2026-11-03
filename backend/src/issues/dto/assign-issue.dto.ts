import { IsOptional, IsUUID } from 'class-validator';

export class AssignIssueDto {
  /** Workspace member id to assign, or null to clear the assignee. */
  @IsOptional()
  @IsUUID()
  memberId: string | null;
}
