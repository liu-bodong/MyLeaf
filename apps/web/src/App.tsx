import { ProjectId } from '@myleaf/doc-model';
import { useEffect, useState } from 'react';
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
  if (match?.[1] !== undefined) {
    const projectId = ProjectId(decodeURIComponent(match[1]));
    return <Workspace key={projectId} projectId={projectId} />;
  }
  return <ProjectList />;
}
