import { validate } from 'class-validator';
import { UpdateStatusDto, TRIAGE_STATUSES, TriageStatus } from './update-status.dto';

describe('UpdateStatusDto', () => {
  it('validates successfully for all valid triage statuses', async () => {
    for (const status of TRIAGE_STATUSES) {
      const dto = new UpdateStatusDto();
      dto.status = status;
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    }
  });

  it('fails validation when status is invalid', async () => {
    const dto = new UpdateStatusDto();
    (dto as any).status = 'invalid_status';
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('status');
  });

  it('fails validation when status is empty', async () => {
    const dto = new UpdateStatusDto();
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
