import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  reconcileAgentWorkspaceIdentities,
  resolveAgentWorkspaceProjections,
  type AgentWorkspaceAgentRecord,
  type AgentWorkspaceProjectRecord,
} from './agentWorkspaceIdentity';

const compatibilityFixture = JSON.parse(readFileSync(
  new URL('./fixtures/agent-workspace-compatibility.json', import.meta.url),
  'utf8',
)) as {
  projects: TestProject[];
  agents: TestAgent[];
  expectedProjections: Array<{
    agentId: string;
    workspacePath: string;
    association: string;
  }>;
};

interface TestProject extends AgentWorkspaceProjectRecord {
  hidden?: boolean;
  archivedAt?: string;
}

interface TestAgent extends AgentWorkspaceAgentRecord {
  name: string;
  enabled: boolean;
}

function project(id: string, path: string, agentId?: string): TestProject {
  return { id, name: id, path, agentId };
}

function agent(id: string, workspacePath?: string, enabled = false): TestAgent {
  return { id, name: id, enabled, ...(workspacePath ? { workspacePath } : {}) } as TestAgent;
}

function reconcile(projects: TestProject[], agents: TestAgent[]) {
  let nextId = 0;
  return reconcileAgentWorkspaceIdentities(projects, agents, {
    buildAgent: (_source, requestedId) => agent(requestedId ?? `created-${++nextId}`),
  });
}

describe('reconcileAgentWorkspaceIdentities', () => {
  it('retains workspace conflict evidence from an unselectable Project', () => {
    const projects = [project('', '/same', 'bad'), project('ambiguous', '/same', 'affected'), project('healthy', '/healthy', 'good')];
    const agents = [agent('bad'), agent('affected'), agent('good')];
    for (const result of [reconcile(projects, agents), resolveAgentWorkspaceProjections(projects, agents)]) {
      expect(result.agentProjections.map(item => item.agentId)).toEqual(['good']);
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'DUPLICATE_PROJECT_WORKSPACE', projectIds: ['', 'ambiguous'] }));
    }
    expect(reconcile(projects, agents).projects).toEqual(projects);
    expect(reconcile(projects, agents).agents).toEqual(agents);
  });

  it('isolates a missing Agent id without changing the row or hiding healthy identities', () => {
    const bad = { name: 'historical row', enabled: false } as TestAgent;
    const result = reconcile([project('healthy', '/healthy', 'good')], [agent('good'), bad]);
    expect(result.identities.map(item => item.agentId)).toEqual(['good']);
    expect(result.agents).toContain(bad);
    expect(result.changed).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'INVALID_AGENT_IDENTITY' }));
  });

  it('isolates duplicate IDs in both read-only and repairing projections without choosing a winner', () => {
    const projects = [project('bad-project', '/bad', 'duplicate'), project('healthy', '/healthy', 'good')];
    const agents = [agent('duplicate'), agent('duplicate'), agent('good')];
    for (const result of [reconcile(projects, agents), resolveAgentWorkspaceProjections(projects, agents)]) {
      expect(result.agentProjections.map(item => item.agentId)).toEqual(['good']);
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'DUPLICATE_AGENT_ID', agentIds: ['duplicate'], projectIds: ['bad-project'] }));
    }
    expect(reconcile(projects, agents).createdAgentIds).toEqual([]);
  });

  it('does not let unrelated legacy evidence override a healthy explicit Project claim', () => {
    const bad = { name: 'old row', workspacePath: '/healthy' } as unknown as TestAgent;
    const result = reconcile([project('healthy', '/healthy', 'good')], [agent('good'), bad]);
    expect(result.identities.map(item => item.agentId)).toEqual(['good']);
    expect(result.changed).toBe(false);
  });

  it('does not recreate an Agent claimed by both an invalid and a valid Project', () => {
    const result = reconcile([project('bad', '', 'shared'), project('other', '/other', 'shared'), project('healthy', '/healthy', 'good')], [agent('shared'), agent('good')]);
    expect(result.identities.map(item => item.agentId)).toEqual(['good']);
    expect(result.createdAgentIds).toEqual([]);
  });

  it('preserves a missing-id legacy row and its associated project without inventing a replacement', () => {
    const bad = { name: 'historical row', enabled: true, workspacePath: '/bad' } as unknown as TestAgent;
    const result = reconcile([project('bad-project', '/bad'), project('healthy', '/healthy', 'good')], [bad, agent('good')]);
    expect(result.identities.map(item => item.agentId)).toEqual(['good']);
    expect(result.createdAgentIds).toEqual([]);
    expect(result.projects[0].agentId).toBeUndefined();
    expect(result.agents[0]).toBe(bad);
  });

  it.each(['missing-id', 'missing-path', 'duplicate-id'])('isolates %s Projects while retaining their source rows', kind => {
    const invalid = project(kind === 'missing-id' ? '' : 'bad', kind === 'missing-path' ? '' : '/bad', 'bad-agent');
    const projects = [invalid, ...(kind === 'duplicate-id' ? [project('bad', '/other', 'other-agent')] : []), project('healthy', '/healthy', 'good')];
    const agents = [agent('bad-agent'), agent('other-agent'), agent('good')];
    const result = reconcile(projects, agents);
    expect(result.identities.map(item => item.agentId)).toEqual(['good']);
    expect(result.projects).toEqual(projects);
    expect(result.agents).toEqual(agents);
    expect(result.createdAgentIds).toEqual([]);
  });

  it('matches the shared TS/Rust compatibility projection fixture', () => {
    const result = resolveAgentWorkspaceProjections(
      compatibilityFixture.projects,
      compatibilityFixture.agents,
    );

    expect(result.agentProjections.map(({ agentId, workspacePath, association }) => ({
      agentId,
      workspacePath,
      association,
    }))).toEqual(compatibilityFixture.expectedProjections);
  });

  it('creates and links the one required Agent identity without mutating its inputs', () => {
    const projects = [project('project-1', '/work/one')];
    const agents: TestAgent[] = [];

    const result = reconcile(projects, agents);

    expect(result.changed).toBe(true);
    expect(result.createdAgentIds).toEqual(['created-1']);
    expect(result.projects[0]).toMatchObject({
      agentId: 'created-1',
    });
    expect(result.projects[0].isAgent).toBeUndefined();
    expect(result.agents[0]).not.toHaveProperty('workspacePath');
    expect(result.identities[0]).toMatchObject({
      projectId: 'project-1',
      agentId: 'created-1',
      workspacePath: '/work/one',
    });
    expect(projects[0].agentId).toBeUndefined();
    expect(agents).toEqual([]);
  });

  it('repairs a stale link from the first canonical workspace match', () => {
    const result = reconcile(
      [project('project-1', 'C:\\Users\\Me\\Workspace', 'missing-agent')],
      [
        agent('agent-first', 'c:/users/me/workspace/'),
        agent('agent-second', 'C:\\USERS\\ME\\WORKSPACE'),
      ],
    );

    expect(result.createdAgentIds).toEqual([]);
    expect(result.relinkedProjectIds).toEqual(['project-1']);
    expect(result.projects[0].agentId).toBe('agent-first');
  });

  it('uses a valid explicit link before legacy path evidence and projects extras through Project.path', () => {
    const result = reconcile(
      [project('project-1', '/work/moved', 'agent-linked')],
      [
        agent('agent-extra', '/work/moved'),
        agent('agent-linked', '/work/old-location'),
      ],
    );

    expect(result.identities[0]).toMatchObject({
      agentId: 'agent-linked',
      workspacePath: '/work/moved',
    });
    expect(result.projects[0].agentId).toBe('agent-linked');
    expect(result.agentProjections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        agentId: 'agent-extra',
        association: 'legacy-project',
        workspacePath: '/work/moved',
        canMutateProjectLifecycle: false,
      }),
      expect.objectContaining({
        agentId: 'agent-linked',
        association: 'project-linked',
        workspacePath: '/work/moved',
        canMutateProjectLifecycle: true,
      }),
    ]));
  });

  it('preserves orphan Agents and exposes their old path only through compatibility projection', () => {
    const orphan = agent('orphan', '/work/orphan');
    const result = reconcile([project('project-1', '/work/one')], [orphan]);

    expect(result.agents.map(item => item.id)).toEqual(['orphan', 'created-1']);
    expect(result.identities.map(item => item.agentId)).toEqual(['created-1']);
    expect(result.agentProjections).toContainEqual(expect.objectContaining({
      agentId: 'orphan',
      association: 'legacy-orphan',
      workspacePath: '/work/orphan',
      canMutateProjectLifecycle: false,
    }));
  });

  it('reuses a stale id when no legacy Agent matches', () => {
    const result = reconcile(
      [project('project-1', '/work/one', 'stale-agent-id')],
      [],
    );

    expect(result.projects[0].agentId).toBe('stale-agent-id');
    expect(result.createdAgentIds).toEqual(['stale-agent-id']);
    expect(result.agents[0]).toEqual(expect.objectContaining({ id: 'stale-agent-id' }));
    expect(result.agents[0]).not.toHaveProperty('workspacePath');
  });

  it('isolates duplicate canonical Project workspaces while preserving healthy identities', () => {
    const result = reconcile(
      [
        project('project-1', 'D:\\Work'),
        project('project-2', 'd:/work/'),
        project('project-healthy', '/healthy', 'agent-healthy'),
      ],
      [agent('agent-healthy', '/healthy')],
    );

    expect(result.identities.map(identity => identity.projectId)).toEqual(['project-healthy']);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'DUPLICATE_PROJECT_WORKSPACE',
      projectIds: ['project-1', 'project-2'],
    }));
  });

  it('isolates duplicate explicit Agent claims while preserving healthy identities', () => {
    const result = reconcile(
      [
        project('project-one', '/one', 'agent-one'),
        project('project-two', '/two', 'agent-one'),
        project('project-healthy', '/healthy', 'agent-healthy'),
      ],
      [agent('agent-one', '/one'), agent('agent-healthy', '/healthy')],
    );

    expect(result.identities.map(identity => identity.projectId)).toEqual(['project-healthy']);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'AGENT_ASSIGNED_TO_MULTIPLE_PROJECTS',
      agentIds: ['agent-one'],
      projectIds: ['project-one', 'project-two'],
    }));
  });

  it('keeps hidden and archived Projects in the identity invariant', () => {
    const projects = [
      { ...project('hidden', '/work/hidden'), hidden: true },
      { ...project('archived', '/work/archived'), archivedAt: '2026-08-01T00:00:00.000Z' },
    ];
    const result = reconcile(projects, []);

    expect(result.identities).toHaveLength(2);
    expect(result.projects.every(item => item.agentId)).toBe(true);
  });

  it('only promotes the legacy isAgent projection for enabled Agents', () => {
    const result = reconcile(
      [project('disabled-project', '/disabled'), project('enabled-project', '/enabled')],
      [agent('disabled-agent', '/disabled'), agent('enabled-agent', '/enabled', true)],
    );

    expect(result.projects[0].isAgent).toBeUndefined();
    expect(result.projects[1].isAgent).toBe(true);
  });
});
