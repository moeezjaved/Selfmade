const APP = 'https://www.tryselfmade.ai'
const $ = (id) => document.getElementById(id)

$('logo').src = chrome.runtime.getURL('icons/icon48.png')
$('openApp').href = `${APP}/discovery/saved`

function show(view) {
  $('loading').classList.add('hide')
  $('signedIn').classList.toggle('hide', view !== 'in')
  $('signedOut').classList.toggle('hide', view !== 'out')
}

function msg(type, extra = {}) {
  return new Promise((resolve) => chrome.runtime.sendMessage({ type, ...extra }, resolve))
}

async function loadBoards() {
  const r = await msg('getBoards')
  if (!r?.ok || !Array.isArray(r.boards)) return
  const sel = $('board')
  const { sm_board } = await chrome.storage.local.get('sm_board')
  sel.innerHTML = ''
  // Always offer the auto default first.
  const def = document.createElement('option'); def.value = ''; def.textContent = '🌐 Saved from Web (default)'; sel.appendChild(def)
  for (const b of r.boards) {
    const o = document.createElement('option')
    o.value = b.id
    o.textContent = `${b.emoji || '📋'} ${b.name}${b.visibility === 'team' ? ' · team' : ''}`
    sel.appendChild(o)
  }
  if (sm_board) sel.value = sm_board
}

$('board').addEventListener('change', (e) => chrome.storage.local.set({ sm_board: e.target.value }))

$('signIn').addEventListener('click', async () => {
  $('signIn').textContent = 'Opening…'
  const r = await msg('signIn')
  if (r?.ok) init()
  else { $('signIn').textContent = 'Sign in with Selfmade'; if (r?.error) alert(r.error) }
})

$('signOut').addEventListener('click', async () => { await msg('signOut'); init() })

async function init() {
  const a = await msg('getAuth')
  if (a?.signedIn) {
    $('email').textContent = a.email || 'Signed in'
    show('in')
    loadBoards()
  } else {
    show('out')
  }
}
init()
