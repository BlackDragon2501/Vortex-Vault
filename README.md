# Vórtex Vault

**Tus claves, sin límites.** Gestor de contraseñas y datos seguros 100% local, de Vortex Company.

## Modelo de seguridad

- La **contraseña maestra nunca se guarda** ni sale del navegador: se deriva una clave **AES-GCM 256** con **PBKDF2-SHA-256** (600.000 iteraciones, sal aleatoria de 16 bytes) usando la **Web Crypto API**.
- Cada entrada se cifra con AES-GCM y un IV aleatorio; los blobs viven en **IndexedDB** (respaldo automático en localStorage si no hay IndexedDB).
- Verificador cifrado para validar la maestra al desbloquear; error honesto si es incorrecta.
- **Bloqueo automático** por inactividad configurable (1/5/15/30 min) y bloqueo manual.
- Copiar contraseña la **autolimpia del portapapeles a los 30 segundos**.
- La **copia de seguridad exportada también está cifrada**: no contiene ningún dato en claro.
- Sin recuperación posible: si olvidas la maestra, los datos son inaccesibles (ni Vortex Company puede leerlos). Pista opcional guardada sin cifrar.

## Características

- Entradas con nombre, usuario, contraseña, sitio web, notas seguras, etiqueta de color y favoritos.
- **Generador de contraseñas** (8–64 caracteres, mayúsculas/minúsculas/números/símbolos, excluye caracteres ambiguos) con aleatoriedad `crypto.getRandomValues`.
- **Medidor de seguridad** en vivo (muy débil a muy fuerte) y contador de contraseñas débiles.
- Búsqueda instantánea por nombre, usuario, sitio o etiqueta.
- Importación de copias cifradas con fusión por versión (nunca en claro).

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · Web Crypto API · IndexedDB.

## Despliegue

Despliega directo en Vercel: no requiere variables de entorno. (Web Crypto requiere HTTPS.)

## Desarrollo

```bash
bun install
bun run dev     # http://localhost:3000
bun run build
bun run lint
```

---

Derechos Reservados © 2026 Vortex Company · soporte: vortexmusic.soporte.app@gmail.com · Gratis · Sin anuncios
