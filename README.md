# docker-deploy-webhook

Servicio de despliegue automatizado por servidor para stacks Docker Compose locales.

Recibe webhooks de GitHub Actions, valida la peticion y despliega una nueva imagen sobre stacks definidos localmente. La administracion sensible ya no se hace por HTTP remoto: vive en una interfaz local `CLI/TUI` ejecutada desde un contenedor admin puntual.

## Que Hace Ahora

- expone `POST /deploy` para despliegues automaticos
- expone endpoints remotos de lectura para health e historial de jobs
- valida `Bearer + HMAC + anti-replay`
- encola despliegues en Redis con un unico worker por servidor
- ejecuta `docker compose pull` y `docker compose up -d`
- mantiene rollback limitado con `successful_tag` y `previous_tag`
- ofrece una `CLI` local para:
  - crear repos y entornos
  - generar y mostrar secrets del repo
  - validar configuracion antes del restart
  - lanzar deploy manual, redeploy y retry
  - crear y editar stacks locales gestionados
  - ejecutar una `TUI` local
  - escanear y planificar migracion desde la v1

## Modelo v2

La v2 separa dos canales:

- **remoto**: webhook y lectura
- **local**: administracion por `CLI/TUI`

La misma imagen soporta dos modos:

- `webhook`: servicio HTTP expuesto
- `admin`: contenedor puntual sin puertos para operaciones locales

## API Remota

Estos son los endpoints remotos actuales:

| Metodo | Ruta                  | Auth          | Descripcion                |
| ------ | --------------------- | ------------- | -------------------------- |
| `POST` | `/deploy`             | Bearer + HMAC | Webhook automatico         |
| `GET`  | `/health`             | Ninguna       | Estado basico del servicio |
| `GET`  | `/jobs/:id`           | Admin read    | Estado de un job           |
| `GET`  | `/deployments/recent` | Admin read    | Historial reciente         |

Las antiguas rutas de escritura admin por HTTP ya no se exponen.

## Admin Local

El canal admin local se ejecuta con:

```bash
docker compose --profile admin run --rm admin help
```

Comandos disponibles hoy:

```text
deployctl repo add
deployctl repo edit
deployctl repo list
deployctl repo show
deployctl repo secrets generate
deployctl repo secrets show
deployctl env add
deployctl env edit
deployctl validate
deployctl deploy manual
deployctl deploy redeploy-last-successful
deployctl deploy retry
deployctl stack init
deployctl stack show
deployctl stack service add
deployctl stack service edit
deployctl migrate scan
deployctl migrate plan
deployctl migrate apply
deployctl tui
```

## Layout Operativo

### Config del servicio

- `config/server.yml`
- `config/repos/*.yml`
- `.env`

### Stacks gestionados

Por defecto viven bajo:

```text
/opt/stacks/<owner>/<repo>/
```

En desarrollo o test se puede sobreescribir con `STACKS_ROOT`. En produccion el contrato esperado sigue siendo `/opt/stacks`.

Archivos por stack:

- `docker-compose.yml`
- `.env`
- `.deploy.env`

## Instalacion Rapida

1. Crear `.env` a partir de `.env.example`.
2. Copiar `config/server.example.yml` a `config/server.yml`.
3. Asegurar acceso de lectura a `GHCR` en el host.
4. Montar el root de stacks del host en `/opt/stacks`.
5. Levantar servicio y Redis:

```bash
docker compose up -d webhook redis
```

6. Crear un repo nuevo desde el canal admin local.

## Arranque

### Arrancar el modo `webhook`

```bash
docker compose up -d webhook redis
```

### Comprobar que ha arrancado

```bash
curl http://localhost:8080/health
```

### Abrir el canal admin local

```bash
docker compose --profile admin run --rm admin help
```

## Como Se Interactua

El sistema se usa por dos vias distintas.

### 1. Interaccion remota

Para automatizacion y observabilidad:

- GitHub Actions envia `POST /deploy`
- los operadores pueden consultar:
  - `GET /health`
  - `GET /jobs/:id`
  - `GET /deployments/recent`

### 2. Interaccion local

Para administracion del servidor:

```bash
docker compose --profile admin run --rm admin <comando>
```

Ejemplos habituales:

```bash
docker compose --profile admin run --rm admin repo list
docker compose --profile admin run --rm admin repo show --repository acme/payments-api
docker compose --profile admin run --rm admin deploy manual --repository acme/payments-api --environment production --tag sha-abc1234
docker compose --profile admin run --rm admin stack show --repository acme/payments-api
docker compose --profile admin run --rm admin tui
```

## Alta De Un Repo Nuevo

Flujo recomendado:

```bash
docker compose --profile admin run --rm admin repo add --repository acme/payments-api
docker compose --profile admin run --rm admin repo secrets generate --repository acme/payments-api
docker compose --profile admin run --rm admin stack init --repository acme/payments-api --environment production --services app,postgres
docker compose --profile admin run --rm admin validate
docker compose restart webhook
docker compose --profile admin run --rm admin repo secrets show --repository acme/payments-api
```

Despues de `repo secrets show`, copia los dos valores a GitHub Secrets como:

- `DEPLOY_BEARER_TOKEN`
- `DEPLOY_HMAC_SECRET`

La URL del webhook se publica como:

- `DEPLOY_WEBHOOK_URL`

## TUI

Tambien existe una interfaz local guiada:

```bash
docker compose --profile admin run --rm admin tui
```

Es local al servidor, no expone puertos y reutiliza la misma logica de negocio que la CLI.

## Validacion Y Apply

Los cambios de configuracion siguen aplicandose tras reiniciar `webhook`.

Flujo recomendado antes de reiniciar:

```bash
docker compose --profile admin run --rm admin validate
docker compose restart webhook
```

## Documentacion

- `docs/arquitectura-v2.md`: arquitectura objetivo y contratos principales
- `docs/how-it-works-v2.md`: explicacion detallada de como funciona el sistema
- `docs/how-to-add-repo.md`: guia paso a paso para dar de alta un repo nuevo
- `docs/runbook.md`: operacion diaria de la v2
- `docs/migration-v1-to-v2.md`: migracion desde instalaciones v1

## Desarrollo

Build:

```bash
npm run build
```

Tests:

```bash
npm test
```

Modo webhook local:

```bash
npm start
```

Modo admin local:

```bash
npm run start:admin -- help
```
