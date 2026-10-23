import { test, expect, open } from './fixtures';

test.use({ as: 'user-mia' });

test('the rules list shows each rule in order, in plain language, with its state', async ({ page, consoleErrors }) => {
  await open(page, '/mail/rules');
  await expect(page.getByRole('heading', { level: 1, name: 'Rules' })).toBeVisible();
  const landcare = page.locator('li.rule', { has: page.getByRole('heading', { name: 'Landcare bulletins' }) });
  await expect(landcare).toContainText('From landcare.banksia.test');
  await expect(landcare).toContainText('Subject includes "urgent"');
  await expect(landcare).toContainText('Move to Archive');
  await expect(landcare).toContainText('Mark as read');
  await expect(landcare).toContainText('On');
  const large = page.locator('li.rule', { has: page.getByRole('heading', { name: 'Large attachments' }) });
  await expect(large).toContainText('Off');
  await expect(large.getByRole('button', { name: 'Turn on Large attachments' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Rules', exact: true })).toHaveAttribute('aria-current', 'page');
  expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
});

test('create, turn off, edit and delete a rule', async ({ page }, info) => {
  const name = `E2E rule ${info.project.name}`;
  await open(page, '/mail/rules');
  await page.getByRole('link', { name: 'New rule' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'New rule' })).toBeVisible();

  await page.getByLabel('Name').fill(name);
  await page.getByRole('textbox', { name: 'From' }).fill('rules-e2e.example');
  await page.getByRole('combobox', { name: 'Add an action' }).selectOption('markAsRead');
  await page.getByRole('combobox', { name: 'Add an exception' }).selectOption('importance');
  const preview = page.getByRole('complementary', { name: 'Rule summary' });
  await expect(preview).toContainText('From rules-e2e.example');
  await expect(preview).toContainText('Importance is high');
  await expect(preview).toContainText('Move to Archive');
  await page.getByRole('button', { name: 'Save rule' }).click();

  await expect(page).toHaveURL(/\/mail\/rules\?mailbox=mb-mia&saved=created$/);
  await expect(page.getByRole('status')).toHaveText('Rule created.');
  const card = page.locator('li.rule', { has: page.getByRole('heading', { name }) });
  await expect(card).toContainText('From rules-e2e.example');
  await expect(card).toContainText('Except if');

  await card.getByRole('button', { name: `Turn off ${name}` }).click();
  await expect(page.getByRole('status')).toHaveText(`"${name}" is off.`);
  // The list's forms post without script, so wait for the reloaded page to hydrate.
  await page.waitForLoadState('networkidle');

  await page.locator('li.rule', { has: page.getByRole('heading', { name }) }).getByRole('link', { name: 'Edit' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Edit rule' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('textbox', { name: 'From' })).toHaveValue('rules-e2e.example');
  await expect(page.getByRole('checkbox', { name: /Turn on this rule/ })).not.toBeChecked();
  await page.getByRole('button', { name: 'Remove Importance is' }).click();
  await page.getByRole('button', { name: 'Save rule' }).click();
  await expect(page).toHaveURL(/saved=updated$/);
  await expect(page.locator('li.rule', { has: page.getByRole('heading', { name }) })).not.toContainText('Except if');
  await page.waitForLoadState('networkidle');

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: `Delete ${name}` }).click();
  await expect(page.getByRole('status')).toHaveText(`Deleted "${name}".`);
  await expect(page.getByRole('heading', { name })).toHaveCount(0);
});

test('the editor explains what is missing instead of saving an incomplete rule', async ({ page }) => {
  await open(page, '/mail/rules/edit?mailbox=mb-mia');
  await page.getByLabel('Name').fill('Incomplete');
  await page.getByRole('button', { name: 'Remove From' }).click();
  await page.getByRole('button', { name: 'Remove Move to' }).click();
  await expect(page.getByRole('complementary', { name: 'Rule summary' })).toContainText('Add at least one condition');
  await page.getByRole('button', { name: 'Save rule' }).click();
  await expect(page.getByRole('alert')).toContainText('Add at least one condition');
  await expect(page).toHaveURL(/\/mail\/rules\/edit/);
});

test('Create rule on a message starts a rule for its sender', async ({ page, isMobile }) => {
  await open(page, '/mail/msg-newsletter');
  if (isMobile) {
    await page.getByLabel('More actions').click();
    await page.locator('.tb-menu').getByRole('link', { name: 'Create rule' }).click();
  } else {
    await page.getByRole('link', { name: 'Create rule' }).click();
  }
  await expect(page.getByRole('heading', { level: 1, name: 'New rule' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'From' })).toHaveValue('news@landcare.banksia.test');
  await expect(page.getByLabel('Name')).toHaveValue('From news@landcare.banksia.test');
});
