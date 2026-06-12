/*
Google Apps Script Web App: append-only para inscripciones.

1) Crear un proyecto en script.google.com
2) Pegar este archivo como Code.gs
3) Configurar SPREADSHEET_ID y SHEET_NAME
4) Deploy -> New deployment -> Web app
   - Execute as: Me
   - Who has access: Anyone
5) Copiar la URL .../exec a web_migracion/web_config.js -> sheetsAppendUrl
*/

const SPREADSHEET_ID = '1YoyK2aw8x-RJAANB4enPna8HWspLML8aAYr4D_epI2s';
const SHEET_NAME = 'Inscripciones';

// Opcional: colocar un secreto compartido.
// Si no queres usar secreto, dejar vacio "".
const APP_SECRET = '';

const CSV_FIELDS = [
  'id', 'fecha_inscripcion', 'nombre', 'apellido', 'genero', 'dni',
  'fecha_nacimiento', 'edad', 'legajo', 'direccion', 'telefono', 'email',
  'nombre_padre', 'nombre_madre', 'telefono_emergencia',
  'saeta', 'obra_social', 'seguro_escolar', 'pago_voluntario',
  'monto', 'permiso', 'observaciones',
  'anio', 'turno', 'materia', 'profesor', 'comision', 'horario',
  'en_lista_espera'
];

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);

    const raw = (e.postData && e.postData.contents) || '{}';
    const body = parseBody(raw);

    if (APP_SECRET && body.appSecret !== APP_SECRET) {
      return jsonOut({ ok: false, error: 'No autorizado' });
    }

    const records = normalizeRecords(body);
    if (!records.length) {
      return jsonOut({ ok: false, error: 'Payload invalido. Usa record o records' });
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);

    const existingValues = getExistingValues_(sheet);
    const occupiedBySection = getOccupiedBySection_(existingValues);

    const nextId = getNextNumericId_(sheet);
    const results = [];
    const values = records.map((r, index) => {
      const row = { ...r, id: nextId + index };

      const key = sectionKey_(row);
      const cap = toCapacity_(row.cupo);
      const currentlyOccupied = occupiedBySection.get(key) || 0;
      const isWaitlist = Number.isFinite(cap) ? currentlyOccupied >= cap : false;

      if (!isWaitlist) {
        occupiedBySection.set(key, currentlyOccupied + 1);
      }

      row.en_lista_espera = isWaitlist ? 'Si' : 'No';

      results.push({
        section: key,
        cupo: Number.isFinite(cap) ? cap : null,
        ocupados: !isWaitlist ? currentlyOccupied + 1 : currentlyOccupied,
        restantes: Number.isFinite(cap) ? Math.max(0, cap - (!isWaitlist ? currentlyOccupied + 1 : currentlyOccupied)) : null,
        en_lista_espera: row.en_lista_espera,
      });

      return CSV_FIELDS.map((field) => asCell(row[field]));
    });

    const startRow = sheet.getLastRow() + 1;
    const startCol = 1;
    sheet.getRange(startRow, startCol, values.length, CSV_FIELDS.length).setValues(values);

    return jsonOut({ ok: true, count: values.length, message: 'Append OK', results: results });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  } finally {
    try {
      lock.releaseLock();
    } catch (_err) {
      // no-op
    }
  }
}

function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  const action = String(params.action || '').trim().toLowerCase();

  if (action === 'status') {
    if (APP_SECRET && params.appSecret !== APP_SECRET) {
      return jsonOrJsonp_({ ok: false, error: 'No autorizado' }, params.callback);
    }

    const section = {
      anio: params.anio,
      materia: params.materia,
      profesor: params.profesor,
      comision: params.comision,
    };
    const cupo = toCapacity_(params.cupo);
    const key = sectionKey_(section);

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
    const existingValues = getExistingValues_(sheet);
    const occupiedBySection = getOccupiedBySection_(existingValues);
    const ocupados = occupiedBySection.get(key) || 0;
    const restantes = Number.isFinite(cupo) ? Math.max(0, cupo - ocupados) : null;

    return jsonOrJsonp_(
      {
        ok: true,
        cupo: Number.isFinite(cupo) ? cupo : String(params.cupo || ''),
        ocupados: ocupados,
        restantes: restantes,
        lista_espera: Number.isFinite(cupo) ? restantes === 0 : false,
      },
      params.callback
    );
  }

  return jsonOrJsonp_({ ok: true, service: 'sheets-append-webapp' }, params.callback);
}

function normalizeRecords(body) {
  if (!body || typeof body !== 'object') return [];
  if (Array.isArray(body.records)) return body.records.filter((x) => x && typeof x === 'object');
  if (body.record && typeof body.record === 'object') return [body.record];
  return [];
}

function parseBody(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch (err) {
    const text = String(raw || '').trim();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (_err) {
      return {};
    }
  }
}

function asCell(value) {
  if (value === undefined || value === null) return '';
  return value;
}

function getNextNumericId_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) return 1;

  const ids = sheet.getRange(1, 1, lastRow, 1).getValues().flat();
  const maxId = ids.reduce((max, value) => {
    const current = Number.parseInt(String(value).trim(), 10);
    return Number.isFinite(current) && current > max ? current : max;
  }, 0);

  return maxId + 1;
}

function getExistingValues_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) return [];
  return sheet.getRange(1, 1, lastRow, CSV_FIELDS.length).getValues();
}

function getOccupiedBySection_(values) {
  const out = new Map();

  values.forEach((row) => {
    const record = rowArrayToRecord_(row);
    const key = sectionKey_(record);
    if (!key) return;
    if (isWaitlistValue_(record.en_lista_espera)) return;
    out.set(key, (out.get(key) || 0) + 1);
  });

  return out;
}

function rowArrayToRecord_(row) {
  const out = {};
  CSV_FIELDS.forEach((field, idx) => {
    out[field] = row[idx];
  });
  return out;
}

function sectionKey_(row) {
  const parts = [
    row.anio,
    row.materia,
    row.profesor,
    row.comision,
  ].map((value) => String(value || '').trim().toLowerCase());
  return parts.join('||');
}

function toCapacity_(raw) {
  const value = String(raw == null ? '' : raw).trim();
  if (!value) return NaN;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return NaN;
  return Math.max(0, n);
}

function isWaitlistValue_(value) {
  const normalized = String(value == null ? '' : value).trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'si' || normalized === 'sí';
}

function jsonOrJsonp_(obj, callback) {
  const cb = String(callback || '').trim();
  const isValidCallback = /^[A-Za-z0-9_.$]+$/.test(cb);
  if (isValidCallback) {
    return ContentService
      .createTextOutput(`${cb}(${JSON.stringify(obj)})`)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return jsonOut(obj);
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
