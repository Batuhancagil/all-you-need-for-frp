# Sending Pictures to Text Channels – Options with Railway

## Railway Considerations

- **Ephemeral filesystem**: Railway containers can restart; local disk is not persistent.
- **No built-in object storage**: Railway does not provide S3-compatible storage by default.
- **Request size limits**: Large uploads may hit body size limits (often ~1–6 MB).

## Options for Image Storage

### 1. **Cloudflare R2** (recommended)
- S3-compatible, cheap, generous free tier.
- Create an R2 bucket and generate API keys.
- Store images in R2, save URLs in the database.
- Works well with Railway; no storage on Railway itself.

### 2. **AWS S3**
- Similar to R2; well-documented.
- Use `@aws-sdk/client-s3` for uploads.
- Store image URLs in `ChatMessage` or a related table.

### 3. **UploadThing**
- Upload API for Next.js.
- Handles resizing and storage.
- Simple integration and free tier.

### 4. **Base64 in DB** (only for very small images)
- Store small thumbnails as base64 in PostgreSQL.
- Not recommended: bloats DB, hits Railway limits.

## Suggested Approach: R2 + Signed URLs

1. Add an upload API route that:
   - Accepts a multipart file upload.
   - Validates type (e.g. image/jpeg, image/png) and size (e.g. max 2 MB).
   - Uploads to R2 using `@aws-sdk/client-s3` (R2 is S3-compatible).
   - Returns the public URL (or a signed URL).

2. Extend `ChatMessage`:
   - Add optional `imageUrl` (or a separate `ChatImage` table for multiple images).
   - Clients send either text, image, or both.

3. Env vars on Railway:
   - `R2_ACCOUNT_ID`
   - `R2_ACCESS_KEY_ID`
   - `R2_SECRET_ACCESS_KEY`
   - `R2_BUCKET_NAME`

4. UI: file input or drag-and-drop in the chat input.
