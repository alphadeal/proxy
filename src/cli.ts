#!/usr/bin/env node
/**
 * RelayPlane Proxy CLI
 * 
 * Intelligent AI model routing proxy server.
 * 
 * Usage:
 *   npx @relayplane/proxy [command] [options]
 *   relayplane-proxy [command] [options]
 * 
 * Commands:
 *   (default)              Start the proxy server
 *   telemetry [on|off|status]  Manage telemetry settings
 *   stats                  Show usage statistics
 *   config                 Show configuration
 * 
 * Options:
 *   --port <number>    Port to listen on (default: 3001)
 *   --host <string>    Host to bind to (default: 127.0.0.1)
 *   --offline          Disable all network calls except LLM endpoints
 *   --audit            Show telemetry payloads before sending
 *   -v, --verbose      Enable verbose logging
 *   -h, --help         Show this help message
 *   --version          Show version
 * 
 * Environment Variables:
 *   ANTHROPIC_API_KEY  Anthropic API key
 *   OPENAI_API_KEY     OpenAI API key
 *   GEMINI_API_KEY     Google Gemini API key
 *   XAI_API_KEY        xAI/Grok API key
 *   MOONSHOT_API_KEY   Moonshot API key
 * 
 * @packageDocumentation
 */

import { startProxy } from './standalone-proxy.js';
import {
  loadConfig,
  isFirstRun,
  markFirstRunComplete,
  isTelemetryEnabled,
  enableTelemetry,
  disableTelemetry,
  getConfigPath,
  setApiKey,
} from './config.js';
import {
  printTelemetryDisclosure,
  setAuditMode,
  setOfflineMode,
  getTelemetryStats,
  getTelemetryPath,
} from './telemetry.js';

const VERSION = '0.2.1';

function printHelp(): void {
  console.log(`
RelayPlane Proxy - Intelligent AI Model Routing

Usage:
  npx @relayplane/proxy [command] [options]
  relayplane-proxy [command] [options]

Commands:
  (default)              Start the proxy server
  telemetry [on|off|status]  Manage telemetry settings
  stats                  Show usage statistics
  config                 Show configuration

Options:
  --port <number>    Port to listen on (default: 3001)
  --host <string>    Host to bind to (default: 127.0.0.1)
  --offline          Disable all network calls except LLM endpoints
  --audit            Show telemetry payloads before sending
  -v, --verbose      Enable verbose logging
  -h, --help         Show this help message
  --version          Show version

Environment Variables:
  ANTHROPIC_API_KEY  Anthropic API key
  OPENAI_API_KEY     OpenAI API key
  GEMINI_API_KEY     Google Gemini API key (optional)
  XAI_API_KEY        xAI/Grok API key (optional)
  MOONSHOT_API_KEY   Moonshot API key (optional)

Example:
  # Start proxy on default port
  npx @relayplane/proxy

  # Start with audit mode (see telemetry before it's sent)
  npx @relayplane/proxy --audit

  # Start in offline mode (no telemetry transmission)
  npx @relayplane/proxy --offline

  # Disable telemetry completely
  npx @relayplane/proxy telemetry off

  # Then point your SDKs to the proxy
  export ANTHROPIC_BASE_URL=http://localhost:3001
  export OPENAI_BASE_URL=http://localhost:3001

Learn more: https://relayplane.com/docs
`);
}

function printVersion(): void {
  console.log(`RelayPlane Proxy v${VERSION}`);
}

function handleTelemetryCommand(args: string[]): void {
  const subcommand = args[0];
  
  switch (subcommand) {
    case 'on':
      enableTelemetry();
      console.log('✅ Telemetry enabled');
      console.log('   Anonymous usage data will be collected to improve routing.');
      console.log('   Run with --audit to see exactly what\'s collected.');
      break;
      
    case 'off':
      disableTelemetry();
      console.log('✅ Telemetry disabled');
      console.log('   No usage data will be collected.');
      console.log('   The proxy will continue to work normally.');
      break;
      
    case 'status':
    default:
      const enabled = isTelemetryEnabled();
      console.log('');
      console.log('📊 Telemetry Status');
      console.log('───────────────────');
      console.log(`   Enabled: ${enabled ? '✅ Yes' : '❌ No'}`);
      console.log(`   Data file: ${getTelemetryPath()}`);
      console.log('');
      console.log('   To enable:  relayplane-proxy telemetry on');
      console.log('   To disable: relayplane-proxy telemetry off');
      console.log('   To audit:   relayplane-proxy --audit');
      console.log('');
      break;
  }
}

function handleStatsCommand(): void {
  const stats = getTelemetryStats();
  
  console.log('');
  console.log('📊 Usage Statistics');
  console.log('═══════════════════');
  console.log('');
  console.log(`  Total requests: ${stats.totalEvents}`);
  console.log(`  Total cost:     $${stats.totalCost.toFixed(2)}`);
  console.log(`  Success rate:   ${(stats.successRate * 100).toFixed(1)}%`);
  console.log('');
  
  if (Object.keys(stats.byModel).length > 0) {
    console.log('  By Model:');
    for (const [model, data] of Object.entries(stats.byModel)) {
      console.log(`    ${model}: ${data.count} requests, $${data.cost.toFixed(2)}`);
    }
    console.log('');
  }
  
  if (Object.keys(stats.byTaskType).length > 0) {
    console.log('  By Task Type:');
    for (const [taskType, data] of Object.entries(stats.byTaskType)) {
      console.log(`    ${taskType}: ${data.count} requests, $${data.cost.toFixed(2)}`);
    }
    console.log('');
  }
  
  if (stats.totalEvents === 0) {
    console.log('  No data yet. Start using the proxy to collect statistics.');
    console.log('');
  }
}

function handleConfigCommand(args: string[]): void {
  const subcommand = args[0];
  
  if (subcommand === 'set-key' && args[1]) {
    setApiKey(args[1]);
    console.log('✅ API key saved');
    console.log('   Pro features will be enabled on next proxy start.');
    return;
  }
  
  const config = loadConfig();
  
  console.log('');
  console.log('⚙️  Configuration');
  console.log('═════════════════');
  console.log('');
  console.log(`  Config file: ${getConfigPath()}`);
  console.log(`  Device ID:   ${config.device_id}`);
  console.log(`  Telemetry:   ${config.telemetry_enabled ? '✅ Enabled' : '❌ Disabled'}`);
  console.log(`  API Key:     ${config.api_key ? '••••' + config.api_key.slice(-4) : 'Not set'}`);
  console.log(`  Created:     ${config.created_at}`);
  console.log('');
  console.log('  To set API key: relayplane-proxy config set-key <your-key>');
  console.log('');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Check for help
  if (args.includes('-h') || args.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  // Check for version
  if (args.includes('--version')) {
    printVersion();
    process.exit(0);
  }

  // Handle commands
  const command = args[0];
  
  if (command === 'telemetry') {
    handleTelemetryCommand(args.slice(1));
    process.exit(0);
  }
  
  if (command === 'stats') {
    handleStatsCommand();
    process.exit(0);
  }
  
  if (command === 'config') {
    handleConfigCommand(args.slice(1));
    process.exit(0);
  }

  // Parse server options
  let port = 3001;
  let host = '127.0.0.1';
  let verbose = false;
  let audit = false;
  let offline = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--port' && args[i + 1]) {
      port = parseInt(args[i + 1]!, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        console.error('Error: Invalid port number');
        process.exit(1);
      }
      i++;
    } else if (arg === '--host' && args[i + 1]) {
      host = args[i + 1]!;
      i++;
    } else if (arg === '-v' || arg === '--verbose') {
      verbose = true;
    } else if (arg === '--audit') {
      audit = true;
    } else if (arg === '--offline') {
      offline = true;
    }
  }

  // Set modes
  setAuditMode(audit);
  setOfflineMode(offline);

  // First run disclosure
  if (isFirstRun()) {
    printTelemetryDisclosure();
    markFirstRunComplete();
    
    // Wait for user to read (brief pause)
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Check for at least one API key
  const hasAnthropicKey = !!process.env['ANTHROPIC_API_KEY'];
  const hasOpenAIKey = !!process.env['OPENAI_API_KEY'];
  const hasGeminiKey = !!process.env['GEMINI_API_KEY'];
  const hasXAIKey = !!process.env['XAI_API_KEY'];
  const hasMoonshotKey = !!process.env['MOONSHOT_API_KEY'];

  if (!hasAnthropicKey && !hasOpenAIKey && !hasGeminiKey && !hasXAIKey && !hasMoonshotKey) {
    console.error('Error: No API keys found. Set at least one of:');
    console.error('  ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, XAI_API_KEY, MOONSHOT_API_KEY');
    process.exit(1);
  }

  // Print startup info
  console.log('');
  console.log('  ╭─────────────────────────────────────────╮');
  console.log(`  │       RelayPlane Proxy v${VERSION}          │`);
  console.log('  │    Intelligent AI Model Routing         │');
  console.log('  ╰─────────────────────────────────────────╯');
  console.log('');
  
  // Show modes
  const telemetryEnabled = isTelemetryEnabled();
  console.log('  Mode:');
  if (offline) {
    console.log('    🔒 Offline (no telemetry transmission)');
  } else if (audit) {
    console.log('    🔍 Audit (showing telemetry payloads)');
  } else if (telemetryEnabled) {
    console.log('    📊 Telemetry enabled (--audit to inspect, telemetry off to disable)');
  } else {
    console.log('    📴 Telemetry disabled');
  }
  
  console.log('');
  console.log('  Providers:');
  if (hasAnthropicKey) console.log('    ✓ Anthropic');
  if (hasOpenAIKey) console.log('    ✓ OpenAI');
  if (hasGeminiKey) console.log('    ✓ Google Gemini');
  if (hasXAIKey) console.log('    ✓ xAI (Grok)');
  if (hasMoonshotKey) console.log('    ✓ Moonshot');
  console.log('');

  try {
    await startProxy({ port, host, verbose });
    
    console.log('');
    console.log('  To use, set these environment variables:');
    console.log(`    export ANTHROPIC_BASE_URL=http://${host}:${port}`);
    console.log(`    export OPENAI_BASE_URL=http://${host}:${port}`);
    console.log('');
    console.log('  Then run your agent (OpenClaw, Cursor, Aider, etc.)');
    console.log('');
  } catch (err) {
    console.error('Failed to start proxy:', err);
    process.exit(1);
  }
}

main();
