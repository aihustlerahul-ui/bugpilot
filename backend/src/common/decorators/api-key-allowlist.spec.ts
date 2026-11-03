import { API_KEY_ALLOWED } from './api-key-allowed.decorator';
import { IssuesController } from '../../issues/issues.controller';
import { ProjectsController } from '../../projects/projects.controller';
import { WorkspacesController } from '../../workspaces/workspaces.controller';

// Any new API-key-allowed route must be added here deliberately.
describe('API key allowlist', () => {
  it('marks exactly the approved routes', () => {
    const found: string[] = [];
    for (const ctrl of [IssuesController, ProjectsController, WorkspacesController]) {
      const classAllowed = Reflect.getMetadata(API_KEY_ALLOWED, ctrl);
      for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
        if (name === 'constructor') continue;
        const fn = (ctrl.prototype as any)[name];
        if (classAllowed || Reflect.getMetadata(API_KEY_ALLOWED, fn)) found.push(`${ctrl.name}.${name}`);
      }
    }
    expect(found.sort()).toEqual(
      [
        'IssuesController.findByProject',
        'IssuesController.findOne',
        'IssuesController.updateStatus',
        'ProjectsController.findAll',
        'ProjectsController.findOne',
      ].sort(),
    );
  });
});
