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
import serial
import serial.tools.list_ports


def list_ports():
    """列出所有串口，便于插件做端口选择。返回 [(device, description), ...]"""
    result = []
    for p in serial.tools.list_ports.comports():
        result.append({"device": p.device, "description": p.description or p.device})
    return result


def _short_display_for_device(device):
    """从完整设备路径得到简短展示名，如 /dev/cu.usbmodem14101 -> 14101"""
    if not device:
        return device
    if "usbmodem" in device:
        idx = device.rfind("usbmodem")
        suffix = device[idx + len("usbmodem"):]
        return suffix if suffix else device.split("/")[-1]
    return device.split("/")[-1] if "/" in device else device


def read_xinghan_device_id(port, timeout=2):
    """读取星瀚设备唯一编号；失败时返回 None，不影响串口枚举。"""
    if not port:
        return None
    cmd = [
        "mpremote", "connect", port,
        "exec", "import r2; print(r2.device_id())",
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except (subprocess.TimeoutExpired, FileNotFoundError, Exception):
        return None
    if result.returncode != 0:
        return None
    lines = [line.strip() for line in (result.stdout or "").splitlines() if line.strip()]
    if not lines:
        return None
    for line in reversed(lines):
        if line.startswith("ybc-") or "-r2-" in line:
            return line
    return lines[-1]


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


def list_ports_xinghan_with_serial():
    """
    列出星瀚控制器端口，并带设备 ID、简短展示名与 USB 序列号。
    返回 [{"device", "display", "serial_number", "device_id"}, ...]，device_id/serial_number 可能为 None。
    """
    result = []
    for p in serial.tools.list_ports.comports():
        device = p.device or ""
        desc = (p.description or "").lower()
        if "usbmodem" not in device and "usbmodem" not in desc:
            continue
        display = _short_display_for_device(device)
        serial_number = getattr(p, "serial_number", None) if hasattr(p, "serial_number") else None
        if serial_number is not None and not isinstance(serial_number, str):
            serial_number = str(serial_number) if serial_number else None
        device_id = read_xinghan_device_id(device)
        result.append({
            "device": device,
            "display": display,
            "serial_number": serial_number,
            "device_id": device_id,
        })
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
            del_cmd = ["mpremote", "connect", port, "fs", "rm", remote_path]
            subprocess.run(del_cmd, capture_output=True, text=True)

        return True
    except Exception as e:
        print(f"⚠️ 清空容器时出错: {e}", file=sys.stderr)
        return False


def run_device_file(container, file_name, port=None):
    """
    在星瀚控制器上执行已写入设备存储的 .py 文件，输出实时显示。
    :param container: 容器名，如 container1～container5
    :param file_name: 设备上的文件名（不含路径）
    :param port: 串口；None 则自动检测
    :return: 0 成功，非 0 失败
    """
    if container not in CONTAINERS:
        print(f"❌ 错误：容器名必须是 {CONTAINERS} 之一，当前为 '{container}'", file=sys.stderr)
        return 5

    if not port:
        port = get_default_port()
    if not port:
        print("❌ 错误：未检测到星瀚控制器！请检查 USB 线是否插好，或使用 --port 指定端口。", file=sys.stderr)
        return 2

    device_path = f"{container}/{file_name}"
    exec_code = f"exec(open({json.dumps(device_path)}).read())"
    print(f"🔌 端口：{port}")
    print(f"▶ 正在设备上运行 '{device_path}'（输出见下方）...", flush=True)
    print("-" * 40, flush=True)

    cmd = ["mpremote", "connect", port, "exec", exec_code]

    try:
        result = subprocess.run(cmd)
        return result.returncode if result.returncode is not None else 0
    except FileNotFoundError:
        print("❌ 错误：未找到 mpremote 命令，请安装：pip install mpremote", file=sys.stderr)
        return 4


def upload_file(local_file_path, port=None, container="container1"):
    """
    将本地文件烧录到硬件的指定容器文件夹中（会先清空容器中的旧文件），不运行。
    :param local_file_path: 本地 .py 文件路径
    :param port: 串口，如 /dev/cu.usbmodemxxx 或 COM3；None 则自动检测
    :param container: 目标容器名，如 container1～container5
    :return: 0 成功，非 0 失败（便于插件根据 exit code 判断）
    """
    rc = _copy_to_container(local_file_path, port=port, container=container)
    if rc != 0:
        return rc
    return soft_reset(port=port)


def upload_and_monitor(local_file_path, port=None, container="container1"):
    """
    将本地文件烧录到硬件的指定容器文件夹中，soft_reset 后持续监听串口输出。
    """
    rc = _copy_to_container(local_file_path, port=port, container=container)
    if rc != 0:
        return rc
    rc = soft_reset(port=port)
    if rc != 0:
        return rc

    if not port:
        port = get_default_port()
    if not port:
        print("❌ 错误：未检测到星瀚控制器！", file=sys.stderr)
        return 2

    print("")
    print("📡 上传完成，正在监听串口输出...（点击「停止」按钮结束）", flush=True)
    print("-" * 40, flush=True)

    import time
    time.sleep(1)

    try:
        ser = serial.Serial(port, 115200, timeout=0.5)
        buf = b""
        while True:
            chunk = ser.read(ser.in_waiting or 1)
            if chunk:
                buf += chunk
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    text = line.decode("utf-8", errors="replace").rstrip("\r")
                    print(text, flush=True)
            elif buf:
                text = buf.decode("utf-8", errors="replace").rstrip("\r")
                print(text, flush=True)
                buf = b""
    except KeyboardInterrupt:
        pass
    except serial.SerialException as e:
        print(f"\n❌ 串口错误: {e}", file=sys.stderr)
        return 3
    finally:
        try:
            ser.close()
        except Exception:
            pass

    return 0


def upload_and_run_file(local_file_path, port=None, container="container1"):
    """
    将本地文件烧录到硬件的指定容器文件夹中（会先清空容器中的旧文件），并在设备上运行。
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
    rc = _copy_to_container(local_file_path, port=port, container=container)
    if rc != 0:
        return rc
    return run_device_file(container, file_name, port=port)


def _enter_raw_repl(ser):
    """进入 MicroPython raw REPL 模式，返回是否成功。"""
    ser.write(b"\x03")
    import time
    time.sleep(0.1)
    ser.write(b"\x03")
    time.sleep(0.1)
    ser.reset_input_buffer()
    ser.write(b"\x01")
    time.sleep(0.5)
    data = ser.read(ser.in_waiting or 1)
    return b"raw REPL" in data or b">" in data


def _raw_exec(ser, code, timeout=10):
    """在 raw REPL 中执行代码，返回 (stdout, stderr)。"""
    ser.write(code.encode("utf-8") + b"\x04")
    raw = b""
    import time
    deadline = time.time() + timeout
    while time.time() < deadline:
        chunk = ser.read(ser.in_waiting or 1)
        if chunk:
            raw += chunk
            if raw.count(b"\x04") >= 2:
                break
        else:
            time.sleep(0.01)
    ok_idx = raw.find(b"OK")
    if ok_idx == -1:
        return "", raw.decode("utf-8", errors="replace")
    after_ok = raw[ok_idx + 2:]
    parts = after_ok.split(b"\x04")
    stdout_part = parts[0].decode("utf-8", errors="replace") if len(parts) > 0 else ""
    stderr_part = parts[1].decode("utf-8", errors="replace") if len(parts) > 1 else ""
    return stdout_part, stderr_part


def _upload_with_progress(local_file_path, port, container, file_name):
    """通过 raw REPL 分块上传文件并显示进度，返回 0 成功，非 0 失败。"""
    import time
    import base64

    file_size = os.path.getsize(local_file_path)
    with open(local_file_path, "rb") as f:
        data = f.read()

    chunk_size = 512
    device_path = f"{container}/{file_name}"

    try:
        ser = serial.Serial(port, 115200, timeout=5)
    except serial.SerialException as e:
        print(f"❌ 无法打开串口 {port}: {e}", file=sys.stderr)
        return 3

    try:
        if not _enter_raw_repl(ser):
            print("❌ 无法进入 raw REPL 模式", file=sys.stderr)
            return 3

        _, err = _raw_exec(ser, "import ubinascii")
        if err:
            _, err = _raw_exec(ser, "import binascii as ubinascii")
            if err:
                print(f"❌ 设备缺少 ubinascii/binascii 模块: {err}", file=sys.stderr)
                return 3

        _, err = _raw_exec(ser, f"_f = open('{device_path}', 'wb')")
        if err:
            print(f"❌ 无法在设备上创建文件: {err}", file=sys.stderr)
            return 3

        sent = 0
        total_chunks = (len(data) + chunk_size - 1) // chunk_size
        for i in range(0, len(data), chunk_size):
            chunk = data[i:i + chunk_size]
            b64 = base64.b64encode(chunk).decode("ascii")
            _, err = _raw_exec(ser, f"_f.write(ubinascii.a2b_base64('{b64}'))")
            if err:
                print(f"\n❌ 写入数据时出错: {err}", file=sys.stderr)
                _raw_exec(ser, "_f.close()")
                return 3
            sent += len(chunk)
            pct = int(sent * 100 / file_size)
            print(f"##PROGRESS:{pct}##", flush=True)

        print()

        _, err = _raw_exec(ser, "_f.close()")
        if err:
            print(f"⚠️ 关闭文件时出错: {err}", file=sys.stderr)

        return 0
    finally:
        try:
            ser.write(b"\x02")
            time.sleep(0.1)
            ser.close()
        except Exception:
            pass


def _copy_to_container(local_file_path, port=None, container="container1"):
    """将本地文件写入指定容器（会先清空容器），不运行。"""
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

    print(f"🚀 正在烧录 '{file_name}' ...")

    # 先清空容器中的旧文件
    clear_container(port, container)

    rc = _upload_with_progress(local_file_path, port, container, file_name)
    if rc == 0:
        print(f"✅ 烧录成功！已上传到 {container}。")
    else:
        print("❌ 烧录失败！", file=sys.stderr)
    return rc


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


def _parse_ls_lines(stdout):
    """解析 mpremote fs ls 输出为 [{name, size}, ...]。"""
    files = []
    for line in stdout.strip().split("\n"):
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
    return files


def _list_container_files_meta(container, port):
    """
    列出指定容器中的文件元数据；port 可为 None 时内部自动检测。
    :return: [{"name", "size"}, ...]
    :raises: FileNotFoundError, CalledProcessError, ValueError, RuntimeError
    """
    if container not in CONTAINERS:
        raise ValueError(f"容器名必须是 {CONTAINERS} 之一")
    if not port:
        port = get_default_port()
    if not port:
        raise RuntimeError("未检测到星瀚控制器")
    cmd = ["mpremote", "connect", port, "fs", "ls", f":{container}/"]
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return _parse_ls_lines(result.stdout)


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

    try:
        files = _list_container_files_meta(container, port)
        print(json.dumps(files, ensure_ascii=False))
        return 0
    except subprocess.CalledProcessError as e:
        print(f"❌ 列出文件失败：{e.stderr or e.stdout or str(e)}", file=sys.stderr)
        return 3
    except FileNotFoundError:
        print("❌ 错误：未找到 mpremote 命令，请安装：pip install mpremote", file=sys.stderr)
        return 4
    except (ValueError, RuntimeError) as e:
        print(f"❌ {e}", file=sys.stderr)
        return 2


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


def _validate_device_py_filename(name):
    """重命名/校验用：返回 None 表示合法，否则返回错误说明字符串。"""
    if not name or name in ("（空）", "无法获取列表"):
        return "无效文件名"
    if name.strip() != name:
        return "文件名首尾不能有空格"
    if "/" in name or "\\" in name:
        return "文件名不能包含路径分隔符"
    if ".." in name:
        return "文件名不能包含 .."
    if not name.lower().endswith(".py"):
        return "仅支持 .py 文件"
    return None


def _read_file_text_for_rename(container, filename, port):
    """读取设备文件内容为字符串（供重命名复制）。"""
    remote_path = f":{container}/{filename}"
    cmd = ["mpremote", "connect", port, "fs", "cat", remote_path]
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return result.stdout if result.stdout is not None else ""


def rename_file(container, old_name, new_name, port=None):
    """
    将设备上同一容器内的文件改名（读 → 写新名 → 删旧名；mpremote 无 fs mv 时的等价实现）。
    :return: 0 成功，非 0 失败
    """
    err = _validate_device_py_filename(old_name) or _validate_device_py_filename(new_name)
    if err:
        print(f"❌ {err}", file=sys.stderr)
        return 5
    if old_name == new_name:
        print("✅ 名称未变化，跳过")
        return 0
    if container not in CONTAINERS:
        print(f"❌ 错误：容器名必须是 {CONTAINERS} 之一", file=sys.stderr)
        return 5
    if not port:
        port = get_default_port()
    if not port:
        print("❌ 错误：未检测到星瀚控制器！", file=sys.stderr)
        return 2

    try:
        meta = _list_container_files_meta(container, port)
        names = {f["name"] for f in meta}
        if old_name not in names:
            print(f"❌ 设备上不存在文件：{container}/{old_name}", file=sys.stderr)
            return 6
        if new_name in names:
            print(f"❌ 目标文件名已存在：{container}/{new_name}", file=sys.stderr)
            return 7
        content = _read_file_text_for_rename(container, old_name, port)
        print(f"🔌 端口：{port}")
        print(f"✏ 正在重命名 {container}/{old_name} → {new_name} ...")
        w = write_file(container, new_name, content, port=port)
        if w != 0:
            return w
        d = delete_file(container, old_name, port=port)
        if d != 0:
            print("⚠️ 新文件已写入但删除旧文件失败，请手动删除重复文件或查看输出。", file=sys.stderr)
            return d
        print(f"✅ 已重命名为 {container}/{new_name}")
        return 0
    except subprocess.CalledProcessError as e:
        print(f"❌ 重命名失败：{e.stderr or e.stdout or str(e)}", file=sys.stderr)
        return 3
    except FileNotFoundError:
        print("❌ 错误：未找到 mpremote 命令，请安装：pip install mpremote", file=sys.stderr)
        return 4
    except (ValueError, RuntimeError) as e:
        print(f"❌ {e}", file=sys.stderr)
        return 2


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
    parser.add_argument("--list-ports-xinghan-with-mac", action="store_true",
                        help="列出星瀚控制器端口并带序列号（JSON：device, display, serial_number）")
    parser.add_argument("--list-files", action="store_true", help="列出指定容器中的文件（JSON）")
    parser.add_argument("--read-file", metavar="FILENAME", help="从设备读取文件内容到 stdout")
    parser.add_argument("--write-file", metavar="FILENAME", help="从 stdin 读取内容并写入设备（覆盖该文件）")
    parser.add_argument("--delete", "-d", metavar="FILENAME", help="删除指定容器中的文件")
    parser.add_argument("--rename", nargs=2, metavar=("OLD", "NEW"), help="在同一容器内重命名 .py 文件：旧名 新名")
    parser.add_argument("--run", "-r", action="store_true", help="在设备上直接运行文件（不写入设备存储）")
    parser.add_argument("--upload-and-run", action="store_true", help="上传到容器后在设备上运行")
    parser.add_argument("--upload-and-monitor", action="store_true", help="上传到容器后监听串口输出")
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

    if args.list_ports_xinghan_with_mac:
        ports = list_ports_xinghan_with_serial()
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

    if args.rename:
        old_n, new_n = args.rename
        return rename_file(args.container, old_n, new_n, port=args.port)

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
    if args.upload_and_run:
        return upload_and_run_file(target_file, port=args.port, container=args.container)
    if args.upload_and_monitor:
        return upload_and_monitor(target_file, port=args.port, container=args.container)
    return upload_file(target_file, port=args.port, container=args.container)


if __name__ == "__main__":
    sys.exit(main() or 0)