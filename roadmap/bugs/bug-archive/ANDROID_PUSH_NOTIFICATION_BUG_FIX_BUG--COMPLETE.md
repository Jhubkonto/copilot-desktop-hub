# Bug Fix Plan: Android Push Notifications Not Received When App is Closed/Minimized

## Problem Statement
Users are not receiving push notifications in the Nexy Android app when:
- The user triggers a chat from the Android app
- The Android app is then closed or minimized
- A new message arrives that should trigger a notification

This issue affects user engagement and real-time communication capabilities of the mobile platform.

---

## Phase 1: Root Cause Analysis

### Objective
Identify exactly why push notifications are not being received

### Likely Root Causes (Priority Order)

1. **Firebase Cloud Messaging (FCM) Setup Issues**
   - FCM is not properly initialized in the Android app
   - FCM sender ID is incorrect or missing
   - Firebase console project not linked to mobile app

2. **Notification Channel Misconfiguration (Android 8.0+)**
   - Notification channel not created with proper importance level
   - Channel importance set to NONE or MIN (notifications won't display)
   - Channel not registered before sending notifications

3. **Background Service & Permissions**
   - `INTERNET` permission missing or revoked
   - `RECEIVE_BOOT_COMPLETED` permission missing
   - App not whitelisted in battery optimization settings
   - Background execution restrictions preventing service startup

4. **Message Handling Logic Problems**
   - FCM message handler not properly implemented
   - Wrong message type (data vs notification messages)
   - Missing `onMessageReceived()` implementation
   - Notification dismissed before user can see it

5. **Data vs Notification Message Confusion**
   - Backend sending data messages instead of notification messages
   - Notification messages not reaching client when app is background/closed
   - Data messages not being displayed as notifications

### Debugging Actions

1. **Check FCM Token Registration**
   ```
   - Enable Firebase Analytics logging
   - Check that FCM token is generated and stored
   - Verify token is sent to backend on app launch
   - Confirm token is being used to send messages
   ```

2. **Validate Notification Channel**
   ```
   - Check NotificationChannel importance level
   - Verify channel is created BEFORE first notification send
   - Confirm channel settings match notification requirements
   ```

3. **Check Runtime Permissions**
   - `POST_NOTIFICATIONS` permission (Android 13+)
   - `INTERNET` permission
   - App installation location (not SDCard)

4. **Enable Debug Logging**
   - Add logging to `onMessageReceived()`
   - Log FCM token generation
   - Log notification channel creation
   - Verify backend is sending messages

5. **Firebase Console Testing**
   - Use Firebase Cloud Messaging console to send test notification
   - Verify message is received while app is running
   - Verify message is received while app is closed

6. **Backend Verification**
   - Confirm backend has latest FCM token for user
   - Verify backend is sending to correct target
   - Check backend logs for send failures

---

## Phase 2: Diagnosis Steps

### Step 1: FCM Token Verification
```kotlin
val token = FirebaseMessaging.getInstance().token
Log.d("FCM_DEBUG", "FCM Token: $token")
// Token should be non-null and consistent across app launches
```

### Step 2: Notification Channel Creation
```kotlin
if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
  val channel = NotificationChannel(
    "nexy_messages",
    "Chat Messages",
    NotificationManager.IMPORTANCE_HIGH // Must be HIGH for sound/vibration
  )
  notificationManager.createNotificationChannel(channel)
}
```

### Step 3: Permission Verification
- Verify `INTERNET` permission in AndroidManifest.xml
- Verify `POST_NOTIFICATIONS` in AndroidManifest.xml (Android 13+)
- Check runtime permissions granted via Settings

### Step 4: Message Receipt Logging
```kotlin
override fun onMessageReceived(remoteMessage: RemoteMessage) {
  Log.d("FCM_DEBUG", "Message received: ${remoteMessage.data}")
  // Must display notification here when app is background
}
```

### Step 5: Firebase Console Test
- Go to Firebase Console → Cloud Messaging
- Send test message to this device
- Observe whether notification appears

### Step 6: Backend Token Sync
- Log backend API calls that receive FCM tokens
- Verify tokens are stored and used correctly
- Check for token refresh failures

---

## Phase 3: Fix Implementation

### Sub-Phase 3A: Firebase & Notification Setup

**File: `android/app/build.gradle`**
```gradle
dependencies {
  implementation("com.google.firebase:firebase-messaging:23.4.0")
}

apply plugin: "com.google.gms.google-services"
```

**File: `android/app/google-services.json`**
- Ensure file is present and contains correct Firebase credentials
- Verify sender_id matches backend configuration

**File: `AndroidManifest.xml`**
```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

<service
  android:name=".services.NexyChatMessagingService"
  android:exported="false">
  <intent-filter>
    <action android:name="com.google.firebase.MESSAGING_EVENT" />
  </intent-filter>
</service>
```

### Sub-Phase 3B: Notification Channel Configuration

**File: `android/app/src/main/java/.../NotificationManager.kt`**
```kotlin
fun createNotificationChannels(context: Context) {
  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
    val importance = NotificationManager.IMPORTANCE_HIGH
    val channel = NotificationChannel("nexy_messages", "Chat Messages", importance)
    channel.description = "Notifications for chat messages"
    channel.enableVibration(true)
    channel.enableLights(true)
    channel.soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
    
    val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    notificationManager.createNotificationChannel(channel)
  }
}
```

### Sub-Phase 3C: FCM Message Handler

**File: `android/app/src/main/java/.../NexyChatMessagingService.kt`**
```kotlin
class NexyChatMessagingService : FirebaseMessagingService() {
  
  override fun onMessageReceived(remoteMessage: RemoteMessage) {
    Log.d("FCM", "Message from: ${remoteMessage.from}")
    
    // Handle notification payload
    remoteMessage.notification?.let { notification ->
      val title = notification.title ?: "New Message"
      val body = notification.body ?: ""
      showNotification(title, body, remoteMessage.data)
    }
    
    // Handle data payload
    if (remoteMessage.data.isNotEmpty()) {
      handleDataMessage(remoteMessage.data)
    }
  }
  
  override fun onNewToken(token: String) {
    Log.d("FCM", "New token: $token")
    // Send token to backend
    sendTokenToBackend(token)
  }
  
  private fun showNotification(title: String, body: String, data: Map<String, String>) {
    val notificationId = System.currentTimeMillis().toInt()
    
    val intent = Intent(this, ChatActivity::class.java).apply {
      putExtra("chat_id", data["chat_id"])
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
    }
    
    val pendingIntent = PendingIntent.getActivity(
      this, 
      notificationId, 
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    
    val builder = NotificationCompat.Builder(this, "nexy_messages")
      .setSmallIcon(R.drawable.ic_notification)
      .setContentTitle(title)
      .setContentText(body)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setAutoCancel(true)
      .setContentIntent(pendingIntent)
    
    NotificationManagerCompat.from(this).notify(notificationId, builder.build())
  }
  
  private fun sendTokenToBackend(token: String) {
    // API call to sync FCM token with backend
    try {
      val userId = getUserId()
      val response = apiService.updateFCMToken(userId, token)
      Log.d("FCM", "Token sent successfully: $response")
    } catch (e: Exception) {
      Log.e("FCM", "Failed to send token: ${e.message}")
    }
  }
}
```

### Sub-Phase 3D: Runtime Permission Handling

**File: `android/app/src/main/java/.../MainActivity.kt`**
```kotlin
class MainActivity : AppCompatActivity() {
  
  private val notificationPermissionLauncher = registerForActivityResult(
    ActivityResultContracts.RequestPermission()
  ) { isGranted ->
    if (isGranted) {
      Log.d("Permissions", "POST_NOTIFICATIONS permission granted")
    }
  }
  
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    
    // Create notification channels
    NotificationChannelManager.createNotificationChannels(this)
    
    // Request POST_NOTIFICATIONS permission (Android 13+)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      if (ContextCompat.checkSelfPermission(
        this, 
        Manifest.permission.POST_NOTIFICATIONS
      ) != PackageManager.PERMISSION_GRANTED) {
        notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
      }
    }
  }
}
```

### Sub-Phase 3E: Backend Integration

The backend needs to:
1. Receive FCM tokens from Android app
2. Store tokens per user
3. Send notifications using notification payload (not just data payload)
4. Include proper message structure for Nexy app

**Example backend notification send:**
```json
{
  "to": "FCM_TOKEN_HERE",
  "notification": {
    "title": "New message from [User]",
    "body": "Check your chat!",
    "click_action": "FLUTTER_NOTIFICATION_CLICK"
  },
  "data": {
    "chat_id": "chat_12345",
    "message_id": "msg_67890",
    "sender": "user_name"
  }
}
```

---

## Phase 4: Testing Strategy

### Test Case 1: App Running
- [ ] Send notification from Firebase console
- [ ] Notification appears in notification drawer
- [ ] Tapping notification opens correct chat

### Test Case 2: App Minimized
- [ ] Minimize app to background
- [ ] Send notification from Firebase console
- [ ] Notification appears in notification drawer
- [ ] Sound/vibration trigger correctly

### Test Case 3: App Closed
- [ ] Close app completely (swipe from recent apps)
- [ ] Send notification from Firebase console
- [ ] Notification appears in notification drawer
- [ ] Tapping notification opens app and correct chat

### Test Case 4: Multiple Notifications
- [ ] Send 5 notifications in quick succession
- [ ] All notifications appear
- [ ] Each has unique notification ID (no overwrites)

### Test Case 5: Different Message Types
- [ ] Text messages trigger notifications
- [ ] Attachments trigger notifications
- [ ] Mentions/mentions trigger notifications

### Test Case 6: FCM Token Refresh
- [ ] App receives new FCM token
- [ ] New token sent to backend
- [ ] Notifications still received after token refresh

### Test Case 7: Permissions Revoked
- [ ] Revoke POST_NOTIFICATIONS permission
- [ ] Attempt to send notification
- [ ] Graceful handling (no crash)

### Test Case 8: Various Android Versions
- [ ] Android 8.0 (Oreo) - notification channels
- [ ] Android 12 - permission model
- [ ] Android 13+ - POST_NOTIFICATIONS permission
- [ ] Android 14+ - battery restrictions

---

## Phase 5: Monitoring & Prevention

### Monitoring Metrics
- [ ] FCM token generation success rate
- [ ] Notification delivery rate
- [ ] Notification display rate
- [ ] User click-through rate

### Logging Points
```kotlin
Log.d("FCM_INIT", "Notification channels created")
Log.d("FCM_TOKEN", "New token: $token")
Log.d("FCM_RECEIVE", "Message received at: ${System.currentTimeMillis()}")
Log.d("FCM_DISPLAY", "Notification displayed: $notificationId")
Log.e("FCM_ERROR", "Failed to send token: $error")
```

### Backend Logging
- [ ] Log all token updates
- [ ] Log all notification send attempts
- [ ] Log send failures and reasons
- [ ] Monitor delivery rate metrics

---

## Success Criteria

### Functional
- [ ] 100% of notifications received when app is closed
- [ ] 100% of notifications received when app is minimized
- [ ] Notifications appear within 5 seconds of send
- [ ] Correct chat opens when notification tapped

### Quality
- [ ] No crashes related to notifications
- [ ] All test cases pass on Android 8+
- [ ] Works across all Nexy-supported devices

### Performance
- [ ] <100ms latency from send to delivery
- [ ] <500ms latency from send to display
- [ ] No battery drain from notification service

---

## Timeline
- **Phase 1 (Analysis)**: 2-3 days
- **Phase 2 (Diagnosis)**: 1-2 days
- **Phase 3 (Implementation)**: 4-6 days
- **Phase 4 (Testing)**: 3-5 days
- **Phase 5 (Monitoring)**: Ongoing

**Total: 10-16 days (2-3 weeks)**

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Too many notifications overwhelming user | Medium | Implement notification grouping and summary |
| Battery drain from background service | Medium | Use FCM's native background handling |
| Token sync failures | High | Implement retry logic and fallback mechanisms |
| Android version compatibility | Medium | Test on multiple versions during Phase 4 |
| User revoked notification permission | Low | Handle gracefully with clear messaging |

---

## Resource Requirements
- 1 Android Engineer (FCM setup, service implementation)
- 1 Backend Engineer (token management, message sending)
- 1 QA Engineer (cross-device testing)

---

## Files to Create/Modify

### Create
- `android/app/src/main/java/.../NexyChatMessagingService.kt`
- `android/app/src/main/java/.../NotificationChannelManager.kt`
- `android/app/src/main/java/.../FCMTokenManager.kt`

### Modify
- `android/app/build.gradle` (add Firebase messaging dependency)
- `android/app/AndroidManifest.xml` (add service and permissions)
- `android/app/src/main/java/.../MainActivity.kt` (permission request)
- `android/app/google-services.json` (Firebase config)

---

## Next Steps

1. Begin Phase 1 (Root Cause Analysis)
2. Run diagnostic tests from Phase 2
3. Identify bottleneck preventing notifications
4. Implement appropriate fix from Phase 3
5. Execute comprehensive testing in Phase 4
6. Deploy and monitor results
