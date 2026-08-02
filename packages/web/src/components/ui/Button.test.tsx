import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './Button';

describe('Button', () => {
  it('affiche son label et déclenche onClick', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Créer</Button>);

    const button = screen.getByRole('button', { name: 'Créer' });
    await userEvent.click(button);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('désactive le bouton et ignore les clics en mode loading', async () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} loading>
        Créer
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Créer' });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
