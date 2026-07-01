# Handoff: Upload a recording for an IVR node

**From:** Samuel · **For:** Simcha
**What this is:** a finished, tested-to-build feature. Below is what it does, how to
put it into the real repo, the one database step, and how to test it safely
before it goes live.

---

## 1. What the feature does (the intent)

In the **Admin Portal → IVR Flows** editor, each node's **Node Properties** panel now
has a **Recording** field, right under *Prompt Text*:

- **"+ Upload a file"** — upload an audio file (MP3 / WAV / M4A / OGG) for that node.
- **▶ play** — listen to the uploaded recording.
- **🗑 remove** — delete it, with a "Delete recording?" confirmation popup.

When a node has a recording, the phone system tells **TelTech to *play* that recording**
instead of speaking the typed text (via TelTech's `play` action). Remove it, and it goes
back to speaking the text.

**Deliberately scoped:** recordings only replace **static** prompts (normal menu, input,
prompt, and hangup nodes). Prompts that read out **live info** (a price, a cart total,
etc.) keep using the spoken voice — a fixed recording can't say a changing number.

---

## 2. How the audio is stored (important design note)

- Uploaded files go to a **new public Supabase Storage bucket: `ivr-audio`** (mirrors the
  existing `product-images` bucket).
- The node stores the file's **public URL** (`config.prompt_audio_url`) and storage path
  (`config.prompt_audio_path`).
- The public URL is what gets passed to TelTech's `play` action.

⚠️ **The one thing to verify on the first real call:** we hand TelTech the recording's
**public web URL** as the `play` `file`. The docs describe `play` file paths as living on
TelTech's server, so **confirm on a test call that TelTech will fetch and play an https URL.**
If it won't, the file needs to reach TelTech another way — but everything else stays the same.

---

## 3. Apply the code changes

All changes are additive and mostly new files, so this should merge cleanly.

**Option A — apply the patch (most accurate):**
```bash
git checkout -b feature/ivr-node-recordings
git apply ivr-recording-feature.patch   # or: git am < ...  (patch is a plain diff, use git apply)
```

**Option B — hand the patch to Cursor's AI:** paste `ivr-recording-feature.patch` and say
*"apply this patch to the repo."*

**Files touched (8):**
| File | Change |
|---|---|
| `supabase/migrations/20260630120000_ivr_audio_bucket.sql` | **new** — creates the `ivr-audio` bucket |
| `apps/api/src/lib/ivr-audio.ts` | **new** — upload/delete/URL helper for recordings |
| `apps/api/src/modules/admin/ivr.ts` | upload + remove endpoints (`POST`/`DELETE /nodes/:id/audio`) |
| `apps/api/src/modules/teltech/teltech-builder.ts` | play the recording instead of speaking (gather/say/hangup) |
| `apps/api/src/modules/ivr/graph-dispatcher.ts` | pass the recording through for input/hangup/action nodes |
| `packages/shared/src/types/ivr.ts` | add `prompt_audio_url` / `prompt_audio_path` to node config |
| `apps/admin-web/src/lib/api.ts` | `apiUpload` helper (raw file upload) |
| `apps/admin-web/src/pages/IvrFlowsPage.tsx` | the Recording field UI (upload/play/remove + confirm) |

No new npm dependencies were added.

---

## 4. Run the ONE database step (you, via Supabase MCP)

Per the project rule (`.cursor/rules/supabase-migrations.mdc`), apply this through the
Supabase MCP — **not** `supabase db push`. It creates the `ivr-audio` bucket:

```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('ivr-audio', 'ivr-audio', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

DROP POLICY IF EXISTS "ivr-audio public read" ON storage.objects;
CREATE POLICY "ivr-audio public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'ivr-audio');
```

Then save the SQL locally under `supabase/migrations/<timestamp>_ivr_audio_bucket.sql`
using the timestamp the MCP assigns (the file in the patch is a placeholder timestamp).

---

## 5. Test it safely BEFORE it touches customers

1. Keep it on the `feature/ivr-node-recordings` branch (not `main`).
2. Run the database step above.
3. Let the branch build a **preview deploy** (Versol/Vercel-style preview link).
4. On the preview: log in → open an IVR flow → pick a node → **upload a recording** → **play** it.
5. Make a **test call** to that flow and confirm the caller **hears the recording**.
   - This is also where you confirm the TelTech `play`-from-URL question in section 2.
6. Only once it works on the preview, merge to `main` (live).

---

## 6. Build check already done

Both apps type-check **and** fully build with zero errors:
`@voicex/api` ✅ · `@voicex/admin-web` ✅ · `@voicex/shared` ✅
