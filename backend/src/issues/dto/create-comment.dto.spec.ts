import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateCommentDto } from './create-comment.dto';

const pipe = new ValidationPipe({ whitelist: true, transform: true });
const meta: ArgumentMetadata = { type: 'body', metatype: CreateCommentDto };

describe('CreateCommentDto', () => {
  it.each(['   ', '\n\t'])('rejects whitespace-only body %j', async (body) => {
    await expect(pipe.transform({ body }, meta)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('accepts normal text', async () => {
    const out = await pipe.transform({ body: 'ok' }, meta);
    expect(out.body).toBe('ok');
  });
  it('rejects over 5000 chars', async () => {
    await expect(pipe.transform({ body: 'a'.repeat(5001) }, meta)).rejects.toBeInstanceOf(BadRequestException);
  });
});
