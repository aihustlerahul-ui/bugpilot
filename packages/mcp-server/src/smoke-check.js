/**
 * Optional local smoke — requires BUGPILOT_ACCESS_TOKEN + running Nest.
 * Does not fabricate results; exits non-zero on failure.
 */
import { apiGet, getConfig } from './client.js';

async function main() {
  const { apiUrl, defaultProjectId } = getConfig();
  console.log(`GET ${apiUrl}/api/projects …`);
  const projects = await apiGet('/api/projects');
  const count = Array.isArray(projects) ? projects.length : '?';
  console.log(`OK projects=${count}`);
  if (defaultProjectId) {
    console.log(`GET issues for ${defaultProjectId} …`);
    const issues = await apiGet(`/api/issues/project/${encodeURIComponent(defaultProjectId)}`);
    console.log(`OK issues=${Array.isArray(issues) ? issues.length : '?'}`);
  } else {
    console.log('Skip list_issues (BUGPILOT_PROJECT_ID unset)');
  }
}

main().catch((e) => {
  console.error('smoke failed:', e.message);
  process.exit(1);
});
