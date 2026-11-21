import { useEffect } from 'react';

export function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · NoMoreSaaS` : 'NoMoreSaaS · Catálogo de alternativas';
  }, [title]);
}
