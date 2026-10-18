import type { WsAction } from "../ws/protocol";
import { ACTION_DOCS } from "./catalog";

export const HTTP_ACTION_PREFIX = "/api/v1/";

/** "card:toggle_assignee" -> "/api/v1/card/toggle_assignee" */
export function httpPathForAction(action: WsAction): string {
  return `${HTTP_ACTION_PREFIX}${action.replace(":", "/")}`;
}

/** "/api/v1/card/toggle_assignee" -> "card:toggle_assignee" (only known actions). */
export function actionFromHttpPath(pathname: string): WsAction | null {
  if (!pathname.startsWith(HTTP_ACTION_PREFIX)) return null;
  const parts = pathname.slice(HTTP_ACTION_PREFIX.length).replace(/\/+$/, "").split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const action = `${parts[0]}:${parts[1]}`;
  return Object.prototype.hasOwnProperty.call(ACTION_DOCS, action) ? (action as WsAction) : null;
}

/** Public API reference page (Scalar UI from CDN, spec from /openapi.json). */
export function renderDocsHtml(): string {
  return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Project Manager API — Dokumentasi</title>
  <style>body{margin:0;font-family:system-ui,sans-serif}#fallback{padding:24px;color:#6b7488;font-size:14px}</style>
</head>
<body>
  <div id="app"></div>
  <div id="fallback">Memuat dokumentasi... Jika tidak muncul (CDN diblokir), buka spesifikasi mentah di
    <a href="/openapi.json">/openapi.json</a> dan impor ke Postman / Insomnia / Swagger Editor.</div>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  <script>
    if (window.Scalar) {
      document.getElementById("fallback").remove();
      Scalar.createApiReference("#app", {
        url: "/openapi.json",
        theme: "default",
        layout: "modern",
        defaultHttpClient: { targetKey: "js", clientKey: "fetch" },
      });
    }
  </script>
</body>
</html>`;
}
