import { test, expect } from '@playwright/test';

test.describe('Dashboard', () => {
  // These tests require authentication to be set up.
  // In a real CI environment, you'd seed a test user and inject session cookies.

  test('login page loads without errors', async ({ page }) => {
    const response = await page.goto('/login');
    expect(response?.status()).toBe(200);
  });

  test('login page has correct title', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveTitle(/AI Paralegal/);
  });

  test('API returns 401 when not authenticated', async ({ request }) => {
    const res = await request.get('/api/calls');
    expect(res.status()).toBe(401);
  });

  test('API /api/lawyers returns 401 when not authenticated', async ({ request }) => {
    const res = await request.get('/api/lawyers');
    expect(res.status()).toBe(401);
  });

  test('API /api/appointments returns 401 when not authenticated', async ({ request }) => {
    const res = await request.get('/api/appointments');
    expect(res.status()).toBe(401);
  });

  test('API /api/documents returns 401 when not authenticated', async ({ request }) => {
    const res = await request.get('/api/documents');
    expect(res.status()).toBe(401);
  });

  test('VAPI webhook accepts POST requests', async ({ request }) => {
    const res = await request.post('/api/webhooks/vapi', {
      data: { message: { type: 'unknown' } },
    });
    // Should not return 404 or 405
    expect([200, 401, 500]).toContain(res.status());
  });
});
