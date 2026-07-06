/**
 * Selfmade extension — background service worker (MV3).
 * Owns the auth token + all authenticated calls to the Selfmade API. Content scripts and the popup
 * message us; we never expose the token to page context. Background fetches inherit host_permissions
 * so they bypass CORS.
 */
const API_BASE = 'https://www.tryselfmade.ai'

async function getToken() {
  const { sm_token } = await chrome.storage.local.get('sm_token')
  return sm_token || null
}
async function getEmail() {
  const { sm_email } = await chrome.storage.local.get('sm_email')
  return sm_email || ''
}

/** One-click SSO via the /extension/auth page → token comes back in the redirect hash. */
async function signIn() {
  const redirectUri = chrome.identity.getRedirectURL() // https://<id>.chromiumapp.org/
  const authUrl = `${API_BASE}/extension/auth?redirect_uri=${encodeURIComponent(redirectUri)}`
  const finalUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true })
  if (!finalUrl) throw new Error('Sign-in cancelled')
  const hash = finalUrl.split('#')[1] || ''
  const p = new URLSearchParams(hash)
  const token = p.get('token')
  const email = p.get('email') || ''
  if (!token) throw new Error('No token returned')
  await chrome.storage.local.set({ sm_token: token, sm_email: email })
  return { email }
}

async function signOut() {
  await chrome.storage.local.remove(['sm_token', 'sm_email'])
}

async function apiFetch(path, opts = {}) {
  const token = await getToken()
  if (!token) return { status: 401, json: { error: 'Not signed in' } }
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  })
  let json = {}
  try { json = await res.json() } catch {}
  if (res.status === 401) await signOut() // stale/revoked key → force re-auth
  return { status: res.status, json }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  ;(async () => {
    try {
      switch (msg?.type) {
        case 'getAuth': {
          const token = await getToken()
          sendResponse({ signedIn: !!token, email: await getEmail() })
          break
        }
        case 'signIn': {
          const r = await signIn()
          sendResponse({ ok: true, email: r.email })
          break
        }
        case 'signOut': {
          await signOut()
          sendResponse({ ok: true })
          break
        }
        case 'getBoards': {
          const r = await apiFetch('/api/extension/boards')
          sendResponse({ ok: r.status === 200, ...r.json })
          break
        }
        case 'saveAd': {
          const payload = msg.payload || {}
          // Apply the popup's default-board choice unless the caller already set one.
          if (!payload.board_id) {
            const { sm_board } = await chrome.storage.local.get('sm_board')
            if (sm_board) payload.board_id = sm_board
          }
          const r = await apiFetch('/api/extension/save', { method: 'POST', body: JSON.stringify(payload) })
          sendResponse({ ok: r.status === 200, status: r.status, ...r.json })
          break
        }
        default:
          sendResponse({ error: 'unknown message' })
      }
    } catch (e) {
      sendResponse({ error: e?.message || String(e) })
    }
  })()
  return true // async response
})
