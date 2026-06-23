const SUPABASE_URL = 'https://faasplsazadmtixuwzsn.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZhYXNwbHNhemFkbXRpeHV3enNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMTYyOTIsImV4cCI6MjA5Nzc5MjI5Mn0.hagIYaR3QzF41p99VQJU0J1C7_lnabBqlJ6MAhl7tbw'
const API_URL = 'http://localhost:4000'

let currentToken = null
let capturedScreenshot = null

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'))
  document.getElementById(id).classList.add('active')
}

async function supabasePost(path, body) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
    body: JSON.stringify(body),
  })
  return res.json()
}

async function apiGet(path, token) {
  const res = await fetch(`${API_URL}/api${path}`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  if (!res.ok) {
    const err = new Error(`API error: ${res.status}`)
    err.status = res.status
    throw err
  }
  return res.json()
}

async function apiPost(path, body, token) {
  const res = await fetch(`${API_URL}/api${path}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const err = new Error(data.message || `API error: ${res.status}`)
    err.status = res.status
    throw err
  }
  return res.json()
}

async function loadProjects(token) {
  const select = document.getElementById('project-select')
  try {
    const projects = await apiGet('/projects', token)
    select.innerHTML = ''
    if (projects.length === 0) {
      const opt = document.createElement('option')
      opt.value = ''
      opt.textContent = 'No projects yet — create one in the dashboard'
      select.appendChild(opt)
      document.getElementById('btn-submit').disabled = true
    } else {
      projects.forEach(p => {
        const opt = document.createElement('option')
        opt.value = p.id
        opt.textContent = p.name
        select.appendChild(opt)
      })
      document.getElementById('btn-submit').disabled = false
    }
  } catch (err) {
    if (err.status === 401) {
      await chrome.storage.local.remove(['qa_token', 'qa_email'])
      showScreen('screen-login')
      document.getElementById('login-error').textContent = 'Session expired — please sign in again.'
    } else {
      const opt = document.createElement('option')
      opt.value = ''
      opt.textContent = 'Failed to load projects'
      select.innerHTML = ''
      select.appendChild(opt)
    }
  }
}

async function init() {
  const stored = await chrome.storage.local.get(['qa_token', 'qa_email'])
  if (stored.qa_token) {
    currentToken = stored.qa_token
    document.getElementById('user-email-label').textContent = stored.qa_email || ''
    showScreen('screen-report')
    await loadProjects(currentToken)
  } else {
    showScreen('screen-login')
  }
}

document.getElementById('btn-login').addEventListener('click', async () => {
  const email = document.getElementById('login-email').value.trim()
  const password = document.getElementById('login-password').value
  const errorEl = document.getElementById('login-error')
  errorEl.textContent = ''

  if (!email || !password) { errorEl.textContent = 'Email and password required.'; return }

  const btn = document.getElementById('btn-login')
  btn.disabled = true
  btn.textContent = 'Signing in...'

  try {
    const data = await supabasePost('/auth/v1/token?grant_type=password', { email, password })
    if (data.error || !data.access_token) {
      errorEl.textContent = data.error_description || data.error || 'Login failed'
      return
    }
    await chrome.storage.local.set({ qa_token: data.access_token, qa_email: email })
    currentToken = data.access_token
    document.getElementById('user-email-label').textContent = email
    showScreen('screen-report')
    await loadProjects(currentToken)
  } catch (err) {
    errorEl.textContent = err.message
  } finally {
    btn.disabled = false
    btn.textContent = 'Sign in'
  }
})

document.getElementById('btn-signout').addEventListener('click', async () => {
  await chrome.storage.local.remove(['qa_token', 'qa_email'])
  currentToken = null
  capturedScreenshot = null
  document.getElementById('description').value = ''
  document.getElementById('screenshot-preview').style.display = 'none'
  document.getElementById('report-error').textContent = ''
  document.getElementById('report-success').textContent = ''
  showScreen('screen-login')
})

document.getElementById('btn-capture').addEventListener('click', async () => {
  const btn = document.getElementById('btn-capture')
  btn.textContent = 'Capturing...'
  btn.disabled = true
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' })
    capturedScreenshot = dataUrl
    const preview = document.getElementById('screenshot-preview')
    preview.src = dataUrl
    preview.style.display = 'block'
    btn.textContent = 'Recapture'
  } catch (err) {
    document.getElementById('report-error').textContent = 'Screenshot failed: ' + err.message
    btn.textContent = 'Capture Screenshot'
  }
  btn.disabled = false
})

document.getElementById('btn-submit').addEventListener('click', async () => {
  const description = document.getElementById('description').value.trim()
  const projectId = document.getElementById('project-select').value
  const errorEl = document.getElementById('report-error')
  const successEl = document.getElementById('report-success')
  errorEl.textContent = ''
  successEl.textContent = ''

  if (!description) { errorEl.textContent = 'Description is required.'; return }
  if (!projectId) { errorEl.textContent = 'Select a project.'; return }

  const btn = document.getElementById('btn-submit')
  btn.disabled = true
  btn.textContent = 'Submitting...'

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    const body = {
      project_id: projectId,
      description,
      url: tab.url,
      screenshot: capturedScreenshot || undefined,
    }
    await apiPost('/issues', body, currentToken)
    successEl.textContent = '✓ Bug report submitted!'
    document.getElementById('description').value = ''
    capturedScreenshot = null
    document.getElementById('screenshot-preview').style.display = 'none'
  } catch (err) {
    if (err.status === 401) {
      await chrome.storage.local.remove(['qa_token', 'qa_email'])
      showScreen('screen-login')
      document.getElementById('login-error').textContent = 'Session expired — please sign in again.'
    } else {
      errorEl.textContent = err.message
    }
  } finally {
    btn.disabled = false
    btn.textContent = 'Submit Bug Report'
  }
})

init()
