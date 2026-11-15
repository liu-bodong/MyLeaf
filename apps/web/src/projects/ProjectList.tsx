import type { ProjectDto } from '@myleaf/api';
import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { api } from '../api/client.js';

export function ProjectList() {
  const [projects, setProjects] = useState<readonly ProjectDto[] | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const zipInput = useRef<HTMLInputElement>(null);

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

  /** The typed name if there is one, else the zip's file name without `.zip`. */
  const importZip = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file === undefined) return;
    const projectName = name.trim() === '' ? file.name.replace(/\.zip$/i, '') : name;
    setImporting(true);
    setError(null);
    try {
      const project = await api.importProject(projectName, file);
      window.location.hash = `#/projects/${project.id}`;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setImporting(false);
    }
  };

  const remove = async (project: ProjectDto) => {
    if (!window.confirm(`Delete project "${project.name}" and all its files?`)) return;
    await api.deleteProject(project.id);
    setProjects((current) => current?.filter((p) => p.id !== project.id) ?? null);
  };

  return (
    <div className="project-list">
      <h1>Projects</h1>
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
        <button type="button" disabled={importing} onClick={() => zipInput.current?.click()}>
          {importing ? 'Uploading…' : 'Upload .zip'}
        </button>
        <input
          ref={zipInput}
          type="file"
          accept=".zip,application/zip"
          aria-label="Upload project zip"
          hidden
          onChange={(event) => void importZip(event)}
        />
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
