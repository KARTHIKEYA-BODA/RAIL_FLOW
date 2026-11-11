import { test, expect } from '@playwright/test';

test.describe('TrainVision AI OCC Control Room Verification Suite', () => {
  const BASE_URL = process.env.OCC_URL || 'http://127.0.0.1:5173/';

  test('header conflict count matches the Conflicts page', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    // Verify top status badge exists
    const statusConflicts = page.locator('[data-testid="status-conflicts"]');
    await expect(statusConflicts).toBeVisible();

    // Read conflict count from header badge text (e.g. "1 conflict, 2 delays")
    const badgeText = (await statusConflicts.textContent()) || '';
    const match = badgeText.match(/(\d+)\s+conflict/i);
    const expectedCount = match ? parseInt(match[1], 10) : 0;

    // Navigate to Conflicts page via sidebar button
    const conflictsNav = page.getByRole('button', { name: /conflicts/i });
    await conflictsNav.click();

    // Assert that the number of conflict cards matches the header count
    const conflictCards = page.locator('[data-testid="conflict-card"]');
    const actualCardCount = await conflictCards.count();
    expect(actualCardCount).toBe(expectedCount);
  });

  test('no broken dates or absurd delays on any page', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    const viewsToCheck = [
      'Operations',
      'Platforms',
      'Schedule',
      'Timeline',
      'Analytics',
    ];

    for (const viewName of viewsToCheck) {
      const btn = page.getByRole('button', { name: new RegExp(viewName, 'i') });
      if (await btn.isVisible()) {
        await btn.click();
        await page.waitForTimeout(500);

        const bodyContent = await page.innerText('body');

        // 1. Never show "Invalid Date"
        expect(bodyContent).not.toContain('Invalid Date');

        // 2. Never show unhandled "NaN" in metrics or delays
        expect(bodyContent).not.toMatch(/\bNaN\b/);

        // 3. Never show absurd delay overflow bug like +596899.3m
        expect(bodyContent).not.toMatch(/\+\d{5,}m/);
      }
    }
  });

  test('accessibility and semantic control check', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    // Skip to main content link must be present
    const skipLink = page.locator('a[href="#main-content"]');
    await expect(skipLink).toBeAttached();

    // Main landmark must be present
    const mainContent = page.locator('#main-content');
    await expect(mainContent).toBeVisible();

    // Sidebar navigation buttons must be visible and accessible
    const operationsBtn = page.getByRole('button', { name: /operations/i });
    await expect(operationsBtn).toBeVisible();
  });
});
