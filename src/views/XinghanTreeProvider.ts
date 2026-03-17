import * as vscode from "vscode";

/** 设备上的文件信息（与 wired_uploader.py --list-files 返回一致） */
export interface DeviceFileInfo {
  name: string;
  size: string;
}

/** 操作项节点（仅用于「星瀚助手」栏） */
interface ActionItemNode {
  id: string;
  label: string;
  icon: string;
  command: string;
  tooltip?: string;
}

/** 设备文件树节点：端口（仅多设备时）、容器、设备文件、占位（仅用于「星瀚控制器」栏） */
export type DeviceFileTreeNode =
  | { kind: "port"; port: string; label: string }
  | { kind: "container"; port: string; container: string }
  | { kind: "deviceFile"; port: string; container: string; name: string; size: string }
  | { kind: "placeholder"; label: string; description?: string };

const ACTION_ITEMS: ActionItemNode[] = [
  { id: "run", label: "运行", icon: "play", command: "xinghan.runOnDevice", tooltip: "在控制器上运行当前打开的文件" },
  { id: "stop", label: "停止", icon: "debug-stop", command: "xinghan.stopRunOnDevice", tooltip: "停止设备上正在运行的程序" },
  { id: "upload", label: "上传", icon: "cloud-upload", command: "xinghan.upload", tooltip: "上传当前文件到星瀚控制器" },
  { id: "wifi", label: "联网", icon: "radio-tower", command: "xinghan.connectWifi", tooltip: "向设备发送 WiFi 连接命令" },
  { id: "selectPort", label: "连接 REPL", icon: "plug", command: "xinghan.selectPortAndRepl", tooltip: "选择星瀚控制器端口并进入 REPL" },
  { id: "disconnectRepl", label: "断开 REPL", icon: "debug-disconnect", command: "xinghan.disconnectRepl", tooltip: "断开 REPL 终端并释放串口" },
];

/** 「星瀚助手」栏：仅展示操作项，无分类节点 */
export class XinghanActionsTreeProvider implements vscode.TreeDataProvider<ActionItemNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ActionItemNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  getTreeItem(element: ActionItemNode): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon(element.icon);
    item.command = { command: element.command, title: element.label };
    item.tooltip = element.tooltip ?? element.label;
    return item;
  }

  getChildren(): ActionItemNode[] {
    return ACTION_ITEMS;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }
}

/** 连接状态树节点（仅用于「连接状态」栏） */
interface ConnectionStatusNode {
  label: string;
  description?: string;
  icon: string;
}

/** 获取可用端口的函数（与 extension 中的 list-ports-xinghan-with-mac 一致，返回含 serial_number） */
export type ListPortsFn = () => Promise<Array<{ device: string; display?: string; serial_number?: string | null }>>;

function formatPortLabel(p: { device: string; display?: string; serial_number?: string | null }): string {
  const portPart = p.display ?? p.device;
  return p.serial_number ? `${portPart} | ${p.serial_number}` : portPart;
}

/** 「连接状态」栏：一开始即展示可用端口；连接 REPL 后显示已连接端口 */
export class ConnectionStatusTreeProvider implements vscode.TreeDataProvider<ConnectionStatusNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ConnectionStatusNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _connectedPort: string | null = null;

  constructor(private listPorts?: ListPortsFn) {}

  setPort(port: string | null): void {
    this._connectedPort = port;
    this._onDidChangeTreeData.fire(undefined);
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: ConnectionStatusNode): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon(element.icon);
    if (element.description) item.description = element.description;
    item.tooltip = element.description ?? element.label;
    return item;
  }

  getChildren(): ConnectionStatusNode[] | Promise<ConnectionStatusNode[]> {
    if (this._connectedPort) {
      return [{ label: "已连接端口", description: this._connectedPort, icon: "plug" }];
    }
    if (this.listPorts) {
      return this.listPorts()
        .then((ports) => {
          if (ports.length === 0) {
            return [{ label: "没有连接控制器", description: "请连接设备后点击刷新", icon: "plug-disconnected" }];
          }
          return ports.map((p) => ({
            label: formatPortLabel(p),
            description: p.device,
            icon: "plug" as const,
          }));
        })
        .catch(() => [
          { label: "没有连接控制器", description: "请连接设备后点击刷新", icon: "plug-disconnected" },
        ]);
    }
    return [{ label: "没有连接控制器", description: "请连接设备后点击刷新", icon: "plug-disconnected" }];
  }
}

/** 「星瀚控制器」栏依赖：支持按端口列出文件；多设备时先列端口再列容器 */
export interface XinghanDeviceFilesTreeDeps {
  containers: string[];
  listPorts: () => Promise<Array<{ device: string; display?: string; serial_number?: string | null }>>;
  listDeviceFiles: (port: string, container: string) => Promise<DeviceFileInfo[]>;
}

/** 「星瀚控制器」栏：多设备时 端口 -> 容器 -> 文件；单设备时 容器 -> 文件 */
export class XinghanDeviceFilesTreeProvider implements vscode.TreeDataProvider<DeviceFileTreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<DeviceFileTreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private deps: XinghanDeviceFilesTreeDeps) {}

  getTreeItem(element: DeviceFileTreeNode): vscode.TreeItem {
    if (element.kind === "placeholder") {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon("plug-disconnected");
      if (element.description) item.description = element.description;
      item.tooltip = element.description ?? element.label;
      return item;
    }
    if (element.kind === "port") {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = new vscode.ThemeIcon("plug");
      item.tooltip = element.port;
      return item;
    }
    if (element.kind === "container") {
      const item = new vscode.TreeItem(element.container, vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = new vscode.ThemeIcon("folder");
      item.tooltip = `点击展开查看 ${element.container} 中的文件`;
      return item;
    }
    const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon("file");
    if (element.size) item.description = `${element.size} B`;
    item.tooltip = element.size ? `${element.container}/${element.name} (${element.size} B)` : element.name;
    const isPlaceholder = element.name === "（空）" || element.name === "无法获取列表";
    if (!isPlaceholder) {
      item.contextValue = "deviceFile";
      item.command = {
        command: "xinghan.openDeviceFile",
        title: "打开",
        arguments: [element.port, element.container, element.name],
      };
    }
    return item;
  }

  async getChildren(element?: DeviceFileTreeNode): Promise<DeviceFileTreeNode[]> {
    if (!element) {
      const ports = await this.deps.listPorts();
      if (ports.length === 0) {
        return [{ kind: "placeholder", label: "没有连接控制器", description: "请连接设备后点击刷新" }];
      }
      if (ports.length === 1) {
        const port = ports[0].device;
        return this.deps.containers.map((container) => ({ kind: "container" as const, port, container }));
      }
      return ports.map((p) => ({ kind: "port" as const, port: p.device, label: formatPortLabel(p) }));
    }
    if (element.kind === "port") {
      return this.deps.containers.map((container) => ({
        kind: "container" as const,
        port: element.port,
        container,
      }));
    }
    if (element.kind !== "container") return [];

    try {
      const files = await this.deps.listDeviceFiles(element.port, element.container);
      const pyFiles = files.filter((f) => f.name.toLowerCase().endsWith(".py"));
      if (pyFiles.length === 0) {
        return [{ kind: "deviceFile", port: element.port, container: element.container, name: "（空）", size: "0" }];
      }
      return pyFiles.map((f) => ({
        kind: "deviceFile" as const,
        port: element.port,
        container: element.container,
        name: f.name,
        size: f.size,
      }));
    } catch {
      return [{ kind: "deviceFile", port: element.port, container: element.container, name: "无法获取列表", size: "" }];
    }
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }
}
