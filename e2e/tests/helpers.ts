import { expect, type Page } from '@playwright/test';

export async function loginAs(page: Page, user: string) {
  await page.goto('/');
  const current = page.getByTestId('current-user');
  // The session loads asynchronously: wait until we are either signed in or offered a login.
  await expect(current.or(page.getByTestId('demo-login'))).toBeVisible();
  if (await current.isVisible()) {
    if ((await current.innerText()).startsWith(user)) return;
    await page.getByTestId('logout').click();
  }
  await page.getByTestId(`login-${user}`).click();
  await expect(page.getByTestId('current-user')).toContainText(user);
}

/** Pages are server-driven: wait for the screen to finish loading. */
export async function openScreen(page: Page, path: string, testId: string) {
  await page.goto(path);
  await expect(page.getByTestId(testId)).toBeVisible();
}

/** Click a row action in a DataTable row, e.g. ("versions-table", 5, "Activate"). */
export async function rowAction(page: Page, table: string, rowId: string | number, label: string) {
  await page.getByTestId(table).getByTestId(`row-${rowId}`).getByRole('button', { name: label, exact: true }).click();
}

export async function expectToast(page: Page, text: string | RegExp) {
  await expect(page.getByTestId('toast').filter({ hasText: text }).first()).toBeVisible();
}
