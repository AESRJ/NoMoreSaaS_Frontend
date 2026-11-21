import { useEffect, useRef } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useCatalog } from '../hooks/useCatalog.js';
import { useComparison } from '../store/comparison.js';
import { SelectionBar } from './SelectionBar.jsx';

export function Layout() {
  const { index } = useCatalog();
  const reconcile = useComparison((state) => state.reconcile);
  const count = useComparison((state) => state.ids.length);
  const { pathname } = useLocation();
  const mainRef = useRef(null);
  const firstRender = useRef(true);

  // Con datos cargados, retira IDs que ya no existen en el catálogo.
  useEffect(() => {
    if (index) reconcile(index.data.alternatives.map((alternative) => alternative.id));
  }, [index, reconcile]);

  // Al cambiar de ruta, lleva el foco al contenido para lectores de pantalla.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    mainRef.current?.focus({ preventScroll: false });
  }, [pathname]);

  return (
    <div className="app">
      <a className="skip-link" href="#contenido">
        Saltar al contenido
      </a>
      <header className="site-header">
        <div className="site-header__inner">
          <Link className="brand" to="/">
            <span className="brand__mark" aria-hidden="true">
              N
            </span>
            NoMoreSaaS
          </Link>
          <nav aria-label="Principal">
            <ul className="nav-list">
              <li>
                <NavLink to="/" end>
                  Catálogo
                </NavLink>
              </li>
              <li>
                <NavLink to="/comparar">
                  Comparar
                  <span className="nav-count" aria-hidden="true">
                    {count}
                  </span>
                </NavLink>
              </li>
            </ul>
          </nav>
        </div>
      </header>
      <main id="contenido" ref={mainRef} tabIndex={-1} className="site-main">
        <Outlet />
      </main>
      <SelectionBar />
      <footer className="site-footer">
        <p>
          Datos curados a partir de documentación oficial, con fecha de revisión por fuente. Las valoraciones de dificultad son evaluaciones
          editoriales. NoMoreSaaS no instala ni despliega servicios.
        </p>
      </footer>
    </div>
  );
}
