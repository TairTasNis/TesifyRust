package app.tesify.desktop

import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowInsets
import android.webkit.WebView
import android.window.BackEvent
import android.window.OnBackAnimationCallback
import android.window.OnBackInvokedDispatcher
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.annotation.RequiresApi
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  private var contentWebView: WebView? = null
  private var predictiveBack: OnBackAnimationCallback? = null

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

  private fun handleBack(fallback: () -> Unit) {
    val webView = contentWebView
    if (webView == null) {
      fallback()
      return
    }
    webView.evaluateJavascript("!window.dispatchEvent(new Event('tesify:back', { cancelable: true }))") { handled ->
      if (handled != "true") {
        if (webView.canGoBack()) webView.goBack() else fallback()
      }
    }
  }

  private val overlayBack = object : OnBackPressedCallback(true) {
    override fun handleOnBackPressed() {
      handleBack {
        isEnabled = false
        onBackPressedDispatcher.onBackPressed()
        isEnabled = true
      }
    }
  }

  @RequiresApi(34)
  private fun registerPredictiveBack() {
    val callback = object : OnBackAnimationCallback {
      private var closingKeyboard = false

      private fun keyboardVisible() = window.decorView.rootWindowInsets?.isVisible(WindowInsets.Type.ime()) == true

      override fun onBackStarted(backEvent: BackEvent) {
        closingKeyboard = keyboardVisible()
        if (!closingKeyboard) {
          contentWebView?.evaluateJavascript("window.dispatchEvent(new Event('tesify:back-start'))", null)
        }
      }

      override fun onBackProgressed(backEvent: BackEvent) {
        if (closingKeyboard) return
        val progress = backEvent.progress.coerceIn(0f, 1f)
        contentWebView?.evaluateJavascript("window.dispatchEvent(new CustomEvent('tesify:back-progress',{detail:$progress}))", null)
      }

      override fun onBackCancelled() {
        if (!closingKeyboard) {
          contentWebView?.evaluateJavascript("window.dispatchEvent(new Event('tesify:back-cancel'))", null)
        }
        closingKeyboard = false
      }

      override fun onBackInvoked() {
        if (closingKeyboard || keyboardVisible()) {
          closingKeyboard = false
          window.insetsController?.hide(WindowInsets.Type.ime())
        } else {
          handleBack { if (!isTaskRoot || !moveTaskToBack(false)) finishAfterTransition() }
        }
      }
    }
    // Register with the window ahead of WebView navigation so progress reaches the page.
    onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_OVERLAY, callback)
    predictiveBack = callback
  }

  override fun onPostResume() {
    super.onPostResume()
    if (Build.VERSION.SDK_INT >= 34) registerPredictiveBack()
    else onBackPressedDispatcher.addCallback(overlayBack)
  }

  override fun onPause() {
    if (Build.VERSION.SDK_INT >= 34) {
      predictiveBack?.let { onBackInvokedDispatcher.unregisterOnBackInvokedCallback(it) }
      predictiveBack = null
    } else overlayBack.remove()
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
