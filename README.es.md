# Devin Pocket

[English](https://github.com/BOTOOM/devin-pocket/blob/main/README.md) · [Español](https://github.com/BOTOOM/devin-pocket/blob/main/README.es.md)

Una interfaz web móvil para Devin CLI sobre ACP, en Android/Termux, Linux y macOS.

[![Versión npm](https://img.shields.io/npm/v/devin-pocket)](https://www.npmjs.com/package/devin-pocket)
[![Descargas npm](https://img.shields.io/npm/dm/devin-pocket)](https://www.npmjs.com/package/devin-pocket)
[![Licencia](https://img.shields.io/badge/license-Apache--2.0-blue)](https://github.com/BOTOOM/devin-pocket/blob/main/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/BOTOOM/devin-pocket/ci.yml?branch=main&label=CI)](https://github.com/BOTOOM/devin-pocket/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-green)](https://nodejs.org/)

**Proyecto comunitario no oficial. Sin afiliación con Cognition.**

## Qué es y funciones

Un proceso Node.js local sirve una PWA React por HTTP/WebSocket y administra un
hijo `devin acp` por stdio mediante Agent Client Protocol. Tras la instalación,
el uso diario ocurre en el navegador, no en una terminal. El equipo y el CLI
deben seguir encendidos; la PWA no es un agente sin conexión.

- Crear, listar, buscar, retomar, renombrar y cerrar sesiones; elegir workspace.
- Markdown en streaming, herramientas/código/diffs, permisos y planes de tareas.
- Mensajes en cola, cancelación y envío inmediato según las capacidades del agente.
- Controles de modelo, razonamiento y Fast cuando el agente los ofrece; comparar precios.
- Menciones de archivos, imágenes adjuntas y paleta de comandos del agente.
- Temas claro/oscuro/sistema, interfaz en español e inglés (español por defecto).
- Diagnóstico, registros, reportes de modelos/precios y una PWA instalable.

Las funciones dependen del CLI/modelo. Los precios vienen de
`devin models list --format json` autenticado; no se inventan precios faltantes.
El historial viene de ACP, no de una base de datos de sesiones propia de Pocket.

## Requisitos

- Node.js **22+** para la app instalada, npm o pnpm y un navegador moderno.
- [Devin CLI](https://cli.devin.ai/) y una cuenta autorizada desde la app o con
  `devin auth login`. Sin cuenta de Pocket ni claves API separadas.
- Linux/macOS; Android usa Termux con Ubuntu/proot para el CLI con glibc.
  El instalador Android admite **ARM64 o x86_64**, no dispositivos de 32 bits.
- Internet para instalación, autenticación y funcionamiento del agente.
- Termux:API y el paquete `termux-api` opcionales para wake lock.

## Instalación

### npm, npx o pnpm

```sh
npx devin-pocket
# O instala globalmente:
npm i -g devin-pocket
# O:
pnpm add -g devin-pocket
```

Si pnpm falla por el directorio global/PATH, ejecuta `pnpm setup` y abre otra
terminal o carga sus cambios de entorno. En proot puede no cargarse `~/.profile`:
asegura el directorio global en PATH. npm global necesita un prefijo escribible.

### Instalador general

```sh
curl -fsSL https://raw.githubusercontent.com/BOTOOM/devin-pocket/main/install.sh | bash
```

Revisa los scripts antes de ejecutarlos. Admite Linux, macOS, Termux y proot;
instala Node.js si falta (macOS requiere Homebrew ya instalado), prefiere pnpm
y recurre a npm si falla. Si falta Devin CLI, solo muestra instrucciones:
**no** instala Devin CLI ni inicia Pocket. Para Android completo usa el siguiente.

### Android/Termux desde cero, sin clonar

1. Instala **Termux** desde [sus releases oficiales en GitHub](https://github.com/termux/termux-app/releases).
   Usa Android 7+ y ARM64/x86_64. Los APK opcionales de Termux:Widget y Termux:API
   deben venir de la misma fuente; no mezcles firmas de GitHub y F-Droid. Instalar
   APK y autorizar tu cuenta son pasos manuales.
2. En **Termux normal**, no Ubuntu/proot, ejecuta:

   ```sh
   pkg update -y && pkg install -y curl && \
     curl -fsSL https://raw.githubusercontent.com/BOTOOM/devin-pocket/main/install-termux.sh | bash
   ```

   Actualiza Termux, instala `proot-distro`, crea Ubuntu (24.04 con la interfaz
   nueva de proot-distro) o lo reutiliza, actualiza Ubuntu, instala Node.js 22+ y
   herramientas de compilación, e instala Devin CLI oficial si falta. Elige la
   versión estable de npm más alta publicada hace **siete días** o más. Solo un
   E404 de npm activa la compilación del archivo fuente de `main`. Si el paquete
   existe pero ninguna versión tiene esa edad, se detiene: elige `--source` o
   `--package` explícitamente.

   Compilar usa el lockfile y las reglas de seguridad y necesita más tiempo,
   memoria/espacio y descargas. Sin `git clone`, borrado de Ubuntu ni inicio o
   reinicio automático de Pocket. Conserva lanzadores existentes. Si Pocket corre
   en el Ubuntu elegido, detenlo cuando sea seguro antes de repetir. El instalador
   no pide/guarda contraseñas ni claves API; la autorización ocurre después.
3. Inicia desde Termux y abre `http://127.0.0.1:7777`:

   ```sh
   devin-pocket-ubuntu
   devin-pocket-ubuntu doctor
   devin-pocket-ubuntu logs
   ```

   El lanzador entra a Ubuntu con el PATH necesario. Pulsa **Inicia sesión en
   Devin** / **Sign in to Devin**.

Descarga el script para pasar opciones:

```sh
curl -fsSL https://raw.githubusercontent.com/BOTOOM/devin-pocket/main/install-termux.sh -o install-termux.sh
bash install-termux.sh --help
bash install-termux.sh --source main
bash install-termux.sh --package devin-pocket@0.2.0
bash install-termux.sh --package "$HOME/devin-pocket-0.2.0.tgz"
bash install-termux.sh --source main --distro ubuntu --no-upgrade
```

| Opción | Significado |
| --- | --- |
| `--source REF` | Compila una rama pública, tag o commit de BOTOOM/devin-pocket. |
| `--package SPEC` | `devin-pocket@VERSION` exacta, URL HTTPS de tarball o `.tgz` local existente. |
| `--distro NAME` | Nombre del Ubuntu a crear/reutilizar; defecto `ubuntu`; debe ser Ubuntu. |
| `--no-upgrade` | Omite actualizaciones generales, instala requisitos. |
| `--help`, `-h` | Ayuda sin instalar. |

`--source` y `--package` son excluyentes. Si el instalador cambia en una rama,
descarga también el script desde esa rama y pásala a `--source`.

### Desde código fuente o un tarball local

Usa Node.js 24 actualizado para herramientas de desarrollo/releases; la app
empaquetada admite Node.js 22+. Activa Corepack si está disponible o instala pnpm fijado:

```sh
git clone https://github.com/BOTOOM/devin-pocket.git
cd devin-pocket
npm i -g pnpm@12.6.0
pnpm install --frozen-lockfile
pnpm run build
pnpm pack
npm install -g ./devin-pocket-*.tgz
devin-pocket doctor
devin-pocket start
```

Usa npm para el enlace global del tarball: `pnpm add -g <tgz>` ha sido un no-op
silencioso en algunos proot. Para uno ya descargado:
`npm install -g /path/to/devin-pocket-VERSION.tgz`. Desde un checkout compilado,
`DEVIN_POCKET_LOCAL=1 bash install.sh` instala el directorio que contiene el
script, **no** un tarball local arbitrario.

## Inicio rápido y primer login

```sh
devin-pocket start
# Abre http://127.0.0.1:7777 si el navegador no se abre.
```

Sin comando también significa start. El inicio normal ejecuta un supervisor en
segundo plano que reintenta caídas con espera creciente (no indefinidamente).
Pulsa **Inicia sesión en Devin** / **Sign in to Devin** en la PWA y autoriza tu
cuenta en el navegador. Si hace falta, ejecuta `devin auth login` en el equipo
servidor. Elige workspace/sesión y envía un mensaje. Instala la PWA desde el
navegador si lo admite; el equipo debe seguir encendido.

## Referencia del CLI

| Comando | Comportamiento |
| --- | --- |
| `start` (defecto) | Inicia supervisor y abre navegador. |
| `stop` | Detiene el proceso registrado en el pidfile. |
| `restart` | Lo detiene e inicia un supervisor con las opciones indicadas. |
| `status` | Indica si el proceso registrado sigue activo. |
| `logs` | Muestra las últimas 100 entradas de la app por defecto. |
| `doctor` | Revisa runtime, CLI/auth/ACP, rutas, puertos y permisos. |
| `models` | Actualiza y muestra diagnóstico de modelos/precios. |
| `open` | Abre `http://127.0.0.1:PORT`, incluso con otro host configurado. |
| `version` | Muestra la versión instalada. |
| `help` | Muestra uso. |

| Flag | Uso/defecto |
| --- | --- |
| `--port N` | Puerto: config o `7777`; también doctor/open. |
| `--host H` | Dirección de escucha: config o `127.0.0.1`; también doctor. |
| `--cwd DIR` | Directorio ACP: directorio actual por defecto. |
| `--agent CMD` | Comando agente: prevalece sobre env/config; defecto `devin acp`. |
| `--no-open` | No abre navegador al iniciar. |
| `--foreground` | Ejecuta start en primer plano en vez de daemonizar. |
| `--dev` | Inicio de desarrollo en primer plano, sin abrir navegador. |
| `-f`, `--follow` | Sigue registros de la app (`logs`). |
| `-n N` | Cantidad de entradas (`logs`), defecto `100`. |
| `-h`, `--help` | Muestra ayuda. |
| `-v`, `--version` | Muestra versión. |

Las opciones de inicio aplican a `start`/`restart` cuando corresponde. Restart
crea un supervisor, no recupera el modo foreground ni recuerda flags anteriores.

```sh
devin-pocket start --cwd "$HOME/project" --port 7778 --no-open
devin-pocket logs -f -n 50
devin-pocket stop
```

## Configuración y entorno

Config opcional: `$XDG_CONFIG_HOME/devin-pocket/config.json`, por defecto
`~/.config/devin-pocket/config.json`. Si falta o es inválida usa los valores predeterminados.

```json
{
  "port": 7777,
  "host": "127.0.0.1",
  "agentCommand": "devin acp",
  "workspaces": [],
  "theme": "system",
  "showThoughts": false,
  "lang": "es"
}
```

Cada workspace tiene `path`, `name` y `lastUsedAt` numérico opcional. El esquema
acepta `theme`, `showThoughts` y `lang`, pero las preferencias de interfaz se
gestionan en el almacenamiento del navegador; no dependas de esos campos para fijarlas.

| Variable | Propósito |
| --- | --- |
| `DEVIN_POCKET_AGENT` | Comando agente: primero `--agent`, luego env, luego config. |
| `DEVIN_POCKET_VERBOSE=1` | Escribe también registros de la app en stderr. |
| `XDG_CONFIG_HOME` | Base de configuración; defecto `~/.config`. |
| `XDG_STATE_HOME` | Base de estado; defecto `~/.local/state`. |
| `XDG_CACHE_HOME` | Base de caché; defecto `~/.cache`. |
| `DEVIN_POCKET_MODELS_FILE` | Desarrollo: fixture JSON de catálogo en vez del CLI. |
| `DEVIN_POCKET_LOCAL=1` | Instalador general: instala su propio directorio fuente. |

Estado en el subdirectorio `devin-pocket`: `server.pid`, `titles.json` (respaldo
de renombrado), `devin-pocket.log`, `devin-acp.stderr.log`, `daemon.out.log`. Caché:
`$XDG_CACHE_HOME/devin-pocket/models.json`, defecto `~/.cache/devin-pocket/models.json`,
vigente durante 24 horas. `DEVIN_POCKET_SUPERVISOR` y `DEVIN_POCKET_DAEMON` son
marcadores internos, no opciones del usuario; Termux/proot también usa marcadores de plataforma.

## Consejos para Termux

- Wake lock intenta usar `termux-wake-lock`; instala Termux:API y ejecuta
  `pkg install termux-api` en Termux si hace falta.
- El instalador sin clonar crea `~/.shortcuts/Devin Pocket` para Termux:Widget
  opcional; no sobrescribe accesos ni lanzadores existentes.
- El instalador general ofrece acceso directo solo si ya existe el directorio;
  en proot muestra instrucciones en su lugar.
- Desactiva la optimización de batería de Termux y Termux:API. Android aún puede
  terminar procesos por falta de memoria. Termux:Boot puede ejecutar tu lanzador
  si lo configuras aparte; el instalador no configura el arranque automático.

## Seguridad y acceso remoto

Escucha predeterminada: **127.0.0.1:7777**. El login de Devin autentica al agente,
**no a clientes de Pocket**. No hay autenticación de clientes, emparejamiento ni TLS
integrados. `--host 0.0.0.0` expone la app y capacidades del agente a la red;
los controles de origen no son autenticación. No lo expongas a Internet público.
Si necesitas acceso remoto deliberadamente, usa un túnel/proxy con control de
acceso. HTTP no local puede perder funciones de contexto seguro/PWA del navegador.
Revisa permisos y reportes/registros antes de compartir: contienen rutas e información del proyecto.

## Diagnóstico y preguntas frecuentes

```sh
devin-pocket doctor
devin-pocket logs -n 100
devin-pocket models
```

**Diagnostics / Diagnóstico** incluye comprobaciones, registros y reporte JSON
descargable. El diagnóstico de modelos muestra comando, fuente, errores y salida
del CLI. Revisa información sensible antes de adjuntar reportes a issues.

- **¿Falta CLI/login bloqueado?** Instala CLI en el servidor; prueba `devin auth login`.
- **¿Puerto ocupado?** Detén la instancia previa o inicia con `--port 7778`.
- **¿Faltan precios?** Revisa login y `models`; algunos modelos no tienen precios
  y la caché puede estar desactualizada.
- **¿Faltan sesiones?** Dependen de ACP/workspace, no de una base de datos local.
- **¿Fast/razonamiento/imágenes?** Dependen del agente/modelo. Cada imagen tiene
  límite de 1.5 MB; los mensajes codificados también tienen límite WebSocket de 2 MiB.
- **¿Sin versión npm con siete días?** Elige `--source main` o
  `--package devin-pocket@VERSION`; npm/npx directos no aplican ese filtro.
- **¿Sin conexión o reemplaza Devin?** No: Pocket es un cliente para Devin CLI.
- **¿Windows?** Windows nativo no es un destino de instalación documentado como compatible.

## Hoja de ruta y limitaciones

Se planean flujos de cliente remoto para desktop/laptop. Hoy es una interfaz
móvil servida por el equipo local. Quedan pendientes emparejamiento/acceso remoto
autenticado y virtualización de listas/transcripts grandes. Los comandos editados
en permisos se muestran como solo lectura; las capacidades varían según el agente.

## Desarrollo

Usa pnpm fijado y Node.js 24 actualizado.

```sh
pnpm install --frozen-lockfile
pnpm run dev
# O servidor + agente falso sin login de Devin:
pnpm run dev:fake
pnpm run check
pnpm run typecheck
pnpm test
pnpm run build
pnpm run test:e2e
```

`dev` inicia Vite en 5173 y el servidor. `src/server` contiene HTTP/WS y ACP,
`src/shared` el protocolo/reducer, `src/web` la PWA React. Compila antes de usar
`bin/devin-pocket.mjs`, que carga `dist/server.mjs`.
Consulta [AGENTS.md](https://github.com/BOTOOM/devin-pocket/blob/main/AGENTS.md).

## Contribuir

Abre [issues](https://github.com/BOTOOM/devin-pocket/issues) con pasos para
reproducir y diagnóstico sin datos sensibles; los PR enfocados son bienvenidos.
Mantén ambos README sincronizados, usa conventional commits y ejecuta los checks
anteriores. `docs(readme)` genera un patch con semantic-release en main; nunca
edites versiones manualmente ni subas tags de release.

## Licencia y atribución

Apache License 2.0. Consulta [LICENSE](https://github.com/BOTOOM/devin-pocket/blob/main/LICENSE)
y [NOTICE](https://github.com/BOTOOM/devin-pocket/blob/main/NOTICE). Porciones
portadas de **devin-tui**, copyright Mark Fenner, bajo MIT.
