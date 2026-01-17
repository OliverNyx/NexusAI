/**
 * Setup Command
 * 
 * Detects installed AI tools (Cursor, Claude Code, Windsurf) and
 * configures their MCP settings to use GitNexus.
 */

import chalk from 'chalk';
import ora from 'ora';
import { detectIDEs, type IDE } from '../config/detect-ides.js';
import { injectMCPConfig } from '../config/inject-config.js';
import { getBridgePath } from '../config/paths.js';

export async function setupCommand() {
  console.log(chalk.blue('\n🔧 GitNexus MCP Setup\n'));
  
  // Step 1: Get bridge path (this CLI itself is the bridge)
  const spinner = ora('Locating bridge...').start();
  const bridgePath = getBridgePath();
  spinner.succeed(`Bridge located at ${chalk.dim(bridgePath)}`);
  
  // Step 2: Detect AI tools
  spinner.start('Detecting AI tools...');
  const ides = await detectIDEs();
  
  if (ides.length === 0) {
    spinner.warn('No supported AI tools detected');
    console.log(chalk.yellow('\nSupported tools: Cursor, Claude Code, Windsurf, VS Code'));
    console.log('Install one of these tools to use GitNexus MCP.\n');
    return;
  }
  
  spinner.succeed(`Found: ${ides.map(i => chalk.cyan(i.name)).join(', ')}`);
  
  // Step 3: Inject MCP config into each IDE
  for (const ide of ides) {
    spinner.start(`Configuring ${ide.name}...`);
    try {
      await injectMCPConfig(ide, bridgePath);
      spinner.succeed(`Configured ${chalk.cyan(ide.name)}`);
    } catch (error) {
      spinner.fail(`Failed to configure ${ide.name}: ${error}`);
    }
  }
  
  // Success message
  console.log(chalk.green('\n✅ Setup complete!\n'));
  console.log('Next steps:');
  console.log('  1. Open GitNexus in your browser');
  console.log('  2. Load a codebase');
  console.log('  3. Click the MCP toggle to connect');
  console.log('  4. Your AI tools can now use GitNexus!\n');
  
  console.log(chalk.dim('Available tools: search, cypher, blastRadius, highlight\n'));
}
