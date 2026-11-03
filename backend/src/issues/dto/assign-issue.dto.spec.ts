import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { AssignIssueDto } from './assign-issue.dto';

const pipe = new ValidationPipe({ whitelist: true, transform: true });
const meta: ArgumentMetadata = { type: 'body', metatype: AssignIssueDto };
const UUID = '3f8e6c1a-4b2d-4e5f-8a9b-1c2d3e4f5a6b';

describe('AssignIssueDto', () => {
  it('rejects an empty body (would otherwise silently clear)', async () => {
    await expect(pipe.transform({}, meta)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('rejects a typo\'d key (stripped by whitelist)', async () => {
    await expect(pipe.transform({ member_id: UUID }, meta)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('accepts explicit null (clear)', async () => {
    const out = await pipe.transform({ memberId: null }, meta);
    expect(out.memberId).toBeNull();
  });
  it('accepts a valid uuid', async () => {
    const out = await pipe.transform({ memberId: UUID }, meta);
    expect(out.memberId).toBe(UUID);
  });
  it('rejects a non-uuid', async () => {
    await expect(pipe.transform({ memberId: 'not-a-uuid' }, meta)).rejects.toBeInstanceOf(BadRequestException);
  });
});
