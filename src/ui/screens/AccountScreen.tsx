/**
 * AccountScreen — sign-in, cloud save sync, and account management (TASK-5 §6).
 *
 * Structure follows SettingsScreen: modal with tabs.
 * Networking lives here on mount / explicit user action — never during Playing.
 *
 * This screen must never render nothing. Every code path renders a panel
 * with a BACK button (§6, the dead-end failure this codebase hit three times).
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useGameStore } from '../../state/useGameStore.ts'
import { useSettingsStore } from '../../state/useSettingsStore.ts'
import { Button, Tabs } from '../components/ui.tsx'
import styles from './AccountScreen.module.css'
import {
  cloudAvailable,
  getAccount,
  registerPasskey,
  loginPasskey,
  sendMagicLink,
  logout,
  deleteAccount,
  exportData,
  getSave,
  putSave,
  updateDisplayName,
  type AccountInfo,
  type SaveResponse,
  type PutSaveResult,
} from '../../net/apiClient.ts'
import { CURRENT_VERSION } from '../../state/persistence.ts'

/**
 * `unavailable` is distinct from `unauthenticated` on purpose. A static build
 * has no `/api/*` behind it, and offering a sign-in button that can only ever
 * fail is worse than saying so.
 */
type AuthStatus = 'loading' | 'unauthenticated' | 'authenticated' | 'unavailable'

export function AccountScreen(): React.JSX.Element {
  const back        = useGameStore((s) => s.back)
  const goto        = useGameStore((s) => s.goto)
  const setToast    = useGameStore((s) => s.setToast)
  const progress    = useSettingsStore((s) => s.progress)
  const settings    = useSettingsStore((s) => s.settings)
  const keybinds    = useSettingsStore((s) => s.keybinds)
  const setProgress = useSettingsStore((s) => s.updateProgress)

  const [activeTab, setActiveTab]   = useState('IDENTITY')
  const [authStatus, setAuthStatus] = useState<AuthStatus>('loading')
  const [account, setAccount]       = useState<AccountInfo | null>(null)
  const [saveInfo, setSaveInfo]     = useState<SaveResponse | null>(null)
  const [syncState, setSyncState]   = useState<'idle' | 'syncing' | 'conflict' | 'error'>('idle')
  const [conflict, setConflict]     = useState<PutSaveResult | null>(null)
  const [magicEmail, setMagicEmail] = useState('')
  const [magicSent, setMagicSent]   = useState(false)
  const [newName, setNewName]       = useState('')
  const [busy, setBusy]             = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Load account info on mount.
  useEffect(() => {
    void (async () => {
      if (!(await cloudAvailable({ refresh: true }))) {
        setAuthStatus('unavailable')
        return
      }
      try {
        const info = await getAccount()
        if (info) {
          setAccount(info)
          setNewName(info.displayName)
          setAuthStatus('authenticated')
        } else {
          setAuthStatus('unauthenticated')
        }
      } catch {
        setAuthStatus('unauthenticated')
      }
    })()
    containerRef.current?.focus()
  }, [])

  // Load save info when on the CLOUD SAVE tab.
  useEffect(() => {
    if (activeTab !== 'CLOUD SAVE' || authStatus !== 'authenticated') return
    void (async () => {
      try {
        const s = await getSave()
        setSaveInfo(s)
      } catch { /* non-fatal */ }
    })()
  }, [activeTab, authStatus])

  const handleRegisterPasskey = useCallback(async () => {
    setBusy(true)
    try {
      const info = await registerPasskey()
      setAccount(info)
      setNewName(info.displayName)
      setAuthStatus('authenticated')
      setToast({ tone: 'info', message: 'Passkey registered. You are now signed in.' })
    } catch (e) {
      setToast({ tone: 'warning', message: `Passkey registration failed: ${String(e)}` })
    }
    setBusy(false)
  }, [setToast])

  const handleLoginPasskey = useCallback(async () => {
    setBusy(true)
    try {
      const info = await loginPasskey()
      setAccount(info)
      setNewName(info.displayName)
      setAuthStatus('authenticated')
      setToast({ tone: 'info', message: `Welcome back, ${info.displayName}.` })
    } catch (e) {
      setToast({ tone: 'warning', message: `Sign-in failed: ${String(e)}` })
    }
    setBusy(false)
  }, [setToast])

  const handleSendMagicLink = useCallback(async () => {
    if (!magicEmail.includes('@')) {
      setToast({ tone: 'warning', message: 'Enter a valid email address.' })
      return
    }
    setBusy(true)
    try {
      await sendMagicLink(magicEmail)
      setMagicSent(true)
    } catch (e) {
      setToast({ tone: 'warning', message: `Failed to send link: ${String(e)}` })
    }
    setBusy(false)
  }, [magicEmail, setToast])

  const handleLogout = useCallback(async () => {
    setBusy(true)
    try {
      await logout()
      setAccount(null)
      setAuthStatus('unauthenticated')
      setToast({ tone: 'info', message: 'Signed out.' })
    } catch {
      setToast({ tone: 'warning', message: 'Could not sign out. Try again.' })
    }
    setBusy(false)
  }, [setToast])

  const handleDeleteAccount = useCallback(async () => {
    if (!window.confirm('Delete your account? This cannot be undone.')) return
    setBusy(true)
    try {
      await deleteAccount()
      setAccount(null)
      setAuthStatus('unauthenticated')
      setToast({ tone: 'info', message: 'Account deleted.' })
      goto('Title')
    } catch (e) {
      setToast({ tone: 'warning', message: `Delete failed: ${String(e)}` })
      setBusy(false)
    }
  }, [setToast, goto])

  const handleExportData = useCallback(async () => {
    try {
      const data = await exportData()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'mare-noctis-data.json'
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setToast({ tone: 'warning', message: `Export failed: ${String(e)}` })
    }
  }, [setToast])

  const handleUpdateName = useCallback(async () => {
    const trimmed = newName.trim()
    if (trimmed.length < 2) return
    setBusy(true)
    try {
      const updated = await updateDisplayName(trimmed)
      setAccount((a) => a ? { ...a, displayName: updated } : a)
      setToast({ tone: 'info', message: 'Call sign updated.' })
    } catch {
      setToast({ tone: 'warning', message: 'Could not update call sign.' })
    }
    setBusy(false)
  }, [newName, setToast])

  const handleSyncToCloud = useCallback(async () => {
    if (!account) return
    setSyncState('syncing')
    const currentData = {
      // From the constant, not a literal. A hardcoded version here silently
      // stops compiling — or worse, uploads a payload labelled with the wrong
      // schema — every time the schema moves.
      version: CURRENT_VERSION,
      settings,
      progress,
      keybinds,
    }
    const baseRevision = saveInfo?.revision ?? 0
    try {
      const result = await putSave(baseRevision, currentData)
      if (result.status === 'conflict') {
        setSyncState('conflict')
        setConflict(result)
      } else {
        setSaveInfo({ revision: result.revision ?? 0, savedAt: new Date().toISOString(), data: currentData })
        setSyncState('idle')
        setToast({ tone: 'info', message: 'Save synced to cloud.' })
      }
    } catch (e) {
      setSyncState('error')
      setToast({ tone: 'warning', message: `Sync failed: ${String(e)}` })
    }
  }, [account, settings, progress, keybinds, saveInfo, setToast])

  const handleKeepLocal = useCallback(() => {
    setConflict(null)
    setSyncState('idle')
    setToast({ tone: 'info', message: 'Kept local save.' })
  }, [setToast])

  const handleKeepServer = useCallback(() => {
    if (!conflict?.server) return
    setProgress(() => conflict.server?.progress ?? progress)
    setSaveInfo({ revision: conflict.serverRevision ?? 0, savedAt: new Date().toISOString(), data: conflict.server })
    setConflict(null)
    setSyncState('idle')
    setToast({ tone: 'info', message: 'Restored save from cloud.' })
  }, [conflict, progress, setProgress, setToast])

  const renderIdentityTab = () => {
    if (authStatus === 'loading') {
      return <p className={styles.status}>Checking session…</p>
    }

    if (authStatus === 'unavailable') {
      return (
        <div className={styles.tabContent}>
          <p className={styles.blurb}>
            Accounts are not enabled in this build. Your pilot record, settings
            and key bindings are saved in this browser and are working normally —
            there is simply no server here to copy them to.
          </p>
          <p className={styles.status}>
            Everything the game does offline, it does in full. Only cross-device
            sync and the verified leaderboard need the backend.
          </p>
        </div>
      )
    }

    if (authStatus === 'unauthenticated') {
      return (
        <div className={styles.tabContent}>
          <p className={styles.blurb}>
            Sign in to carry your pilot record across devices. Passkeys — no passwords, no credential stuffing.
          </p>
          <div className={styles.authActions}>
            <Button label="CREATE PASSKEY ACCOUNT" primary onClick={() => { void handleRegisterPasskey() }} full disabled={busy} />
            <Button label="SIGN IN WITH PASSKEY" onClick={() => { void handleLoginPasskey() }} full disabled={busy} />
          </div>
          <div className={styles.divider}><span>or email fallback</span></div>
          {magicSent ? (
            <p className={styles.magicSent}>Check your inbox — link valid for 15 minutes.</p>
          ) : (
            <div className={styles.magicForm}>
              <input
                id="magic-link-email"
                className={styles.emailInput}
                type="email"
                placeholder="pilot@example.com"
                value={magicEmail}
                onChange={(e) => { setMagicEmail(e.target.value) }}
                disabled={busy}
                aria-label="Email address for magic link"
              />
              <Button label="SEND SIGN-IN LINK" onClick={() => { void handleSendMagicLink() }} disabled={busy || !magicEmail} />
            </div>
          )}
        </div>
      )
    }

    // Authenticated
    return (
      <div className={styles.tabContent}>
        <div className={styles.pilotCard}>
          <div className={styles.pilotLabel}>PILOT</div>
          <div className={styles.pilotName}>{account?.displayName ?? '—'}</div>
          {account?.email && <div className={styles.pilotEmail}>{account.email}</div>}
        </div>

        <div className={styles.section}>
          <label className={styles.sectionLabel} htmlFor="display-name-input">CALL SIGN</label>
          <div className={styles.nameRow}>
            <input
              id="display-name-input"
              className={styles.nameInput}
              type="text"
              maxLength={32}
              value={newName}
              onChange={(e) => { setNewName(e.target.value) }}
              disabled={busy}
              aria-label="Display name"
            />
            <Button
              label="UPDATE"
              onClick={() => { void handleUpdateName() }}
              disabled={busy || newName.trim().length < 2}
            />
          </div>
        </div>

        <div className={styles.dangerZone}>
          <div className={styles.dangerLabel}>DANGER ZONE</div>
          <div className={styles.dangerActions}>
            <Button label="EXPORT MY DATA" onClick={() => { void handleExportData() }} />
            <Button label="SIGN OUT" onClick={() => { void handleLogout() }} disabled={busy} />
            <Button label="DELETE ACCOUNT" onClick={() => { void handleDeleteAccount() }} disabled={busy} />
          </div>
        </div>
      </div>
    )
  }

  const renderCloudSaveTab = () => {
    if (authStatus !== 'authenticated') {
      return (
        <div className={styles.tabContent}>
          <p className={styles.blurb}>
            {authStatus === 'unavailable'
              ? 'Cloud save needs a server, and this build has none. Your save lives in this browser and is complete.'
              : 'Sign in on the Identity tab to enable cloud save.'}
          </p>
        </div>
      )
    }

    if (syncState === 'conflict' && conflict) {
      return (
        <div className={styles.tabContent}>
          <div className={styles.conflictPanel}>
            <h3 className={styles.conflictTitle}>SAVE CONFLICT</h3>
            <p className={styles.conflictBlurb}>
              Your local and cloud saves have both changed since you last synced. Choose which to keep.
            </p>
            <div className={styles.conflictActions}>
              <div className={styles.conflictOption}>
                <div className={styles.conflictOptionLabel}>LOCAL SAVE</div>
                <div className={styles.conflictStat}>Score: {(conflict.client?.progress.bestScore ?? 0).toLocaleString()}</div>
                <Button label="KEEP LOCAL" onClick={handleKeepLocal} />
              </div>
              <div className={styles.conflictOption}>
                <div className={styles.conflictOptionLabel}>CLOUD SAVE</div>
                <div className={styles.conflictStat}>Score: {(conflict.server?.progress.bestScore ?? 0).toLocaleString()}</div>
                <Button label="KEEP CLOUD" primary onClick={handleKeepServer} />
              </div>
            </div>
          </div>
        </div>
      )
    }

    return (
      <div className={styles.tabContent}>
        <div className={styles.saveInfo}>
          {saveInfo ? (
            <>
              <div className={styles.saveRow}>
                <span className={styles.saveKey}>LAST SYNCED</span>
                <span className={styles.saveValue}>{new Date(saveInfo.savedAt).toLocaleString()}</span>
              </div>
              <div className={styles.saveRow}>
                <span className={styles.saveKey}>REVISION</span>
                <span className={styles.saveValue}>#{saveInfo.revision}</span>
              </div>
              <div className={styles.saveRow}>
                <span className={styles.saveKey}>BEST SCORE</span>
                <span className={styles.saveValue}>{saveInfo.data.progress.bestScore.toLocaleString()}</span>
              </div>
            </>
          ) : (
            <p className={styles.blurb}>No cloud save yet. Sync to create one.</p>
          )}
        </div>
        <Button
          label={syncState === 'syncing' ? 'SYNCING…' : 'SYNC TO CLOUD'}
          primary
          full
          onClick={() => { void handleSyncToCloud() }}
          disabled={syncState === 'syncing' || busy}
        />
        {syncState === 'error' && (
          <p className={styles.errorNote}>Sync failed. Check your connection and try again.</p>
        )}
      </div>
    )
  }

  const tabs = ['IDENTITY', 'CLOUD SAVE']

  return (
    <div className={styles.container} ref={containerRef} tabIndex={-1}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>ACCOUNT</h2>
        </div>
        <Tabs tabs={tabs} active={activeTab} onChange={setActiveTab} />
        <div className={styles.scrollArea} role="tabpanel">
          {activeTab === 'IDENTITY'    && renderIdentityTab()}
          {activeTab === 'CLOUD SAVE' && renderCloudSaveTab()}
        </div>
        <div className={styles.footer}>
          <Button label="BACK [ESC]" onClick={back} />
        </div>
      </div>
    </div>
  )
}
