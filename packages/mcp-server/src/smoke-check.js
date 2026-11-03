/**
 * Optional live smoke. Needs a running Nest API plus credentials:
 *   BUGPILOT_API_KEY + BUGPILOT_WORKSPACE_ID (or legacy BUGPILOT_ACCESS_TOKEN).
 * Read-only. Exits non-zero on failure. Never prints the credential.
 */
import { apiRequest, getConfig } from './client.js';

const count = (v) => (Array.isArray(v) ? v.length : '?');

async function main() {
  const { apiUrl, defaultProjectId } = getConfig();
  console.log(`GET ${apiUrl}/api/projects ...`);
  const projects = await apiRequest('GET', '/api/projects');
  console.log(`OK projects=${count(projects)}`);

  const projectId = defaultProjectId ?? (Array.isArray(projects) ? projects[0]?.id : undefined);
  if (!projectId) {
    console.log('Skip issues/members (no project available; set BUGPILOT_PROJECT_ID)');
    return;
  }
  const pid = encodeURIComponent(projectId);
  const issues = await apiRequest('GET', `/api/issues/project/${pid}`);
  console.log(`OK issues=${count(issues)}`);
  const members = await apiRequest('GET', `/api/issues/project/${pid}/members`);
  console.log(`OK members=${count(members)}`);
}

main().catch((e) => {
  console.error('smoke failed:', e.message);
  process.exit(1);
});
