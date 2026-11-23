// Plantillas deterministas del plan guiado (entregas 004 y 007). Solo texto:
// guían al usuario, no instalan software, no conectan servidores, no piden
// claves ni llaman a proveedores de IA. Fuentes oficiales de research.md /
// catálogo 004.
//
// Cada etapa (007, FR-007) tiene bloques claros: objetivo (explanation),
// antes de empezar (prechecks, solo lectura), acciones propuestas (tasks),
// seguridad (security), cómo comprobar (validation) y cómo volver atrás
// (rollback). Solo controles pertinentes a la etapa, sin secretos ni comandos
// destructivos automáticos.
//
// Cambiar cualquier texto o paso exige subir TEMPLATES_VERSION (invalida el
// avance guardado mediante el fingerprint del plan).

export const TEMPLATES_VERSION = '2026-11-22.2';

export const STAGES = Object.freeze(['preparation', 'installation', 'verification', 'recovery']);

export const STAGE_LABELS = Object.freeze({
  preparation: 'Preparación',
  installation: 'Instalación prevista',
  verification: 'Comprobación',
  recovery: 'Recuperación',
});

/** Bloques de cada etapa, en el orden en que se muestran y se copian. */
export const STEP_BLOCKS = Object.freeze([
  { key: 'prechecks', label: 'Antes de empezar (solo comprobaciones, sin cambiar nada)' },
  { key: 'tasks', label: 'Acciones propuestas' },
  { key: 'security', label: 'Seguridad' },
  { key: 'validation', label: 'Cómo comprobar' },
  { key: 'rollback', label: 'Cómo volver atrás' },
]);

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

// Bloques comunes reutilizados: la preparación no cambia nada, así que no hay
// nada que deshacer; la comprobación se repliega cerrando la exposición.
const PREPARATION_ROLLBACK = ['Esta etapa solo decide y comprueba: no hay cambios que deshacer. Si cambias de opción, actualiza tus notas antes de instalar.'];

/** Por alternativa y etapa: título, objetivo y bloques del paso con sus fuentes. */
export const TEMPLATES = Object.freeze({
  nextcloud: {
    preparation: {
      title: 'Preparar el servidor para Nextcloud',
      explanation: 'Nextcloud necesita un servidor Linux de 64 bits con PHP, un servidor web y una base de datos con parámetros específicos.',
      prechecks: [
        'Consultar la versión del sistema operativo y confirmar que es Linux de 64 bits.',
        'Consultar el espacio libre del disco donde irán los datos y compararlo con los datos previstos.',
        'Listar qué puertos están ya en uso en el servidor, sin cambiar nada.',
      ],
      tasks: [
        'Elegir una versión de Nextcloud y anotar las versiones de PHP y base de datos que admite su documentación.',
        'Elegir base de datos (PostgreSQL o MySQL/MariaDB; SQLite solo para pruebas).',
        'Elegir Apache o nginx con php-fpm y la versión de PHP admitida.',
        'Planificar dónde se guardarán los datos y sus copias.',
      ],
      security: [
        'Planificar una cuenta de sistema dedicada para el servicio, sin privilegios de administración.',
        'Decidir que la base de datos solo escuchará en local y no se publicará en la red.',
        'Usar solo paquetes y versiones de la documentación oficial vigente.',
      ],
      validation: ['La versión de PHP y de la base de datos aparecen en la lista de requisitos vigente.'],
      rollback: PREPARATION_ROLLBACK,
      sources: NEXTCLOUD_DOCS,
    },
    installation: {
      title: 'Instalar Nextcloud',
      explanation: 'Seguir el método de instalación oficial elegido, sin exponer el servicio hasta terminar la configuración.',
      prechecks: [
        'Confirmar que existe una copia de seguridad reciente de cualquier dato que ya haya en el servidor.',
        'Confirmar que los puertos 80/443 no los usa otro servicio.',
      ],
      tasks: [
        'Instalar los paquetes de PHP y extensiones requeridas.',
        'Crear la base de datos y su usuario dedicado.',
        'Desplegar Nextcloud y completar el asistente con una cuenta de administración.',
        'Configurar HTTPS si habrá acceso desde fuera de la red local.',
      ],
      security: [
        'Generar en el propio servidor la contraseña de la base de datos y de la cuenta de administración; en el prompt usar <TU_CONTRASEÑA>.',
        'La base de datos escucha solo en local; abrir en el cortafuegos únicamente los puertos web necesarios.',
        'No publicar el servicio en internet hasta tener HTTPS con un certificado válido.',
        'Colocar la carpeta de datos fuera de la raíz web, con permisos solo para la cuenta del servicio.',
      ],
      validation: ['El asistente termina sin errores y el panel de administración no muestra avisos de configuración críticos.'],
      rollback: [
        'Antes de instalar, anotar los paquetes y archivos de configuración que se van a añadir o modificar.',
        'Si falla, detener el servidor web y revisar el registro antes de repetir; no borrar la carpeta de datos ni la base de datos sin una copia y sin confirmarlo.',
      ],
      sources: NEXTCLOUD_DOCS,
    },
    verification: {
      title: 'Comprobar Nextcloud',
      explanation: 'Verificar que el servicio funciona con un caso real antes de migrar datos desde Google Drive.',
      prechecks: ['Usar una cuenta y un archivo de prueba, sin datos personales reales.'],
      tasks: [
        'Revisar la página de avisos de seguridad y configuración del panel de administración.',
        'Subir, descargar y compartir un archivo de prueba.',
        'Sincronizar un cliente de escritorio o móvil.',
      ],
      security: [
        'Comprobar desde otra red que solo responden los puertos web previstos y que la base de datos no es accesible.',
        'Comprobar que el acceso externo usa HTTPS y que no quedan cuentas de prueba con permisos de administración.',
      ],
      validation: ['El archivo de prueba se sincroniza y se descarga íntegro en otro dispositivo.'],
      rollback: ['Si algo falla, cerrar el acceso externo, borrar solo los datos de prueba y volver a la etapa de instalación antes de migrar nada.'],
      sources: NEXTCLOUD_DOCS,
    },
    recovery: {
      title: 'Plan de recuperación de Nextcloud',
      explanation: 'Los datos y su disponibilidad dependen del servidor propio: hay que poder restaurarlos.',
      prechecks: ['Calcular el tamaño de la carpeta de datos y de la base de datos para dimensionar las copias.'],
      tasks: [
        'Definir copias de la carpeta de datos, la configuración y la base de datos.',
        'Guardar una copia fuera del equipo.',
        'Probar una restauración en un entorno de prueba.',
      ],
      security: [
        'Cifrar las copias que salgan del equipo y guardar la clave aparte, en un lugar privado.',
        'La configuración contiene secretos: no subirla a repositorios ni a almacenamiento compartido sin cifrar.',
      ],
      validation: ['Una restauración de prueba recupera archivos y cuentas.'],
      rollback: ['Restaurar siempre primero en un entorno separado; no sobrescribir el servidor en uso hasta comprobar que la copia es correcta.'],
      sources: NEXTCLOUD_DOCS,
    },
  },
  immich: {
    preparation: {
      title: 'Preparar el equipo para Immich',
      explanation: 'Immich se instala con Docker Compose y su base de datos debe estar en disco local, preferiblemente SSD.',
      prechecks: [
        'Consultar sistema operativo, arquitectura (amd64 o arm64) y RAM disponible.',
        'Consultar si Docker y el plugin Compose están instalados y qué versión tienen (`docker compose version`).',
        'Consultar el sistema de archivos y el espacio libre del disco previsto para biblioteca y base de datos.',
      ],
      tasks: [
        'Confirmar Linux o *nix de 64 bits (amd64 o arm64) y Docker con el plugin Compose.',
        'Comprobar la RAM disponible frente al mínimo y recomendado documentados.',
        'Reservar disco local con sistema de archivos Unix para la base de datos (no NTFS/exFAT ni recurso de red).',
        'En amd64, comprobar si la CPU es x86-64-v2 antes de activar el aprendizaje automático.',
      ],
      security: [
        'Decidir que la base de datos solo será accesible dentro de la red de Docker, sin publicar su puerto.',
        'Planificar si habrá acceso desde internet y, en ese caso, cómo se publicará con HTTPS.',
      ],
      validation: ['`docker compose version` responde y hay espacio local suficiente para biblioteca y miniaturas.'],
      rollback: PREPARATION_ROLLBACK,
      sources: IMMICH_DOCS,
    },
    installation: {
      title: 'Instalar Immich con Docker Compose',
      explanation: 'Usar los archivos de Compose y de entorno de la documentación oficial de la versión elegida.',
      prechecks: [
        'Confirmar que el puerto web previsto no está en uso.',
        'Confirmar que la carpeta de la biblioteca está vacía o tiene copia si ya contiene fotos.',
      ],
      tasks: [
        'Descargar los archivos oficiales de Compose y de entorno.',
        'Definir la ubicación de la biblioteca y de la base de datos en disco local.',
        'Arrancar los contenedores y crear la cuenta de administración.',
      ],
      security: [
        'Cambiar la contraseña de la base de datos del archivo de entorno por una generada localmente; en el prompt usar <TU_CONTRASEÑA>.',
        'No publicar los puertos de PostgreSQL ni de Redis fuera de Docker; solo el puerto web.',
        'Fijar la versión de Immich indicada en la documentación en lugar de actualizar sin revisar las notas de versión.',
      ],
      validation: ['La interfaz web carga y todos los contenedores están en estado saludable.'],
      rollback: [
        'Si falla, detener los contenedores con Docker Compose y revisar los registros; conservar los volúmenes de datos.',
        'No eliminar volúmenes ni la carpeta de la biblioteca sin copia y sin confirmarlo.',
      ],
      sources: IMMICH_DOCS,
    },
    verification: {
      title: 'Comprobar Immich',
      explanation: 'Verificar la copia desde el móvil con un álbum pequeño antes de migrar desde Google Fotos.',
      prechecks: ['Elegir un álbum pequeño de prueba y conservar los originales en su ubicación actual.'],
      tasks: [
        'Conectar la app móvil y subir un álbum de prueba.',
        'Comprobar miniaturas, metadatos y búsqueda.',
      ],
      security: [
        'Comprobar que solo el puerto web responde desde otra red y que el acceso externo usa HTTPS.',
        'No borrar las fotos originales del móvil ni de Google Fotos durante la prueba.',
      ],
      validation: ['Las fotos de prueba aparecen con sus fechas y se pueden descargar.'],
      rollback: ['Si algo falla, borrar solo el álbum de prueba en Immich y volver a la instalación; los originales siguen intactos.'],
      sources: IMMICH_DOCS,
    },
    recovery: {
      title: 'Plan de recuperación de Immich',
      explanation: 'La base de datos solo guarda metadatos: las fotos y vídeos requieren copias manuales (estrategia 3-2-1 recomendada).',
      prechecks: ['Calcular el tamaño de la biblioteca de medios y elegir un destino de copia con espacio suficiente.'],
      tasks: [
        'Programar copias de la biblioteca de medios.',
        'Programar copias de la base de datos.',
        'Guardar una copia fuera del equipo y probar una restauración.',
      ],
      security: [
        'Cifrar las copias que salgan del equipo y guardar la clave aparte.',
        'El archivo de entorno contiene secretos: guardarlo en un lugar privado, fuera de repositorios compartidos.',
      ],
      validation: ['Una restauración de prueba recupera medios y álbumes.'],
      rollback: ['Restaurar en un entorno separado; no sobrescribir la biblioteca en uso hasta comprobar que la copia es correcta.'],
      sources: IMMICH_DOCS,
    },
  },
  'matrix-synapse': {
    preparation: {
      title: 'Preparar un servidor Matrix con Synapse',
      explanation: 'Matrix es el protocolo; Synapse es el servidor (homeserver). El server_name no puede cambiarse después.',
      prechecks: [
        'Consultar sistema operativo, RAM y espacio libre del servidor.',
        'Consultar si el dominio previsto ya existe y a qué apunta, sin modificarlo.',
      ],
      tasks: [
        'Elegir el server_name definitivo (normalmente un dominio propio).',
        'Preparar PostgreSQL (SQLite solo para pruebas).',
        'Planificar HTTPS con proxy inverso y, para llamadas, un servidor TURN.',
        'Elegir el método: imagen Docker oficial, paquetes de Matrix.org o PyPI.',
      ],
      security: [
        'Decidir si habrá federación; si no se necesita, planificar dejarla desactivada.',
        'Decidir que PostgreSQL solo escuchará en local y que el registro público de cuentas estará cerrado.',
      ],
      validation: ['El server_name y el dominio están decididos y documentados antes de instalar.'],
      rollback: PREPARATION_ROLLBACK,
      sources: SYNAPSE_DOCS,
    },
    installation: {
      title: 'Instalar Synapse',
      explanation: 'Instalar con el método oficial elegido y configurar la base de datos y HTTPS.',
      prechecks: [
        'Confirmar que el server_name elegido es el definitivo.',
        'Confirmar que los puertos del proxy inverso no los usa otro servicio.',
      ],
      tasks: [
        'Instalar Synapse y generar su configuración con el server_name elegido.',
        'Configurar PostgreSQL como base de datos.',
        'Publicar las API por HTTPS mediante un proxy inverso.',
        'Crear la primera cuenta de administración.',
      ],
      security: [
        'Generar localmente los secretos de la configuración; en el prompt usar marcadores como <TU_SECRETO>.',
        'Mantener cerrado el registro abierto de cuentas; crear cuentas a mano.',
        'Publicar solo los puertos del proxy inverso con HTTPS; PostgreSQL y el puerto interno de Synapse no se exponen.',
      ],
      validation: ['Un cliente Matrix inicia sesión en el servidor por HTTPS.'],
      rollback: [
        'Si falla antes de crear salas reales, detener Synapse, corregir la configuración y repetir.',
        'No regenerar las claves de firma ni cambiar el server_name una vez en uso: rompe la identidad del servidor.',
      ],
      sources: SYNAPSE_DOCS,
    },
    verification: {
      title: 'Comprobar Synapse',
      explanation: 'Verificar mensajería, y federación y llamadas solo si se necesitan.',
      prechecks: ['Usar dos cuentas de prueba y una sala de prueba.'],
      tasks: [
        'Crear una sala y enviar mensajes entre dos cuentas.',
        'Si se usa federación, comprobarla con otro servidor.',
        'Si se usan llamadas, comprobarlas con TURN configurado.',
      ],
      security: [
        'Comprobar que no se pueden crear cuentas sin permiso y que solo responden los puertos previstos.',
      ],
      validation: ['Los mensajes llegan entre cuentas y, si aplica, entre servidores.'],
      rollback: ['Si algo falla, desactivar temporalmente el acceso externo y volver a la instalación; las cuentas de prueba pueden desactivarse después.'],
      sources: SYNAPSE_DOCS,
    },
    recovery: {
      title: 'Plan de recuperación de Synapse',
      explanation: 'Conservar base de datos, configuración y claves de firma del servidor fuera del equipo.',
      prechecks: ['Localizar la configuración, las claves de firma y el tamaño de la base de datos.'],
      tasks: [
        'Programar copias de PostgreSQL.',
        'Copiar la configuración y los archivos de claves de firma del servidor a un lugar seguro y privado.',
        'Probar una restauración en un entorno de prueba.',
      ],
      security: [
        'Las claves de firma identifican al servidor: guardarlas cifradas y sin compartirlas.',
        'Cifrar las copias que salgan del equipo.',
      ],
      validation: ['Una restauración de prueba conserva salas, cuentas e identidad del servidor.'],
      rollback: ['Restaurar en un entorno separado; no arrancar dos servidores con el mismo server_name a la vez.'],
      sources: SYNAPSE_DOCS,
    },
  },
  wireguard: {
    preparation: {
      title: 'Preparar la red WireGuard',
      explanation: 'WireGuard se instala de forma nativa en cada sistema; no es un servicio gestionado: claves, pares y rutas se configuran a mano.',
      prechecks: [
        'Consultar el sistema operativo de cada dispositivo.',
        'Consultar las subredes que ya usan las redes locales para no repetirlas en el túnel.',
        'Consultar en el router si la conexión tiene IP pública o está detrás de NAT/CGNAT.',
      ],
      tasks: [
        'Hacer una lista de los dispositivos (pares) y la subred privada del túnel.',
        'Decidir qué par tendrá un puerto UDP alcanzable (el ejemplo oficial usa 51820).',
        'Comprobar si la conexión a internet está detrás de NAT o CGNAT.',
      ],
      security: [
        'Decidir qué puede alcanzar cada par (AllowedIPs mínimas), en lugar de dar acceso a toda la red.',
        'Planificar que cada dispositivo genere sus propias claves; nada de claves compartidas.',
      ],
      validation: ['Cada par tiene dirección del túnel asignada y se conoce qué puerto UDP se abrirá.'],
      rollback: PREPARATION_ROLLBACK,
      sources: WIREGUARD_DOCS,
    },
    installation: {
      title: 'Instalar WireGuard de forma nativa',
      explanation: 'Usar el instalador o paquete oficial de cada sistema y generar las claves localmente en cada dispositivo.',
      prechecks: [
        'Tener acceso físico o una vía alternativa a cada dispositivo por si el túnel corta la conexión.',
        'Anotar la configuración actual del cortafuegos y del router antes de cambiarla.',
      ],
      tasks: [
        'Instalar WireGuard con el método oficial de cada sistema operativo.',
        'Generar el par de claves en cada dispositivo; la clave privada nunca sale de él ni se comparte.',
        'Configurar interfaz, AllowedIPs y endpoint de cada par (por ejemplo con wg-quick).',
        'Abrir solo el puerto UDP necesario en el par alcanzable.',
      ],
      security: [
        'En el prompt y en las notas usar <CLAVE_PÚBLICA_DEL_PAR>; la clave privada no se copia a ningún sitio.',
        'Proteger el archivo de configuración con permisos solo para administración.',
        'Abrir en el router/cortafuegos únicamente el puerto UDP del túnel.',
      ],
      validation: ['`wg show` muestra los pares configurados en cada dispositivo.'],
      rollback: [
        'Desactivar la interfaz del túnel devuelve la red a su estado anterior; cerrar el puerto UDP abierto.',
        'Restaurar la configuración del cortafuegos y del router que se anotó antes de empezar.',
      ],
      sources: WIREGUARD_DOCS,
    },
    verification: {
      title: 'Comprobar el túnel WireGuard',
      explanation: 'Verificar el tráfico entre pares y el comportamiento tras un cambio de red.',
      prechecks: ['Tener los dos extremos encendidos y el túnel activo.'],
      tasks: [
        'Comprobar que el último handshake es reciente en ambos extremos.',
        'Hacer ping entre direcciones del túnel.',
        'Probar desde otra red; si hay NAT, valorar PersistentKeepalive.',
      ],
      security: [
        'Comprobar que cada par solo alcanza las direcciones previstas en AllowedIPs.',
        'Comprobar que no hay más puertos abiertos que el UDP del túnel.',
      ],
      validation: ['Los pares se alcanzan por sus direcciones del túnel.'],
      rollback: ['Si no hay conexión, desactivar el túnel, revisar claves públicas, endpoint y puerto, y volver a la instalación.'],
      sources: WIREGUARD_DOCS,
    },
    recovery: {
      title: 'Plan de recuperación de WireGuard',
      explanation: 'Poder reconstruir la configuración y revocar un dispositivo perdido.',
      prechecks: ['Listar los pares activos y su dispositivo.'],
      tasks: [
        'Guardar la configuración de cada par sin incluir claves privadas en copias compartidas.',
        'Documentar cómo retirar un par perdido y regenerar sus claves.',
      ],
      security: [
        'Un dispositivo perdido se revoca quitando su clave pública de los demás pares, no solo apagándolo.',
      ],
      validation: ['Se puede retirar un par de prueba y el resto del túnel sigue funcionando.'],
      rollback: ['Si se retira un par por error, volver a añadir su clave pública desde la configuración guardada.'],
      sources: WIREGUARD_DOCS,
    },
  },
  outline: {
    preparation: {
      title: 'Preparar el servidor para Outline',
      explanation: 'Outline requiere un sistema Unix, PostgreSQL, Redis, un dominio dedicado y un proveedor de autenticación. Su licencia es BSL 1.1 (no open source).',
      prechecks: [
        'Consultar sistema operativo, RAM y espacio libre; confirmar que no es Windows Server.',
        'Consultar si Docker Compose está instalado y qué versión tiene.',
        'Consultar si el dominio o subdominio previsto ya existe, sin modificarlo.',
      ],
      tasks: [
        'Confirmar un sistema Unix (no Windows Server) con Docker Compose.',
        'Reservar un dominio o subdominio dedicado y planificar HTTPS.',
        'Elegir un proveedor de autenticación compatible.',
        'Elegir almacenamiento de archivos local persistente o compatible con S3.',
        'Revisar que el uso previsto respeta la licencia (no ofrecerlo como servicio documental comercial a terceros).',
      ],
      security: [
        'Decidir que PostgreSQL y Redis solo serán accesibles dentro de la red de Docker.',
        'Restringir en el proveedor de autenticación quién puede entrar (dominio o grupo permitido).',
      ],
      validation: ['Dominio, proveedor de autenticación y almacenamiento están decididos.'],
      rollback: PREPARATION_ROLLBACK,
      sources: OUTLINE_DOCS,
    },
    installation: {
      title: 'Instalar Outline con Docker',
      explanation: 'Seguir el ejemplo oficial de Docker Compose con PostgreSQL, Redis y HTTPS.',
      prechecks: [
        'Confirmar que el dominio apunta al servidor y que los puertos 80/443 están libres.',
        'Confirmar que el proveedor de autenticación permite registrar la URL de retorno del dominio.',
      ],
      tasks: [
        'Crear el archivo de entorno a partir del ejemplo oficial; generar los secretos localmente sin compartirlos.',
        'Definir los servicios de Outline, PostgreSQL y Redis y fijar versiones de imagen.',
        'Configurar el proveedor de autenticación y el almacenamiento de archivos.',
        'Arrancar los contenedores y publicar por HTTPS.',
      ],
      security: [
        'En el prompt usar marcadores como <TU_SECRETO> y <TU_CLIENT_ID>; los valores reales solo en el archivo de entorno local.',
        'No publicar los puertos de PostgreSQL ni de Redis; solo HTTPS a través del proxy.',
        'Montar el almacenamiento de archivos en un volumen persistente con permisos solo para el servicio.',
      ],
      validation: ['Se puede iniciar sesión con el proveedor configurado.'],
      rollback: [
        'Si falla, detener los contenedores con Docker Compose y revisar los registros; conservar los volúmenes.',
        'No eliminar volúmenes de PostgreSQL ni de archivos sin copia y sin confirmarlo.',
      ],
      sources: OUTLINE_DOCS,
    },
    verification: {
      title: 'Comprobar Outline',
      explanation: 'Verificar edición, búsqueda y adjuntos antes de migrar desde Notion.',
      prechecks: ['Usar documentos y adjuntos de prueba, sin contenido real.'],
      tasks: [
        'Crear un documento, editarlo en colaboración y buscarlo.',
        'Subir un adjunto y comprobar que persiste tras reiniciar los contenedores.',
      ],
      security: [
        'Comprobar que una cuenta no permitida no puede iniciar sesión.',
        'Comprobar desde otra red que solo responde HTTPS.',
      ],
      validation: ['Documento y adjunto siguen disponibles después de reiniciar.'],
      rollback: ['Si algo falla, borrar solo los documentos de prueba y volver a la instalación antes de migrar contenido.'],
      sources: OUTLINE_DOCS,
    },
    recovery: {
      title: 'Plan de recuperación de Outline',
      explanation: 'Conservar base de datos, archivos subidos y configuración.',
      prechecks: ['Calcular el tamaño de la base de datos y del almacenamiento de archivos.'],
      tasks: [
        'Programar copias de PostgreSQL y del almacenamiento de archivos.',
        'Guardar el archivo de entorno en un lugar privado y seguro, fuera de repositorios compartidos.',
        'Probar una restauración en un entorno de prueba.',
      ],
      security: [
        'Cifrar las copias que salgan del equipo; el archivo de entorno contiene secretos.',
      ],
      validation: ['Una restauración de prueba recupera documentos y adjuntos.'],
      rollback: ['Restaurar en un entorno separado; no sobrescribir la instalación en uso hasta comprobar la copia.'],
      sources: OUTLINE_DOCS,
    },
  },
});

/** Restricciones comunes de todos los prompts. */
export const PROMPT_CONSTRAINTS = Object.freeze([
  'Explica los pasos y comandos para que yo los revise y ejecute; no asumas acceso a mi equipo ni ejecutes nada por mí.',
  'No me pidas contraseñas, claves privadas ni tokens; usa marcadores como <TU_DOMINIO> o <TU_CLAVE> cuando haga falta.',
  'Antes de cualquier comando que borre, sobrescriba o reinicie algo, avísame, indica cómo hacer una copia y espera mi confirmación.',
  'Básate en la documentación oficial indicada y avisa si algo depende de la versión.',
  'Si falta un dato de mi equipo o hay una condición pendiente, pregúntamelo antes de continuar.',
  'No des por comprobados puertos, NAT, copias ni requisitos: NoMoreSaaS no los verifica; dime cómo comprobarlos yo.',
  'La estimación de recursos es orientativa y no garantiza que la instalación funcione.',
]);
