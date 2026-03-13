#!/usr/bin/env python3
"""
星瀚控制器 (ESP32 MicroPython) 上传脚本。
供 Cursor/VSCode 插件调用：插件只做 UI，上传逻辑由此脚本完成。
依赖：pip install pyserial，且系统已安装 mpremote (pip install mpremote)。
"""
import os
import sys
import json
import subprocess
import tempfile
import serial.tools.list_ports


def list_ports():
    """列出所有串口，便于插件做端口选择。返回 [(device, description), ...]"""
    result = []
    for p in serial.tools.list_ports.comports():
        result.append({"device": p.device, "description": p.description or p.device})
    return result


def list_ports_xinghan():
    """
    仅列出符合星瀚控制器规则的端口：设备路径为 /dev/cu.usbmodem*（或含 usbmodem）。
    其他硬件不返回；若无则返回空列表。
    """
    result = []
    for p in serial.tools.list_ports.comports():
        device = p.device or ""
        desc = (p.description or "").lower()
        if "usbmodem" in device or "usbmodem" in desc:
            result.append({"device": p.device, "description": p.description or p.device})
    return result


def get_default_port():
    """自动获取优先使用的端口：Mac usbmodem > 常见 Linux/Windows 模式"""
    ports = list(serial.tools.list_ports.comports())
    for p in ports:
        if p.device.startswith("/dev/cu.usbmodem"):
            return p.device
    for p in ports:
        if "usbmodem" in p.device or "USB" in p.description or "ESP" in p.description:
            return p.device
    return ports[0].device if ports else None


CONTAINERS = ["container1", "container2", "container3", "container4", "container5"]


def clear_container(port, container):
    """
    清空容器中的所有文件。
    :param port: 串口
    :param container: 容器名
    :return: True 成功，False 失败
    """
    try:
        # 列出容器中的文件
        list_cmd = ["mpremote", "connect", port, "fs", "ls", f":{container}/"]
        result = subprocess.run(list_cmd, capture_output=True, text=True)
        if result.returncode != 0:
            return True  # 容器可能为空或不存在，不算错误
        
        # 解析文件列表并删除
        for line in result.stdout.strip().split("\n"):
            line = line.strip()
            if not line:
                continue
            parts = line.split()
            if len(parts) >= 2:
                filename = parts[1]
            elif len(parts) == 1:
                filename = parts[0]
            else:
                continue
            
            # 删除文件
            remote_path = f":{container}/{filename}"
            print(f"🗑 删除旧文件: {filename}")
            del_cmd = ["mpremote", "connect", port, "fs", "rm", remote_path]
            subprocess.run(del_cmd, capture_output=True, text=True)
        
        return True
    except Exception as e:
        print(f"⚠️ 清空容器时出错: {e}", file=sys.stderr)
        return False


def upload_file(local_file_path, port=None, container="container1"):
    """
    将本地文件烧录到硬件的指定容器文件夹中（会先清空容器中的旧文件）。
    :param local_file_path: 本地 .py 文件路径
    :param port: 串口，如 /dev/cu.usbmodemxxx 或 COM3；None 则自动检测
    :param container: 目标容器名，如 container1～container5
    :return: 0 成功，非 0 失败（便于插件根据 exit code 判断）
    """
    if container not in CONTAINERS:
        print(f"❌ 错误：容器名必须是 {CONTAINERS} 之一，当前为 '{container}'", file=sys.stderr)
        return 5

    if not os.path.exists(local_file_path):
        print(f"❌ 错误：找不到文件 '{local_file_path}'", file=sys.stderr)
        return 1

    if not port:
        port = get_default_port()
    if not port:
        print("❌ 错误：未检测到星瀚控制器！请检查 USB 线是否插好，或使用 --port 指定端口。", file=sys.stderr)
        return 2

    file_name = os.path.basename(local_file_path)
    remote_path = f":{container}/{file_name}"

    print(f"🔌 端口：{port}")
    
    # 先清空容器中的旧文件
    print(f"🧹 清空 {container} 中的旧文件...")
    clear_container(port, container)
    
    print(f"🚀 正在将 '{file_name}' 烧录到 {remote_path} ...")

    cmd = [
        "mpremote", "connect", port,
        "fs", "cp", local_file_path, remote_path,
        "+", "exec", "import machine; machine.soft_reset()",
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        print(f"✅ 烧录成功！已上传 {remote_path}。")
        if result.stdout:
            print(result.stdout.strip())
        return 0
    except subprocess.CalledProcessError as e:
        print("❌ 烧录失败！", file=sys.stderr)
        if "ENOENT" in (e.stderr or "") or "No such file or directory" in (e.stderr or ""):
            print(f"💡 提示：硬件上可能没有 '{container}' 文件夹。", file=sys.stderr)
            print(f"可先运行：mpremote connect {port} fs mkdir {container}", file=sys.stderr)
        else:
            print((e.stderr or e.stdout or str(e)).strip(), file=sys.stderr)
        return 3
    except FileNotFoundError:
        print("❌ 错误：未找到 mpremote 命令，请安装：pip install mpremote", file=sys.stderr)
        return 4


def run_on_device(local_file_path, port=None):
    """
    在星瀚控制器上直接运行本地 .py 文件（不写入设备存储），输出实时显示。
    使用 mpremote run，适合在 Cursor 里「运行到设备」。
    :param local_file_path: 本地 .py 文件路径
    :param port: 串口；None 则自动检测
    :return: 0 成功，非 0 失败
    """
    if not os.path.exists(local_file_path):
        print(f"❌ 错误：找不到文件 '{local_file_path}'", file=sys.stderr)
        return 1

    if not port:
        port = get_default_port()
    if not port:
        print("❌ 错误：未检测到星瀚控制器！请检查 USB 线是否插好，或使用 --port 指定端口。", file=sys.stderr)
        return 2

    file_name = os.path.basename(local_file_path)
    print(f"🔌 端口：{port}")
    print(f"▶ 正在设备上运行 '{file_name}'（输出见下方）...", flush=True)
    print("-" * 40, flush=True)

    cmd = ["mpremote", "connect", port, "run", local_file_path]

    try:
        result = subprocess.run(cmd)
        return result.returncode if result.returncode is not None else 0
    except FileNotFoundError:
        print("❌ 错误：未找到 mpremote 命令，请安装：pip install mpremote", file=sys.stderr)
        return 4


def list_files(container, port=None):
    """
    列出星瀚控制器上指定容器中的文件（JSON 输出，供插件使用）。
    :param container: 容器名，如 container1～container5
    :param port: 串口；None 则自动检测
    :return: 0 成功，非 0 失败
    """
    if container not in CONTAINERS:
        print(f"❌ 错误：容器名必须是 {CONTAINERS} 之一", file=sys.stderr)
        return 5

    if not port:
        port = get_default_port()
    if not port:
        print("❌ 错误：未检测到星瀚控制器！", file=sys.stderr)
        return 2

    cmd = ["mpremote", "connect", port, "fs", "ls", f":{container}/"]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        files = []
        for line in result.stdout.strip().split("\n"):
            line = line.strip()
            if not line:
                continue
            parts = line.split()
            if len(parts) >= 2:
                size = parts[0]
                name = parts[1]
                files.append({"name": name, "size": size})
            elif len(parts) == 1:
                files.append({"name": parts[0], "size": "?"})
        print(json.dumps(files, ensure_ascii=False))
        return 0
    except subprocess.CalledProcessError as e:
        print(f"❌ 列出文件失败：{e.stderr or e.stdout or str(e)}", file=sys.stderr)
        return 3
    except FileNotFoundError:
        print("❌ 错误：未找到 mpremote 命令，请安装：pip install mpremote", file=sys.stderr)
        return 4


def read_file(container, filename, port=None):
    """
    从星瀚控制器读取指定容器中的文件内容，输出到 stdout（供插件在 IDE 中打开）。
    :param container: 容器名
    :param filename: 文件名
    :param port: 串口；None 则自动检测
    :return: 0 成功，非 0 失败
    """
    if container not in CONTAINERS:
        print(f"❌ 错误：容器名必须是 {CONTAINERS} 之一", file=sys.stderr)
        return 5

    if not port:
        port = get_default_port()
    if not port:
        print("❌ 错误：未检测到星瀚控制器！", file=sys.stderr)
        return 2

    remote_path = f":{container}/{filename}"
    cmd = ["mpremote", "connect", port, "fs", "cat", remote_path]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        if result.stdout:
            print(result.stdout, end="")
        return 0
    except subprocess.CalledProcessError as e:
        print(f"❌ 读取失败：{e.stderr or e.stdout or str(e)}", file=sys.stderr)
        return 3
    except FileNotFoundError:
        print("❌ 错误：未找到 mpremote 命令，请安装：pip install mpremote", file=sys.stderr)
        return 4


def write_file(container, filename, content, port=None):
    """
    将内容写入星瀚控制器指定容器的文件（不清空容器，仅覆盖该文件）。
    :param container: 容器名
    :param filename: 文件名
    :param content: 文件内容（字符串）
    :param port: 串口；None 则自动检测
    :return: 0 成功，非 0 失败
    """
    if container not in CONTAINERS:
        print(f"❌ 错误：容器名必须是 {CONTAINERS} 之一", file=sys.stderr)
        return 5

    if not port:
        port = get_default_port()
    if not port:
        print("❌ 错误：未检测到星瀚控制器！", file=sys.stderr)
        return 2

    remote_path = f":{container}/{filename}"
    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False, encoding="utf-8") as f:
        f.write(content)
        tmp = f.name
    try:
        cmd = ["mpremote", "connect", port, "fs", "cp", tmp, remote_path]
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return 0
    except subprocess.CalledProcessError as e:
        print(f"❌ 写入失败：{e.stderr or e.stdout or str(e)}", file=sys.stderr)
        return 3
    except FileNotFoundError:
        print("❌ 错误：未找到 mpremote 命令，请安装：pip install mpremote", file=sys.stderr)
        return 4
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def delete_file(container, filename, port=None):
    """
    删除星瀚控制器上指定容器中的文件。
    :param container: 容器名
    :param filename: 要删除的文件名
    :param port: 串口；None 则自动检测
    :return: 0 成功，非 0 失败
    """
    if container not in CONTAINERS:
        print(f"❌ 错误：容器名必须是 {CONTAINERS} 之一", file=sys.stderr)
        return 5

    if not port:
        port = get_default_port()
    if not port:
        print("❌ 错误：未检测到星瀚控制器！", file=sys.stderr)
        return 2

    remote_path = f":{container}/{filename}"
    print(f"🔌 端口：{port}")
    print(f"🗑 正在删除 {remote_path} ...")

    cmd = ["mpremote", "connect", port, "fs", "rm", remote_path]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        print(f"✅ 已删除 {remote_path}")
        return 0
    except subprocess.CalledProcessError as e:
        print(f"❌ 删除失败：{e.stderr or e.stdout or str(e)}", file=sys.stderr)
        return 3
    except FileNotFoundError:
        print("❌ 错误：未找到 mpremote 命令，请安装：pip install mpremote", file=sys.stderr)
        return 4


def wifi_connect(ssid, password, auth_mode=3, port=None):
    """
    连接星瀚控制器到指定 WiFi。
    :param ssid: WiFi 名称
    :param password: WiFi 密码
    :param auth_mode: 认证模式（默认 3）
    :param port: 串口；None 则自动检测
    :return: 0 成功，非 0 失败
    """
    if not port:
        port = get_default_port()
    if not port:
        print("❌ 错误：未检测到星瀚控制器！", file=sys.stderr)
        return 2

    print(f"🔌 端口：{port}")
    print(f"📶 正在连接 WiFi: {ssid} ...")

    wifi_code = f'''
import wifi
def on_connect(result):
    print("WiFi 连接结果:", result)
wifi.connect("{ssid}", "{password}", {auth_mode}, on_connect)
'''

    cmd = ["mpremote", "connect", port, "exec", wifi_code]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.stdout:
            print(result.stdout.strip())
        if result.stderr:
            print(result.stderr.strip(), file=sys.stderr)
        if result.returncode == 0:
            print(f"✅ WiFi 连接命令已发送")
        return result.returncode or 0
    except subprocess.TimeoutExpired:
        print("⏱ 连接超时，请检查 WiFi 信息是否正确", file=sys.stderr)
        return 6
    except FileNotFoundError:
        print("❌ 错误：未找到 mpremote 命令，请安装：pip install mpremote", file=sys.stderr)
        return 4


def soft_reset(port=None):
    """
    向设备发送软复位，使设备上正在运行的程序停止并重启。
    用于「停止」时真正停止设备端执行。
    :param port: 串口；None 则自动检测
    :return: 0 成功，非 0 失败
    """
    if not port:
        port = get_default_port()
    if not port:
        print("❌ 错误：未检测到星瀚控制器！", file=sys.stderr)
        return 2
    cmd = ["mpremote", "connect", port, "exec", "import machine; machine.soft_reset()"]
    try:
        subprocess.run(cmd, capture_output=True, text=True, timeout=5)
        return 0
    except subprocess.TimeoutExpired:
        return 3
    except FileNotFoundError:
        return 4
    except Exception:
        return 3


def main():
    import argparse
    parser = argparse.ArgumentParser(description="上传/运行/删除 .py 文件到星瀚控制器 (ESP32 MicroPython)")
    parser.add_argument("file", nargs="?", help="要上传或运行的本地 .py 文件路径")
    parser.add_argument("--port", "-p", help="串口（如 /dev/cu.usbmodem1234 或 COM3）")
    parser.add_argument("--container", "-c", choices=CONTAINERS, default="container1",
                        help="目标容器：container1～container5")
    parser.add_argument("--list-ports", "-l", action="store_true", help="列出可用串口（JSON）")
    parser.add_argument("--list-ports-xinghan", action="store_true", help="仅列出星瀚控制器端口（/dev/cu.usbmodem*，JSON）")
    parser.add_argument("--list-files", action="store_true", help="列出指定容器中的文件（JSON）")
    parser.add_argument("--read-file", metavar="FILENAME", help="从设备读取文件内容到 stdout")
    parser.add_argument("--write-file", metavar="FILENAME", help="从 stdin 读取内容并写入设备（覆盖该文件）")
    parser.add_argument("--delete", "-d", metavar="FILENAME", help="删除指定容器中的文件")
    parser.add_argument("--run", "-r", action="store_true", help="在设备上直接运行文件（不写入设备存储）")
    parser.add_argument("--soft-reset", action="store_true", help="向设备发送软复位（停止设备上正在运行的程序）")
    parser.add_argument("--wifi", nargs=2, metavar=("SSID", "PASSWORD"), help="连接 WiFi：--wifi <名称> <密码>")
    parser.add_argument("--wifi-auth", type=int, default=3, help="WiFi 认证模式（默认 3）")
    args = parser.parse_args()

    if args.list_ports:
        ports = list_ports()
        print(json.dumps(ports, ensure_ascii=False))
        return 0

    if args.list_ports_xinghan:
        ports = list_ports_xinghan()
        print(json.dumps(ports, ensure_ascii=False))
        return 0

    if args.list_files:
        return list_files(args.container, port=args.port)

    if args.read_file:
        return read_file(args.container, args.read_file, port=args.port)

    if args.write_file:
        content = sys.stdin.read()
        return write_file(args.container, args.write_file, content, port=args.port)

    if args.delete:
        return delete_file(args.container, args.delete, port=args.port)

    if args.wifi:
        ssid, password = args.wifi
        return wifi_connect(ssid, password, auth_mode=args.wifi_auth, port=args.port)

    if args.soft_reset:
        return soft_reset(port=args.port)

    target_file = args.file or "main.py"
    if not os.path.isabs(target_file) and not os.path.exists(target_file):
        pass

    if args.run:
        return run_on_device(target_file, port=args.port)
    return upload_file(target_file, port=args.port, container=args.container)


if __name__ == "__main__":
    sys.exit(main() or 0)