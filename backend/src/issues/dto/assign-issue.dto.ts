import { IsUUID, ValidateIf } from 'class-validator';

export class AssignIssueDto {
  /**
   * Workspace member id to assign, or an explicit null to clear the assignee.
   * A missing key is rejected (400) so a typo'd/stripped key can never silently clear.
   */
  @ValidateIf((o) => o.memberId !== null)
  @IsUUID()
  memberId: string | null;
}
