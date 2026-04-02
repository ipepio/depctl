# Migracion De v1 A v2

## Que Cambia

La v2 introduce estos cambios operativos principales:

- desaparecen los endpoints HTTP de escritura admin
- aparece un contenedor `admin` puntual con `CLI/TUI`
- los stacks gestionados se normalizan bajo `/opt/stacks/<owner>/<repo>`
- el alta de repos deja de hacerse editando YAML a mano

## Comandos De Ayuda

```bash
docker compose --profile admin run --rm admin migrate scan
docker compose --profile admin run --rm admin migrate plan
docker compose --profile admin run --rm admin migrate apply
```

## `migrate scan`

Detecta hallazgos como:

- ficheros de repo con nombre no canonico
- stacks fuera del root esperado
- nombres de env vars no canonicos
- secrets faltantes en el `.env` del servicio
- compose sin metadata de stack gestionado

## `migrate plan`

Genera una lista de acciones sugeridas y clasifica cuales son:

- seguras de automatizar
- manuales

## `migrate apply`

Hoy es conservador.

Automatiza solo acciones seguras, principalmente:

- renombrar ficheros de repo a su nombre canonico si no hay conflicto
- canonicalizar nombres de env vars de secrets del repo cuando los valores actuales existen y pueden copiarse con seguridad

Antes de reescribir o renombrar crea backups `*.bak`.

## Pasos Recomendados De Migracion

1. Ejecutar `migrate scan`.
2. Revisar `migrate plan`.
3. Aplicar lo seguro con `migrate apply`.
4. Migrar manualmente stacks fuera de `/opt/stacks/<owner>/<repo>`.
5. Regenerar o ajustar secrets si los nombres no son canonicos.
6. Rehacer runbooks internos para sustituir cURLs admin por comandos `deployctl`.
7. Ejecutar `validate`.
8. Reiniciar `webhook`.

## Notas Importantes

- Un stack sin metadata `x-deploy-webhook` no se considera gestionado por la herramienta.
- La v2 no reescribe automaticamente composiciones manuales no gestionadas.
- Si un stack antiguo sigue fuera del root canonico, puede seguir funcionando mientras la config apunte bien, pero aparecera en migracion como pendiente de normalizar.
