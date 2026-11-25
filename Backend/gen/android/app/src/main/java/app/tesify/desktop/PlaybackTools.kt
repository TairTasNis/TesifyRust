package app.tesify.desktop

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.yausername.youtubedl_android.YoutubeDL
import java.io.File
import kotlin.concurrent.thread

@InvokeArg
internal class BackgroundPlaybackArgs {
  var enabled: Boolean = true
}

@InvokeArg
internal class MediaStateArgs {
  var hasTrack: Boolean = false
  var playing: Boolean = false
  var loading: Boolean = false
  var title: String = ""
  var artist: String = ""
  var coverUrl: String? = null
  var durationMs: Long = 0L
  var positionMs: Long = 0L
}

@TauriPlugin
class PlaybackTools(private val host: Activity) : Plugin(host) {
  private var askedNotificationPermission = false

  @Command
  fun prepare(invoke: Invoke) {
    val app = host.applicationContext
    thread(name = "TesifyPlaybackTools") {
      try {
        YoutubeDL.init(app)
        val libraryDir = File(app.applicationInfo.nativeLibraryDir)
        val baseDir = File(app.noBackupFilesDir, YoutubeDL.baseName)
        val python = File(libraryDir, "libpython.so")
        val quickJs = File(libraryDir, "libqjs.so")
        val ytDlp = File(File(baseDir, YoutubeDL.ytdlpDirName), YoutubeDL.ytdlpBin)
        val pythonHome = File(baseDir, "packages/python/usr")
        check(python.canExecute() && quickJs.canExecute() && ytDlp.isFile && pythonHome.isDirectory)
        invoke.resolve(JSObject().apply {
          put("python", python.absolutePath)
          put("quickJs", quickJs.absolutePath)
          put("ytDlp", ytDlp.absolutePath)
          put("pythonHome", pythonHome.absolutePath)
          put("cacheDir", app.cacheDir.absolutePath)
        })
      } catch (error: Exception) {
        reject(invoke, error)
      } catch (error: LinkageError) {
        reject(invoke, error)
      }
    }
  }

  @Command
  fun setBackgroundPlayback(invoke: Invoke) {
    val args = invoke.parseArgs(BackgroundPlaybackArgs::class.java)
    MainActivity.backgroundPlaybackEnabled = args.enabled
    invoke.resolve()
  }

  @Command
  fun updateMediaState(invoke: Invoke) {
    val args = invoke.parseArgs(MediaStateArgs::class.java)
    MainActivity.hasActiveTrack = args.hasTrack
    MainActivity.mediaPlaying = args.hasTrack && args.playing
    if (args.hasTrack && args.playing) {
      maybeRequestNotificationPermission()
    }
    PlaybackMediaService.update(
      context = host.applicationContext,
      hasTrack = args.hasTrack,
      playing = args.playing,
      loading = args.loading,
      title = args.title,
      artist = args.artist,
      coverUrl = args.coverUrl,
      durationMs = args.durationMs,
      positionMs = args.positionMs,
    )
    invoke.resolve()
  }

  private fun maybeRequestNotificationPermission() {
    if (askedNotificationPermission || Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
    if (ContextCompat.checkSelfPermission(host, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
      return
    }
    askedNotificationPermission = true
    host.runOnUiThread {
      ActivityCompat.requestPermissions(host, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 4001)
    }
  }

  private fun reject(invoke: Invoke, error: Throwable) {
    Log.e("TesifyPlayback", "Failed to initialize playback tools", error)
    invoke.reject("Unable to initialize Android playback tools")
  }
}
