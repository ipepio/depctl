# Como Dar De Alta Un Repositorio Nuevo

Esta es la guia operativa recomendada en la v2.

Todo el alta se hace desde el contenedor `admin`, no editando YAML a mano y no usando endpoints HTTP de escritura.

## 1. Levantar La Base Del Servicio

```bash
docker compose up -d webhook redis
```

## 2. Crear La Config Basica Del Repo

```bash
docker compose --profile admin run --rm admin repo add --repository acme/payments-api
```

Que hace:

- crea `config/repos/acme--payments-api.yml`
- propone defaults funcionales para `production`
- genera paths canonicos bajo `/opt/stacks/acme/payments-api`

## 3. Generar Los Secrets Del Repo

```bash
docker compose --profile admin run --rm admin repo secrets generate --repository acme/payments-api
```

Que hace:

- genera `Bearer` y `HMAC`
- los guarda en el `.env` del servicio
- no los imprime por defecto

## 4. Crear El Stack Local

Ejemplo minimo con `app` y `postgres`:

```bash
docker compose --profile admin run --rm admin stack init \
  --repository acme/payments-api \
  --environment production \
  --services app,postgres
```

Que hace:

- crea `/opt/stacks/acme/payments-api/`
- genera `docker-compose.yml`
- genera `.env`
- crea `.deploy.env` inicial
- sincroniza `compose_file`, `runtime_env_file` y `services` en la config del repo

## 5. Validar Antes Del Restart

```bash
docker compose --profile admin run --rm admin validate
```

Si esto falla, corrige primero los problemas.

## 6. Reiniciar El Webhook

```bash
docker compose restart webhook
```

## 7. Mostrar Los Secrets Para GitHub

```bash
docker compose --profile admin run --rm admin repo secrets show --repository acme/payments-api
```

Usa esos valores para poblar en GitHub:

- `DEPLOY_BEARER_TOKEN`
- `DEPLOY_HMAC_SECRET`
- `DEPLOY_WEBHOOK_URL`

## 8. Configurar GitHub Actions

El workflow del repo debe enviar el webhook con:

- `Authorization: Bearer <DEPLOY_BEARER_TOKEN>`
- `X-Deploy-Timestamp`
- `X-Deploy-Signature`
- body con `repository`, `environment`, `tag`, `sha`, `workflow`, `ref_name`, `run_id`

## 9. Verificar

Puedes verificar por lectura remota:

```bash
curl https://deploy.mi-dominio.com/health
curl https://deploy.mi-dominio.com/deployments/recent \
  -H "Authorization: Bearer <admin_read_token>"
```

O lanzar una prueba local de deploy manual:

```bash
docker compose --profile admin run --rm admin deploy manual \
  --repository acme/payments-api \
  --environment production \
  --tag sha-abc1234
```
