import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

import '@testing-library/jest-dom/vitest';

// `globals: false` (cf. vitest.config.ts racine) : @testing-library/react ne
// trouve pas d'`afterEach` global pour son auto-cleanup, donc on le fait
// explicitement — sinon le DOM d'un test fuite dans le suivant.
afterEach(() => {
  cleanup();
});
