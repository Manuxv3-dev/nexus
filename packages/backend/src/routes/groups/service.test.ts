/**
 * Tests unitaires de `canManageRole` (MAN-180 — gestion des membres de
 * groupe, phase 1 : changement de rôle).
 *
 * Fonction pure : pas de mock nécessaire, on couvre la table de vérité
 * complète des 3x3 combinaisons de rôles owner/admin/member.
 */
import { describe, expect, it } from 'vitest';

import { canManageRole } from './service.js';

describe('canManageRole', () => {
  it('test_canManageRole_owner_can_manage_admin', () => {
    expect(canManageRole('owner', 'admin')).toBe(true);
  });

  it('test_canManageRole_owner_can_manage_member', () => {
    expect(canManageRole('owner', 'member')).toBe(true);
  });

  it('test_canManageRole_owner_cannot_manage_owner', () => {
    expect(canManageRole('owner', 'owner')).toBe(false);
  });

  it('test_canManageRole_admin_can_manage_member', () => {
    expect(canManageRole('admin', 'member')).toBe(true);
  });

  it('test_canManageRole_admin_cannot_manage_admin', () => {
    expect(canManageRole('admin', 'admin')).toBe(false);
  });

  it('test_canManageRole_admin_cannot_manage_owner', () => {
    expect(canManageRole('admin', 'owner')).toBe(false);
  });

  it('test_canManageRole_member_cannot_manage_anyone', () => {
    expect(canManageRole('member', 'member')).toBe(false);
    expect(canManageRole('member', 'admin')).toBe(false);
    expect(canManageRole('member', 'owner')).toBe(false);
  });
});
