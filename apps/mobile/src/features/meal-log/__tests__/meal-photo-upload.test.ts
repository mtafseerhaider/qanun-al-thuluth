import { isAlreadyUploaded } from '../utils/image-rules';

describe('meal photo upload replay (S7-03)', () => {
  it('treats an existing object as an uploaded photo', () => {
    expect(isAlreadyUploaded({ statusCode: '409', message: 'The resource already exists' })).toBe(
      true,
    );
    expect(isAlreadyUploaded({ message: 'Duplicate' })).toBe(true);
  });

  it('keeps other storage errors as failures', () => {
    expect(
      isAlreadyUploaded({ statusCode: '403', message: 'new row violates row-level security' }),
    ).toBe(false);
    expect(isAlreadyUploaded({ message: 'Payload too large' })).toBe(false);
  });
});
