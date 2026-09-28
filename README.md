# Devin Pocket

## Qué es

Devin Pocket es un cliente web móvil para Devin CLI sobre Agent Client Protocol (ACP). Sirve una PWA y maneja el proceso `devin acp` desde un único proceso Node.js. En el uso diario puedes trabajar desde el navegador del teléfono sin abrir una terminal; el servidor sigue siendo local y está pensado para Android con Termux, así como Linux y macOS.

## Requisitos

- Node.js 22 o posterior.
- Android: Termux y, si el CLI requiere glibc, una distro Ubuntu/Debian mediante `proot-distro`.
- Devin CLI instalado y autenticado. Linux/macOS también son compatibles.
- Termux:API es opcional, pero permite mantener el proceso despierto.

## Instalación

Con npm:

```sh
npm install -g devin-pocket
```

Instalador (Linux, macOS, Termux o proot):

```sh
curl -fsSL https://raw.githubusercontent.com/BOTOOM/devin-pocket/main/install.sh | bash
```

También puedes usar `npx devin-pocket` o instalar un tarball local con `DEVIN_POCKET_LOCAL=1 ./install.sh`.

## Uso

```sh
devin-pocket start
devin-pocket stop
devin-pocket restart
devin-pocket status
devin-pocket logs
devin-pocket doctor
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
npm install
npm run dev
npm run dev:fake
npm test
npm run build
```

El fake agent permite trabajar sin iniciar sesión: `DEVIN_POCKET_AGENT="npx tsx test/fake-agent.ts" FAKE_AGENT_AUTHED=1`.

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

Requirements are Node.js 22+, Devin CLI, and authentication. On Android, use Termux and proot Ubuntu/Debian when the CLI needs glibc. Install with npm or the install script above. Run `start`, `stop`, `restart`, `status`, `logs`, `doctor`, and `open` as shown in the Spanish section.

The config file is `~/.config/devin-pocket/config.json`; state and logs use `$XDG_STATE_HOME/devin-pocket`. Development uses `npm run dev`, `npm run dev:fake`, `npm test`, and `npm run build`. The architecture is one HTTP+WS server process with an ACP child, shared protocol/reducer code, and a React PWA.

Known limitations: model prices require an authenticated `devin models list`; edited permission commands are currently read-only because the wire protocol does not forward edits; real ACP compatibility was checked without logging in. Devin Pocket is Apache-2.0; see `LICENSE` and `NOTICE`, including the MIT attribution for portions ported from devin-tui by Mark Fenner.
