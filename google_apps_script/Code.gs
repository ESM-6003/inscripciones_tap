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

const CERTIFICATE_SETTINGS = {
  driveFolderId: '1grmrdoLdJGF8PIhWlXKyXxS2WQ7gKUrn',
  logoFileId: '',
  logoFileName: 'logo_institucional.jpg',
  logoUrl: '',
  headerLogoMaxWidth: 165,
  headerLogoMaxHeight: 130,
  headerGap: 4,
  headerTitle1Size: 14,
  headerTitle2Size: 13,
  headerLegajoSize: 12,
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

  if (action === 'emit_certificate') {
    if (APP_SECRET && params.appSecret !== APP_SECRET) {
      return jsonOrJsonp_({ ok: false, error: 'No autorizado' }, params.callback);
    }

    const record = decodeRecordParam_(params.record);
    if (!record) {
      return jsonOrJsonp_({ ok: false, error: 'Record invalido o faltante' }, params.callback);
    }

    const cert = buildCertificatePdfBlob_(record);
    if (!cert.ok) {
      return jsonOrJsonp_({ ok: false, error: cert.error || 'No se pudo generar el certificado' }, params.callback);
    }

    const emailResult = sendCertificateEmail_(record, cert.blob);

    return jsonOrJsonp_(
      {
        ok: true,
        fileName: cert.fileName,
        pdfBase64: Utilities.base64EncodeWebSafe(cert.blob.getBytes()),
        emailSent: emailResult.ok,
        emailMessage: emailResult.message,
      },
      params.callback
    );
  }

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

    appendCertificateHeader_(body, record, legajo);
    body.appendHorizontalRule();

    const certTitle = body.appendParagraph('CERTIFICADO DE INSCRIPCION');
    certTitle.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    certTitle.setAttributes(
      Object.assign({}, baseTextAttrs_(), {
        [DocumentApp.Attribute.BOLD]: true,
        [DocumentApp.Attribute.FONT_SIZE]: 16,
      })
    );
    body.appendParagraph('');

    appendSectionTitle_(body, 'Datos del Estudiante:');
    appendFieldLine_(body, 'Nombre y Apellido', getNombreCompleto_(record));
    appendFieldLine_(body, 'DNI', record.dni || 'N/A');
    appendFieldLine_(body, 'Fecha de Nacimiento', record.fecha_nacimiento || '');
    appendFieldLine_(body, 'Edad', record.edad || '');
    appendFieldLine_(body, 'Legajo', legajo || '');
    appendFieldLine_(body, 'Domicilio', record.direccion || record.domicilio || '');
    appendFieldLine_(body, 'Telefono', record.telefono || '');
    appendFieldLine_(body, 'Mail', record.email || record.mail || '');
    body.appendParagraph('');

    appendSectionTitle_(body, 'Datos de Padres/Tutores:');
    appendFieldLine_(body, 'Nombre del Padre', record.nombre_padre || '');
    appendFieldLine_(body, 'Nombre de la Madre', record.nombre_madre || '');
    appendFieldLine_(body, 'Telefono de Emergencia', record.telefono_emergencia || '');
    body.appendParagraph('');

    appendSectionTitle_(body, 'Datos de Inscripcion:');
    appendFieldLine_(body, 'Anio', record.anio || record.año || '', { suffix: '°' });
    appendFieldLine_(body, 'Turno', record.turno || 'N/A');
    appendFieldLine_(body, 'Materia', record.materia || 'N/A');
    appendFieldLine_(body, 'Profesor/a', record.profesor || 'N/A');
    appendFieldLine_(body, 'Comision', record.comision || 'N/A');
    appendFieldLine_(body, 'Horario', record.horario || '');

    if (isWaitlistValue_(record.en_lista_espera)) {
      appendWarningLine_(body, 'EN LISTA DE ESPERA');
    }
    body.appendParagraph('');

    appendSectionTitle_(body, 'Informacion Adicional:');
    appendFieldLine_(body, 'SAETA', record.saeta || '');
    appendFieldLine_(body, 'Obra Social', record.obra_social || '');
    appendFieldLine_(body, 'Seguro Escolar', record.seguro_escolar || '');
    appendFieldLine_(body, 'Pago Voluntario', record.pago_voluntario || '');
    if (String(record.monto || '').trim()) {
      appendFieldLine_(body, '  Monto', formatMonto_(record.monto));
    }
    appendFieldLine_(body, 'Permiso', record.permiso || '');

    const obs = String(record.observaciones || '').trim();
    if (obs) {
      appendFieldLine_(body, 'Observaciones', '');
      splitLongText_(obs, 95).forEach((line) => {
        appendPlainLine_(body, `  ${line}`);
      });
    }

    body.appendParagraph('');
    appendPlainLine_(
      body,
      `Fecha de emision: ${Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Argentina/Buenos_Aires', 'dd/MM/yyyy HH:mm')}`
    );
    const fechaInsc = formatFechaInscripcion_(record.fecha_inscripcion);
    if (fechaInsc) {
      appendPlainLine_(body, `Fecha de inscripcion: ${fechaInsc}`);
    }

    body.appendParagraph('');
    appendSignatureBlock_(body);
    body.appendParagraph('');
    appendLegalFooter_(body, CERTIFICATE_SETTINGS.legalFooter);

    doc.saveAndClose();
    file = DriveApp.getFileById(doc.getId());
    const pdfBlob = file.getBlob().setName(fileName);

    return { ok: true, blob: pdfBlob, fileName: fileName };
  } catch (err) {
    return { ok: false, error: String(err) };
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
    const logoP = logoCell.appendParagraph('');
    logoP.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    const img = logoP.appendInlineImage(logoBlob);
    const originalW = Number(img.getWidth()) || 1;
    const originalH = Number(img.getHeight()) || 1;
    const maxW = Math.max(1, Number(CERTIFICATE_SETTINGS.headerLogoMaxWidth || 165));
    const maxH = Math.max(1, Number(CERTIFICATE_SETTINGS.headerLogoMaxHeight || 130));
    const scale = Math.min(maxW / originalW, maxH / originalH);
    img.setWidth(Math.max(1, Math.round(originalW * scale)));
    img.setHeight(Math.max(1, Math.round(originalH * scale)));
  }

  const line1 = textCell.appendParagraph(CERTIFICATE_SETTINGS.titleLine1);
  line1.setSpacingBefore(0);
  line1.setSpacingAfter(2);
  line1.setAttributes(
    Object.assign({}, baseTextAttrs_(), {
      [DocumentApp.Attribute.BOLD]: true,
      [DocumentApp.Attribute.FONT_SIZE]: Math.max(8, Number(CERTIFICATE_SETTINGS.headerTitle1Size || 14)),
    })
  );

  const line2 = textCell.appendParagraph(CERTIFICATE_SETTINGS.titleLine2);
  line2.setSpacingBefore(0);
  line2.setSpacingAfter(2);
  line2.setAttributes(
    Object.assign({}, baseTextAttrs_(), {
      [DocumentApp.Attribute.BOLD]: true,
      [DocumentApp.Attribute.FONT_SIZE]: Math.max(8, Number(CERTIFICATE_SETTINGS.headerTitle2Size || 13)),
    })
  );

  if (legajo) {
    const line3 = textCell.appendParagraph(`Legajo: ${legajo}`);
    line3.setSpacingBefore(0);
    line3.setSpacingAfter(0);
    line3.setAttributes(
      Object.assign({}, baseTextAttrs_(), {
        [DocumentApp.Attribute.FONT_SIZE]: Math.max(8, Number(CERTIFICATE_SETTINGS.headerLegajoSize || 12)),
      })
    );
  }
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
  p.setAttributes(
    Object.assign({}, baseTextAttrs_(), {
      [DocumentApp.Attribute.BOLD]: true,
      [DocumentApp.Attribute.FONT_SIZE]: 11,
    })
  );
}

function appendFieldLine_(body, label, value, opts) {
  const options = opts || {};
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return;
  const suffix = String(options.suffix || '');
  appendPlainLine_(body, `${label}: ${raw}${suffix}`);
}

function appendPlainLine_(body, text) {
  const p = body.appendParagraph(String(text || ''));
  p.setAttributes(baseTextAttrs_());
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
    const sigP = right.appendParagraph('');
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
    right.appendParagraph('');
  }

  const line = right.appendParagraph('__________________________');
  line.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  line.setAttributes(baseTextAttrs_());

  const label = right.appendParagraph(String(CERTIFICATE_SETTINGS.signatureLabel || 'Firma y Sello'));
  label.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  label.setAttributes(baseTextAttrs_());

  const auth = right.appendParagraph(String(CERTIFICATE_SETTINGS.signatureAuthority || 'Autoridad Escolar'));
  auth.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  auth.setAttributes(baseTextAttrs_());

  const name = right.appendParagraph(String(CERTIFICATE_SETTINGS.signatureName || ''));
  name.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  name.setAttributes(
    Object.assign({}, baseTextAttrs_(), {
      [DocumentApp.Attribute.BOLD]: true,
      [DocumentApp.Attribute.FONT_SIZE]: 8,
    })
  );

  const role1 = right.appendParagraph(String(CERTIFICATE_SETTINGS.signatureRole1 || ''));
  role1.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  role1.setAttributes(
    Object.assign({}, baseTextAttrs_(), {
      [DocumentApp.Attribute.FONT_SIZE]: 8,
    })
  );

  const role2 = right.appendParagraph(String(CERTIFICATE_SETTINGS.signatureRole2 || ''));
  role2.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  role2.setAttributes(
    Object.assign({}, baseTextAttrs_(), {
      [DocumentApp.Attribute.FONT_SIZE]: 8,
    })
  );
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
