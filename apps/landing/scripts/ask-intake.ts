/**
 * Ask Intake one thing, outside the product.
 *
 * Prompt work needs a tight loop: change the brief, send one request, read the answer. Going through
 * the app for that means a session, a draft, a provider connection and a credit charge. This script
 * does none of that — it builds the same interpreter the server builds, sends a single request, and
 * prints both the model's sentence and the structured result, plus any voice problems the guard
 * would have retried.
 *
 *   GROQ_API_KEY=... npx tsx scripts/ask-intake.ts "RSVP for our dinner: name, headcount, dietary needs"
 *   GROQ_API_KEY=... npx tsx scripts/ask-intake.ts --provider typeform "Sign-up form with department"
 *   OPENAI_API_KEY=... npx tsx scripts/ask-intake.ts --openai "Make email optional" --revise <draft.json>
 *
 * It never writes to a database, never calls a provider API, never charges a credit, and never
 * touches a user's account. It requires a real key because the point is to see the real model.
 */
import { readFile } from 'node:fs/promises';
import { resolveAiProvider } from '../server/ai/registry.ts';
import { assessInterpretation, InterpretationError } from '../server/forms/interpretation/interpreter.ts';
import { createFormInterpreter } from '../server/forms/interpretation/provider-interpreter.ts';
import { voiceFeedback, voiceIssues } from '../server/forms/interpretation/voice.ts';
import { parseFormSpecification } from '../server/forms/validation.ts';
import type { FormSpecification } from '../server/forms/specification.ts';

function usage(message?: string): never {
  if (message) console.error(`\n${message}`);
  console.error(`\nUsage: npx tsx scripts/ask-intake.ts [--provider google|typeform] [--openai] [--revise <spec.json>] "your request"`);
  process.exit(message ? 1 : 0);
}

function parseArgs(argv: string[]) {
  const flags = { provider: 'google' as 'google' | 'typeform', openai: false, revise: null as string | null };
  const words: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') usage();
    else if (arg === '--openai') flags.openai = true;
    else if (arg === '--provider') {
      const value = argv[++index];
      if (value !== 'google' && value !== 'typeform') usage('--provider must be google or typeform.');
      flags.provider = value;
    } else if (arg === '--revise') {
      const value = argv[++index];
      if (!value) usage('--revise needs a path to a specification JSON file.');
      flags.revise = value;
    } else words.push(arg);
  }
  const request = words.join(' ').trim();
  if (!request) usage('Say what the form should collect.');
  if (request.length > 3000) usage('Intake accepts up to 3000 characters.');
  return { ...flags, request };
}

const args = parseArgs(process.argv.slice(2));
const env: NodeJS.ProcessEnv = { ...process.env, AI_PROVIDER: args.openai ? 'openai' : 'groq' };
if (!env.GROQ_API_KEY && !env.OPENAI_API_KEY) {
  usage('Set GROQ_API_KEY (or OPENAI_API_KEY with --openai) first. There is no live provider without one.');
}

const provider = resolveAiProvider({ env });
const interpreter = createFormInterpreter({ provider });

let specification: FormSpecification | undefined;
if (args.revise) {
  const parsed = parseFormSpecification(JSON.parse(await readFile(args.revise, 'utf8')));
  if (!parsed.ok) {
    console.error(`That file is not a valid specification:\n${parsed.issues.map(issue => `  - ${issue.message}`).join('\n')}`);
    process.exit(1);
  }
  specification = parsed.specification;
}

console.log(`provider ${provider.id}/${provider.model} · target ${args.provider} · ${specification ? 'revise' : 'new'}\n`);
const started = Date.now();
let raw: unknown;
try {
  raw = await interpreter.interpret({
    mode: specification ? 'revise' : 'new',
    request: args.request,
    provider: args.provider,
    ...(specification ? { specification } : {}),
  });
} catch (error) {
  // A model failure is information too: the code is the same taxonomy the app shows.
  const code = error instanceof InterpretationError ? error.code : 'model_unavailable';
  console.error(`
${code}: ${error instanceof Error ? error.message : 'the model call failed'}`);
  process.exit(1);
}
const elapsed = Date.now() - started;

// Everything below mirrors the server: contract validation first, then the voice guard's opinion.
// The guard's retry is not simulated here — this prints what it would have complained about, which
// is exactly what a prompt change needs to be judged on.
const issues = voiceIssues(raw);
try {
  const result = assessInterpretation(raw, args.provider);
  console.log(`status      ${result.status}   (${elapsed} ms)`);
  if (result.reply) console.log(`\nreply\n  ${result.reply}\n`);
  if (result.status === 'ready') {
    console.log(`${result.specification.title}${result.specification.description ? ` — ${result.specification.description}` : ''}`);
    result.specification.questions.forEach((question, index) => {
      const flags = [question.type, question.required ? 'required' : 'optional'];
      if (question.options?.length) flags.push(question.options.join(' / '));
      if (question.visibility) flags.push(`shown when ${question.visibility.when.question} = ${question.visibility.when.equals}`);
      console.log(`  ${String(index + 1).padStart(2)}. ${question.title}  [${flags.join(' · ')}]`);
    });
    for (const assumption of result.assumptions) console.log(`\nassumed: ${assumption}`);
    for (const warning of result.warnings) console.log(`warning: ${warning.message}`);
  }
  if (result.status === 'needs_clarification') console.log(`question\n  ${result.question}`);
  if (result.status === 'unsupported') console.log(`explanation\n  ${result.explanation}`);
  if (issues.length > 0) {
    console.log(`\nvoice guard would have asked for one retry:\n  ${voiceFeedback(issues).replace(/ - /g, '\n  - ')}`);
  }
} catch (error) {
  if (error instanceof InterpretationError) {
    console.log(`status      rejected (${error.code})`);
    console.log(`  ${error.message}`);
  } else {
    throw error;
  }
  if (issues.length > 0) console.log(`\nvoice guard:\n  ${voiceFeedback(issues).replace(/ - /g, '\n  - ')}`);
}
