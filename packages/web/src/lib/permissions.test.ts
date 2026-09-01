/**
 * MAN-246 point 6 — la règle « qui peut modifier ou supprimer cet item ».
 *
 * Miroir client de ce que le backend applique sur `PATCH` et `DELETE` des
 * events, polls, todo-lists et expenses. Testé à part des composants : c'est
 * une règle d'autorisation, elle mérite d'être vérifiable sans monter d'UI, et
 * les 4 dashboards s'appuient dessus à l'identique.
 */
import { describe, expect, it } from 'vitest';

import { canManageGroupItem } from './permissions';

const ME = 'user-1';
const SOMEONE_ELSE = 'user-2';

describe('canManageGroupItem', () => {
  it("autorise l'auteur, quel que soit son rôle", () => {
    expect(canManageGroupItem({ userId: ME, authorId: ME, role: 'member' })).toBe(true);
    expect(canManageGroupItem({ userId: ME, authorId: ME, role: 'admin' })).toBe(true);
    expect(canManageGroupItem({ userId: ME, authorId: ME, role: 'owner' })).toBe(true);
  });

  it("autorise l'owner et l'admin du groupe sur le contenu d'un autre", () => {
    // C'est le cœur du bug : l'UI calculait `createdBy === user.id` et masquait
    // donc à un owner des actions que le serveur lui accordait.
    expect(canManageGroupItem({ userId: ME, authorId: SOMEONE_ELSE, role: 'owner' })).toBe(true);
    expect(canManageGroupItem({ userId: ME, authorId: SOMEONE_ELSE, role: 'admin' })).toBe(true);
  });

  it("refuse un membre simple sur le contenu d'un autre", () => {
    expect(canManageGroupItem({ userId: ME, authorId: SOMEONE_ELSE, role: 'member' })).toBe(false);
  });

  it('refuse tant que le rôle est inconnu', () => {
    // `role` est optionnel dans le DTO de groupe. Ne rien promettre sur la base
    // d'une donnée absente — même principe que MAN-244.
    expect(canManageGroupItem({ userId: ME, authorId: SOMEONE_ELSE, role: undefined })).toBe(false);
  });

  it("refuse tant que l'utilisateur est inconnu, même s'il se trouve être l'auteur", () => {
    // Fenêtre pré-auth : `userId` undefined et `authorId` undefined ne doivent
    // pas se « rencontrer » et ouvrir les actions par accident.
    expect(canManageGroupItem({ userId: undefined, authorId: ME, role: 'owner' })).toBe(false);
  });
});
