# Custom Features Porting Summary

Porting dari `9router-old` (commits by itsramaa) ke `9router` telah selesai.

## ✅ Fitur yang Berhasil Di-Port

### 1. Core Services & Lifecycle Management
- ✅ **AccountLifecycle Service** (`src/shared/services/accountLifecycle.js`)
  - Centralized activate/deactivate/pause logic
  - ModelLockStore integration
  - Clear/set account error functions
  
- ✅ **DailyAccountCheck Service** (`src/shared/services/dailyAccountCheck.js`)
  - Daily UTC ping for all connections
  - Chat endpoint test (max_tokens=1)
  - Updates testStatus and lifecycle

- ✅ **UsageScheduler Service** (`src/shared/services/usageScheduler.js`)
  - Generic periodic task scheduler
  - Hot-reload safe with global registry

- ✅ **Bootstrap Service** (`src/shared/services/bootstrap.js`)
  - Singleton wrapper for initializeApp
  - HMR guards
  - Skip during Next.js build phase

### 2. Model Lock System Enhancements
- ✅ **ModelLockStore** (`open-sse/services/modelLockStore.js`)
  - Complete implementation with all helper functions
  - `getLockKey`, `isLockActive`, `getEarliestLock`
  - `buildSetLock`, `buildClearLocks`
  - `getExpiredLockKeys`, `getActiveLockKeys`, `hasAnyActiveLock`
  - BUG-05 fix: independent lock checking

- ✅ **ModelLockCleanup** (`open-sse/services/modelLockCleanup.js`)
  - Hourly cleanup of expired locks
  - Registered in initializeApp.js

- ✅ **AccountFallback Re-exports** (`open-sse/services/accountFallback.js`)
  - Backward-compat re-exports from modelLockStore

### 3. Utilities & Helpers
- ✅ **Logger Utility** (`src/sse/utils/logger.js`)
  - Custom logger with levels (DEBUG, INFO, WARN, ERROR)
  - Timestamp formatting
  - Cloud-optimized output
  - Functions: debug(), info(), warn(), error(), request(), response(), stream()
  - maskKey() for sensitive data

- ✅ **Connection Ban Detection** (`src/shared/utils/connectionBanDetect.js`)
  - Canonical BAN_KEYWORDS list
  - `isBannedError()` function
  - Single source of truth for UI

- ✅ **Connection Status Utility** (`src/shared/utils/connectionStatus.js`)
  - `getStatusVariant()` with lifecycle state support
  - Ban detection from lastError
  - Auto-pause detection (pausedUntil)
  - Returns: success/error/warning/destructive/default

### 4. UI Components
- ✅ **CooldownTimer Component** (`src/app/(dashboard)/dashboard/providers/[id]/CooldownTimer.js`)
  - Real-time countdown display
  - Dynamic format: Xs / Xm Ys / Xh Ym / Xd Xh
  - Orange font-mono styling with ⏱ icon

- ✅ **Enhanced ConnectionRow** (`src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js`)
  - Import isBannedError for ban detection
  - Pause state checking (isPaused)
  - Cooldown state checking (isCooldown)
  - Enhanced status labels (paused/banned/disabled)
  - Diagnosis field support in oneByOne status
  - CooldownTimer integration

### 5. API Route Enhancements
- ✅ **Provider API Routes** (`src/app/api/providers/[id]/route.js`)
  - POST `/deactivate` - deactivate connection
  - POST `/activate` - activate connection with lock cleanup
  - POST `/pause` - pause connection with expiry

### 6. Dashboard Features
- ✅ **Bulk Operations** (Provider detail page)
  - Bulk activate/deactivate selected connections
  - Selection state management
  - Bulk action toolbar

- ✅ **Provider-Level Toggle** (Providers list page)
  - Sets `disabledByProviderToggle` flag on all connections
  - Integrates with AccountLifecycle

### 7. Environment & Configuration
- ✅ **Fetch Tuning Variables** (`.env.example`)
  ```bash
  FETCH_CONNECT_TIMEOUT_MS=20000
  STREAM_STALL_TIMEOUT_MS=360000
  STREAM_FIRST_CHUNK_TIMEOUT_MS=200000
  ```

### 8. Integration & Initialization
- ✅ **initializeApp.js Integration**
  - Daily account check scheduler startup
  - Model lock cleanup scheduler (hourly)
  - Proper service orchestration

## ❌ Fitur yang TIDAK Di-Port (Sesuai Instruksi)

1. **Claude Auto-Ping Service** - Excluded per user request
2. **Automation Integration** - Excluded per user request
   - AUTOMATION_SERVER_URL
   - AUTOMATION_INJECT_TOKEN
   - Related automation endpoints

## 📋 Database Schema Fields

Fitur-fitur yang di-port menggunakan field yang sudah ada di schema:
- `isActive` - connection active state
- `testStatus` - test result status
- `lastError` - error message
- `pausedUntil` - pause expiry timestamp
- `modelLock_*` - per-model lock flat fields
- `modelLock___all` - account-level lock

## 🔍 Additional Context

### BUG Fixes Included
- **BUG-05**: Fixed model lock checking to check each lock independently
- **BUG-14**: Single source of truth for ban keyword detection
- **BUG-T03A**: Show diagnosis info in oneByOne status (quota warning, model locks)
- **BUG-T04**: Check all lock fields when model is not known

### Logging Prefixes
Custom logging dengan prefix `BUG-T` dan `INKON-` tersebar di:
- `src/sse/services/auth.js`
- `src/app/api/providers/[id]/test/testUtils.js`
- `src/shared/services/accountLifecycle.js`
- Various other service files

### Architecture Notes
- All services follow hot-reload safe patterns with global registries
- Model lock logic abstracted to modelLockStore for reusability
- Connection status logic centralized in shared utilities
- UI components use proper React hooks for time-dependent state

## ✅ Verification

Semua file telah dibuat/diupdate:
1. Core services: accountLifecycle, dailyAccountCheck, usageScheduler, bootstrap
2. Model lock system: modelLockStore, modelLockCleanup
3. Utilities: logger, connectionBanDetect, connectionStatus
4. UI components: CooldownTimer, enhanced ConnectionRow
5. API routes: provider activate/deactivate/pause endpoints
6. Dashboard: bulk operations, provider toggle
7. Configuration: env variables, initializeApp integration

## 🚀 Ready for Testing

Semua fitur telah di-port dan terintegrasi. Sistem siap untuk testing dengan:
- Manual connection lifecycle testing (activate/deactivate/pause)
- Bulk operations testing
- Daily account check verification
- Model lock cleanup verification
- UI status display verification