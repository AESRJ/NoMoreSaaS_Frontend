import { safeHref } from '../format.js';

/** Enlace externo seguro: solo HTTP(S), sin referrer ni acceso a window.opener. */
export function ExternalLink({ href, children, unavailableLabel, className }) {
  const safe = safeHref(href);
  if (!safe) {
    return <span className="muted">{`${unavailableLabel}: enlace no disponible`}</span>;
  }
  return (
    <a className={className} href={safe} rel="noopener noreferrer external">
      {children}
    </a>
  );
}
