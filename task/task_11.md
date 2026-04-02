# Task 11 - Creator de stacks y catalogo de servicios

## Objetivo

Anadir un wizard local para generar y mantener el stack Docker Compose de un repo bajo `/opt/stacks/<owner>/<repo>`, usando un catalogo de servicios soportados y defaults funcionales.

La meta es que el alta de un repo nuevo no sea solo "crear YAML del deploy", sino tambien "dejar preparado un stack local compatible con el motor de despliegue".

---

## Para que existe

La configuracion de despliegue del servicio y la existencia del stack local hoy son dos mundos separados. El operador todavia tiene que:

- crear el directorio del stack a mano
- escribir `docker-compose.yml`
- crear `.env`
- recordar anadir `.deploy.env`
- decidir que servicios se despliegan y cuales son auxiliares

La v2 quiere cerrar ese hueco con un creator guiado que genere stacks operables, consistentes y compatibles con el motor del proyecto.

---

## Alcance

Esta task SI incluye:

- crear el layout de stack bajo `/opt/stacks/<owner>/<repo>`
- generar `docker-compose.yml`, `.env` y `.deploy.env`
- soportar un catalogo inicial de servicios conocidos
- distinguir entre servicios desplegables y servicios auxiliares
- mantener defaults funcionales para que el stack arranque con cambios minimos
- permitir edicion incremental de stacks gestionados por la herramienta

Esta task NO incluye:

- cubrir todo el esquema de Docker Compose
- importar y editar de forma segura cualquier compose arbitrario ajeno a la herramienta
- automatizar backups, migraciones de base de datos o provisioning externo
- gestionar secretos en un secret manager remoto
- convertir la herramienta en un orquestador generalista

---

## Dependencias previas

- Task 10 completada: CLI base y gestion local de configuracion disponibles.

---

## Entregables

Al cerrar esta task deben existir, como minimo:

- comandos o wizard de stack local
- generacion de `/opt/stacks/<owner>/<repo>/docker-compose.yml`
- generacion y mantenimiento de `/opt/stacks/<owner>/<repo>/.env`
- creacion de `/opt/stacks/<owner>/<repo>/.deploy.env`
- un catalogo inicial de servicios soportados
- validacion de compatibilidad con el motor de despliegue
- documentacion del modelo de stack generado

---

## Contratos del stack

### Root del stack

Cada repo gestionado debe vivir bajo:

```text
/opt/stacks/<owner>/<repo>/
```

Ejemplo:

```text
/opt/stacks/acme/payments-api/
```

### Archivos minimos

```text
/opt/stacks/<owner>/<repo>/
├── docker-compose.yml
├── .env
└── .deploy.env
```

Contratos:

- `docker-compose.yml`: define servicios, redes, volumenes y metadata del stack
- `.env`: configuracion y secretos propios del stack
- `.deploy.env`: contiene solo `IMAGE_NAME` e `IMAGE_TAG`

Importante:

- el wizard gestiona `.env`
- el motor de despliegue gestiona `.deploy.env`
- nunca deben mezclarse secretos del stack con el archivo runtime del motor

---

## Decision clave de disenio

### Stacks gestionados por la herramienta

Para poder editar incrementalmente un stack sin corromperlo, la herramienta necesita saber si un compose esta "gestionado" por ella.

Recomendacion: usar una extension `x-*` dentro del propio compose.

Ejemplo:

```yaml
x-deploy-webhook:
  managed: true
  version: 1
  repository: acme/payments-api
  deployable_services:
    - app
    - worker
  catalog:
    app:
      kind: app
      service_name: app
    postgres:
      kind: postgres
      service_name: postgres
```

Docker Compose ignora claves `x-*`, asi que esta metadata es segura y util para CLI/TUI.

Regla recomendada:

- si el compose tiene `x-deploy-webhook.managed: true`, el wizard puede editarlo
- si no lo tiene, la herramienta debe tratarlo como no gestionado y negarse a reescribirlo salvo que exista una operacion de importacion explicita en el futuro

Esto protege al operador de perder personalizaciones manuales en archivos ajenos al sistema.

---

## Quehaceres

### 11.1 Fijar el layout de stack gestionado

Cuando el operador cree un stack nuevo, la herramienta debe:

1. crear el directorio `/opt/stacks/<owner>/<repo>` si no existe
2. crear `docker-compose.yml`
3. crear `.env`
4. crear `.deploy.env`

La CLI debe imprimir claramente las rutas finales creadas.

### 11.2 Diferenciar servicios desplegables de auxiliares

No todos los servicios del compose son servicios que el motor debe actualizar por tag.

**Servicios desplegables**

Son los que usan:

```text
${IMAGE_NAME}:${IMAGE_TAG}
```

Ejemplos tipicos:

- `app`
- `worker`

Estos servicios SI deben reflejarse en `config/repos/*.yml -> environments.<env>.services`.

**Servicios auxiliares**

Son servicios locales del stack que no cambian por cada deploy de la app.

Ejemplos tipicos:

- `postgres`
- `redis`
- `nginx`

Estos servicios NO deben aparecer en `environments.<env>.services`, porque no forman parte del pull/up del artefacto versionado del repo.

Esta distincion es obligatoria para que el creator no rompa el modelo de despliegue actual.

### 11.3 Implementar el wizard de stack

El wizard debe permitir crear un stack funcional sin editar Compose manualmente.

Debe preguntar y/o inferir con defaults razonables:

- repositorio `owner/repo`
- entorno principal inicial
- servicios desplegables (`app`, `worker`)
- servicios auxiliares (`postgres`, `redis`, `nginx`)
- puertos comunes
- healthchecks cuando proceda
- valores minimos para `.env`

La experiencia recomendada es:

1. el operador elige repo
2. el wizard propone el directorio del stack
3. el wizard pregunta que servicios componen el stack
4. el wizard genera `docker-compose.yml`, `.env` y `.deploy.env`
5. el wizard actualiza tambien la config del repo para apuntar al stack generado

### 11.4 Definir el catalogo inicial de servicios soportados

Catalogo inicial recomendado:

- `app`
- `worker`
- `postgres`
- `redis`
- `nginx`

Cada servicio del catalogo debe definir:

- `kind`
- nombre por defecto del servicio
- imagen por defecto si aplica
- puertos por defecto si aplica
- variables de entorno requeridas
- volumenes por defecto si aplica
- healthcheck base si aplica
- si es `deployable` o `auxiliary`

Ejemplo conceptual:

```typescript
interface CatalogServiceDefinition {
  kind: 'app' | 'worker' | 'postgres' | 'redis' | 'nginx';
  deployable: boolean;
  defaultServiceName: string;
  buildComposeService(input: CatalogInput): ComposeService;
  buildEnvEntries(input: CatalogInput): Record<string, string>;
}
```

### 11.5 Plantilla del servicio `app`

`app` es el servicio principal desplegable por defecto.

Contrato recomendado:

- `image: ${IMAGE_NAME}:${IMAGE_TAG}`
- `restart: unless-stopped`
- `env_file:` incluye `.env` y `.deploy.env`
- puertos opcionales si el operador los define
- healthcheck opcional si el operador lo habilita

Ejemplo base:

```yaml
app:
  image: ${IMAGE_NAME}:${IMAGE_TAG}
  restart: unless-stopped
  env_file:
    - .env
    - .deploy.env
```

### 11.6 Plantilla del servicio `worker`

`worker` es otro servicio desplegable del mismo artefacto.

Contrato recomendado:

- `image: ${IMAGE_NAME}:${IMAGE_TAG}`
- `restart: unless-stopped`
- `env_file:` incluye `.env` y `.deploy.env`
- `command` configurable por el operador

No debe publicar puertos por defecto.

### 11.7 Plantilla del servicio `postgres`

`postgres` es un servicio auxiliar tipico.

Defaults recomendados:

- imagen: `postgres:16-alpine`
- volumen persistente para datos
- variables en `.env`:
  - `POSTGRES_DB`
  - `POSTGRES_USER`
  - `POSTGRES_PASSWORD`
- healthcheck con `pg_isready`

Ejemplo orientativo:

```yaml
postgres:
  image: postgres:16-alpine
  restart: unless-stopped
  env_file:
    - .env
  volumes:
    - postgres_data:/var/lib/postgresql/data
  healthcheck:
    test: ['CMD-SHELL', 'pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}']
```

### 11.8 Plantilla del servicio `redis`

`redis` es un servicio auxiliar tipico.

Defaults recomendados:

- imagen: `redis:7-alpine`
- volumen para persistencia si el operador quiere appendonly
- healthcheck basico con `redis-cli ping`
- password opcional, no obligatoria en la primera version si complica demasiado el template

Si se soporta password, debe ir a `.env` y reflejarse en el comando del servicio generado.

### 11.9 Plantilla del servicio `nginx`

`nginx` debe entrar solo como servicio soportado basico, no como sistema completo de reverse proxy avanzado.

Scope recomendado para la primera version:

- imagen por defecto estable
- puertos de entrada configurables
- dependencia hacia `app` si procede
- configuracion minima o placeholder claro

Fuera de scope en esta task:

- configuraciones avanzadas TLS
- cientos de directivas personalizadas
- gestion completa de certificados

### 11.10 Mantener `.env` del stack de forma incremental

Igual que en el `.env` del servicio principal, la herramienta debe poder actualizar solo lo que le pertenece dentro del `.env` del stack.

Recomendacion: bloques por servicio gestionado.

Ejemplo:

```env
# BEGIN docker-deploy-webhook service:postgres
POSTGRES_DB=app
POSTGRES_USER=app
POSTGRES_PASSWORD=...
# END docker-deploy-webhook service:postgres
```

Esto permite:

- anadir servicios nuevos sin reescribir todo el archivo
- editar un servicio ya existente
- no romper variables manuales del operador fuera de los bloques gestionados

### 11.11 Crear `.deploy.env` inicial

Aunque el motor lo sobreescriba antes de cada despliegue, la herramienta debe dejar creado el archivo para que el stack sea autoconsistente.

Recomendacion de contenido inicial:

```env
IMAGE_NAME=ghcr.io/<owner>/<repo>
IMAGE_TAG=bootstrap
```

Esto ayuda a:

- validar el compose localmente
- ejecutar `docker compose config`
- tener un estado inicial legible

### 11.12 Validar el compose generado

Despues de generar o editar el stack, la herramienta debe validar que el resultado es usable.

Comprobaciones minimas:

- existe `docker-compose.yml`
- las rutas internas son correctas
- los servicios declarados son coherentes
- los servicios desplegables usan `${IMAGE_NAME}:${IMAGE_TAG}`
- `env_file` incluye `.env` y `.deploy.env` cuando toca

Validacion recomendada adicional:

```bash
docker compose -f /opt/stacks/<owner>/<repo>/docker-compose.yml --env-file /opt/stacks/<owner>/<repo>/.deploy.env config
```

Si esta validacion falla, la CLI debe mostrar un error claro y no dejar la operacion como completada en silencio.

### 11.13 Sincronizar el stack generado con la config del repo

El creator de stack no debe vivir aislado. Debe actualizar tambien la config del repo cuando corresponda.

Debe asegurarse de que:

- `compose_file` apunta al compose generado
- `runtime_env_file` apunta a `.deploy.env`
- `services` contiene solo los servicios desplegables elegidos
- `image_name` coincide con el artefacto esperado del repo

Esto evita que el operador genere un stack y luego tenga que rehacer manualmente el YAML del repo.

### 11.14 Soportar edicion incremental de stacks gestionados

No limitarse al alta inicial. La herramienta debe permitir:

- anadir un servicio nuevo
- editar un servicio soportado
- volver a generar el compose desde la metadata gestionada
- actualizar los bloques correspondientes en `.env`

Regla importante:

- si el compose no esta marcado como gestionado, la herramienta no debe reescribirlo por defecto

### 11.15 Tests recomendados

Cobertura minima sugerida:

1. creacion del directorio `/opt/stacks/<owner>/<repo>`
2. generacion de `docker-compose.yml`, `.env` y `.deploy.env`
3. metadata `x-deploy-webhook.managed: true` presente
4. `app` usa `${IMAGE_NAME}:${IMAGE_TAG}`
5. `worker` usa `${IMAGE_NAME}:${IMAGE_TAG}`
6. `postgres` escribe sus vars en `.env`
7. `redis` aparece como servicio auxiliar y no como servicio desplegable
8. la config del repo se sincroniza con los servicios desplegables correctos
9. el wizard rechaza reescribir un compose no gestionado
10. `docker compose config` o validacion equivalente pasa para un stack generado valido

---

## Riesgos a controlar

- Mezclar servicios auxiliares con servicios desplegables en `services` del repo.
- Sobreescribir `.env` completo del stack y borrar personalizaciones legitimas.
- Intentar editar composiciones arbitrarias no gestionadas por la herramienta.
- Generar un compose bonito pero incompatible con el motor real de despliegue.

---

## Criterios de aceptacion

- [ ] El wizard puede generar un stack funcional bajo `/opt/stacks/<owner>/<repo>`.
- [ ] El stack generado mantiene la separacion entre `.env` y `.deploy.env`.
- [ ] Existe una metadata clara para identificar stacks gestionados por la herramienta.
- [ ] Existe un catalogo inicial de servicios soportados con defaults utiles.
- [ ] Servicios auxiliares como `postgres` o `redis` pueden configurarse desde la herramienta.
- [ ] Solo los servicios desplegables acaban en `environments.<env>.services`.
- [ ] El `docker-compose.yml` generado es compatible con el motor de despliegue actual.
- [ ] La herramienta puede editar incrementalmente stacks que ella misma genero sin destruir configuracion no relacionada.
