# Task 9 - Frontera API v2 y canal admin local

## Objetivo

Reducir la superficie remota de la aplicacion a `POST /deploy` y endpoints de lectura, y preparar la misma imagen para funcionar en dos modos diferenciados:

- `webhook`: servicio HTTP expuesto y worker de despliegue.
- `admin`: interfaz local para administracion operativa, sin puertos expuestos.

Esta task no implementa aun toda la CLI de la v2. Su trabajo es fijar la frontera del sistema, mover la escritura fuera de HTTP remoto y dejar preparado el terreno tecnico para las tasks siguientes.

---

## Para que existe

La v1 mezcla dos responsabilidades distintas en la API HTTP:

- recibir webhooks remotos desde GitHub Actions
- permitir operaciones operativas de escritura como deploy manual, redeploy y retry

La v2 quiere separar claramente ambos mundos:

- lo remoto queda limitado al webhook automatico y a la observabilidad de lectura
- lo operativo sensible pasa a un canal local autenticado, ejecutado solo en el propio servidor

Esto reduce superficie de ataque, permite endurecer permisos del contenedor expuesto y habilita una futura `CLI/TUI` local sin volver a abrir escritura por red.

---

## Alcance

Esta task SI incluye:

- retirar de la API remota las rutas admin de escritura
- mantener la API remota de lectura y el webhook automatico
- extraer las operaciones admin de escritura a una capa reutilizable para la futura `CLI/TUI`
- preparar el arranque de la imagen en dos modos: `webhook` y `admin`
- definir el contrato operativo del contenedor admin puntual
- ajustar mounts, comandos y documentacion para el nuevo modelo

Esta task NO incluye:

- implementar la CLI completa de gestion de repos y entornos
- implementar la TUI
- implementar el wizard de stacks
- hot reload de configuracion
- migracion automatica de instalaciones v1 ya desplegadas

---

## Dependencias previas

- Tasks 1-8 completadas como base funcional de la v1.

---

## Entregables

Al cerrar esta task deben existir, como minimo:

- una API remota que expone solo webhook y lectura
- una capa de casos de uso locales para deploy manual, redeploy y retry
- un entrypoint capaz de arrancar en modo `webhook` o `admin`
- una definicion operativa clara del contenedor admin puntual
- documentacion actualizada sobre la nueva frontera del sistema
- tests que garanticen que la escritura admin ya no entra por HTTP remoto

---

## Quehaceres

### 9.1 Limitar la API remota a webhook y lectura

La v2 debe dejar expuestos solo estos endpoints HTTP remotos:

- `POST /deploy`
- `GET /health`
- `GET /jobs/:id`
- `GET /deployments/recent`

Deben salir de la API remota:

- `POST /admin/deploy`
- `POST /admin/deploy/redeploy-last-successful`
- `POST /admin/jobs/:id/retry`

Esto implica como minimo:

1. eliminar esas rutas del router HTTP
2. dejar de documentarlas como capacidad remota del sistema
3. ajustar tests que dependian de esos endpoints

El comportamiento esperado cuando alguien llame a esas rutas en v2 es uno de estos dos:

- `404 Not Found` porque la ruta ya no existe
- `405 Method Not Allowed` si se decide reservar el path de otra forma

La recomendacion es la opcion mas simple: que la ruta desaparezca y responda `404`.

### 9.2 Mantener las operaciones admin, pero movidas a una capa local

Las operaciones de escritura no desaparecen. Deben seguir existiendo y respetar las mismas restricciones del target:

- deploy manual
- redeploy del ultimo exitoso
- retry de jobs fallidos

La diferencia es que dejan de vivir como controladores HTTP y pasan a una capa de aplicacion reutilizable por la futura CLI y por la futura TUI.

Recomendacion de estructura:

```text
src/
├── cli/
│   ├── index.ts
│   ├── bootstrap.ts
│   └── use-cases/
│       ├── manual-deploy.ts
│       ├── redeploy-last-successful.ts
│       └── retry-job.ts
```

No es obligatorio que los nombres finales sean exactamente esos, pero si debe quedar una capa clara de casos de uso locales desacoplada del transporte HTTP.

### 9.3 Definir el contrato de los casos de uso admin locales

Los tres casos de uso deben aceptar datos ya tipados y devolver resultados aptos para CLI/TUI.

Ejemplos de contratos recomendados:

```typescript
interface ManualDeployInput {
  repository: string;
  environment: string;
  tag: string;
  force?: boolean;
}

interface RedeployLastSuccessfulInput {
  repository: string;
  environment: string;
  force?: boolean;
}

interface RetryJobInput {
  jobId: string;
  force?: boolean;
}

interface LocalAdminResult {
  status: 'accepted' | 'ignored_duplicate' | 'replaced_pending';
  jobId: string;
  tag?: string;
}
```

Cada caso de uso debe reutilizar la logica ya existente del sistema:

- `getRepoConfig()`
- validaciones del target
- `enqueueDeployJob()`
- `readRollbackState()`
- `getJob()`

La regla es: cambiar de canal, no duplicar logica.

### 9.4 Introducir modos de ejecucion de la imagen

La misma imagen debe soportar al menos dos modos:

- `webhook`: arranca HTTP, Redis, worker y la logica de siempre
- `admin`: arranca una interfaz local y termina al completar el comando

Recomendacion de invocacion:

```bash
node dist/index.js webhook
node dist/index.js admin <subcomando>
```

Comportamiento recomendado del entrypoint:

1. parsear `process.argv`
2. si el primer argumento es `webhook`, ejecutar el bootstrap actual del servidor
3. si el primer argumento es `admin`, delegar al bootstrap de CLI/TUI local
4. si no hay argumento, usar `webhook` por defecto o fallar con ayuda clara

La recomendacion mas operativa es:

- `CMD ["node", "dist/index.js", "webhook"]`

### 9.5 Preparar el modo `admin` para correr en contenedor puntual

El modo admin debe estar pensado para ejecutarse asi:

```bash
docker compose run --rm admin <comando>
```

Requisitos del contenedor admin:

- no publica puertos
- no se queda corriendo permanentemente
- comparte codigo y version con `webhook`
- ve los mismos datos operativos del servidor
- tiene permisos de escritura solo cuando se invoca

### 9.6 Ajustar mounts y permisos del modelo v2

El nuevo modelo operativo debe distinguir claramente dos perfiles de permisos.

**`webhook` expuesto**

Debe poder:

- leer `config/server.yml`
- leer `config/repos/*.yml`
- leer secretos desde su entorno
- leer `docker-compose.yml` de cada stack
- escribir `runtime_env_file` (`.deploy.env`)
- leer/escribir `data/` para estado local
- hablar con Redis
- hablar con el socket Docker

Por tanto, el `webhook` puede seguir con la config montada en solo lectura, pero necesita acceso de escritura a `/opt/stacks` porque el motor actual escribe `.deploy.env`.

**`admin` puntual**

Debe poder:

- leer y escribir `config/repos/*.yml`
- leer y escribir el `.env` del servicio
- leer y escribir `/opt/stacks/<owner>/<repo>`
- hablar con Redis si ejecuta operaciones admin que encolan jobs o consultan estado
- hablar con el socket Docker si valida compose o genera stacks

Recomendacion de mounts operativos:

```yaml
services:
  webhook:
    command: ['node', 'dist/index.js', 'webhook']
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./config:/app/config:ro
      - ./data:/app/data
      - /opt/stacks:/opt/stacks

  admin:
    command: ['node', 'dist/index.js', 'admin']
    profiles: ['admin']
    ports: []
    restart: 'no'
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./config:/app/config
      - ./data:/app/data
      - /opt/stacks:/opt/stacks
      - ./.env:/app/.env
```

### 9.7 Mantener lectura remota autenticada

Los endpoints remotos de lectura se mantienen:

- `GET /jobs/:id`
- `GET /deployments/recent`

Siguen protegidos por autenticacion admin de lectura/escritura.

No hay que eliminar el concepto de tokens admin del todo. Solo cambia su uso:

- lectura remota: si
- escritura remota: no

### 9.8 Actualizar packaging y arranque

Revisar y dejar cerrados estos puntos:

1. `Dockerfile` arranca por defecto en modo `webhook`
2. `docker-compose.yml` documenta el servicio `admin` o el comando equivalente
3. el runbook deja claro como invocar el canal admin local
4. el README ya no vende la API remota como canal de escritura

### 9.9 Actualizar documentacion tecnica y operativa

Actualizar como minimo:

- `README.md`
- `docs/arquitectura-v2.md`
- `docs/runbook.md`
- `AGENTS.md`

La documentacion debe reflejar:

- nueva frontera HTTP
- modo `admin`
- contenedor puntual sin puertos
- root de stacks `/opt/stacks/<owner>/<repo>`

### 9.10 Tests recomendados

Crear o actualizar tests para cubrir:

1. el router remoto ya no expone rutas admin de escritura
2. `GET /health`, `GET /jobs/:id` y `GET /deployments/recent` siguen funcionando
3. los casos de uso locales de deploy manual, redeploy y retry siguen encolando correctamente
4. el modo `webhook` y el modo `admin` arrancan por rutas de codigo separadas

Casos concretos utiles:

- `POST /admin/deploy` devuelve `404`
- `POST /admin/deploy/redeploy-last-successful` devuelve `404`
- `POST /admin/jobs/:id/retry` devuelve `404`
- `manualDeploy()` valida repo y env igual que antes
- `redeployLastSuccessful()` devuelve error claro si no hay `successfulTag`
- `retryJob()` falla con `job_not_retryable` si el job no esta en estado final fallido

---

## Riesgos a controlar

- No romper la logica de negocio al sacar la escritura de HTTP.
- No dejar el `webhook` sin acceso a `/opt/stacks`, porque hoy necesita escribir `.deploy.env`.
- No duplicar validaciones entre CLI y cola.
- No introducir una capa admin local que en realidad sea otra API remota disfrazada.

---

## Criterios de aceptacion

- [ ] La API remota de la v2 queda documentada y limitada a webhook + lectura.
- [ ] Las tres rutas admin de escritura dejan de existir en HTTP remoto.
- [ ] Las operaciones admin de escritura siguen existiendo en una capa local reutilizable por `CLI/TUI`.
- [ ] La imagen soporta un modo `webhook` y un modo `admin` con responsabilidades diferenciadas.
- [ ] El contenedor `admin` queda definido como contenedor puntual, sin puertos publicados.
- [ ] El root `/opt/stacks/<owner>/<repo>` queda fijado como contrato operativo.
- [ ] El `webhook` mantiene config en solo lectura, pero conserva acceso funcional a la escritura de `.deploy.env`.
- [ ] La documentacion ya no presenta la API remota como canal de escritura admin objetivo.
