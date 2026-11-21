# NoMoreSaaS - aplicacion

Repositorio de codigo separado de [la planificacion y arnes maestro](https://github.com/AESRJ/NoMoreSas).

- apps/web: React + Vite + React Router + Zustand.
- apps/api: Node.js + Express.
- .project/: snapshot SDD, tareas y evidencia de construccion.
- tools/: comprobacion ligera de la entrega; .specify/ y skills ocultos conservan GitHub Spec Kit.

Node.js LTS 26.13.1 y pnpm 12.21.0. El primer incremento es catalogo publico, fichas, busqueda y comparacion; sin cuentas ni despliegue. Los comandos pnpm dev/lint/test/build/test:e2e deben quedar documentados y comprobados por Claude al construir. No se anuncian implementados antes de existir.

Ejecutar init.cmd (Python 3.12 para el verificador de desarrollo). Leer .project/context.md antes de trabajar. Configuraciones MCP propias de la maquina son locales e ignoradas; no contienen credenciales en el repositorio. La aplicacion no depende de Python ni de NotebookLM para ejecutarse.
