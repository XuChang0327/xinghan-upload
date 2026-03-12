import * as vscode from "vscode";
import * as path from "path";
import { spawn, ChildProcess } from "child_process";
import treeKill = require("tree-kill");

const OUTPUT_CHANNEL_NAME = "星瀚上传";

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

export function activate(context: vscode.ExtensionContext) {
  const channel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  /** 当前「在设备上运行」的进程，用于停止或上传前释放串口 */
  let runOnDeviceProcess: ChildProcess | null = null;

  // 状态栏按钮：运行（左）- priority 越大越靠左
  const runStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 10002);
  runStatusBarItem.text = "$(play) 星瀚运行";
  runStatusBarItem.tooltip = "星瀚: 在控制器上运行当前文件";
  runStatusBarItem.command = "xinghan.runOnDevice";
  runStatusBarItem.show();
  context.subscriptions.push(runStatusBarItem);

  // 状态栏按钮：停止（中）
  const stopStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 10001);
  stopStatusBarItem.text = "$(debug-stop) 星瀚停止";
  stopStatusBarItem.tooltip = "星瀚: 停止设备上的运行";
  stopStatusBarItem.command = "xinghan.stopRunOnDevice";
  stopStatusBarItem.show();
  context.subscriptions.push(stopStatusBarItem);

  // 状态栏按钮：上传（右）
  const uploadStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 10000);
  uploadStatusBarItem.text = "$(cloud-upload) 星瀚上传";
  uploadStatusBarItem.tooltip = "星瀚: 上传当前文件到控制器";
  uploadStatusBarItem.command = "xinghan.upload";
  uploadStatusBarItem.show();
  context.subscriptions.push(uploadStatusBarItem);

  // 上传当前文件到星瀚（上传前会先停止正在运行的「在设备上运行」以释放串口）
  context.subscriptions.push(
    vscode.commands.registerCommand("xinghan.upload", async () => {
      const editor = vscode.window.activeTextEditor;
      const filePath = editor?.document.uri.fsPath;
      if (!filePath) {
        vscode.window.showWarningMessage("请先打开要上传的文件。");
        return;
      }

      const config = getConfig();
      const scriptPath = resolveScriptPath(context.extensionPath);

      // 检查依赖
      if (!(await ensureDependencies(config.pythonPath, channel))) {
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

      const args = [filePath, "--container", container.container];
      if (config.serialPort) {
        args.push("--port", config.serialPort);
      }

      const { exitCode } = await runPythonScript(config.pythonPath, scriptPath, args, channel);

      if (exitCode === 0) {
        vscode.window.showInformationMessage(`星瀚: 已上传到 ${container.container}`);
      } else {
        vscode.window.showErrorMessage("星瀚: 上传失败，请查看输出。");
      }
    })
  );

  // 在控制器上直接运行当前文件（不写入设备，实时输出）；再次执行会先停止当前运行再运行新脚本
  context.subscriptions.push(
    vscode.commands.registerCommand("xinghan.runOnDevice", async () => {
      const config = getConfig();

      // 检查依赖
      if (!(await ensureDependencies(config.pythonPath, channel))) {
        return;
      }

      if (runOnDeviceProcess) {
        channel.show(true);
        channel.appendLine("[重新运行] 正在停止当前运行…");
        await stopRunOnDeviceProcess(runOnDeviceProcess);
        runOnDeviceProcess = null;
        await new Promise((r) => setTimeout(r, 500));
      }

      const editor = vscode.window.activeTextEditor;
      const filePath = editor?.document.uri.fsPath;
      if (!filePath) {
        vscode.window.showWarningMessage("请先打开要运行的文件。");
        return;
      }

      const scriptPath = resolveScriptPath(context.extensionPath);

      channel.show(true);
      channel.clear();

      const args = [filePath, "--run"];
      if (config.serialPort) {
        args.push("--port", config.serialPort);
      }

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

  // 停止当前在设备上运行的程序（释放串口，便于随后上传）
  context.subscriptions.push(
    vscode.commands.registerCommand("xinghan.stopRunOnDevice", async () => {
      if (!runOnDeviceProcess) {
        vscode.window.showInformationMessage("当前没有在设备上运行的程序。");
        return;
      }
      channel.appendLine("\n[用户请求停止] 正在终止设备上的运行…");
      await stopRunOnDeviceProcess(runOnDeviceProcess);
      runOnDeviceProcess = null;
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
      } else {
        vscode.window.showErrorMessage("星瀚: 删除失败，请查看输出。");
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

  // 列出可用串口（供排查或配置用）
  context.subscriptions.push(
    vscode.commands.registerCommand("xinghan.listPorts", async () => {
      const config = getConfig();
      const scriptPath = resolveScriptPath(context.extensionPath);

      // 检查依赖
      if (!(await ensureDependencies(config.pythonPath, channel))) {
        return;
      }

      channel.show(true);
      channel.clear();
      channel.appendLine("正在列出串口...");

      const { exitCode, stdout } = await runPythonScript(
        config.pythonPath,
        scriptPath,
        ["--list-ports"],
        channel
      );

      if (exitCode === 0) {
        try {
          const ports = JSON.parse(stdout.trim()) as Array<{ device: string; description: string }>;
          if (ports.length === 0) {
            vscode.window.showInformationMessage("未检测到串口设备。");
            return;
          }
          const chosen = await vscode.window.showQuickPick(
            ports.map((p) => ({ label: p.device, description: p.description, device: p.device })),
            { title: "选择串口（可复制到设置 xinghan.serialPort）", matchOnDescription: true }
          );
          if (chosen) {
            await vscode.env.clipboard.writeText(chosen.device);
            vscode.window.showInformationMessage(`已复制到剪贴板: ${chosen.device}`);
          }
        } catch {
          channel.appendLine("解析串口列表失败，原始输出见上。");
        }
      }
    })
  );
}

export function deactivate() {}
