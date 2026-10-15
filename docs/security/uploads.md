# Uploads: accepted types, sizes and safe delivery

**Kind:** reference. Which files the media library accepts, how large they may be, and how the CMS serves them so that opening one does not run anything. Answers ASVS 5.0.0 V5.1.1 ([mapping](asvs.md)). The setup of the disk or bucket is in [configure.md](../operate/configure.md#media).

## Who uploads

Only administrators, through the admin panel or the admin API. The editor role gets only the read actions of the upload plugin's content API (`src/migrations/editor-role.ts:26-27`), and no role of this repository is granted an upload create permission ([ACCOUNTS.md](../ACCOUNTS.md)). `POST /api/upload` is rate limited per client in the `upload` group, 30 requests per 600 seconds by default (`config/rate-limit.ts:27`, [RATE_LIMITING.md](../RATE_LIMITING.md)). An admin can also import a file from an `http` or `https` URL; the CMS refuses hosts that resolve to blocked address ranges (`node_modules/@strapi/upload/dist/server/services/file.js:92-108`).

## Accepted types

- **Deny list only.** `config/plugins.ts:71-73` sets `security.deniedTypes` to `text/html` and `application/xhtml+xml`. No `allowedTypes` is set, so every other type is accepted: images (SVG included), video, audio, PDF, archives and text.
- **How the type is decided.** The check reads three things: the declared type, the type of the extension and the type detected from the first 4100 bytes (`node_modules/@strapi/upload/dist/server/utils/mime-validation.js:8-24`, `:141-176`). A file is refused when one of them is denied. Detection recognises binary formats only, so HTML is caught by its declared type or its extension.
- **Consequence.** A file with an HTML extension or declared type is refused. A file that holds HTML but is stored as `text/plain` or as an image is accepted under that type. The next section says why that stays inert.

## Sizes

- **Per file: 200 MB.** The multipart parser caps each file at 200 MB (formidable 2.1.5, `node_modules/formidable/src/Formidable.js:26`), and `strapi::body` uses it with no other limit (`node_modules/@strapi/core/dist/middlewares/body.js:13-16`).
- **The plugin's limit comes after parsing.** `config/plugins.ts:36` sets `sizeLimit` to 250 MB for the local disk; the bucket branch keeps the plugin default of 1 GB (`node_modules/@strapi/upload/dist/server/config.js:7`). Both are checked after the parser has accepted the file, so **200 MB is the effective limit on both**.
- **Other request bodies.** JSON is limited to 1 MB and form or text bodies to 56 kB (koa-body 6.0.1 defaults, `node_modules/koa-body/lib/types.js:31-39`; `config/middlewares.ts` sets no other limit).
- **Archives** are stored as received and never unpacked (`@strapi/upload` 5.56.0), so no archive limit applies.
- **Images** are processed one at a time (`sharp.concurrency: 1`, `node_modules/@strapi/upload/dist/server/config.js:8-11`).

## Storage and names

The local provider writes each file under a generated name, not the one the browser sent (`node_modules/@strapi/provider-upload-local/dist/index.js:64`, `:80`). The original name stays in the database as metadata; no response header or email carries it.

The bucket provider (`config/plugins.ts:8-31`) uploads with `ACL` unset; the public read comes from `R2_BASE_URL`, which the CMS does not serve.

## Safe delivery

`/uploads/*` is served by Strapi's static handler (local disk) or by the bucket (`R2_BASE_URL`). For the local disk the CMS adds headers to every response under `/uploads/` that answers with a status below 300, or 304 (`src/middlewares/upload-headers.ts:11-18`, the policy in `src/utils/upload-headers.ts:2-28`):

| Upload                                                                                          | `X-Content-Type-Options` | `Content-Security-Policy`                                                                        | `Content-Disposition` |
| ----------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------ | --------------------- |
| Raster image, video, audio, PDF (`image/*` except SVG, `video/*`, `audio/*`, `application/pdf`) | `nosniff`                | not set                                                                                          | not set               |
| Anything else, SVG included                                                                     | `nosniff`                | `default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self'; sandbox` | `attachment`          |

- `nosniff` stops a browser from reading a file as another type than the one stored.
- The sandbox policy gives the page an opaque origin and blocks scripts, so an SVG or any other file opened on its own runs no script and cannot read the admin origin's storage.
- Embedded in an `<img>` or `<video>` element, an upload renders as usual.

The headers replace the page-wide policy of `strapi::security` for these responses, which allows inline scripts (`src/middlewares/upload-headers.ts:6-9`).

**Bucket.** When `R2_BASE_URL` is set, the files are served by the bucket's own host. The CMS sends none of these headers for them, so the protection depends on the bucket or its CDN. This was not verified. A bucket on its own origin keeps any file away from the admin origin; set the bucket's responses to the same headers if the site serves untrusted files from it.

## Not done

- No malware scan before storage or delivery (V5.4.3, open in #179).
- The CMS does not remove metadata from a file (EXIF, for example) before storing it. Whether Strapi's resized copies drop it was not verified.
- The allow list is empty by design: adding one is a decision for the site owner, because it changes what editors can upload.
