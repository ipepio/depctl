# Arquitectura v2

## Resumen

La v2 mantiene el webhook remoto para despliegues automaticos, pero mueve toda la administracion de escritura a una interfaz local `CLI/TUI` ejecutada en un contenedor admin puntual. La misma imagen soporta dos modos:

- `webhook`: servicio HTTP expuesto.
- `admin`: contenedor local sin puertos para tareas operativas.

El objetivo es reducir la superficie remota, estandarizar la gestion local del servidor y facilitar el alta de nuevos repositorios y stacks sin editar YAML a mano.

---

## API remota objetivo

La API remota de la v2 queda limitada a:

- `POST /deploy`
- `GET /health`
- `GET /jobs/:id`
- `GET /deployments/recent`

Salen de la API remota:

- `POST /admin/deploy`
- `POST /admin/deploy/redeploy-last-successful`
- `POST /admin/jobs/:id/retry`

Estas operaciones pasan a la interfaz local admin.

---

## Topologia v2

```text
+--------------------------------------------------------------+
| docker-deploy-webhook                                        |
|                                                              |
|  +-------------------+       +----------------------------+  |
|  | webhook           |       | admin                      |  |
|  | HTTP expuesto     |       | CLI/TUI local, sin puertos |  |
|  | config RO         |       | config RW bajo demanda     |  |
|  +---------+---------+       +-------------+--------------+  |
|            |                                 |                |
|            v                                 v                |
|      +-----+---------------------------------+-------------+  |
|      | Config local /opt/stacks / data / Redis / Docker    |  |
|      +-----------------------------------------------------+  |
+--------------------------------------------------------------+
```

---

## Layout del host

### Configuracion del servicio

- `config/server.yml`
- `config/repos/<repo>.yml`
- `.env` del servicio

### Stacks gestionados

Todos los stacks se estandarizan bajo:

```text
/opt/stacks/<owner>/<repo>/
```

En produccion ese es el root esperado. Para desarrollo o test se puede sobreescribir con `STACKS_ROOT`, pero el contrato operativo documentado sigue siendo `/opt/stacks`.

Archivos esperados:

- `docker-compose.yml`
- `.env`
- `.deploy.env`

Contratos:

- `.env` contiene configuracion y secretos propios del stack.
- `.deploy.env` contiene solo `IMAGE_NAME` e `IMAGE_TAG`.
- El motor de despliegue solo escribe `.deploy.env`.

### Servicios desplegables vs auxiliares

La v2 distingue dos clases de servicios dentro del stack:

- **desplegables**: usan `${IMAGE_NAME}:${IMAGE_TAG}` y forman parte de `environments.<env>.services`
- **auxiliares**: `postgres`, `redis`, `nginx` y similares; viven en el stack, pero no forman parte del deploy versionado del repo

Esto evita que el motor intente hacer `pull` o `up` de servicios auxiliares como si fueran el artefacto principal del repositorio.

### Metadata de stacks gestionados

Para poder editar incrementalmente los stacks generados por la herramienta, el `docker-compose.yml` puede incluir metadata propia bajo una extension `x-*`, por ejemplo:

```yaml
x-deploy-webhook:
  managed: true
  version: 1
  repository: acme/payments-api
```

Docker Compose ignora estas claves, pero la `CLI/TUI` puede usarlas para saber si un stack esta gestionado por la herramienta y si es seguro regenerarlo.

---

## Contenedor admin

El modo admin debe poder:

- leer y escribir `config/repos/*.yml`
- leer y escribir el `.env` del servicio
- leer y escribir `/opt/stacks/<owner>/<repo>`
- invocar validaciones locales
- lanzar deploy manual, redeploy y retry de forma local

No debe exponer puertos HTTP.

---

## Capacidades de la CLI/TUI

### Gestion de repos y entornos

- crear repo
- editar repo
- anadir entorno
- editar entorno
- listar configuracion
- validar configuracion completa antes del restart

### Gestion de secrets del repo

- generar `Bearer` y `HMAC`
- persistirlos localmente
- mostrarlos bajo demanda para copiarlos a GitHub Secrets
- detectar faltantes o inconsistencias

### Operaciones de despliegue local

- deploy manual
- redeploy del ultimo exitoso
- retry de jobs fallidos

### Wizard de stack

- crear un `docker-compose.yml` base funcional
- mantener `.env` del stack
- generar `.deploy.env` vacio o base si hace falta
- trabajar sobre un catalogo de servicios soportados
- distinguir servicios desplegables de auxiliares
- editar solo stacks gestionados por la herramienta o pedir una migracion/importacion explicita

Catalogo inicial previsto:

- `app`
- `worker`
- `postgres`
- `redis`
- `nginx`

El wizard debe usar defaults funcionales y permitir parametrizar los campos mas comunes sin intentar cubrir todo Docker Compose.

---

## Seguridad

- La configuracion local manda siempre; nunca se acepta configuracion operativa desde payloads remotos.
- El contenedor `webhook` expuesto no debe necesitar permisos de escritura sobre la config del servicio.
- El contenedor admin concentra la escritura local y solo debe ejecutarse bajo demanda.
- Los secretos siguen fuera del YAML del repo; los archivos generados solo referencian nombres de variables o valores locales del stack donde corresponda.

---

## Ciclo de cambio de configuracion

1. El operador ejecuta la `CLI/TUI` local.
2. La herramienta genera o edita config del repo y del stack.
3. La herramienta valida rutas, compose, servicios y secretos requeridos.
4. El operador reinicia el servicio `webhook`.
5. El servicio recarga la configuracion al arrancar.

La v2 mantiene el contrato de `restart` para aplicar cambios. No hay hot reload.

---

## Roadmap recomendado

1. Sacar las escrituras admin de la API remota y dejar solo webhook + lectura.
2. Introducir el entrypoint admin y la base de la CLI.
3. Implementar scaffold de repos, entornos y gestion de secrets.
4. Implementar el wizard de stacks con catalogo soportado.
5. Anadir TUI local reutilizando la misma capa de aplicacion.
