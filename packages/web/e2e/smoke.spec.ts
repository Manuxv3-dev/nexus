import { test, expect } from '@playwright/test';

/**
 * Smoke path e2e (cf. MAN-22) : login → onboarding → app shell → switch de
 * groupe → ouvrir un panel feature.
 *
 * Chaque run crée un compte unique (timestamp dans l'email) pour rester
 * ré-exécutable sans collision AUTH_EMAIL_TAKEN, que ce soit en CI (base
 * Postgres jetable) ou en local.
 */
test('parcours complet : inscription, onboarding, switch de groupe, panel feature', async ({
  page,
}) => {
  const unique = Date.now();
  const email = `e2e-${unique}@nexus-test.local`;
  const firstGroupName = `Bande e2e ${unique}`;
  const secondGroupName = `Deuxième groupe ${unique}`;

  // ----- Inscription -----------------------------------------------------
  await page.goto('/register');
  await page.getByLabel('Prénom ou pseudo').fill('E2E Tester');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mot de passe').fill('un-mot-de-passe-largement-suffisant');
  await page.getByRole('button', { name: 'Créer mon compte' }).click();

  // ----- Onboarding : avatar (skip) → premier groupe → confirmation ------
  await expect(page.getByText(/^Bienvenue,/)).toBeVisible();
  await page.getByRole('button', { name: 'Continuer' }).click();

  await expect(page.getByText('Ton premier groupe')).toBeVisible();
  await page.getByText('Créer un groupe').click();
  await page.getByLabel('Nom du groupe').fill(firstGroupName);
  await page.getByRole('button', { name: 'Créer le groupe' }).click();

  await expect(page.getByText("C'est parti !")).toBeVisible();
  await page.getByRole('button', { name: 'Ouvrir nexus' }).click();

  // ----- App shell : groupe créé pendant l'onboarding visible ------------
  await expect(page).toHaveURL(/\/app/);
  await expect(page.getByTitle(firstGroupName)).toBeVisible();

  // ----- Nouveau groupe puis switch entre les deux ------------------------
  await page.getByLabel('Nouveau groupe').click();
  await page.getByPlaceholder('La Bande du 11e').fill(secondGroupName);
  await page.getByRole('button', { name: 'Créer' }).click();
  await expect(page.getByTitle(secondGroupName)).toBeVisible();

  await page.getByTitle(firstGroupName).click();
  await expect(page.getByText(firstGroupName).first()).toBeVisible();

  // ----- Ouvrir un panel feature -------------------------------------------
  await page.getByLabel('event', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Nouvel événement' })).toBeVisible();
});
