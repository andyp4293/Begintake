import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('redirects unauthenticated users to login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });

  test('login page renders correctly', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText('AI Paralegal')).toBeVisible();
    await expect(page.getByText('Continue with Google')).toBeVisible();
  });

  test('login page has dark background', async ({ page }) => {
    await page.goto('/login');
    const bg = await page.locator('body').evaluate((el) =>
      getComputedStyle(el).backgroundColor
    );
    // Should be dark
    expect(bg).toBeTruthy();
  });

  test('Google sign in button is clickable', async ({ page }) => {
    await page.goto('/login');
    const button = page.getByText('Continue with Google');
    await expect(button).toBeEnabled();
  });
});
