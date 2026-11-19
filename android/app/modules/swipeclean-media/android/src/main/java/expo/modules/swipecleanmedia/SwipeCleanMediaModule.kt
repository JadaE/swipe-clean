package expo.modules.swipecleanmedia

import android.app.Activity
import android.content.ClipData
import android.content.ContentUris
import android.content.ContentValues
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.StatFs
import android.provider.MediaStore
import android.util.Size
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream

/**
 * Local-only MediaStore access for Swipe Clean.
 * - Reads metadata (size, duration, folder, date taken, dimensions) and makes small thumbnails on-device.
 * - Removal ONLY via Android's own confirmation dialog: MediaStore.createTrashRequest (recoverable)
 *   or MediaStore.createDeleteRequest (permanent). Nothing is removed unless the user taps Allow.
 * No network code here.
 */
class SwipeCleanMediaModule : Module() {
  private var pending: Promise? = null
  private val REQ = 0x5C1E
  // Data export / import through Android's own file picker (Storage Access Framework). No storage permission needed:
  // the app can only write the one file she names, or read the one file she picks.
  private var pendingSave: Promise? = null; private var saveText: String? = null
  private var pendingOpen: Promise? = null; private var openMax: Int = 0
  private val REQ_SAVE = 0x5C1F
  private val REQ_OPEN = 0x5C20

  private val cr get() = requireNotNull(appContext.reactContext).contentResolver
  private val cacheDir get() = File(requireNotNull(appContext.reactContext).cacheDir, "sc-thumbs").apply { mkdirs() }

  private fun collections(): List<Pair<String, Uri>> {
    val vol = if (Build.VERSION.SDK_INT >= 29) MediaStore.VOLUME_EXTERNAL else "external"
    return listOf("PHOTO" to MediaStore.Images.Media.getContentUri(vol), "VIDEO" to MediaStore.Video.Media.getContentUri(vol))
  }

  private fun projection(isVideo: Boolean): Array<String> {
    val p = mutableListOf("_id", "_display_name", "_size", "date_added", "date_modified", "width", "height", "bucket_display_name", "mime_type", "orientation")
    if (Build.VERSION.SDK_INT >= 29) { p += "datetaken"; p += "relative_path" } else p += "datetaken"
    if (isVideo || Build.VERSION.SDK_INT >= 29) p += "duration"
    if (Build.VERSION.SDK_INT >= 30) p += "is_favorite"
    return p.toTypedArray()
  }

  override fun definition() = ModuleDefinition {
    Name("SwipeCleanMedia")

    Constants("sdkInt" to Build.VERSION.SDK_INT, "canTrash" to (Build.VERSION.SDK_INT >= 30))

    /** All photos + videos the app can see (with partial access: only the ones the user selected). */
    AsyncFunction("queryAll") {
      val out = ArrayList<Map<String, Any?>>()
      for ((type, uri) in collections()) {
        val isVideo = type == "VIDEO"
        cr.query(uri, projection(isVideo), null, null, "date_added DESC")?.use { c ->
          val ix = { n: String -> c.getColumnIndex(n) }
          val iId = ix("_id"); val iName = ix("_display_name"); val iSize = ix("_size"); val iAdded = ix("date_added")
          val iMod = ix("date_modified"); val iW = ix("width"); val iH = ix("height"); val iBucket = ix("bucket_display_name")
          val iMime = ix("mime_type"); val iTaken = ix("datetaken"); val iRel = ix("relative_path"); val iDur = ix("duration")
          val iOri = ix("orientation"); val iFav = ix("is_favorite")
          while (c.moveToNext()) {
            val id = c.getLong(iId)
            val taken = if (iTaken >= 0 && !c.isNull(iTaken)) c.getLong(iTaken) else 0L
            val added = if (iAdded >= 0) c.getLong(iAdded) * 1000 else 0L
            val ori = if (iOri >= 0 && !c.isNull(iOri)) c.getInt(iOri) else 0
            var w = if (iW >= 0) c.getInt(iW) else 0; var h = if (iH >= 0) c.getInt(iH) else 0
            if (ori == 90 || ori == 270) { val t = w; w = h; h = t }
            out += mapOf(
              "id" to (if (isVideo) "v" else "i") + id,
              "uri" to ContentUris.withAppendedId(uri, id).toString(),
              "type" to type,
              "filename" to (if (iName >= 0) c.getString(iName) else null),
              "size" to (if (iSize >= 0) c.getLong(iSize).toDouble() else 0.0),
              "takenAt" to (if (taken > 0) taken else if (added > 0) added else (if (iMod >= 0) c.getLong(iMod) * 1000 else 0L)).toDouble(),
              "addedAt" to added.toDouble(),
              "width" to w, "height" to h,
              "bucket" to (if (iBucket >= 0) c.getString(iBucket) else null),
              "relPath" to (if (iRel >= 0) c.getString(iRel) else null),
              "mime" to (if (iMime >= 0) c.getString(iMime) else null),
              "durationMs" to (if (iDur >= 0 && !c.isNull(iDur)) c.getLong(iDur).toDouble() else 0.0),
              "favorite" to (iFav >= 0 && c.getInt(iFav) == 1)
            )
          }
        }
      }
      out
    }

    /**
     * Legacy (v0.0.6 and older). NOTE: a query on a single-item URI makes MediaProvider include trashed rows, so an item
     * that was just moved to the trash still counts as present here. That is why v0.0.6 never recorded trash moves.
     * Kept only so older JS keeps working; the app now uses mediaStatus.
     */
    AsyncFunction("stillPresent") { uris: List<String> ->
      uris.filter { u -> try { cr.query(Uri.parse(u), arrayOf("_id"), null, null, null)?.use { it.count > 0 } ?: false } catch (e: Exception) { false } }
    }

    /**
     * READ-ONLY trash check for items Swipe Clean recorded. For each content:// URI: what MediaStore says right now, with
     * trashed rows included (QUERY_ARG_MATCH_TRASHED = MATCH_INCLUDE, Android 11+). Never changes anything.
     * state: "present" (on the phone, not in the trash) | "trashed" (in Android's trash; expiresAt = when Android plans to
     * empty it, ms) | "gone" (the query ran and the row no longer exists) | "unknown" (couldn't check: Android 10 or older,
     * not a photo/video URI, or the query failed). bytes/name are only returned for rows that still exist.
     */
    AsyncFunction("mediaStatus") { uris: List<String> ->
      val out = LinkedHashMap<String, Map<String, Any?>>()
      for (u in uris) out[u] = mapOf("uri" to u, "state" to "unknown")
      if (Build.VERSION.SDK_INT < 30) return@AsyncFunction out.values.toList()
      val bases = collections().map { it.second.toString() }.toSet()
      // group by collection (images / video), ids only; anything else stays "unknown"
      val groups = HashMap<String, MutableMap<Long, String>>()
      for (u in uris) {
        val p = try { Uri.parse(u) } catch (e: Exception) { null } ?: continue
        val id = p.lastPathSegment?.toLongOrNull() ?: continue
        val base = u.substring(0, u.length - (p.lastPathSegment!!.length + 1))
        if (base !in bases) continue
        groups.getOrPut(base) { HashMap() }[id] = u
      }
      val cols = arrayOf("_id", MediaStore.MediaColumns.IS_TRASHED, MediaStore.MediaColumns.DATE_EXPIRES, "_size", "_display_name")
      for ((base, ids) in groups) {
        for (chunk in ids.keys.chunked(200)) {
          val args = Bundle().apply {
            putInt(MediaStore.QUERY_ARG_MATCH_TRASHED, MediaStore.MATCH_INCLUDE)
            putString(android.content.ContentResolver.QUERY_ARG_SQL_SELECTION, "_id IN (" + chunk.joinToString(",") { "?" } + ")")
            putStringArray(android.content.ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS, chunk.map { it.toString() }.toTypedArray())
          }
          try {
            val c = cr.query(Uri.parse(base), cols, args, null) ?: continue   // null cursor: leave as "unknown"
            val seen = HashSet<Long>()
            c.use {
              val iId = it.getColumnIndex("_id"); val iT = it.getColumnIndex(MediaStore.MediaColumns.IS_TRASHED)
              val iE = it.getColumnIndex(MediaStore.MediaColumns.DATE_EXPIRES); val iS = it.getColumnIndex("_size"); val iN = it.getColumnIndex("_display_name")
              while (it.moveToNext()) {
                val id = it.getLong(iId); val u = ids[id] ?: continue; seen += id
                val trashed = iT >= 0 && !it.isNull(iT) && it.getInt(iT) == 1
                val exp = if (trashed && iE >= 0 && !it.isNull(iE)) it.getLong(iE) * 1000 else null
                out[u] = mapOf("uri" to u, "state" to (if (trashed) "trashed" else "present"),
                  "expiresAt" to exp?.toDouble(),
                  "bytes" to (if (iS >= 0 && !it.isNull(iS)) it.getLong(iS).toDouble() else null),
                  "name" to (if (iN >= 0) it.getString(iN) else null))
              }
            }
            for (id in chunk) if (id !in seen) out[ids[id]!!] = mapOf("uri" to ids[id], "state" to "gone")
          } catch (e: Exception) { /* permission or provider problem: leave this chunk "unknown" */ }
        }
      }
      out.values.toList()
    }

    /** Total bytes currently sitting in the system trash (all apps), Android 11+. */
    AsyncFunction("trashInfo") {
      if (Build.VERSION.SDK_INT < 30) return@AsyncFunction mapOf("supported" to false, "bytes" to 0.0, "count" to 0)
      var bytes = 0.0; var count = 0
      for ((_, uri) in collections()) {
        val args = Bundle().apply { putInt(MediaStore.QUERY_ARG_MATCH_TRASHED, MediaStore.MATCH_ONLY) }
        cr.query(uri, arrayOf("_size"), args, null)?.use { c -> while (c.moveToNext()) { bytes += c.getLong(0); count++ } }
      }
      mapOf("supported" to true, "bytes" to bytes, "count" to count)
    }

    AsyncFunction("storage") {
      val s = StatFs(Environment.getDataDirectory().path)
      mapOf("total" to s.totalBytes.toDouble(), "free" to s.availableBytes.toDouble())
    }

    /** Small on-device thumbnail (cached file) for grids and video posters. */
    AsyncFunction("thumbnail") { uri: String, size: Int ->
      val f = File(cacheDir, "t" + uri.hashCode().toString(16) + "_" + size + ".jpg")
      if (f.exists() && f.length() > 0) return@AsyncFunction "file://" + f.absolutePath
      val bmp: Bitmap = if (Build.VERSION.SDK_INT >= 29) cr.loadThumbnail(Uri.parse(uri), Size(size, size), null)
        else {
          val id = Uri.parse(uri).lastPathSegment!!.toLong()
          if (uri.contains("/video/")) MediaStore.Video.Thumbnails.getThumbnail(cr, id, MediaStore.Video.Thumbnails.MINI_KIND, null)
          else MediaStore.Images.Thumbnails.getThumbnail(cr, id, MediaStore.Images.Thumbnails.MINI_KIND, null)
        }
      FileOutputStream(f).use { bmp.compress(Bitmap.CompressFormat.JPEG, 82, it) }
      "file://" + f.absolutePath
    }

    /**
     * Shows Android's own confirmation dialog. mode = "trash" (recoverable, ~30 days) | "delete" (permanent) | "restore" (untrash).
     * Resolves true only if the user tapped Allow (RESULT_OK).
     */
    AsyncFunction("requestSystemAction") { uris: List<String>, mode: String, promise: Promise ->
      if (Build.VERSION.SDK_INT < 30) { promise.reject("UNSUPPORTED", "Removing needs Android 11 or newer.", null); return@AsyncFunction }
      if (pending != null) { promise.reject("BUSY", "A system dialog is already open.", null); return@AsyncFunction }
      if (uris.isEmpty() || uris.size > 500) { promise.reject("BATCH", "Batch must be 1-500 items.", null); return@AsyncFunction }
      val list = uris.map { Uri.parse(it) }
      val pi = when (mode) {
        "trash" -> MediaStore.createTrashRequest(cr, list, true)
        "restore" -> MediaStore.createTrashRequest(cr, list, false)
        "delete" -> MediaStore.createDeleteRequest(cr, list)
        else -> { promise.reject("MODE", "Unknown mode", null); return@AsyncFunction }
      }
      pending = promise
      try {
        appContext.throwingActivity.startIntentSenderForResult(pi.intentSender, REQ, null, 0, 0, 0)
      } catch (e: Exception) { pending = null; promise.reject("LAUNCH", e.message ?: "Could not open the system dialog", e) }
    }.runOnQueue(Queues.MAIN)

    /**
     * Opens Android's share sheet for ONE item (ACTION_SEND + its MediaStore content:// URI + a temporary read grant).
     * She picks the destination; nothing is sent unless she completes it in the other app. Not a decision.
     */
    AsyncFunction("share") { uri: String, mime: String? ->
      val u = Uri.parse(uri)
      val type = mime ?: (cr.getType(u) ?: if (uri.contains("/video/")) "video/*" else "image/*")
      val send = Intent(Intent.ACTION_SEND).apply {
        setType(type)
        putExtra(Intent.EXTRA_STREAM, u)
        clipData = ClipData.newRawUri(null, u)   // carries the read grant to the chosen app
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      val chooser = Intent.createChooser(send, null).apply { addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION) }
      appContext.throwingActivity.startActivity(chooser)
      true
    }.runOnQueue(Queues.MAIN)

    /**
     * Stats export. Saves the CSV the user asked for into Downloads/SwipeClean (this app's own file, no storage permission
     * needed on Android 10+), then, if share=true, opens the share sheet for it. Nothing is sent unless she picks an app.
     * Returns the saved file's content:// URI, or "" if it could only be shared as text (Android 9 and older).
     */
    AsyncFunction("exportCsv") { name: String, content: String, share: Boolean ->
      var saved: Uri? = null
      if (Build.VERSION.SDK_INT >= 29) {
        val v = ContentValues().apply {
          put(MediaStore.MediaColumns.DISPLAY_NAME, name); put(MediaStore.MediaColumns.MIME_TYPE, "text/csv")
          put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/SwipeClean"); put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val u = requireNotNull(cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v)) { "Couldn't create the file in Downloads" }
        requireNotNull(cr.openOutputStream(u)).use { it.write(content.toByteArray(Charsets.UTF_8)) }
        cr.update(u, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
        saved = u
      }
      if (share) {
        val send = Intent(Intent.ACTION_SEND).apply {
          type = "text/csv"; putExtra(Intent.EXTRA_SUBJECT, name)
          if (saved != null) { putExtra(Intent.EXTRA_STREAM, saved); clipData = ClipData.newRawUri(null, saved); addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION) }
          else putExtra(Intent.EXTRA_TEXT, content)
        }
        appContext.throwingActivity.startActivity(Intent.createChooser(send, null).apply { addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION) })
      }
      saved?.toString() ?: ""
    }.runOnQueue(Queues.MAIN)

    /** Opens Android's "save as" picker for ONE JSON file named [name]; writes [content] there. Resolves the chosen
     *  content:// URI, or "" if she cancels. Nothing is shared or uploaded. */
    AsyncFunction("saveDocument") { name: String, content: String, promise: Promise ->
      if (pendingSave != null || pendingOpen != null) { promise.reject("BUSY", "A file picker is already open.", null); return@AsyncFunction }
      val i = Intent(Intent.ACTION_CREATE_DOCUMENT).apply { addCategory(Intent.CATEGORY_OPENABLE); type = "application/json"; putExtra(Intent.EXTRA_TITLE, name) }
      pendingSave = promise; saveText = content
      try { appContext.throwingActivity.startActivityForResult(i, REQ_SAVE) }
      catch (e: Exception) { pendingSave = null; saveText = null; promise.reject("LAUNCH", e.message ?: "Could not open the file picker", e) }
    }.runOnQueue(Queues.MAIN)

    /** Opens Android's file picker for ONE file and reads it as UTF-8 text. Refuses files over [maxBytes].
     *  Resolves the text, or null if she cancels. Read-only: the picked file is never changed. */
    AsyncFunction("openDocument") { maxBytes: Int, promise: Promise ->
      if (pendingSave != null || pendingOpen != null) { promise.reject("BUSY", "A file picker is already open.", null); return@AsyncFunction }
      val i = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE); type = "*/*"
        putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/json", "text/plain", "application/octet-stream"))
      }
      pendingOpen = promise; openMax = maxBytes
      try { appContext.throwingActivity.startActivityForResult(i, REQ_OPEN) }
      catch (e: Exception) { pendingOpen = null; promise.reject("LAUNCH", e.message ?: "Could not open the file picker", e) }
    }.runOnQueue(Queues.MAIN)

    OnActivityResult { _, payload ->
      when (payload.requestCode) {
        REQ -> { val p = pending; pending = null; p?.resolve(payload.resultCode == Activity.RESULT_OK) }
        REQ_SAVE -> {
          val p = pendingSave; val text = saveText; pendingSave = null; saveText = null
          val uri = payload.data?.data
          if (p == null) return@OnActivityResult
          if (payload.resultCode != Activity.RESULT_OK || uri == null || text == null) { p.resolve(""); return@OnActivityResult }
          try { requireNotNull(cr.openOutputStream(uri, "wt")) { "Couldn't open the file" }.use { it.write(text.toByteArray(Charsets.UTF_8)) }; p.resolve(uri.toString()) }
          catch (e: Exception) { p.reject("WRITE", "Couldn't save the file", e) }
        }
        REQ_OPEN -> {
          val p = pendingOpen; val max = openMax; pendingOpen = null
          val uri = payload.data?.data
          if (p == null) return@OnActivityResult
          if (payload.resultCode != Activity.RESULT_OK || uri == null) { p.resolve(null); return@OnActivityResult }
          try {
            val bytes = requireNotNull(cr.openInputStream(uri)) { "Couldn't open the file" }.use { inp ->
              val out = java.io.ByteArrayOutputStream(); val buf = ByteArray(64 * 1024); var total = 0
              while (true) { val n = inp.read(buf); if (n < 0) break; total += n; if (total > max) throw IllegalStateException("TOO_BIG"); out.write(buf, 0, n) }
              out.toByteArray()
            }
            p.resolve(String(bytes, Charsets.UTF_8))
          } catch (e: IllegalStateException) { p.reject("TOO_BIG", "That file is too big to be a Swipe Clean export.", null) }
          catch (e: Exception) { p.reject("READ", "Couldn't read the file", e) }
        }
      }
    }
  }
}
