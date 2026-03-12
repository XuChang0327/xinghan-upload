"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// node_modules/tree-kill/index.js
var require_tree_kill = __commonJS({
  "node_modules/tree-kill/index.js"(exports2, module2) {
    "use strict";
    var childProcess = require("child_process");
    var spawn2 = childProcess.spawn;
    var exec = childProcess.exec;
    module2.exports = function(pid, signal, callback) {
      if (typeof signal === "function" && callback === void 0) {
        callback = signal;
        signal = void 0;
      }
      pid = parseInt(pid);
      if (Number.isNaN(pid)) {
        if (callback) {
          return callback(new Error("pid must be a number"));
        } else {
          throw new Error("pid must be a number");
        }
      }
      var tree = {};
      var pidsToProcess = {};
      tree[pid] = [];
      pidsToProcess[pid] = 1;
      switch (process.platform) {
        case "win32":
          exec("taskkill /pid " + pid + " /T /F", callback);
          break;
        case "darwin":
          buildProcessTree(pid, tree, pidsToProcess, function(parentPid) {
            return spawn2("pgrep", ["-P", parentPid]);
          }, function() {
            killAll(tree, signal, callback);
          });
          break;
        // case 'sunos':
        //     buildProcessTreeSunOS(pid, tree, pidsToProcess, function () {
        //         killAll(tree, signal, callback);
        //     });
        //     break;
        default:
          buildProcessTree(pid, tree, pidsToProcess, function(parentPid) {
            return spawn2("ps", ["-o", "pid", "--no-headers", "--ppid", parentPid]);
          }, function() {
            killAll(tree, signal, callback);
          });
          break;
      }
    };
    function killAll(tree, signal, callback) {
      var killed = {};
      try {
        Object.keys(tree).forEach(function(pid) {
          tree[pid].forEach(function(pidpid) {
            if (!killed[pidpid]) {
              killPid(pidpid, signal);
              killed[pidpid] = 1;
            }
          });
          if (!killed[pid]) {
            killPid(pid, signal);
            killed[pid] = 1;
          }
        });
      } catch (err) {
        if (callback) {
          return callback(err);
        } else {
          throw err;
        }
      }
      if (callback) {
        return callback();
      }
    }
    function killPid(pid, signal) {
      try {
        process.kill(parseInt(pid, 10), signal);
      } catch (err) {
        if (err.code !== "ESRCH") throw err;
      }
    }
    function buildProcessTree(parentPid, tree, pidsToProcess, spawnChildProcessesList, cb) {
      var ps = spawnChildProcessesList(parentPid);
      var allData = "";
      ps.stdout.on("data", function(data) {
        var data = data.toString("ascii");
        allData += data;
      });
      var onClose = function(code) {
        delete pidsToProcess[parentPid];
        if (code != 0) {
          if (Object.keys(pidsToProcess).length == 0) {
            cb();
          }
          return;
        }
        allData.match(/\d+/g).forEach(function(pid) {
          pid = parseInt(pid, 10);
          tree[parentPid].push(pid);
          tree[pid] = [];
          pidsToProcess[pid] = 1;
          buildProcessTree(pid, tree, pidsToProcess, spawnChildProcessesList, cb);
        });
      };
      ps.on("close", onClose);
    }
  }
});

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode = __toESM(require("vscode"));
var path = __toESM(require("path"));
var import_child_process = require("child_process");
var treeKill = require_tree_kill();
var OUTPUT_CHANNEL_NAME = "\u661F\u701A\u4E0A\u4F20";
var CONTAINERS = ["container1", "container2", "container3", "container4", "container5"];
var REQUIRED_PACKAGES = ["pyserial", "mpremote"];
async function checkDependencies(pythonPath) {
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
    const proc = (0, import_child_process.spawn)(pythonPath, ["-c", checkCode], { shell: false });
    let stdout = "";
    proc.stdout?.on("data", (data) => {
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
async function installDependencies(pythonPath, packages, channel) {
  return new Promise((resolve) => {
    const args = ["-m", "pip", "install", ...packages];
    channel.appendLine(`> ${pythonPath} ${args.join(" ")}`);
    channel.appendLine("");
    const proc = (0, import_child_process.spawn)(pythonPath, args, { shell: false });
    proc.stdout?.on("data", (data) => {
      channel.append(data.toString());
    });
    proc.stderr?.on("data", (data) => {
      channel.append(data.toString());
    });
    proc.on("close", (code) => {
      channel.appendLine("");
      if (code === 0) {
        channel.appendLine("\u2705 \u4F9D\u8D56\u5B89\u88C5\u6210\u529F");
        resolve(true);
      } else {
        channel.appendLine("\u274C \u4F9D\u8D56\u5B89\u88C5\u5931\u8D25");
        resolve(false);
      }
    });
    proc.on("error", (err) => {
      channel.appendLine(`\u274C \u5B89\u88C5\u5931\u8D25: ${err.message}`);
      resolve(false);
    });
  });
}
async function ensureDependencies(pythonPath, channel) {
  const { missing } = await checkDependencies(pythonPath);
  if (missing.length === 0) {
    return true;
  }
  const choice = await vscode.window.showWarningMessage(
    `\u661F\u701A\u63D2\u4EF6\u9700\u8981\u5B89\u88C5 Python \u4F9D\u8D56: ${missing.join(", ")}`,
    "\u81EA\u52A8\u5B89\u88C5",
    "\u53D6\u6D88"
  );
  if (choice !== "\u81EA\u52A8\u5B89\u88C5") {
    return false;
  }
  channel.show(true);
  channel.clear();
  channel.appendLine("\u6B63\u5728\u5B89\u88C5 Python \u4F9D\u8D56...\n");
  const success = await installDependencies(pythonPath, missing, channel);
  if (success) {
    vscode.window.showInformationMessage("\u661F\u701A: Python \u4F9D\u8D56\u5B89\u88C5\u6210\u529F");
  } else {
    vscode.window.showErrorMessage(
      `\u661F\u701A: \u4F9D\u8D56\u5B89\u88C5\u5931\u8D25\uFF0C\u8BF7\u624B\u52A8\u8FD0\u884C: ${pythonPath} -m pip install ${missing.join(" ")}`
    );
  }
  return success;
}
function getConfig() {
  return {
    pythonPath: vscode.workspace.getConfiguration("xinghan").get("pythonPath") ?? "python3",
    serialPort: vscode.workspace.getConfiguration("xinghan").get("serialPort"),
    wifiPresets: vscode.workspace.getConfiguration("xinghan").get("wifiPresets") ?? []
  };
}
function resolveScriptPath(extensionPath) {
  return path.join(extensionPath, "scripts", "wired_uploader.py");
}
function runPythonScript(pythonPath, scriptPath, args, channel, cwd) {
  return new Promise((resolve) => {
    const fullCmd = [pythonPath, scriptPath, ...args].join(" ");
    channel.appendLine(`> ${fullCmd}`);
    channel.appendLine("");
    const proc = (0, import_child_process.spawn)(pythonPath, [scriptPath, ...args], {
      cwd: cwd || path.dirname(scriptPath),
      shell: false
    });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (data) => {
      const text = data.toString();
      stdout += text;
      channel.append(text);
    });
    proc.stderr?.on("data", (data) => {
      const text = data.toString();
      stderr += text;
      channel.append(text);
    });
    proc.on("close", (code, signal) => {
      if (code !== void 0) {
        channel.appendLine("");
        channel.appendLine(`[\u9000\u51FA\u7801 ${code}]`);
      }
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
    proc.on("error", (err) => {
      channel.appendLine(`\u274C \u542F\u52A8\u5931\u8D25: ${err.message}`);
      resolve({ exitCode: -1, stdout, stderr: err.message });
    });
  });
}
function stopRunOnDeviceProcess(proc) {
  return new Promise((resolve) => {
    if (!proc.pid) {
      resolve();
      return;
    }
    treeKill(proc.pid, "SIGTERM", (err) => {
      if (err) {
        try {
          proc.kill("SIGKILL");
        } catch {
        }
      }
      resolve();
    });
  });
}
function activate(context) {
  const channel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  let runOnDeviceProcess = null;
  const runStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 10002);
  runStatusBarItem.text = "$(play) \u661F\u701A\u8FD0\u884C";
  runStatusBarItem.tooltip = "\u661F\u701A: \u5728\u63A7\u5236\u5668\u4E0A\u8FD0\u884C\u5F53\u524D\u6587\u4EF6";
  runStatusBarItem.command = "xinghan.runOnDevice";
  runStatusBarItem.show();
  context.subscriptions.push(runStatusBarItem);
  const stopStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 10001);
  stopStatusBarItem.text = "$(debug-stop) \u661F\u701A\u505C\u6B62";
  stopStatusBarItem.tooltip = "\u661F\u701A: \u505C\u6B62\u8BBE\u5907\u4E0A\u7684\u8FD0\u884C";
  stopStatusBarItem.command = "xinghan.stopRunOnDevice";
  stopStatusBarItem.show();
  context.subscriptions.push(stopStatusBarItem);
  const uploadStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1e4);
  uploadStatusBarItem.text = "$(cloud-upload) \u661F\u701A\u4E0A\u4F20";
  uploadStatusBarItem.tooltip = "\u661F\u701A: \u4E0A\u4F20\u5F53\u524D\u6587\u4EF6\u5230\u63A7\u5236\u5668";
  uploadStatusBarItem.command = "xinghan.upload";
  uploadStatusBarItem.show();
  context.subscriptions.push(uploadStatusBarItem);
  context.subscriptions.push(
    vscode.commands.registerCommand("xinghan.upload", async () => {
      const editor = vscode.window.activeTextEditor;
      const filePath = editor?.document.uri.fsPath;
      if (!filePath) {
        vscode.window.showWarningMessage("\u8BF7\u5148\u6253\u5F00\u8981\u4E0A\u4F20\u7684\u6587\u4EF6\u3002");
        return;
      }
      const config = getConfig();
      const scriptPath = resolveScriptPath(context.extensionPath);
      if (!await ensureDependencies(config.pythonPath, channel)) {
        return;
      }
      const container = await vscode.window.showQuickPick(
        CONTAINERS.map((c) => ({ label: c, container: c })),
        { title: "\u9009\u62E9\u8981\u4E0A\u4F20\u5230\u7684\u5BB9\u5668", placeHolder: "container1 ~ container5" }
      );
      if (!container) {
        return;
      }
      channel.show(true);
      channel.clear();
      if (runOnDeviceProcess) {
        channel.appendLine("\u6B63\u5728\u505C\u6B62\u8BBE\u5907\u4E0A\u7684\u8FD0\u884C\u4EE5\u91CA\u653E\u4E32\u53E3\u2026");
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
        vscode.window.showInformationMessage(`\u661F\u701A: \u5DF2\u4E0A\u4F20\u5230 ${container.container}`);
      } else {
        vscode.window.showErrorMessage("\u661F\u701A: \u4E0A\u4F20\u5931\u8D25\uFF0C\u8BF7\u67E5\u770B\u8F93\u51FA\u3002");
      }
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("xinghan.runOnDevice", async () => {
      const config = getConfig();
      if (!await ensureDependencies(config.pythonPath, channel)) {
        return;
      }
      if (runOnDeviceProcess) {
        channel.show(true);
        channel.appendLine("[\u91CD\u65B0\u8FD0\u884C] \u6B63\u5728\u505C\u6B62\u5F53\u524D\u8FD0\u884C\u2026");
        await stopRunOnDeviceProcess(runOnDeviceProcess);
        runOnDeviceProcess = null;
        await new Promise((r) => setTimeout(r, 500));
      }
      const editor = vscode.window.activeTextEditor;
      const filePath = editor?.document.uri.fsPath;
      if (!filePath) {
        vscode.window.showWarningMessage("\u8BF7\u5148\u6253\u5F00\u8981\u8FD0\u884C\u7684\u6587\u4EF6\u3002");
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
      const proc = (0, import_child_process.spawn)(config.pythonPath, [scriptPath, ...args], {
        cwd: path.dirname(scriptPath),
        shell: false
      });
      runOnDeviceProcess = proc;
      proc.stdout?.on("data", (data) => channel.append(data.toString()));
      proc.stderr?.on("data", (data) => channel.append(data.toString()));
      proc.on("close", (code, signal) => {
        runOnDeviceProcess = null;
        channel.appendLine("");
        channel.appendLine(`[\u9000\u51FA\u7801 ${code ?? "\u2014"}${signal ? `\uFF0C\u4FE1\u53F7 ${signal}` : ""}]`);
        if (code === 0) {
          vscode.window.showInformationMessage("\u661F\u701A: \u8FD0\u884C\u7ED3\u675F");
        } else if (code !== null && code !== void 0 && code !== 0) {
          vscode.window.showErrorMessage("\u661F\u701A: \u8FD0\u884C\u5931\u8D25\u6216\u5DF2\u4E2D\u65AD\uFF0C\u8BF7\u67E5\u770B\u8F93\u51FA\u3002");
        }
      });
      proc.on("error", (err) => {
        runOnDeviceProcess = null;
        channel.appendLine(`\u274C \u542F\u52A8\u5931\u8D25: ${err.message}`);
        vscode.window.showErrorMessage(`\u661F\u701A: \u542F\u52A8\u5931\u8D25 \u2014 ${err.message}`);
      });
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("xinghan.stopRunOnDevice", async () => {
      if (!runOnDeviceProcess) {
        vscode.window.showInformationMessage("\u5F53\u524D\u6CA1\u6709\u5728\u8BBE\u5907\u4E0A\u8FD0\u884C\u7684\u7A0B\u5E8F\u3002");
        return;
      }
      channel.appendLine("\n[\u7528\u6237\u8BF7\u6C42\u505C\u6B62] \u6B63\u5728\u7EC8\u6B62\u8BBE\u5907\u4E0A\u7684\u8FD0\u884C\u2026");
      await stopRunOnDeviceProcess(runOnDeviceProcess);
      runOnDeviceProcess = null;
      vscode.window.showInformationMessage("\u661F\u701A: \u5DF2\u505C\u6B62\u8BBE\u5907\u4E0A\u7684\u8FD0\u884C");
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("xinghan.deleteFile", async () => {
      const config = getConfig();
      const scriptPath = resolveScriptPath(context.extensionPath);
      if (!await ensureDependencies(config.pythonPath, channel)) {
        return;
      }
      if (runOnDeviceProcess) {
        channel.show(true);
        channel.appendLine("\u6B63\u5728\u505C\u6B62\u8BBE\u5907\u4E0A\u7684\u8FD0\u884C\u4EE5\u91CA\u653E\u4E32\u53E3\u2026");
        await stopRunOnDeviceProcess(runOnDeviceProcess);
        runOnDeviceProcess = null;
        await new Promise((r) => setTimeout(r, 500));
      }
      const container = await vscode.window.showQuickPick(
        CONTAINERS.map((c) => ({ label: c, container: c })),
        { title: "\u9009\u62E9\u8981\u5220\u9664\u6587\u4EF6\u7684\u5BB9\u5668", placeHolder: "container1 ~ container5" }
      );
      if (!container) {
        return;
      }
      channel.show(true);
      channel.clear();
      channel.appendLine(`\u6B63\u5728\u5217\u51FA ${container.container} \u4E2D\u7684\u6587\u4EF6...`);
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
        vscode.window.showErrorMessage("\u661F\u701A: \u5217\u51FA\u6587\u4EF6\u5931\u8D25\uFF0C\u8BF7\u67E5\u770B\u8F93\u51FA\u3002");
        return;
      }
      let files;
      try {
        files = JSON.parse(listStdout.trim());
      } catch {
        channel.appendLine("\u89E3\u6790\u6587\u4EF6\u5217\u8868\u5931\u8D25\u3002");
        vscode.window.showErrorMessage("\u661F\u701A: \u89E3\u6790\u6587\u4EF6\u5217\u8868\u5931\u8D25\u3002");
        return;
      }
      if (files.length === 0) {
        vscode.window.showInformationMessage(`${container.container} \u4E2D\u6CA1\u6709\u6587\u4EF6\u3002`);
        return;
      }
      const fileToDelete = await vscode.window.showQuickPick(
        files.map((f) => ({ label: f.name, description: `${f.size} bytes`, filename: f.name })),
        { title: `\u9009\u62E9\u8981\u5220\u9664\u7684\u6587\u4EF6\uFF08${container.container}\uFF09`, placeHolder: "\u9009\u62E9\u6587\u4EF6" }
      );
      if (!fileToDelete) {
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        `\u786E\u5B9A\u8981\u5220\u9664 ${container.container}/${fileToDelete.filename} \u5417\uFF1F`,
        { modal: true },
        "\u5220\u9664"
      );
      if (confirm !== "\u5220\u9664") {
        return;
      }
      channel.appendLine(`
\u6B63\u5728\u5220\u9664 ${fileToDelete.filename}...`);
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
        vscode.window.showInformationMessage(`\u661F\u701A: \u5DF2\u5220\u9664 ${container.container}/${fileToDelete.filename}`);
      } else {
        vscode.window.showErrorMessage("\u661F\u701A: \u5220\u9664\u5931\u8D25\uFF0C\u8BF7\u67E5\u770B\u8F93\u51FA\u3002");
      }
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("xinghan.connectWifi", async () => {
      const config = getConfig();
      const scriptPath = resolveScriptPath(context.extensionPath);
      if (!await ensureDependencies(config.pythonPath, channel)) {
        return;
      }
      if (runOnDeviceProcess) {
        channel.show(true);
        channel.appendLine("\u6B63\u5728\u505C\u6B62\u8BBE\u5907\u4E0A\u7684\u8FD0\u884C\u4EE5\u91CA\u653E\u4E32\u53E3\u2026");
        await stopRunOnDeviceProcess(runOnDeviceProcess);
        runOnDeviceProcess = null;
        await new Promise((r) => setTimeout(r, 500));
      }
      const presetItems = config.wifiPresets.map((w) => ({
        label: w.name,
        description: "\u9884\u8BBE",
        preset: w
      }));
      const manualItem = { label: "$(edit) \u624B\u52A8\u8F93\u5165 WiFi", description: "", preset: null };
      const choices = [...presetItems, manualItem];
      const chosen = await vscode.window.showQuickPick(choices, {
        title: "\u9009\u62E9 WiFi",
        placeHolder: "\u9009\u62E9\u9884\u8BBE WiFi \u6216\u624B\u52A8\u8F93\u5165"
      });
      if (!chosen) {
        return;
      }
      let ssid;
      let password;
      let authMode = 3;
      if (chosen.preset) {
        ssid = chosen.preset.name;
        password = chosen.preset.password;
        authMode = chosen.preset.authMode ?? 3;
      } else {
        const input = await vscode.window.showInputBox({
          title: "\u8F93\u5165 WiFi \u540D\u79F0\u548C\u5BC6\u7801",
          placeHolder: "WiFi\u540D\u79F0 \u5BC6\u7801",
          prompt: "\u683C\u5F0F\uFF1AWiFi\u540D\u79F0 \u5BC6\u7801\uFF08\u7528\u7A7A\u683C\u5206\u9694\uFF09"
        });
        if (!input) {
          return;
        }
        const spaceIndex = input.indexOf(" ");
        if (spaceIndex === -1) {
          vscode.window.showErrorMessage("\u683C\u5F0F\u9519\u8BEF\uFF0C\u8BF7\u8F93\u5165\uFF1AWiFi\u540D\u79F0 \u5BC6\u7801\uFF08\u7528\u7A7A\u683C\u5206\u9694\uFF09");
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
        vscode.window.showInformationMessage(`\u661F\u701A: \u5DF2\u53D1\u9001 WiFi \u8FDE\u63A5\u547D\u4EE4 (${ssid})`);
      } else {
        vscode.window.showErrorMessage("\u661F\u701A: WiFi \u8FDE\u63A5\u5931\u8D25\uFF0C\u8BF7\u67E5\u770B\u8F93\u51FA\u3002");
      }
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("xinghan.listPorts", async () => {
      const config = getConfig();
      const scriptPath = resolveScriptPath(context.extensionPath);
      if (!await ensureDependencies(config.pythonPath, channel)) {
        return;
      }
      channel.show(true);
      channel.clear();
      channel.appendLine("\u6B63\u5728\u5217\u51FA\u4E32\u53E3...");
      const { exitCode, stdout } = await runPythonScript(
        config.pythonPath,
        scriptPath,
        ["--list-ports"],
        channel
      );
      if (exitCode === 0) {
        try {
          const ports = JSON.parse(stdout.trim());
          if (ports.length === 0) {
            vscode.window.showInformationMessage("\u672A\u68C0\u6D4B\u5230\u4E32\u53E3\u8BBE\u5907\u3002");
            return;
          }
          const chosen = await vscode.window.showQuickPick(
            ports.map((p) => ({ label: p.device, description: p.description, device: p.device })),
            { title: "\u9009\u62E9\u4E32\u53E3\uFF08\u53EF\u590D\u5236\u5230\u8BBE\u7F6E xinghan.serialPort\uFF09", matchOnDescription: true }
          );
          if (chosen) {
            await vscode.env.clipboard.writeText(chosen.device);
            vscode.window.showInformationMessage(`\u5DF2\u590D\u5236\u5230\u526A\u8D34\u677F: ${chosen.device}`);
          }
        } catch {
          channel.appendLine("\u89E3\u6790\u4E32\u53E3\u5217\u8868\u5931\u8D25\uFF0C\u539F\u59CB\u8F93\u51FA\u89C1\u4E0A\u3002");
        }
      }
    })
  );
}
function deactivate() {
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
//# sourceMappingURL=extension.js.map
