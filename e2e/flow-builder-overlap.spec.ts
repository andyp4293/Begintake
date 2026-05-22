import { PrismaClient } from '@prisma/client';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const prisma = new PrismaClient();

const TEST_USER = {
  name: 'Codex Overlap Audit',
  email: 'codex-overlap-audit@example.com',
  password: 'overlap-audit-pass',
};

async function cleanupTestUser() {
  const user = await prisma.user.findUnique({
    where: { email: TEST_USER.email },
    select: { id: true },
  });

  if (!user) return;

  await prisma.intakeFlow.deleteMany({
    where: { userId: user.id },
  });

  await prisma.user.delete({
    where: { id: user.id },
  });
}

async function ensureUser(request: APIRequestContext) {
  const response = await request.post('/api/auth/register', {
    data: TEST_USER,
  });

  expect([201, 409]).toContain(response.status());
}

async function signIn(page: Page, request: APIRequestContext) {
  const csrfResponse = await request.get('/api/auth/csrf');
  expect(csrfResponse.ok()).toBe(true);
  const { csrfToken } = await csrfResponse.json();

  const callbackUrl = `${test.info().project.use.baseURL}/flow-builder`;
  const signInResponse = await request.post(
    `/api/auth/callback/credentials?callbackUrl=${encodeURIComponent(callbackUrl)}`,
    {
      form: {
        csrfToken,
        email: TEST_USER.email,
        password: TEST_USER.password,
        callbackUrl,
        json: 'true',
      },
    },
  );

  expect(signInResponse.ok()).toBe(true);

  const storageState = await request.storageState();
  await page.context().addCookies(storageState.cookies);
}

async function createTemplateFlow(request: APIRequestContext, templateId: 'default-intake' | 'general-intake') {
  const response = await request.post('/api/flows/templates', {
    data: { templateId },
  });

  expect(response.status()).toBe(201);
  return response.json();
}

async function createGeneralIntakeFlow(request: APIRequestContext) {
  return createTemplateFlow(request, 'general-intake');
}

async function createDefaultIntakeFlow(request: APIRequestContext) {
  return createTemplateFlow(request, 'default-intake');
}

async function expandEveryVisibleBranch(page: Page) {
  for (let iteration = 0; iteration < 50; iteration += 1) {
    const collapsedCount = await page.evaluate(async () => {
      const collapsedCards = Array.from(document.querySelectorAll<HTMLElement>('[id^="flow-node-"]'))
        .filter((card) => /\d+\s+branch(?:es)?/.test(card.textContent || ''));

      collapsedCards.forEach((card) => {
        card.querySelector<HTMLButtonElement>('button')?.click();
      });

      await new Promise((resolve) => setTimeout(resolve, 25));
      return collapsedCards.length;
    });

    if (collapsedCount === 0) {
      return;
    }
  }

  const remainingCollapsed = await page.locator('text=/\\d+\\s+branches?/').count();
  expect(remainingCollapsed).toBe(0);
}

async function getNodeCardId(page: Page, label: string) {
  const id = await page.evaluate((targetLabel) => {
    const cards = Array.from(document.querySelectorAll<HTMLElement>('[id^="flow-node-"]'));
    const card = cards.find((candidate) => {
      const responseLabel = candidate.querySelector<HTMLElement>('[data-testid^="response-node-title-"]')?.textContent?.trim();
      const inputLabel = candidate.querySelector<HTMLInputElement>('input')?.value?.trim();
      const fallbackLabel = (candidate.textContent || '').replace(/\s+/g, ' ').trim();
      return responseLabel === targetLabel || inputLabel === targetLabel || fallbackLabel === targetLabel;
    });

    return card?.id ?? null;
  }, label);

  expect(id, `Could not find node "${label}"`).toBeTruthy();
  return id!;
}

async function ensureNodeExpanded(page: Page, label: string) {
  const cardId = await getNodeCardId(page, label);
  const card = page.locator(`#${cardId}`);
  const isCollapsed = await page.evaluate((targetCardId) => {
    const target = document.getElementById(targetCardId);
    return /\d+\s+branch(?:es)?/.test(target?.textContent || '');
  }, cardId);

  if (isCollapsed) {
    await card.locator('button').first().evaluate((button: HTMLButtonElement) => button.click());
    await expect.poll(async () => page.evaluate((targetCardId) => {
      const target = document.getElementById(targetCardId);
      return /\d+\s+branch(?:es)?/.test(target?.textContent || '');
    }, cardId), {
      message: `Expected "${label}" to expand`,
    }).toBe(false);
  }

  await page.waitForTimeout(500);
}

async function ensureNodeCollapsed(page: Page, label: string) {
  const cardId = await getNodeCardId(page, label);
  const card = page.locator(`#${cardId}`);
  const isCollapsed = await page.evaluate((targetCardId) => {
    const target = document.getElementById(targetCardId);
    return /\d+\s+branch(?:es)?/.test(target?.textContent || '');
  }, cardId);

  if (!isCollapsed) {
    await card.locator('button').first().evaluate((button: HTMLButtonElement) => button.click());
    await expect.poll(async () => page.evaluate((targetCardId) => {
      const target = document.getElementById(targetCardId);
      return /\d+\s+branch(?:es)?/.test(target?.textContent || '');
    }, cardId), {
      message: `Expected "${label}" to collapse`,
    }).toBe(true);
  }

  await page.waitForTimeout(250);
}

type NodeViewportSnapshot = {
  found: boolean;
  rect: null | {
    left: number;
    right: number;
    top: number;
    bottom: number;
    width: number;
    height: number;
  };
  viewport: {
    width: number;
    height: number;
  };
};

async function getNodeViewportSnapshot(page: Page, label: string): Promise<NodeViewportSnapshot> {
  return page.evaluate((targetLabel) => {
    const cards = Array.from(document.querySelectorAll<HTMLElement>('[id^="flow-node-"]'));
    const card = cards.find((candidate) => {
      const responseLabel = candidate.querySelector<HTMLElement>('[data-testid^="response-node-title-"]')?.textContent?.trim();
      const inputLabel = candidate.querySelector<HTMLInputElement>('input')?.value?.trim();
      return responseLabel === targetLabel || inputLabel === targetLabel;
    });

    if (!card) {
      return {
        found: false,
        rect: null,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      };
    }

    const rect = card.getBoundingClientRect();
    return {
      found: true,
      rect: {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  }, label);
}

async function panNodeIntoViewport(page: Page, label: string) {
  const viewport = page.getByTestId('flow-canvas-viewport');
  const viewportBox = await viewport.boundingBox();
  expect(viewportBox, 'Expected flow canvas viewport bounds').not.toBeNull();

  for (let iteration = 0; iteration < 16; iteration += 1) {
    const snapshot = await getNodeViewportSnapshot(page, label);
    expect(snapshot.found).toBe(true);
    expect(snapshot.rect, JSON.stringify(snapshot, null, 2)).not.toBeNull();

    const rect = snapshot.rect!;
    const visibleLeft = viewportBox!.x + 24;
    const visibleTop = viewportBox!.y + 24;
    const visibleRight = viewportBox!.x + viewportBox!.width - 24;
    const visibleBottom = viewportBox!.y + viewportBox!.height - 24;
    const isVisible = (
      rect.left >= visibleLeft
      && rect.top >= visibleTop
      && rect.right <= visibleRight
      && rect.bottom <= visibleBottom
    );
    if (isVisible) return;

    const desiredCenterX = viewportBox!.x + (viewportBox!.width * 0.55);
    const desiredCenterY = viewportBox!.y + (viewportBox!.height * 0.35);
    const currentCenterX = rect.left + (rect.width / 2);
    const currentCenterY = rect.top + (rect.height / 2);
    const deltaX = Math.max(Math.min(desiredCenterX - currentCenterX, 640), -640);
    const deltaY = Math.max(Math.min(desiredCenterY - currentCenterY, 640), -640);
    const startX = viewportBox!.x + (viewportBox!.width / 2);
    const startY = viewportBox!.y + (viewportBox!.height / 2);

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(250);
  }

  const finalSnapshot = await getNodeViewportSnapshot(page, label);
  throw new Error(`Could not pan "${label}" into view: ${JSON.stringify(finalSnapshot, null, 2)}`);
}

type OverlapPair = {
  a: { id: string; label: string; left: number; top: number };
  b: { id: string; label: string; left: number; top: number };
  overlapX: number;
  overlapY: number;
};

async function collectOverlaps(page: Page): Promise<OverlapPair[]> {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('[id^="flow-node-"]'))
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const label = el.querySelector<HTMLElement>('[data-testid^="response-node-title-"]')?.textContent
          || el.querySelector<HTMLInputElement>('input')?.value
          || (el.textContent || '').replace(/\s+/g, ' ').trim();

        return {
          id: el.id.replace('flow-node-', ''),
          label,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      })
      .filter((node) => node.width > 0 && node.height > 0);

    const overlaps: OverlapPair[] = [];

    for (let index = 0; index < nodes.length; index += 1) {
      for (let candidateIndex = index + 1; candidateIndex < nodes.length; candidateIndex += 1) {
        const a = nodes[index];
        const b = nodes[candidateIndex];
        const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);

        if (overlapX > 8 && overlapY > 8) {
          overlaps.push({
            a: { id: a.id, label: a.label, left: a.left, top: a.top },
            b: { id: b.id, label: b.label, left: b.left, top: b.top },
            overlapX,
            overlapY,
          });
        }
      }
    }

    return overlaps
      .sort((left, right) => (right.overlapX * right.overlapY) - (left.overlapX * left.overlapY))
      .slice(0, 25);
  });
}

async function collectViewportOverlaps(page: Page): Promise<OverlapPair[]> {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('[id^="flow-node-"]'))
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const label = el.querySelector<HTMLElement>('[data-testid^="response-node-title-"]')?.textContent
          || el.querySelector<HTMLInputElement>('input')?.value
          || (el.textContent || '').replace(/\s+/g, ' ').trim();

        return {
          id: el.id.replace('flow-node-', ''),
          label,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      })
      .filter((node) => (
        node.width > 0
        && node.height > 0
        && node.right > 0
        && node.bottom > 0
        && node.left < window.innerWidth
        && node.top < window.innerHeight
      ));

    const overlaps: OverlapPair[] = [];

    for (let index = 0; index < nodes.length; index += 1) {
      for (let candidateIndex = index + 1; candidateIndex < nodes.length; candidateIndex += 1) {
        const a = nodes[index];
        const b = nodes[candidateIndex];
        const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);

        if (overlapX > 8 && overlapY > 8) {
          overlaps.push({
            a: { id: a.id, label: a.label, left: a.left, top: a.top },
            b: { id: b.id, label: b.label, left: b.left, top: b.top },
            overlapX,
            overlapY,
          });
        }
      }
    }

    return overlaps
      .sort((left, right) => (right.overlapX * right.overlapY) - (left.overlapX * left.overlapY))
      .slice(0, 25);
  });
}

async function collectAuditedOverlaps(page: Page): Promise<OverlapPair[]> {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-overlap-audit="true"]'))
      .map((el, index) => {
        const rect = el.getBoundingClientRect();
        const label = el.dataset.overlapLabel
          || el.querySelector<HTMLElement>('[data-testid^="response-node-title-"]')?.textContent
          || el.querySelector<HTMLInputElement>('input')?.value
          || (el.textContent || '').replace(/\s+/g, ' ').trim();
        const kind = el.dataset.overlapKind || 'unknown';

        return {
          id: el.id || `${kind}-${index}`,
          label: `${kind}: ${label}`,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      })
      .filter((node) => node.width > 0 && node.height > 0);

    const overlaps: OverlapPair[] = [];

    for (let index = 0; index < nodes.length; index += 1) {
      for (let candidateIndex = index + 1; candidateIndex < nodes.length; candidateIndex += 1) {
        const a = nodes[index];
        const b = nodes[candidateIndex];
        const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);

        if (overlapX > 8 && overlapY > 8) {
          overlaps.push({
            a: { id: a.id, label: a.label, left: a.left, top: a.top },
            b: { id: b.id, label: b.label, left: b.left, top: b.top },
            overlapX,
            overlapY,
          });
        }
      }
    }

    return overlaps
      .sort((left, right) => (right.overlapX * right.overlapY) - (left.overlapX * left.overlapY))
      .slice(0, 25);
  });
}

async function collectAuditedViewportOverlaps(page: Page): Promise<OverlapPair[]> {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-overlap-audit="true"]'))
      .map((el, index) => {
        const rect = el.getBoundingClientRect();
        const label = el.dataset.overlapLabel
          || el.querySelector<HTMLElement>('[data-testid^="response-node-title-"]')?.textContent
          || el.querySelector<HTMLInputElement>('input')?.value
          || (el.textContent || '').replace(/\s+/g, ' ').trim();
        const kind = el.dataset.overlapKind || 'unknown';

        return {
          id: el.id || `${kind}-${index}`,
          label: `${kind}: ${label}`,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      })
      .filter((node) => (
        node.width > 0
        && node.height > 0
        && node.right > 0
        && node.bottom > 0
        && node.left < window.innerWidth
        && node.top < window.innerHeight
      ));

    const overlaps: OverlapPair[] = [];

    for (let index = 0; index < nodes.length; index += 1) {
      for (let candidateIndex = index + 1; candidateIndex < nodes.length; candidateIndex += 1) {
        const a = nodes[index];
        const b = nodes[candidateIndex];
        const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);

        if (overlapX > 8 && overlapY > 8) {
          overlaps.push({
            a: { id: a.id, label: a.label, left: a.left, top: a.top },
            b: { id: b.id, label: b.label, left: b.left, top: b.top },
            overlapX,
            overlapY,
          });
        }
      }
    }

    return overlaps
      .sort((left, right) => (right.overlapX * right.overlapY) - (left.overlapX * left.overlapY))
      .slice(0, 25);
  });
}

test.describe('Flow Builder overlap audit', () => {
  test.describe.configure({ mode: 'serial' });

  test.afterAll(async () => {
    await cleanupTestUser();
    await prisma.$disconnect();
  });

  test('general intake starts with branch responses collapsed and without overlapping visible nodes', async ({ page, request }) => {
    test.setTimeout(90_000);

    await cleanupTestUser();
    await ensureUser(request);
    await signIn(page, request);

    const flow = await createGeneralIntakeFlow(request);

    try {
      await page.goto(`/flow-builder/${flow.id}`);
      await page.waitForSelector('[data-testid="flow-canvas-viewport"]');
      await page.waitForTimeout(500);

      const remainingCollapsed = await page.locator('text=/\\d+\\s+branches?/').count();
      expect(remainingCollapsed).toBeGreaterThan(0);

      const overlaps = await collectOverlaps(page);
      expect(overlaps, JSON.stringify(overlaps, null, 2)).toEqual([]);
    } finally {
      await request.delete(`/api/flows/${flow.id}`);
      await cleanupTestUser();
    }
  });

  test('general intake stays separated when every visible branch is expanded', async ({ page, request }) => {
    test.setTimeout(120_000);

    await cleanupTestUser();
    await ensureUser(request);
    await signIn(page, request);

    const flow = await createGeneralIntakeFlow(request);

    try {
      await page.setViewportSize({ width: 2048, height: 976 });
      await page.goto(`/flow-builder/${flow.id}`);
      await page.waitForSelector('[data-testid="flow-canvas-viewport"]');
      await page.waitForTimeout(1200);

      await expandEveryVisibleBranch(page);
      await page.waitForTimeout(1200);

      const overlaps = await collectAuditedOverlaps(page);
      expect(overlaps, JSON.stringify(overlaps, null, 2)).toEqual([]);
    } finally {
      await request.delete(`/api/flows/${flow.id}`);
      await cleanupTestUser();
    }
  });

  test('default reception intake starts without overlapping audited elements', async ({ page, request }) => {
    test.setTimeout(90_000);

    await cleanupTestUser();
    await ensureUser(request);
    await signIn(page, request);

    const flow = await createDefaultIntakeFlow(request);

    try {
      await page.setViewportSize({ width: 2048, height: 976 });
      await page.goto(`/flow-builder/${flow.id}`);
      await page.waitForSelector('[data-testid="flow-canvas-viewport"]');
      await page.waitForTimeout(1200);

      const overlaps = await collectAuditedOverlaps(page);
      expect(overlaps, JSON.stringify(overlaps, null, 2)).toEqual([]);
    } finally {
      await request.delete(`/api/flows/${flow.id}`);
      await cleanupTestUser();
    }
  });

  test('default reception intake stays separated through representative category toggles', async ({ page, request }) => {
    test.setTimeout(120_000);

    await cleanupTestUser();
    await ensureUser(request);
    await signIn(page, request);

    const flow = await createDefaultIntakeFlow(request);

    try {
      await page.setViewportSize({ width: 2048, height: 976 });
      await page.goto(`/flow-builder/${flow.id}`);
      await page.waitForSelector('[data-testid="flow-canvas-viewport"]');
      await page.waitForTimeout(1200);

      for (const label of [
        'Group A. Family, Immigration, or Criminal',
        'Group B. Injury, Employment, or Civil Rights',
        'Group C. Business, Property, Tax, or IP',
        'Group D. Bankruptcy, Estate, Environmental, or Other',
        'Immigration - Preferred Next Step',
        'Personal Injury - Preferred Next Step',
        'Criminal Defense - Preferred Next Step',
      ]) {
        await ensureNodeCollapsed(page, label);
        await ensureNodeExpanded(page, label);
        const overlaps = await collectAuditedOverlaps(page);
        expect(overlaps, `Overlap after toggling "${label}": ${JSON.stringify(overlaps, null, 2)}`).toEqual([]);
      }

      await panNodeIntoViewport(page, 'Personal Injury - Preferred Next Step');
      await page.waitForTimeout(500);

      const viewportOverlaps = await collectAuditedViewportOverlaps(page);
      expect(viewportOverlaps, JSON.stringify(viewportOverlaps, null, 2)).toEqual([]);
    } finally {
      await request.delete(`/api/flows/${flow.id}`);
      await cleanupTestUser();
    }
  });

  test('default reception intake stays separated when every visible branch is expanded', async ({ page, request }) => {
    test.setTimeout(120_000);

    await cleanupTestUser();
    await ensureUser(request);
    await signIn(page, request);

    const flow = await createDefaultIntakeFlow(request);

    try {
      await page.setViewportSize({ width: 2048, height: 976 });
      await page.goto(`/flow-builder/${flow.id}`);
      await page.waitForSelector('[data-testid="flow-canvas-viewport"]');
      await page.waitForTimeout(1200);

      await expandEveryVisibleBranch(page);
      await page.waitForTimeout(1200);

      const overlaps = await collectAuditedOverlaps(page);
      expect(overlaps, JSON.stringify(overlaps, null, 2)).toEqual([]);
    } finally {
      await request.delete(`/api/flows/${flow.id}`);
      await cleanupTestUser();
    }
  });

  test('expanding a large subtree keeps the clicked node in view', async ({ page, request }) => {
    test.setTimeout(90_000);

    await cleanupTestUser();
    await ensureUser(request);
    await signIn(page, request);

    const flow = await createGeneralIntakeFlow(request);

    try {
      await page.goto(`/flow-builder/${flow.id}`);
      await page.waitForSelector('[data-testid="flow-canvas-viewport"]');

      await ensureNodeExpanded(page, 'Q5. Tell Me What\'s Going On');
      await ensureNodeExpanded(page, 'Tax Law');
      await panNodeIntoViewport(page, 'Tax Law - Matter Type');
      await ensureNodeCollapsed(page, 'Tax Law - Matter Type');
      await ensureNodeExpanded(page, 'Tax Law - Matter Type');
      await page.waitForTimeout(700);

      const snapshot = await getNodeViewportSnapshot(page, 'Tax Law - Matter Type');
      expect(snapshot.found).toBe(true);
      expect(snapshot.rect, JSON.stringify(snapshot, null, 2)).not.toBeNull();
      expect(snapshot.rect!.left, JSON.stringify(snapshot, null, 2)).toBeGreaterThanOrEqual(0);
      expect(snapshot.rect!.top, JSON.stringify(snapshot, null, 2)).toBeGreaterThanOrEqual(0);
      expect(snapshot.rect!.right, JSON.stringify(snapshot, null, 2)).toBeLessThanOrEqual(snapshot.viewport.width);
      expect(snapshot.rect!.bottom, JSON.stringify(snapshot, null, 2)).toBeLessThanOrEqual(snapshot.viewport.height);
    } finally {
      await request.delete(`/api/flows/${flow.id}`);
      await cleanupTestUser();
    }
  });

  test('partially expanded adjacent large branches keep visible nodes from overlapping', async ({ page, request }) => {
    test.setTimeout(90_000);

    await cleanupTestUser();
    await ensureUser(request);
    await signIn(page, request);

    const flow = await createGeneralIntakeFlow(request);

    try {
      await page.setViewportSize({ width: 1728, height: 1117 });
      await page.goto(`/flow-builder/${flow.id}`);
      await page.waitForSelector('[data-testid="flow-canvas-viewport"]');

      await ensureNodeExpanded(page, 'Q5. Tell Me What\'s Going On');
      await ensureNodeExpanded(page, 'Bankruptcy');
      await ensureNodeExpanded(page, 'Bankruptcy - Type');
      await ensureNodeExpanded(page, 'Tax Law');
      await ensureNodeExpanded(page, 'Tax Law - Matter Type');
      await page.waitForTimeout(1000);

      const overlaps = await collectViewportOverlaps(page);
      expect(overlaps, JSON.stringify(overlaps, null, 2)).toEqual([]);
    } finally {
      await request.delete(`/api/flows/${flow.id}`);
      await cleanupTestUser();
    }
  });

  test('opening employment, bankruptcy, and tax routing paths keeps all rendered nodes separated', async ({ page, request }) => {
    test.setTimeout(90_000);

    await cleanupTestUser();
    await ensureUser(request);
    await signIn(page, request);

    const flow = await createGeneralIntakeFlow(request);

    try {
      await page.setViewportSize({ width: 991, height: 1293 });
      await page.goto(`/flow-builder/${flow.id}`);
      await page.waitForSelector('[data-testid="flow-canvas-viewport"]');

      for (const label of [
        'Q5. Tell Me What\'s Going On',
        'Employment',
        'Employment - Matter Type',
        'Bankruptcy',
        'Bankruptcy - Type',
        'Tax Law',
        'Tax Law - Matter Type',
      ]) {
        await ensureNodeExpanded(page, label);
      }

      await page.waitForTimeout(1000);

      for (const label of [
        'Other employment or HR matter',
        'Chapter 7 - wipe out most debts (liquidation)',
        'IRS or state tax audit',
        'Flag: Emp - Other',
        'Flag: Bankruptcy - Chapter 7',
        'Flag: Tax - Audit',
        'Bank H1. Primary Debt Type',
      ]) {
        await getNodeCardId(page, label);
      }

      const overlaps = await collectOverlaps(page);
      expect(overlaps, JSON.stringify(overlaps, null, 2)).toEqual([]);
    } finally {
      await request.delete(`/api/flows/${flow.id}`);
      await cleanupTestUser();
    }
  });

});
