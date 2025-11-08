// logger.js - Logging utilities for the server
const chalk = require("chalk");
const blessed = require("blessed");

let accessCode = null;
let tunnelDomain = null;
let tunnelUrl = null;
let screen = null;
let connectionBox = null;
let logBox = null;
let logLines = [];
const MAX_LOG_LINES = 1000; // Keep last 1000 lines in memory

// Initialize logger with connection info
function initLogger(code, domain, url) {
  accessCode = code;
  tunnelDomain = domain;
  tunnelUrl = url;
}

// Function to display connection info in a fixed box with scrollable logs
function displayConnectionInfo() {
  if (!tunnelUrl || !tunnelDomain || !accessCode) return;
  
  // Create blessed screen
  screen = blessed.screen({
    smartCSR: true,
    title: 'Screen Share Server'
  });
  
  // Connection info box (fixed at top)
  connectionBox = blessed.box({
    top: 0,
    left: 0,
    width: '100%',
    height: 12,
    content: 
      chalk.bold.cyan("🌐 Tunnel URL: ") + chalk.white(tunnelUrl) + "\n" +
      chalk.bold.green("🔑 Access Code: ") + chalk.bold.white(accessCode) + "\n" +
      chalk.bold.yellow("📋 Connection Info:") + "\n" +
      chalk.gray("   Domain: ") + chalk.white(tunnelDomain) + "\n" +
      chalk.gray("   Code: ") + chalk.bold.white(accessCode) + "\n\n" +
      chalk.bold.magenta("📺 Stream URL:") + "\n" +
      chalk.underline.cyan(tunnelUrl + "/stream.m3u8?code=" + accessCode),
    tags: true,
    border: {
      type: 'line'
    },
    style: {
      border: {
        fg: 'cyan'
      },
      bg: 'black'
    }
  });
  
  // Log box (scrollable, below connection info)
  logBox = blessed.box({
    top: 12,
    left: 0,
    width: '100%',
    height: '100%',
    content: chalk.bold.yellow("📺 FFmpeg Logs:\n") + chalk.gray("═".repeat(80)) + "\n\n",
    tags: true,
    alwaysScroll: true,
    scrollable: true,
    scrollbar: {
      ch: ' ',
      track: {
        bg: 'gray'
      },
      style: {
        bg: 'blue'
      }
    },
    border: {
      type: 'line'
    },
    style: {
      border: {
        fg: 'yellow'
      },
      bg: 'black'
    },
    keys: true,
    vi: true
  });
  
  // Add boxes to screen
  screen.append(connectionBox);
  screen.append(logBox);
  
  // Handle quit - emit SIGINT to trigger proper cleanup
  screen.key(['q', 'C-c'], () => {
    process.emit('SIGINT');
    return false;
  });
  
  // Focus on log box for scrolling
  logBox.focus();
  
  // Render screen
  screen.render();
}

// Custom logger for FFmpeg that keeps logs separate
// Note: FFmpeg writes normal output to stderr, so we need to detect actual errors
function logFFmpeg(data, isStderr = false) {
  const lines = data.toString().trim().split('\n').filter(line => line.trim());
  
  // Keywords that indicate actual errors
  const errorKeywords = ['error', 'failed', 'fatal', 'cannot', 'unable', 'invalid', 'not found'];
  
  lines.forEach(line => {
    const lowerLine = line.toLowerCase();
    const isActualError = errorKeywords.some(keyword => lowerLine.includes(keyword));
    
    // Filter out verbose initialization messages
    const isVerboseInit = line.includes('configuration:') || 
                         line.includes('libav') || 
                         line.includes('built with') ||
                         line.includes('objc[') ||
                         line.includes('class `') ||
                         line.includes('not linked');
    
    if (isVerboseInit) {
      // Skip verbose initialization messages
      return;
    }
    
    let formattedLine = '';
    if (isActualError) {
      // Actual error - show in red
      formattedLine = chalk.red(`  [FFmpeg Error] ${line}`);
    } else if (line.includes('frame=') || line.includes('fps=') || line.includes('bitrate=') || 
               line.includes('time=') || line.includes('speed=') || 
               line.includes('Opening') || line.includes('Stream mapping') ||
               line.includes('Input #') || line.includes('Duration:') ||
               line.length < 150) {
      // Normal FFmpeg output - show in gray/cyan
      if (isStderr) {
        formattedLine = chalk.cyan(`  [FFmpeg] ${line}`);
      } else {
        formattedLine = chalk.gray(`  [FFmpeg] ${line}`);
      }
    } else {
      return; // Skip other lines
    }
    
    // Add to log lines array
    logLines.push(formattedLine);
    
    // Keep only last MAX_LOG_LINES
    if (logLines.length > MAX_LOG_LINES) {
      logLines.shift();
    }
    
    // Update log box if it exists
    if (logBox && screen) {
      const header = chalk.bold.yellow("📺 FFmpeg Logs:\n") + chalk.gray("═".repeat(80)) + "\n\n";
      logBox.setContent(header + logLines.join('\n'));
      logBox.setScrollPerc(100); // Auto-scroll to bottom
      screen.render();
    } else {
      // Fallback to console if TUI not initialized
      console.log(formattedLine);
    }
  });
}

// General logging functions
function logSuccess(message) {
  const msg = chalk.green(`✓ ${message}`);
  if (logBox && screen) {
    logLines.push(msg);
    if (logLines.length > MAX_LOG_LINES) logLines.shift();
    updateLogBox();
  } else {
    console.log(msg);
  }
}

function logError(message) {
  const msg = chalk.red(`✗ ${message}`);
  if (logBox && screen) {
    logLines.push(msg);
    if (logLines.length > MAX_LOG_LINES) logLines.shift();
    updateLogBox();
  } else {
    console.error(msg);
  }
}

function logInfo(message) {
  const msg = chalk.yellow(message);
  if (logBox && screen) {
    logLines.push(msg);
    if (logLines.length > MAX_LOG_LINES) logLines.shift();
    updateLogBox();
  } else {
    console.log(msg);
  }
}

function updateLogBox() {
  if (!logBox || !screen) return;
  const header = chalk.bold.yellow("📺 FFmpeg Logs:\n") + chalk.gray("═".repeat(80)) + "\n\n";
  logBox.setContent(header + logLines.join('\n'));
  logBox.setScrollPerc(100);
  screen.render();
}

function logFFmpegExit(code) {
  const msg = code === 0 
    ? chalk.green(`✓ FFmpeg exited successfully`)
    : chalk.red(`✗ FFmpeg exited with code ${code}`);
  
  if (logBox && screen) {
    logLines.push(msg);
    if (logLines.length > MAX_LOG_LINES) logLines.shift();
    updateLogBox();
  } else {
    console.log(msg);
  }
}

// Cleanup function to restore terminal
function cleanup() {
  if (screen) {
    screen.destroy();
  }
}

module.exports = {
  initLogger,
  displayConnectionInfo,
  logFFmpeg,
  logSuccess,
  logError,
  logInfo,
  logFFmpegExit,
  cleanup
};

