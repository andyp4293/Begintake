import { test, expect } from '@playwright/test';

test.describe('File Upload API', () => {
  test('upload endpoint returns 401 without auth', async ({ request }) => {
    const res = await request.post('/api/documents/upload', {
      multipart: {
        file: {
          name: 'test.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('test content'),
        },
      },
    });
    expect(res.status()).toBe(401);
  });
});
