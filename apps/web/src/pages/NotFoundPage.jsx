import { NotFoundContent } from '../components/StatusViews.jsx';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';

export function NotFoundPage() {
  useDocumentTitle('Página no encontrada');
  return <NotFoundContent title="Página no encontrada">La dirección que has abierto no existe en NoMoreSaaS.</NotFoundContent>;
}
