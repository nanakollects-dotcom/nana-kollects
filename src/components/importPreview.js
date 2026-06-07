import { IMPORT_LABELS } from "../core/imports.js";

const escapeText = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);

function formatValue(value) {
  if (value === null || value === undefined || value === "") return "-";
  return escapeText(value);
}

function rowDetails(row) {
  return Object.entries(row.data)
    .filter(([key]) => key !== "itemId")
    .slice(0, 8)
    .map(([key, value]) => `
      <div>
        <span>${escapeText(key)}</span>
        <strong>${formatValue(value)}</strong>
      </div>
    `)
    .join("");
}

function messageList(messages, className) {
  return messages.length
    ? `<ul class="${className}">${messages.map((message) => `<li>${escapeText(message)}</li>`).join("")}</ul>`
    : "";
}

function section(title, rows, emptyText) {
  return `
    <section class="import-preview-section">
      <h3>${title}</h3>
      ${
        rows.length
          ? `<div class="import-preview-list">
              ${rows.map((row) => `
                <article class="import-row-card import-${row.status}">
                  <div class="record-card-head">
                    <strong>Row ${row.rowNumber}</strong>
                    <span class="pill ${row.status === "error" ? "gray-pill" : row.status === "warning" ? "yellow-pill" : "green-pill"}">${row.status}</span>
                  </div>
                  <div class="record-grid">${rowDetails(row)}</div>
                  ${messageList(row.warnings, "import-warnings")}
                  ${messageList(row.errors, "import-errors")}
                </article>
              `).join("")}
            </div>`
          : `<div class="empty-state"><strong>${emptyText}</strong><span>Rows will appear here after selecting a CSV.</span></div>`
      }
    </section>
  `;
}

export function renderImportPreview(preview, result = null) {
  if (!preview) {
    return `
      <div class="import-preview">
        <div class="empty-state">
          <strong>No CSV selected yet</strong>
          <span>Choose an import type, upload a CSV, then review valid rows, warnings, and errors before importing.</span>
        </div>
      </div>
    `;
  }

  const readyRows = preview.rows.filter((row) => row.status === "ready");
  const warningRows = preview.rows.filter((row) => row.status === "warning");
  const errorRows = preview.rows.filter((row) => row.status === "error");

  return `
    <div class="import-preview">
      <div class="import-summary-grid">
        <div><span>Import Type</span><strong>${escapeText(IMPORT_LABELS[preview.type])}</strong></div>
        <div><span>Total Rows</span><strong>${preview.totalRows}</strong></div>
        <div><span>Valid Rows</span><strong>${preview.validRows}</strong></div>
        <div><span>Warnings</span><strong>${preview.warningRows}</strong></div>
        <div><span>Errors</span><strong>${preview.invalidRows}</strong></div>
      </div>

      <div class="alert-list">
        <div class="alert-row alert-warn">Please export a backup before importing large data.</div>
        ${
          preview.notices?.length
            ? preview.notices.map((notice) => `<div class="alert-row alert-info">${escapeText(notice)}</div>`).join("")
            : ""
        }
        ${
          preview.newCollections?.length
            ? `<div class="alert-row alert-info">${preview.newCollections.length} new collection${preview.newCollections.length === 1 ? "" : "s"} will be created after confirmation.</div>`
            : ""
        }
      </div>

      ${
        result
          ? `<div class="alert-list">
              <div class="alert-row alert-info">
                Import complete: ${result.imported} imported, ${result.skipped} skipped, ${result.createdCollections} collections created. Export a backup now to protect the migrated data.
              </div>
            </div>`
          : ""
      }

      ${section("Ready to Import", readyRows, "No clean rows")}
      ${section("Warnings", warningRows, "No warnings")}
      ${section("Errors", errorRows, "No errors")}
    </div>
  `;
}
