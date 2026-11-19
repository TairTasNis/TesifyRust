package app.tesify.desktop

import android.app.Activity
import android.util.Log
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.yausername.youtubedl_android.YoutubeDL
import java.io.File
import kotlin.concurrent.thread

@TauriPlugin
class PlaybackTools(private val host: Activity) : Plugin(host) {
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

  private fun reject(invoke: Invoke, error: Throwable) {
    Log.e("TesifyPlayback", "Failed to initialize playback tools", error)
    invoke.reject("Unable to initialize Android playback tools")
  }
}
