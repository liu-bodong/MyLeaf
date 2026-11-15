import type { ProjectDto } from '@myleaf/api';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api/client.js';
import { SettingsButton } from '../settings/SettingsButton.js';

export function ProjectList() {
  const [projects, setProjects] = useState<readonly ProjectDto[] | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listProjects().then(setProjects, (reason: unknown) => setError(String(reason)));
  }, []);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const project = await api.createProject(name);
      window.location.hash = `#/projects/${project.id}`;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const remove = async (project: ProjectDto) => {
    if (!window.confirm(`Delete project "${project.name}" and all its files?`)) return;
    await api.deleteProject(project.id);
    setProjects((current) => current?.filter((p) => p.id !== project.id) ?? null);
  };

  return (
    <div className="project-list">
      <header className="project-list-header">
        <h1>Projects</h1>
        <SettingsButton />
      </header>
      <form onSubmit={(event) => void create(event)}>
        <input
          aria-label="New project name"
          placeholder="New project name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <button className="primary" type="submit" disabled={name.trim() === ''}>
          Create
        </button>
      </form>
      {error !== null && <p className="error">{error}</p>}
      {projects === null ? (
        <p className="loading">Loading…</p>
      ) : projects.length === 0 ? (
        <p className="placeholder">No projects yet.</p>
      ) : (
        <ul>
          {projects.map((project) => (
            <li key={project.id}>
              <a href={`#/projects/${project.id}`}>{project.name}</a>
              <span className="meta">{new Date(project.createdAt).toLocaleString()}</span>
              <button
                onClick={() => void remove(project).catch((r: unknown) => setError(String(r)))}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
