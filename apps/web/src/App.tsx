import { ProjectId } from '@myleaf/doc-model';
import { useEffect, useState } from 'react';
import { SettingsProvider } from './settings/use-settings.js';
import { ProjectList } from './projects/ProjectList.js';
import { Workspace } from './workspace/Workspace.js';

const PROJECT_ROUTE = /^#\/projects\/([^/]+)$/;

/** Hash-based routing: `#/` lists projects, `#/projects/<id>` opens one. */
export function App() {
  const [hash, setHash] = useState(window.location.hash);

  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const match = PROJECT_ROUTE.exec(hash);
  const projectId = match?.[1] === undefined ? null : ProjectId(decodeURIComponent(match[1]));
  return (
    <SettingsProvider>
      {projectId === null ? <ProjectList /> : <Workspace key={projectId} projectId={projectId} />}
    </SettingsProvider>
  );
}
