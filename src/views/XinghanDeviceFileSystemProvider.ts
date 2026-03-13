import * as vscode from "vscode";

const SCHEME = "xinghan-device";

/** 从 xinghan-device URI 解析出 container 和 filename，例如 /container1/main.py -> { container: 'container1', filename: 'main.py' } */
export function parseDeviceUri(uri: vscode.Uri): { container: string; filename: string } | null {
  if (uri.scheme !== SCHEME) return null;
  const path = uri.path.replace(/^\/+/, "");
  const i = path.indexOf("/");
  if (i <= 0) return null;
  const container = path.slice(0, i);
  const filename = path.slice(i + 1).replace(/^\/+/, "");
  if (!container || !filename) return null;
  return { container, filename };
}

/** 构建设备文件 URI */
export function toDeviceUri(container: string, filename: string): vscode.Uri {
  return vscode.Uri.parse(`${SCHEME}:/${container}/${filename}`);
}

export type ReadDeviceFile = (container: string, filename: string) => Promise<Uint8Array>;
export type WriteDeviceFile = (container: string, filename: string, content: Uint8Array) => Promise<void>;

/** 虚拟文件系统：设备上的文件，支持在 IDE 中打开与保存回设备 */
export class XinghanDeviceFileSystemProvider implements vscode.FileSystemProvider {
  private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this._emitter.event;

  constructor(
    private doRead: ReadDeviceFile,
    private doWrite: WriteDeviceFile
  ) {}

  watch(_uri: vscode.Uri): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const parsed = parseDeviceUri(uri);
    if (!parsed) throw vscode.FileSystemError.FileNotFound(uri);
    return {
      type: vscode.FileType.File,
      ctime: 0,
      mtime: 0,
      size: 0,
    };
  }

  async readDirectory(_uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    return [];
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const parsed = parseDeviceUri(uri);
    if (!parsed) throw vscode.FileSystemError.FileNotFound(uri);
    return this.doRead(parsed.container, parsed.filename);
  }

  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    _options: { create: boolean; overwrite: boolean }
  ): Promise<void> {
    const parsed = parseDeviceUri(uri);
    if (!parsed) throw vscode.FileSystemError.FileNotFound(uri);
    await this.doWrite(parsed.container, parsed.filename, content);
  }

  createDirectory(_uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions();
  }

  delete(_uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions();
  }

  rename(_oldUri: vscode.Uri, _newUri: vscode.Uri, _options: { overwrite: boolean }): void {
    throw vscode.FileSystemError.NoPermissions();
  }
}

export const XINGHAN_DEVICE_SCHEME = SCHEME;
