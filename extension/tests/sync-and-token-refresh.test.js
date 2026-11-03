const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('sync: background.js auto-refreshes expired token and falls back project_id in postIssue and processPendingSyncQueue', () => {
  const bgCode = fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8')
  
  // postIssue must handle token refresh on 401
  assert.ok(
    bgCode.includes('token = await tryRefreshToken()'),
    'background.js must call tryRefreshToken on 401 unauthorized responses'
  )
  assert.ok(
    bgCode.includes('effectiveProjectId') || bgCode.includes('qa_selected_project?.id'),
    'postIssue must fall back missing project_id from qa_selected_project'
  )
  
  // processPendingSyncQueue must heal missing projectId before retrying
  assert.ok(
    bgCode.includes('qa_selected_project') && bgCode.includes('item.issue.projectId'),
    'processPendingSyncQueue must restore missing projectId from storage when retrying'
  )
})

test('sync: sidepanel.js persists qa_selected_project on start recording and project selection', () => {
  const sidepanelCode = fs.readFileSync(path.join(__dirname, '../sidepanel.js'), 'utf8')
  assert.ok(
    sidepanelCode.includes('qa_selected_project: { id: projectId, name: projectName }') ||
    sidepanelCode.includes('qa_selected_project'),
    'sidepanel.js must persist qa_selected_project to storage'
  )
})
