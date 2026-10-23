import { readFile, writeFile, stat, realpath } from 'node:fs/promises';
import { resolve, join, sep, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyVariableChanges } from '../shared/automation.ts';
import type { DataRow, RunReport } from '../shared/automation.ts';
import { parseRunData } from '../shared/data.ts';
import { runCollection } from '../shared/runner.ts';
import { parseWorkspace, requestFiles } from '../shared/workspace.ts';
import { MAX_BODY_BYTES } from '../shared/body.ts';
import { runRequest } from '../server/pipeline.ts';

const HELP = `Reqora collection runner
Usage: reqora run WORKSPACE.json [options]
  --collection NAME_OR_ID    Required if the workspace has multiple collections
  --request NAME_OR_ID       Select/order requests (repeat this flag)
  --data FILE.json|FILE.csv  Run each data row per iteration
  --iterations NUMBER       Repeat the dataset (default: 1)
  --delay MILLISECONDS      Delay between requests (default: 0)
  --bail                    Stop after the first failed request/check
  --var NAME=VALUE           Override a run variable (repeatable, highest priority)
  --files DIRECTORY         Read referenced upload files from this directory only
  --report REPORT.json      Write a JSON run report
  --junit REPORT.xml        Write a JUnit report
  --save-variables FILE.json Write a workspace with updated variables
  --quiet                   Print only the final summary
Exit codes: 0 pass, 1 failed checks/requests, 2 configuration error, 130 cancelled.
`;

const xml = (value: unknown) => String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '').replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char]!);
export function junitReport(report: RunReport): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="${xml(report.collectionName)}" tests="${report.results.length + Number(report.cancelled)}" failures="${report.failed}" skipped="${Number(report.cancelled)}" time="${report.durationMs / 1000}">\n${report.results.map(item => `  <testcase name="${xml(item.name)} [iteration ${item.iteration + 1}]" classname="${xml(report.collectionName)}" time="${(item.durationMs || 0) / 1000}">${item.passed ? '' : `<failure message="${xml(item.error || 'Checks failed')}">${xml(item.tests.filter(test => !test.passed).map(test => `${test.name}: ${test.error || 'Failed'}`).join('\n') || item.error || 'Request failed')}</failure>`}</testcase>`).join('\n')}${report.cancelled ? '\n  <testcase name="Cancelled run"><skipped /></testcase>' : ''}\n</testsuite>\n`;
}

export async function main(args: string[]): Promise<number> {
  if (!args.length || args.includes('--help') || args.includes('-h')) { console.log(HELP); return 0; }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  try {
    if (args[0] !== 'run' || !args[1] || args[1].startsWith('--')) throw new Error('Expected: reqora run WORKSPACE.json. Use --help for options.');
    const values: Record<string, string> = Object.create(null);
    const selected: string[] = [];
    const overrides: Record<string, string> = Object.create(null);
    let bail = false, quiet = false;
    for (let i = 2; i < args.length; i++) {
      const flag = args[i];
      if (flag === '--bail') { bail = true; continue; }
      if (flag === '--quiet') { quiet = true; continue; }
      if (!['--collection', '--request', '--data', '--iterations', '--delay', '--var', '--files', '--report', '--junit', '--save-variables'].includes(flag) || args[i + 1] === undefined || args[i + 1].startsWith('--')) throw new Error(`Unknown option or missing value: ${flag}`);
      const value = args[++i];
      if (flag === '--request') selected.push(value);
      else if (flag === '--var') {
        const split = value.indexOf('=');
        if (split < 1 || value.slice(0, split).trim().length > 255) throw new Error('Use --var NAME=VALUE.');
        overrides[value.slice(0, split).trim()] = value.slice(split + 1);
      } else values[flag] = value;
    }
    const path = resolve(args[1]);
    if ((await stat(path)).size > 5 * 1024 * 1024) throw new Error('Workspace files must be smaller than 5 MB.');
    const workspace = parseWorkspace(await readFile(path, 'utf8'));
    const collectionById = workspace.collections.find(item => item.id === values['--collection']);
    const collectionMatches = collectionById ? [collectionById] : values['--collection'] ? workspace.collections.filter(item => item.name === values['--collection']) : workspace.collections;
    if (collectionMatches.length !== 1) throw new Error('Select one collection by unique name or ID using --collection.');
    const collection = collectionMatches[0];
    const requests = workspace.saved.filter(item => item.collectionId === collection.id).map(item => item.request);
    const requestIds = selected.length ? selected.map(value => {
      const byId = requests.find(item => item.id === value);
      const matches = byId ? [byId] : requests.filter(item => item.name === value);
      if (matches.length !== 1) throw new Error(`Request is missing or ambiguous: ${value}`);
      return matches[0].id;
    }) : undefined;
    let data: DataRow[] = [];
    if (values['--data']) {
      if ((await stat(values['--data'])).size > 2 * 1024 * 1024) throw new Error('Run data exceeds the 2 MB limit.');
      data = parseRunData(await readFile(values['--data'], 'utf8'), values['--data'].toLowerCase().endsWith('.csv') ? 'csv' : 'json');
    }
    if (Object.keys(overrides).length) data = (data.length ? data : [{}]).map(row => ({ ...row, ...overrides }));
    const filesRoot = values['--files'] ? await realpath(values['--files']) : undefined;
    if (filesRoot && !(await stat(filesRoot)).isDirectory()) throw new Error('--files must name a directory.');
    const report = await runCollection(workspace, collection.id, { iterations: Number(values['--iterations'] ?? 1), delayMs: Number(values['--delay'] ?? 0), stopOnFailure: bail, data, requestIds }, {
      execute: runRequest, signal: controller.signal,
      files: async request => {
        const result: Record<string, string> = Object.create(null);
        for (const reference of requestFiles(request)) {
          if (!filesRoot) throw new Error('This request needs an upload file. Provide --files DIRECTORY.');
          const file = await realpath(join(filesRoot, reference.name));
          const within = relative(filesRoot, file);
          if (within === '..' || within.startsWith('..' + sep) || isAbsolute(within)) throw new Error('Referenced file is outside the allowed upload directory.');
          const info = await stat(file);
          if (!info.isFile() || info.size > MAX_BODY_BYTES) throw new Error('Upload files must be regular files of 10 MB or smaller.');
          result[reference.id] = (await readFile(file)).toString('base64');
        }
        return result;
      },
      onResult: item => {
        if (quiet) return;
        console.log(`${item.passed ? 'PASS' : 'FAIL'} [${item.iteration + 1}] ${item.name} ${item.status ?? 'ERR'}${item.error ? ` — ${item.error}` : ''}`);
        for (const test of item.tests.filter(test => !test.passed)) console.error(`  FAIL ${test.name}: ${test.error || 'Check failed'}`);
        for (const log of item.logs) console.log(`  [${log.phase} ${log.level}] ${log.message}`);
      },
    });
    if (values['--report']) await writeFile(values['--report'], JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    if (values['--junit']) await writeFile(values['--junit'], junitReport(report), { mode: 0o600 });
    if (values['--save-variables']) await writeFile(values['--save-variables'], JSON.stringify(applyVariableChanges(workspace, report.changes, collection.id), null, 2) + '\n', { mode: 0o600 });
    console.log(`${report.passed} passed, ${report.failed} failed, ${report.completed}/${report.planned} completed${report.cancelled ? ', cancelled' : ''}.`);
    return report.cancelled ? 130 : report.failed ? 1 : 0;
  } catch (error) { console.error(`Reqora: ${(error as Error).message}`); return controller.signal.aborted ? 130 : 2; }
  finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await main(process.argv.slice(2));
