import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { spawn, ChildProcess } from "child_process";
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

const CONTAINERS = ["container1", "container2", "container3", "container4", "container5"];

const REQUIRED_PACKAGES = ["pyserial", "mpremote"];

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
    vscode.window.showInformationMessage("星瀚: Python 依赖安装成功");
  } else {
    vscode.window.showErrorMessage(
      `星瀚: 依赖安装失败，请手动运行: ${pythonPath} -m pip install ${missing.join(" ")}`
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
  };
}

/**
 * 解析上传/运行要使用的本地文件路径：Explorer 右键会传入 Uri；编辑器无参则用当前活动编辑器。
 * 多选时仅作用于右键目标文件（首参 Uri）。
 */
function resolveLocalFilePathForDevice(firstArg?: unknown, selectedResources?: unknown): string | null {
  const multi =
    Array.isArray(selectedResources) &&
    selectedResources.length > 1 &&
    selectedResources.every((u) => u instanceof vscode.Uri);

  if (firstArg instanceof vscode.Uri && firstArg.scheme === "file") {
    if (multi) {
      vscode.window.showInformationMessage("星瀚: 已选择多个文件，仅对右键目标文件执行。");
    }
    try {
      const stat = fs.statSync(firstArg.fsPath);
      if (stat.isDirectory()) {
        vscode.window.showWarningMessage("星瀚: 请选择文件，不能对文件夹执行。");
        return null;
      }
    } catch {
      vscode.window.showWarningMessage("星瀚: 无法访问该路径。");
      return null;
    }
    return firstArg.fsPath;
  }

  const editor = vscode.window.activeTextEditor;
  const docUri = editor?.document.uri;
  if (!docUri || docUri.scheme !== "file") {
    vscode.window.showWarningMessage("请先打开要操作的本地文件。");
    return null;
  }
  return docUri.fsPath;
}

/** 获取上传脚本的绝对路径：优先使用插件内嵌脚本 */
function resolveScriptPath(extensionPath: string): string {
  return path.join(extensionPath, "scripts", "wired_uploader.py");
}

/** 执行 Python 脚本，输出到 Output 通道并在终端中显示（可选） */
function runPythonScript(
  pythonPath: string,
  scriptPath: string,
  args: string[],
  channel: vscode.OutputChannel,
  cwd?: string
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

    proc.stdout?.on("data", (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      channel.append(text);
    });
    proc.stderr?.on("data", (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      channel.append(text);
    });

    proc.on("close", (code, signal) => {
      if (code !== undefined) {
        channel.appendLine("");
        channel.appendLine(`[退出码 ${code}]`);
      }
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });

    proc.on("error", (err) => {
      channel.appendLine(`❌ 启动失败: ${err.message}`);
      resolve({ exitCode: -1, stdout, stderr: err.message });
    });
  });
}

/** 终止「在设备上运行」的进程（含子进程，释放串口） */
function stopRunOnDeviceProcess(proc: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (!proc.pid) {
      resolve();
      return;
    }
    treeKill(proc.pid, "SIGTERM", (err?: Error) => {
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

function createCommandStatusBarItem(
  context: vscode.ExtensionContext,
  text: string,
  command: string,
  tooltip: string,
  priority: number
) {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, priority);
  item.text = text;
  item.command = command;
  item.tooltip = tooltip;
  item.show();
  context.subscriptions.push(item);
}

export function activate(context: vscode.ExtensionContext) {
  const channel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  /** 当前「在设备上运行」的进程，用于停止或上传前释放串口 */
  let runOnDeviceProcess: ChildProcess | null = null;
  /** 当前 REPL 终端与端口，用于「连接状态」展示与「断开 REPL」 */
  let replTerminal: vscode.Terminal | null = null;
  let replPort: string | null = null;

  createCommandStatusBarItem(context, "▶️ 星瀚运行", "xinghan.runOnDevice", "在星瀚控制器上运行当前文件", 103);
  createCommandStatusBarItem(context, "⏹️ 星瀚停止", "xinghan.stopRunOnDevice", "停止星瀚控制器上正在运行的程序", 102);
  createCommandStatusBarItem(context, "📤 星瀚上传", "xinghan.upload", "上传当前文件到星瀚控制器", 101);

  // 列出指定端口、容器中的文件（供侧边栏树使用）
  async function listDeviceFilesForTree(port: string, container: string): Promise<DeviceFileInfo[]> {
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
  const readDeviceFileContent: ReadDeviceFile = (port: string, container: string, filename: string): Promise<Uint8Array> => {
    return new Promise((resolve, reject) => {
      const config = getConfig();
      const scriptPath = resolveScriptPath(context.extensionPath);
      const args = ["--read-file", filename, "--container", container, "--port", port];
      const proc = spawn(config.pythonPath, [scriptPath, ...args], {
        cwd: path.dirname(scriptPath),
        shell: false,
      });
      const chunks: Buffer[] = [];
      proc.stdout?.on("data", (d: Buffer) => chunks.push(d));
      proc.stderr?.on("data", () => {});
      proc.on("close", (code) => {
        if (code === 0) resolve(Buffer.concat(chunks));
        else reject(new Error(`read-file exited with ${code}`));
      });
      proc.on("error", reject);
    });
  };

  // 将内容写入设备文件（供虚拟文件系统保存用）
  const writeDeviceFileContent: WriteDeviceFile = (port: string, container: string, filename: string, content: Uint8Array): Promise<void> => {
    return new Promise((resolve, reject) => {
      const config = getConfig();
      const scriptPath = resolveScriptPath(context.extensionPath);
      const args = ["--write-file", filename, "--container", container, "--port", port];
      const proc = spawn(config.pythonPath, [scriptPath, ...args], {
        cwd: path.dirname(scriptPath),
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const stdin = proc.stdin;
      if (!stdin) {
        reject(new Error("No stdin"));
        return;
      }
      stdin.write(content, (err) => {
        if (err) reject(err);
        else stdin.end();
      });
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`write-file exited with ${code}`));
      });
      proc.on("error", reject);
    });
  };

  // 虚拟文件系统：设备文件可在 IDE 中打开并保存回设备
  const deviceFsProvider = new XinghanDeviceFileSystemProvider(readDeviceFileContent, writeDeviceFileContent);
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider("xinghan-device", deviceFsProvider, { isCaseSensitive: true })
  );

  // 列出星瀚控制器可用端口（含短展示名与 USB 序列号，供「连接状态」「星瀚控制器」与选择端口使用）
  type PortInfo = { device: string; display?: string; serial_number?: string | null };
  async function listXinghanPorts(): Promise<PortInfo[]> {
    const config = getConfig();
    const scriptPath = resolveScriptPath(context.extensionPath);
    const portsJson = await new Promise<string>((resolve, reject) => {
      const proc = spawn(config.pythonPath, [scriptPath, "--list-ports-xinghan-with-mac"], {
        cwd: path.dirname(scriptPath),
        shell: false,
      });
      const chunks: string[] = [];
      proc.stdout?.on("data", (d: Buffer) => chunks.push(d.toString()));
      proc.stderr?.on("data", () => {});
      proc.on("close", (code) => {
        if (code === 0) resolve(chunks.join(""));
        else reject(new Error(`list-ports-xinghan-with-mac exited with ${code}`));
      });
      proc.on("error", reject);
    }).catch(() => "");
    try {
      const raw = portsJson.trim();
      return raw ? (JSON.parse(raw) as PortInfo[]) : [];
    } catch {
      return [];
    }
  }

  /** 展示用：串口信息|序列号；无序列号时只显示串口信息 */
  function formatPortLabel(p: PortInfo): string {
    const portPart = p.display ?? p.device;
    return p.serial_number ? `${portPart} | ${p.serial_number}` : portPart;
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

  // 连接状态 / 星瀚控制器 的「刷新」按钮：任按其一都会同时刷新两栏
  context.subscriptions.push(
    vscode.commands.registerCommand("xinghan.refreshConnectionStatus", () => {
      connectionStatusTreeProvider.refresh();
      deviceFilesTreeProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("xinghan.refreshDeviceFiles", () => {
      connectionStatusTreeProvider.refresh();
      deviceFilesTreeProvider.refresh();
    })
  );

  // 连接状态栏：右键「复制串口」——复制完整设备路径到剪贴板
  context.subscriptions.push(
    vscode.commands.registerCommand("xinghan.copyConnectionPort", async (node: ConnectionStatusNode) => {
      const path = node?.portPath;
      if (!path) {
        return;
      }
      await vscode.env.clipboard.writeText(path);
      vscode.window.showInformationMessage(`已复制串口：${path}`);
    })
  );

  // REPL 终端被用户关闭时清除连接状态
  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((closed) => {
      if (replTerminal && closed === replTerminal) {
        replTerminal = null;
        replPort = null;
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

  // 上传当前文件到星瀚（上传前会先停止正在运行的「在设备上运行」以释放串口）
  context.subscriptions.push(
    vscode.commands.registerCommand("xinghan.upload", async (firstArg?: unknown, selectedResources?: unknown) => {
      const filePath = resolveLocalFilePathForDevice(firstArg, selectedResources);
      if (!filePath) {
        return;
      }

      const config = getConfig();
      const scriptPath = resolveScriptPath(context.extensionPath);

      // 检查依赖
      if (!(await ensureDependencies(config.pythonPath, channel))) {
        return;
      }

      const port = await resolvePortForUploadOrRun();
      if (port === null) {
        vscode.window.showWarningMessage("未找到星瀚控制器或已取消选择端口。请连接设备后重试。");
        return;
      }

      const container = await vscode.window.showQuickPick(
        CONTAINERS.map((c) => ({ label: c, container: c })),
        { title: "选择要上传到的容器", placeHolder: "container1 ~ container5" }
      );
      if (!container) {
        return;
      }

      channel.show(true);
      channel.clear();

      // 若有正在「在设备上运行」的进程，先停止以释放串口，再上传
      if (runOnDeviceProcess) {
        channel.appendLine("正在停止设备上的运行以释放串口…");
        await stopRunOnDeviceProcess(runOnDeviceProcess);
        runOnDeviceProcess = null;
        await new Promise((r) => setTimeout(r, 500));
      }

      const args = [filePath, "--container", container.container, "--port", port];

      const { exitCode } = await runPythonScript(config.pythonPath, scriptPath, args, channel);

      if (exitCode === 0) {
        vscode.window.showInformationMessage(`星瀚: 已上传到 ${container.container}`);
        deviceFilesTreeProvider.refresh();
      } else {
        vscode.window.showErrorMessage("星瀚: 上传失败，请查看输出。");
      }
    })
  );

  // 在控制器上直接运行当前文件（不写入设备，实时输出）；再次执行会先停止当前运行再运行新脚本
  context.subscriptions.push(
    vscode.commands.registerCommand("xinghan.runOnDevice", async (firstArg?: unknown, selectedResources?: unknown) => {
      const filePath = resolveLocalFilePathForDevice(firstArg, selectedResources);
      if (!filePath) {
        return;
      }

      const config = getConfig();

      // 检查依赖
      if (!(await ensureDependencies(config.pythonPath, channel))) {
        return;
      }

      const port = await resolvePortForUploadOrRun();
      if (port === null) {
        vscode.window.showWarningMessage("未找到星瀚控制器或已取消选择端口。请连接设备后重试。");
        return;
      }

      if (runOnDeviceProcess) {
        channel.show(true);
        channel.appendLine("[重新运行] 正在停止当前运行…");
        await stopRunOnDeviceProcess(runOnDeviceProcess);
        runOnDeviceProcess = null;
        await new Promise((r) => setTimeout(r, 500));
      }

      const scriptPath = resolveScriptPath(context.extensionPath);

      channel.show(true);
      channel.clear();

      const args = [filePath, "--run", "--port", port];

      const fullCmd = [config.pythonPath, scriptPath, ...args].join(" ");
      channel.appendLine(`> ${fullCmd}`);
      channel.appendLine("");

      const proc = spawn(config.pythonPath, [scriptPath, ...args], {
        cwd: path.dirname(scriptPath),
        shell: false,
      });
      runOnDeviceProcess = proc;

      proc.stdout?.on("data", (data: Buffer) => channel.append(data.toString()));
      proc.stderr?.on("data", (data: Buffer) => channel.append(data.toString()));

      proc.on("close", (code, signal) => {
        runOnDeviceProcess = null;
        channel.appendLine("");
        channel.appendLine(`[退出码 ${code ?? "—"}${signal ? `，信号 ${signal}` : ""}]`);
        if (code === 0) {
          vscode.window.showInformationMessage("星瀚: 运行结束");
        } else if (code !== null && code !== undefined && code !== 0) {
          vscode.window.showErrorMessage("星瀚: 运行失败或已中断，请查看输出。");
        }
      });

      proc.on("error", (err) => {
        runOnDeviceProcess = null;
        channel.appendLine(`❌ 启动失败: ${err.message}`);
        vscode.window.showErrorMessage(`星瀚: 启动失败 — ${err.message}`);
      });
    })
  );

  // 停止当前在设备上运行的程序：先结束本机进程释放串口，再向设备发送软复位
  context.subscriptions.push(
    vscode.commands.registerCommand("xinghan.stopRunOnDevice", async () => {
      if (!runOnDeviceProcess) {
        vscode.window.showInformationMessage("当前没有在设备上运行的程序。");
        return;
      }
      channel.appendLine("\n[用户请求停止] 正在终止本机进程并释放串口…");
      await stopRunOnDeviceProcess(runOnDeviceProcess);
      runOnDeviceProcess = null;
      await new Promise((r) => setTimeout(r, 500));

      const config = getConfig();
      const scriptPath = resolveScriptPath(context.extensionPath);
      const args = ["--soft-reset"];
      if (config.serialPort) args.push("--port", config.serialPort);
      channel.appendLine("正在向设备发送软复位…");
      const proc = spawn(config.pythonPath, [scriptPath, ...args], {
        cwd: path.dirname(scriptPath),
        shell: false,
      });
      await new Promise<void>((resolve) => proc.on("close", () => resolve()));
      vscode.window.showInformationMessage("星瀚: 已停止设备上的运行");
    })
  );

  // 删除控制器上的文件
  context.subscriptions.push(
    vscode.commands.registerCommand("xinghan.deleteFile", async () => {
      const config = getConfig();
      const scriptPath = resolveScriptPath(context.extensionPath);

      // 检查依赖
      if (!(await ensureDependencies(config.pythonPath, channel))) {
        return;
      }

      // 若有正在运行的进程，先停止以释放串口
      if (runOnDeviceProcess) {
        channel.show(true);
        channel.appendLine("正在停止设备上的运行以释放串口…");
        await stopRunOnDeviceProcess(runOnDeviceProcess);
        runOnDeviceProcess = null;
        await new Promise((r) => setTimeout(r, 500));
      }

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
        vscode.window.showErrorMessage("星瀚: 列出文件失败，请查看输出。");
        return;
      }

      let files: Array<{ name: string; size: string }>;
      try {
        files = JSON.parse(listStdout.trim());
      } catch {
        channel.appendLine("解析文件列表失败。");
        vscode.window.showErrorMessage("星瀚: 解析文件列表失败。");
        return;
      }

      if (files.length === 0) {
        vscode.window.showInformationMessage(`${container.container} 中没有文件。`);
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
        vscode.window.showInformationMessage(`星瀚: 已删除 ${container.container}/${fileToDelete.filename}`);
        deviceFilesTreeProvider.refresh();
      } else {
        vscode.window.showErrorMessage("星瀚: 删除失败，请查看输出。");
      }
    })
  );

  // 从侧边栏树中删除设备上的文件（右键菜单）
  context.subscriptions.push(
    vscode.commands.registerCommand("xinghan.deleteFileFromTree", async (element: { kind: string; port?: string; container?: string; name?: string }) => {
      if (!element || element.kind !== "deviceFile" || !element.port || !element.container || !element.name) return;
      const config = getConfig();
      const scriptPath = resolveScriptPath(context.extensionPath);
      if (!(await ensureDependencies(config.pythonPath, channel))) return;
      if (runOnDeviceProcess) {
        channel.show(true);
        channel.appendLine("正在停止设备上的运行以释放串口…");
        await stopRunOnDeviceProcess(runOnDeviceProcess);
        runOnDeviceProcess = null;
        await new Promise((r) => setTimeout(r, 500));
      }
      const confirm = await vscode.window.showWarningMessage(
        `确定要删除 ${element.container}/${element.name} 吗？`,
        { modal: true },
        "删除"
      );
      if (confirm !== "删除") return;
      channel.show(true);
      channel.appendLine(`正在删除 ${element.name}...`);
      const deleteArgs = ["--delete", element.name, "--container", element.container, "--port", element.port];
      const { exitCode } = await runPythonScript(config.pythonPath, scriptPath, deleteArgs, channel);
      if (exitCode === 0) {
        vscode.window.showInformationMessage(`星瀚: 已删除 ${element.container}/${element.name}`);
        deviceFilesTreeProvider.refresh();
      } else {
        vscode.window.showErrorMessage("星瀚: 删除失败，请查看输出。");
      }
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
      if (!element || element.kind !== "deviceFile" || !element.port || !element.container || !element.name) return;
      const config = getConfig();
      const scriptPath = resolveScriptPath(context.extensionPath);
      if (!(await ensureDependencies(config.pythonPath, channel))) return;

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
        vscode.window.showErrorMessage(`星瀚: ${nameErr}`);
        return;
      }
      if (newName === element.name) {
        vscode.window.showInformationMessage("名称未变化。");
        return;
      }

      if (runOnDeviceProcess) {
        channel.show(true);
        channel.appendLine("正在停止设备上的运行以释放串口…");
        await stopRunOnDeviceProcess(runOnDeviceProcess);
        runOnDeviceProcess = null;
        await new Promise((r) => setTimeout(r, 500));
      }

      channel.show(true);
      channel.appendLine(`正在重命名 ${element.name} → ${newName}...`);
      const renameArgs = ["--rename", element.name, newName, "--container", element.container, "--port", element.port];
      const { exitCode } = await runPythonScript(config.pythonPath, scriptPath, renameArgs, channel);
      if (exitCode === 0) {
        vscode.window.showInformationMessage(`星瀚: 已重命名为 ${element.container}/${newName}`);
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
        vscode.window.showErrorMessage("星瀚: 重命名失败，请查看输出。");
      }
    })
  );

  // 连接 WiFi
  context.subscriptions.push(
    vscode.commands.registerCommand("xinghan.connectWifi", async () => {
      const config = getConfig();
      const scriptPath = resolveScriptPath(context.extensionPath);

      // 检查依赖
      if (!(await ensureDependencies(config.pythonPath, channel))) {
        return;
      }

      // 若有正在运行的进程，先停止以释放串口
      if (runOnDeviceProcess) {
        channel.show(true);
        channel.appendLine("正在停止设备上的运行以释放串口…");
        await stopRunOnDeviceProcess(runOnDeviceProcess);
        runOnDeviceProcess = null;
        await new Promise((r) => setTimeout(r, 500));
      }

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
          vscode.window.showErrorMessage("格式错误，请输入：WiFi名称 密码（用空格分隔）");
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
        vscode.window.showInformationMessage(`星瀚: 已发送 WiFi 连接命令 (${ssid})`);
      } else {
        vscode.window.showErrorMessage("星瀚: WiFi 连接失败，请查看输出。");
      }
    })
  );

  // 连接 REPL：选择端口并进入 REPL（仅显示星瀚控制器端口：/dev/cu.usbmodem*）
  context.subscriptions.push(
    vscode.commands.registerCommand("xinghan.selectPortAndRepl", async () => {
      const config = getConfig();

      if (!(await ensureDependencies(config.pythonPath, channel))) {
        return;
      }

      const ports = await listXinghanPorts();
      if (ports.length === 0) {
        vscode.window.showWarningMessage("未找到星瀚控制器。请连接设备（/dev/cu.usbmodem*）后重试。");
        return;
      }

      const chosen = await vscode.window.showQuickPick(
        ports.map((p) => ({ label: formatPortLabel(p), description: p.device, device: p.device })),
        { title: "选择星瀚控制器端口并进入 REPL", matchOnDescription: true }
      );
      if (!chosen) return;

      const term = vscode.window.createTerminal({
        name: "星瀚 REPL",
        shellPath: config.pythonPath,
        shellArgs: ["-m", "mpremote", "connect", chosen.device],
      });
      term.show();
      replTerminal = term;
      replPort = chosen.device;
      connectionStatusTreeProvider.setPort(chosen.device);
    })
  );

  // 断开 REPL：关闭 REPL 终端并释放串口
  context.subscriptions.push(
    vscode.commands.registerCommand("xinghan.disconnectRepl", () => {
      if (!replTerminal) {
        vscode.window.showInformationMessage("星瀚: 当前没有通过插件打开的 REPL，无需断开。");
        return;
      }
      replTerminal.dispose();
      replTerminal = null;
      replPort = null;
      connectionStatusTreeProvider.setPort(null);
      vscode.window.showInformationMessage("星瀚: 已断开 REPL，串口已释放。");
    })
  );
}

export function deactivate() {}
