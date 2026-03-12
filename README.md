# 星瀚上传 (xinghan-upload)

在 Cursor / VSCode 中一键上传和运行代码到**星瀚控制器**（ESP32 MicroPython）。

## 功能

- **星瀚: 上传当前文件到控制器**：选择目标容器（container1～container5），自动清空容器旧文件后上传新文件并软重启。
- **星瀚: 在控制器上运行当前文件**：不写入设备存储，直接在设备上运行当前文件并实时显示输出。再次执行会先停止当前运行，再运行新脚本。
- **星瀚: 停止设备上的运行**：终止当前在设备上运行的程序，释放串口。
- **星瀚: 删除控制器上的文件**：选择容器，列出文件，选择并删除。
- **星瀚: 连接 WiFi**：选择预设 WiFi 或手动输入，让控制器连接指定网络。
- **星瀚: 列出可用串口**：列出本机串口并可复制到剪贴板。
- **状态栏快捷按钮**：底部状态栏显示「星瀚上传」和「星瀚运行」按钮，点击即可操作。

## 安装

### 方式一：从 VSIX 文件安装（推荐）

1. 下载 `.vsix` 文件（或自行打包，见下方「打包」部分）
2. 在 Cursor/VSCode 中：
   - 按 `Cmd+Shift+P`（Mac）或 `Ctrl+Shift+P`（Win/Linux）
   - 输入 **Extensions: Install from VSIX...**
   - 选择下载的 `.vsix` 文件
3. 重新加载窗口后即可使用

### 方式二：开发调试

1. 克隆或下载本插件源码
2. 在 Cursor/VSCode 中打开插件目录
3. 运行 `npm install` 安装依赖
4. 按 **F5** 启动扩展开发主机
5. 在弹出的新窗口中测试插件功能

## 环境要求

本机需安装以下依赖：

- **Python 3**
- **pyserial** 和 **mpremote**（首次使用时插件会自动检测并提示安装）

如需手动安装：`pip install pyserial mpremote`

星瀚控制器通过 USB 连接后，Mac 上一般显示为 `/dev/cu.usbmodem*`，Windows 上为 `COM*`。

## 配置（可选）

在设置中搜索「星瀚」可配置以下选项：

| 配置项 | 说明 | 默认 |
|--------|------|------|
| `xinghan.pythonPath` | Python 解释器路径 | `python3` |
| `xinghan.serialPort` | 指定串口（如 `/dev/cu.usbmodem123`、`COM3`），留空则自动检测 | 空 |
| `xinghan.wifiPresets` | 预设的常用 WiFi 列表（数组），每项包含 `name`、`password`、`authMode` | 见下方示例 |

## 使用

1. 打开要上传或运行的 `.py` 文件
2. 按 `Cmd+Shift+P`（Mac）或 `Ctrl+Shift+P`（Win/Linux）
3. 输入 **星瀚** 并选择相应命令
4. 输出在「输出」面板的「星瀚上传」通道查看

## 打包

```bash
npm install
npm run package
```

会在当前目录生成 `xinghan-upload-x.x.x.vsix` 文件，可分发给其他人安装。

## 开发

```bash
npm install
npm run compile
```

按 **F5** 启动扩展开发主机进行调试。

## 更新日志

### v0.6.0
- 首次使用时自动检测 Python 依赖（pyserial、mpremote）
- 若缺少依赖，提示用户一键自动安装
- 发布到 Open VSX 插件市场，Cursor/Trae 用户可直接搜索安装

### v0.5.0
- 状态栏新增「星瀚停止」按钮
- 调整状态栏按钮顺序：运行 | 停止 | 上传
- 优化按钮优先级，避免被其他扩展插入分隔

### v0.4.0
- 上传代码时自动清空容器中的旧文件，确保每个容器只保留一个程序

### v0.3.0
- 新增状态栏快捷按钮（上传、运行），启动后自动显示
- 修改为启动时自动激活插件

### v0.2.0
- 修复打包问题，使用 esbuild 打包依赖
- 新增 WiFi 连接功能（支持预设和手动输入）
- 新增删除控制器文件功能

### v0.1.0
- 初始版本
- 支持上传代码到控制器（container1～container5）
- 支持在控制器上直接运行代码
- 支持停止运行、列出串口

## License

MIT
