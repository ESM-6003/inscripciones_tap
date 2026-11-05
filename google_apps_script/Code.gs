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
const SCRIPT_VERSION = '2026-09-28-certificate-table-download-v4';

const CSV_FIELDS = [
  'id', 'fecha_inscripcion', 'nombre', 'apellido', 'genero', 'dni',
  'fecha_nacimiento', 'edad', 'legajo', 'direccion', 'telefono', 'email',
  'nombre_padre', 'nombre_madre', 'telefono_emergencia',
  'saeta', 'obra_social', 'seguro_escolar', 'pago_voluntario',
  'monto', 'permiso', 'observaciones',
  'anio', 'turno', 'materia', 'profesor', 'comision', 'horario',
  'en_lista_espera',
  'pais', 'provincia', 'indigena', 'discapacidad', 'discapacidad_cual'
];

const CERTIFICATE_SETTINGS = {
  driveFolderId: '1grmrdoLdJGF8PIhWlXKyXxS2WQ7gKUrn',
  logoFileId: '',
  logoFileName: 'logo_institucional.jpg',
  logoUrl: '',
  headerLogoMaxWidth: 150,
  headerLogoMaxHeight: 60,
  headerGap: 4,
  headerTitle1Size: 12,
  headerTitle2Size: 11,
  headerLegajoSize: 10,
  signatureFileId: '',
  signatureFileName: 'firma.png',
  signatureUrl: '',
  titleLine1: 'Certificado de Inscripcion - Escuela Superior de Musica',
  titleLine2: 'N 6003 - "Jose Lo Giudice"',
  signatureLabel: 'Firma y Sello',
  signatureAuthority: 'Autoridad Escolar',
  signatureName: 'Prof. Jose Nestor Mevoras Lencinas',
  signatureRole1: 'Rector Escuela Superior de Musica "Jose Lo Giudice"',
  signatureRole2: 'IES N 6003',
  legalFooter: 'Sirva la presente constancia de inscripcion como unico recibo de pago',
};

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);

    const raw = (e.postData && e.postData.contents) || '{}';
    const body = parseBody(raw);

    if (APP_SECRET && body.appSecret !== APP_SECRET) {
      return jsonOut({ ok: false, error: 'No autorizado' });
    }

    const action = String(body.action || '').trim().toLowerCase();
    
    if (action === 'savecatalog') {
      if (!Array.isArray(body.catalog)) {
        return jsonOut({ ok: false, error: 'Catalogo invalido' });
      }

      const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
      let catalogSheet = ss.getSheetByName('Catalogo');
      
      if (!catalogSheet) {
        catalogSheet = ss.insertSheet('Catalogo');
      } else {
        catalogSheet.clear();
      }

      const headers = ['anio', 'materia', 'profesor', 'comision', 'turno', 'horario', 'cupo'];
      const rows = [headers];
      
      body.catalog.forEach(row => {
        rows.push([
          row.anio || '',
          row.materia || '',
          row.profesor || '',
          row.comision || '',
          row.turno || '',
          row.horario || '',
          row.cupo || ''
        ]);
      });

      catalogSheet.getRange(1, 1, rows.length, headers.length).setValues(rows);
      
      return jsonOut({ ok: true, saved: body.catalog.length });
    }

    const records = normalizeRecords(body);
    if (!records.length) {
      return jsonOut({ ok: false, error: 'Payload invalido. Usa record o records' });
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
    ensureSheetSchema_(sheet);

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

  if (action === 'version') {
    return jsonOrJsonp_({ ok: true, version: SCRIPT_VERSION }, params.callback);
  }

  if (action === 'emit_certificate' || action === 'send_certificate' || action === 'download_certificate') {
    return handleCertificateRequest_(params, action);
  }

  if (action === 'status') {
    try {
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
      ensureSheetSchema_(sheet);
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
    } catch (err) {
      return jsonOrJsonp_({ ok: false, error: String(err) }, params.callback);
    }
  }

  if (action === 'loadcatalog') {
    try {
      if (APP_SECRET && params.appSecret !== APP_SECRET) {
        return jsonOrJsonp_({ ok: false, error: 'No autorizado' }, params.callback);
      }

      const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
      const catalogSheet = ss.getSheetByName('Catalogo');
      
      if (!catalogSheet) {
        return jsonOrJsonp_({ ok: true, catalog: null }, params.callback);
      }

      const data = catalogSheet.getDataRange().getValues();
      if (data.length < 2) {
        return jsonOrJsonp_({ ok: true, catalog: [] }, params.callback);
      }

      const headers = data[0];
      const catalog = data.slice(1).map(row => {
        const obj = {};
        headers.forEach((header, idx) => {
          obj[header] = row[idx] || '';
        });
        return obj;
      });

      return jsonOrJsonp_({ ok: true, catalog: catalog }, params.callback);
    } catch (err) {
      return jsonOrJsonp_({ ok: false, error: String(err) }, params.callback);
    }
  }

  return jsonOrJsonp_({ ok: true, service: 'sheets-append-webapp' }, params.callback);
}

function handleCertificateRequest_(params, action) {
  try {
    if (APP_SECRET && params.appSecret !== APP_SECRET) {
      return jsonOrJsonp_({ ok: false, error: 'No autorizado', version: SCRIPT_VERSION }, params.callback);
    }

    const record = decodeRecordParam_(params.record);
    if (!record) {
      return jsonOrJsonp_({ ok: false, error: 'Record invalido o faltante', version: SCRIPT_VERSION }, params.callback);
    }

    const cert = buildCertificatePdfBlob_(record);
    if (!cert.ok) {
      return jsonOrJsonp_({
        ok: false,
        error: cert.error || 'No se pudo generar el certificado',
        version: SCRIPT_VERSION,
      }, params.callback);
    }

    const result = {
      ok: true,
      version: SCRIPT_VERSION,
    };
    if (action !== 'download_certificate') {
      const emailResult = sendCertificateEmail_(record, cert.blob);
      result.emailSent = emailResult.ok;
      result.emailMessage = emailResult.message;
    }
    if (action !== 'send_certificate') {
      result.fileName = cert.fileName;
      result.pdfBase64 = Utilities.base64EncodeWebSafe(cert.blob.getBytes());
    }
    return jsonOrJsonp_(result, params.callback);
  } catch (err) {
    return jsonOrJsonp_({ ok: false, error: String(err), version: SCRIPT_VERSION }, params.callback);
  }
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

function ensureSheetSchema_(sheet) {
  const requiredColumns = CSV_FIELDS.length;
  const currentColumns = sheet.getMaxColumns();
  if (currentColumns < requiredColumns) {
    sheet.insertColumnsAfter(currentColumns, requiredColumns - currentColumns);
  }

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, requiredColumns).setValues([CSV_FIELDS]);
    return;
  }

  const headers = sheet.getRange(1, 1, 1, requiredColumns).getDisplayValues()[0];
  CSV_FIELDS.forEach((field, index) => {
    if (!String(headers[index] || '').trim()) {
      sheet.getRange(1, index + 1).setValue(field);
    }
  });
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

function decodeRecordParam_(encoded) {
  const raw = String(encoded || '').trim();
  if (!raw) return null;

  try {
    const bytes = Utilities.base64DecodeWebSafe(raw);
    const text = Utilities.newBlob(bytes).getDataAsString('utf-8');
    const obj = JSON.parse(text);
    return obj && typeof obj === 'object' ? obj : null;
  } catch (_err) {
    return null;
  }
}

function buildCertificatePdfBlob_(record) {
  let doc = null;
  let file = null;

  try {
    const apellido = String(record.apellido || '').trim();
    const nombre = String(record.nombre || '').trim();
    if (!apellido || !nombre) {
      return { ok: false, error: 'Faltan nombre o apellido para generar certificado' };
    }

    const legajo = String(record.legajo || record.dni || record.id || '').trim();
    const fecha = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Argentina/Buenos_Aires', 'yyyyMMdd');
    const safeApellido = sanitizeFilePart_(apellido);
    const safeNombre = sanitizeFilePart_(nombre);
    const safeLegajo = sanitizeFilePart_(legajo || 'registro');
    const fileName = `certificado_${safeApellido}_${safeNombre}_${safeLegajo}_${fecha}.pdf`;

    doc = DocumentApp.create(`cert_tmp_${Date.now()}_${Math.floor(Math.random() * 100000)}`);
    const body = doc.getBody();
    body.clear();
    body.setPageWidth(595.28);
    body.setPageHeight(841.89);
    body.setMarginTop(28);
    body.setMarginBottom(28);
    body.setMarginLeft(40);
    body.setMarginRight(40);

    appendCertificateHeader_(body, record, legajo);
    try {
      const first = body.getChild(0);
      if (first.getType() === DocumentApp.ElementType.PARAGRAPH && !first.asParagraph().getText()) first.removeFromParent();
    } catch (_err) {
      // no-op
    }
    const rule = body.appendHorizontalRule();
    try {
      const rp = rule.getParent().asParagraph();
      rp.setSpacingBefore(0);
      rp.setSpacingAfter(0);
      rp.setLineSpacing(0.5);
      rp.setAttributes({ [DocumentApp.Attribute.FONT_SIZE]: 2 });
    } catch (_err) {
      // no-op
    }

    const certTitle = body.appendParagraph('CERTIFICADO DE INSCRIPCION');
    certTitle.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    certTitle.setSpacingBefore(0);
    certTitle.setSpacingAfter(2);
    certTitle.setAttributes(
      Object.assign({}, baseTextAttrs_(), {
        [DocumentApp.Attribute.BOLD]: true,
        [DocumentApp.Attribute.FONT_SIZE]: 14,
      })
    );
    appendSpacer_(body);

    appendSectionTitle_(body, 'Datos del Estudiante:');
    appendFieldLine_(body, 'Nombre y Apellido', getNombreCompleto_(record));
    appendFieldLine_(body, 'DNI', record.dni || 'N/A');
    appendFieldLine_(body, 'Fecha de Nacimiento', record.fecha_nacimiento || '');
    appendFieldLine_(body, 'Edad', record.edad || '');
    appendFieldLine_(body, 'Legajo', legajo || '');
    appendFieldLine_(body, 'País', record.pais || '');
    appendFieldLine_(body, 'Provincia', record.provincia || '');
    appendFieldLine_(body, 'Domicilio', record.direccion || record.domicilio || '');
    appendFieldLine_(body, 'Telefono', record.telefono || '');
    appendFieldLine_(body, 'Mail', record.email || record.mail || '');
    appendFieldLine_(body, 'Indígena', record.indigena || '');
    appendFieldLine_(body, 'Discapacidad', record.discapacidad || '');
    appendFieldLine_(body, '¿Cuál?', record.discapacidad_cual || '');
    appendSpacer_(body);

    appendSectionTitle_(body, 'Datos de Padres/Tutores:');
    appendFieldLine_(body, 'Nombre del Padre', record.nombre_padre || '');
    appendFieldLine_(body, 'Nombre de la Madre', record.nombre_madre || '');
    appendFieldLine_(body, 'Telefono de Emergencia', record.telefono_emergencia || '');
    appendSpacer_(body);

    appendSectionTitle_(body, 'Datos de Inscripcion:');
    const materias = Array.isArray(record.materias) && record.materias.length
      ? record.materias
      : [{
        anio: record.anio || record.año || '',
        materia: record.materia || '',
        profesor: record.profesor || '',
        comision: record.comision || '',
        turno: record.turno || '',
        horario: record.horario || '',
        observaciones: record.observaciones || '',
        en_lista_espera: record.en_lista_espera || '',
      }];
    appendMateriasTable_(body, materias);
    appendSpacer_(body);

    appendSectionTitle_(body, 'Informacion Adicional:');
    appendInlineFields_(body, [
      ['SAETA', record.saeta],
      ['Obra Social', record.obra_social],
      ['Seguro Escolar', record.seguro_escolar],
      ['Pago Voluntario', record.pago_voluntario],
      ['Monto', String(record.monto || '').trim() ? formatMonto_(record.monto) : ''],
      ['Permiso', record.permiso],
      ['Fecha de emision', Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Argentina/Buenos_Aires', 'dd/MM/yyyy HH:mm')],
      ['Fecha de inscripcion', formatFechaInscripcion_(record.fecha_inscripcion)],
    ]);

    appendSpacer_(body, 10);
    appendSignatureBlock_(body);
    appendSpacer_(body);
    appendLegalFooter_(body, CERTIFICATE_SETTINGS.legalFooter);

    doc.saveAndClose();
    file = DriveApp.getFileById(doc.getId());
    const pdfBlob = file.getBlob().setName(fileName);

    return { ok: true, blob: pdfBlob, fileName: fileName };
  } catch (err) {
    return { ok: false, error: String(err), version: SCRIPT_VERSION };
  } finally {
    try {
      if (file) {
        file.setTrashed(true);
      }
    } catch (_err) {
      // no-op
    }
  }
}

function appendCertificateHeader_(body, record, legajo) {
  const table = body.appendTable([['', '']]);
  table.setBorderWidth(0);

  const row = table.getRow(0);
  const logoCell = row.getCell(0);
  const textCell = row.getCell(1);

  logoCell.setPaddingTop(0);
  logoCell.setPaddingBottom(0);
  logoCell.setPaddingLeft(0);
  logoCell.setPaddingRight(Math.max(0, Number(CERTIFICATE_SETTINGS.headerGap || 0)));

  textCell.setPaddingTop(0);
  textCell.setPaddingBottom(0);
  textCell.setPaddingLeft(Math.max(0, Number(CERTIFICATE_SETTINGS.headerGap || 0)));
  textCell.setPaddingRight(0);

  const logoBlob = getCertificateLogoBlob_();
  if (logoBlob) {
    const logoP = logoCell.getChild(0).asParagraph();
    logoP.setSpacingBefore(0);
    logoP.setSpacingAfter(0);
    logoP.setAlignment(DocumentApp.HorizontalAlignment.LEFT);
    const img = logoP.appendInlineImage(logoBlob);
    const originalW = Number(img.getWidth()) || 1;
    const originalH = Number(img.getHeight()) || 1;
    const maxW = Math.max(1, Number(CERTIFICATE_SETTINGS.headerLogoMaxWidth || 165));
    const maxH = Math.max(1, Number(CERTIFICATE_SETTINGS.headerLogoMaxHeight || 130));
    const scale = Math.min(maxW / originalW, maxH / originalH);
    img.setWidth(Math.max(1, Math.round(originalW * scale)));
    img.setHeight(Math.max(1, Math.round(originalH * scale)));
  }

  textCell.setVerticalAlignment(DocumentApp.VerticalAlignment.CENTER);
  logoCell.setVerticalAlignment(DocumentApp.VerticalAlignment.CENTER);
  logoCell.setWidth(Math.max(1, Number(CERTIFICATE_SETTINGS.headerLogoMaxWidth || 150)) + 8);

  // Se reutiliza el párrafo inicial de la celda para no sumar una línea vacía
  const line1 = textCell.getChild(0).asParagraph();
  line1.setText(CERTIFICATE_SETTINGS.titleLine1);
  line1.setSpacingBefore(0);
  line1.setSpacingAfter(1);
  line1.setAttributes(
    Object.assign({}, baseTextAttrs_(), {
      [DocumentApp.Attribute.BOLD]: true,
      [DocumentApp.Attribute.FONT_SIZE]: Math.max(8, Number(CERTIFICATE_SETTINGS.headerTitle1Size || 14)),
    })
  );

  const line2 = textCell.appendParagraph(CERTIFICATE_SETTINGS.titleLine2);
  line2.setSpacingBefore(0);
  line2.setSpacingAfter(1);
  line2.setAttributes(
    Object.assign({}, baseTextAttrs_(), {
      [DocumentApp.Attribute.BOLD]: true,
      [DocumentApp.Attribute.FONT_SIZE]: Math.max(8, Number(CERTIFICATE_SETTINGS.headerTitle2Size || 13)),
    })
  );
}

function getCertificateLogoBlob_() {
  const fromFolder = getBlobFromDriveFolderByName_(
    CERTIFICATE_SETTINGS.driveFolderId,
    CERTIFICATE_SETTINGS.logoFileName
  );
  if (fromFolder) return fromFolder;

  const id = String(CERTIFICATE_SETTINGS.logoFileId || '').trim();
  if (id) {
    try {
      return DriveApp.getFileById(id).getBlob();
    } catch (_err) {
      // no-op
    }
  }

  const url = String(CERTIFICATE_SETTINGS.logoUrl || '').trim();
  return fetchBlobFromUrl_(url);
}

function getCertificateSignatureBlob_() {
  const fromFolder = getBlobFromDriveFolderByName_(
    CERTIFICATE_SETTINGS.driveFolderId,
    CERTIFICATE_SETTINGS.signatureFileName
  );
  if (fromFolder) return fromFolder;

  const id = String(CERTIFICATE_SETTINGS.signatureFileId || '').trim();
  if (id) {
    try {
      return DriveApp.getFileById(id).getBlob();
    } catch (_err) {
      // no-op
    }
  }

  const url = String(CERTIFICATE_SETTINGS.signatureUrl || '').trim();
  return fetchBlobFromUrl_(url);
}

function fetchBlobFromUrl_(url) {
  const u = String(url || '').trim();
  if (!u) return null;
  try {
    const response = UrlFetchApp.fetch(u, { muteHttpExceptions: true });
    if (response.getResponseCode() >= 200 && response.getResponseCode() < 300) {
      return response.getBlob();
    }
  } catch (_err) {
    // no-op
  }
  return null;
}

function getBlobFromDriveFolderByName_(folderId, fileName) {
  const id = String(folderId || '').trim();
  const name = String(fileName || '').trim();
  if (!id || !name) return null;

  try {
    const folder = DriveApp.getFolderById(id);
    const exact = folder.getFilesByName(name);
    if (exact.hasNext()) {
      return exact.next().getBlob();
    }

    // Fallback case-insensitive search within the folder.
    const wanted = name.toLowerCase();
    const files = folder.getFiles();
    while (files.hasNext()) {
      const f = files.next();
      if (String(f.getName() || '').toLowerCase() === wanted) {
        return f.getBlob();
      }
    }
  } catch (_err) {
    // no-op
  }

  return null;
}

function appendSectionTitle_(body, text) {
  const p = body.appendParagraph(String(text || '').trim());
  p.setSpacingBefore(0);
  p.setSpacingAfter(2);
  p.setAttributes(
    Object.assign({}, baseTextAttrs_(), {
      [DocumentApp.Attribute.BOLD]: true,
      [DocumentApp.Attribute.FONT_SIZE]: 11,
    })
  );
}

function appendSpacer_(body, size) {
  const p = body.appendParagraph('');
  p.setSpacingBefore(0);
  p.setSpacingAfter(0);
  p.setAttributes({ [DocumentApp.Attribute.FONT_SIZE]: size || 4 });
}

// Varios datos en un mismo párrafo, separados por " | "
function appendInlineFields_(body, pairs) {
  const items = pairs
    .map((pair) => [pair[0], String(pair[1] == null ? '' : pair[1]).trim()])
    .filter((pair) => pair[1]);
  if (!items.length) return;
  const p = body.appendParagraph('');
  p.setAttributes(baseTextAttrs_());
  p.setSpacingBefore(0);
  p.setSpacingAfter(2);
  items.forEach((pair, i) => {
    if (i > 0) p.appendText('  |  ').setAttributes(Object.assign({}, baseTextAttrs_(), { [DocumentApp.Attribute.BOLD]: false }));
    p.appendText(`${pair[0]}: `).setAttributes(Object.assign({}, baseTextAttrs_(), { [DocumentApp.Attribute.BOLD]: true }));
    p.appendText(pair[1]).setAttributes(Object.assign({}, baseTextAttrs_(), { [DocumentApp.Attribute.BOLD]: false }));
  });
}

function appendFieldLine_(body, label, value, opts) {
  const options = opts || {};
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return;
  const suffix = String(options.suffix || '');
  const paragraph = body.appendParagraph('');
  paragraph.setAttributes(baseTextAttrs_());
  paragraph.setSpacingBefore(0);
  paragraph.setSpacingAfter(1);
  const labelText = paragraph.appendText(`${label}: `);
  labelText.setAttributes(Object.assign({}, baseTextAttrs_(), { [DocumentApp.Attribute.BOLD]: true }));
  const valueText = paragraph.appendText(`${raw}${suffix}`);
  valueText.setAttributes(Object.assign({}, baseTextAttrs_(), { [DocumentApp.Attribute.BOLD]: false }));
}

function appendMateriasTable_(body, materias) {
  const valueOrPlaceholder = (value) => String(value == null ? '' : value).trim() || 'No especificado';
  const rows = [
    ['Materia', 'Profesor/a', 'Comisión', 'Turno', 'Horario'],
    ...materias.map((materia) => {
      const materiaName = valueOrPlaceholder(materia.materia);
      const anio = String(materia.anio || materia.año || '').trim();
      const materiaLabel = anio && materiaName !== 'No especificado'
        ? `${materiaName} (${anio}° año)`
        : materiaName;
      return [
        materiaLabel,
        valueOrPlaceholder(materia.profesor),
        valueOrPlaceholder(materia.comision),
        valueOrPlaceholder(materia.turno),
        valueOrPlaceholder(materia.horario),
      ];
    }),
  ];
  const table = body.appendTable(rows);
  table.setBorderColor('#9B9B9B');
  table.setBorderWidth(0.75);

  for (let rowIndex = 0; rowIndex < table.getNumRows(); rowIndex += 1) {
    const row = table.getRow(rowIndex);
    for (let cellIndex = 0; cellIndex < row.getNumCells(); cellIndex += 1) {
      const cell = row.getCell(cellIndex);
      cell.setPaddingTop(4);
      cell.setPaddingBottom(4);
      cell.setPaddingLeft(5);
      cell.setPaddingRight(5);
      if (rowIndex === 0) cell.setBackgroundColor('#EAEAEA');

      const paragraph = cell.getChild(0).asParagraph();
      const text = paragraph.editAsText();
      text.setBold(rowIndex === 0);
      text.setFontSize(8);
    }
  }

  materias.forEach((materia) => {
    const materiaName = String(materia.materia || 'N/A').trim();
    const observations = String(materia.observaciones || '').trim();
    if (observations) appendFieldLine_(body, `Observaciones - ${materiaName}`, observations);
    if (isWaitlistValue_(materia.en_lista_espera)) {
      appendWarningLine_(body, `EN LISTA DE ESPERA: ${materiaName}`);
    }
  });
  const spacer = body.appendParagraph('');
  spacer.setSpacingAfter(4);
}

function setCellTextStyle_(paragraph, label, value) {
  const content = paragraph.editAsText();
  const fullText = content.getText();
  if (!fullText) return;

  content.setBold(false);
  if (label) {
    const labelEnd = Math.min(String(label).length, fullText.length) - 1;
    if (labelEnd >= 0) content.setBold(0, labelEnd, true);
  }
  if (value) {
    const valueStart = fullText.length - String(value).length;
    if (valueStart < fullText.length) content.setBold(Math.max(0, valueStart), fullText.length - 1, false);
  }
}

function appendPlainLine_(body, text) {
  const p = body.appendParagraph(String(text || ''));
  p.setAttributes(baseTextAttrs_());
  p.editAsText().setBold(false);
}

function appendWarningLine_(body, text) {
  const p = body.appendParagraph(`⚠ ${String(text || '').trim()}`);
  p.setAttributes(
    Object.assign({}, baseTextAttrs_(), {
      [DocumentApp.Attribute.BOLD]: true,
      [DocumentApp.Attribute.FONT_SIZE]: 10,
    })
  );
}

function appendSignatureBlock_(body) {
  const table = body.appendTable([['', '']]);
  table.setBorderWidth(0);
  const row = table.getRow(0);
  const left = row.getCell(0);
  const right = row.getCell(1);

  left.setPaddingTop(0);
  left.setPaddingBottom(0);
  left.setPaddingLeft(0);
  left.setPaddingRight(0);
  right.setPaddingTop(0);
  right.setPaddingBottom(0);
  right.setPaddingLeft(12);
  right.setPaddingRight(0);

  const signatureBlob = getCertificateSignatureBlob_();
  if (signatureBlob) {
    const sigP = right.getChild(0).asParagraph();
    sigP.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    const img = sigP.appendInlineImage(signatureBlob);
    const originalW = Number(img.getWidth()) || 1;
    const originalH = Number(img.getHeight()) || 1;
    const maxW = 140;
    const maxH = 50;
    const scale = Math.min(maxW / originalW, maxH / originalH);
    img.setWidth(Math.max(1, Math.round(originalW * scale)));
    img.setHeight(Math.max(1, Math.round(originalH * scale)));
  } else {
    right.getChild(0).asParagraph().setSpacingAfter(0);
  }

  const line = right.appendParagraph('__________________________');
  line.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  line.setSpacingBefore(0);
  line.setSpacingAfter(0);
  line.setAttributes(Object.assign({}, baseTextAttrs_(), { [DocumentApp.Attribute.FONT_SIZE]: 7 }));

  const sigSmall = { [DocumentApp.Attribute.FONT_SIZE]: 7 };
  const sigLines = [
    [String(CERTIFICATE_SETTINGS.signatureName || ''), Object.assign({}, baseTextAttrs_(), sigSmall, { [DocumentApp.Attribute.BOLD]: true })],
    [String(CERTIFICATE_SETTINGS.signatureRole1 || ''), Object.assign({}, baseTextAttrs_(), sigSmall)],
    [String(CERTIFICATE_SETTINGS.signatureRole2 || ''), Object.assign({}, baseTextAttrs_(), sigSmall)],
  ];
  sigLines.forEach((item) => {
    if (!item[0]) return;
    const p = right.appendParagraph(item[0]);
    p.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    p.setSpacingBefore(0);
    p.setSpacingAfter(0);
    p.setAttributes(item[1]);
  });
}

function appendLegalFooter_(body, text) {
  const value = String(text || '').trim();
  if (!value) return;
  const p = body.appendParagraph(value);
  p.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  p.setAttributes(
    Object.assign({}, baseTextAttrs_(), {
      [DocumentApp.Attribute.FONT_SIZE]: 7,
      [DocumentApp.Attribute.FOREGROUND_COLOR]: '#808080',
    })
  );
}

function baseTextAttrs_() {
  return {
    [DocumentApp.Attribute.FONT_FAMILY]: 'Arial',
    [DocumentApp.Attribute.FONT_SIZE]: 10,
  };
}

function getNombreCompleto_(record) {
  const apellido = String(record.apellido || '').trim().toUpperCase();
  const nombre = String(record.nombre || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
  return `${apellido}, ${nombre}`.trim().replace(/^,\s*/, '');
}

function formatMonto_(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return '';

  const normalized = text.replace(/\$/g, '').replace(/,/g, '').trim();
  const n = Number(normalized);
  if (!Number.isFinite(n)) return `$${text}`;

  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function splitLongText_(text, maxLen) {
  const out = [];
  let rest = String(text || '').trim();
  const limit = Math.max(10, Number(maxLen) || 95);

  while (rest.length > limit) {
    let cut = rest.slice(0, limit).lastIndexOf(' ');
    if (cut <= 0) cut = limit;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }

  if (rest) out.push(rest);
  return out;
}

function formatFechaInscripcion_(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';

  try {
    const normalized = value.includes('T') ? value : value.replace(' ', 'T');
    const d = new Date(normalized);
    if (!Number.isNaN(d.getTime())) {
      return Utilities.formatDate(d, Session.getScriptTimeZone() || 'America/Argentina/Buenos_Aires', 'dd/MM/yyyy');
    }
  } catch (_err) {
    // no-op
  }

  return value.length >= 10 ? value.slice(0, 10) : value;
}

function sendCertificateEmail_(record, pdfBlob) {
  const toAddr = String(record.email || '').trim();
  if (!toAddr) {
    return { ok: false, message: 'El registro no tiene email configurado.' };
  }

  const nombre = String(record.nombre || '').trim();
  const apellido = String(record.apellido || '').trim();
  const subject = `Certificado de inscripcion - ${nombre} ${apellido}`.trim();
  const body = [
    `Adjuntamos el certificado de inscripcion de ${nombre} ${apellido}.`,
    '',
    'Saludos cordiales,',
    'Escuela Superior de Musica N 6003',
  ].join('\n');

  try {
    GmailApp.sendEmail(toAddr, subject, body, {
      attachments: [pdfBlob],
      name: 'Escuela Superior de Musica N 6003',
    });
    return { ok: true, message: `Email enviado a ${toAddr}` };
  } catch (err) {
    return { ok: false, message: `Error enviando email: ${String(err)}` };
  }
}

function sanitizeFilePart_(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_-]/g, '');
}

function authorizeAllServices_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  ss.getId();

  const doc = DocumentApp.create(`auth_tmp_${Date.now()}`);
  doc.getBody().appendParagraph('auth');
  doc.saveAndClose();

  const file = DriveApp.getFileById(doc.getId());
  const blob = file.getBlob().setName('auth.pdf');
  file.setTrashed(true);

  GmailApp.getAliases();

  return {
    ok: true,
    sheetId: ss.getId(),
    pdfBytes: blob.getBytes().length,
  };
}
