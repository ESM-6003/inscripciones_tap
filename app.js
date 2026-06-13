const STORAGE_KEY = "tap_web_mvp_registros";
const CATALOGO_KEY = "tap_web_mvp_catalogo";
const SHEETS_APPEND_URL = String(window.WEB_CONFIG?.sheetsAppendUrl || "").trim();
const APP_SECRET = String(window.WEB_CONFIG?.appSecret || "").trim();
const CERTIFICATE_API_BASE = getCertificateApiBase();

const dom = {
  tabs: document.querySelectorAll(".tab"),
  panels: document.querySelectorAll(".tab-panel"),
  form: document.getElementById("inscripcionForm"),
  materiasContainer: document.getElementById("materiasContainer"),
  addMateriaBtn: document.getElementById("addMateriaBtn"),
  historialSearch: document.getElementById("historialSearch"),
  historialTableBody: document.getElementById("historialTableBody"),
  historialResultado: document.getElementById("historialResultado"),
  clearHistorialBtn: document.getElementById("clearHistorialBtn"),
  downloadCertBtn: document.getElementById("downloadCertBtn"),
  sendCertBtn: document.getElementById("sendCertBtn"),
  statusBar: document.getElementById("statusBar"),
  unlockCatalogBtn: document.getElementById("unlockCatalogBtn"),
  catalogAuthStatus: document.getElementById("catalogAuthStatus"),
  catalogSearchInput: document.getElementById("catalogSearchInput"),
  catalogTableBody: document.getElementById("catalogTableBody"),
  addCatalogRowBtn: document.getElementById("addCatalogRowBtn"),
  resetCatalogBtn: document.getElementById("resetCatalogBtn"),
  saveCatalogBtn: document.getElementById("saveCatalogBtn"),
};

let registros = loadRegistros();
let historialSeleccionadoId = "";
const baseCatalogo = normalizeMateriasCatalog(window.MATERIAS_CATALOGO || {});
let materiasCatalogo = loadCatalogoEditable(baseCatalogo);
let catalogUnlocked = false;

init();

function init() {
  setupTabs();
  setupEvents();
  initConfigCatalogEditor();
  refreshMateriaItemsUI();
  renderHistorial();
  setStatus(`Listo. ${registros.length} inscripciones cargadas.`);
}

function setupTabs() {
  dom.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.tab;
      dom.tabs.forEach((t) => {
        const active = t === tab;
        t.classList.toggle("is-active", active);
        t.setAttribute("aria-selected", String(active));
      });
      dom.panels.forEach((panel) => {
        panel.classList.toggle("is-active", panel.id === target);
      });
    });
  });
}

function setupEvents() {
  dom.form?.addEventListener("submit", onGuardarInscripcion);
  dom.form?.addEventListener("reset", onResetFormulario);
  dom.addMateriaBtn?.addEventListener("click", onAgregarMateria);
  dom.materiasContainer?.addEventListener("click", onMateriaContainerClick);
  dom.materiasContainer?.addEventListener("change", onMateriaContainerChange);
  dom.historialSearch?.addEventListener("input", renderHistorial);
  dom.clearHistorialBtn?.addEventListener("click", borrarHistorial);
  dom.downloadCertBtn?.addEventListener("click", onDescargarCertificadoSeleccionado);
  dom.sendCertBtn?.addEventListener("click", onEnviarCertificadoSeleccionado);
  dom.historialTableBody?.addEventListener("click", onHistorialTableClick);
  dom.historialTableBody?.addEventListener("dblclick", onHistorialTableDoubleClick);

  dom.unlockCatalogBtn?.addEventListener("click", autenticarEdicionCatalogo);
  dom.addCatalogRowBtn?.addEventListener("click", agregarFilaCatalogo);
  dom.saveCatalogBtn?.addEventListener("click", guardarCatalogo);
  dom.resetCatalogBtn?.addEventListener("click", restaurarCatalogoBase);
  dom.catalogTableBody?.addEventListener("click", onCatalogTableClick);
  dom.catalogTableBody?.addEventListener("input", onCatalogTableInput);
  dom.catalogSearchInput?.addEventListener("input", renderCatalogTable);
}

function onGuardarInscripcion(event) {
  event.preventDefault();
  const data = new FormData(dom.form);
  const raw = Object.fromEntries(data.entries());
  const materiasResult = getMateriasDelFormulario();

  if (!raw.nombre || !raw.apellido || !raw.dni || !raw.genero) {
    setStatus("Faltan datos obligatorios del estudiante (nombre, apellido, DNI y genero).", true);
    return;
  }

  if (materiasResult.hasIncomplete) {
    setStatus("Cada bloque de materia cargado debe tener Materia y Profesor/a.", true);
    return;
  }

  if (!materiasResult.materias.length) {
    setStatus("Debes completar al menos una materia con materia y profesor.", true);
    return;
  }

  const fecha = new Date().toISOString();
  const idBase = getNextNumericId();
  const nuevos = materiasResult.materias.map((materia, index) => ({
    ...raw,
    ...materia,
    id: idBase + index,
    fecha_inscripcion: fecha,
    fecha_nacimiento: formatBirthDate(raw.fecha_nacimiento),
  }));

  registros = [...nuevos, ...registros];
  persistRegistros();
  dom.form.reset();
  resetMaterias();
  renderHistorial();

  setStatus(`Se guardaron ${nuevos.length} materias para ${raw.nombre} ${raw.apellido}.`);
  void procesarCertificadosAutomaticos(nuevos);
  void appendToGoogleSheets(nuevos);
}

async function procesarCertificadosAutomaticos(records) {
  if (!Array.isArray(records) || !records.length) return;

  if (SHEETS_APPEND_URL) {
    await procesarCertificadosAutomaticosViaAppsScript(records);
    return;
  }

  for (let index = 0; index < records.length; index += 1) {
    const registro = records[index];
    const nombre = `${registro.nombre || ""} ${registro.apellido || ""}`.trim() || "registro";
    setStatus(`Procesando certificado ${index + 1}/${records.length} para ${nombre}...`);

    try {
      const response = await fetch(buildCertificateEndpoint("/api/certificados/emit"), {
        method: "POST",
        mode: CERTIFICATE_API_BASE ? "cors" : "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ record: registro, appSecret: APP_SECRET }),
      });

      const contentType = String(response.headers.get("Content-Type") || "").toLowerCase();
      if (!response.ok || contentType.includes("application/json")) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "No se pudo generar el certificado.");
      }

      const blob = await response.blob();
      const filename = filenameFromDisposition(
        response.headers.get("Content-Disposition") || "",
        buildCertificateFilename(registro)
      );

      triggerBlobDownload(blob, filename);

      const emailOk = String(response.headers.get("X-Certificate-Email-OK") || "").toLowerCase() === "true";
      const emailMsg = String(response.headers.get("X-Certificate-Email-Message") || "").trim();

      if (emailOk) {
        setStatus(`Certificado descargado y enviado para ${nombre}.`);
      } else if (emailMsg) {
        setStatus(`Certificado descargado para ${nombre}. Email: ${emailMsg}`, true);
      } else {
        setStatus(`Certificado descargado para ${nombre}.`);
      }
    } catch (error) {
      setStatus(`No se pudo procesar el certificado de ${nombre}: ${error.message || error}`, true);
    }
  }
}

async function procesarCertificadosAutomaticosViaAppsScript(records) {
  for (let index = 0; index < records.length; index += 1) {
    const registro = records[index];
    const nombre = `${registro.nombre || ""} ${registro.apellido || ""}`.trim() || "registro";
    setStatus(`Procesando certificado ${index + 1}/${records.length} para ${nombre}...`);

    try {
      const data = await fetchRemoteEmitCertificate(registro);
      if (!data.ok) {
        throw new Error(data.error || "No se pudo generar el certificado.");
      }

      if (!data.pdfBase64) {
        throw new Error("La respuesta no incluyó el PDF del certificado.");
      }

      const blob = base64ToBlob(data.pdfBase64, "application/pdf");
      const filename = String(data.fileName || buildCertificateFilename(registro)).trim();
      triggerBlobDownload(blob, filename || buildCertificateFilename(registro));

      if (data.emailSent) {
        setStatus(`Certificado descargado y enviado para ${nombre}.`);
      } else if (data.emailMessage) {
        setStatus(`Certificado descargado para ${nombre}. Email: ${data.emailMessage}`, true);
      } else {
        setStatus(`Certificado descargado para ${nombre}.`);
      }
    } catch (error) {
      setStatus(`No se pudo procesar el certificado de ${nombre}: ${error.message || error}`, true);
    }
  }
}

async function appendToGoogleSheets(records) {
  const endpoint = SHEETS_APPEND_URL || "/api/inscripciones/append";

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      mode: SHEETS_APPEND_URL ? "no-cors" : "cors",
      headers: {
        "Content-Type": "text/plain;charset=UTF-8",
      },
      body: JSON.stringify({ records, appSecret: APP_SECRET }),
    });

    if (SHEETS_APPEND_URL) {
      if (response.type === "opaque") {
        setStatus(`Guardado local y enviado a Google Sheets (${records.length} fila(s)).`);
        refreshAllCupoStatuses();
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        const msg = data.error || "No se pudo escribir en Google Sheets";
        setStatus(`Guardado local OK. Sheets: ${msg}`, true);
        return;
      }

      const count = Number(data.count || records.length || 0);
      setStatus(`Guardado local y Google Sheets OK (${count} fila(s) agregadas).`);
      refreshAllCupoStatuses();
      return;
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      const msg = data.error || "No se pudo escribir en Google Sheets";
      setStatus(`Guardado local OK. Sheets: ${msg}`, true);
      return;
    }

    const count = Number(data.count || records.length || 0);
    setStatus(`Guardado local y Google Sheets OK (${count} fila(s) agregadas).`);
    refreshAllCupoStatuses();
  } catch (_error) {
    setStatus("Guardado local OK. Sheets no disponible (revisar URL de Apps Script).", true);
  }
}

function onResetFormulario() {
  window.setTimeout(() => {
    resetMaterias();
    setStatus("Formulario limpiado.");
  }, 0);
}

function onAgregarMateria() {
  dom.materiasContainer.insertAdjacentHTML("beforeend", materiaItemTemplate());
  refreshMateriaItemsUI();
}

function onMateriaContainerClick(event) {
  const removeBtn = event.target.closest(".remove-materia");
  if (!removeBtn) return;

  const item = removeBtn.closest("[data-materia-item]");
  if (!item) return;
  item.remove();
  refreshMateriaItemsUI();
}

function onMateriaContainerChange(event) {
  const item = event.target.closest("[data-materia-item]");
  if (!item) return;

  if (event.target.classList.contains("materia-anio")) {
    populateMateriaOptions(item);
    populateProfesorOptions(item);
    populateComisionOptions(item);
    updateTurnoHorario(item);
    void updateCupoStatus(item);
    return;
  }

  if (event.target.classList.contains("materia-nombre")) {
    populateProfesorOptions(item);
    populateComisionOptions(item);
    updateTurnoHorario(item);
    void updateCupoStatus(item);
    return;
  }

  if (event.target.classList.contains("materia-profesor")) {
    populateComisionOptions(item);
    updateTurnoHorario(item);
    void updateCupoStatus(item);
    return;
  }

  if (event.target.classList.contains("materia-comision")) {
    updateTurnoHorario(item);
    void updateCupoStatus(item);
  }
}

function resetMaterias() {
  const items = dom.materiasContainer.querySelectorAll("[data-materia-item]");
  items.forEach((item, index) => {
    if (index > 0) item.remove();
  });

  const first = dom.materiasContainer.querySelector("[data-materia-item]");
  if (!first) {
    dom.materiasContainer.insertAdjacentHTML("beforeend", materiaItemTemplate());
  }

  refreshMateriaItemsUI();
}

function refreshMateriaItemsUI() {
  const items = Array.from(dom.materiasContainer.querySelectorAll("[data-materia-item]"));
  items.forEach((item, index) => {
    const title = item.querySelector("h4");
    if (title) title.textContent = `Materia ${index + 1}`;

    const removeBtn = item.querySelector(".remove-materia");
    if (removeBtn) removeBtn.hidden = items.length === 1;

    hydrateMateriaItemOptions(item);
    void updateCupoStatus(item);
  });
}

function getMateriasDelFormulario() {
  const items = Array.from(dom.materiasContainer.querySelectorAll("[data-materia-item]"));
  const materias = [];
  let hasIncomplete = false;
  const projectedAdmissionsBySection = new Map();

  for (const item of items) {
    const catalogEntry = findCatalogEntryForItem(item);
    const materia = {
      anio: getValue(item, ".materia-anio"),
      materia: getValue(item, ".materia-nombre"),
      profesor: getValue(item, ".materia-profesor"),
      comision: getValue(item, ".materia-comision"),
      turno: getValue(item, ".materia-turno"),
      horario: getValue(item, ".materia-horario"),
      observaciones: getValue(item, ".materia-observaciones"),
      cupo: normalizeCupo(catalogEntry?.cupo),
    };

    const hasAnyValue = Object.values(materia).some((v) => String(v || "").trim() !== "");
    if (!hasAnyValue) continue;

    if (!materia.materia || !materia.profesor) {
      hasIncomplete = true;
      continue;
    }

    const localStatus = computeLocalCupoStatus(materia);
    const key = sectionKey(materia);
    const projectedAdmissions = projectedAdmissionsBySection.get(key) || 0;
    const cupo = Number.parseInt(String(materia.cupo || "").trim(), 10);
    const remainingNow = Number.isFinite(cupo) ? Math.max(0, (localStatus.restantes || 0) - projectedAdmissions) : null;
    const isWaitlist = Number.isFinite(cupo) ? remainingNow <= 0 : localStatus.lista_espera;

    materia.en_lista_espera = isWaitlist ? "Si" : "No";
    if (!isWaitlist) {
      projectedAdmissionsBySection.set(key, projectedAdmissions + 1);
    }

    materias.push(materia);
  }

  return { materias, hasIncomplete };
}

function materiaItemTemplate() {
  return `
    <article class="materia-item" data-materia-item>
      <div class="materia-item-head">
        <h4>Materia</h4>
        <button class="btn btn-small btn-danger remove-materia" type="button">Quitar</button>
      </div>
      <div class="field-grid">
        <label>Año
          <select class="materia-anio">
            <option value="">Seleccionar</option>
            <option>1</option>
            <option>2</option>
            <option>3</option>
            <option>4</option>
          </select>
        </label>
        <label>Materia
          <select class="materia-nombre" required>
            <option value="">Seleccionar año primero</option>
          </select>
        </label>
        <label>Profesor/a
          <select class="materia-profesor" required>
            <option value="">Seleccionar materia primero</option>
          </select>
        </label>
        <label>Comisión
          <select class="materia-comision">
            <option value="">Seleccionar profesor primero</option>
          </select>
        </label>
        <label>Cupo restante
          <input class="materia-cupo-restante" value="-" readonly>
        </label>
        <label>Turno<input class="materia-turno" placeholder="manana / tarde"></label>
        <label>Horario<input class="materia-horario"></label>
        <label class="span-2">Observaciones<textarea class="materia-observaciones" rows="2"></textarea></label>
      </div>
      <div class="cupo-status muted" data-cupo-status>Seleccioná año, materia, profesor y comisión para ver cupos.</div>
    </article>
  `;
}

function getValue(scope, selector) {
  const el = scope.querySelector(selector);
  return (el?.value || "").trim();
}

function hydrateMateriaItemOptions(item) {
  const selectedMateria = getValue(item, ".materia-nombre");
  const selectedProfesor = getValue(item, ".materia-profesor");
  const selectedComision = getValue(item, ".materia-comision");

  populateMateriaOptions(item, selectedMateria);
  populateProfesorOptions(item, selectedProfesor);
  populateComisionOptions(item, selectedComision);
  updateTurnoHorario(item);
}

function populateMateriaOptions(item, preferredValue = "") {
  const anio = getValue(item, ".materia-anio");
  const select = item.querySelector(".materia-nombre");
  if (!select) return;

  if (!anio) {
    setSelectOptions(select, [], "Seleccionar año primero", "");
    return;
  }

  const materias = sortedUnique(
    materiasCatalogo
      .filter((entry) => String(entry.anio || "") === String(anio))
      .map((entry) => entry.materia)
      .filter(Boolean)
  );

  const placeholder = materias.length ? "Seleccionar" : "Sin materias para ese año";
  setSelectOptions(select, materias, placeholder, preferredValue);
}

function populateProfesorOptions(item, preferredValue = "") {
  const anio = getValue(item, ".materia-anio");
  const materia = getValue(item, ".materia-nombre");
  const select = item.querySelector(".materia-profesor");
  if (!select) return;

  if (!anio || !materia) {
    setSelectOptions(select, [], "Seleccionar materia primero", "");
    return;
  }

  const profesores = sortedUnique(
    materiasCatalogo
      .filter(
        (entry) => String(entry.anio || "") === String(anio) && String(entry.materia || "") === String(materia)
      )
      .map((entry) => entry.profesor)
      .filter(Boolean)
  );

  const placeholder = profesores.length ? "Seleccionar" : "Sin profesores disponibles";
  setSelectOptions(select, profesores, placeholder, preferredValue);
}

function populateComisionOptions(item, preferredValue = "") {
  const anio = getValue(item, ".materia-anio");
  const materia = getValue(item, ".materia-nombre");
  const profesor = getValue(item, ".materia-profesor");
  const select = item.querySelector(".materia-comision");
  if (!select) return;

  if (!anio || !materia || !profesor) {
    setSelectOptions(select, [], "Seleccionar profesor primero", "");
    return;
  }

  const comisiones = sortedUnique(
    materiasCatalogo
      .filter(
        (entry) =>
          String(entry.anio || "") === String(anio) &&
          String(entry.materia || "") === String(materia) &&
          String(entry.profesor || "") === String(profesor)
      )
      .map((entry) => String(entry.comision || "").trim())
      .filter(Boolean)
  );

  const placeholder = comisiones.length ? "Seleccionar" : "(Sin comisión)";
  setSelectOptions(select, comisiones, placeholder, preferredValue);
}

function updateTurnoHorario(item) {
  const anio = getValue(item, ".materia-anio");
  const materia = getValue(item, ".materia-nombre");
  const profesor = getValue(item, ".materia-profesor");
  const comision = getValue(item, ".materia-comision");
  const turnoInput = item.querySelector(".materia-turno");
  const horarioInput = item.querySelector(".materia-horario");

  if (!turnoInput || !horarioInput) return;

  if (!anio || !materia || !profesor) {
    turnoInput.value = "";
    horarioInput.value = "";
    return;
  }

  const matches = materiasCatalogo.filter(
    (entry) =>
      String(entry.anio || "") === String(anio) &&
      String(entry.materia || "") === String(materia) &&
      String(entry.profesor || "") === String(profesor)
  );

  if (!matches.length) {
    turnoInput.value = "";
    horarioInput.value = "";
    return;
  }

  const selectedByComision = comision
    ? matches.find((entry) => String(entry.comision || "") === String(comision))
    : null;
  const picked = selectedByComision || matches[0];

  const turno = String(picked.turno || "").trim();
  const horario = String(picked.horario || "").trim();

  turnoInput.value = turno;
  horarioInput.value = horario || (turno ? `Turno: ${turno}` : "");
}

function setSelectOptions(selectEl, values, placeholder, preferredValue = "") {
  const selected = preferredValue || selectEl.value;
  selectEl.innerHTML = [`<option value="">${escapeHtml(placeholder)}</option>`]
    .concat(values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`))
    .join("");

  if (selected && values.includes(selected)) {
    selectEl.value = selected;
  } else {
    selectEl.value = "";
  }
}

function initConfigCatalogEditor() {
  renderCatalogTable();
  updateCatalogAuthUi();
}

function autenticarEdicionCatalogo() {
  const pin = window.prompt("Ingresa la clave numerica para editar el catalogo:");
  if (pin === "6003") {
    catalogUnlocked = true;
    updateCatalogAuthUi();
    renderCatalogTable();
    setStatus("Edicion habilitada para el catalogo.");
    return;
  }

  catalogUnlocked = false;
  updateCatalogAuthUi();
  setStatus("Clave incorrecta. Catalogo bloqueado.", true);
}

function borrarHistorial() {
  const pin = window.prompt("Ingresa la clave numerica para borrar el historial:");
  if (pin !== "6003") {
    setStatus("Clave incorrecta. No se borro el historial.", true);
    return;
  }

  const ok = window.confirm("Se borrara todo el historial local de inscripciones. ¿Continuar?");
  if (!ok) return;

  registros = [];
  historialSeleccionadoId = "";
  persistRegistros();
  renderHistorial();
  setStatus("Historial local borrado.");
}

function updateCatalogAuthUi() {
  if (!dom.catalogAuthStatus) return;
  dom.catalogAuthStatus.textContent = catalogUnlocked ? "Desbloqueado" : "Bloqueado";
  dom.catalogAuthStatus.classList.toggle("is-unlocked", catalogUnlocked);
  dom.catalogAuthStatus.classList.toggle("is-locked", !catalogUnlocked);
}

function renderCatalogTable() {
  if (!dom.catalogTableBody) return;

  const filteredRows = getFilteredCatalogRows();

  if (!filteredRows.length) {
    dom.catalogTableBody.innerHTML = `
      <tr>
        <td colspan="8" class="catalog-empty">No hay resultados para ese filtro.</td>
      </tr>
    `;
    return;
  }

  dom.catalogTableBody.innerHTML = filteredRows
    .map(({ row, index }) => catalogRowTemplate(row, index, !catalogUnlocked))
    .join("");
}

function getFilteredCatalogRows() {
  const q = String(dom.catalogSearchInput?.value || "").trim().toLowerCase();

  const rows = materiasCatalogo.length
    ? materiasCatalogo.map((row, index) => ({ row, index }))
    : [{ row: { anio: "", materia: "", profesor: "", comision: "", turno: "", horario: "", cupo: "" }, index: 0 }];

  if (!q) return rows;

  return rows.filter(({ row }) => {
    const text = [
      row.anio,
      row.materia,
      row.profesor,
      row.comision,
      row.turno,
      row.horario,
      row.cupo,
    ]
      .map((v) => String(v || ""))
      .join(" ")
      .toLowerCase();

    return text.includes(q);
  });
}

function catalogRowTemplate(row, index, locked) {
  const rowEditing = Boolean(row.__editing);
  const disabled = locked || !rowEditing ? "disabled" : "";
  const actionDisabled = locked ? "disabled" : "";
  const cupoValue = row.cupo === null || row.cupo === undefined ? "" : String(row.cupo);

  const actionsHtml = rowEditing
    ? `
      <button class="btn btn-small" data-action="save-row" ${actionDisabled}>Guardar</button>
      <button class="btn btn-small" data-action="cancel-edit-row" ${actionDisabled}>Cancelar</button>
      <button class="btn btn-small btn-danger" data-action="delete-row" ${actionDisabled}>Eliminar</button>
    `
    : `
      <button class="btn btn-small" data-action="edit-row" ${actionDisabled}>Modificar</button>
      <button class="btn btn-small btn-danger" data-action="delete-row" ${actionDisabled}>Eliminar</button>
    `;

  return `
    <tr data-row-index="${index}">
      <td>
        <select data-col="anio" ${disabled}>
          <option value="" ${row.anio === "" ? "selected" : ""}>-</option>
          <option value="1" ${String(row.anio) === "1" ? "selected" : ""}>1</option>
          <option value="2" ${String(row.anio) === "2" ? "selected" : ""}>2</option>
          <option value="3" ${String(row.anio) === "3" ? "selected" : ""}>3</option>
          <option value="4" ${String(row.anio) === "4" ? "selected" : ""}>4</option>
        </select>
      </td>
      <td><input data-col="materia" value="${escapeAttr(row.materia)}" ${disabled}></td>
      <td><input data-col="profesor" value="${escapeAttr(row.profesor)}" ${disabled}></td>
      <td><input data-col="comision" value="${escapeAttr(row.comision)}" ${disabled}></td>
      <td><input data-col="turno" value="${escapeAttr(row.turno)}" ${disabled}></td>
      <td><input data-col="horario" value="${escapeAttr(row.horario)}" ${disabled}></td>
      <td><input data-col="cupo" value="${escapeAttr(cupoValue)}" inputmode="numeric" ${disabled}></td>
      <td class="row-actions">${actionsHtml}</td>
    </tr>
  `;
}

function onCatalogTableClick(event) {
  const btn = event.target.closest("button[data-action]");
  if (!btn) return;

  if (!catalogUnlocked) {
    setStatus("Debes autenticarte para modificar el catalogo.", true);
    return;
  }

  const row = btn.closest("tr[data-row-index]");
  if (!row) return;

  const idx = Number(row.dataset.rowIndex);
  const action = btn.dataset.action;
  const target = materiasCatalogo[idx];
  if (!target) return;

  if (action === "edit-row") {
    target.__editing = true;
    target.__backup = getCatalogRowSnapshot(target);
    renderCatalogTable();
    return;
  }

  if (action === "save-row") {
    const saneado = {
      anio: normalizeAnio(target.anio),
      materia: String(target.materia || "").trim(),
      profesor: String(target.profesor || "").trim(),
      comision: String(target.comision || "").trim(),
      turno: String(target.turno || "").trim(),
      horario: String(target.horario || "").trim(),
      cupo: normalizeCupo(target.cupo),
    };

    if (!saneado.anio || !saneado.materia || !saneado.profesor) {
      setStatus("Para guardar la fila necesitas Año, Materia y Profesor/a.", true);
      return;
    }

    Object.assign(target, saneado, { __editing: false });
    delete target.__backup;
    renderCatalogTable();
    setStatus("Fila actualizada. Usa Guardar cambios para persistir todo el catalogo.");
    return;
  }

  if (action === "cancel-edit-row") {
    if (target.__backup) {
      Object.assign(target, target.__backup);
      delete target.__backup;
    }
    target.__editing = false;
    renderCatalogTable();
    setStatus("Edicion de fila cancelada.");
    return;
  }

  if (action === "delete-row") {
    materiasCatalogo.splice(idx, 1);
    renderCatalogTable();
  }
}

function onCatalogTableInput(event) {
  if (!catalogUnlocked) return;

  const input = event.target.closest("[data-col]");
  const row = event.target.closest("tr[data-row-index]");
  if (!input || !row) return;

  const idx = Number(row.dataset.rowIndex);
  const col = input.dataset.col;
  const value = (input.value || "").trim();

  if (!materiasCatalogo[idx] || !materiasCatalogo[idx].__editing) return;
  materiasCatalogo[idx][col] = col === "cupo" ? normalizeCupo(value) : value;
}

function getCatalogRowSnapshot(row) {
  return {
    anio: normalizeAnio(row.anio),
    materia: String(row.materia || "").trim(),
    profesor: String(row.profesor || "").trim(),
    comision: String(row.comision || "").trim(),
    turno: String(row.turno || "").trim(),
    horario: String(row.horario || "").trim(),
    cupo: normalizeCupo(row.cupo),
  };
}

function agregarFilaCatalogo() {
  if (!catalogUnlocked) {
    setStatus("Debes autenticarte para agregar filas.", true);
    return;
  }

  materiasCatalogo.push({ anio: "", materia: "", profesor: "", comision: "", turno: "", horario: "", cupo: "" });
  renderCatalogTable();
}

function guardarCatalogo() {
  if (!catalogUnlocked) {
    setStatus("Debes autenticarte para guardar cambios del catalogo.", true);
    return;
  }

  const saneado = materiasCatalogo
    .map((row) => ({
      anio: normalizeAnio(row.anio),
      materia: String(row.materia || "").trim(),
      profesor: String(row.profesor || "").trim(),
      comision: String(row.comision || "").trim(),
      turno: String(row.turno || "").trim(),
      horario: String(row.horario || "").trim(),
      cupo: normalizeCupo(row.cupo),
    }))
    .filter((row) => row.anio && row.materia && row.profesor);

  if (!saneado.length) {
    setStatus("No hay filas validas para guardar. Minimo: Año, Materia y Profesor/a.", true);
    return;
  }

  materiasCatalogo = dedupeCatalog(saneado);
  localStorage.setItem(CATALOGO_KEY, JSON.stringify(materiasCatalogo));
  renderCatalogTable();
  refreshMateriaItemsUI();
  setStatus(`Catalogo guardado: ${materiasCatalogo.length} filas.`);
}

function restaurarCatalogoBase() {
  if (!catalogUnlocked) {
    setStatus("Debes autenticarte para restaurar el catalogo base.", true);
    return;
  }

  const ok = window.confirm("Se perderan los cambios locales del catalogo. ¿Continuar?");
  if (!ok) return;

  localStorage.removeItem(CATALOGO_KEY);
  materiasCatalogo = cloneCatalogRows(baseCatalogo);
  renderCatalogTable();
  refreshMateriaItemsUI();
  setStatus("Catalogo base restaurado.");
}

function loadCatalogoEditable(base) {
  const parsed = safeJsonParse(localStorage.getItem(CATALOGO_KEY), null);
  if (!Array.isArray(parsed)) {
    return cloneCatalogRows(base);
  }

  const rows = parsed
    .map((row) => ({
      anio: normalizeAnio(row.anio),
      materia: String(row.materia || "").trim(),
      profesor: String(row.profesor || "").trim(),
      comision: String(row.comision || "").trim(),
      turno: String(row.turno || "").trim(),
      horario: String(row.horario || "").trim(),
      cupo: normalizeCupo(row.cupo),
    }))
    .filter((row) => row.anio && row.materia && row.profesor);

  return rows.length ? dedupeCatalog(rows) : cloneCatalogRows(base);
}

function cloneCatalogRows(rows) {
  return rows.map((row) => ({
    anio: normalizeAnio(row.anio),
    materia: String(row.materia || "").trim(),
    profesor: String(row.profesor || "").trim(),
    comision: String(row.comision || "").trim(),
    turno: String(row.turno || "").trim(),
    horario: String(row.horario || "").trim(),
    cupo: normalizeCupo(row.cupo),
  }));
}

function renderHistorial() {
  if (!dom.historialTableBody || !dom.historialResultado) return;

  const q = String(dom.historialSearch?.value || "").trim().toLowerCase();

  const rows = registros
    .slice()
    .sort((a, b) => {
      const da = new Date(a.fecha_inscripcion || 0).valueOf();
      const db = new Date(b.fecha_inscripcion || 0).valueOf();
      return db - da;
    })
    .filter((r) => {
      if (!q) return true;
      const d = new Date(r.fecha_inscripcion || "");
      const fecha = Number.isNaN(d.valueOf()) ? "" : d.toLocaleDateString("es-AR");
      const hora = Number.isNaN(d.valueOf()) ? "" : d.toLocaleTimeString("es-AR", { hour12: false });
      const text = [
        fecha,
        hora,
        r.nombre,
        r.apellido,
        r.dni,
        r.materia,
        r.profesor,
        r.comision,
        r.anio,
      ]
        .map((v) => String(v || ""))
        .join(" ")
        .toLowerCase();
      return text.includes(q);
    });

  if (!rows.length) {
    dom.historialTableBody.innerHTML = `
      <tr>
        <td colspan="9" class="catalog-empty">No hay inscripciones para el filtro actual.</td>
      </tr>
    `;
    dom.historialResultado.textContent = "Total: 0 inscripciones";
    updateHistorialActionState();
    return;
  }

  dom.historialTableBody.innerHTML = rows
    .map((r) => {
      const d = new Date(r.fecha_inscripcion || "");
      const fecha = Number.isNaN(d.valueOf()) ? "N/A" : d.toLocaleDateString("es-AR");
      const hora = Number.isNaN(d.valueOf())
        ? "N/A"
        : d.toLocaleTimeString("es-AR", { hour12: false });
      return `
        <tr data-record-id="${escapeHtml(String(r.id || ""))}" class="${String(r.id || "") === String(historialSeleccionadoId) ? "is-selected" : ""}">
          <td>${escapeHtml(fecha)}</td>
          <td>${escapeHtml(hora)}</td>
          <td>${escapeHtml(r.nombre || "")}</td>
          <td>${escapeHtml(r.apellido || "")}</td>
          <td>${escapeHtml(r.dni || "")}</td>
          <td>${escapeHtml(r.materia || "")}</td>
          <td>${escapeHtml(r.profesor || "")}</td>
          <td>${escapeHtml(r.comision || "")}</td>
          <td>${escapeHtml(r.anio || "")}</td>
        </tr>
      `;
    })
    .join("");

  dom.historialResultado.textContent = `Total: ${rows.length} inscripciones`;
  updateHistorialActionState();
}

function onHistorialTableClick(event) {
  const row = event.target.closest("tr[data-record-id]");
  if (!row) return;

  selectHistorialRecord(row.dataset.recordId || "");
}

function onHistorialTableDoubleClick(event) {
  const row = event.target.closest("tr[data-record-id]");
  if (!row) return;

  selectHistorialRecord(row.dataset.recordId || "");
  void descargarCertificadoSeleccionado();
}

function selectHistorialRecord(recordId) {
  historialSeleccionadoId = String(recordId || "").trim();

  if (!dom.historialTableBody) return;

  dom.historialTableBody.querySelectorAll("tr[data-record-id]").forEach((row) => {
    row.classList.toggle("is-selected", String(row.dataset.recordId || "") === historialSeleccionadoId);
  });

  updateHistorialActionState();
}

function updateHistorialActionState() {
  const selectedId = String(historialSeleccionadoId || "").trim();
  const hasSelected = Boolean(
    selectedId &&
      dom.historialTableBody &&
      Array.from(dom.historialTableBody.querySelectorAll("tr[data-record-id]")).some(
        (row) => String(row.dataset.recordId || "") === selectedId
      )
  );
  if (dom.downloadCertBtn) dom.downloadCertBtn.disabled = !hasSelected;
  if (dom.sendCertBtn) dom.sendCertBtn.disabled = !hasSelected;
}

function getSelectedHistorialRecord() {
  const selectedId = String(historialSeleccionadoId || "").trim();
  if (!selectedId) return null;
  return registros.find((registro) => String(registro.id || "") === selectedId) || null;
}

async function onDescargarCertificadoSeleccionado() {
  const record = getSelectedHistorialRecord();
  if (!record) {
    setStatus("Seleccioná un registro del historial para descargar el certificado.", true);
    return;
  }

  await descargarCertificadoSeleccionado(record);
}

async function onEnviarCertificadoSeleccionado() {
  const record = getSelectedHistorialRecord();
  if (!record) {
    setStatus("Seleccioná un registro del historial para enviar el certificado.", true);
    return;
  }

  await enviarCertificadoSeleccionado(record);
}

async function descargarCertificadoSeleccionado(record = null) {
  const registro = record || getSelectedHistorialRecord();
  if (!registro) return;

  const endpoint = buildCertificateEndpoint("/api/certificados/download");

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      mode: CERTIFICATE_API_BASE ? "cors" : "same-origin",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ record: registro, appSecret: APP_SECRET }),
    });

    const contentType = String(response.headers.get("Content-Type") || "").toLowerCase();
    if (!response.ok || contentType.includes("application/json")) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "No se pudo generar el certificado.");
    }

    const blob = await response.blob();
    const filename = filenameFromDisposition(
      response.headers.get("Content-Disposition") || "",
      buildCertificateFilename(registro)
    );

    triggerBlobDownload(blob, filename);
    setStatus(`Certificado descargado: ${filename}`);
  } catch (error) {
    setStatus(`No se pudo descargar el certificado: ${error.message || error}`, true);
  }
}

async function enviarCertificadoSeleccionado(record = null) {
  const registro = record || getSelectedHistorialRecord();
  if (!registro) return;

  const endpoint = buildCertificateEndpoint("/api/certificados/send");

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      mode: CERTIFICATE_API_BASE ? "cors" : "same-origin",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ record: registro, appSecret: APP_SECRET }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "No se pudo enviar el certificado.");
    }

    setStatus(`Certificado enviado a ${registro.email}.`);
  } catch (error) {
    setStatus(`No se pudo enviar el certificado: ${error.message || error}`, true);
  }
}

function buildCertificateEndpoint(path) {
  if (!CERTIFICATE_API_BASE) return path;
  return new URL(path, CERTIFICATE_API_BASE).toString();
}

function getCertificateApiBase() {
  const runtime = String(window.WEB_RUNTIME_CONFIG?.certificateApiBase || "").trim();
  if (runtime) return runtime;

  const configured = String(window.WEB_CONFIG?.certificateApiBase || "").trim();
  if (configured) return configured;

  const origin = String(window.location?.origin || "").trim();
  if (origin && origin !== "null") return origin;

  return "";
}

function buildCertificateFilename(record) {
  const apellido = sanitizeFilenamePart(record?.apellido || "apellido");
  const nombre = sanitizeFilenamePart(record?.nombre || "nombre");
  const legajo = sanitizeFilenamePart(record?.legajo || record?.dni || record?.id || "registro");
  const fecha = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `certificado_${apellido}_${nombre}_${legajo}_${fecha}.pdf`;
}

function filenameFromDisposition(disposition, fallback) {
  const match = String(disposition || "").match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
  const value = match ? decodeURIComponent(match[1] || match[2] || "") : "";
  return value || fallback;
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
    link.remove();
  }, 0);
}

function sanitizeFilenamePart(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_-]/g, "");
}

async function updateCupoStatus(item) {
  const statusEl = item.querySelector("[data-cupo-status]");
  const remainingInput = item.querySelector(".materia-cupo-restante");
  if (!statusEl) return;

  const selection = findCatalogEntryForItem(item);
  if (!selection) {
    statusEl.textContent = "Seleccioná año, materia, profesor y comisión para ver cupos.";
    if (remainingInput) remainingInput.value = "-";
    applyCupoVisualState(item, "neutral");
    return;
  }

  const cupo = normalizeCupo(selection.cupo);
  if (!cupo) {
    statusEl.textContent = "Esta comisión no tiene cupo configurado.";
    if (remainingInput) remainingInput.value = "Sin cupo";
    applyCupoVisualState(item, "neutral");
    return;
  }

  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  item.dataset.cupoRequestId = requestId;
  statusEl.textContent = "Consultando cupos centrales...";

  try {
    const status = SHEETS_APPEND_URL
      ? await fetchRemoteCupoStatus({ ...selection, cupo })
      : computeLocalCupoStatus({ ...selection, cupo });

    if (item.dataset.cupoRequestId !== requestId) return;

    if (!status.ok) {
      statusEl.textContent = status.error || "No se pudo consultar el cupo.";
      if (remainingInput) remainingInput.value = "Error";
      applyCupoVisualState(item, "error");
      return;
    }

    const partes = [`Cupo total: ${status.cupo}`];
    if (status.restantes !== null && status.restantes !== undefined) {
      partes.push(`restan ${status.restantes}`);
    }
    if (status.lista_espera) {
      partes.push("nuevas altas pasarán a lista de espera");
    }
    statusEl.textContent = partes.join(" - ");
    if (remainingInput) {
      remainingInput.value = status.restantes === null || status.restantes === undefined
        ? "-"
        : String(status.restantes);
    }

    const restantes = Number(status.restantes);
    const hasNumericRestantes = Number.isFinite(restantes);
    if (!hasNumericRestantes) {
      applyCupoVisualState(item, "neutral");
    } else if (restantes <= 0 || status.lista_espera) {
      applyCupoVisualState(item, "danger");
    } else if (restantes === 1) {
      applyCupoVisualState(item, "warn");
    } else {
      applyCupoVisualState(item, "ok");
    }
  } catch (_error) {
    if (item.dataset.cupoRequestId !== requestId) return;
    statusEl.textContent = "No se pudo consultar el cupo central en este momento.";
    if (remainingInput) remainingInput.value = "Error";
    applyCupoVisualState(item, "error");
  }
}

function applyCupoVisualState(item, state) {
  const statusEl = item.querySelector("[data-cupo-status]");
  const remainingInput = item.querySelector(".materia-cupo-restante");
  const states = ["is-ok", "is-warn", "is-danger", "is-neutral", "is-error"];

  if (statusEl) statusEl.classList.remove(...states);
  if (remainingInput) remainingInput.classList.remove(...states);

  const className = {
    ok: "is-ok",
    warn: "is-warn",
    danger: "is-danger",
    neutral: "is-neutral",
    error: "is-error",
  }[state] || "is-neutral";

  if (statusEl) statusEl.classList.add(className);
  if (remainingInput) remainingInput.classList.add(className);
}

function refreshAllCupoStatuses() {
  const items = Array.from(dom.materiasContainer.querySelectorAll("[data-materia-item]"));
  items.forEach((item) => {
    void updateCupoStatus(item);
  });
}

function findCatalogEntryForItem(item) {
  const anio = getValue(item, ".materia-anio");
  const materia = getValue(item, ".materia-nombre");
  const profesor = getValue(item, ".materia-profesor");
  const comision = getValue(item, ".materia-comision");

  if (!anio || !materia || !profesor) return null;

  const matches = materiasCatalogo.filter(
    (entry) =>
      String(entry.anio || "") === String(anio) &&
      String(entry.materia || "") === String(materia) &&
      String(entry.profesor || "") === String(profesor)
  );

  if (!matches.length) return null;
  if (comision) {
    return matches.find((entry) => String(entry.comision || "") === String(comision)) || matches[0];
  }
  return matches.length === 1 ? matches[0] : null;
}

function computeLocalCupoStatus(selection) {
  const key = sectionKey(selection);
  const cupo = Number.parseInt(String(selection.cupo || "").trim(), 10);

  if (!Number.isFinite(cupo)) {
    return { ok: true, cupo: String(selection.cupo || ""), ocupados: null, restantes: null, lista_espera: false };
  }

  const ocupados = registros.reduce((count, registro) => {
    if (sectionKey(registro) !== key) return count;
    if (isWaitlistValue(registro.en_lista_espera)) return count;
    return count + 1;
  }, 0);

  const restantes = Math.max(0, cupo - ocupados);
  return {
    ok: true,
    cupo,
    ocupados,
    restantes,
    lista_espera: restantes === 0,
  };
}

async function fetchRemoteCupoStatus(selection) {
  const callbackName = `tapCupoStatus_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const url = new URL(SHEETS_APPEND_URL);
  url.searchParams.set("action", "status");
  url.searchParams.set("anio", selection.anio || "");
  url.searchParams.set("materia", selection.materia || "");
  url.searchParams.set("profesor", selection.profesor || "");
  url.searchParams.set("comision", selection.comision || "");
  url.searchParams.set("cupo", String(selection.cupo || ""));
  if (APP_SECRET) {
    url.searchParams.set("appSecret", APP_SECRET);
  }
  url.searchParams.set("callback", callbackName);

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("timeout"));
    }, 8000);

    function cleanup() {
      window.clearTimeout(timeoutId);
      if (script.parentNode) script.parentNode.removeChild(script);
      try {
        delete window[callbackName];
      } catch {
        window[callbackName] = undefined;
      }
    }

    window[callbackName] = (payload) => {
      cleanup();
      resolve(payload || {});
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("load-error"));
    };

    script.src = url.toString();
    document.head.appendChild(script);
  });
}

async function fetchRemoteEmitCertificate(record) {
  const callbackName = `tapCertEmit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const url = new URL(SHEETS_APPEND_URL);
  url.searchParams.set("action", "emit_certificate");
  url.searchParams.set("record", encodeRecordForQuery(record));
  if (APP_SECRET) {
    url.searchParams.set("appSecret", APP_SECRET);
  }
  url.searchParams.set("callback", callbackName);

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("timeout"));
    }, 15000);

    function cleanup() {
      window.clearTimeout(timeoutId);
      if (script.parentNode) script.parentNode.removeChild(script);
      try {
        delete window[callbackName];
      } catch {
        window[callbackName] = undefined;
      }
    }

    window[callbackName] = (payload) => {
      cleanup();
      resolve(payload || {});
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("load-error"));
    };

    script.src = url.toString();
    document.head.appendChild(script);
  });
}

function encodeRecordForQuery(record) {
  const json = JSON.stringify(record || {});
  const encoded = btoa(unescape(encodeURIComponent(json)));
  return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64ToBlob(base64, mimeType = "application/octet-stream") {
  const normalized = String(base64 || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

function sectionKey(row) {
  return [row.anio, row.materia, row.profesor, row.comision].map((value) => String(value || "").trim()).join("||");
}

function isWaitlistValue(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "si" || normalized === "sí";
}

function getNextNumericId() {
  const maxId = registros.reduce((max, registro) => {
    const current = Number.parseInt(registro.id, 10);
    return Number.isFinite(current) && current > max ? current : max;
  }, 0);
  return maxId + 1;
}

function formatBirthDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${day}-${month}-${year}`;
  }

  const slashMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (slashMatch) {
    const [, day, month, year] = slashMatch;
    return `${day}-${month}-${year}`;
  }

  const dashMatch = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dashMatch) return raw;

  return raw;
}

function loadRegistros() {
  return safeJsonParse(localStorage.getItem(STORAGE_KEY), []);
}

function persistRegistros() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(registros));
}

function sortedUnique(items) {
  return Array.from(new Set(items)).sort((a, b) => a.localeCompare(b, "es"));
}

function setStatus(msg, isError = false) {
  dom.statusBar.textContent = msg;
  dom.statusBar.style.borderColor = isError ? "#7b2525" : "#2d4558";
  dom.statusBar.style.color = isError ? "#fecaca" : "#b6c8d8";
}

function formatDate(iso) {
  if (!iso) return "N/A";
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return "N/A";
  return d.toLocaleDateString("es-AR");
}

function safeJsonParse(raw, fallback) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function normalizeMateriasCatalog(source) {
  if (Array.isArray(source)) {
    return dedupeCatalog(
      source.map((entry) => ({
        anio: normalizeAnio(entry.año ?? entry.anio),
        materia: String(entry.materia || "").trim(),
        profesor: String(entry.profesor || "").trim(),
        comision: String(entry.comision || "").trim(),
        turno: String(entry.turno || "").trim(),
        horario: String(entry.horario || "").trim(),
        cupo: normalizeCupo(entry.cupo ?? entry.capacity),
      }))
    );
  }

  if (!source || typeof source !== "object") {
    return [];
  }

  const out = [];

  for (const [materia, meta] of Object.entries(source)) {
    const yearsRaw = Array.isArray(meta?.years)
      ? meta.years
      : meta?.years != null
      ? [meta.years]
      : [];
    const years = yearsRaw.length ? yearsRaw.map((y) => normalizeAnio(y)).filter(Boolean) : [""];

    const professorsObj = meta?.professors && typeof meta.professors === "object" ? meta.professors : {};
    const professorNames = Object.keys(professorsObj);
    const commissionsObj = meta?.commissions && typeof meta.commissions === "object" ? meta.commissions : {};
    const commissionEntries = Object.entries(commissionsObj);
    const profList = professorNames.length ? professorNames : [""];

    for (const anio of years) {
      for (const profesor of profList) {
        const turnos = Array.isArray(professorsObj?.[profesor]?.turnos) ? professorsObj[profesor].turnos : [];
        const turno = turnos[0] ? String(turnos[0]) : "";
        const profHorario = String(professorsObj?.[profesor]?.horario || "").trim();
        const metaHorario = String(meta?.horario || "").trim();

        let pushedByCommission = false;
        for (const [comision, commissionMeta] of commissionEntries) {
          const assigned = normalizeAssignedProfessors(commissionMeta);
          if (assigned.length && profesor && !assigned.includes(profesor)) {
            continue;
          }

          const commissionHorario = String(
            commissionMeta && typeof commissionMeta === "object" ? commissionMeta.horario || "" : ""
          ).trim();
          const cupo = commissionMeta && typeof commissionMeta === "object"
            ? normalizeCupo(commissionMeta.capacity ?? commissionMeta.cupo)
            : "";

          out.push({
            anio,
            materia: String(materia || "").trim(),
            profesor: String(profesor || "").trim(),
            comision: String(comision || "").trim(),
            turno,
            horario: commissionHorario || profHorario || metaHorario,
            cupo,
          });
          pushedByCommission = true;
        }

        if (!pushedByCommission) {
          out.push({
            anio,
            materia: String(materia || "").trim(),
            profesor: String(profesor || "").trim(),
            comision: "",
            turno,
            horario: profHorario || metaHorario,
            cupo: normalizeCupo(meta?.capacity ?? meta?.cupo),
          });
        }
      }
    }
  }

  return dedupeCatalog(out);
}

function normalizeAssignedProfessors(commissionMeta) {
  if (!commissionMeta || typeof commissionMeta !== "object") return [];
  if (typeof commissionMeta.professor === "string" && commissionMeta.professor.trim()) {
    return [commissionMeta.professor.trim()];
  }
  if (Array.isArray(commissionMeta.professors)) {
    return commissionMeta.professors.map((p) => String(p || "").trim()).filter(Boolean);
  }
  return [];
}

function normalizeAnio(raw) {
  if (raw == null || raw === "") return "";
  return String(raw).trim();
}

function normalizeCupo(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === "") return "";
  const n = Number(raw);
  if (Number.isFinite(n)) {
    return String(Math.max(0, Math.trunc(n)));
  }
  return String(raw).trim();
}

function dedupeCatalog(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    if (!row.anio || !row.materia || !row.profesor) continue;
    const key = [row.anio, row.materia, row.profesor, row.comision, row.turno, row.horario, row.cupo].join("||");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function escapeHtml(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(input) {
  return escapeHtml(input ?? "");
}
