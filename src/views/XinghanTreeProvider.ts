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
  command: string;
  tooltip?: string;
  icon?: string;
}

/** 设备文件树节点：端口（仅多设备时）、容器、设备文件、占位（仅用于「星瀚控制器」栏） */
export type DeviceFileTreeNode =
  | { kind: "port"; port: string; label: string }
  | { kind: "container"; port: string; container: string }
  | { kind: "deviceFile"; port: string; container: string; name: string; size: string }
  | { kind: "placeholder"; label: string; description?: string };

const ACTION_ITEMS: ActionItemNode[] = [
  { id: "upload", label: "上传", command: "xinghan.upload", tooltip: "上传到控制器（不运行）", icon: "cloud-upload" },
  { id: "uploadAndRun", label: "上传运行", command: "xinghan.uploadAndRun", tooltip: "上传并在设备上运行", icon: "rocket" },
  { id: "wifi", label: "WiFi连接", command: "xinghan.connectWifi", tooltip: "向设备发送 WiFi 连接命令", icon: "globe" },
];

/** 「星瀚助手」栏：仅展示操作项，无分类节点 */
export class XinghanActionsTreeProvider implements vscode.TreeDataProvider<ActionItemNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ActionItemNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private _isRunOnDeviceActive = false;
  private _isBluetoothConnected = false;
  private _isReplConnected = false;

  setRunOnDeviceActive(isActive: boolean): void {
    this._isRunOnDeviceActive = isActive;
    this.refresh();
  }

  setBluetoothConnected(isConnected: boolean): void {
    this._isBluetoothConnected = isConnected;
    this.refresh();
  }

  setReplConnected(isConnected: boolean): void {
    this._isReplConnected = isConnected;
    this.refresh();
  }

  getTreeItem(element: ActionItemNode): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.command = { command: element.command, title: element.label };
    item.tooltip = element.tooltip ?? element.label;
    if (element.icon) {
      item.iconPath = new vscode.ThemeIcon(element.icon);
    }
    return item;
  }

  getChildren(): ActionItemNode[] {
    const runItem: ActionItemNode = this._isRunOnDeviceActive
      ? { id: "toggleRunOnDevice", label: "停止", command: "xinghan.toggleRunOnDevice", tooltip: "停止设备上正在运行的程序", icon: "debug-stop" }
      : { id: "toggleRunOnDevice", label: "运行", command: "xinghan.toggleRunOnDevice", tooltip: "运行当前文件", icon: "play" };
    const bluetoothItem: ActionItemNode = this._isBluetoothConnected
      ? { id: "toggleBluetooth", label: "蓝牙断开", command: "xinghan.toggleBluetooth", tooltip: "断开当前蓝牙连接并恢复有线操作", icon: "debug-disconnect" }
      : { id: "toggleBluetooth", label: "蓝牙连接", command: "xinghan.toggleBluetooth", tooltip: "通过蓝牙连接星瀚控制器", icon: "radio-tower" };
    const replItem: ActionItemNode = this._isReplConnected
      ? { id: "toggleRepl", label: "REPL断开", command: "xinghan.toggleRepl", tooltip: "关闭 REPL 终端并释放串口", icon: "debug-disconnect" }
      : { id: "toggleRepl", label: "REPL连接", command: "xinghan.toggleRepl", tooltip: "选择星瀚控制器端口并进入 REPL", icon: "terminal" };
    return [
      runItem,
      ACTION_ITEMS[0],
      ACTION_ITEMS[1],
      replItem,
      bluetoothItem,
      ACTION_ITEMS[2],
    ];
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }
}

/** 连接状态树节点（仅用于「连接状态」栏） */
export interface ConnectionStatusNode {
  label: string;
  description?: string;
  icon: string;
  /** 设备唯一编号，存在时右键可「复制设备编号」 */
  deviceId?: string;
  /** 完整串口设备路径，存在时右键可「复制串口」 */
  portPath?: string;
}

/** 获取可用端口的函数（与 extension 中的 list-ports-xinghan-with-mac 一致，返回含 device_id/serial_number） */
export type ListPortsFn = () => Promise<Array<{ device: string; display?: string; serial_number?: string | null; device_id?: string | null }>>;

function formatPortLabel(p: { device: string; display?: string; serial_number?: string | null; device_id?: string | null }): string {
  if (p.device_id) return p.device_id;
  return p.display ?? p.device;
}

/** 「连接状态」栏：一开始即展示可用端口；REPL连接后显示已连接端口 */
export class ConnectionStatusTreeProvider implements vscode.TreeDataProvider<ConnectionStatusNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ConnectionStatusNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _connectedPort: string | null = null;
  private _connectedPortLabel: string | null = null;
  private _connectedDeviceId: string | null = null;
  private _bluetoothDevice: { name: string; address: string } | null = null;

  constructor(private listPorts?: ListPortsFn) {}

  setPort(port: string | null, label?: string, deviceId?: string): void {
    this._connectedPort = port;
    this._connectedPortLabel = port ? label ?? null : null;
    this._connectedDeviceId = port ? deviceId ?? label ?? null : null;
    this._onDidChangeTreeData.fire(undefined);
  }

  setBluetoothDevice(device: { name: string; address: string } | null): void {
    this._bluetoothDevice = device;
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
    if (element.portPath) {
      item.contextValue = "connectionPort";
    }
    return item;
  }

  getChildren(): ConnectionStatusNode[] | Promise<ConnectionStatusNode[]> {
    if (this._bluetoothDevice) {
      return [
        {
          label: `蓝牙已连接：${this._bluetoothDevice.name}`,
          description: this._bluetoothDevice.address,
          icon: "radio-tower",
        },
      ];
    }
    if (this._connectedPort) {
      return [
        {
          label: this._connectedPortLabel ?? "已连接端口",
          description: this._connectedPort,
          icon: "plug",
          deviceId: this._connectedDeviceId ?? this._connectedPortLabel ?? undefined,
          portPath: this._connectedPort,
        },
      ];
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
            deviceId: p.device_id ?? formatPortLabel(p),
            portPath: p.device,
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
  listPorts: () => Promise<Array<{ device: string; display?: string; serial_number?: string | null; device_id?: string | null }>>;
  listDeviceFiles: (port: string, container: string) => Promise<DeviceFileInfo[]>;
}

/** 「星瀚控制器」栏：多设备时 端口 -> 容器 -> 文件；单设备时 容器 -> 文件 */
export class XinghanDeviceFilesTreeProvider implements vscode.TreeDataProvider<DeviceFileTreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<DeviceFileTreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private _bluetoothDevice: { name: string; address: string } | null = null;

  constructor(private deps: XinghanDeviceFilesTreeDeps) {}

  setBluetoothDevice(device: { name: string; address: string } | null): void {
    this._bluetoothDevice = device;
    this._onDidChangeTreeData.fire(undefined);
  }

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
        if (this._bluetoothDevice) {
          return [
            {
              kind: "placeholder",
              label: `蓝牙已连接：${this._bluetoothDevice.name}`,
              description: "蓝牙模式支持上传、运行、停止；文件管理请使用 USB 有线连接",
            },
          ];
        }
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
