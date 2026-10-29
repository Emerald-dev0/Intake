/**
 * The release readiness checklist.
 *
 * Two kinds of check, and the difference is the whole point:
 *
 *   - **automatic** items are computed from real state (is the copy written, did the deployment
 *     succeed, is there a recorded approval). Intake never guesses them and never marks them
 *     passed because a field was empty.
 *   - **manual** items need a person to say what happened. Until they do, the item reads
 *     "Not confirmed" — never "Passed". An administrator may explicitly mark an item as not
 *     applicable, and that decision is stored and audited.
 */

import type { ChecklistItem, ChecklistKey, ChecklistDecision, ReleaseRecord, ReleaseSource } from './contracts.ts';
import { hasTodoMarker } from './validation.ts';

export interface ChecklistDecisionRow {
  key: ChecklistKey;
  decision: ChecklistDecision;
  note: string | null;
}

interface ChecklistDefinition {
  key: ChecklistKey;
  label: string;
  kind: 'automatic' | 'manual';
  manualPrompt: string;
}

const DEFINITIONS: ChecklistDefinition[] = [
  { key: 'content', label: 'Changelog content prepared', kind: 'automatic', manualPrompt: '' },
  { key: 'tests', label: 'Relevant tests passed', kind: 'manual', manualPrompt: 'Record the test run you relied on, or mark it not applicable.' },
  { key: 'typecheck', label: 'Type check, lint and production build completed', kind: 'manual', manualPrompt: 'Record the type check, lint and build you ran, or mark it not applicable.' },
  { key: 'migrations', label: 'Database migrations reviewed', kind: 'manual', manualPrompt: 'Name the migration you reviewed, or mark it not applicable for a release without schema changes.' },
  { key: 'documentation', label: 'Documentation updated', kind: 'manual', manualPrompt: 'Name the documentation you updated, or mark it not applicable.' },
  { key: 'claims', label: 'Public-facing claims verified against the build', kind: 'manual', manualPrompt: 'Confirm the announcement only claims what actually shipped, or mark it not applicable.' },
  { key: 'preview', label: 'Preview reviewed', kind: 'manual', manualPrompt: 'Confirm you read the public preview, or mark it not applicable.' },
  { key: 'deployment', label: 'Production deployment succeeded', kind: 'automatic', manualPrompt: '' },
  { key: 'approval', label: 'Administrator approval recorded', kind: 'automatic', manualPrompt: '' },
];

/** Statuses that let a release be published. */
const PASSING: ReadonlySet<string> = new Set(['verified', 'confirmed', 'not_applicable']);

export function checklistDefinitions(): ChecklistDefinition[] {
  return DEFINITIONS;
}

function contentStatus(release: ReleaseRecord): { status: ChecklistItem['status']; detail: string } {
  const missing: string[] = [];
  if (!release.title.trim()) missing.push('a title');
  if (!release.summary.trim()) missing.push('a summary');
  if (!release.body.trim()) missing.push('release notes');
  if (release.categories.length === 0) missing.push('at least one category');
  if (!release.releaseDate) missing.push('a publication date');
  if (missing.length > 0) return { status: 'blocked', detail: `Still missing ${missing.join(', ')}.` };
  if (hasTodoMarker(release.body)) return { status: 'blocked', detail: 'The release notes still contain TODO markers. Write the real text before publishing.' };
  return { status: 'verified', detail: 'Title, summary, notes, categories and publication date are all set.' };
}

function deploymentStatus(sources: ReleaseSource[]): { status: ChecklistItem['status']; detail: string } {
  const deployments = sources.filter(source => source.kind === 'deployment');
  if (deployments.length === 0) return { status: 'unknown', detail: 'No deployment is linked to this release, so production state is unknown.' };
  const success = deployments.find(source => source.deploymentState === 'success');
  if (success) {
    const environment = success.deploymentEnvironment ? ` (${success.deploymentEnvironment})` : '';
    return { status: 'verified', detail: `A deployment was observed as successful${environment}.` };
  }
  const failed = deployments.find(source => source.deploymentState === 'failure' || source.deploymentState === 'error');
  if (failed) {
    const environment = failed.deploymentEnvironment ? ` (${failed.deploymentEnvironment})` : '';
    return { status: 'blocked', detail: `The linked deployment was observed as ${failed.deploymentState}${environment}. Redeploy before publishing.` };
  }
  const pending = deployments.find(source => source.deploymentState && source.deploymentState !== 'unknown');
  if (pending) return { status: 'unknown', detail: `The linked deployment is ${pending.deploymentState}. Intake cannot confirm production state yet.` };
  return { status: 'unknown', detail: 'The linked deployment has no observed status yet.' };
}

function approvalStatus(release: ReleaseRecord): { status: ChecklistItem['status']; detail: string } {
  if (release.approvedAt && release.approvedByUserId) return { status: 'verified', detail: 'An administrator approved this release.' };
  if (release.approvedAt) return { status: 'verified', detail: 'An administrator approved this release.' };
  return { status: 'blocked', detail: 'No administrator has approved this release yet.' };
}

export function evaluateChecklist(input: {
  release: ReleaseRecord;
  sources: ReleaseSource[];
  decisions: ChecklistDecisionRow[];
}): ChecklistItem[] {
  const decisions = new Map(input.decisions.map(row => [row.key, row]));
  return DEFINITIONS.map(definition => {
    const decision = decisions.get(definition.key);
    if (definition.kind === 'automatic') {
      const computed = definition.key === 'content'
        ? contentStatus(input.release)
        : definition.key === 'deployment'
          ? deploymentStatus(input.sources)
          : approvalStatus(input.release);
      // A person may only downgrade an automatic item to "not applicable", and only with a note.
      if (decision?.decision === 'not_applicable') {
        return {
          key: definition.key,
          label: definition.label,
          kind: definition.kind,
          status: 'not_applicable' as const,
          detail: decision.note?.trim() || 'Marked not applicable by an administrator.',
          notApplicable: true,
        };
      }
      return {
        key: definition.key,
        label: definition.label,
        kind: definition.kind,
        status: computed.status,
        detail: computed.detail,
        notApplicable: false,
      };
    }
    const status = decision?.decision ?? 'unconfirmed';
    return {
      key: definition.key,
      label: definition.label,
      kind: definition.kind,
      status,
      detail: decision?.note?.trim() || (status === 'unconfirmed' ? definition.manualPrompt : 'Confirmed by an administrator.'),
      notApplicable: status === 'not_applicable',
    };
  });
}

/** Items that stop a release from being published, in the order they should be read. */
export function blockingItems(items: ChecklistItem[]): ChecklistItem[] {
  return items.filter(item => !PASSING.has(item.status));
}

export function checklistReady(items: ChecklistItem[]): boolean {
  return blockingItems(items).length === 0;
}
