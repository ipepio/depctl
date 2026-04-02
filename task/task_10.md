# Task 10 - CLI local y gestion de configuracion

## Objetivo

Implementar una `CLI` local para administrar repositorios, entornos, secrets del repo y operaciones admin de despliegue sin exponer escritura por HTTP remoto.

Esta task convierte la administracion del servidor en una experiencia operativa real: deja de ser "editar YAML a mano" y pasa a ser "usar comandos locales con validacion, defaults y salida clara".

---

## Para que existe

La configuracion actual del sistema requiere demasiados pasos manuales:

- crear ficheros YAML a mano
- inventar nombres de variables de entorno
- generar y guardar secretos manualmente
- comprobar manualmente rutas y servicios
- usar endpoints HTTP admin para deploy manual y retry

La v2 quiere que el operador pueda hacer todo eso localmente, con una herramienta que:

- guie el alta de repos y entornos
- genere defaults correctos
- persista secrets de forma local
- valide antes del restart
- reemplace las operaciones admin remotas por comandos locales

---

## Alcance

Esta task SI incluye:

- crear la base de la `CLI`
- definir comandos de repositorio, entorno, validacion y secrets
- separar validacion estructural de validacion runtime
- editar `config/repos/*.yml` sin tener que escribir YAML a mano
- editar el `.env` del servicio para secrets del repo
- mover deploy manual, redeploy y retry al canal local
- documentar el uso operativo de la CLI

Esta task NO incluye:

- la TUI completa
- el wizard de stacks Docker Compose con catalogo de servicios
- hot reload
- reinicio automatico del servicio tras cambiar config
- integracion con GitHub API o escritura automatica en GitHub Secrets

---

## Dependencias previas

- Task 9 completada: frontera API v2 y modo admin definidos.

---

## Entregables

Al cerrar esta task deben existir, como minimo:

- una CLI ejecutable desde el modo `admin`
- comandos para crear/editar/listar repos y entornos
- comandos para generar, persistir y mostrar secrets del repo
- una validacion local previa al restart
- comandos locales para deploy manual, redeploy y retry
- documentacion de uso con ejemplos reales

---

## Contrato operativo de la CLI

### Nombre recomendado

Se recomienda exponer la CLI con un nombre estable, por ejemplo:

```bash
deployctl
```

Invocacion esperada dentro del contenedor admin:

```bash
node dist/index.js admin <comando>
```

Opcionalmente, se puede anadir un alias o script para que el operador vea algo como:

```bash
docker compose run --rm admin deployctl repo add --repository acme/api
```

### Salida y codigos de retorno

La CLI debe ser apta para uso humano y para scripting.

Recomendacion:

- `exit 0`: exito
- `exit 1`: error operativo o de validacion
- `exit 2`: error de uso del comando

Ademas, los comandos de consulta y validacion deberian soportar `--json` cuando tenga sentido.

---

## Quehaceres

### 10.1 Crear la base de la CLI

Crear una entrada dedicada, por ejemplo:

```text
src/
├── cli/
│   ├── index.ts
│   ├── bootstrap.ts
│   ├── commands/
│   ├── io/
│   └── use-cases/
```

Responsabilidades recomendadas:

- `index.ts`: punto de entrada
- `bootstrap.ts`: parseo global, dispatch y manejo de errores
- `commands/`: traduccion de `argv` a acciones concretas
- `io/`: prompts, confirmaciones, salida tabular o JSON
- `use-cases/`: logica de negocio local reutilizable por CLI y TUI

La recomendacion es evitar un framework CLI grande si no hace falta. En Node 20 se puede empezar con:

- `node:util` (`parseArgs`)
- `readline/promises`

Si la complejidad lo justifica, se puede introducir una dependencia ligera, pero no deberia ser el punto de partida por defecto.

### 10.2 Definir la superficie inicial de comandos

Comandos minimos a cubrir en esta task:

```text
deployctl repo add
deployctl repo edit
deployctl repo list
deployctl repo show
deployctl env add
deployctl env edit
deployctl repo secrets generate
deployctl repo secrets show
deployctl validate
deployctl deploy manual
deployctl deploy redeploy-last-successful
deployctl deploy retry
```

Ejemplos esperados:

```bash
deployctl repo add --repository acme/payments-api
deployctl env add --repository acme/payments-api --environment production
deployctl repo secrets generate --repository acme/payments-api
deployctl repo secrets show --repository acme/payments-api
deployctl validate
deployctl deploy manual --repository acme/payments-api --environment production --tag sha-abc1234
deployctl deploy redeploy-last-successful --repository acme/payments-api --environment production
deployctl deploy retry --job-id 8f6d6b90-...
```

### 10.3 Estandarizar el nombre de archivo del repo

La CLI debe dejar de depender de nombres arbitrarios para `config/repos/*.yml`.

Recomendacion de mapping:

```text
owner/repo -> config/repos/owner--repo.yml
```

Ejemplos:

- `acme/api` -> `config/repos/acme--api.yml`
- `ipepio/docker-deploy-webhook` -> `config/repos/ipepio--docker-deploy-webhook.yml`

Reglas:

- el contenido del YAML sigue usando `repository: owner/repo`
- el nombre de archivo es una proyeccion estable del identificador
- la CLI debe usar siempre el mismo algoritmo para localizar o crear el archivo

### 10.4 Definir los defaults de scaffolding para un repo nuevo

Cuando el operador cree un repo nuevo, la CLI debe proponer o inferir valores por defecto seguros y funcionales.

Defaults recomendados:

- `image_name`: `ghcr.io/<owner>/<repo>`
- `compose_file`: `/opt/stacks/<owner>/<repo>/docker-compose.yml`
- `runtime_env_file`: `/opt/stacks/<owner>/<repo>/.deploy.env`
- `services`: `['app']`
- `allowed_workflows`: `['deploy-production']` para `production`
- `allowed_branches`: `['main']`
- `allowed_tag_pattern`: `^sha-[a-f0-9]{7,40}$`

La CLI debe permitir override por flags o prompts, pero los defaults deben servir como punto de partida realista.

### 10.5 Separar validacion estructural de validacion runtime

Hoy `loadConfig()` mezcla demasiadas cosas para el caso de uso de una CLI:

- parseo YAML
- validacion de schema
- resolucion de secretos reales
- comprobacion de ficheros del host

La v2 necesita dos capas claramente separadas.

**A. Validacion estructural o de borrador**

Sirve para crear y editar configuracion sin requerir aun que el sistema este listo para arrancar.

Debe validar:

- schema del YAML
- naming del repo
- naming del entorno
- paths esperados
- shape de arrays y strings
- coherencia basica de los datos

**B. Validacion runtime o pre-arranque**

Sirve para responder a la pregunta: "si reinicio ahora, arrancara?"

Debe validar:

- que el YAML es correcto
- que los secrets existen y no estan vacios
- que el `compose_file` existe
- que el directorio de `runtime_env_file` existe
- que el patron de tag es regex valida
- que los servicios declarados existen realmente en el compose

Recomendacion de modulos:

```text
src/config/
├── loader.ts                 # runtime final para arranque del servicio
├── draft-validator.ts        # validacion estructural para CLI
├── runtime-validator.ts      # validacion completa pre-restart
├── repo-files.ts             # leer/escribir YAML por repo
└── service-env.ts            # leer/escribir .env del servicio
```

### 10.6 Implementar la persistencia del `.env` del servicio

La CLI necesita escribir secrets del repo en el `.env` del servicio sin romper ni borrar entradas ajenas.

No basta con sobreescribir el archivo completo. Debe haber una estrategia segura de actualizacion incremental.

Recomendacion: bloques gestionados por repo.

Ejemplo:

```env
# BEGIN docker-deploy-webhook acme/payments-api
ACME_PAYMENTS_API_WEBHOOK_BEARER=...
ACME_PAYMENTS_API_WEBHOOK_HMAC=...
# END docker-deploy-webhook acme/payments-api
```

Ventajas:

- la CLI puede actualizar solo su bloque
- no destruye comentarios o valores no relacionados
- permite re-generar o rotar secrets de un repo de forma idempotente

La CLI debe:

1. localizar el bloque del repo si existe
2. actualizarlo si existe
3. anadirlo al final si no existe
4. no tocar bloques de otros repos ni configuracion manual del operador

### 10.7 Definir la convención de nombres de env vars del repo

La herramienta debe derivar nombres de variables de entorno de forma estable y predecible.

Regla recomendada:

```text
owner/repo -> OWNER_REPO
OWNER_REPO_WEBHOOK_BEARER
OWNER_REPO_WEBHOOK_HMAC
```

Ejemplo:

```text
acme/payments-api -> ACME_PAYMENTS_API
ACME_PAYMENTS_API_WEBHOOK_BEARER
ACME_PAYMENTS_API_WEBHOOK_HMAC
```

La CLI debe generar estos nombres por defecto y escribirlos en el YAML del repo como:

```yaml
webhook:
  bearer_token_env: ACME_PAYMENTS_API_WEBHOOK_BEARER
  hmac_secret_env: ACME_PAYMENTS_API_WEBHOOK_HMAC
```

### 10.8 Gestionar secrets del repo

Comandos minimos:

- `repo secrets generate`
- `repo secrets show`

`generate` debe:

1. generar un `Bearer` seguro
2. generar un `HMAC` seguro
3. persistir ambos en el `.env` del servicio
4. actualizar el YAML del repo si hiciera falta
5. mostrar al operador un resumen claro

`show` debe:

1. localizar las env vars del repo
2. leer sus valores actuales
3. mostrarlos solo bajo demanda explicita
4. imprimir una salida apta para copiar a GitHub Secrets

Ejemplo de salida:

```text
DEPLOY_BEARER_TOKEN=<valor>
DEPLOY_HMAC_SECRET=<valor>
```

Importante:

- la CLI no debe escribir automaticamente en GitHub Secrets
- la CLI no debe guardar los valores en el YAML
- la CLI no debe ocultar al operador donde quedaron persistidos localmente

### 10.9 Implementar los casos de uso locales de despliegue

La CLI debe cubrir las operaciones que en v1 viven en HTTP admin:

- deploy manual
- redeploy del ultimo exitoso
- retry de jobs fallidos

La implementacion recomendada es llamar directamente a la capa de negocio local, no hacer peticiones HTTP a `localhost`.

Flujo recomendado del modo admin para estas operaciones:

1. cargar config via `initConfig()`
2. conectar con Redis
3. ejecutar el caso de uso local correspondiente
4. imprimir el `job_id` devuelto
5. cerrar Redis y salir

Esto hace que el contenedor admin sea un cliente nativo del sistema, no un wrapper de curl.

### 10.10 Implementar `validate`

`deployctl validate` debe convertirse en el chequeo operativo previo al restart.

Debe comprobar como minimo:

- `server.yml` con schema valido
- todos los `repos/*.yml` con schema valido
- repos duplicados
- repository IDs bien formados
- entornos existentes y no vacios
- rutas absolutas esperadas
- existencia de `compose_file`
- existencia del directorio de `runtime_env_file`
- presencia de todos los secrets requeridos
- regex de tag validas
- servicios declarados en config presentes realmente en el compose

Recomendacion adicional: soportar dos modos.

```bash
deployctl validate
deployctl validate --repository acme/payments-api
```

Salida recomendada por defecto:

```text
[OK] server.yml
[OK] config/repos/acme--payments-api.yml
[OK] compose file exists: /opt/stacks/acme/payments-api/docker-compose.yml
[OK] service found in compose: app
[OK] secret present: ACME_PAYMENTS_API_WEBHOOK_BEARER
[OK] secret present: ACME_PAYMENTS_API_WEBHOOK_HMAC
```

En caso de error, debe devolver una lista clara y accionable.

### 10.11 Leer servicios reales desde `docker-compose.yml`

La validacion runtime no debe limitarse a comprobar que el archivo existe. Debe verificar que los servicios configurados en YAML existen realmente en el compose.

Opciones validas:

- parsear el YAML y leer `services.*`
- o usar `docker compose config --services` si el entorno esta disponible

La recomendacion es:

1. parseo YAML para chequeo rapido y local
2. opcion adicional de validacion fuerte con `docker compose config` en tasks posteriores

### 10.12 Documentar ejemplos de uso

Actualizar documentacion con flujos completos como:

- alta de repo
- alta de entorno
- generacion de secrets
- consulta de secrets
- validacion previa al restart
- deploy manual desde CLI

El objetivo es que el operador pueda ejecutar la mayoria de la v2 sin leer el codigo fuente.

### 10.13 Tests recomendados

Crear cobertura para:

1. conversion `owner/repo -> config/repos/owner--repo.yml`
2. conversion `owner/repo -> OWNER_REPO_WEBHOOK_BEARER/HMAC`
3. creacion de YAML con defaults correctos
4. actualizacion idempotente del bloque del repo en `.env`
5. `repo secrets generate` crea y persiste valores
6. `repo secrets show` imprime valores ya guardados
7. `validate` detecta compose inexistente
8. `validate` detecta servicio inexistente en compose
9. `deploy manual` encola un job valido
10. `retry` falla si el job no es retryable

---

## Riesgos a controlar

- No romper la semantica actual de `loadConfig()` usada por el servicio real.
- No sobreescribir el `.env` del servicio completo por error.
- No generar nombres de env vars inconsistentes entre ejecuciones.
- No permitir crear YAMLs estructuralmente validos pero operativamente imposibles sin dejarlo claro al usuario.

---

## Criterios de aceptacion

- [ ] Existe una `CLI` local ejecutable desde el modo admin.
- [ ] La CLI puede crear y editar repos y entornos sin editar YAML a mano.
- [ ] Los nombres de archivo de repo y de env vars siguen una convencion estable y documentada.
- [ ] Los secrets `Bearer` y `HMAC` se generan, persisten localmente y pueden mostrarse bajo demanda.
- [ ] El `.env` del servicio se actualiza de forma incremental sin destruir configuracion ajena.
- [ ] El deploy manual, redeploy y retry funcionan desde la CLI usando la logica existente del sistema.
- [ ] Existe una validacion local previa al restart con errores claros para el operador.
- [ ] La documentacion operativa ya incluye ejemplos reales de uso de la CLI.
