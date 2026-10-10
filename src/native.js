const { execFile, spawn } = require('child_process');

const DRY_RUN = process.env.EYECARE_DRY_RUN === '1';
const SEP = String.fromCharCode(92);
const COLORS_KEY = ['HKCU:', 'Control Panel', 'Colors'].join(SEP);

function encode(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encode(script)],
      { windowsHide: true },
      (err, stdout, stderr) => {
        if (/Exception|Error/.test(String(stderr))) console.error('[powershell]', String(stderr).replace(/<[^>]+>/g, ' ').slice(0, 500));
        return err ? reject(err) : resolve(String(stdout).trim());
      }
    );
  });
}

const SYS_COLORS_TYPE = `
if (-not ('EyeCareSysColor' -as [type])) {
Add-Type @"
using System; using System.Runtime.InteropServices;
public class EyeCareSysColor {
  [DllImport("user32.dll")] public static extern bool SetSysColors(int c, int[] e, int[] v);
}
"@
}`;

async function readWindowColor() {
  if (process.platform !== 'win32') return '255 255 255';
  try {
    const v = await runPowerShell(`(Get-ItemProperty '${COLORS_KEY}').Window`);
    return /^\d+ \d+ \d+$/.test(v) ? v : '255 255 255';
  } catch {
    return '255 255 255';
  }
}

async function setWindowColor(rgbText) {
  if (process.platform !== 'win32') return;
  const [r, g, b] = rgbText.split(' ').map(Number);
  const value = r + g * 256 + b * 65536;
  await runPowerShell(`${SYS_COLORS_TYPE}
Set-ItemProperty '${COLORS_KEY}' -Name Window -Value '${r} ${g} ${b}'
[void][EyeCareSysColor]::SetSysColors(1, @(5), @(${value}))`);
}

function startFullscreenWatcher(onChange) {
  if (process.platform !== 'win32') return () => {};
  const script = `
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public class EyeCareFs {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct MI { public int cbSize; public RECT rcMonitor; public RECT rcWork; public int dwFlags; }
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, int f);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MI mi);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern IntPtr GetShellWindow();
  [DllImport("user32.dll")] static extern IntPtr GetDesktopWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public static int Check(uint self) {
    IntPtr h = GetForegroundWindow();
    if (h == IntPtr.Zero || h == GetShellWindow() || h == GetDesktopWindow()) return 0;
    uint pid; GetWindowThreadProcessId(h, out pid);
    if (pid == self) return 0;
    StringBuilder sb = new StringBuilder(256); GetClassName(h, sb, 256);
    string c = sb.ToString();
    if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd") return 0;
    RECT r; if (!GetWindowRect(h, out r)) return 0;
    MI mi = new MI(); mi.cbSize = Marshal.SizeOf(typeof(MI));
    if (!GetMonitorInfo(MonitorFromWindow(h, 2), ref mi)) return 0;
    return (r.L <= mi.rcMonitor.L && r.T <= mi.rcMonitor.T && r.R >= mi.rcMonitor.R && r.B >= mi.rcMonitor.B) ? 1 : 0;
  }
}
"@
$last = -1
while ($true) {
  if (-not (Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue)) { exit }
  $v = [EyeCareFs]::Check(${process.pid})
  if ($v -ne $last) { [Console]::Out.WriteLine($v); [Console]::Out.Flush(); $last = $v }
  Start-Sleep -Milliseconds 1500
}`;
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encode(script)],
    { windowsHide: true }
  );
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d.toString();
    const lines = buf.split(/\r?\n/);
    buf = lines.pop();
    for (const line of lines) {
      if (line.trim() === '1') onChange(true);
      else if (line.trim() === '0') onChange(false);
    }
  });
  child.on('error', () => {});
  return () => {
    try { child.kill(); } catch {}
  };
}

function shutdownNow(delaySeconds, message) {
  if (DRY_RUN) {
    console.log(`[dry-run] shutdown /s /t ${delaySeconds} ${message}`);
    return;
  }
  execFile('shutdown.exe', ['/s', '/t', String(delaySeconds), '/c', message], { windowsHide: true }, () => {});
}

function abortShutdown() {
  if (DRY_RUN) {
    console.log('[dry-run] shutdown /a');
    return;
  }
  execFile('shutdown.exe', ['/a'], { windowsHide: true }, () => {});
}

module.exports = { readWindowColor, setWindowColor, startFullscreenWatcher, shutdownNow, abortShutdown, DRY_RUN };
