// Plantillas deterministas del plan guiado (entrega 004). Solo texto: guían
// al usuario, no instalan software, no conectan servidores, no piden claves ni
// llaman a proveedores de IA. Fuentes oficiales de research.md / catálogo 004.
// Cambiar cualquier texto o paso exige subir TEMPLATES_VERSION (invalida el
// avance guardado mediante el fingerprint del plan).

export const TEMPLATES_VERSION = '2026-11-22.1';

export const STAGES = Object.freeze(['preparation', 'installation', 'verification', 'recovery']);

export const STAGE_LABELS = Object.freeze({
  preparation: 'Preparación',
  installation: 'Instalación prevista',
  verification: 'Comprobación',
  recovery: 'Recuperación',
});

const NEXTCLOUD_DOCS = [
  { label: 'Instalación de Nextcloud', url: 'https://docs.nextcloud.com/server/latest/admin_manual/installation/index.html' },
  { label: 'Requisitos del sistema de Nextcloud', url: 'https://docs.nextcloud.com/server/latest/admin_manual/installation/system_requirements.html' },
];
const IMMICH_DOCS = [
  { label: 'Requisitos de Immich', url: 'https://docs.immich.app/install/requirements/' },
  { label: 'Immich con Docker Compose', url: 'https://docs.immich.app/install/docker-compose/' },
  { label: 'Inicio rápido de Immich (copias)', url: 'https://docs.immich.app/overview/quick-start' },
];
const SYNAPSE_DOCS = [
  { label: 'Instalación de Synapse', url: 'https://element-hq.github.io/synapse/latest/setup/installation.html' },
  { label: 'Especificación Matrix', url: 'https://spec.matrix.org/latest/' },
];
const WIREGUARD_DOCS = [
  { label: 'Instalación de WireGuard', url: 'https://www.wireguard.com/install/' },
  { label: 'Inicio rápido de WireGuard', url: 'https://www.wireguard.com/quickstart/' },
  { label: 'Limitaciones conocidas de WireGuard', url: 'https://www.wireguard.com/known-limitations/' },
];
const OUTLINE_DOCS = [
  { label: 'Requisitos de Outline', url: 'https://docs.getoutline.com/s/hosting/doc/requirements-ULdYnwi4wG' },
  { label: 'Outline con Docker', url: 'https://docs.getoutline.com/s/hosting/doc/docker-7pfeLP5a8t' },
  { label: 'Almacenamiento de archivos de Outline', url: 'https://docs.getoutline.com/s/hosting/doc/file-storage-N4M0T6Ypu7' },
];

/** Por alternativa y etapa: título, explicación, tareas, validación y fuentes. */
export const TEMPLATES = Object.freeze({
  nextcloud: {
    preparation: {
      title: 'Preparar el servidor para Nextcloud',
      explanation: 'Nextcloud necesita un servidor Linux de 64 bits con PHP, un servidor web y una base de datos con parámetros específicos.',
      tasks: [
        'Confirmar un sistema Linux de 64 bits soportado por la documentación vigente.',
        'Elegir base de datos (PostgreSQL o MySQL/MariaDB; SQLite solo para pruebas).',
        'Elegir Apache o nginx con php-fpm y la versión de PHP admitida.',
        'Planificar dónde se guardarán los datos y sus copias.',
      ],
      validation: ['La versión de PHP y de la base de datos aparecen en la lista de requisitos vigente.'],
      sources: NEXTCLOUD_DOCS,
    },
    installation: {
      title: 'Instalar Nextcloud',
      explanation: 'Seguir el método de instalación oficial elegido, sin exponer el servicio hasta terminar la configuración.',
      tasks: [
        'Instalar los paquetes de PHP y extensiones requeridas.',
        'Crear la base de datos y su usuario dedicado.',
        'Desplegar Nextcloud y completar el asistente con una cuenta de administración.',
        'Configurar HTTPS si habrá acceso desde fuera de la red local.',
      ],
      validation: ['El asistente termina sin errores y el panel de administración no muestra avisos de configuración críticos.'],
      sources: NEXTCLOUD_DOCS,
    },
    verification: {
      title: 'Comprobar Nextcloud',
      explanation: 'Verificar que el servicio funciona con un caso real antes de migrar datos desde Google Drive.',
      tasks: [
        'Revisar la página de avisos de seguridad y configuración del panel de administración.',
        'Subir, descargar y compartir un archivo de prueba.',
        'Sincronizar un cliente de escritorio o móvil.',
      ],
      validation: ['El archivo de prueba se sincroniza y se descarga íntegro en otro dispositivo.'],
      sources: NEXTCLOUD_DOCS,
    },
    recovery: {
      title: 'Plan de recuperación de Nextcloud',
      explanation: 'Los datos y su disponibilidad dependen del servidor propio: hay que poder restaurarlos.',
      tasks: [
        'Definir copias de la carpeta de datos, la configuración y la base de datos.',
        'Guardar una copia fuera del equipo.',
        'Probar una restauración en un entorno de prueba.',
      ],
      validation: ['Una restauración de prueba recupera archivos y cuentas.'],
      sources: NEXTCLOUD_DOCS,
    },
  },
  immich: {
    preparation: {
      title: 'Preparar el equipo para Immich',
      explanation: 'Immich se instala con Docker Compose y su base de datos debe estar en disco local, preferiblemente SSD.',
      tasks: [
        'Confirmar Linux o *nix de 64 bits (amd64 o arm64) y Docker con el plugin Compose.',
        'Comprobar la RAM disponible frente al mínimo y recomendado documentados.',
        'Reservar disco local con sistema de archivos Unix para la base de datos (no NTFS/exFAT ni recurso de red).',
        'En amd64, comprobar si la CPU es x86-64-v2 antes de activar el aprendizaje automático.',
      ],
      validation: ['`docker compose version` responde y hay espacio local suficiente para biblioteca y miniaturas.'],
      sources: IMMICH_DOCS,
    },
    installation: {
      title: 'Instalar Immich con Docker Compose',
      explanation: 'Usar los archivos de Compose y de entorno de la documentación oficial de la versión elegida.',
      tasks: [
        'Descargar los archivos oficiales de Compose y de entorno.',
        'Definir la ubicación de la biblioteca y de la base de datos en disco local.',
        'Arrancar los contenedores y crear la cuenta de administración.',
      ],
      validation: ['La interfaz web carga y todos los contenedores están en estado saludable.'],
      sources: IMMICH_DOCS,
    },
    verification: {
      title: 'Comprobar Immich',
      explanation: 'Verificar la copia desde el móvil con un álbum pequeño antes de migrar desde Google Fotos.',
      tasks: [
        'Conectar la app móvil y subir un álbum de prueba.',
        'Comprobar miniaturas, metadatos y búsqueda.',
      ],
      validation: ['Las fotos de prueba aparecen con sus fechas y se pueden descargar.'],
      sources: IMMICH_DOCS,
    },
    recovery: {
      title: 'Plan de recuperación de Immich',
      explanation: 'La base de datos solo guarda metadatos: las fotos y vídeos requieren copias manuales (estrategia 3-2-1 recomendada).',
      tasks: [
        'Programar copias de la biblioteca de medios.',
        'Programar copias de la base de datos.',
        'Guardar una copia fuera del equipo y probar una restauración.',
      ],
      validation: ['Una restauración de prueba recupera medios y álbumes.'],
      sources: IMMICH_DOCS,
    },
  },
  'matrix-synapse': {
    preparation: {
      title: 'Preparar un servidor Matrix con Synapse',
      explanation: 'Matrix es el protocolo; Synapse es el servidor (homeserver). El server_name no puede cambiarse después.',
      tasks: [
        'Elegir el server_name definitivo (normalmente un dominio propio).',
        'Preparar PostgreSQL (SQLite solo para pruebas).',
        'Planificar HTTPS con proxy inverso y, para llamadas, un servidor TURN.',
        'Elegir el método: imagen Docker oficial, paquetes de Matrix.org o PyPI.',
      ],
      validation: ['El server_name y el dominio están decididos y documentados antes de instalar.'],
      sources: SYNAPSE_DOCS,
    },
    installation: {
      title: 'Instalar Synapse',
      explanation: 'Instalar con el método oficial elegido y configurar la base de datos y HTTPS.',
      tasks: [
        'Instalar Synapse y generar su configuración con el server_name elegido.',
        'Configurar PostgreSQL como base de datos.',
        'Publicar las API por HTTPS mediante un proxy inverso.',
        'Crear la primera cuenta de administración.',
      ],
      validation: ['Un cliente Matrix inicia sesión en el servidor por HTTPS.'],
      sources: SYNAPSE_DOCS,
    },
    verification: {
      title: 'Comprobar Synapse',
      explanation: 'Verificar mensajería, y federación y llamadas solo si se necesitan.',
      tasks: [
        'Crear una sala y enviar mensajes entre dos cuentas.',
        'Si se usa federación, comprobarla con otro servidor.',
        'Si se usan llamadas, comprobarlas con TURN configurado.',
      ],
      validation: ['Los mensajes llegan entre cuentas y, si aplica, entre servidores.'],
      sources: SYNAPSE_DOCS,
    },
    recovery: {
      title: 'Plan de recuperación de Synapse',
      explanation: 'Conservar base de datos, configuración y claves de firma del servidor fuera del equipo.',
      tasks: [
        'Programar copias de PostgreSQL.',
        'Copiar la configuración y los archivos de claves de firma del servidor a un lugar seguro y privado.',
        'Probar una restauración en un entorno de prueba.',
      ],
      validation: ['Una restauración de prueba conserva salas, cuentas e identidad del servidor.'],
      sources: SYNAPSE_DOCS,
    },
  },
  wireguard: {
    preparation: {
      title: 'Preparar la red WireGuard',
      explanation: 'WireGuard se instala de forma nativa en cada sistema; no es un servicio gestionado: claves, pares y rutas se configuran a mano.',
      tasks: [
        'Hacer una lista de los dispositivos (pares) y la subred privada del túnel.',
        'Decidir qué par tendrá un puerto UDP alcanzable (el ejemplo oficial usa 51820).',
        'Comprobar si la conexión a internet está detrás de NAT o CGNAT.',
      ],
      validation: ['Cada par tiene dirección del túnel asignada y se conoce qué puerto UDP se abrirá.'],
      sources: WIREGUARD_DOCS,
    },
    installation: {
      title: 'Instalar WireGuard de forma nativa',
      explanation: 'Usar el instalador o paquete oficial de cada sistema y generar las claves localmente en cada dispositivo.',
      tasks: [
        'Instalar WireGuard con el método oficial de cada sistema operativo.',
        'Generar el par de claves en cada dispositivo; la clave privada nunca sale de él ni se comparte.',
        'Configurar interfaz, AllowedIPs y endpoint de cada par (por ejemplo con wg-quick).',
        'Abrir solo el puerto UDP necesario en el par alcanzable.',
      ],
      validation: ['`wg show` muestra los pares configurados en cada dispositivo.'],
      sources: WIREGUARD_DOCS,
    },
    verification: {
      title: 'Comprobar el túnel WireGuard',
      explanation: 'Verificar el tráfico entre pares y el comportamiento tras un cambio de red.',
      tasks: [
        'Comprobar que el último handshake es reciente en ambos extremos.',
        'Hacer ping entre direcciones del túnel.',
        'Probar desde otra red; si hay NAT, valorar PersistentKeepalive.',
      ],
      validation: ['Los pares se alcanzan por sus direcciones del túnel.'],
      sources: WIREGUARD_DOCS,
    },
    recovery: {
      title: 'Plan de recuperación de WireGuard',
      explanation: 'Poder reconstruir la configuración y revocar un dispositivo perdido.',
      tasks: [
        'Guardar la configuración de cada par sin incluir claves privadas en copias compartidas.',
        'Documentar cómo retirar un par perdido y regenerar sus claves.',
      ],
      validation: ['Se puede retirar un par de prueba y el resto del túnel sigue funcionando.'],
      sources: WIREGUARD_DOCS,
    },
  },
  outline: {
    preparation: {
      title: 'Preparar el servidor para Outline',
      explanation: 'Outline requiere un sistema Unix, PostgreSQL, Redis, un dominio dedicado y un proveedor de autenticación. Su licencia es BSL 1.1 (no open source).',
      tasks: [
        'Confirmar un sistema Unix (no Windows Server) con Docker Compose.',
        'Reservar un dominio o subdominio dedicado y planificar HTTPS.',
        'Elegir un proveedor de autenticación compatible.',
        'Elegir almacenamiento de archivos local persistente o compatible con S3.',
        'Revisar que el uso previsto respeta la licencia (no ofrecerlo como servicio documental comercial a terceros).',
      ],
      validation: ['Dominio, proveedor de autenticación y almacenamiento están decididos.'],
      sources: OUTLINE_DOCS,
    },
    installation: {
      title: 'Instalar Outline con Docker',
      explanation: 'Seguir el ejemplo oficial de Docker Compose con PostgreSQL, Redis y HTTPS.',
      tasks: [
        'Crear el archivo de entorno a partir del ejemplo oficial; generar los secretos localmente sin compartirlos.',
        'Definir los servicios de Outline, PostgreSQL y Redis y fijar versiones de imagen.',
        'Configurar el proveedor de autenticación y el almacenamiento de archivos.',
        'Arrancar los contenedores y publicar por HTTPS.',
      ],
      validation: ['Se puede iniciar sesión con el proveedor configurado.'],
      sources: OUTLINE_DOCS,
    },
    verification: {
      title: 'Comprobar Outline',
      explanation: 'Verificar edición, búsqueda y adjuntos antes de migrar desde Notion.',
      tasks: [
        'Crear un documento, editarlo en colaboración y buscarlo.',
        'Subir un adjunto y comprobar que persiste tras reiniciar los contenedores.',
      ],
      validation: ['Documento y adjunto siguen disponibles después de reiniciar.'],
      sources: OUTLINE_DOCS,
    },
    recovery: {
      title: 'Plan de recuperación de Outline',
      explanation: 'Conservar base de datos, archivos subidos y configuración.',
      tasks: [
        'Programar copias de PostgreSQL y del almacenamiento de archivos.',
        'Guardar el archivo de entorno en un lugar privado y seguro, fuera de repositorios compartidos.',
        'Probar una restauración en un entorno de prueba.',
      ],
      validation: ['Una restauración de prueba recupera documentos y adjuntos.'],
      sources: OUTLINE_DOCS,
    },
  },
});

/** Restricciones comunes de todos los prompts. */
export const PROMPT_CONSTRAINTS = Object.freeze([
  'Explica los pasos y comandos para que yo los revise y ejecute; no asumas acceso a mi equipo ni ejecutes nada por mí.',
  'No me pidas contraseñas, claves privadas ni tokens; usa marcadores como <TU_DOMINIO> o <TU_CLAVE> cuando haga falta.',
  'Básate en la documentación oficial indicada y avisa si algo depende de la versión.',
  'Si falta un dato de mi equipo o hay una condición pendiente, pregúntamelo antes de continuar.',
  'La estimación de recursos es orientativa y no garantiza que la instalación funcione.',
]);
