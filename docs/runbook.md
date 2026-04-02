# Runbook Operativo v2

## Arranque Del Servicio

```bash
docker compose up -d webhook redis
```

## Logs Del Webhook

```bash
docker compose logs -f webhook
```

## Ejecutar El Canal Admin Local

Mostrar ayuda:

```bash
docker compose --profile admin run --rm admin help
```

Abrir TUI:

```bash
docker compose --profile admin run --rm admin tui
```

## Estado Remoto Del Servicio

```bash
curl https://deploy.mi-dominio.com/health
```

## Ver Despliegues Recientes

```bash
curl https://deploy.mi-dominio.com/deployments/recent \
  -H "Authorization: Bearer <admin_read_token>"
```

## Ver Un Job Concreto

```bash
curl https://deploy.mi-dominio.com/jobs/<job_id> \
  -H "Authorization: Bearer <admin_read_token>"
```

## Alta De Repo Nueva

```bash
docker compose --profile admin run --rm admin repo add --repository acme/payments-api
docker compose --profile admin run --rm admin repo secrets generate --repository acme/payments-api
docker compose --profile admin run --rm admin stack init --repository acme/payments-api --environment production --services app,postgres
docker compose --profile admin run --rm admin validate
docker compose restart webhook
```

## Mostrar Secrets Del Repo

```bash
docker compose --profile admin run --rm admin repo secrets show --repository acme/payments-api
```

## Validar Configuracion Antes De Reiniciar

```bash
docker compose --profile admin run --rm admin validate
```

## Deploy Manual Local

```bash
docker compose --profile admin run --rm admin deploy manual \
  --repository acme/payments-api \
  --environment production \
  --tag sha-abc1234
```

## Redeploy Del Ultimo Exitoso

```bash
docker compose --profile admin run --rm admin deploy redeploy-last-successful \
  --repository acme/payments-api \
  --environment production
```

## Retry De Job Fallido

```bash
docker compose --profile admin run --rm admin deploy retry --job-id <job_id>
```

## Listar Repos Configurados

```bash
docker compose --profile admin run --rm admin repo list
```

## Ver Config De Un Repo

```bash
docker compose --profile admin run --rm admin repo show --repository acme/payments-api
```

## Editar Un Entorno

Ejemplo cambiando servicios desplegables:

```bash
docker compose --profile admin run --rm admin env edit \
  --repository acme/payments-api \
  --environment production \
  --services app,worker
```

## Anadir Servicio Al Stack Gestionado

```bash
docker compose --profile admin run --rm admin stack service add \
  --repository acme/payments-api \
  --environment production \
  --kind postgres \
  --service-name postgres
```

## Ver Metadata Del Stack

```bash
docker compose --profile admin run --rm admin stack show --repository acme/payments-api
```

## Migracion Desde v1

```bash
docker compose --profile admin run --rm admin migrate scan
docker compose --profile admin run --rm admin migrate plan
docker compose --profile admin run --rm admin migrate apply
```

## Rotacion De Secrets

```bash
docker compose --profile admin run --rm admin repo secrets generate --repository acme/payments-api
docker compose --profile admin run --rm admin repo secrets show --repository acme/payments-api
docker compose restart webhook
```

Despues actualiza tambien los GitHub Secrets del repositorio.

## Diagnostico Rapido

Fallos comunes:

- falta una env var obligatoria en el `.env` del servicio
- `compose_file` no existe
- `runtime_env_file` apunta a un directorio inexistente
- el servicio declarado en config no existe en el compose
- el host no puede hacer `pull` desde `GHCR`
- Redis no esta disponible

## Reinicio Tras Cambios De Configuracion

El sistema sigue siendo `reload by restart`.

Flujo correcto:

```bash
docker compose --profile admin run --rm admin validate
docker compose restart webhook
```
