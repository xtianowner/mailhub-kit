import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import { api } from '../lib/api.js'

// Auth gate state. Only meaningful when the backend reports auth_enabled=true.
// When auth_enabled=false (default) the app runs fully open — no login wall.
const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  // status: 'checking' | 'ready' (always falls through to the app once known)
  const [status, setStatus] = useState('checking')
  const [authEnabled, setAuthEnabled] = useState(false)
  const [authed, setAuthed] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const s = await api.authStatus()
      setAuthEnabled(!!s.auth_enabled)
      setAuthed(!!s.authed)
    } catch {
      // If auth-status itself fails, don't hard-block the app — assume open.
      setAuthEnabled(false)
      setAuthed(true)
    } finally {
      setStatus('ready')
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // login(token) → true on success; caller toasts on false.
  const login = useCallback(async (token) => {
    try {
      const res = await api.login(token)
      if (res?.authed) {
        setAuthed(true)
        setAuthEnabled(true)
        return true
      }
      return false
    } catch {
      return false
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.logout()
    } catch {
      /* best-effort; still drop local authed */
    }
    setAuthed(false)
  }, [])

  // Only block with the login page when auth is enabled AND not authed.
  const requiresLogin = authEnabled && !authed

  const value = useMemo(
    () => ({ status, authEnabled, authed, requiresLogin, login, logout, refresh }),
    [status, authEnabled, authed, requiresLogin, login, logout, refresh],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
