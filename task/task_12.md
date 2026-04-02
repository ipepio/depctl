# Task 12 - TUI local, migracion y endurecimiento final de v2

## Objetivo

Completar la experiencia local de administracion con una `TUI`, cerrar la migracion operativa desde la v1 y endurecer la solucion final de la v2 para produccion.

Esta task es el cierre de producto de la v2: convierte la base tecnica creada en las tasks 9-11 en una experiencia operativa completa, segura y documentada.

---

## Para que existe

Despues de las tasks 9-11, el sistema ya deberia tener:

- frontera HTTP saneada
- contenedor admin puntual
- CLI local
- gestion de repos, entornos y secrets
- creator de stacks

Falta el ultimo salto:

- hacer la administracion local mas amigable para operadores
- cubrir la migracion desde instalaciones v1 existentes
- endurecer permisos, packaging y documentacion final

---

## Alcance

Esta task SI incluye:

- construir una TUI local sobre la misma capa de aplicacion que la CLI
- definir una estrategia de migracion desde la v1
- anadir comandos o flujos de migracion asistida
- endurecer permisos y packaging del modo `webhook` frente al modo `admin`
- cerrar tests y documentacion final de operacion

Esta task NO incluye:

- crear una interfaz web remota
- reintroducir escritura admin por HTTP
- convertir el sistema en multi-tenant o multi-servidor
- cubrir arbitrariamente cualquier stack no gestionado por la herramienta

---

## Dependencias previas

- Tasks 9-11 completadas: canal admin local, CLI y wizard de stack disponibles.

---

## Entregables

Al cerrar esta task deben existir, como minimo:

- una `TUI` local funcional
- una guia y herramientas de migracion desde la v1
- packaging endurecido para `webhook` y `admin`
- tests finales sobre CLI/TUI/migracion
- documentacion operativa final de la v2

---

## Principio de disenio clave

La TUI no debe introducir una segunda implementacion de la logica de negocio.

La capa correcta debe ser:

```text
casos de uso / servicios de aplicacion
        ^                 ^
        |                 |
      CLI               TUI
```

La TUI es otra interfaz de entrada, no otro backend.

---

## Quehaceres

### 12.1 Consolidar la capa de aplicacion compartida

Antes de construir la TUI, revisar que la logica creada para la CLI esta realmente desacoplada de `argv`, prints y prompts.

Deben existir casos de uso compartibles para:

- alta y edicion de repos
- alta y edicion de entornos
- generacion y consulta de secrets
- validacion
- deploy manual
- redeploy del ultimo exitoso
- retry de jobs fallidos
- stack init
- stack service add/edit

La TUI debe llamar a estos casos de uso directamente.

### 12.2 Definir la superficie de la TUI

La TUI debe cubrir al menos estos flujos:

- dashboard inicial
- listado de repos
- detalle de repo
- detalle de entornos
- gestion de secrets del repo
- validacion del sistema
- acciones de despliegue local
- creator y edicion de stacks gestionados

Pantallas o vistas recomendadas:

1. **Dashboard**
   - estado del servicio
   - ultimos jobs
   - accesos rapidos
2. **Repos**
   - listar repos
   - crear repo
   - editar repo
3. **Entornos**
   - listar entornos de un repo
   - crear entorno
   - editar entorno
4. **Secrets**
   - generar
   - mostrar bajo demanda
   - rotar
5. **Stacks**
   - crear stack
   - anadir servicio
   - editar servicio
6. **Deploys**
   - manual deploy
   - redeploy last successful
   - retry failed job
7. **Validation**
   - estado global
   - errores accionables

### 12.3 Mantener la TUI estrictamente local

La TUI se ejecuta solo en el contenedor admin puntual.

Reglas:

- sin puertos publicados
- sin servidor HTTP asociado
- sin sesiones remotas
- sin canal de escritura por red

La experiencia puede ser interactiva, pero siempre local al servidor.

### 12.4 Definir la estrategia de UX para datos sensibles

Los secretos no deben aparecer en pantalla sin accion explicita.

Comportamiento recomendado:

- por defecto los valores sensibles aparecen ocultos o resumidos
- revelar requiere una accion explicita del operador
- pantallas de confirmacion para rotaciones y acciones de deploy
- mensajes finales claros para copiar valores a GitHub Secrets

### 12.5 Cubrir la migracion desde la v1

La v2 cambia varias cosas importantes respecto a la v1:

- desaparecen endpoints admin de escritura remota
- aparece el contenedor admin puntual
- se estandariza `/opt/stacks/<owner>/<repo>`
- deja de ser necesario editar YAML a mano para altas nuevas

La migracion debe contemplar al menos estos escenarios:

1. repos ya configurados manualmente en `config/repos/*.yml`
2. stacks existentes fuera de `/opt/stacks/<owner>/<repo>`
3. secrets del repo ya presentes en `.env`
4. runbooks o automatismos internos que hoy llaman a endpoints admin remotos

### 12.6 Implementar herramientas de migracion asistida

Recomendacion de comandos:

```text
deployctl migrate scan
deployctl migrate plan
deployctl migrate apply
```

**`migrate scan`** debe detectar:

- repos configurados actualmente
- paths de stack no normalizados
- uso de endpoints admin antiguos en docs o scripts conocidos si aplica
- secrets faltantes o con nombres no estandarizados
- compose no gestionados por la herramienta

**`migrate plan`** debe generar un resumen de acciones necesarias, por ejemplo:

- mover stack a `/opt/stacks/acme/api`
- renombrar config de repo a `acme--api.yml`
- regenerar metadata de stack gestionado
- sustituir uso de `POST /admin/deploy` por `deployctl deploy manual`

**`migrate apply`** debe ser conservador:

- nunca destruir nada sin confirmacion explicita
- hacer backups cuando vaya a reescribir archivos
- dejar trazabilidad de que se ha cambiado

### 12.7 Definir politica sobre stacks existentes no gestionados

No todos los stacks existentes en v1 habran sido creados por la herramienta.

La estrategia recomendada es:

- detectar si un stack esta gestionado por metadata `x-deploy-webhook`
- si no lo esta, ofrecer migracion asistida o modo lectura
- no reescribir automaticamente composiciones no gestionadas

### 12.8 Endurecer el packaging Docker y Compose

Revisar el modelo final de despliegue para que el `webhook` quede mas cerrado que el `admin`.

Checklist minimo:

- `webhook` arranca por defecto
- `admin` no arranca por defecto
- `admin` no publica puertos
- `config` se monta en `ro` en `webhook`
- `config` se monta en `rw` solo en `admin`
- `/opt/stacks` esta disponible para ambos, con permisos acordes a la necesidad real
- `restart: unless-stopped` solo donde tenga sentido
- `admin` idealmente `restart: "no"`

Si se puede endurecer mas sin romper la operativa, valorar tambien:

- `read_only: true` para filesystem raiz del `webhook`
- `tmpfs` donde haga falta
- reduccion de capabilities no necesarias

No es obligatorio introducir todos estos endurecimientos si complican demasiado el funcionamiento, pero si deben evaluarse y documentarse.

### 12.9 Actualizar el runbook operativo final

La documentacion final debe dejar de presentar la operativa principal en terminos de cURLs admin remotos.

Debe cubrir como minimo:

- arrancar `webhook`
- ejecutar el contenedor admin puntual
- alta de repo por CLI/TUI
- alta de stack por creator
- validacion previa al restart
- deploy manual local
- redeploy local
- retry local
- rotacion de secrets
- migracion desde v1

Recomendacion de nuevos documentos o revision fuerte de los existentes:

- `docs/runbook-v2.md` o actualizacion profunda de `docs/runbook.md`
- `docs/migration-v1-to-v2.md`

### 12.10 Completar la bateria de tests

Cobertura minima sugerida:

1. casos de uso compartidos entre CLI y TUI
2. flujos principales de la TUI sobre mocks o capa de aplicacion subyacente
3. `migrate scan` detecta instalaciones v1 tipicas
4. `migrate plan` genera acciones correctas
5. `migrate apply` no destruye archivos sin confirmacion
6. stacks gestionados y no gestionados se diferencian correctamente
7. `docker compose config` del packaging final sigue siendo valido
8. el `webhook` sigue funcionando con solo webhook + lectura remota

### 12.11 Verificacion funcional final de la v2

La v2 deberia poder demostrarse con este flujo end-to-end:

1. levantar `webhook`
2. ejecutar `admin` para crear repo y entorno
3. generar secrets del repo
4. crear stack local con el wizard
5. validar sistema
6. reiniciar `webhook`
7. lanzar un deploy manual desde CLI/TUI
8. verificar el job por endpoint remoto de lectura
9. lanzar un webhook real de prueba

Si este flujo no es posible de punta a punta, la v2 todavia no esta cerrada.

---

## Riesgos a controlar

- Duplicar logica entre CLI y TUI y acabar manteniendo dos sistemas distintos.
- Hacer una migracion demasiado agresiva sobre stacks existentes.
- Dejar el contenedor `admin` corriendo permanentemente sin necesidad.
- Reabrir indirectamente una API remota de escritura por comodidad.
- Endurecer tanto el `webhook` que deje de poder escribir `.deploy.env` o de usar el socket Docker.

---

## Criterios de aceptacion

- [ ] Existe una TUI local reutilizando la misma logica de negocio que la CLI.
- [ ] Toda la escritura admin queda fuera de la API remota.
- [ ] Existe una estrategia de migracion clara desde la v1 y esta documentada.
- [ ] Existen herramientas de migracion asistida al menos a nivel de `scan` y `plan`.
- [ ] El contenedor `webhook` queda mas cerrado que el contenedor admin.
- [ ] El contenedor admin sigue siendo puntual, sin puertos publicados y no permanente.
- [ ] La documentacion final de la v2 refleja la operativa real del sistema.
- [ ] El flujo end-to-end de alta local + validacion + restart + deploy funciona de forma coherente.
