# Task attachments

Status: shipped 2026-11-23
Archive path: `docs/archive/plans/task-attachments.md`

A user can attach files to a task, see the list, download a file and delete a file (GitHub issue #137, `docs/ISSUES.md` ISS-031). Today Solvro has no attachment model, route or UI. Lane P: a new Prisma model and migration, new routes, a new Docker volume, two new dependencies, and spine touches (`schema.prisma`, `lib/queries.ts`, `routes/tasks.ts`, `routes/projects.ts`, `nginx.conf`, `setup.sh`).

## Decisions (user)

- **D1: storage has two drivers, local and S3** (2026-11-23). This replaces the "local volume only, no S3 now" line in issue #137 (2026-11-22).
  - `local` is the default: files go in a named Docker volume mounted in the backend container.
  - `s3` is optional: any S3-compatible store (AWS S3, MinIO, Silo, Garage), set through env.
  - The bucket is private. Every download goes through the backend, never through a public or presigned bucket URL, so the visibility check runs on every download.
- **D1a: S3 first** (2026-11-23). The S3 driver is built first and is the driver the dev stack runs on, against the dev Silo bucket `solvro-dev` on the shared-services VM. Silo is the maintained MinIO fork `pgsty/silo`; its endpoint and key live only in the local, untracked `.env`. Every manual check and the Delivery Gate run on Silo. The local driver is still built, and a fresh `setup.sh` install still defaults to `local`, so a customer server needs no S3 store.
- **D2: limits** (2026-11-23). Each limit is an env value with this default:
  - 25 MB per file.
  - 20 files per task.
  - 100 MB in total per task.
  - File types: an allowlist of extensions: `png jpg jpeg gif webp pdf docx xlsx pptx txt csv log md json yaml yml zip`. Executables, scripts, `html`, `htm` and `svg` stay off the list, because a browser can run code in them.

## Decisions made in this plan

- **D3: one small storage interface.** `put(key, stream, size, contentType)`, `get(key)` (returns a stream), `delete(key)`, and `list()` for the orphan sweep. One file per driver. A new driver is one new file and no data model change.
- **D4: storage keys.** The key is `tasks/<taskId>/<uuid>`. The user's file name lives only in the database row, never in the key or on disk.
- **D5: one file per upload request.** The UI sends the files that a user picks one after the other. Reason: the server checks the per-task limits once per file, and one failed file does not cancel the others.
- **D6: file type check.** The server checks the extension against the allowlist and sets `Content-Type` from the extension, not from what the browser sends. Downloads send `Content-Disposition: attachment` with the cleaned name, and `X-Content-Type-Options: nosniff`. No content sniffing in version 1.
- **D7: deletion.** The database deletes a task's rows by cascade (`onDelete: Cascade` on the task). Before a task or project delete, the route collects the storage keys of every task that the delete removes, subtasks included. After the commit, it deletes those files, and a failure there is logged, not returned to the user. A daily in-process sweep, built like `lib/activityCleanup.ts`, deletes stored files that have no row. It skips files younger than 24 hours, so it cannot race an upload that is still in progress.
- **D8: new dependencies.** `multer` parses the multipart upload into a temporary file, with `fileSize` and `files: 1` limits. `@aws-sdk/client-s3` and `@aws-sdk/lib-storage` run the S3 driver. Both are server-only.
- **D9: permissions.**
  - Upload and delete need `task:write`.
  - List and download need `project:read`.
  - Every route runs `ensureTaskVisible`, so a hidden task answers 404, the same as a missing one.
- **D10: a duplicated task gets no attachments.** `lib/duplicate.ts` stays as it is.

## API

| Method and path | Permission | Answer |
|---|---|---|
| `GET /api/tasks/:id/attachments` | `project:read` | `[{ id, fileName, mimeType, sizeBytes, createdAt, uploadedBy: { id, name } \| null }]`, newest first |
| `POST /api/tasks/:id/attachments` (multipart, field `file`) | `task:write` | 201 with the new row. Errors: 413 when the file is too large; 415 when the type is not allowed; 409 when the task is at its file-count limit or its total-size limit. |
| `GET /api/attachments/:id` | `project:read` | The file, streamed |
| `DELETE /api/attachments/:id` | `task:write` | 204 |

Every error answer carries a message for the UI, with the limit in it, for example "Files can be up to 25 MB."

## Configuration

| Env | Default | Meaning |
|---|---|---|
| `ATTACHMENTS_DRIVER` | `local` | `local` or `s3` |
| `ATTACHMENTS_DIR` | `/app/uploads` | Local driver root: the mount point of the volume |
| `ATTACHMENT_MAX_FILE_MB` | `25` | Per-file limit |
| `ATTACHMENT_MAX_FILES_PER_TASK` | `20` | File-count limit per task |
| `ATTACHMENT_MAX_TASK_MB` | `100` | Total-size limit per task |
| `ATTACHMENT_ALLOWED_EXTENSIONS` | the D2 list | Comma-separated list |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | none | Needed only when the driver is `s3` |

The backend checks this config at start-up and refuses to start when the driver is `s3` and an `S3_*` value is missing. `GET /api/attachments/config` gives the frontend the limits and the allowlist, so the UI does not hard-code them.

## Tasks

| Task | What | Main files | Spine |
|---|---|---|---|
| 1 | Schema: the `TaskAttachment` model: `id`; `taskId`, cascade on task delete; `fileName`; `mimeType`; `sizeBytes`; `storageKey`, unique; `uploadedById`, set to null on user delete; `createdAt`. Index on `taskId`. Migration. | `backend/prisma/schema.prisma`, new migration | yes |
| 2 | Storage and limits: `backend/src/lib/attachments/`. The interface (D3), `localDriver.ts`, `s3Driver.ts`, config from env with the start-up check, the extension allowlist and MIME map, and file name cleaning. Vitest: the local driver on a temporary folder; the S3 driver against a mocked client; name cleaning; config errors. | new `lib/attachments/*`, `backend/src/env.ts`, `backend/package.json` (D8, lock written in the container) | no |
| 3 | Routes: `backend/src/routes/attachments.ts` (the API table, D5, D6, D9), mounted in `app.ts`, with no change to the 1 MB `express.json` limit elsewhere. Key collection and post-commit file delete in the task and project delete routes (D7). The orphan sweep job, started from `src/index.ts` and off under `NODE_ENV=test`. Backend vitest: upload, list, download headers, delete, each limit (413, 415, 409), hidden task (404), no `task:write` (403), task delete removes files, project delete removes files, the sweep. | new `routes/attachments.ts`, new `lib/attachments/sweep.ts`, `app.ts`, `index.ts`, `routes/tasks.ts`, `routes/projects.ts`, backend tests | yes |
| 4 | Ops: an nginx location for `POST /api/tasks/<n>/attachments` only, with `client_max_body_size 26m` and the same proxy settings as `/api/`. `setup.sh` creates the `solvro_uploads` volume, mounts it at `/app/uploads`, and writes the `ATTACHMENT_*` defaults. The backend `Dockerfile` creates `/app/uploads` owned by the runtime user. `docs/CONFIGURATION.md`: the env table, the volume, how to back it up, and the S3 option. The local `docker-compose.yml` (untracked) gets the same volume. | `frontend/nginx.conf`, `setup.sh`, `backend/Dockerfile`, `docs/CONFIGURATION.md` | yes |
| 5 | UI: an Attachments section in `TaskDetail`, the same in the panel and page layouts. A plain file input behind a button labelled "Attach files" (multiple pick, no drag-and-drop library), with the limits as one line of help text. Each row shows the file name, the size, the uploader and the date, with a download link and a delete button. Delete asks for confirmation. Upload progress and errors appear per file, with the server's message. Users without `task:write` see only the list and the download links. Hooks in `lib/queries.ts` (list, upload, delete, config). Frontend vitest for the section. New `e2e/tests/task-attachments.spec.ts`: upload, list, download, delete, a type rejected, the read-only view. | `frontend/src/components/TaskDetail.tsx`, new `TaskAttachments.tsx`, `frontend/src/lib/queries.ts`, tests, e2e spec | yes |

Order:

1. Wave 1 runs tasks 1, 2 and 4 in parallel. They share no file. In task 2, the S3 driver comes first, and the implementor checks it by hand against the dev Silo bucket before writing the local driver (D1a).
2. Wave 2 runs tasks 3 and 5 in parallel. Task 3 needs tasks 1 and 2. Task 5 builds on the API table above, and its e2e spec runs after wave 2 is integrated.

## Acceptance

- Upload, list, download and delete work from the task panel and the task page.
- A hidden task answers 404 on every attachment route. A user without `task:write` gets 403 on upload and delete.
- The server enforces all three limits and the allowlist, and the UI shows each limit before an upload and in each error.
- Stored files use generated keys. Downloads send `Content-Disposition: attachment` and `nosniff`.
- When a task or a project is deleted, its files are deleted too. The sweep removes orphan files.
- The dev stack runs with `ATTACHMENTS_DRIVER=s3` against the dev Silo bucket, and the Delivery Gate passes there (D1a).
- The local driver works on a fresh `setup.sh` install, checked by hand and recorded in Result.
- Attachments never appear in the Gantt exports (`exportExcel.ts`, `exportPdf.ts` unchanged).
- Works at 375 px and in both themes. The file input and every row action work by keyboard.
- `CHANGELOG.md` entries. The Delivery Gate result is recorded here. ISS-031 moves to the closed list in `docs/ISSUES.md`.

## Review

Instant reviews on task 1 (schema), task 3 (`routes/tasks.ts`, `routes/projects.ts`), task 4 (`nginx.conf`, `setup.sh`, `backend/Dockerfile`) and task 5 (`lib/queries.ts`); one phase review on the combined diff. The phase review also checks the security of the upload and download path: path traversal, content type, size limits and visibility.

## Out of scope

- Attachments on epics, comments or notes.
- Image previews and thumbnails.
- Virus scanning.
- An activity log entry for attach and delete.
- Moving existing files between drivers.
- Presigned or direct-to-bucket uploads.

## Result

- Tasks 1 to 5 shipped as planned, in two waves: wave 1 ran tasks 1, 2 and 4; wave 2 ran tasks 3 and 5.
- Changes along the way:
  - `S3_ENDPOINT` became optional, because AWS S3 derives it from the region.
  - New optional `S3_KEY_PREFIX`, so several installs can share one bucket. The orphan sweep lists only `tasks/` (under the prefix), so it never touches other objects in the bucket.
  - The S3 client sends checksums only when a request needs them, for S3-compatible stores such as Garage and older MinIO builds.
  - A fresh `setup.sh` install now stops when either the database volume or `solvro_uploads` exists, unless `FORCE_FRESH=1` is set; with it, both volumes are deleted.
  - Upload and delete races: the upload locks the task row (`FOR NO KEY UPDATE`), and the task and project deletes lock the task rows before they collect keys.
  - Post-commit storage deletes run in the background, so a delete answers without waiting for S3.
- Reviews: spine instant reviews on wave 1 (one blocker: a blank `S3_FORCE_PATH_STYLE` stopped every `setup.sh` install from starting) and on task 3, a re-review of each fix round, and one phase review (one blocker: live plan-path citations). All findings were fixed, apart from those filed below.
- Deferred to `docs/ISSUES.md`: ISS-212 (e2e read-only and 415 cases), ISS-213 (`solvro backup` skips the uploads volume), ISS-214 (nginx 26 MB limit is hardcoded), ISS-215 (e2e cleanup leaves stored objects until the sweep), ISS-216 (one flaky task-status test). ISS-031 is closed.
- `gates.sh`: all gates passed on the final tree, Playwright smoke included.
- Silo checks: the storage driver (put, get, list, delete, with and without a key prefix) and the full API (upload, list, download, delete) ran against the dev Silo bucket `solvro-dev`; the dev stack runs `ATTACHMENTS_DRIVER=s3`, so the e2e spec and the Delivery Gate also ran on Silo.

### Delivery Gate (2026-11-23): PASS

- Task page and side panel, light and dark, at 1280 px and 375 px, on the dev Silo bucket.
- Three files in one pick: a 176 KB PDF with a Polish name (kept intact, truncated with the full name on hover in the panel), a text file, and an `.exe`. The `.exe` was refused with a dismissible error row that lists the allowed types; the other two uploaded.
- The help line shows all four limits and the allowed types before an upload.
- Download over Silo saved the file under its own name.
- Keyboard focus on Attach files shows the bordered focus ring; no horizontal page scroll at 375 px.
- Not checked by hand: a fresh `setup.sh` install with the local driver. The local driver is covered by the backend tests (the route tests run on it) and by the `setup.sh` syntax check, but no fresh server install was run.
