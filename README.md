# Devin Pocket

## Qué es

Devin Pocket es un cliente web móvil para Devin CLI sobre Agent Client Protocol (ACP). Sirve una PWA y maneja el proceso `devin acp` desde un único proceso Node.js. En el uso diario puedes trabajar desde el navegador del teléfono sin abrir una terminal; el servidor sigue siendo local y está pensado para Android con Termux, así como Linux y macOS.

## Requisitos

- Node.js 22 o posterior.
- Android: Termux y, si el CLI requiere glibc, una distro Ubuntu/Debian mediante `proot-distro`.
- Devin CLI instalado y autenticado. Linux/macOS también son compatibles.
- Termux:API es opcional, pero permite mantener el proceso despierto.

## Instalación

Con pnpm o npm:

```sh
pnpm add -g devin-pocket   # o: npm install -g devin-pocket
```

Instalador (Linux, macOS, Termux o proot):

```sh
curl -fsSL https://raw.githubusercontent.com/BOTOOM/devin-pocket/main/install.sh | bash
```

También puedes usar `npx devin-pocket` o instalar un tarball local con `DEVIN_POCKET_LOCAL=1 ./install.sh`.

### Desde cero en Android/Termux, sin clonar

1. Instala **Termux** desde [sus releases oficiales en GitHub](https://github.com/termux/termux-app/releases). Necesitas Android 7+ y un entorno ARM64 o x86_64; el binario de Devin CLI no soporta Android/Termux de 32 bits. Si usas Termux:Widget o Termux:API, instala también sus APK desde la misma fuente que Termux; no mezcles firmas de GitHub y F-Droid. Instalar los APK y autorizar tu cuenta de Devin son pasos manuales.
2. Abre **Termux normal**, no una sesión de Ubuntu, y ejecuta:

```sh
pkg update -y && pkg install -y curl && \
  curl -fsSL https://raw.githubusercontent.com/BOTOOM/devin-pocket/main/install-termux.sh | bash
```

El script actualiza los paquetes de Termux, instala `proot-distro`, crea Ubuntu (24.04 en versiones actuales de proot-distro) o reutiliza el existente, actualiza sus paquetes, instala Node.js 22+ y sus herramientas y descarga el instalador oficial de Devin CLI si falta. Para Pocket elige la versión estable de npm más alta publicada hace al menos siete días. Si el paquete aún no existe en npm, descarga una copia comprimida de `main` y la compila con el lockfile y las reglas de seguridad del repositorio. **No usa `git clone`, no borra Ubuntu ni pide contraseñas o claves API.**

Para instalar desde una rama, usa la referencia de esa rama tanto para descargar el script como para compilar:

```sh
pkg update -y && pkg install -y curl && \
  curl -fsSL https://raw.githubusercontent.com/BOTOOM/devin-pocket/devin/1790558006-devin-pocket-mvp/install-termux.sh | \
  bash -s -- --source devin/1790558006-devin-pocket-mvp
```

También puedes instalar una versión específica, un paquete `.tgz` descargado, o compilar un tag/commit sin clonar:

```sh
curl -fsSL https://raw.githubusercontent.com/BOTOOM/devin-pocket/main/install-termux.sh | bash -s -- --package devin-pocket@0.1.5
curl -fsSL https://raw.githubusercontent.com/BOTOOM/devin-pocket/main/install-termux.sh | bash -s -- --package "$HOME/devin-pocket-0.1.5.tgz"
curl -fsSL https://raw.githubusercontent.com/BOTOOM/devin-pocket/main/install-termux.sh | bash -s -- --source main --no-upgrade
```

`--distro NOMBRE` permite elegir otro Ubuntu. `--no-upgrade` omite las actualizaciones generales, pero instala los requisitos necesarios. Si Pocket está corriendo dentro del Ubuntu elegido, el script se detiene antes de modificar sus paquetes: vuelve a intentarlo cuando puedas detener la app de forma segura. Se conservan los lanzadores existentes, y la app **no se inicia ni se reinicia automáticamente**.

3. Al terminar, abre Pocket desde Termux:

```sh
devin-pocket-ubuntu
devin-pocket-ubuntu doctor
devin-pocket-ubuntu logs
```

El lanzador entra a Ubuntu y prepara el PATH; no necesitas recordar el comando de proot. Abre `http://127.0.0.1:7777` y pulsa **Inicia sesión en Devin**. Se crea también `~/.shortcuts/Devin Pocket` para Termux:Widget, si instalas ese complemento. Desactiva la optimización de batería de Termux; Android todavía puede finalizar procesos por falta de memoria. La instalación desde código fuente tarda y consume más recursos que instalar un paquete de npm, y requiere conexión para las descargas.

## Uso

```sh
devin-pocket start
devin-pocket stop
devin-pocket restart
devin-pocket status
devin-pocket logs
devin-pocket doctor
devin-pocket models   # diagnóstico del catálogo de modelos y precios
devin-pocket open
```

Abre `http://127.0.0.1:7777` si no se abre el navegador automáticamente.

## Primer uso

La primera vez, pulsa **Inicia sesión en Devin** en la PWA. Devin abrirá el navegador para autorizar la cuenta. Si necesitas hacerlo manualmente: `devin auth login`.

## Termux: mantener vivo

El servidor usa `termux-wake-lock` cuando está disponible. Para un acceso directo instala Termux:Widget y crea un launcher que ejecute `devin-pocket start`; Termux:Boot puede iniciarlo al arrancar Android. Desactiva la optimización de batería para Termux y Termux:API para evitar que Android suspenda el proceso.

## Diagnóstico

Ejecuta `devin-pocket doctor` para revisar Node, Devin, autenticación, ACP, puertos, disco y permisos. Usa `devin-pocket logs` para los registros. La pantalla **Diagnóstico** incluye el doctor, los últimos registros y la descarga de un reporte JSON.

## Configuración

El archivo opcional es `~/.config/devin-pocket/config.json`:

```json
{
  "port": 7777,
  "host": "127.0.0.1",
  "agentCommand": "devin acp",
  "workspaces": [{ "path": "/home/me/project", "name": "project" }],
  "theme": "system",
  "showThoughts": false,
  "lang": "es"
}
```

El estado y los registros viven en `$XDG_STATE_HOME/devin-pocket` (por defecto `~/.local/state/devin-pocket`); la caché de modelos en `~/.cache/devin-pocket`.

## Desarrollo

```sh
pnpm install
pnpm run dev
pnpm run dev:fake
pnpm test
pnpm run build
```

El fake agent permite trabajar sin iniciar sesión: `DEVIN_POCKET_AGENT="npx tsx test/fake-agent.ts" FAKE_AGENT_AUTHED=1`. Para desarrolladores: la guía completa de arquitectura, convenciones y depuración está en `AGENTS.md`.

### Instalar desde el código fuente

```sh
git clone https://github.com/BOTOOM/devin-pocket.git && cd devin-pocket
corepack enable && corepack prepare --activate   # o: npm i -g pnpm
pnpm install && pnpm run build
pnpm pack && npm install -g ./devin-pocket-*.tgz   # pnpm add -g no instala enlaces en algunos entornos proot
devin-pocket doctor && devin-pocket start
```

## Arquitectura

Un proceso Node sirve HTTP y WebSocket, mantiene la PWA y administra un hijo ACP por stdio. `src/server` contiene el servidor y CLI, `src/shared` contiene el contrato y reducer compartidos, y `src/web` contiene React, estilos y componentes.

## Estado y limitaciones

- Los precios solo están disponibles cuando `devin models list` puede ejecutarse con una sesión autenticada.
- `editableCommands` se muestra como solo lectura: el protocolo actual no reenvía el comando editado.
- Se probó con el fake agent y con `devin acp` real sin iniciar sesión; no se autentica automáticamente.
- Es una primera versión móvil: la lista de sesiones y el transcript no están virtualizados.

## Licencia y atribución

Devin Pocket se distribuye bajo **Apache License 2.0**. Consulta `LICENSE` y `NOTICE` para los términos completos y atribuciones. Porciones de la implementación fueron portadas de **devin-tui**, copyright Mark Fenner, bajo MIT.

---

# Devin Pocket (English)

Devin Pocket is a mobile web client for Devin CLI over ACP. One local Node.js process serves the PWA and drives a `devin acp` child, so daily use happens in the browser instead of a terminal. It supports Android/Termux, Linux, and macOS.

Requirements are Node.js 22+, Devin CLI, and authentication. On Android, use Termux and proot Ubuntu/Debian when the CLI needs glibc. Install with pnpm or npm (`pnpm add -g devin-pocket` / `npm install -g devin-pocket`) or the install script above. Run `start`, `stop`, `restart`, `status`, `logs`, `doctor`, `models` (catalog/pricing diagnostics), and `open` as shown in the Spanish section.

The config file is `~/.config/devin-pocket/config.json`; state and logs use `$XDG_STATE_HOME/devin-pocket`. Development uses `pnpm run dev`, `pnpm run dev:fake`, `pnpm test`, and `pnpm run build` (enable pnpm with `corepack enable` or `npm i -g pnpm`). From-source global install: `pnpm pack && npm install -g ./devin-pocket-*.tgz` (`pnpm add -g` of a tarball is a silent no-op on Termux proot) — see the Spanish "Instalar desde el código fuente" block. For developers: `AGENTS.md` documents the architecture, conventions, and debugging recipe. The architecture is one HTTP+WS server process with an ACP child, shared protocol/reducer code, and a React PWA.

Known limitations: model prices require an authenticated `devin models list`; edited permission commands are currently read-only because the wire protocol does not forward edits; real ACP compatibility was checked without logging in. Devin Pocket is Apache-2.0; see `LICENSE` and `NOTICE`, including the MIT attribution for portions ported from devin-tui by Mark Fenner.
