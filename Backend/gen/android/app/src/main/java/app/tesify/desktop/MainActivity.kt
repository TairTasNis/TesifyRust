package app.tesify.desktop

import android.os.Build
import android.os.Bundle
import android.view.View
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  private var contentWebView: WebView? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
      view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, keyboard.bottom))
      WindowInsetsCompat.CONSUMED
    }
    ViewCompat.requestApplyInsets(content)

  }

  private val overlayBack = object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        val webView = contentWebView
        if (webView == null) {
          goBack(null)
        } else {
          webView.evaluateJavascript("!window.dispatchEvent(new Event('tesify:back', { cancelable: true }))") { handled ->
            if (handled != "true") goBack(webView)
          }
        }
      }

      private fun goBack(webView: WebView?) {
        if (webView?.canGoBack() == true) {
          webView.goBack()
          return
        }
        isEnabled = false
        onBackPressedDispatcher.onBackPressed()
        isEnabled = true
      }
  }

  override fun onPostResume() {
    super.onPostResume()
    // Handle overlays before Tauri's default WebView history navigation.
    onBackPressedDispatcher.addCallback(overlayBack)
  }

  override fun onPause() {
    overlayBack.remove()
    super.onPause()
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    contentWebView = webView
    // A tap first resolves an audio URL in Rust, then starts the media element.
    webView.settings.mediaPlaybackRequiresUserGesture = false
    webView.post { preferSmoothWebViewMotion(webView) }
  }

  private fun preferSmoothWebViewMotion(webView: WebView) {
    val output = webView.display ?: return
    val supportedRates = output.supportedRefreshRates
    val fastest = supportedRates.maxOrNull() ?: return
    if (fastest <= 60.5f) return

    val preferred = fastest.coerceAtMost(120f)
    if (Build.VERSION.SDK_INT >= 36 && output.hasArrSupport()) {
      // The WebView votes when it redraws, allowing Android to lower the rate when idle.
      webView.requestedFrameRate = preferred
    } else {
      val windowRate = if (Build.VERSION.SDK_INT >= 34) preferred
        else supportedRates.filter { it > 60.5f && it <= 120.5f }.maxOrNull() ?: fastest
      window.attributes = window.attributes.apply { preferredRefreshRate = windowRate }
    }
  }
}
