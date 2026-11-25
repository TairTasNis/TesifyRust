package app.tesify.desktop

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.drawable.Icon
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.util.Base64
import android.util.Log
import androidx.core.content.ContextCompat
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

class PlaybackMediaService : Service() {
  companion object {
    private const val TAG = "TesifyMediaService"
    private const val CHANNEL_ID = "tesify_media_playback"
    private const val NOTIFICATION_ID = 1042

    private const val ACTION_UPDATE = "app.tesify.desktop.media.UPDATE"
    private const val ACTION_STOP = "app.tesify.desktop.media.STOP"
    private const val ACTION_TOGGLE = "app.tesify.desktop.media.TOGGLE"
    private const val ACTION_NEXT = "app.tesify.desktop.media.NEXT"
    private const val ACTION_PREVIOUS = "app.tesify.desktop.media.PREVIOUS"

    private const val EXTRA_TITLE = "title"
    private const val EXTRA_ARTIST = "artist"
    private const val EXTRA_COVER_URL = "coverUrl"
    private const val EXTRA_DURATION_MS = "durationMs"
    private const val EXTRA_POSITION_MS = "positionMs"
    private const val EXTRA_PLAYING = "playing"
    private const val EXTRA_LOADING = "loading"
    private const val EXTRA_MUST_FOREGROUND = "mustForeground"

    @Volatile
    private var serviceRunning = false

    fun update(
      context: Context,
      hasTrack: Boolean,
      playing: Boolean,
      loading: Boolean,
      title: String,
      artist: String,
      coverUrl: String?,
      durationMs: Long,
      positionMs: Long,
    ) {
      if (!hasTrack) {
        stop(context)
        return
      }
      if (!playing && !serviceRunning) {
        return
      }
      val intent = Intent(context, PlaybackMediaService::class.java).apply {
        action = ACTION_UPDATE
        putExtra(EXTRA_TITLE, title)
        putExtra(EXTRA_ARTIST, artist)
        putExtra(EXTRA_COVER_URL, coverUrl)
        putExtra(EXTRA_DURATION_MS, durationMs)
        putExtra(EXTRA_POSITION_MS, positionMs)
        putExtra(EXTRA_PLAYING, playing)
        putExtra(EXTRA_LOADING, loading)
        putExtra(EXTRA_MUST_FOREGROUND, playing)
      }
      try {
        if (playing) {
          ContextCompat.startForegroundService(context, intent)
        } else {
          context.startService(intent)
        }
      } catch (err: Exception) {
        Log.w(TAG, "Unable to update PlaybackMediaService", err)
      }
    }

    fun stop(context: Context) {
      if (!serviceRunning) return
      try {
        context.stopService(Intent(context, PlaybackMediaService::class.java))
      } catch (err: Exception) {
        Log.w(TAG, "Unable to stop PlaybackMediaService", err)
      }
    }
  }

  private lateinit var mediaSession: MediaSession
  private lateinit var notificationManager: NotificationManager
  private var wakeLock: PowerManager.WakeLock? = null
  private var noisyReceiverRegistered = false
  private var actionReceiverRegistered = false
  private var inForeground = false

  private val artworkExecutor = Executors.newSingleThreadExecutor()
  private val mainHandler = Handler(Looper.getMainLooper())

  private var currentTitle = ""
  private var currentArtist = ""
  private var currentCoverUrl: String? = null
  private var cachedCoverUrl: String? = null
  private var cachedBitmap: Bitmap? = null
  private var currentDurationMs = 0L
  private var currentPositionMs = 0L
  private var currentPlaying = false
  private var currentLoading = false

  private val noisyReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      if (intent?.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY && currentPlaying) {
        MainActivity.dispatchMediaAction("pause")
      }
    }
  }

  private val actionReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      handleMediaIntentAction(intent?.action)
    }
  }

  override fun onCreate() {
    super.onCreate()
    serviceRunning = true
    notificationManager = getSystemService(NotificationManager::class.java)
    ensureNotificationChannel()

    val powerManager = getSystemService(PowerManager::class.java)
    wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "tesify:media_playback").apply {
      setReferenceCounted(false)
    }

    mediaSession = MediaSession(this, "TesifyMediaSession").apply {
      setCallback(object : MediaSession.Callback() {
        override fun onPlay() {
          promoteForegroundForResume()
          MainActivity.dispatchMediaAction("play")
        }

        override fun onPause() {
          MainActivity.dispatchMediaAction("pause")
        }

        override fun onSkipToNext() {
          promoteForegroundForResume()
          MainActivity.dispatchMediaAction("next")
        }

        override fun onSkipToPrevious() {
          promoteForegroundForResume()
          MainActivity.dispatchMediaAction("previous")
        }

        override fun onSeekTo(pos: Long) {
          MainActivity.dispatchMediaAction("seek", pos.coerceAtLeast(0L) / 1000.0)
        }

        override fun onStop() {
          MainActivity.dispatchMediaAction("pause")
          shutdownService()
        }
      })
      isActive = true
    }

    try {
      ContextCompat.registerReceiver(
        this,
        noisyReceiver,
        IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),
        ContextCompat.RECEIVER_NOT_EXPORTED,
      )
      noisyReceiverRegistered = true
    } catch (err: Exception) {
      Log.w(TAG, "Failed to register noisy receiver", err)
    }

    try {
      val actionsFilter = IntentFilter().apply {
        addAction(ACTION_TOGGLE)
        addAction(ACTION_NEXT)
        addAction(ACTION_PREVIOUS)
        addAction(ACTION_STOP)
      }
      ContextCompat.registerReceiver(
        this,
        actionReceiver,
        actionsFilter,
        ContextCompat.RECEIVER_NOT_EXPORTED,
      )
      actionReceiverRegistered = true
    } catch (err: Exception) {
      Log.w(TAG, "Failed to register media action receiver", err)
    }
  }

  private fun promoteForegroundForResume() {
    if (!inForeground && currentTitle.isNotBlank()) {
      currentPlaying = true
      currentLoading = true
      acquireWakeLock()
      syncMediaSession()
      startForegroundCompat(buildNotification())
    }
  }

  private fun handleMediaIntentAction(action: String?) {
    when (action) {
      ACTION_TOGGLE -> {
        if (!currentPlaying) {
          promoteForegroundForResume()
        }
        MainActivity.dispatchMediaAction("toggle")
      }
      ACTION_NEXT -> {
        promoteForegroundForResume()
        MainActivity.dispatchMediaAction("next")
      }
      ACTION_PREVIOUS -> {
        promoteForegroundForResume()
        MainActivity.dispatchMediaAction("previous")
      }
      ACTION_STOP -> {
        MainActivity.dispatchMediaAction("pause")
        shutdownService()
      }
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (val action = intent?.action) {
      ACTION_TOGGLE, ACTION_NEXT, ACTION_PREVIOUS, ACTION_STOP -> handleMediaIntentAction(action)
      ACTION_UPDATE -> {
        currentTitle = intent.getStringExtra(EXTRA_TITLE).orEmpty()
        currentArtist = intent.getStringExtra(EXTRA_ARTIST).orEmpty()
        val cover = intent.getStringExtra(EXTRA_COVER_URL)?.takeIf { it.isNotBlank() }
        currentDurationMs = intent.getLongExtra(EXTRA_DURATION_MS, 0L).coerceAtLeast(0L)
        currentPositionMs = intent.getLongExtra(EXTRA_POSITION_MS, 0L).coerceAtLeast(0L)
        currentPlaying = intent.getBooleanExtra(EXTRA_PLAYING, false)
        currentLoading = intent.getBooleanExtra(EXTRA_LOADING, false)
        val mustForeground = intent.getBooleanExtra(EXTRA_MUST_FOREGROUND, false)

        if (cover != currentCoverUrl) {
          currentCoverUrl = cover
          if (cover == null) {
            cachedCoverUrl = null
            cachedBitmap = null
          } else if (cover != cachedCoverUrl) {
            cachedBitmap = null
            loadCoverAsync(cover)
          }
        }

        if (currentPlaying) {
          acquireWakeLock()
        } else {
          releaseWakeLock()
        }

        syncMediaSession()
        val notification = buildNotification()

        if (mustForeground || currentPlaying) {
          startForegroundCompat(notification)
        }
        if (!currentPlaying) {
          if (inForeground) {
            stopForeground(STOP_FOREGROUND_DETACH)
            inForeground = false
          }
          notifySafe(notification)
        }
      }
    }
    return START_NOT_STICKY
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    super.onTaskRemoved(rootIntent)
    shutdownService()
  }

  override fun onDestroy() {
    serviceRunning = false
    inForeground = false
    releaseWakeLock()
    if (noisyReceiverRegistered) {
      try {
        unregisterReceiver(noisyReceiver)
      } catch (_: Exception) {
      }
      noisyReceiverRegistered = false
    }
    if (actionReceiverRegistered) {
      try {
        unregisterReceiver(actionReceiver)
      } catch (_: Exception) {
      }
      actionReceiverRegistered = false
    }
    if (::mediaSession.isInitialized) {
      mediaSession.isActive = false
      mediaSession.release()
    }
    artworkExecutor.shutdownNow()
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun shutdownService() {
    if (inForeground) {
      stopForeground(STOP_FOREGROUND_REMOVE)
      inForeground = false
    } else if (::notificationManager.isInitialized) {
      notificationManager.cancel(NOTIFICATION_ID)
    }
    stopSelf()
  }

  private fun startForegroundCompat(notification: Notification) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    inForeground = true
  }

  private fun ensureNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "Воспроизведение музыки",
        NotificationManager.IMPORTANCE_LOW,
      ).apply {
        description = "Управление текущим треком на экране блокировки и в панели медиа"
        setShowBadge(false)
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      }
      notificationManager.createNotificationChannel(channel)
    }
  }

  private fun syncMediaSession() {
    val actions = PlaybackState.ACTION_PLAY or
      PlaybackState.ACTION_PAUSE or
      PlaybackState.ACTION_PLAY_PAUSE or
      PlaybackState.ACTION_SKIP_TO_NEXT or
      PlaybackState.ACTION_SKIP_TO_PREVIOUS or
      PlaybackState.ACTION_SEEK_TO or
      PlaybackState.ACTION_STOP

    val stateCode = when {
      currentLoading && currentPlaying -> PlaybackState.STATE_BUFFERING
      currentPlaying -> PlaybackState.STATE_PLAYING
      else -> PlaybackState.STATE_PAUSED
    }
    val speed = if (currentPlaying && !currentLoading) 1.0f else 0.0f

    val stateBuilder = PlaybackState.Builder()
      .setActions(actions)
      .setState(stateCode, currentPositionMs, speed, SystemClock.elapsedRealtime())

    val metaBuilder = MediaMetadata.Builder()
      .putString(MediaMetadata.METADATA_KEY_TITLE, currentTitle.ifBlank { "Tesify" })
      .putString(MediaMetadata.METADATA_KEY_ARTIST, currentArtist.ifBlank { "Tesify" })
      .putString(MediaMetadata.METADATA_KEY_ALBUM, "Tesify")
    if (currentDurationMs > 0L) {
      metaBuilder.putLong(MediaMetadata.METADATA_KEY_DURATION, currentDurationMs)
    }
    val art = if (currentCoverUrl == cachedCoverUrl) cachedBitmap else null
    if (art != null) {
      metaBuilder.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, art)
    }

    mediaSession.setMetadata(metaBuilder.build())
    mediaSession.setPlaybackState(stateBuilder.build())
    mediaSession.isActive = true
  }

  private fun buildNotification(): Notification {
    val openIntent = Intent(this, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val contentPendingIntent = PendingIntent.getActivity(
      this,
      0,
      openIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    val prevAction = Notification.Action.Builder(
      Icon.createWithResource(this, R.drawable.ic_media_previous),
      "Предыдущий",
      serviceActionIntent(ACTION_PREVIOUS, 1),
    ).build()

    val toggleAction = Notification.Action.Builder(
      Icon.createWithResource(
        this,
        if (currentPlaying) R.drawable.ic_media_pause else R.drawable.ic_media_play,
      ),
      if (currentPlaying) "Пауза" else "Продолжить",
      serviceActionIntent(ACTION_TOGGLE, 2),
    ).build()

    val nextAction = Notification.Action.Builder(
      Icon.createWithResource(this, R.drawable.ic_media_next),
      "Следующий",
      serviceActionIntent(ACTION_NEXT, 3),
    ).build()

    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }

    builder
      .setSmallIcon(R.drawable.ic_media_note)
      .setContentTitle(currentTitle.ifBlank { "Tesify" })
      .setContentText(currentArtist.ifBlank { "Tesify" })
      .setContentIntent(contentPendingIntent)
      .setDeleteIntent(serviceActionIntent(ACTION_STOP, 4))
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setOngoing(currentPlaying)
      .setOnlyAlertOnce(true)
      .addAction(prevAction)
      .addAction(toggleAction)
      .addAction(nextAction)
      .setStyle(
        Notification.MediaStyle()
          .setMediaSession(mediaSession.sessionToken)
          .setShowActionsInCompactView(0, 1, 2),
      )

    val art = if (currentCoverUrl == cachedCoverUrl) cachedBitmap else null
    if (art != null) {
      builder.setLargeIcon(art)
    }

    return builder.build()
  }

  private fun notifySafe(notification: Notification) {
    try {
      notificationManager.notify(NOTIFICATION_ID, notification)
    } catch (_: SecurityException) {
    }
  }

  private fun serviceActionIntent(action: String, requestCode: Int): PendingIntent {
    val intent = Intent(action).apply {
      setPackage(packageName)
    }
    return PendingIntent.getBroadcast(
      this,
      requestCode,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun loadCoverAsync(url: String) {
    artworkExecutor.execute {
      val bitmap = decodeCoverBitmap(url) ?: return@execute
      mainHandler.post {
        if (!serviceRunning || currentCoverUrl != url) {
          if (!bitmap.isRecycled) bitmap.recycle()
          return@post
        }
        cachedCoverUrl = url
        cachedBitmap = bitmap
        syncMediaSession()
        notifySafe(buildNotification())
      }
    }
  }

  private fun decodeCoverBitmap(source: String): Bitmap? {
    return try {
      val raw = if (source.startsWith("data:image/", ignoreCase = true)) {
        val comma = source.indexOf(',')
        if (comma < 0) return null
        val bytes = Base64.decode(source.substring(comma + 1), Base64.DEFAULT)
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
      } else if (source.startsWith("https://", ignoreCase = true) || source.startsWith("http://127.0.0.1:", ignoreCase = true)) {
        val conn = (URL(source).openConnection() as HttpURLConnection).apply {
          connectTimeout = 5000
          readTimeout = 5000
          instanceFollowRedirects = true
        }
        try {
          if (conn.responseCode !in 200..299) return null
          conn.inputStream.use { BitmapFactory.decodeStream(it) }
        } finally {
          conn.disconnect()
        }
      } else {
        null
      }
      raw?.let { scaleDown(it, 512) }
    } catch (_: Exception) {
      null
    }
  }

  private fun scaleDown(bitmap: Bitmap, maxSize: Int): Bitmap {
    val maxDim = maxOf(bitmap.width, bitmap.height)
    if (maxDim <= maxSize || maxDim <= 0) return bitmap
    val scale = maxSize.toFloat() / maxDim.toFloat()
    val width = (bitmap.width * scale).toInt().coerceAtLeast(1)
    val height = (bitmap.height * scale).toInt().coerceAtLeast(1)
    val scaled = Bitmap.createScaledBitmap(bitmap, width, height, true)
    if (scaled !== bitmap) bitmap.recycle()
    return scaled
  }

  private fun acquireWakeLock() {
    val lock = wakeLock ?: return
    if (!lock.isHeld && MainActivity.backgroundPlaybackEnabled) {
      lock.acquire(60 * 60 * 1000L)
    }
  }

  private fun releaseWakeLock() {
    val lock = wakeLock ?: return
    if (lock.isHeld) {
      try {
        lock.release()
      } catch (_: Exception) {
      }
    }
  }
}
