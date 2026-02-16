/**
 * Wiki Command
 * 
 * Generates repository documentation from the knowledge graph.
 * Usage: gitnexus wiki [path] [options]
 */

import path from 'path';
import readline from 'readline';
import cliProgress from 'cli-progress';
import { getGitRoot, isGitRepo } from '../storage/git.js';
import { getStoragePaths, loadMeta, loadCLIConfig, saveCLIConfig } from '../storage/repo-manager.js';
import { WikiGenerator, type WikiOptions } from '../core/wiki/generator.js';
import { resolveLLMConfig } from '../core/wiki/llm-client.js';

export interface WikiCommandOptions {
  force?: boolean;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
}

/**
 * Prompt the user for input via stdin.
 */
function prompt(question: string, hide = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    if (hide && process.stdin.isTTY) {
      // Mask input for API keys
      process.stdout.write(question);
      let input = '';
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf-8');

      const onData = (char: string) => {
        if (char === '\n' || char === '\r' || char === '\u0004') {
          process.stdin.setRawMode(false);
          process.stdin.removeListener('data', onData);
          process.stdout.write('\n');
          rl.close();
          resolve(input);
        } else if (char === '\u0003') {
          // Ctrl+C
          process.stdin.setRawMode(false);
          rl.close();
          process.exit(1);
        } else if (char === '\u007F' || char === '\b') {
          // Backspace
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else {
          input += char;
          process.stdout.write('*');
        }
      };
      process.stdin.on('data', onData);
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

export const wikiCommand = async (
  inputPath?: string,
  options?: WikiCommandOptions,
) => {
  console.log('\n  GitNexus Wiki Generator\n');

  // ── Resolve repo path ───────────────────────────────────────────────
  let repoPath: string;
  if (inputPath) {
    repoPath = path.resolve(inputPath);
  } else {
    const gitRoot = getGitRoot(process.cwd());
    if (!gitRoot) {
      console.log('  Error: Not inside a git repository\n');
      process.exitCode = 1;
      return;
    }
    repoPath = gitRoot;
  }

  if (!isGitRepo(repoPath)) {
    console.log('  Error: Not a git repository\n');
    process.exitCode = 1;
    return;
  }

  // ── Check for existing index ────────────────────────────────────────
  const { storagePath, kuzuPath } = getStoragePaths(repoPath);
  const meta = await loadMeta(storagePath);

  if (!meta) {
    console.log('  Error: No GitNexus index found.');
    console.log('  Run `gitnexus analyze` first to index this repository.\n');
    process.exitCode = 1;
    return;
  }

  // ── Resolve LLM config (with interactive fallback) ─────────────────
  // If --api-key was passed via CLI, save it immediately
  if (options?.apiKey) {
    const existing = await loadCLIConfig();
    await saveCLIConfig({ ...existing, apiKey: options.apiKey });
    console.log('  API key saved to ~/.gitnexus/config.json\n');
  }

  let llmConfig = await resolveLLMConfig({
    model: options?.model,
    baseUrl: options?.baseUrl,
    apiKey: options?.apiKey,
  });

  if (!llmConfig.apiKey) {
    if (!process.stdin.isTTY) {
      console.log('  Error: No LLM API key found.');
      console.log('  Set OPENAI_API_KEY or GITNEXUS_API_KEY environment variable,');
      console.log('  or pass --api-key <key>.\n');
      process.exitCode = 1;
      return;
    }

    console.log('  No API key configured.\n');
    console.log('  The wiki command requires an LLM API key (OpenAI-compatible).');
    console.log('  You can also set OPENAI_API_KEY or GITNEXUS_API_KEY env var.\n');

    const key = await prompt('  Enter your API key: ', true);
    if (!key) {
      console.log('\n  No key provided. Aborting.\n');
      process.exitCode = 1;
      return;
    }

    const save = await prompt('  Save key to ~/.gitnexus/config.json for future use? (Y/n): ');
    if (!save || save.toLowerCase() === 'y' || save.toLowerCase() === 'yes') {
      const existing = await loadCLIConfig();
      await saveCLIConfig({ ...existing, apiKey: key });
      console.log('  Key saved.\n');
    } else {
      console.log('  Key will be used for this session only.\n');
    }

    llmConfig = { ...llmConfig, apiKey: key };
  }

  // ── Setup progress bar ──────────────────────────────────────────────
  const bar = new cliProgress.SingleBar({
    format: '  {bar} {percentage}% | {phase}',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true,
    barGlue: '',
    autopadding: true,
    clearOnComplete: false,
    stopOnComplete: false,
  }, cliProgress.Presets.shades_grey);

  bar.start(100, 0, { phase: 'Initializing...' });

  const t0 = Date.now();

  // ── Run generator ───────────────────────────────────────────────────
  const wikiOptions: WikiOptions = {
    force: options?.force,
    model: options?.model,
    baseUrl: options?.baseUrl,
  };

  const generator = new WikiGenerator(
    repoPath,
    storagePath,
    kuzuPath,
    llmConfig,
    wikiOptions,
    (phase, percent, detail) => {
      bar.update(percent, { phase: detail || phase });
    },
  );

  try {
    const result = await generator.run();

    bar.update(100, { phase: 'Done' });
    bar.stop();

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    if (result.mode === 'up-to-date' && !options?.force) {
      console.log('\n  Wiki is already up to date.');
      console.log(`  ${path.join(storagePath, 'wiki')}\n`);
      return;
    }

    console.log(`\n  Wiki generated successfully (${elapsed}s)\n`);
    console.log(`  Mode: ${result.mode}`);
    console.log(`  Pages: ${result.pagesGenerated}`);
    console.log(`  Output: ${path.join(storagePath, 'wiki')}`);

    if (result.failedModules && result.failedModules.length > 0) {
      console.log(`\n  Failed modules (${result.failedModules.length}):`);
      for (const mod of result.failedModules) {
        console.log(`    - ${mod}`);
      }
      console.log('  Re-run to retry failed modules (pages will be regenerated).');
    }

    console.log('');
  } catch (err: any) {
    bar.stop();

    if (err.message?.includes('No source files')) {
      console.log(`\n  ${err.message}\n`);
    } else if (err.message?.includes('API key') || err.message?.includes('API error')) {
      console.log(`\n  LLM Error: ${err.message}\n`);
    } else {
      console.log(`\n  Error: ${err.message}\n`);
      if (process.env.DEBUG) {
        console.error(err);
      }
    }
    process.exitCode = 1;
  }
};
