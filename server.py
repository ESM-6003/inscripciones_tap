"""Servidor local para Web Migracion + append-only a Google Sheets.

Uso:
  python web_migracion/server.py

Sirve archivos estaticos de web_migracion y expone:
  - GET /api/health
  - POST /api/inscripciones/append

Importante: este modulo solo agrega filas en Google Sheets (no borra ni reemplaza).
"""

from __future__ import annotations

import json
import os
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Tuple
from urllib.parse import urlparse

from config.settings import CSV_FIELDS, settings
from services.email_service import get_smtp_config, send_certificado_via_email
from services.pdf_generator import generar_certificado_pdf

WEB_SHEETS_FIELDS = CSV_FIELDS.copy()
if "genero" not in WEB_SHEETS_FIELDS:
    try:
        insert_at = WEB_SHEETS_FIELDS.index("apellido") + 1
    except ValueError:
        insert_at = 0
    WEB_SHEETS_FIELDS.insert(insert_at, "genero")
from services.google_sheets import get_sheets_service

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_HOST = "0.0.0.0"
DEFAULT_PORT = 8765
CANONICAL_WEB_BASE_URL = os.environ.get("WEB_MIGRACION_CANONICAL_BASE_URL", "").strip()


def _resolve_sheet_config() -> Tuple[str, str]:
    sheet_id = (
        settings.get("google_sheets.sheet_key", "")
        or settings.get("google_sheets.spreadsheet_id", "")
        or settings.get("spreadsheet_id", "")
    )
    sheet_name = settings.get("google_sheets.sheet_name", "") or "Inscripciones"
    if not sheet_id:
        raise RuntimeError("No hay spreadsheet_id/sheet_key configurado en data/config.json")
    return str(sheet_id).strip(), str(sheet_name).strip()


def _rows_from_records(records: List[Dict[str, Any]]) -> List[List[Any]]:
    rows: List[List[Any]] = []
    for rec in records:
        row = [rec.get(field, "") for field in WEB_SHEETS_FIELDS]
        rows.append(row)
    return rows


def append_records_to_sheets(records: List[Dict[str, Any]]) -> Tuple[bool, str]:
    if not records:
        return False, "No hay registros para enviar"

    service, err = get_sheets_service()
    if err:
        return False, err
    if service is None:
        return False, "No se pudo inicializar el cliente de Google Sheets"

    sheet_id, sheet_name = _resolve_sheet_config()
    rows = _rows_from_records(records)

    # Append-only: no clear, no delete, no update destructivo.
    body = {"values": rows}
    service.spreadsheets().values().append(
        spreadsheetId=sheet_id,
        range=f"'{sheet_name}'!A1",
        valueInputOption="RAW",
        insertDataOption="INSERT_ROWS",
        body=body,
    ).execute()

    return True, f"Se agregaron {len(rows)} fila(s) en Google Sheets"


class WebHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, directory: str | None = None, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header(
            "Access-Control-Expose-Headers",
            "Content-Disposition, Content-Type, Content-Length, X-Certificate-Email-OK, X-Certificate-Email-Message",
        )
        super().end_headers()

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            self._send_json(HTTPStatus.OK, {"ok": True, "service": "web_migracion_server"})
            return
        if parsed.path == "/runtime-config.js":
            self._send_runtime_config()
            return
        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/api/inscripciones/append":
            self._handle_append_inscripciones()
            return
        if parsed.path == "/api/certificados/download":
            self._handle_download_certificado()
            return
        if parsed.path == "/api/certificados/emit":
            self._handle_emit_certificado()
            return
        if parsed.path == "/api/certificados/send":
            self._handle_send_certificado()
            return

        self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "Endpoint no encontrado"})

    def _handle_append_inscripciones(self) -> None:
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(content_length) if content_length > 0 else b"{}"
            payload = json.loads(raw.decode("utf-8")) if raw else {}

            records: List[Dict[str, Any]] = []
            if isinstance(payload, dict):
                recs = payload.get("records")
                rec = payload.get("record")
                if isinstance(recs, list):
                    records = [r for r in recs if isinstance(r, dict)]
                elif isinstance(rec, dict):
                    records = [rec]
            if not records:
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Payload invalido. Usa record o records"})
                return

            ok, msg = append_records_to_sheets(records)
            if not ok:
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": msg})
                return

            self._send_json(HTTPStatus.OK, {"ok": True, "message": msg, "count": len(records)})
        except Exception as exc:  # pragma: no cover
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(exc)})

    def _handle_download_certificado(self) -> None:
        try:
            payload = self._read_json_payload()
            record = self._extract_record(payload)
            if not record:
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Payload invalido. Usa record"})
                return

            ok, result = generar_certificado_pdf(record)
            if not ok:
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(result)})
                return

            self._send_pdf_file(Path(result))
        except Exception as exc:  # pragma: no cover
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(exc)})

    def _handle_emit_certificado(self) -> None:
        try:
            payload = self._read_json_payload()
            record = self._extract_record(payload)
            if not record:
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Payload invalido. Usa record"})
                return

            ok, result = generar_certificado_pdf(record)
            if not ok:
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(result)})
                return

            pdf_path = Path(result)
            email_ok = False
            email_msg = ""
            if (record.get("email") or "").strip():
                smtp_cfg = get_smtp_config()
                if not smtp_cfg.get("username") or not smtp_cfg.get("password"):
                    email_msg = "SMTP no configurado (falta username/password)."
                else:
                    email_ok, email_msg = send_certificado_via_email(record, pdf_path, smtp_cfg)
            else:
                email_msg = "El registro no tiene email configurado."

            self._send_pdf_file(pdf_path, email_ok=email_ok, email_msg=email_msg)
        except Exception as exc:  # pragma: no cover
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(exc)})

    def _handle_send_certificado(self) -> None:
        try:
            payload = self._read_json_payload()
            record = self._extract_record(payload)
            if not record:
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Payload invalido. Usa record"})
                return

            ok_pdf, result_pdf = generar_certificado_pdf(record)
            if not ok_pdf:
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(result_pdf)})
                return

            smtp_cfg = get_smtp_config()
            ok_email, msg = send_certificado_via_email(record, result_pdf, smtp_cfg)
            if not ok_email:
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": msg})
                return

            self._send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "message": msg,
                    "pdf_path": str(result_pdf),
                },
            )
        except Exception as exc:  # pragma: no cover
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(exc)})

    def _send_pdf_file(self, pdf_path: Path, email_ok: bool | None = None, email_msg: str = "") -> None:
        data = pdf_path.read_bytes()
        filename = pdf_path.name

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/pdf")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        if email_ok is not None:
            self.send_header("X-Certificate-Email-OK", "true" if email_ok else "false")
            if email_msg:
                self.send_header("X-Certificate-Email-Message", email_msg)
        self.end_headers()
        self.wfile.write(data)

    def _read_json_payload(self) -> Dict[str, Any]:
        content_length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(content_length) if content_length > 0 else b"{}"
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def _extract_record(self, payload: Any) -> Dict[str, Any]:
        if not isinstance(payload, dict):
            return {}
        record = payload.get("record")
        if isinstance(record, dict):
            return record
        records = payload.get("records")
        if isinstance(records, list) and records and isinstance(records[0], dict):
            return records[0]
        return {}

    def _send_json(self, status: HTTPStatus, data: Dict[str, Any]) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_runtime_config(self) -> None:
        host = self.headers.get("Host", f"localhost:{DEFAULT_PORT}")
        scheme = "https" if self.headers.get("X-Forwarded-Proto", "http").lower() == "https" else "http"
        base_url = f"{scheme}://{host}"
        body = (
            "window.WEB_RUNTIME_CONFIG = "
            + json.dumps(
                {
                    "certificateApiBase": base_url,
                    "canonicalWebBaseUrl": CANONICAL_WEB_BASE_URL,
                },
                ensure_ascii=False,
            )
            + ";\n"
        ).encode("utf-8")

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/javascript; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    host = os.environ.get("WEB_MIGRACION_HOST", DEFAULT_HOST)
    port = int(os.environ.get("WEB_MIGRACION_PORT", str(DEFAULT_PORT)))

    httpd = ThreadingHTTPServer((host, port), WebHandler)
    print(f"[web_migracion] Servidor corriendo en http://{host}:{port}")
    if host == "0.0.0.0":
        print(f"[web_migracion] Acceso LAN: http://<IP_DE_ESTE_EQUIPO>:{port}")
    print("[web_migracion] API health: /api/health")
    print("[web_migracion] API append: POST /api/inscripciones/append")
    print("[web_migracion] API certificados: POST /api/certificados/download | /api/certificados/send")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
