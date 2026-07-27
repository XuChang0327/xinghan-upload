import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { spawn, ChildProcess } from "child_process";
import { StringDecoder } from "string_decoder";
import treeKill = require("tree-kill");
import {
  XinghanActionsTreeProvider,
  XinghanDeviceFilesTreeProvider,
  ConnectionStatusTreeProvider,
  type ConnectionStatusNode,
  type DeviceFileInfo,
} from "./views/XinghanTreeProvider";
import {
  XinghanDeviceFileSystemProvider,
  toDeviceUri,
  type ReadDeviceFile,
  type WriteDeviceFile,
} from "./views/XinghanDeviceFileSystemProvider";

const OUTPUT_CHANNEL_NAME = "星瀚助手";

function outputInfo(channel: vscode.OutputChannel, message: string): void {
  channel.show(true);
  channel.appendLine(`[信息] ${message}`);
}

function outputWarn(channel: vscode.OutputChannel, message: string): void {
  channel.show(true);
  channel.appendLine(`[警告] ${message}`);
}

function outputError(channel: vscode.OutputChannel, message: string): void {
  channel.show(true);
  channel.appendLine(`[错误] ${message}`);
}

function decodeUtf8Chunk(decoder: StringDecoder, data: Buffer): string {
  return decoder.write(data);
}

function flushUtf8Decoder(decoder: StringDecoder): string {
  return decoder.end();
}

const CONTAINERS = ["container1", "container2", "container3", "container4", "container5"];

const REQUIRED_PACKAGES = ["pyserial", "mpremote"];
const BLE_REQUIRED_PACKAGES = ["bleak"];

const PROCESS_TIMEOUT_MS = 30_000;
const TREE_KILL_TIMEOUT_MS = 5_000;

class OperationMutex {
  private _busy = false;
  private _label = "";

  get busy(): boolean {
    return this._busy;
  }

  get label(): string {
    return this._label;
  }

  async run<T>(label: string, channel: vscode.OutputChannel, fn: () => Promise<T>): Promise<T | null> {
    if (this._busy) {
      outputWarn(channel, `星瀚: 当前正在执行「${this._label}」，请等待完成后重试。`);
      return null;
    }
    this._busy = true;
    this._label = label;
    try {
      return await fn();
    } finally {
      this._busy = false;
      this._label = "";
    }
  }
}

function killProcessWithTimeout(proc: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (!proc.pid) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        // ignore
      }
      resolve();
    }, TREE_KILL_TIMEOUT_MS);
    treeKill(proc.pid, "SIGTERM", (err?: Error) => {
      clearTimeout(timer);
      if (err) {
        try {
          proc.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
      resolve();
    });
  });
}

/** 检查 Python 依赖是否已安装 */
async function checkDependencies(pythonPath: string): Promise<{ missing: string[] }> {
  return new Promise((resolve) => {
    const checkCode = `
import sys
missing = []
try:
    import serial 
except ImportError:
    missing.append("pyserial")
try:
    import mpremote
except ImportError:
    missing.append("mpremote")
print(",".join(missing) if missing else "")
`;
    const proc = spawn(pythonPath, ["-c", checkCode], { shell: false });
    let stdout = "";
    proc.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    proc.on("close", () => {
      const output = stdout.trim();
      const missing = output ? output.split(",") : [];
      resolve({ missing });
    });
    proc.on("error", () => {
      resolve({ missing: REQUIRED_PACKAGES });
    });
  });
}

/** 安装缺失的 Python 依赖 */
async function installDependencies(
  pythonPath: string,
  packages: string[],
  channel: vscode.OutputChannel
): Promise<boolean> {
  return new Promise((resolve) => {
    const args = ["-m", "pip", "install", ...packages];
    channel.appendLine(`> ${pythonPath} ${args.join(" ")}`);
    channel.appendLine("");

    const proc = spawn(pythonPath, args, { shell: false });

    proc.stdout?.on("data", (data: Buffer) => {
      channel.append(data.toString());
    });
    proc.stderr?.on("data", (data: Buffer) => {
      channel.append(data.toString());
    });

    proc.on("close", (code) => {
      channel.appendLine("");
      if (code === 0) {
        channel.appendLine("✅ 依赖安装成功");
        resolve(true);
      } else {
        channel.appendLine("❌ 依赖安装失败");
        resolve(false);
      }
    });

    proc.on("error", (err) => {
      channel.appendLine(`❌ 安装失败: ${err.message}`);
      resolve(false);
    });
  });
}

/** 确保依赖已安装，返回 true 表示可以继续执行 */
async function ensureDependencies(
  pythonPath: string,
  channel: vscode.OutputChannel
): Promise<boolean> {
  const { missing } = await checkDependencies(pythonPath);

  if (missing.length === 0) {
    return true;
  }

  const choice = await vscode.window.showWarningMessage(
    `星瀚插件需要安装 Python 依赖: ${missing.join(", ")}`,
    "自动安装",
    "取消"
  );

  if (choice !== "自动安装") {
    return false;
  }

  channel.show(true);
  channel.clear();
  channel.appendLine("正在安装 Python 依赖...\n");

  const success = await installDependencies(pythonPath, missing, channel);

  if (success) {
    outputInfo(channel, "星瀚: Python 依赖安装成功");
  } else {
    outputError(
      channel,
      `星瀚: 依赖安装失败，请手动运行: ${pythonPath} -m pip install ${missing.join(" ")}`
    );
  }

  return success;
}

async function checkBleDependencies(pythonPath: string): Promise<{ missing: string[] }> {
  return new Promise((resolve) => {
    const checkCode = `
missing = []
try:
    import bleak
except ImportError:
    missing.append("bleak")
print(",".join(missing) if missing else "")
`;
    const proc = spawn(pythonPath, ["-c", checkCode], { shell: false });
    let stdout = "";
    proc.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    proc.on("close", () => {
      const output = stdout.trim();
      resolve({ missing: output ? output.split(",") : [] });
    });
    proc.on("error", () => {
      resolve({ missing: BLE_REQUIRED_PACKAGES });
    });
  });
}

async function ensureBleDependencies(
  pythonPath: string,
  channel: vscode.OutputChannel
): Promise<boolean> {
  const { missing } = await checkBleDependencies(pythonPath);
  if (missing.length === 0) {
    return true;
  }

  const choice = await vscode.window.showWarningMessage(
    `星瀚蓝牙功能需要安装 Python 依赖: ${missing.join(", ")}`,
    "自动安装",
    "取消"
  );
  if (choice !== "自动安装") {
    return false;
  }

  channel.show(true);
  channel.clear();
  channel.appendLine("正在安装蓝牙 Python 依赖...\n");
  const success = await installDependencies(pythonPath, missing, channel);
  if (success) {
    outputInfo(channel, "星瀚: 蓝牙依赖安装成功");
  } else {
    outputError(
      channel,
      `星瀚: 蓝牙依赖安装失败，请手动运行: ${pythonPath} -m pip install ${missing.join(" ")}`
    );
  }
  return success;
}

interface WifiPreset {
  name: string;
  password: string;
  authMode?: number;
}

function getConfig() {
  return {
    pythonPath: vscode.workspace.getConfiguration("xinghan").get<string>("pythonPath") ?? "python3",
    serialPort: vscode.workspace.getConfiguration("xinghan").get<string | null>("serialPort"),
    wifiPresets: vscode.workspace.getConfiguration("xinghan").get<WifiPreset[]>("wifiPresets") ?? [],
    bluetoothNamePrefix: vscode.workspace.getConfiguration("xinghan").get<string>("bluetoothNamePrefix") ?? "ybc-r2",
    bluetoothScanTimeout: vscode.workspace.getConfiguration("xinghan").get<number>("bluetoothScanTimeout") ?? 6,
    bluetoothCommandTimeout: vscode.workspace.getConfiguration("xinghan").get<number>("bluetoothCommandTimeout") ?? 8,
    bluetoothRunContainer: vscode.workspace.getConfiguration("xinghan").get<string>("bluetoothRunContainer") ?? "container1",
  };
}

/**
 * 解析上传/运行要使用的本地文件路径：Explorer 右键会传入 Uri；编辑器无参则用当前活动编辑器。
 * 多选时仅作用于右键目标文件（首参 Uri）。
 */
function resolveLocalFilePathForDevice(
  channel: vscode.OutputChannel,
  firstArg?: unknown,
  selectedResources?: unknown
): string | null {
  const multi =
    Array.isArray(selectedResources) &&
    selectedResources.length > 1 &&
    selectedResources.every((u) => u instanceof vscode.Uri);

  if (firstArg instanceof vscode.Uri && firstArg.scheme === "file") {
    if (multi) {
      outputInfo(channel, "星瀚: 已选择多个文件，仅对右键目标文件执行。");
    }
    try {
      const stat = fs.statSync(firstArg.fsPath);
      if (stat.isDirectory()) {
        outputWarn(channel, "星瀚: 请选择文件，不能对文件夹执行。");
        return null;
      }
    } catch {
      outputWarn(channel, "星瀚: 无法访问该路径。");
      return null;
    }
    return firstArg.fsPath;
  }

  const editor = vscode.window.activeTextEditor;
  const docUri = editor?.document.uri;
  if (!docUri || docUri.scheme !== "file") {
    outputWarn(channel, "请先打开要操作的本地文件。");
    return null;
  }
  return docUri.fsPath;
}

/** 若本地文件在编辑器中有未保存修改，先保存再执行设备操作 */
async function saveLocalFileIfDirty(
  channel: vscode.OutputChannel,
  filePath: string,
  actionLabel: string
): Promise<boolean> {
  const doc = vscode.workspace.textDocuments.find(
    (d) => d.uri.scheme === "file" && d.uri.fsPath === filePath
  );
  if (!doc?.isDirty) {
    return true;
  }
  const saved = await doc.save();
  if (!saved) {
    outputWarn(channel, `星瀚: 文件保存已取消，已中止${actionLabel}。`);
  }
  return saved;
}

/** 获取上传脚本的绝对路径：优先使用插件内嵌脚本 */
function resolveScriptPath(extensionPath: string): string {
  return path.join(extensionPath, "scripts", "wired_uploader.py");
}

function resolveBleScriptPath(extensionPath: string): string {
  return path.join(extensionPath, "scripts", "ble_nus_client.py");
}

/** 执行 Python 脚本，输出到 Output 通道并在终端中显示（可选） */
function runPythonScript(
  pythonPath: string,
  scriptPath: string,
  args: string[],
  channel: vscode.OutputChannel,
  cwd?: string,
  timeoutMs: number = PROCESS_TIMEOUT_MS,
  onProgress?: (pct: number) => void
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const fullCmd = [pythonPath, scriptPath, ...args].join(" ");
    channel.appendLine(`> ${fullCmd}`);
    channel.appendLine("");

    const proc = spawn(pythonPath, [scriptPath, ...args], {
      cwd: cwd || path.dirname(scriptPath),
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      channel.appendLine("\n[超时] 操作超时，正在终止进程…");
      try {
        proc.kill("SIGKILL");
      } catch {
        // ignore
      }
      resolve({ exitCode: -1, stdout, stderr: stderr + "\n[TIMEOUT]" });
    }, timeoutMs);

    proc.stdout?.on("data", (data: Buffer) => {
      const text = decodeUtf8Chunk(stdoutDecoder, data);
      stdout += text;
      if (onProgress) {
        const lines = text.split(/\r?\n/);
        for (const line of lines) {
          const m = line.match(/##PROGRESS:(\d+)##/);
          if (m) {
            onProgress(parseInt(m[1], 10));
          } else if (line.trim()) {
            channel.appendLine(line);
          }
        }
      } else {
        channel.append(text);
      }
    });
    proc.stderr?.on("data", (data: Buffer) => {
      const text = decodeUtf8Chunk(stderrDecoder, data);
      stderr += text;
      channel.append(text);
    });

    proc.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stdoutTail = flushUtf8Decoder(stdoutDecoder);
      const stderrTail = flushUtf8Decoder(stderrDecoder);
      if (stdoutTail) {
        stdout += stdoutTail;
        channel.append(stdoutTail);
      }
      if (stderrTail) {
        stderr += stderrTail;
        channel.append(stderrTail);
      }
      if (code !== undefined) {
        channel.appendLine("");
        channel.appendLine(`[退出码 ${code}]`);
      }
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });

    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      channel.appendLine(`❌ 启动失败: ${err.message}`);
      resolve({ exitCode: -1, stdout, stderr: err.message });
    });
  });
}

/** 终止「在设备上运行」的进程（含子进程，释放串口） */
function stopRunOnDeviceProcess(proc: ChildProcess): Promise<void> {
  return killProcessWithTimeout(proc);
}

function createCommandStatusBarItem(
  context: vscode.ExtensionContext,
  text: string,
  command: string,
  tooltip: string,
  priority: number
): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, priority);
  item.text = text;
  item.command = command;
  item.tooltip = tooltip;
  item.show();
  context.subscriptions.push(item);
  return item;
}

interface BluetoothTarget {
  name: string;
  address: string;
}

export function activate(context: vscode.ExtensionContext) {
  const channel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  const mutex = new OperationMutex();
  /** 当前「在设备上运行」的进程，用于停止或上传前释放串口 */
  let runOnDeviceProcess: ChildProcess | null = null;
  /** 有线运行/上传并运行时使用的串口，供停止时发送 soft_reset */
  let activeWiredRunPort: string | null = null;
  /** 当前 REPL 终端与端口，用于「连接状态」展示与「REPL断开」 */
  let replTerminal: vscode.Terminal | null = null;
  let replPort: string | null = null;
  /** 当前已选择的蓝牙目标；存在时运行/停止/上传优先走 BLE NUS 通道 */
  let bluetoothTarget: BluetoothTarget | null = null;
  let isBluetoothRunActive = false;

  const runToggleStatusBarItem = createCommandStatusBarItem(context, "$(play) 运行", "xinghan.toggleRunOnDevice", "运行当前文件", 103);
  createCommandStatusBarItem(context, "$(cloud-upload) 上传", "xinghan.upload", "上传到控制器（不运行）", 102);
  createCommandStatusBarItem(context, "$(rocket) 上传运行", "xinghan.uploadAndRun", "上传并在设备上运行", 101);

  // 列出指定端口、容器中的文件（供侧边栏树使用）
  async function listDeviceFilesForTree(port: string, container: string): Promise<DeviceFileInfo[]> {
    await releaseInternalSerialPort({ targetPort: port });
    const config = getConfig();
    const scriptPath = resolveScriptPath(context.extensionPath);
    const args = ["--list-files", "--container", container, "--port", port];
    const { exitCode, stdout } = await runPythonScript(config.pythonPath, scriptPath, args, channel);
    if (exitCode !== 0) throw new Error("list-files failed");
    const raw = stdout.trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<{ name: string; size: string }>;
    return parsed;
  }

  // 从设备读取文件内容（供虚拟文件系统用，不写入 output channel）
  const readDeviceFileContent: ReadDeviceFile = async (port: string, container: string, filename: string): Promise<Uint8Array> => {
    await releaseInternalSerialPort({ targetPort: port });
    return new Promise((resolve, reject) => {
      const config = getConfig();
      const scriptPath = resolveScriptPath(context.extensionPath);
      const args = ["--read-file", filename, "--container", container, "--port", port];
      const proc = spawn(config.pythonPath, [scriptPath, ...args], {
        cwd: path.dirname(scriptPath),
        shell: false,
      });
      let settled = false;
      const chunks: Buffer[] = [];
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { proc.kill("SIGKILL"); } catch { /* ignore */ }
        reject(new Error("read-file timeout"));
      }, PROCESS_TIMEOUT_MS);
      proc.stdout?.on("data", (d: Buffer) => chunks.push(d));
      proc.stderr?.on("data", () => {});
      proc.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code === 0) resolve(Buffer.concat(chunks));
        else reject(new Error(`read-file exited with ${code}`));
      });
      proc.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
    });
  };

  // 将内容写入设备文件（供虚拟文件系统保存用）
  const writeDeviceFileContent: WriteDeviceFile = async (port: string, container: string, filename: string, content: Uint8Array): Promise<void> => {
    await releaseInternalSerialPort({ targetPort: port });
    return new Promise((resolve, reject) => {
      const config = getConfig();
      const scriptPath = resolveScriptPath(context.extensionPath);
      const args = ["--write-file", filename, "--container", container, "--port", port];
      const proc = spawn(config.pythonPath, [scriptPath, ...args], {
        cwd: path.dirname(scriptPath),
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { proc.kill("SIGKILL"); } catch { /* ignore */ }
        reject(new Error("write-file timeout"));
      }, PROCESS_TIMEOUT_MS);
      const stdin = proc.stdin;
      if (!stdin) {
        clearTimeout(timer);
        reject(new Error("No stdin"));
        return;
      }
      stdin.write(content, (err) => {
        if (err) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(err);
        } else {
          stdin.end();
        }
      });
      proc.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`write-file exited with ${code}`));
      });
      proc.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
    });
  };

  // 虚拟文件系统：设备文件可在 IDE 中打开并保存回设备
  const deviceFsProvider = new XinghanDeviceFileSystemProvider(readDeviceFileContent, writeDeviceFileContent);
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider("xinghan-device", deviceFsProvider, { isCaseSensitive: true })
  );

  // 列出星瀚控制器可用端口（含设备 ID、短展示名与 USB 序列号，供「连接状态」「星瀚控制器」与选择端口使用）
  type PortInfo = { device: string; display?: string; serial_number?: string | null; device_id?: string | null };
  const deviceIdCache = new Map<string, string>();
  let listXinghanPortsInFlight: Promise<PortInfo[]> | null = null;

  function cacheKeyForPort(p: PortInfo): string {
    return p.serial_number || p.device;
  }

  function applyCachedDeviceIds(ports: PortInfo[]): PortInfo[] {
    return ports.map((p) => {
      const cacheKey = cacheKeyForPort(p);
      if (p.device_id) {
        deviceIdCache.set(cacheKey, p.device_id);
        deviceIdCache.set(p.device, p.device_id);
        return p;
      }
      const cachedDeviceId = deviceIdCache.get(cacheKey) ?? deviceIdCache.get(p.device);
      return cachedDeviceId ? { ...p, device_id: cachedDeviceId } : p;
    });
  }

  async function listXinghanPorts(): Promise<PortInfo[]> {
    if (!listXinghanPortsInFlight) {
      listXinghanPortsInFlight = (async () => {
        const config = getConfig();
        const scriptPath = resolveScriptPath(context.extensionPath);
        const portsJson = await new Promise<string>((resolve, reject) => {
          const proc = spawn(config.pythonPath, [scriptPath, "--list-ports-xinghan-with-mac"], {
            cwd: path.dirname(scriptPath),
            shell: false,
          });
          let settled = false;
          const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            try { proc.kill("SIGKILL"); } catch { /* ignore */ }
            reject(new Error("list-ports timeout"));
          }, 10_000);
          const chunks: string[] = [];
          proc.stdout?.on("data", (d: Buffer) => chunks.push(d.toString()));
          proc.stderr?.on("data", () => {});
          proc.on("close", (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (code === 0) resolve(chunks.join(""));
            else reject(new Error(`list-ports-xinghan-with-mac exited with ${code}`));
          });
          proc.on("error", (err) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(err);
          });
        }).catch(() => "");
        try {
          const raw = portsJson.trim();
          const ports = raw ? (JSON.parse(raw) as PortInfo[]) : [];
          return applyCachedDeviceIds(ports);
        } catch {
          return [];
        }
      })().finally(() => {
        listXinghanPortsInFlight = null;
      });
    }
    return listXinghanPortsInFlight;
  }

  /** 展示用：优先显示设备 ID；读取失败时只回退到短串口号，避免展示难识别的 MAC */
  function formatPortLabel(p: PortInfo): string {
    if (p.device_id) return p.device_id;
    return p.display ?? p.device;
  }

  type BluetoothDeviceInfo = { name: string; address: string; rssi?: number | null };

  async function runBleScript(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const config = getConfig();
    const scriptPath = resolveBleScriptPath(context.extensionPath);
    if (!(await ensureBleDependencies(config.pythonPath, channel))) {
      return { exitCode: -1, stdout: "", stderr: "missing bleak" };
    }
    return runPythonScript(config.pythonPath, scriptPath, args, channel);
  }

  /** 启动可跟踪的蓝牙脚本进程，便于「星瀚停止」在运行期间中断并复位设备 */
  async function spawnTrackedBleScript(
    args: string[],
    callbacks?: {
      onSuccess?: (exitCode: number) => void;
      onFailure?: (exitCode: number) => void;
    }
  ): Promise<number> {
    const config = getConfig();
    const scriptPath = resolveBleScriptPath(context.extensionPath);
    if (!(await ensureBleDependencies(config.pythonPath, channel))) {
      return -1;
    }

    return new Promise((resolve) => {
      const fullCmd = [config.pythonPath, scriptPath, ...args].join(" ");
      channel.appendLine(`> ${fullCmd}`);
      channel.appendLine("");

      const proc = spawn(config.pythonPath, [scriptPath, ...args], {
        cwd: path.dirname(scriptPath),
        shell: false,
      });
      runOnDeviceProcess = proc;
      isBluetoothRunActive = true;
      setRunOnDeviceActive(true);

      const stdoutDecoder = new StringDecoder("utf8");
      const stderrDecoder = new StringDecoder("utf8");
      let lastBlocks = 0;
      let progressStarted = false;
      const barLen = 20;

      proc.stdout?.on("data", (data: Buffer) => {
        const text = decodeUtf8Chunk(stdoutDecoder, data);
        const lines = text.split(/\r?\n/);
        for (const line of lines) {
          const m = line.match(/##PROGRESS:(\d+)##/);
          if (m) {
            const pct = parseInt(m[1], 10);
            const filled = Math.round(barLen * pct / 100);
            if (!progressStarted) {
              channel.append("📦 ");
              progressStarted = true;
            }
            if (filled > lastBlocks) {
              channel.append("█".repeat(filled - lastBlocks));
              lastBlocks = filled;
            }
            if (pct >= 100) {
              channel.appendLine(` ${pct}%`);
            }
          } else if (line.trim()) {
            channel.appendLine(line);
          }
        }
      });
      proc.stderr?.on("data", (data: Buffer) => {
        channel.append(decodeUtf8Chunk(stderrDecoder, data));
      });

      proc.on("close", (code, signal) => {
        const stdoutTail = flushUtf8Decoder(stdoutDecoder);
        const stderrTail = flushUtf8Decoder(stderrDecoder);
        if (stdoutTail) {
          channel.append(stdoutTail);
        }
        if (stderrTail) {
          channel.append(stderrTail);
        }
        runOnDeviceProcess = null;
        const exitCode = code ?? -1;
        channel.appendLine("");
        channel.appendLine(`[退出码 ${code ?? "—"}${signal ? `，信号 ${signal}` : ""}]`);
        if (exitCode === 0) {
          isBluetoothRunActive = true;
          setRunOnDeviceActive(true);
          callbacks?.onSuccess?.(exitCode);
        } else {
          isBluetoothRunActive = false;
          setRunOnDeviceActive(false);
          callbacks?.onFailure?.(exitCode);
        }
        resolve(exitCode);
      });

      proc.on("error", (err) => {
        runOnDeviceProcess = null;
        isBluetoothRunActive = false;
        setRunOnDeviceActive(false);
        channel.appendLine(`❌ 启动失败: ${err.message}`);
        callbacks?.onFailure?.(-1);
        resolve(-1);
      });
    });
  }

  function bluetoothArgs(target: BluetoothTarget): string[] {
    const config = getConfig();
    return ["--address", target.address, "--timeout", String(config.bluetoothCommandTimeout)];
  }

  function getBluetoothTargetOrWarn(): BluetoothTarget | null {
    if (!bluetoothTarget) {
      return null;
    }
    return bluetoothTarget;
  }

  /** 上传或运行时解析端口：0 个返回 null；1 个直接返回；2 个以上弹出选择，返回所选或 null */
  async function resolvePortForUploadOrRun(): Promise<string | null> {
    const ports = await listXinghanPorts();
    if (ports.length === 0) return null;
    if (ports.length === 1) return ports[0].device;
    const chosen = await vscode.window.showQuickPick(
      ports.map((p) => ({ label: formatPortLabel(p), description: p.device, device: p.device })),
      { title: "选择星瀚控制器端口", placeHolder: "检测到多个设备，请选择要使用的端口", matchOnDescription: true }
    );
    return chosen?.device ?? null;
  }

  async function pickUploadContainer(pickerTitle: string): Promise<string | null> {
    const container = await vscode.window.showQuickPick(
      CONTAINERS.map((c) => ({ label: c, container: c })),
      { title: pickerTitle, placeHolder: "container1 ~ container5" }
    );
    return container?.container ?? null;
  }

  function startWiredUploadAndRun(filePath: string, port: string, container: string): void {
    const config = getConfig();
    const scriptPath = resolveScriptPath(context.extensionPath);
    const args = [filePath, "--upload-and-run", "--container", container, "--port", port];

    const fullCmd = [config.pythonPath, scriptPath, ...args].join(" ");
    channel.appendLine(`> ${fullCmd}`);
    channel.appendLine("");

    activeWiredRunPort = port;
    const proc = spawn(config.pythonPath, [scriptPath, ...args], {
      cwd: path.dirname(scriptPath),
      shell: false,
    });
    runOnDeviceProcess = proc;
    isBluetoothRunActive = false;
    setRunOnDeviceActive(true);

    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    let lastBlocks = 0;
    let progressStarted = false;
    const barLen = 20;
    proc.stdout?.on("data", (data: Buffer) => {
      const text = decodeUtf8Chunk(stdoutDecoder, data);
      const lines = text.split(/\r?\n/);
      for (const line of lines) {
        const m = line.match(/##PROGRESS:(\d+)##/);
        if (m) {
          const pct = parseInt(m[1], 10);
          const filled = Math.round(barLen * pct / 100);
          if (!progressStarted) {
            channel.append("📦 ");
            progressStarted = true;
          }
          if (filled > lastBlocks) {
            channel.append("█".repeat(filled - lastBlocks));
            lastBlocks = filled;
          }
          if (pct >= 100) {
            channel.appendLine(` ${pct}%`);
          }
        } else if (line.trim()) {
          channel.appendLine(line);
        }
      }
    });
    proc.stderr?.on("data", (data: Buffer) => {
      channel.append(decodeUtf8Chunk(stderrDecoder, data));
    });

    proc.on("close", (code, signal) => {
      const stdoutTail = flushUtf8Decoder(stdoutDecoder);
      const stderrTail = flushUtf8Decoder(stderrDecoder);
      if (stdoutTail) {
        channel.append(stdoutTail);
      }
      if (stderrTail) {
        channel.append(stderrTail);
      }
      runOnDeviceProcess = null;
      activeWiredRunPort = null;
      setRunOnDeviceActive(false);
      channel.appendLine("");
      channel.appendLine(`[退出码 ${code ?? "—"}${signal ? `，信号 ${signal}` : ""}]`);
      if (code === 0) {
        outputInfo(channel, `星瀚: 已上传并运行到 ${container}`);
        deviceFilesTreeProvider.refresh();
      } else if (code !== null && code !== undefined && code !== 0) {
        outputError(channel, "星瀚: 上传并运行失败或已中断，请查看输出。");
      }
    });

    proc.on("error", (err) => {
      runOnDeviceProcess = null;
      activeWiredRunPort = null;
      setRunOnDeviceActive(false);
      channel.appendLine(`❌ 启动失败: ${err.message}`);
      outputError(channel, `星瀚: 启动失败 — ${err.message}`);
    });
  }

  // 左侧边栏：三栏独立视图（星瀚助手 / 连接状态 / 星瀚控制器）
  const actionsTreeProvider = new XinghanActionsTreeProvider();
  const connectionStatusTreeProvider = new ConnectionStatusTreeProvider(listXinghanPorts);
  const deviceFilesTreeProvider = new XinghanDeviceFilesTreeProvider({
    containers: CONTAINERS,
    listPorts: listXinghanPorts,
    listDeviceFiles: listDeviceFilesForTree,
  });
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("xinghan.actionsView", actionsTreeProvider)
  );
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("xinghan.connectionStatusView", connectionStatusTreeProvider)
  );
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("xinghan.deviceFilesView", deviceFilesTreeProvider)
  );

  function setRunOnDeviceActive(isActive: boolean): void {
    actionsTreeProvider.setRunOnDeviceActive(isActive);
    runToggleStatusBarItem.text = isActive ? "$(debug-stop) 停止" : "$(play) 运行";
    runToggleStatusBarItem.tooltip = isActive ? "停止设备上正在运行的程序" : "运行当前文件";
  }

  /**
   * 有线操作前释放插件自身占用的串口：停止「在设备上运行」、按需断开 REPL。
   * targetPort 未指定时视为占用默认端口，会断开当前 REPL。
   */
  async function releaseInternalSerialPort(options: {
    targetPort?: string | null;
    disconnectRepl?: "matching" | "always" | "never";
    stopRun?: boolean;
    log?: boolean;
    reason?: string;
  }): Promise<void> {
    const {
      targetPort,
      disconnectRepl = "matching",
      stopRun = true,
      log = false,
      reason = "释放串口",
    } = options;
    let released = false;

    const shouldDisconnectRepl =
      replTerminal &&
      disconnectRepl !== "never" &&
      (disconnectRepl === "always" || targetPort == null || replPort === targetPort);

    if (shouldDisconnectRepl && replTerminal) {
      if (log) {
        channel.show(true);
        channel.appendLine(`正在断开 REPL 以${reason}…`);
      }
      replTerminal.dispose();
      replTerminal = null;
      replPort = null;
      actionsTreeProvider.setReplConnected(false);
      connectionStatusTreeProvider.setPort(null);
      released = true;
    }

    if (stopRun && runOnDeviceProcess) {
      if (log) {
        channel.show(true);
        channel.appendLine(`正在停止设备上的运行以${reason}…`);
      }
      await stopRunOnDeviceProcess(runOnDeviceProcess);
      runOnDeviceProcess = null;
      setRunOnDeviceActive(false);
      released = true;
    }

    if (released) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // 连接状态 / 星瀚控制器 的「刷新」按钮：任按其一都会同时刷新两栏（防抖 1s）
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  function debouncedRefresh(): void {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      connectionStatusTreeProvider.refresh();
      deviceFilesTreeProvider.refresh();
    }, 1000);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("xinghan.refreshConnectionStatus", () => {
      debouncedRefresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("xinghan.refreshDeviceFiles", () => {
      debouncedRefresh();
    })
  );

  // 连接状态栏：右键复制设备编号或串口信息
  context.subscriptions.push(
    vscode.commands.registerCommand("xinghan.copyConnectionDeviceId", async (node: ConnectionStatusNode) => {
      const deviceId = node?.deviceId;
      if (!deviceId) {
        outputWarn(channel, "当前连接状态没有可复制的设备编号。");
        return;
      }
      await vscode.env.clipboard.writeText(deviceId);
      outputInfo(channel, `已复制设备编号：${deviceId}`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("xinghan.copyConnectionPort", async (node: ConnectionStatusNode) => {
      const path = node?.portPath;
      if (!path) {
        return;
      }
      await vscode.env.clipboard.writeText(path);
      outputInfo(channel, `已复制串口：${path}`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("xinghan.connectBluetooth", async () => {
      const config = getConfig();
      channel.show(true);
      channel.clear();
      channel.appendLine("正在扫描星瀚蓝牙设备...");

      async function streamScanAndPick(prefix: string): Promise<BluetoothDeviceInfo | undefined> {
        const scriptPath = resolveBleScriptPath(context.extensionPath);
        if (!(await ensureBleDependencies(config.pythonPath, channel))) {
          return undefined;
        }

        const args = ["--scan-stream", "--timeout", String(config.bluetoothScanTimeout)];
        if (prefix.trim()) {
          args.push("--name-prefix", prefix.trim());
        }

        return new Promise<BluetoothDeviceInfo | undefined>((resolve) => {
          const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { device: BluetoothDeviceInfo }>();
          quickPick.title = "选择星瀚蓝牙设备";
          quickPick.placeholder = "扫描中，设备发现后会自动出现...";
          quickPick.matchOnDescription = true;
          quickPick.matchOnDetail = true;
          quickPick.busy = true;
          quickPick.items = [];
          quickPick.show();

          const devices: BluetoothDeviceInfo[] = [];
          let settled = false;

          const proc = spawn(config.pythonPath, [scriptPath, ...args], {
            cwd: path.dirname(scriptPath),
            shell: false,
          });

          const stdoutDecoder = new StringDecoder("utf8");
          let lineBuf = "";

          proc.stdout?.on("data", (data: Buffer) => {
            lineBuf += stdoutDecoder.write(data);
            const lines = lineBuf.split("\n");
            lineBuf = lines.pop() || "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed === "__SCAN_DONE__") {
                quickPick.busy = false;
                quickPick.placeholder = devices.length === 0
                  ? "未发现蓝牙设备"
                  : `扫描完成，共发现 ${devices.length} 个设备`;
                return;
              }
              if (!trimmed) { continue; }
              try {
                const device = JSON.parse(trimmed) as BluetoothDeviceInfo;
                devices.push(device);
                quickPick.items = devices.map((d) => ({
                  label: d.name,
                  description: d.address,
                  detail: d.rssi === null || d.rssi === undefined ? undefined : `RSSI: ${d.rssi}`,
                  device: d,
                }));
              } catch {
                // ignore non-JSON lines
              }
            }
          });

          proc.stderr?.on("data", (data: Buffer) => {
            channel.append(data.toString("utf8"));
          });

          proc.on("close", () => {
            quickPick.busy = false;
            if (devices.length === 0 && !settled) {
              quickPick.placeholder = "未发现蓝牙设备";
            }
          });

          quickPick.onDidAccept(() => {
            const selected = quickPick.selectedItems[0];
            settled = true;
            quickPick.dispose();
            proc.kill();
            resolve(selected ? selected.device : undefined);
          });

          quickPick.onDidHide(() => {
            if (!settled) {
              settled = true;
              proc.kill();
              resolve(undefined);
            }
          });
        });
      }

      let device = await streamScanAndPick(config.bluetoothNamePrefix);

      if (!device && config.bluetoothNamePrefix.trim()) {
        const retry = await vscode.window.showInformationMessage(
          `没有扫描到名称以 ${config.bluetoothNamePrefix} 开头的蓝牙设备。`,
          "扫描全部设备",
          "取消"
        );
        if (retry === "扫描全部设备") {
          channel.appendLine("\n正在扫描全部 BLE 设备...");
          device = await streamScanAndPick("");
        }
      }

      if (!device) {
        return;
      }

      channel.appendLine(`\n正在连接蓝牙设备：${device.name} (${device.address})`);
      const { exitCode } = await runBleScript([...bluetoothArgs(device), "--connect-check"]);
      if (exitCode !== 0) {
        outputError(channel, "星瀚: 蓝牙连接失败，请确认设备已开启 Nordic UART Service。");
        return;
      }

      bluetoothTarget = { name: device.name, address: device.address };
      actionsTreeProvider.setBluetoothConnected(true);
      connectionStatusTreeProvider.setBluetoothDevice(bluetoothTarget);
      deviceFilesTreeProvider.setBluetoothDevice(bluetoothTarget);
      outputInfo(channel, `星瀚: 已连接蓝牙设备 ${bluetoothTarget.name}`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("xinghan.disconnectBluetooth", () => {
      if (!bluetoothTarget) {
        outputInfo(channel, "星瀚: 当前没有蓝牙连接。");
        return;
      }
      const name = bluetoothTarget.name;
      bluetoothTarget = null;
      isBluetoothRunActive = false;
      actionsTreeProvider.setBluetoothConnected(false);
      setRunOnDeviceActive(runOnDeviceProcess !== null);
      connectionStatusTreeProvider.setBluetoothDevice(null);
      deviceFilesTreeProvider.setBluetoothDevice(null);
      outputInfo(channel, `星瀚: 已断开蓝牙设备 ${name}，恢复有线操作。`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("xinghan.toggleBluetooth", async () => {
      if (bluetoothTarget) {
        await vscode.commands.executeCommand("xinghan.disconnectBluetooth");
      } else {
        await vscode.commands.executeCommand("xinghan.connectBluetooth");
      }
    })
  );

  // REPL 终端被用户关闭时清除连接状态
  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((closed) => {
      if (replTerminal && closed === replTerminal) {
        replTerminal = null;
        replPort = null;
        actionsTreeProvider.setReplConnected(false);
        connectionStatusTreeProvider.setPort(null);
      }
    })
  );

  // 打开设备上的文件到编辑器（点击树节点或命令）
  context.subscriptions.push(
    vscode.commands.registerCommand("xinghan.openDeviceFile", async (port: string, container: string, filename: string) => {
      const uri = toDeviceUri(port, container, filename);
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false });
    })
  );

  // 保存设备文件后刷新侧边栏树
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.uri.scheme === "xinghan-device") {
        deviceFilesTreeProvider.refresh();
      }
    })
  );

  // 仅上传当前文件到星瀚（不运行）
  context.subscriptions.push(
    vscode.commands.registerCommand("xinghan.upload", async (firstArg?: unknown, selectedResources?: unknown) => {
      await mutex.run("上传", channel, async () => {
      const filePath = resolveLocalFilePathForDevice(channel, firstArg, selectedResources);
      if (!filePath) {
        return;
      }
      if (!(await saveLocalFileIfDirty(channel, filePath, "上传"))) {
        return;
      }

      const config = getConfig();
      const scriptPath = resolveScriptPath(context.extensionPath);

      const bleTarget = getBluetoothTargetOrWarn();
      if (bleTarget) {
        const container = await pickUploadContainer("选择要通过蓝牙上传到的容器");
        if (!container) {
          return;
        }

        channel.show(true);
        channel.clear();
        channel.appendLine(`正在通过蓝牙上传到 ${bleTarget.name}...`);
        const config = getConfig();
        const scriptPath = resolveBleScriptPath(context.extensionPath);
        if (!(await ensureBleDependencies(config.pythonPath, channel))) {
          return;
        }
        const fileSizeKB = Math.ceil(fs.statSync(filePath).size / 1024);
        const bleUploadTimeoutMs = Math.max(PROCESS_TIMEOUT_MS, (60 + fileSizeKB) * 1000);
        let lastBlocks = 0;
        let progressStarted = false;
        const barLen = 20;
        const { exitCode } = await runPythonScript(
          config.pythonPath,
          scriptPath,
          [...bluetoothArgs(bleTarget), "--upload", filePath, "--container", container],
          channel,
          undefined,
          bleUploadTimeoutMs,
          (pct) => {
            const filled = Math.round(barLen * pct / 100);
            if (!progressStarted) {
              channel.append("📦 ");
              progressStarted = true;
            }
            if (filled > lastBlocks) {
              channel.append("█".repeat(filled - lastBlocks));
              lastBlocks = filled;
            }
            if (pct >= 100) {
              channel.appendLine(` ${pct}%`);
            }
          }
        );
        if (exitCode === 0) {
          outputInfo(channel, `星瀚: 已通过蓝牙上传到 ${container}`);
        } else {
          outputError(channel, "星瀚: 蓝牙上传失败，请查看输出。");
        }
        return;
      }

      if (!(await ensureDependencies(config.pythonPath, channel))) {
        return;
      }

      const port = await resolvePortForUploadOrRun();
      if (port === null) {
        outputWarn(channel, "未找到星瀚控制器或已取消选择端口。请连接设备后重试。");
        return;
      }

      const container = await pickUploadContainer("选择要上传到的容器");
      if (!container) {
        return;
      }

      channel.show(true);
      channel.clear();
      await releaseInternalSerialPort({ targetPort: port, log: true, reason: "上传" });

      const args = [filePath, "--upload-and-monitor", "--container", container, "--port", port];
      const fullCmd = [config.pythonPath, scriptPath, ...args].join(" ");
      channel.appendLine(`> ${fullCmd}`);
      channel.appendLine("");

      activeWiredRunPort = port;
      const proc = spawn(config.pythonPath, [scriptPath, ...args], {
        cwd: path.dirname(scriptPath),
        shell: false,
      });
      runOnDeviceProcess = proc;
      isBluetoothRunActive = false;
      setRunOnDeviceActive(true);

      const stdoutDecoder = new StringDecoder("utf8");
      const stderrDecoder = new StringDecoder("utf8");
      let lastBlocks2 = 0;
      let progressStarted2 = false;
      const barLen2 = 20;
      proc.stdout?.on("data", (data: Buffer) => {
        const text = decodeUtf8Chunk(stdoutDecoder, data);
        const lines = text.split(/\r?\n/);
        for (const line of lines) {
          const m = line.match(/##PROGRESS:(\d+)##/);
          if (m) {
            const pct = parseInt(m[1], 10);
            const filled = Math.round(barLen2 * pct / 100);
            if (!progressStarted2) {
              channel.append("📦 ");
              progressStarted2 = true;
            }
            if (filled > lastBlocks2) {
              channel.append("█".repeat(filled - lastBlocks2));
              lastBlocks2 = filled;
            }
            if (pct >= 100) {
              channel.appendLine(` ${pct}%`);
            }
          } else if (line.trim()) {
            channel.appendLine(line);
          }
        }
      });
      proc.stderr?.on("data", (data: Buffer) => {
        channel.append(decodeUtf8Chunk(stderrDecoder, data));
      });

      proc.on("close", (code, signal) => {
        const stdoutTail = flushUtf8Decoder(stdoutDecoder);
        const stderrTail = flushUtf8Decoder(stderrDecoder);
        if (stdoutTail) {
          channel.append(stdoutTail);
        }
        if (stderrTail) {
          channel.append(stderrTail);
        }
        runOnDeviceProcess = null;
        activeWiredRunPort = null;
        setRunOnDeviceActive(false);
        channel.appendLine("");
        channel.appendLine(`[退出码 ${code ?? "—"}${signal ? `，信号 ${signal}` : ""}]`);
        if (code === 0) {
          outputInfo(channel, `星瀚: 已上传到 ${container}`);
          deviceFilesTreeProvider.refresh();
        } else if (code !== null && code !== undefined && code !== 0) {
          outputError(channel, "星瀚: 上传失败或已中断，请查看输出。");
        }
      });

      proc.on("error", (err) => {
        runOnDeviceProcess = null;
        activeWiredRunPort = null;
        setRunOnDeviceActive(false);
        channel.appendLine(`❌ 启动失败: ${err.message}`);
        outputError(channel, `星瀚: 启动失败 — ${err.message}`);
      });
      });
    })
  );

  // 上传当前文件到星瀚并在设备上运行
  context.subscriptions.push(
    vscode.commands.registerCommand("xinghan.uploadAndRun", async (firstArg?: unknown, selectedResources?: unknown) => {
      await mutex.run("上传并运行", channel, async () => {
      const filePath = resolveLocalFilePathForDevice(channel, firstArg, selectedResources);
      if (!filePath) {
        return;
      }
      if (!(await saveLocalFileIfDirty(channel, filePath, "上传并运行"))) {
        return;
      }

      const bleTarget = getBluetoothTargetOrWarn();
      if (bleTarget) {
        const container = await pickUploadContainer("选择要通过蓝牙上传并运行到的容器");
        if (!container) {
          return;
        }

        channel.show(true);
        channel.clear();
        channel.appendLine(`正在通过蓝牙上传并运行到 ${bleTarget.name}...`);
        if (runOnDeviceProcess) {
          channel.appendLine("正在停止当前有线运行进程...");
          await stopRunOnDeviceProcess(runOnDeviceProcess);
          runOnDeviceProcess = null;
          setRunOnDeviceActive(false);
        }
        await spawnTrackedBleScript(
          [
            ...bluetoothArgs(bleTarget),
            "--upload-and-run",
            filePath,
            "--container",
            container,
          ],
          {
            onSuccess: () => outputInfo(channel, `星瀚: 已通过蓝牙上传并运行到 ${container}`),
            onFailure: () => outputError(channel, "星瀚: 蓝牙上传并运行失败，请查看输出。"),
          }
        );
        return;
      }

      const config = getConfig();
      if (!(await ensureDependencies(config.pythonPath, channel))) {
        return;
      }

      const port = await resolvePortForUploadOrRun();
      if (port === null) {
        outputWarn(channel, "未找到星瀚控制器或已取消选择端口。请连接设备后重试。");
        return;
      }

      const container = await pickUploadContainer("选择要上传并运行到的容器");
      if (!container) {
        return;
      }

      channel.show(true);
      channel.clear();
      await releaseInternalSerialPort({ targetPort: port, log: true, reason: "上传并运行" });
      startWiredUploadAndRun(filePath, port, container);
      });
    })
  );

  // 在控制器上直接运行当前文件（不写入设备，实时输出）；再次执行会先停止当前运行再运行新脚本
  context.subscriptions.push(
    vscode.commands.registerCommand("xinghan.runOnDevice", async (firstArg?: unknown, selectedResources?: unknown) => {
      await mutex.run("运行", channel, async () => {
      const filePath = resolveLocalFilePathForDevice(channel, firstArg, selectedResources);
      if (!filePath) {
        return;
      }
      if (!(await saveLocalFileIfDirty(channel, filePath, "运行"))) {
        return;
      }

      const config = getConfig();

      const bleTarget = getBluetoothTargetOrWarn();
      if (bleTarget) {
        if (runOnDeviceProcess) {
          channel.show(true);
          channel.appendLine("[蓝牙运行] 正在停止当前有线运行进程...");
          await stopRunOnDeviceProcess(runOnDeviceProcess);
          runOnDeviceProcess = null;
          setRunOnDeviceActive(false);
          await new Promise((r) => setTimeout(r, 500));
        }

        channel.show(true);
        channel.clear();
        channel.appendLine(`正在通过蓝牙运行 ${path.basename(filePath)}...`);
        await spawnTrackedBleScript(
          [
            ...bluetoothArgs(bleTarget),
            "--run-file",
            filePath,
            "--container",
            config.bluetoothRunContainer,
          ],
          {
            onSuccess: () => outputInfo(channel, "星瀚: 蓝牙运行命令已发送"),
            onFailure: () => outputError(channel, "星瀚: 蓝牙运行失败，请查看输出。"),
          }
        );
        return;
      }

      // 检查依赖
      if (!(await ensureDependencies(config.pythonPath, channel))) {
        return;
      }

      const port = await resolvePortForUploadOrRun();
      if (port === null) {
        outputWarn(channel, "未找到星瀚控制器或已取消选择端口。请连接设备后重试。");
        return;
      }

      await releaseInternalSerialPort({ targetPort: port, log: true, reason: "运行" });

      const scriptPath = resolveScriptPath(context.extensionPath);

      channel.show(true);
      channel.clear();

      const args = [filePath, "--run", "--port", port];

      const fullCmd = [config.pythonPath, scriptPath, ...args].join(" ");
      channel.appendLine(`> ${fullCmd}`);
      channel.appendLine("");

      activeWiredRunPort = port;
      const proc = spawn(config.pythonPath, [scriptPath, ...args], {
        cwd: path.dirname(scriptPath),
        shell: false,
      });
      runOnDeviceProcess = proc;
      isBluetoothRunActive = false;
      setRunOnDeviceActive(true);

      const runStdoutDecoder = new StringDecoder("utf8");
      const runStderrDecoder = new StringDecoder("utf8");
      proc.stdout?.on("data", (data: Buffer) => {
        const text = decodeUtf8Chunk(runStdoutDecoder, data);
        channel.append(text);
      });
      proc.stderr?.on("data", (data: Buffer) => {
        const text = decodeUtf8Chunk(runStderrDecoder, data);
        channel.append(text);
      });

      proc.on("close", (code, signal) => {
        const stdoutTail = flushUtf8Decoder(runStdoutDecoder);
        const stderrTail = flushUtf8Decoder(runStderrDecoder);
        if (stdoutTail) {
          channel.append(stdoutTail);
        }
        if (stderrTail) {
          channel.append(stderrTail);
        }
        runOnDeviceProcess = null;
        activeWiredRunPort = null;
        setRunOnDeviceActive(false);
        channel.appendLine("");
        channel.appendLine(`[退出码 ${code ?? "—"}${signal ? `，信号 ${signal}` : ""}]`);
        if (code === 0) {
          outputInfo(channel, "星瀚: 运行结束");
        } else if (code !== null && code !== undefined && code !== 0) {
          outputError(channel, "星瀚: 运行失败或已中断，请查看输出。");
        }
      });

      proc.on("error", (err) => {
        runOnDeviceProcess = null;
        activeWiredRunPort = null;
        setRunOnDeviceActive(false);
        channel.appendLine(`❌ 启动失败: ${err.message}`);
        outputError(channel, `星瀚: 启动失败 — ${err.message}`);
      });
      });
    })
  );

  // 停止当前在设备上运行的程序：先结束本机进程释放串口，再向设备发送软复位
  context.subscriptions.push(
    vscode.commands.registerCommand("xinghan.stopRunOnDevice", async () => {
      const bleTarget = getBluetoothTargetOrWarn();
      if (bleTarget) {
        if (!runOnDeviceProcess && !isBluetoothRunActive) {
          outputInfo(channel, "当前没有在设备上运行的程序。");
          return;
        }
        if (runOnDeviceProcess) {
          channel.show(true);
          channel.appendLine("\n[蓝牙停止] 正在终止当前运行进程...");
          await stopRunOnDeviceProcess(runOnDeviceProcess);
          runOnDeviceProcess = null;
          await new Promise((r) => setTimeout(r, 500));
        }
        channel.show(true);
        channel.appendLine(`\n正在通过蓝牙停止 ${bleTarget.name}...`);
        const { exitCode } = await runBleScript([...bluetoothArgs(bleTarget), "--stop"]);
        if (exitCode === 0) {
          isBluetoothRunActive = false;
          setRunOnDeviceActive(false);
          outputInfo(channel, "星瀚: 已通过蓝牙停止设备上的运行");
        } else {
          outputError(channel, "星瀚: 蓝牙停止失败，请查看输出。");
        }
        return;
      }

      if (!runOnDeviceProcess) {
        outputInfo(channel, "当前没有在设备上运行的程序。");
        return;
      }
      channel.appendLine("\n[用户请求停止] 正在终止本机进程并释放串口…");
      const config = getConfig();
      const resetPort = activeWiredRunPort ?? config.serialPort ?? undefined;
      await stopRunOnDeviceProcess(runOnDeviceProcess);
      runOnDeviceProcess = null;
      activeWiredRunPort = null;
      setRunOnDeviceActive(false);
      await new Promise((r) => setTimeout(r, 500));

      const scriptPath = resolveScriptPath(context.extensionPath);
      const args = ["--soft-reset"];
      if (resetPort) {
        args.push("--port", resetPort);
      }
      channel.appendLine("正在向设备发送软复位…");
      const proc = spawn(config.pythonPath, [scriptPath, ...args], {
        cwd: path.dirname(scriptPath),
        shell: false,
      });
      await new Promise<void>((resolve) => proc.on("close", () => resolve()));
      outputInfo(channel, "星瀚: 已停止设备上的运行");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("xinghan.toggleRunOnDevice", async (firstArg?: unknown, selectedResources?: unknown) => {
      if (runOnDeviceProcess || isBluetoothRunActive) {
        await vscode.commands.executeCommand("xinghan.stopRunOnDevice");
      } else {
        await vscode.commands.executeCommand("xinghan.runOnDevice", firstArg, selectedResources);
      }
    })
  );

  // 删除控制器上的文件
  context.subscriptions.push(
    vscode.commands.registerCommand("xinghan.deleteFile", async () => {
      await mutex.run("删除文件", channel, async () => {
      const config = getConfig();
      const scriptPath = resolveScriptPath(context.extensionPath);

      // 检查依赖
      if (!(await ensureDependencies(config.pythonPath, channel))) {
        return;
      }

      await releaseInternalSerialPort({ targetPort: config.serialPort, log: true, reason: "删除文件" });

      // 1. 选择容器
      const container = await vscode.window.showQuickPick(
        CONTAINERS.map((c) => ({ label: c, container: c })),
        { title: "选择要删除文件的容器", placeHolder: "container1 ~ container5" }
      );
      if (!container) {
        return;
      }

      channel.show(true);
      channel.clear();
      channel.appendLine(`正在列出 ${container.container} 中的文件...`);

      // 2. 列出该容器中的文件
      const listArgs = ["--list-files", "--container", container.container];
      if (config.serialPort) {
        listArgs.push("--port", config.serialPort);
      }

      const { exitCode: listExitCode, stdout: listStdout } = await runPythonScript(
        config.pythonPath,
        scriptPath,
        listArgs,
        channel
      );

      if (listExitCode !== 0) {
        outputError(channel, "星瀚: 列出文件失败，请查看输出。");
        return;
      }

      let files: Array<{ name: string; size: string }>;
      try {
        files = JSON.parse(listStdout.trim());
      } catch {
        outputError(channel, "星瀚: 解析文件列表失败。");
        return;
      }

      if (files.length === 0) {
        outputInfo(channel, `${container.container} 中没有文件。`);
        return;
      }

      // 3. 选择要删除的文件
      const fileToDelete = await vscode.window.showQuickPick(
        files.map((f) => ({ label: f.name, description: `${f.size} bytes`, filename: f.name })),
        { title: `选择要删除的文件（${container.container}）`, placeHolder: "选择文件" }
      );
      if (!fileToDelete) {
        return;
      }

      // 4. 二次确认
      const confirm = await vscode.window.showWarningMessage(
        `确定要删除 ${container.container}/${fileToDelete.filename} 吗？`,
        { modal: true },
        "删除"
      );
      if (confirm !== "删除") {
        return;
      }

      // 5. 执行删除
      channel.appendLine(`\n正在删除 ${fileToDelete.filename}...`);
      const deleteArgs = ["--delete", fileToDelete.filename, "--container", container.container];
      if (config.serialPort) {
        deleteArgs.push("--port", config.serialPort);
      }

      const { exitCode: deleteExitCode } = await runPythonScript(
        config.pythonPath,
        scriptPath,
        deleteArgs,
        channel
      );

      if (deleteExitCode === 0) {
        outputInfo(channel, `星瀚: 已删除 ${container.container}/${fileToDelete.filename}`);
        deviceFilesTreeProvider.refresh();
      } else {
        outputError(channel, "星瀚: 删除失败，请查看输出。");
      }
      });
    })
  );

  // 从侧边栏树中删除设备上的文件（右键菜单）
  context.subscriptions.push(
    vscode.commands.registerCommand("xinghan.deleteFileFromTree", async (element: { kind: string; port?: string; container?: string; name?: string }) => {
      await mutex.run("删除文件", channel, async () => {
      if (!element || element.kind !== "deviceFile" || !element.port || !element.container || !element.name) return;
      const config = getConfig();
      const scriptPath = resolveScriptPath(context.extensionPath);
      await releaseInternalSerialPort({ targetPort: element.port, log: true, reason: "删除文件" });
      const confirm = await vscode.window.showWarningMessage(
        `确定要删除 ${element.container}/${element.name} 吗？`,
        { modal: true },
        "删除"
      );
      if (confirm !== "删除") return;
      channel.show(true);
      channel.appendLine(`正在删除 ${element.name}...`);
      if (!(await ensureDependencies(config.pythonPath, channel))) return;
      const deleteArgs = ["--delete", element.name, "--container", element.container, "--port", element.port];
      const { exitCode } = await runPythonScript(config.pythonPath, scriptPath, deleteArgs, channel);
      if (exitCode === 0) {
        outputInfo(channel, `星瀚: 已删除 ${element.container}/${element.name}`);
        deviceFilesTreeProvider.refresh();
      } else {
        outputError(channel, "星瀚: 删除失败，请查看输出。");
      }
      });
    })
  );

  /** 设备树重命名：新文件名校验（与 wired_uploader 一致） */
  function validateDevicePyFilename(name: string): string | null {
    const n = name.trim();
    if (!n || n === "（空）" || n === "无法获取列表") return "无效文件名";
    if (n !== name) return "文件名首尾不能有空格";
    if (n.includes("/") || n.includes("\\")) return "文件名不能包含路径分隔符";
    if (n.includes("..")) return "文件名不能包含 ..";
    if (!n.toLowerCase().endsWith(".py")) return "仅支持 .py 文件";
    return null;
  }

  // 从侧边栏树重命名设备上的文件（右键菜单）
  context.subscriptions.push(
    vscode.commands.registerCommand("xinghan.renameDeviceFileFromTree", async (element: { kind: string; port?: string; container?: string; name?: string }) => {
      await mutex.run("重命名文件", channel, async () => {
      if (!element || element.kind !== "deviceFile" || !element.port || !element.container || !element.name) return;
      const config = getConfig();
      const scriptPath = resolveScriptPath(context.extensionPath);

      const newNameRaw = await vscode.window.showInputBox({
        title: "重命名设备文件",
        prompt: `将 ${element.container}/${element.name} 改名为`,
        value: element.name,
        validateInput: (value) => validateDevicePyFilename(value) ?? undefined,
      });
      if (newNameRaw === undefined) return;
      const newName = newNameRaw.trim();
      const nameErr = validateDevicePyFilename(newName);
      if (nameErr) {
        outputError(channel, `星瀚: ${nameErr}`);
        return;
      }
      if (newName === element.name) {
        outputInfo(channel, "名称未变化。");
        return;
      }

      await releaseInternalSerialPort({ targetPort: element.port, log: true, reason: "重命名文件" });

      channel.show(true);
      channel.appendLine(`正在重命名 ${element.name} → ${newName}...`);
      if (!(await ensureDependencies(config.pythonPath, channel))) return;
      const renameArgs = ["--rename", element.name, newName, "--container", element.container, "--port", element.port];
      const { exitCode } = await runPythonScript(config.pythonPath, scriptPath, renameArgs, channel);
      if (exitCode === 0) {
        outputInfo(channel, `星瀚: 已重命名为 ${element.container}/${newName}`);
        deviceFilesTreeProvider.refresh();
        const oldUri = toDeviceUri(element.port, element.container, element.name);
        const newUri = toDeviceUri(element.port, element.container, newName);
        const ed = vscode.window.activeTextEditor;
        if (ed && ed.document.uri.scheme === "xinghan-device" && ed.document.uri.toString() === oldUri.toString()) {
          const col = ed.viewColumn;
          await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
          const doc = await vscode.workspace.openTextDocument(newUri);
          await vscode.window.showTextDocument(doc, { viewColumn: col, preview: false });
        }
      } else {
        outputError(channel, "星瀚: 重命名失败，请查看输出。");
      }
      });
    })
  );

  // 连接 WiFi
  context.subscriptions.push(
    vscode.commands.registerCommand("xinghan.connectWifi", async () => {
      await mutex.run("WiFi连接", channel, async () => {
      const config = getConfig();
      const scriptPath = resolveScriptPath(context.extensionPath);

      // 检查依赖
      if (!(await ensureDependencies(config.pythonPath, channel))) {
        return;
      }

      await releaseInternalSerialPort({ targetPort: config.serialPort, log: true, reason: "连接 WiFi" });

      // 构建选项：预设 WiFi + 手动输入
      const presetItems = config.wifiPresets.map((w) => ({
        label: w.name,
        description: "预设",
        preset: w,
      }));
      const manualItem = { label: "$(edit) 手动输入 WiFi", description: "", preset: null as WifiPreset | null };

      const choices = [...presetItems, manualItem];

      const chosen = await vscode.window.showQuickPick(choices, {
        title: "选择 WiFi",
        placeHolder: "选择预设 WiFi 或手动输入",
      });

      if (!chosen) {
        return;
      }

      let ssid: string;
      let password: string;
      let authMode = 3;

      if (chosen.preset) {
        ssid = chosen.preset.name;
        password = chosen.preset.password;
        authMode = chosen.preset.authMode ?? 3;
      } else {
        const input = await vscode.window.showInputBox({
          title: "输入 WiFi 名称和密码",
          placeHolder: "WiFi名称 密码",
          prompt: "格式：WiFi名称 密码（用空格分隔）",
        });
        if (!input) {
          return;
        }
        const spaceIndex = input.indexOf(" ");
        if (spaceIndex === -1) {
          outputError(channel, "格式错误，请输入：WiFi名称 密码（用空格分隔）");
          return;
        }
        ssid = input.substring(0, spaceIndex);
        password = input.substring(spaceIndex + 1);
      }

      channel.show(true);
      channel.clear();

      const args = ["--wifi", ssid, password, "--wifi-auth", String(authMode)];
      if (config.serialPort) {
        args.push("--port", config.serialPort);
      }

      const { exitCode } = await runPythonScript(config.pythonPath, scriptPath, args, channel);

      if (exitCode === 0) {
        outputInfo(channel, `星瀚: 已发送 WiFi 连接命令 (${ssid})`);
      } else {
        outputError(channel, "星瀚: WiFi 连接失败，请查看输出。");
      }
      });
    })
  );

  // REPL连接：根据当前模式选择有线或蓝牙 REPL
  context.subscriptions.push(
    vscode.commands.registerCommand("xinghan.selectPortAndRepl", async () => {
      const config = getConfig();

      if (bluetoothTarget) {
        // 蓝牙模式：通过 BLE NUS 进入交互式 REPL
        if (!(await ensureBleDependencies(config.pythonPath, channel))) {
          return;
        }

        await releaseInternalSerialPort({
          disconnectRepl: "always",
          log: true,
          reason: "进入蓝牙 REPL",
        });

        const scriptPath = resolveBleScriptPath(context.extensionPath);
        const term = vscode.window.createTerminal({
          name: "星瀚 REPL (蓝牙)",
          shellPath: config.pythonPath,
          shellArgs: [scriptPath, "--address", bluetoothTarget.address, "--timeout", String(config.bluetoothCommandTimeout), "--repl"],
        });
        term.show();
        replTerminal = term;
        replPort = null;
        actionsTreeProvider.setReplConnected(true);
      } else {
        // 有线模式：选择串口并通过 mpremote 进入 REPL
        if (!(await ensureDependencies(config.pythonPath, channel))) {
          return;
        }

        const ports = await listXinghanPorts();
        if (ports.length === 0) {
          outputWarn(channel, "未找到星瀚控制器。请连接设备（/dev/cu.usbmodem*）后重试。");
          return;
        }

        const chosen = await vscode.window.showQuickPick(
          ports.map((p) => ({ label: formatPortLabel(p), description: p.device, device: p.device, deviceId: p.device_id ?? formatPortLabel(p) })),
          { title: "选择星瀚控制器端口并进入 REPL", matchOnDescription: true }
        );
        if (!chosen) return;

        await releaseInternalSerialPort({
          disconnectRepl: "always",
          log: true,
          reason: "进入 REPL",
        });

        const term = vscode.window.createTerminal({
          name: "星瀚 REPL",
          shellPath: config.pythonPath,
          shellArgs: ["-m", "mpremote", "connect", chosen.device],
        });
        term.show();
        replTerminal = term;
        replPort = chosen.device;
        actionsTreeProvider.setReplConnected(true);
        connectionStatusTreeProvider.setPort(chosen.device, chosen.label, chosen.deviceId);
      }
    })
  );

  // REPL断开：关闭 REPL 终端并释放串口
  context.subscriptions.push(
    vscode.commands.registerCommand("xinghan.disconnectRepl", () => {
      if (!replTerminal) {
        outputInfo(channel, "星瀚: 当前没有通过插件打开的 REPL，无需断开。");
        return;
      }
      replTerminal.dispose();
      replTerminal = null;
      replPort = null;
      actionsTreeProvider.setReplConnected(false);
      connectionStatusTreeProvider.setPort(null);
      outputInfo(channel, "星瀚: REPL已断开，串口已释放。");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("xinghan.toggleRepl", async () => {
      if (replTerminal) {
        await vscode.commands.executeCommand("xinghan.disconnectRepl");
      } else {
        await vscode.commands.executeCommand("xinghan.selectPortAndRepl");
      }
    })
  );

  context.subscriptions.push({
    dispose: () => {
      if (replTerminal) {
        replTerminal.dispose();
        replTerminal = null;
        replPort = null;
      }
      if (runOnDeviceProcess) {
        void stopRunOnDeviceProcess(runOnDeviceProcess);
        runOnDeviceProcess = null;
      }
    },
  });
}

export function deactivate() {}
