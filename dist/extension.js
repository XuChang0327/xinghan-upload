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
var vscode3 = __toESM(require("vscode"));
var path = __toESM(require("path"));
var fs = __toESM(require("fs"));
var import_child_process = require("child_process");

// src/views/XinghanTreeProvider.ts
var vscode = __toESM(require("vscode"));
var ACTION_ITEMS = [
  { id: "run", label: "\u25B6\uFE0F \u661F\u701A\u8FD0\u884C", command: "xinghan.runOnDevice", tooltip: "\u5728\u63A7\u5236\u5668\u4E0A\u8FD0\u884C\u5F53\u524D\u6253\u5F00\u7684\u6587\u4EF6" },
  { id: "stop", label: "\u23F9\uFE0F \u661F\u701A\u505C\u6B62", command: "xinghan.stopRunOnDevice", tooltip: "\u505C\u6B62\u8BBE\u5907\u4E0A\u6B63\u5728\u8FD0\u884C\u7684\u7A0B\u5E8F" },
  { id: "upload", label: "\u{1F4E4} \u661F\u701A\u4E0A\u4F20", command: "xinghan.upload", tooltip: "\u4E0A\u4F20\u5F53\u524D\u6587\u4EF6\u5230\u661F\u701A\u63A7\u5236\u5668" },
  { id: "wifi", label: "\u{1F4F6} \u8054\u7F51", command: "xinghan.connectWifi", tooltip: "\u5411\u8BBE\u5907\u53D1\u9001 WiFi \u8FDE\u63A5\u547D\u4EE4" },
  { id: "selectPort", label: "\u{1F50C} \u8FDE\u63A5 REPL", command: "xinghan.selectPortAndRepl", tooltip: "\u9009\u62E9\u661F\u701A\u63A7\u5236\u5668\u7AEF\u53E3\u5E76\u8FDB\u5165 REPL" },
  { id: "disconnectRepl", label: "\u{1F4F4} \u65AD\u5F00 REPL", command: "xinghan.disconnectRepl", tooltip: "\u65AD\u5F00 REPL \u7EC8\u7AEF\u5E76\u91CA\u653E\u4E32\u53E3" }
];
var XinghanActionsTreeProvider = class {
  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
  }
  getTreeItem(element) {
    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.command = { command: element.command, title: element.label };
    item.tooltip = element.tooltip ?? element.label;
    return item;
  }
  getChildren() {
    return ACTION_ITEMS;
  }
  refresh() {
    this._onDidChangeTreeData.fire(void 0);
  }
};
function formatPortLabel(p) {
  if (p.device_id) return p.device_id;
  return p.display ?? p.device;
}
var ConnectionStatusTreeProvider = class {
  constructor(listPorts) {
    this.listPorts = listPorts;
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    this._connectedPort = null;
    this._connectedPortLabel = null;
  }
  setPort(port, label) {
    this._connectedPort = port;
    this._connectedPortLabel = port ? label ?? null : null;
    this._onDidChangeTreeData.fire(void 0);
  }
  refresh() {
    this._onDidChangeTreeData.fire(void 0);
  }
  getTreeItem(element) {
    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon(element.icon);
    if (element.description) item.description = element.description;
    item.tooltip = element.description ?? element.label;
    if (element.portPath) {
      item.contextValue = "connectionPort";
    }
    return item;
  }
  getChildren() {
    if (this._connectedPort) {
      return [
        {
          label: this._connectedPortLabel ?? "\u5DF2\u8FDE\u63A5\u7AEF\u53E3",
          description: this._connectedPort,
          icon: "plug",
          portPath: this._connectedPort
        }
      ];
    }
    if (this.listPorts) {
      return this.listPorts().then((ports) => {
        if (ports.length === 0) {
          return [{ label: "\u6CA1\u6709\u8FDE\u63A5\u63A7\u5236\u5668", description: "\u8BF7\u8FDE\u63A5\u8BBE\u5907\u540E\u70B9\u51FB\u5237\u65B0", icon: "plug-disconnected" }];
        }
        return ports.map((p) => ({
          label: formatPortLabel(p),
          description: p.device,
          icon: "plug",
          portPath: p.device
        }));
      }).catch(() => [
        { label: "\u6CA1\u6709\u8FDE\u63A5\u63A7\u5236\u5668", description: "\u8BF7\u8FDE\u63A5\u8BBE\u5907\u540E\u70B9\u51FB\u5237\u65B0", icon: "plug-disconnected" }
      ]);
    }
    return [{ label: "\u6CA1\u6709\u8FDE\u63A5\u63A7\u5236\u5668", description: "\u8BF7\u8FDE\u63A5\u8BBE\u5907\u540E\u70B9\u51FB\u5237\u65B0", icon: "plug-disconnected" }];
  }
};
var XinghanDeviceFilesTreeProvider = class {
  constructor(deps) {
    this.deps = deps;
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
  }
  getTreeItem(element) {
    if (element.kind === "placeholder") {
      const item2 = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item2.iconPath = new vscode.ThemeIcon("plug-disconnected");
      if (element.description) item2.description = element.description;
      item2.tooltip = element.description ?? element.label;
      return item2;
    }
    if (element.kind === "port") {
      const item2 = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Collapsed);
      item2.iconPath = new vscode.ThemeIcon("plug");
      item2.tooltip = element.port;
      return item2;
    }
    if (element.kind === "container") {
      const item2 = new vscode.TreeItem(element.container, vscode.TreeItemCollapsibleState.Collapsed);
      item2.iconPath = new vscode.ThemeIcon("folder");
      item2.tooltip = `\u70B9\u51FB\u5C55\u5F00\u67E5\u770B ${element.container} \u4E2D\u7684\u6587\u4EF6`;
      return item2;
    }
    const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon("file");
    if (element.size) item.description = `${element.size} B`;
    item.tooltip = element.size ? `${element.container}/${element.name} (${element.size} B)` : element.name;
    const isPlaceholder = element.name === "\uFF08\u7A7A\uFF09" || element.name === "\u65E0\u6CD5\u83B7\u53D6\u5217\u8868";
    if (!isPlaceholder) {
      item.contextValue = "deviceFile";
      item.command = {
        command: "xinghan.openDeviceFile",
        title: "\u6253\u5F00",
        arguments: [element.port, element.container, element.name]
      };
    }
    return item;
  }
  async getChildren(element) {
    if (!element) {
      const ports = await this.deps.listPorts();
      if (ports.length === 0) {
        return [{ kind: "placeholder", label: "\u6CA1\u6709\u8FDE\u63A5\u63A7\u5236\u5668", description: "\u8BF7\u8FDE\u63A5\u8BBE\u5907\u540E\u70B9\u51FB\u5237\u65B0" }];
      }
      if (ports.length === 1) {
        const port = ports[0].device;
        return this.deps.containers.map((container) => ({ kind: "container", port, container }));
      }
      return ports.map((p) => ({ kind: "port", port: p.device, label: formatPortLabel(p) }));
    }
    if (element.kind === "port") {
      return this.deps.containers.map((container) => ({
        kind: "container",
        port: element.port,
        container
      }));
    }
    if (element.kind !== "container") return [];
    try {
      const files = await this.deps.listDeviceFiles(element.port, element.container);
      const pyFiles = files.filter((f) => f.name.toLowerCase().endsWith(".py"));
      if (pyFiles.length === 0) {
        return [{ kind: "deviceFile", port: element.port, container: element.container, name: "\uFF08\u7A7A\uFF09", size: "0" }];
      }
      return pyFiles.map((f) => ({
        kind: "deviceFile",
        port: element.port,
        container: element.container,
        name: f.name,
        size: f.size
      }));
    } catch {
      return [{ kind: "deviceFile", port: element.port, container: element.container, name: "\u65E0\u6CD5\u83B7\u53D6\u5217\u8868", size: "" }];
    }
  }
  refresh() {
    this._onDidChangeTreeData.fire(void 0);
  }
};

// src/views/XinghanDeviceFileSystemProvider.ts
var vscode2 = __toESM(require("vscode"));
var SCHEME = "xinghan-device";
function encodePortSegment(port) {
  return Buffer.from(port, "utf8").toString("base64url");
}
function decodePortSegment(segment) {
  try {
    const decoded = Buffer.from(segment, "base64url").toString("utf8");
    if (decoded.length > 0) return decoded;
  } catch {
  }
  try {
    const legacy = decodeURIComponent(segment);
    if (legacy.length > 0) return legacy;
  } catch {
  }
  return null;
}
function parseDeviceUri(uri) {
  if (uri.scheme !== SCHEME) return null;
  const path2 = uri.path.replace(/^\/+/, "");
  const parts = path2.split("/").filter(Boolean);
  if (parts.length < 3) return null;
  const port = decodePortSegment(parts[0]);
  const container = parts[1];
  const filename = parts.slice(2).join("/");
  if (!port || !container || !filename) return null;
  return { port, container, filename };
}
function toDeviceUri(port, container, filename) {
  const seg = encodePortSegment(port);
  return vscode2.Uri.from({
    scheme: SCHEME,
    path: `/${seg}/${container}/${filename}`
  });
}
var XinghanDeviceFileSystemProvider = class {
  constructor(doRead, doWrite) {
    this.doRead = doRead;
    this.doWrite = doWrite;
    this._emitter = new vscode2.EventEmitter();
    this.onDidChangeFile = this._emitter.event;
  }
  watch(_uri) {
    return new vscode2.Disposable(() => {
    });
  }
  async stat(uri) {
    const parsed = parseDeviceUri(uri);
    if (!parsed) throw vscode2.FileSystemError.FileNotFound(uri);
    return {
      type: vscode2.FileType.File,
      ctime: 0,
      mtime: 0,
      size: 0
    };
  }
  async readDirectory(_uri) {
    return [];
  }
  async readFile(uri) {
    const parsed = parseDeviceUri(uri);
    if (!parsed) throw vscode2.FileSystemError.FileNotFound(uri);
    return this.doRead(parsed.port, parsed.container, parsed.filename);
  }
  async writeFile(uri, content, _options) {
    const parsed = parseDeviceUri(uri);
    if (!parsed) throw vscode2.FileSystemError.FileNotFound(uri);
    await this.doWrite(parsed.port, parsed.container, parsed.filename, content);
  }
  createDirectory(_uri) {
    throw vscode2.FileSystemError.NoPermissions();
  }
  delete(_uri) {
    throw vscode2.FileSystemError.NoPermissions();
  }
  rename(_oldUri, _newUri, _options) {
    throw vscode2.FileSystemError.NoPermissions();
  }
};

// src/extension.ts
var treeKill = require_tree_kill();
var OUTPUT_CHANNEL_NAME = "\u661F\u701A\u52A9\u624B";
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
  const choice = await vscode3.window.showWarningMessage(
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
    vscode3.window.showInformationMessage("\u661F\u701A: Python \u4F9D\u8D56\u5B89\u88C5\u6210\u529F");
  } else {
    vscode3.window.showErrorMessage(
      `\u661F\u701A: \u4F9D\u8D56\u5B89\u88C5\u5931\u8D25\uFF0C\u8BF7\u624B\u52A8\u8FD0\u884C: ${pythonPath} -m pip install ${missing.join(" ")}`
    );
  }
  return success;
}
function getConfig() {
  return {
    pythonPath: vscode3.workspace.getConfiguration("xinghan").get("pythonPath") ?? "python3",
    serialPort: vscode3.workspace.getConfiguration("xinghan").get("serialPort"),
    wifiPresets: vscode3.workspace.getConfiguration("xinghan").get("wifiPresets") ?? []
  };
}
function resolveLocalFilePathForDevice(firstArg, selectedResources) {
  const multi = Array.isArray(selectedResources) && selectedResources.length > 1 && selectedResources.every((u) => u instanceof vscode3.Uri);
  if (firstArg instanceof vscode3.Uri && firstArg.scheme === "file") {
    if (multi) {
      vscode3.window.showInformationMessage("\u661F\u701A: \u5DF2\u9009\u62E9\u591A\u4E2A\u6587\u4EF6\uFF0C\u4EC5\u5BF9\u53F3\u952E\u76EE\u6807\u6587\u4EF6\u6267\u884C\u3002");
    }
    try {
      const stat = fs.statSync(firstArg.fsPath);
      if (stat.isDirectory()) {
        vscode3.window.showWarningMessage("\u661F\u701A: \u8BF7\u9009\u62E9\u6587\u4EF6\uFF0C\u4E0D\u80FD\u5BF9\u6587\u4EF6\u5939\u6267\u884C\u3002");
        return null;
      }
    } catch {
      vscode3.window.showWarningMessage("\u661F\u701A: \u65E0\u6CD5\u8BBF\u95EE\u8BE5\u8DEF\u5F84\u3002");
      return null;
    }
    return firstArg.fsPath;
  }
  const editor = vscode3.window.activeTextEditor;
  const docUri = editor?.document.uri;
  if (!docUri || docUri.scheme !== "file") {
    vscode3.window.showWarningMessage("\u8BF7\u5148\u6253\u5F00\u8981\u64CD\u4F5C\u7684\u672C\u5730\u6587\u4EF6\u3002");
    return null;
  }
  return docUri.fsPath;
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
function createCommandStatusBarItem(context, text, command, tooltip, priority) {
  const item = vscode3.window.createStatusBarItem(vscode3.StatusBarAlignment.Right, priority);
  item.text = text;
  item.command = command;
  item.tooltip = tooltip;
  item.show();
  context.subscriptions.push(item);
}
function activate(context) {
  const channel = vscode3.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  let runOnDeviceProcess = null;
  let replTerminal = null;
  let replPort = null;
  createCommandStatusBarItem(context, "\u25B6\uFE0F \u661F\u701A\u8FD0\u884C", "xinghan.runOnDevice", "\u5728\u661F\u701A\u63A7\u5236\u5668\u4E0A\u8FD0\u884C\u5F53\u524D\u6587\u4EF6", 103);
  createCommandStatusBarItem(context, "\u23F9\uFE0F \u661F\u701A\u505C\u6B62", "xinghan.stopRunOnDevice", "\u505C\u6B62\u661F\u701A\u63A7\u5236\u5668\u4E0A\u6B63\u5728\u8FD0\u884C\u7684\u7A0B\u5E8F", 102);
  createCommandStatusBarItem(context, "\u{1F4E4} \u661F\u701A\u4E0A\u4F20", "xinghan.upload", "\u4E0A\u4F20\u5F53\u524D\u6587\u4EF6\u5230\u661F\u701A\u63A7\u5236\u5668", 101);
  async function listDeviceFilesForTree(port, container) {
    const config = getConfig();
    const scriptPath = resolveScriptPath(context.extensionPath);
    const args = ["--list-files", "--container", container, "--port", port];
    const { exitCode, stdout } = await runPythonScript(config.pythonPath, scriptPath, args, channel);
    if (exitCode !== 0) throw new Error("list-files failed");
    const raw = stdout.trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return parsed;
  }
  const readDeviceFileContent = (port, container, filename) => {
    return new Promise((resolve, reject) => {
      const config = getConfig();
      const scriptPath = resolveScriptPath(context.extensionPath);
      const args = ["--read-file", filename, "--container", container, "--port", port];
      const proc = (0, import_child_process.spawn)(config.pythonPath, [scriptPath, ...args], {
        cwd: path.dirname(scriptPath),
        shell: false
      });
      const chunks = [];
      proc.stdout?.on("data", (d) => chunks.push(d));
      proc.stderr?.on("data", () => {
      });
      proc.on("close", (code) => {
        if (code === 0) resolve(Buffer.concat(chunks));
        else reject(new Error(`read-file exited with ${code}`));
      });
      proc.on("error", reject);
    });
  };
  const writeDeviceFileContent = (port, container, filename, content) => {
    return new Promise((resolve, reject) => {
      const config = getConfig();
      const scriptPath = resolveScriptPath(context.extensionPath);
      const args = ["--write-file", filename, "--container", container, "--port", port];
      const proc = (0, import_child_process.spawn)(config.pythonPath, [scriptPath, ...args], {
        cwd: path.dirname(scriptPath),
        shell: false,
        stdio: ["pipe", "pipe", "pipe"]
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
  const deviceFsProvider = new XinghanDeviceFileSystemProvider(readDeviceFileContent, writeDeviceFileContent);
  context.subscriptions.push(
    vscode3.workspace.registerFileSystemProvider("xinghan-device", deviceFsProvider, { isCaseSensitive: true })
  );
  const deviceIdCache = /* @__PURE__ */ new Map();
  let listXinghanPortsInFlight = null;
  function cacheKeyForPort(p) {
    return p.serial_number || p.device;
  }
  function applyCachedDeviceIds(ports) {
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
  async function listXinghanPorts() {
    if (!listXinghanPortsInFlight) {
      listXinghanPortsInFlight = (async () => {
        const config = getConfig();
        const scriptPath = resolveScriptPath(context.extensionPath);
        const portsJson = await new Promise((resolve, reject) => {
          const proc = (0, import_child_process.spawn)(config.pythonPath, [scriptPath, "--list-ports-xinghan-with-mac"], {
            cwd: path.dirname(scriptPath),
            shell: false
          });
          const chunks = [];
          proc.stdout?.on("data", (d) => chunks.push(d.toString()));
          proc.stderr?.on("data", () => {
          });
          proc.on("close", (code) => {
            if (code === 0) resolve(chunks.join(""));
            else reject(new Error(`list-ports-xinghan-with-mac exited with ${code}`));
          });
          proc.on("error", reject);
        }).catch(() => "");
        try {
          const raw = portsJson.trim();
          const ports = raw ? JSON.parse(raw) : [];
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
  function formatPortLabel2(p) {
    if (p.device_id) return p.device_id;
    return p.display ?? p.device;
  }
  async function resolvePortForUploadOrRun() {
    const ports = await listXinghanPorts();
    if (ports.length === 0) return null;
    if (ports.length === 1) return ports[0].device;
    const chosen = await vscode3.window.showQuickPick(
      ports.map((p) => ({ label: formatPortLabel2(p), description: p.device, device: p.device })),
      { title: "\u9009\u62E9\u661F\u701A\u63A7\u5236\u5668\u7AEF\u53E3", placeHolder: "\u68C0\u6D4B\u5230\u591A\u4E2A\u8BBE\u5907\uFF0C\u8BF7\u9009\u62E9\u8981\u4F7F\u7528\u7684\u7AEF\u53E3", matchOnDescription: true }
    );
    return chosen?.device ?? null;
  }
  const actionsTreeProvider = new XinghanActionsTreeProvider();
  const connectionStatusTreeProvider = new ConnectionStatusTreeProvider(listXinghanPorts);
  const deviceFilesTreeProvider = new XinghanDeviceFilesTreeProvider({
    containers: CONTAINERS,
    listPorts: listXinghanPorts,
    listDeviceFiles: listDeviceFilesForTree
  });
  context.subscriptions.push(
    vscode3.window.registerTreeDataProvider("xinghan.actionsView", actionsTreeProvider)
  );
  context.subscriptions.push(
    vscode3.window.registerTreeDataProvider("xinghan.connectionStatusView", connectionStatusTreeProvider)
  );
  context.subscriptions.push(
    vscode3.window.registerTreeDataProvider("xinghan.deviceFilesView", deviceFilesTreeProvider)
  );
  context.subscriptions.push(
    vscode3.commands.registerCommand("xinghan.refreshConnectionStatus", () => {
      connectionStatusTreeProvider.refresh();
      deviceFilesTreeProvider.refresh();
    })
  );
  context.subscriptions.push(
    vscode3.commands.registerCommand("xinghan.refreshDeviceFiles", () => {
      connectionStatusTreeProvider.refresh();
      deviceFilesTreeProvider.refresh();
    })
  );
  context.subscriptions.push(
    vscode3.commands.registerCommand("xinghan.copyConnectionPort", async (node) => {
      const path2 = node?.portPath;
      if (!path2) {
        return;
      }
      await vscode3.env.clipboard.writeText(path2);
      vscode3.window.showInformationMessage(`\u5DF2\u590D\u5236\u4E32\u53E3\uFF1A${path2}`);
    })
  );
  context.subscriptions.push(
    vscode3.window.onDidCloseTerminal((closed) => {
      if (replTerminal && closed === replTerminal) {
        replTerminal = null;
        replPort = null;
        connectionStatusTreeProvider.setPort(null);
      }
    })
  );
  context.subscriptions.push(
    vscode3.commands.registerCommand("xinghan.openDeviceFile", async (port, container, filename) => {
      const uri = toDeviceUri(port, container, filename);
      const doc = await vscode3.workspace.openTextDocument(uri);
      await vscode3.window.showTextDocument(doc, { preview: false });
    })
  );
  context.subscriptions.push(
    vscode3.workspace.onDidSaveTextDocument((doc) => {
      if (doc.uri.scheme === "xinghan-device") {
        deviceFilesTreeProvider.refresh();
      }
    })
  );
  context.subscriptions.push(
    vscode3.commands.registerCommand("xinghan.upload", async (firstArg, selectedResources) => {
      const filePath = resolveLocalFilePathForDevice(firstArg, selectedResources);
      if (!filePath) {
        return;
      }
      const config = getConfig();
      const scriptPath = resolveScriptPath(context.extensionPath);
      if (!await ensureDependencies(config.pythonPath, channel)) {
        return;
      }
      const port = await resolvePortForUploadOrRun();
      if (port === null) {
        vscode3.window.showWarningMessage("\u672A\u627E\u5230\u661F\u701A\u63A7\u5236\u5668\u6216\u5DF2\u53D6\u6D88\u9009\u62E9\u7AEF\u53E3\u3002\u8BF7\u8FDE\u63A5\u8BBE\u5907\u540E\u91CD\u8BD5\u3002");
        return;
      }
      const container = await vscode3.window.showQuickPick(
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
      const args = [filePath, "--container", container.container, "--port", port];
      const { exitCode } = await runPythonScript(config.pythonPath, scriptPath, args, channel);
      if (exitCode === 0) {
        vscode3.window.showInformationMessage(`\u661F\u701A: \u5DF2\u4E0A\u4F20\u5230 ${container.container}`);
        deviceFilesTreeProvider.refresh();
      } else {
        vscode3.window.showErrorMessage("\u661F\u701A: \u4E0A\u4F20\u5931\u8D25\uFF0C\u8BF7\u67E5\u770B\u8F93\u51FA\u3002");
      }
    })
  );
  context.subscriptions.push(
    vscode3.commands.registerCommand("xinghan.runOnDevice", async (firstArg, selectedResources) => {
      const filePath = resolveLocalFilePathForDevice(firstArg, selectedResources);
      if (!filePath) {
        return;
      }
      const config = getConfig();
      if (!await ensureDependencies(config.pythonPath, channel)) {
        return;
      }
      const port = await resolvePortForUploadOrRun();
      if (port === null) {
        vscode3.window.showWarningMessage("\u672A\u627E\u5230\u661F\u701A\u63A7\u5236\u5668\u6216\u5DF2\u53D6\u6D88\u9009\u62E9\u7AEF\u53E3\u3002\u8BF7\u8FDE\u63A5\u8BBE\u5907\u540E\u91CD\u8BD5\u3002");
        return;
      }
      if (runOnDeviceProcess) {
        channel.show(true);
        channel.appendLine("[\u91CD\u65B0\u8FD0\u884C] \u6B63\u5728\u505C\u6B62\u5F53\u524D\u8FD0\u884C\u2026");
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
          vscode3.window.showInformationMessage("\u661F\u701A: \u8FD0\u884C\u7ED3\u675F");
        } else if (code !== null && code !== void 0 && code !== 0) {
          vscode3.window.showErrorMessage("\u661F\u701A: \u8FD0\u884C\u5931\u8D25\u6216\u5DF2\u4E2D\u65AD\uFF0C\u8BF7\u67E5\u770B\u8F93\u51FA\u3002");
        }
      });
      proc.on("error", (err) => {
        runOnDeviceProcess = null;
        channel.appendLine(`\u274C \u542F\u52A8\u5931\u8D25: ${err.message}`);
        vscode3.window.showErrorMessage(`\u661F\u701A: \u542F\u52A8\u5931\u8D25 \u2014 ${err.message}`);
      });
    })
  );
  context.subscriptions.push(
    vscode3.commands.registerCommand("xinghan.stopRunOnDevice", async () => {
      if (!runOnDeviceProcess) {
        vscode3.window.showInformationMessage("\u5F53\u524D\u6CA1\u6709\u5728\u8BBE\u5907\u4E0A\u8FD0\u884C\u7684\u7A0B\u5E8F\u3002");
        return;
      }
      channel.appendLine("\n[\u7528\u6237\u8BF7\u6C42\u505C\u6B62] \u6B63\u5728\u7EC8\u6B62\u672C\u673A\u8FDB\u7A0B\u5E76\u91CA\u653E\u4E32\u53E3\u2026");
      await stopRunOnDeviceProcess(runOnDeviceProcess);
      runOnDeviceProcess = null;
      await new Promise((r) => setTimeout(r, 500));
      const config = getConfig();
      const scriptPath = resolveScriptPath(context.extensionPath);
      const args = ["--soft-reset"];
      if (config.serialPort) args.push("--port", config.serialPort);
      channel.appendLine("\u6B63\u5728\u5411\u8BBE\u5907\u53D1\u9001\u8F6F\u590D\u4F4D\u2026");
      const proc = (0, import_child_process.spawn)(config.pythonPath, [scriptPath, ...args], {
        cwd: path.dirname(scriptPath),
        shell: false
      });
      await new Promise((resolve) => proc.on("close", () => resolve()));
      vscode3.window.showInformationMessage("\u661F\u701A: \u5DF2\u505C\u6B62\u8BBE\u5907\u4E0A\u7684\u8FD0\u884C");
    })
  );
  context.subscriptions.push(
    vscode3.commands.registerCommand("xinghan.deleteFile", async () => {
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
      const container = await vscode3.window.showQuickPick(
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
        vscode3.window.showErrorMessage("\u661F\u701A: \u5217\u51FA\u6587\u4EF6\u5931\u8D25\uFF0C\u8BF7\u67E5\u770B\u8F93\u51FA\u3002");
        return;
      }
      let files;
      try {
        files = JSON.parse(listStdout.trim());
      } catch {
        channel.appendLine("\u89E3\u6790\u6587\u4EF6\u5217\u8868\u5931\u8D25\u3002");
        vscode3.window.showErrorMessage("\u661F\u701A: \u89E3\u6790\u6587\u4EF6\u5217\u8868\u5931\u8D25\u3002");
        return;
      }
      if (files.length === 0) {
        vscode3.window.showInformationMessage(`${container.container} \u4E2D\u6CA1\u6709\u6587\u4EF6\u3002`);
        return;
      }
      const fileToDelete = await vscode3.window.showQuickPick(
        files.map((f) => ({ label: f.name, description: `${f.size} bytes`, filename: f.name })),
        { title: `\u9009\u62E9\u8981\u5220\u9664\u7684\u6587\u4EF6\uFF08${container.container}\uFF09`, placeHolder: "\u9009\u62E9\u6587\u4EF6" }
      );
      if (!fileToDelete) {
        return;
      }
      const confirm = await vscode3.window.showWarningMessage(
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
        vscode3.window.showInformationMessage(`\u661F\u701A: \u5DF2\u5220\u9664 ${container.container}/${fileToDelete.filename}`);
        deviceFilesTreeProvider.refresh();
      } else {
        vscode3.window.showErrorMessage("\u661F\u701A: \u5220\u9664\u5931\u8D25\uFF0C\u8BF7\u67E5\u770B\u8F93\u51FA\u3002");
      }
    })
  );
  context.subscriptions.push(
    vscode3.commands.registerCommand("xinghan.deleteFileFromTree", async (element) => {
      if (!element || element.kind !== "deviceFile" || !element.port || !element.container || !element.name) return;
      const config = getConfig();
      const scriptPath = resolveScriptPath(context.extensionPath);
      if (!await ensureDependencies(config.pythonPath, channel)) return;
      if (runOnDeviceProcess) {
        channel.show(true);
        channel.appendLine("\u6B63\u5728\u505C\u6B62\u8BBE\u5907\u4E0A\u7684\u8FD0\u884C\u4EE5\u91CA\u653E\u4E32\u53E3\u2026");
        await stopRunOnDeviceProcess(runOnDeviceProcess);
        runOnDeviceProcess = null;
        await new Promise((r) => setTimeout(r, 500));
      }
      const confirm = await vscode3.window.showWarningMessage(
        `\u786E\u5B9A\u8981\u5220\u9664 ${element.container}/${element.name} \u5417\uFF1F`,
        { modal: true },
        "\u5220\u9664"
      );
      if (confirm !== "\u5220\u9664") return;
      channel.show(true);
      channel.appendLine(`\u6B63\u5728\u5220\u9664 ${element.name}...`);
      const deleteArgs = ["--delete", element.name, "--container", element.container, "--port", element.port];
      const { exitCode } = await runPythonScript(config.pythonPath, scriptPath, deleteArgs, channel);
      if (exitCode === 0) {
        vscode3.window.showInformationMessage(`\u661F\u701A: \u5DF2\u5220\u9664 ${element.container}/${element.name}`);
        deviceFilesTreeProvider.refresh();
      } else {
        vscode3.window.showErrorMessage("\u661F\u701A: \u5220\u9664\u5931\u8D25\uFF0C\u8BF7\u67E5\u770B\u8F93\u51FA\u3002");
      }
    })
  );
  function validateDevicePyFilename(name) {
    const n = name.trim();
    if (!n || n === "\uFF08\u7A7A\uFF09" || n === "\u65E0\u6CD5\u83B7\u53D6\u5217\u8868") return "\u65E0\u6548\u6587\u4EF6\u540D";
    if (n !== name) return "\u6587\u4EF6\u540D\u9996\u5C3E\u4E0D\u80FD\u6709\u7A7A\u683C";
    if (n.includes("/") || n.includes("\\")) return "\u6587\u4EF6\u540D\u4E0D\u80FD\u5305\u542B\u8DEF\u5F84\u5206\u9694\u7B26";
    if (n.includes("..")) return "\u6587\u4EF6\u540D\u4E0D\u80FD\u5305\u542B ..";
    if (!n.toLowerCase().endsWith(".py")) return "\u4EC5\u652F\u6301 .py \u6587\u4EF6";
    return null;
  }
  context.subscriptions.push(
    vscode3.commands.registerCommand("xinghan.renameDeviceFileFromTree", async (element) => {
      if (!element || element.kind !== "deviceFile" || !element.port || !element.container || !element.name) return;
      const config = getConfig();
      const scriptPath = resolveScriptPath(context.extensionPath);
      if (!await ensureDependencies(config.pythonPath, channel)) return;
      const newNameRaw = await vscode3.window.showInputBox({
        title: "\u91CD\u547D\u540D\u8BBE\u5907\u6587\u4EF6",
        prompt: `\u5C06 ${element.container}/${element.name} \u6539\u540D\u4E3A`,
        value: element.name,
        validateInput: (value) => validateDevicePyFilename(value) ?? void 0
      });
      if (newNameRaw === void 0) return;
      const newName = newNameRaw.trim();
      const nameErr = validateDevicePyFilename(newName);
      if (nameErr) {
        vscode3.window.showErrorMessage(`\u661F\u701A: ${nameErr}`);
        return;
      }
      if (newName === element.name) {
        vscode3.window.showInformationMessage("\u540D\u79F0\u672A\u53D8\u5316\u3002");
        return;
      }
      if (runOnDeviceProcess) {
        channel.show(true);
        channel.appendLine("\u6B63\u5728\u505C\u6B62\u8BBE\u5907\u4E0A\u7684\u8FD0\u884C\u4EE5\u91CA\u653E\u4E32\u53E3\u2026");
        await stopRunOnDeviceProcess(runOnDeviceProcess);
        runOnDeviceProcess = null;
        await new Promise((r) => setTimeout(r, 500));
      }
      channel.show(true);
      channel.appendLine(`\u6B63\u5728\u91CD\u547D\u540D ${element.name} \u2192 ${newName}...`);
      const renameArgs = ["--rename", element.name, newName, "--container", element.container, "--port", element.port];
      const { exitCode } = await runPythonScript(config.pythonPath, scriptPath, renameArgs, channel);
      if (exitCode === 0) {
        vscode3.window.showInformationMessage(`\u661F\u701A: \u5DF2\u91CD\u547D\u540D\u4E3A ${element.container}/${newName}`);
        deviceFilesTreeProvider.refresh();
        const oldUri = toDeviceUri(element.port, element.container, element.name);
        const newUri = toDeviceUri(element.port, element.container, newName);
        const ed = vscode3.window.activeTextEditor;
        if (ed && ed.document.uri.scheme === "xinghan-device" && ed.document.uri.toString() === oldUri.toString()) {
          const col = ed.viewColumn;
          await vscode3.commands.executeCommand("workbench.action.closeActiveEditor");
          const doc = await vscode3.workspace.openTextDocument(newUri);
          await vscode3.window.showTextDocument(doc, { viewColumn: col, preview: false });
        }
      } else {
        vscode3.window.showErrorMessage("\u661F\u701A: \u91CD\u547D\u540D\u5931\u8D25\uFF0C\u8BF7\u67E5\u770B\u8F93\u51FA\u3002");
      }
    })
  );
  context.subscriptions.push(
    vscode3.commands.registerCommand("xinghan.connectWifi", async () => {
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
      const chosen = await vscode3.window.showQuickPick(choices, {
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
        const input = await vscode3.window.showInputBox({
          title: "\u8F93\u5165 WiFi \u540D\u79F0\u548C\u5BC6\u7801",
          placeHolder: "WiFi\u540D\u79F0 \u5BC6\u7801",
          prompt: "\u683C\u5F0F\uFF1AWiFi\u540D\u79F0 \u5BC6\u7801\uFF08\u7528\u7A7A\u683C\u5206\u9694\uFF09"
        });
        if (!input) {
          return;
        }
        const spaceIndex = input.indexOf(" ");
        if (spaceIndex === -1) {
          vscode3.window.showErrorMessage("\u683C\u5F0F\u9519\u8BEF\uFF0C\u8BF7\u8F93\u5165\uFF1AWiFi\u540D\u79F0 \u5BC6\u7801\uFF08\u7528\u7A7A\u683C\u5206\u9694\uFF09");
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
        vscode3.window.showInformationMessage(`\u661F\u701A: \u5DF2\u53D1\u9001 WiFi \u8FDE\u63A5\u547D\u4EE4 (${ssid})`);
      } else {
        vscode3.window.showErrorMessage("\u661F\u701A: WiFi \u8FDE\u63A5\u5931\u8D25\uFF0C\u8BF7\u67E5\u770B\u8F93\u51FA\u3002");
      }
    })
  );
  context.subscriptions.push(
    vscode3.commands.registerCommand("xinghan.selectPortAndRepl", async () => {
      const config = getConfig();
      if (!await ensureDependencies(config.pythonPath, channel)) {
        return;
      }
      const ports = await listXinghanPorts();
      if (ports.length === 0) {
        vscode3.window.showWarningMessage("\u672A\u627E\u5230\u661F\u701A\u63A7\u5236\u5668\u3002\u8BF7\u8FDE\u63A5\u8BBE\u5907\uFF08/dev/cu.usbmodem*\uFF09\u540E\u91CD\u8BD5\u3002");
        return;
      }
      const chosen = await vscode3.window.showQuickPick(
        ports.map((p) => ({ label: formatPortLabel2(p), description: p.device, device: p.device })),
        { title: "\u9009\u62E9\u661F\u701A\u63A7\u5236\u5668\u7AEF\u53E3\u5E76\u8FDB\u5165 REPL", matchOnDescription: true }
      );
      if (!chosen) return;
      const term = vscode3.window.createTerminal({
        name: "\u661F\u701A REPL",
        shellPath: config.pythonPath,
        shellArgs: ["-m", "mpremote", "connect", chosen.device]
      });
      term.show();
      replTerminal = term;
      replPort = chosen.device;
      connectionStatusTreeProvider.setPort(chosen.device, chosen.label);
    })
  );
  context.subscriptions.push(
    vscode3.commands.registerCommand("xinghan.disconnectRepl", () => {
      if (!replTerminal) {
        vscode3.window.showInformationMessage("\u661F\u701A: \u5F53\u524D\u6CA1\u6709\u901A\u8FC7\u63D2\u4EF6\u6253\u5F00\u7684 REPL\uFF0C\u65E0\u9700\u65AD\u5F00\u3002");
        return;
      }
      replTerminal.dispose();
      replTerminal = null;
      replPort = null;
      connectionStatusTreeProvider.setPort(null);
      vscode3.window.showInformationMessage("\u661F\u701A: \u5DF2\u65AD\u5F00 REPL\uFF0C\u4E32\u53E3\u5DF2\u91CA\u653E\u3002");
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
