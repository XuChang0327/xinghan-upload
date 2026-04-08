import * as vscode from "vscode";

const SCHEME = "xinghan-device";

/** 端口写入路径首段：不能用 encodeURIComponent(port) 直接拼进 URI，否则 %2F 解码后路径会以 // 开头，触发 UriError */
function encodePortSegment(port: string): string {
  return Buffer.from(port, "utf8").toString("base64url");
}

function decodePortSegment(segment: string): string | null {
  try {
    const decoded = Buffer.from(segment, "base64url").toString("utf8");
    if (decoded.length > 0) return decoded;
  } catch {
    // ignore
  }
  try {
    const legacy = decodeURIComponent(segment);
    if (legacy.length > 0) return legacy;
  } catch {
    // ignore
  }
  return null;
}

/** 从 xinghan-device URI 解析出 port、container、filename，路径格式 /{base64url(port)}/{container}/{filename} */
export function parseDeviceUri(uri: vscode.Uri): { port: string; container: string; filename: string } | null {
  if (uri.scheme !== SCHEME) return null;
  const path = uri.path.replace(/^\/+/, "");
  const parts = path.split("/").filter(Boolean);
  if (parts.length < 3) return null;
  const port = decodePortSegment(parts[0]);
  const container = parts[1];
  const filename = parts.slice(2).join("/");
  if (!port || !container || !filename) return null;
  return { port, container, filename };
}

/** 构建设备文件 URI（含 port，以支持多设备） */
export function toDeviceUri(port: string, container: string, filename: string): vscode.Uri {
  const seg = encodePortSegment(port);
  return vscode.Uri.from({
    scheme: SCHEME,
    path: `/${seg}/${container}/${filename}`,
  });
}

export type ReadDeviceFile = (port: string, container: string, filename: string) => Promise<Uint8Array>;
export type WriteDeviceFile = (port: string, container: string, filename: string, content: Uint8Array) => Promise<void>;

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
    return this.doRead(parsed.port, parsed.container, parsed.filename);
  }

  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    _options: { create: boolean; overwrite: boolean }
  ): Promise<void> {
    const parsed = parseDeviceUri(uri);
    if (!parsed) throw vscode.FileSystemError.FileNotFound(uri);
    await this.doWrite(parsed.port, parsed.container, parsed.filename, content);
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
