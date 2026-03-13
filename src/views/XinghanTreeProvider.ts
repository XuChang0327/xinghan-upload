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

/** 设备文件树节点：容器 或 设备文件（仅用于「星瀚控制器」栏） */
export type DeviceFileTreeNode =
  | { kind: "container"; container: string }
  | { kind: "deviceFile"; container: string; name: string; size: string };

const ACTION_ITEMS: ActionItemNode[] = [
  { id: "run", label: "运行", icon: "play", command: "xinghan.runOnDevice", tooltip: "在控制器上运行当前打开的文件" },
  { id: "stop", label: "停止", icon: "debug-stop", command: "xinghan.stopRunOnDevice", tooltip: "停止设备上正在运行的程序" },
  { id: "upload", label: "上传", icon: "cloud-upload", command: "xinghan.upload", tooltip: "上传当前文件到星瀚控制器" },
  { id: "wifi", label: "联网", icon: "radio-tower", command: "xinghan.connectWifi", tooltip: "向设备发送 WiFi 连接命令" },
  { id: "selectPort", label: "串口通信", icon: "plug", command: "xinghan.selectPortAndRepl", tooltip: "选择星瀚控制器端口并进入 REPL" },
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

/** 「星瀚控制器」栏依赖 */
export interface XinghanDeviceFilesTreeDeps {
  containers: string[];
  listDeviceFiles: (container: string) => Promise<DeviceFileInfo[]>;
}

/** 「星瀚控制器」栏：容器 -> 设备文件 */
export class XinghanDeviceFilesTreeProvider implements vscode.TreeDataProvider<DeviceFileTreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<DeviceFileTreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private deps: XinghanDeviceFilesTreeDeps) {}

  getTreeItem(element: DeviceFileTreeNode): vscode.TreeItem {
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
        arguments: [element.container, element.name],
      };
    }
    return item;
  }

  async getChildren(element?: DeviceFileTreeNode): Promise<DeviceFileTreeNode[]> {
    if (!element) {
      return this.deps.containers.map((container) => ({ kind: "container" as const, container }));
    }
    if (element.kind !== "container") return [];

    try {
      const files = await this.deps.listDeviceFiles(element.container);
      const pyFiles = files.filter((f) => f.name.toLowerCase().endsWith(".py"));
      if (pyFiles.length === 0) {
        return [{ kind: "deviceFile", container: element.container, name: "（空）", size: "0" }];
      }
      return pyFiles.map((f) => ({
        kind: "deviceFile" as const,
        container: element.container,
        name: f.name,
        size: f.size,
      }));
    } catch {
      return [{ kind: "deviceFile", container: element.container, name: "无法获取列表", size: "" }];
    }
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }
}
