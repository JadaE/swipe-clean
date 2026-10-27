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

    /** Which of these ids are still visible (not trashed, not deleted). Used to confirm space only after the system result. */
    AsyncFunction("stillPresent") { uris: List<String> ->
      uris.filter { u -> try { cr.query(Uri.parse(u), arrayOf("_id"), null, null, null)?.use { it.count > 0 } ?: false } catch (e: Exception) { false } }
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

    OnActivityResult { _, payload ->
      if (payload.requestCode == REQ) {
        val p = pending; pending = null
        p?.resolve(payload.resultCode == Activity.RESULT_OK)
      }
    }
  }
}
