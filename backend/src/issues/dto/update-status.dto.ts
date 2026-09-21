import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export const TRIAGE_STATUSES = [
  'Incoming',
  'In Triage',
  'Confirmed',
  'In Dev',
  'Resolved',
  'Closed',
] as const;

export type TriageStatus = (typeof TRIAGE_STATUSES)[number];

export class UpdateStatusDto {
  @IsString()
  @IsNotEmpty()
  @IsIn([...TRIAGE_STATUSES])
  status: TriageStatus;
}
