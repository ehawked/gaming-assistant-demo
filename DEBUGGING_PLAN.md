# Connection Stability Debugging & Fix Plan

## Overview
This plan addresses connection stability issues in the Gaming Assistant demo, tackling problems systematically from critical blockers to optimization improvements.

## Status

**Last Updated**: 2025-12-20

### Completed Phases
- ✅ **Phase 1: Critical Blockers** - COMPLETED
  - Created LiveAPIDemo component (src/components/LiveAPIDemo.jsx)
  - Wired up error callbacks (onClose, onErrorMessage) with proper cleanup
  - Build verified successful with no errors

### Partially Complete
- 🔄 **Phase 2: Connection State Management** - 1/2 complete
  - ✅ Fixed race condition in gemini-api.js (connected flag now set after SETUP_COMPLETE)
  - ⏳ Add connection states enum (pending)

### Pending
- ⏳ Phase 3: Media Stream Management (partially done - permission handling complete)
- ⏳ Phase 4: Reconnection Logic
- ⏳ Phase 5: Server-Side Improvements
- ⏳ Phase 6: Debugging & Monitoring
- ⏳ Phase 7: Testing Strategy

---

## Phase 1: Critical Blockers (Fix First)

### 1.1 Create Missing LiveAPIDemo Component ✅ COMPLETED
**Priority**: 🔴 CRITICAL - App won't run without this

**Current Issue**:
- `App.jsx` imports `./components/LiveAPIDemo` which doesn't exist
- No components directory exists

**Decision Made**: Created the component as a separate file (Option A) to maintain proper separation of concerns

**Implementation Complete** (src/components/LiveAPIDemo.jsx):
- ✅ Created LiveAPIDemo component using forwardRef and useImperativeHandle
- ✅ Manages GeminiLiveAPI, AudioStreamer, ScreenCapture, and AudioPlayer instances
- ✅ Exposes methods: connect(), disconnect(), toggleAudio(), toggleScreen(), setConfig()
- ✅ Wired up all callbacks: onConnectionChange, onAudioStreamChange, onScreenShareChange, onPreviewStreamChange
- ✅ Added proper cleanup on unmount
- ✅ Integrated error handling for permission denials
- ✅ Handles browser-initiated screen share cancellation

**Test Results**:
```bash
npm run build
# ✅ Build successful with no errors
# ✅ All imports resolved correctly
# ✅ No syntax errors
```

---

### 1.2 Wire Up Error Callbacks ✅ COMPLETED
**Priority**: 🔴 CRITICAL - Prevents proper state management

**Current Issue**:
- `GeminiLiveAPI` has `onErrorMessage` and `onClose` callbacks
- These weren't being properly configured
- Connection state becomes desynchronized

**Implementation Complete** (src/components/LiveAPIDemo.jsx):
```javascript
// Implemented in LiveAPIDemo component initialization
client.onClose = (event) => {
  console.log('🔌 Connection closed:', event);
  setIsConnected(false);
  onConnectionChange?.(false);

  // Auto-cleanup: Stop all active media streams
  if (isAudioStreaming && audioStreamerRef.current) {
    audioStreamerRef.current.stop();
    setIsAudioStreaming(false);
    onAudioStreamChange?.(false);
  }

  if (isScreenSharing && screenCaptureRef.current) {
    screenCaptureRef.current.stop();
    setIsScreenSharing(false);
    onScreenShareChange?.(false);
    onPreviewStreamChange?.(null);
  }
};

client.onErrorMessage = (message) => {
  console.error('❌ Connection error:', message);
  alert(`Connection Error: ${message}`);
  setIsConnected(false);
  onConnectionChange?.(false);
};
```

**Improvements Added**:
- ✅ Error callbacks properly wired in LiveAPIDemo component
- ✅ Auto-cleanup of media streams on disconnect
- ✅ User-friendly error alerts
- ✅ Proper state synchronization across all callbacks
- ✅ Prevents resource leaks from active streams

**Test Checklist**:
- [ ] Manually close server.py while connected
- [ ] Verify UI updates to disconnected state
- [ ] Verify media streams stop automatically
- [ ] Check that error alerts appear

---

## Phase 2: Connection State Management

### 2.1 Fix Race Condition in Connection Flag ✅ COMPLETED
**Priority**: 🟠 HIGH - Causes false "connected" state

**Current Issue**:
- `connected = true` was set in `onopen` before setup completes
- If setup fails, state would be incorrect

**Implementation Complete** (src/utils/gemini-api.js):
```javascript
// BEFORE (Line 277-282):
this.webSocket.onopen = (event) => {
  console.log("websocket open: ", event);
  this.connected = true;  // ❌ Set too early!
  this.totalBytesSent = 0;
  this.sendInitialSetupMessages();
  this.onConnectionStarted();
};

// AFTER (Line 277-282):
this.webSocket.onopen = (event) => {
  console.log("websocket open: ", event);
  // Don't set connected=true yet - wait for SETUP_COMPLETE
  this.totalBytesSent = 0;
  this.sendInitialSetupMessages();
};

// Added in onReceiveMessage (Line 253-266):
onReceiveMessage(messageEvent) {
  const messageData = JSON.parse(messageEvent.data);
  const message = new MultimodalLiveResponseMessage(messageData);

  // Only set connected=true after setup is complete
  if (message.type === MultimodalLiveResponseType.SETUP_COMPLETE) {
    console.log("✅ Setup complete - connection ready");
    this.connected = true;
    this.onConnectionStarted();  // ✅ Moved here
  }

  this.onReceiveResponse(message);
}
```

**Benefits**:
- ✅ Connection state now accurate - only "connected" after API is ready
- ✅ Prevents premature media streaming attempts
- ✅ Better error handling if setup fails
- ✅ Clear logging shows setup completion

**Test Checklist**:
- [ ] Connect and verify "connected" only shows after setup complete message
- [ ] Monitor console for "✅ Setup complete - connection ready"
- [ ] Verify media streams only start after connection is truly ready

---

### 2.2 Add Connection States (Not Just Boolean)
**Priority**: 🟡 MEDIUM - Better UX and debugging

**Current Issue**:
- Only has `connected: true/false`
- No distinction between connecting, connected, disconnecting, error states

**Implementation**:
```javascript
// Add to GeminiLiveAPI
this.connectionState = 'disconnected'; // disconnected, connecting, connected, error

// Update states throughout connection lifecycle
```

**States**:
- `disconnected` - Initial state, can call connect()
- `connecting` - WebSocket opening, sending setup
- `connected` - Setup complete, ready to stream
- `disconnecting` - Closing connection
- `error` - Connection failed

**Test**:
- Verify each state transition
- Check UI reflects correct state

---

## Phase 3: Media Stream Management

### 3.1 Auto-Stop Media Streams on Disconnect
**Priority**: 🟠 HIGH - Prevents resource leaks

**Current Issue**:
- When WebSocket closes, media streams keep running
- Camera/mic stay active
- Attempts to send to closed connection

**Debug Steps**:
1. Connect, start audio/screen share
2. Disconnect WebSocket
3. Check if camera light stays on
4. Monitor console for errors sending to closed socket

**Implementation**:
```javascript
// In App.jsx - enhance onClose callback
liveAPIRef.current.onClose = (event) => {
  setConnected(false);

  // Stop all active media streams
  if (audioStreaming && audioStreamerRef.current) {
    audioStreamerRef.current.stop();
    setAudioStreaming(false);
  }

  if (screenSharing && screenCaptureRef.current) {
    screenCaptureRef.current.stop();
    setScreenSharing(false);
  }
};
```

**Test**:
- Start audio and screen share
- Kill server.py
- Verify camera/mic turn off
- Verify no errors in console

---

### 3.2 Handle Media Permission Errors
**Priority**: 🟡 MEDIUM - Better error handling

**Current Issue**:
- No handling for denied camera/mic permissions
- Errors thrown but not caught

**Implementation**:
```javascript
// In handleAudio and handleScreen
const handleAudio = async () => {
  if (!connected) {
    alert("Please connect to the API first.");
    return;
  }

  try {
    await liveAPIRef.current.toggleAudio();
  } catch (error) {
    console.error('Audio error:', error);
    if (error.name === 'NotAllowedError') {
      alert('Microphone permission denied');
    } else {
      alert('Failed to start microphone: ' + error.message);
    }
    setAudioStreaming(false);
  }
};
```

**Test**:
- Deny microphone permission
- Deny screen share permission
- Verify proper error messages

---

## Phase 4: Reconnection Logic

### 4.1 Implement Auto-Reconnect
**Priority**: 🟠 HIGH - Critical for stability

**Current Issue**:
- No automatic reconnection on disconnect
- Network hiccups cause permanent disconnection

**Debug Steps**:
1. Simulate network interruption (kill server, restart)
2. Monitor if client detects disconnection
3. Test reconnection timing

**Implementation**:
```javascript
// In GeminiLiveAPI class
constructor() {
  // ... existing code ...
  this.autoReconnect = true;
  this.reconnectAttempts = 0;
  this.maxReconnectAttempts = 5;
  this.reconnectDelay = 1000; // Start with 1 second
}

this.webSocket.onclose = (event) => {
  console.log("websocket closed: ", event);
  this.connected = false;
  this.onClose(event);

  // Auto-reconnect logic
  if (this.autoReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      if (this.autoReconnect) {
        this.connect();
      }
    }, delay);
  }
};

// Reset attempts on successful connection
onReceiveMessage(messageEvent) {
  // ... existing code ...
  if (message.type === MultimodalLiveResponseType.SETUP_COMPLETE) {
    this.connected = true;
    this.reconnectAttempts = 0; // Reset on success
    this.onConnectionStarted();
  }
}
```

**Configuration**:
- Max attempts: 5
- Delay: Exponential backoff (1s, 2s, 4s, 8s, 16s)
- User can disable via UI

**Test**:
- Kill server while connected
- Restart server
- Verify auto-reconnect works
- Test max attempts limit

---

### 4.2 Add Manual Retry Button
**Priority**: 🟡 MEDIUM - UX improvement

**Implementation**:
```javascript
// Add to UI when connection fails
{!connected && reconnectAttempts > 0 && (
  <div className="reconnect-status">
    Reconnecting... (attempt {reconnectAttempts}/{maxReconnectAttempts})
    <button onClick={cancelReconnect}>Cancel</button>
  </div>
)}
```

---

## Phase 5: Server-Side Improvements

### 5.1 Add Heartbeat/Keepalive
**Priority**: 🟠 HIGH - Prevents silent timeouts

**Current Issue**:
- No periodic messages to keep connection alive
- Firewalls/proxies may close inactive connections

**Debug Steps**:
1. Monitor connection over extended period (> 5 minutes of inactivity)
2. Check if connection drops without error
3. Test on different networks (corporate, mobile)

**Implementation**:

**Client-side** (gemini-api.js):
```javascript
startHeartbeat() {
  this.heartbeatInterval = setInterval(() => {
    if (this.connected && this.webSocket.readyState === WebSocket.OPEN) {
      // Send empty realtime_input as heartbeat
      this.sendMessage({ heartbeat: true });
    }
  }, 30000); // Every 30 seconds
}

stopHeartbeat() {
  if (this.heartbeatInterval) {
    clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = null;
  }
}

// Call in connect/disconnect
```

**Server-side** (server.py):
```python
# In proxy_task - filter heartbeat messages
if data.get('heartbeat'):
    if DEBUG:
        print("Heartbeat received")
    continue  # Don't forward to Gemini
```

**Test**:
- Let connection idle for 10 minutes
- Verify connection stays alive
- Monitor network traffic

---

### 5.2 Handle Token Expiration
**Priority**: 🟡 MEDIUM - For long sessions

**Current Issue**:
- Token expires after ~1 hour
- No refresh logic

**Implementation**:
```python
# In server.py
import time

class TokenManager:
    def __init__(self):
        self.token = None
        self.token_expiry = 0

    def get_token(self):
        # Refresh if expired or expiring soon (5 min buffer)
        if time.time() > self.token_expiry - 300:
            creds, _ = google.auth.default()
            if not creds.valid:
                creds.refresh(Request())
            self.token = creds.token
            # Google tokens typically expire in 1 hour
            self.token_expiry = time.time() + 3600
        return self.token

token_manager = TokenManager()

# Use in handle_websocket_client
bearer_token = token_manager.get_token()
```

**Test**:
- Run session for > 1 hour
- Verify no auth errors

---

### 5.3 Improve Proxy Error Handling
**Priority**: 🟡 MEDIUM - Better diagnostics

**Implementation**:
```python
# Better error messages back to client
except Exception as e:
    error_message = {
        "error": str(e),
        "type": "proxy_error"
    }
    await client_websocket.send(json.dumps(error_message))
    await client_websocket.close(code=1011, reason="Internal error")
```

---

## Phase 6: Enhanced Debugging & Monitoring

### 6.1 Add Connection Health Metrics
**Priority**: 🟢 LOW - Nice to have

**Implementation**:
```javascript
// Track metrics
this.metrics = {
  connectionStartTime: null,
  totalBytesSent: 0,
  totalBytesReceived: 0,
  messagesReceived: 0,
  audioChunksSent: 0,
  imageFramesSent: 0,
  errors: [],
  reconnections: 0
};

// Expose via method
getConnectionMetrics() {
  return {
    ...this.metrics,
    uptime: Date.now() - this.metrics.connectionStartTime,
    avgLatency: this.calculateAvgLatency()
  };
}
```

**UI Display**:
```javascript
// Add to UI
<details>
  <summary>Connection Info</summary>
  <pre>{JSON.stringify(metrics, null, 2)}</pre>
</details>
```

---

### 6.2 Add Verbose Debug Mode
**Priority**: 🟢 LOW - Developer tool

**Implementation**:
```javascript
// In GeminiLiveAPI
this.debug = false; // Enable via UI toggle

sendMessage(message) {
  if (this.debug) {
    console.log('[SEND]', message);
  }
  // ... send logic
}

onReceiveMessage(messageEvent) {
  if (this.debug) {
    console.log('[RECV]', messageEvent.data);
  }
  // ... receive logic
}
```

---

## Phase 7: Testing Strategy

### 7.1 Unit Tests
- WebSocket state transitions
- Media stream lifecycle
- Reconnection logic
- Error handling

### 7.2 Integration Tests
- Full connection flow
- Media streaming
- Disconnection/reconnection
- Error scenarios

### 7.3 Manual Testing Scenarios

**Scenario 1: Clean Connection**
1. Start server
2. Open app
3. Click connect
4. Verify setup complete
5. Start audio/screen share
6. Verify streaming

**Scenario 2: Server Restart**
1. Connect and stream
2. Kill server
3. Verify disconnect detected
4. Restart server
5. Verify auto-reconnect
6. Verify streams resume

**Scenario 3: Network Interruption**
1. Connect and stream
2. Disable network
3. Re-enable network
4. Verify reconnection

**Scenario 4: Permission Denial**
1. Connect
2. Deny mic permission
3. Verify error handling
4. Try screen share instead

**Scenario 5: Long Session**
1. Connect
2. Leave idle for 2 hours
3. Verify token refresh
4. Verify connection stays alive

---

## Implementation Order

### Week 1: Critical Fixes
- [ ] 1.1 Create/Fix LiveAPIDemo component
- [ ] 1.2 Wire up error callbacks
- [ ] 2.1 Fix connection race condition
- [ ] 3.1 Auto-stop media on disconnect

### Week 2: Stability Improvements
- [ ] 4.1 Implement auto-reconnect
- [ ] 5.1 Add heartbeat/keepalive
- [ ] 3.2 Handle media permission errors

### Week 3: Polish & Testing
- [ ] 2.2 Add connection states
- [ ] 5.2 Handle token expiration
- [ ] 6.1 Add connection metrics
- [ ] 7.3 Complete manual testing

---

## Success Criteria

✅ **Critical**:
- App loads without errors
- Connection state accurate
- Disconnections properly detected
- Media streams clean up on disconnect

✅ **Stability**:
- Auto-reconnect works reliably
- Connections survive network hiccups
- No resource leaks

✅ **UX**:
- Clear error messages
- Connection status always accurate
- Graceful degradation

---

## Rollback Plan

Each phase should be committed separately so we can:
1. Identify which change caused issues
2. Revert specific changes if needed
3. Test incrementally

## Files to Modify

**Priority 1 (Critical)**:
- `src/App.jsx` - Create missing component integration, wire callbacks
- `src/utils/gemini-api.js` - Fix race condition, add reconnection

**Priority 2 (Stability)**:
- `src/utils/media-utils.js` - Add error handling
- `server.py` - Add heartbeat, token refresh

**Priority 3 (Polish)**:
- `src/App.css` - UI for connection states
- New: `src/utils/connection-monitor.js` - Metrics tracking
