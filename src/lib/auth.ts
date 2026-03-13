const TOKEN_KEY = 'aivy-token'

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // Ignore storage errors
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Ignore storage errors
  }
}

export function getAuthHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** Decode the JWT payload without verification to extract the accountId for display */
export function getSessionAccountId(): string | null {
  const token = getToken()
  if (!token) return null
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(atob(parts[1])) as { accountId?: string; exp?: number }
    // Check expiry
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      clearToken()
      return null
    }
    return payload.accountId ?? null
  } catch {
    return null
  }
}
