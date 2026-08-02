/**
 * Landing page nexus — servie par le build `@nexus/landing` sur l'apex
 * `nexusapp.chat` (cf. ADR-014, ADR-030).
 *
 * Refonte 2026-08-02 : recréation de l'option `2a` du handoff design
 * (design_handoff_nexus_landing/README.md) dans le stack existant. Palette
 * et typographie propres à la landing (cf. `./tokens.ts`) — distinctes des
 * `--nx-*` de l'app, qui restent en exploration libre côté ADR-021.
 *
 * Structure : header → hero → bandeau plateformes → Produit → Comment ça
 * marche → Intégrations → FAQ → CTA final → footer.
 */
import './landing.css';

import { CtaFooter } from './sections/CtaFooter';
import { Faq } from './sections/Faq';
import { Hero } from './sections/Hero';
import { HowItWorks } from './sections/HowItWorks';
import { Integrations } from './sections/Integrations';
import { Nav } from './sections/Nav';
import { PlatformsBand } from './sections/PlatformsBand';
import { Product } from './sections/Product';
import { LX } from './tokens';

/** La landing est sur l'apex, le SPA web sur le sous-domaine app (cf. ADR-030). */
const APP_LOGIN_URL = 'https://app.nexusapp.chat/login';

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function LandingScreen() {
  const goToLogin = () => {
    window.location.href = APP_LOGIN_URL;
  };

  const goToDownload = () => scrollToId('nx-download');
  // "Voir la démo" n'a pas de destination tranchée (vidéo ? modal ?) — en
  // attendant une décision, on scrolle vers Produit pour donner un aperçu.
  const goToDemo = () => scrollToId('nx-produit');

  return (
    <div
      style={{
        background: LX.bg,
        color: LX.text,
        minHeight: '100vh',
        fontFamily: 'Manrope, sans-serif',
      }}
    >
      <Nav onLogin={goToLogin} onDownload={goToDownload} />
      <Hero onDownload={goToDownload} onDemo={goToDemo} />
      <PlatformsBand />
      <Product />
      <HowItWorks />
      <Integrations />
      <Faq />
      <CtaFooter />
    </div>
  );
}
