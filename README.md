# Web Migracion TAP (MVP)

Este modulo crea una base web para migrar gradualmente la app Tkinter.

## Objetivo de esta primera parte

- Replicar estructura principal de la app Python:
  - Header institucional
  - Tabs: Formulario, Listados, Historial, Configuracion
  - Status bar
- Incluir un flujo funcional basico en navegador:
  - Alta de inscripciones
  - Busqueda simple en tabla
  - Filtros por materia/profesor
  - Historial por DNI o nombre
  - Configuracion local guardada en localStorage

## Archivos

- index.html: estructura de UI
- styles.css: estilo visual (alto contraste, responsive)
- app.js: logica de tabs, formularios y estado local

## Ejecutar

### Modo recomendado (web multi-PC/IP, sin servidor local)

1. Crear y desplegar Google Apps Script como Web App usando:
  - `web_migracion/google_apps_script/Code.gs`
2. Copiar la URL `.../exec` del despliegue.
3. Editar `web_migracion/web_config.js` y completar:
  - `sheetsAppendUrl`
  - `appSecret` (opcional)
4. Publicar `web_migracion/` en tu hosting web.

Si más adelante cambiás la planilla destino, el orden correcto es:

1. Editar `web_migracion/google_apps_script/Code.gs` y cambiar:
   - `SPREADSHEET_ID` por el ID de la nueva planilla
   - `SHEET_NAME` si querés usar otra pestaña dentro de esa planilla
2. Volver a desplegar el Web App en Google Apps Script.
3. Copiar la nueva URL `.../exec` en `web_migracion/web_config.js` -> `sheetsAppendUrl`.
4. Si usás secreto compartido, mantener el mismo valor en `Code.gs` y `web_config.js`.

Nota técnica: el frontend usa un POST simple compatible con Apps Script (`no-cors` + `text/plain`) para evitar bloqueos de CORS/preflight.

Al guardar inscripciones desde el formulario:
- se guarda localmente en el navegador
- y se hace append en Google Sheets directo por Web App
- y se genera, descarga y envía automáticamente el certificado PDF para cada materia guardada

Importante: esta integración es append-only. No borra ni reemplaza filas en la planilla.

### Cupos y lista de espera (multi-PC)

- El cupo se controla en el Apps Script (lado servidor), no en cada navegador.
- El Web App usa lock (`LockService`) para evitar condiciones de carrera cuando inscriben varias PCs al mismo tiempo.
- Si una comisión supera su cupo, el registro se guarda con `en_lista_espera = Si` automáticamente.
- El frontend consulta estado de cupos central (`action=status`) para mostrar cuántos lugares quedan.

Cuando actualices `google_apps_script/Code.gs`, redeploy de nuevo la Web App para que tome la nueva lógica.

### Modo alternativo (puente local)

Si no usas Apps Script, podés usar `python web_migracion/server.py`.

Ese servidor queda escuchando en todas las interfaces de red, así que otras PCs deben entrar por la IP del equipo que lo ejecuta, no por `localhost`.

En ese caso, el cambio de planilla se hace en `data/config.json`:

- `google_sheets.spreadsheet_id` o `google_sheets.sheet_key`
- `google_sheets.sheet_name`

El servidor local toma esos valores al arrancar.

Además, este modo expone los certificados desde el mismo servidor:

- `POST /api/certificados/download` para generar y descargar el PDF
- `POST /api/certificados/send` para generar y enviar el certificado por email

La web resuelve esos endpoints automáticamente contra el origen actual, así que no hace falta tocar `web_config.js` si abrís la interfaz desde ese mismo servidor.

## Siguiente migracion sugerida

1. Conectar con `data/inscripciones.csv` (lectura real)
2. Reemplazar sincronizacion simulada por endpoint real
3. Migrar validadores de `services/validators.py`
4. Migrar cupos desde `data/cupos.yaml`
5. Hacer que la version alojada sin servidor Python también pueda generar y enviar certificados
