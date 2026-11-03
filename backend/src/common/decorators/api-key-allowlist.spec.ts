import * as fs from 'fs';
import * as path from 'path';
import { API_KEY_ALLOWED } from './api-key-allowed.decorator';

const SRC = path.resolve(__dirname, '../..');

function findControllers(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findControllers(full));
    else if (entry.name.endsWith('.controller.ts')) out.push(full);
  }
  return out;
}

// Any new API-key-allowed route must be added here deliberately.
// The scan covers EVERY *.controller.ts under backend/src, so a decorator added
// to any controller (api-keys, members, integrations, ai, auth, replay...) fails this test.
describe('API key allowlist', () => {
  it('marks exactly the approved routes', () => {
    const files = findControllers(SRC);
    expect(files.length).toBeGreaterThanOrEqual(10);

    const found: string[] = [];
    for (const file of files) {
      const mod = require(file);
      for (const exported of Object.values(mod)) {
        if (typeof exported !== 'function' || !/Controller$/.test(exported.name)) continue;
        const ctrl = exported as { name: string; prototype: any };
        const classAllowed = Reflect.getMetadata(API_KEY_ALLOWED, ctrl);
        for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
          if (name === 'constructor') continue;
          const fn = ctrl.prototype[name];
          if (classAllowed || Reflect.getMetadata(API_KEY_ALLOWED, fn)) found.push(`${ctrl.name}.${name}`);
        }
      }
    }
    expect(found.sort()).toEqual(
      [
        'IssuesController.addComment',
        'IssuesController.assign',
        'IssuesController.findByProject',
        'IssuesController.findOne',
        'IssuesController.listAssignableMembers',
        'IssuesController.listComments',
        'IssuesController.updateStatus',
        'ProjectsController.findAll',
        'ProjectsController.findOne',
      ].sort(),
    );
  });
});
