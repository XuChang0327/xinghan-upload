#!/usr/bin/env python3
"""
星瀚控制器 BLE NUS 客户端。

插件通过本脚本访问 Nordic UART Service：
- 扫描蓝牙设备
- 通过 NUS 文本透传向 MicroPython REPL 发送命令
- 上传文件、运行文件、停止程序

设备端需将 NUS RX/TX 接入控制器 REPL 或等价文本命令处理器。
"""
import argparse
import asyncio
import base64
import json
import os
import sys
import time
from typing import List, Optional

NUS_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
NUS_RX_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
NUS_TX_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"

DEFAULT_BLE_WRITE_SIZE = 20
DEFAULT_FILE_CHUNK_SIZE = 128
REPL_COMMAND_DELAY = 0.08
UPLOAD_REPL_COMMAND_DELAY = 0.015
CAPTURE_BEGIN = "__XINGHAN_BEGIN__"
CAPTURE_END = "__XINGHAN_END__"


def _load_bleak():
    try:
        from bleak import BleakClient, BleakScanner
        return BleakClient, BleakScanner
    except ImportError:
        print("ERROR: 缺少 Python 依赖 bleak，请安装：python3 -m pip install bleak", file=sys.stderr)
        return None, None


def _remote_path(container: str, filename: str) -> str:
    safe_name = os.path.basename(filename)
    return f"{container}/{safe_name}"


async def scan_devices(name_prefix: str, timeout: float) -> int:
    _, BleakScanner = _load_bleak()
    if BleakScanner is None:
        return 4
    target = f"名称前缀 {name_prefix}" if name_prefix.strip() else "全部 BLE 设备"
    print(f"正在扫描{target}，预计 {timeout:.1f} 秒...", file=sys.stderr, flush=True)
    devices = await BleakScanner.discover(timeout=timeout)
    prefix = name_prefix.lower().strip()
    result = []
    for d in devices:
        name = d.name or ""
        if prefix and not name.lower().startswith(prefix):
            continue
        result.append({
            "name": name or "（未命名蓝牙设备）",
            "address": d.address,
            "rssi": getattr(d, "rssi", None),
        })
    print(f"扫描完成，匹配到 {len(result)} 个设备。", file=sys.stderr, flush=True)
    print(json.dumps(result, ensure_ascii=False))
    return 0


async def scan_devices_stream(name_prefix: str, timeout: float) -> int:
    """流式扫描：每发现一个新设备立即输出一行 JSON，扫描结束输出 __SCAN_DONE__"""
    _, BleakScanner = _load_bleak()
    if BleakScanner is None:
        return 4
    prefix = name_prefix.lower().strip()
    seen_addresses = set()

    def on_detection(device, advertisement_data):
        if device.address in seen_addresses:
            return
        name = device.name or ""
        if prefix and not name.lower().startswith(prefix):
            return
        seen_addresses.add(device.address)
        entry = {
            "name": name or "（未命名蓝牙设备）",
            "address": device.address,
            "rssi": advertisement_data.rssi,
        }
        print(json.dumps(entry, ensure_ascii=False), flush=True)

    scanner = BleakScanner(detection_callback=on_detection)
    await scanner.start()
    await asyncio.sleep(timeout)
    await scanner.stop()
    print("__SCAN_DONE__", flush=True)
    return 0


class NusSession:
    def __init__(self, address: str, timeout: float):
        BleakClient, _ = _load_bleak()
        if BleakClient is None:
            raise RuntimeError("missing bleak")
        self.client = BleakClient(address)
        self.timeout = timeout
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._buffer = bytearray()
        self._write_size = DEFAULT_BLE_WRITE_SIZE

    async def __aenter__(self):
        await self.client.connect()
        mtu = self.client.mtu_size
        if mtu and mtu > 3:
            self._write_size = min(mtu - 3, 512)
        await self.client.start_notify(NUS_TX_UUID, self._on_notify)
        return self

    async def __aexit__(self, exc_type, exc, tb):
        try:
            await self.client.stop_notify(NUS_TX_UUID)
        except Exception:
            pass
        await self.client.disconnect()

    def _on_notify(self, _sender, data: bytearray):
        self._buffer.extend(data)
        while b"\n" in self._buffer:
            raw, _, rest = self._buffer.partition(b"\n")
            self._buffer = bytearray(rest)
            line = raw.decode("utf-8", errors="replace").strip()
            if line:
                self._queue.put_nowait(line)

    async def write_text(self, text: str):
        data = text.encode("utf-8")
        for i in range(0, len(data), self._write_size):
            await self.client.write_gatt_char(NUS_RX_UUID, data[i:i + self._write_size], response=True)

    async def write_line(self, line: str):
        await self.write_text(line + "\n")

    async def write_repl_line(self, line: str, delay: float = REPL_COMMAND_DELAY):
        await self.write_text(line + "\r\n")
        await asyncio.sleep(delay)

    async def interrupt(self):
        await self.write_text("\x03\x03\r\n")
        await asyncio.sleep(0.3)

    async def request(self, line: str, expect_ack: bool = True) -> List[str]:
        await self.write_line(line)
        if not expect_ack:
            return []
        lines: List[str] = []
        while True:
            try:
                item = await asyncio.wait_for(self._queue.get(), timeout=self.timeout)
            except asyncio.TimeoutError:
                raise TimeoutError(f"等待设备响应超时：{line}")
            print(item, file=sys.stderr, flush=True)
            lines.append(item)
            if item.startswith("OK"):
                return lines
            if item.startswith("ERR"):
                raise RuntimeError(item)

    async def drain_logs(self, seconds: float, silent: bool = False):
        end_at = asyncio.get_running_loop().time() + seconds
        while asyncio.get_running_loop().time() < end_at:
            timeout = max(0.1, min(1.0, end_at - asyncio.get_running_loop().time()))
            try:
                item = await asyncio.wait_for(self._queue.get(), timeout=timeout)
                if not silent:
                    print(item, flush=True)
            except asyncio.TimeoutError:
                continue

    async def capture_repl_output(self, lines: List[str]) -> List[str]:
        await self.interrupt()
        for line in lines:
            await self.write_repl_line(line)

        captured: List[str] = []
        is_capturing = False
        end_at = asyncio.get_running_loop().time() + self.timeout
        while asyncio.get_running_loop().time() < end_at:
            timeout = max(0.1, min(1.0, end_at - asyncio.get_running_loop().time()))
            try:
                item = await asyncio.wait_for(self._queue.get(), timeout=timeout)
            except asyncio.TimeoutError:
                continue
            print(item, flush=True)
            if item == CAPTURE_BEGIN:
                is_capturing = True
                captured = []
                continue
            if item == CAPTURE_END and is_capturing:
                return captured
            if is_capturing:
                captured.append(item)
        raise TimeoutError("等待设备返回文件管理结果超时")


async def hello(address: str, timeout: float) -> int:
    try:
        async with NusSession(address, timeout) as session:
            lines = await session.request("HELLO")
            print(json.dumps({"ok": True, "response": lines}, ensure_ascii=False))
        return 0
    except Exception as e:
        print(f"ERROR: 蓝牙 HELLO 失败：{e}", file=sys.stderr)
        return 3


async def connect_check(address: str, timeout: float) -> int:
    try:
        async with NusSession(address, timeout):
            print("OK 蓝牙 NUS 已连接")
        return 0
    except Exception as e:
        print(f"ERROR: 蓝牙 NUS 连接失败：{e}", file=sys.stderr)
        return 3


async def stop(address: str, timeout: float) -> int:
    try:
        async with NusSession(address, timeout) as session:
            await session.interrupt()
            await session.write_repl_line("import machine; machine.soft_reset()")
            await session.drain_logs(1.0)
        return 0
    except Exception as e:
        print(f"ERROR: 蓝牙停止失败：{e}", file=sys.stderr)
        return 3


async def upload_file(address: str, file_path: str, container: str, timeout: float, remote_name: Optional[str] = None) -> str:
    if not os.path.exists(file_path):
        raise FileNotFoundError(file_path)
    file_size = os.path.getsize(file_path)
    remote_path = _remote_path(container, remote_name or os.path.basename(file_path))
    async with NusSession(address, timeout) as session:
        await session.interrupt()
        await session.write_repl_line("import uos, ubinascii")
        await session.write_repl_line(f"_d = {json.dumps(container)}")
        await session.write_repl_line("uos.mkdir(_d) if _d not in uos.listdir() else None")
        await session.write_repl_line(f"_f = open({json.dumps(remote_path)}, 'wb')")
        total = 0
        with open(file_path, "rb") as f:
            while True:
                chunk = f.read(DEFAULT_FILE_CHUNK_SIZE)
                if not chunk:
                    break
                encoded = base64.b64encode(chunk).decode("ascii")
                await session.write_repl_line(
                    f"_ = _f.write(ubinascii.a2b_base64({json.dumps(encoded)}))",
                    delay=UPLOAD_REPL_COMMAND_DELAY,
                )
                total += len(chunk)
                if file_size > 0:
                    pct = min(99, int(total * 100 / file_size))
                    print(f"##PROGRESS:{pct}##", flush=True)
        await session.write_repl_line("_f.close()")
        await session.write_repl_line(f"print({json.dumps('OK 上传完成：' + remote_path)})")
        await session.drain_logs(1.0, silent=True)
    print("##PROGRESS:100##", flush=True)
    return remote_path


async def write_content(address: str, container: str, filename: str, content: bytes, timeout: float) -> str:
    remote_path = _remote_path(container, filename)
    async with NusSession(address, timeout) as session:
        await session.interrupt()
        await session.write_repl_line("import uos, ubinascii")
        await session.write_repl_line(f"_d = {json.dumps(container)}")
        await session.write_repl_line("uos.mkdir(_d) if _d not in uos.listdir() else None")
        await session.write_repl_line(f"_f = open({json.dumps(remote_path)}, 'wb')")
        for i in range(0, len(content), DEFAULT_FILE_CHUNK_SIZE):
            encoded = base64.b64encode(content[i:i + DEFAULT_FILE_CHUNK_SIZE]).decode("ascii")
            await session.write_repl_line(
                f"_ = _f.write(ubinascii.a2b_base64({json.dumps(encoded)}))",
                delay=UPLOAD_REPL_COMMAND_DELAY,
            )
        await session.write_repl_line("_f.close()")
        await session.write_repl_line(f"print({json.dumps('OK 写入完成：' + remote_path)})")
        await session.drain_logs(1.0, silent=True)
    return remote_path


async def upload(address: str, file_path: str, container: str, timeout: float) -> int:
    try:
        remote_path = await upload_file(address, file_path, container, timeout)
        print(f"OK 上传完成：{remote_path}")
        return 0
    except Exception as e:
        print(f"ERROR: 蓝牙上传失败：{e}", file=sys.stderr)
        return 3


async def upload_and_run(address: str, file_path: str, container: str, timeout: float, log_seconds: float) -> int:
    try:
        remote_path = await upload_file(address, file_path, container, timeout)
        print(f"OK 上传完成：{remote_path}，正在运行…")
        async with NusSession(address, timeout) as session:
            await session.interrupt()
            await session.write_repl_line(f"exec(open({json.dumps(remote_path)}).read())")
            await session.drain_logs(log_seconds)
        return 0
    except Exception as e:
        print(f"ERROR: 蓝牙上传并运行失败：{e}", file=sys.stderr)
        return 3


async def list_files(address: str, container: str, timeout: float) -> int:
    try:
        async with NusSession(address, timeout) as session:
            lines = await session.capture_repl_output([
                "import uos",
                f"_d = {json.dumps(container)}",
                f"print({json.dumps(CAPTURE_BEGIN)})",
                "for _n in (uos.listdir(_d) if _d in uos.listdir() else []): print(_n + '\\t' + str(uos.stat(_d + '/' + _n)[6]))",
                f"print({json.dumps(CAPTURE_END)})",
            ])
        files = []
        for line in lines:
            if "\t" not in line:
                continue
            name, size = line.rsplit("\t", 1)
            files.append({"name": name, "size": size})
        print(json.dumps(files, ensure_ascii=False))
        return 0
    except Exception as e:
        print(f"ERROR: 蓝牙列出文件失败：{e}", file=sys.stderr)
        return 3


async def read_file(address: str, container: str, filename: str, timeout: float) -> int:
    try:
        remote_path = _remote_path(container, filename)
        async with NusSession(address, timeout) as session:
            lines = await session.capture_repl_output([
                "import ubinascii",
                f"_p = {json.dumps(remote_path)}",
                f"print({json.dumps(CAPTURE_BEGIN)})",
                "print(ubinascii.b2a_base64(open(_p, 'rb').read()).decode().strip())",
                f"print({json.dumps(CAPTURE_END)})",
            ])
        encoded = "".join(lines)
        sys.stdout.buffer.write(base64.b64decode(encoded.encode("ascii")))
        return 0
    except Exception as e:
        print(f"ERROR: 蓝牙读取文件失败：{e}", file=sys.stderr)
        return 3


async def write_file(address: str, container: str, filename: str, timeout: float) -> int:
    try:
        content = sys.stdin.buffer.read()
        await write_content(address, container, filename, content, timeout)
        return 0
    except Exception as e:
        print(f"ERROR: 蓝牙写入文件失败：{e}", file=sys.stderr)
        return 3


async def delete_file(address: str, container: str, filename: str, timeout: float) -> int:
    try:
        remote_path = _remote_path(container, filename)
        async with NusSession(address, timeout) as session:
            await session.interrupt()
            await session.write_repl_line("import uos")
            await session.write_repl_line(f"uos.remove({json.dumps(remote_path)})")
            await session.write_repl_line(f"print({json.dumps('OK 删除完成：' + remote_path)})")
            await session.drain_logs(1.0)
        return 0
    except Exception as e:
        print(f"ERROR: 蓝牙删除文件失败：{e}", file=sys.stderr)
        return 3


async def rename_file(address: str, container: str, old_name: str, new_name: str, timeout: float) -> int:
    try:
        old_path = _remote_path(container, old_name)
        new_path = _remote_path(container, new_name)
        async with NusSession(address, timeout) as session:
            await session.interrupt()
            await session.write_repl_line("import uos")
            await session.write_repl_line(f"uos.rename({json.dumps(old_path)}, {json.dumps(new_path)})")
            await session.write_repl_line(f"print({json.dumps('OK 重命名完成：' + new_path)})")
            await session.drain_logs(1.0)
        return 0
    except Exception as e:
        print(f"ERROR: 蓝牙重命名文件失败：{e}", file=sys.stderr)
        return 3


async def run_file(address: str, file_path: str, container: str, timeout: float, log_seconds: float) -> int:
    remote_name = "__xinghan_run.py"
    try:
        remote_path = await upload_file(address, file_path, container, timeout, remote_name=remote_name)
        async with NusSession(address, timeout) as session:
            await session.interrupt()
            await session.write_repl_line(f"exec(open({json.dumps(remote_path)}).read())")
            await session.drain_logs(log_seconds)
        return 0
    except Exception as e:
        print(f"ERROR: 蓝牙运行失败：{e}", file=sys.stderr)
        return 3


async def repl_mode(address: str, timeout: float) -> int:
    BleakClient, _ = _load_bleak()
    if BleakClient is None:
        return 4

    client = BleakClient(address)
    loop = asyncio.get_running_loop()

    def on_notify(_sender, data: bytearray):
        try:
            sys.stdout.buffer.write(data)
            sys.stdout.buffer.flush()
        except OSError:
            pass

    try:
        print(f"正在连接蓝牙设备 {address}...", file=sys.stderr, flush=True)
        await client.connect()
        await client.start_notify(NUS_TX_UUID, on_notify)
        print("蓝牙 REPL 已连接。Ctrl+] 退出。", file=sys.stderr, flush=True)

        await client.write_gatt_char(NUS_RX_UUID, b"\x03\x03\r\n", response=True)
        await asyncio.sleep(0.3)
        await client.write_gatt_char(NUS_RX_UUID, b"\x02", response=True)
        await asyncio.sleep(0.1)

        reader = asyncio.StreamReader()
        protocol = asyncio.StreamReaderProtocol(reader)
        await loop.connect_read_pipe(lambda: protocol, sys.stdin)

        while client.is_connected:
            try:
                data = await asyncio.wait_for(reader.read(128), timeout=0.5)
            except asyncio.TimeoutError:
                continue
            if not data:
                break
            if b"\x1d" in data:
                break
            for i in range(0, len(data), DEFAULT_BLE_WRITE_SIZE):
                chunk = data[i:i + DEFAULT_BLE_WRITE_SIZE]
                await client.write_gatt_char(NUS_RX_UUID, chunk, response=True)

        return 0
    except Exception as e:
        print(f"\nERROR: 蓝牙 REPL 连接失败：{e}", file=sys.stderr)
        return 3
    finally:
        try:
            await client.stop_notify(NUS_TX_UUID)
        except Exception:
            pass
        if client.is_connected:
            await client.disconnect()
        print("\n蓝牙 REPL 已断开。", file=sys.stderr, flush=True)


async def main_async(args) -> int:
    if args.scan:
        return await scan_devices(args.name_prefix, args.timeout)
    if args.scan_stream:
        return await scan_devices_stream(args.name_prefix, args.timeout)
    if not args.address:
        print("ERROR: 蓝牙操作需要 --address", file=sys.stderr)
        return 2
    if args.repl:
        return await repl_mode(args.address, args.timeout)
    if args.connect_check:
        return await connect_check(args.address, args.timeout)
    if args.hello:
        return await hello(args.address, args.timeout)
    if args.stop:
        return await stop(args.address, args.timeout)
    if args.list_files:
        return await list_files(args.address, args.container, args.timeout)
    if args.read_file:
        return await read_file(args.address, args.container, args.read_file, args.timeout)
    if args.write_file:
        return await write_file(args.address, args.container, args.write_file, args.timeout)
    if args.delete:
        return await delete_file(args.address, args.container, args.delete, args.timeout)
    if args.rename:
        old_name, new_name = args.rename
        return await rename_file(args.address, args.container, old_name, new_name, args.timeout)
    if args.upload:
        return await upload(args.address, args.upload, args.container, args.timeout)
    if args.upload_and_run:
        return await upload_and_run(args.address, args.upload_and_run, args.container, args.timeout, args.log_seconds)
    if args.run_file:
        return await run_file(args.address, args.run_file, args.container, args.timeout, args.log_seconds)
    print("ERROR: 未指定蓝牙操作", file=sys.stderr)
    return 2


def main() -> int:
    parser = argparse.ArgumentParser(description="星瀚 BLE NUS 客户端")
    parser.add_argument("--scan", action="store_true", help="扫描蓝牙设备并输出 JSON")
    parser.add_argument("--scan-stream", action="store_true", help="流式扫描：实时逐行输出发现的设备 JSON")
    parser.add_argument("--name-prefix", default="", help="按蓝牙名称前缀筛选设备")
    parser.add_argument("--address", help="BLE 设备地址/identifier")
    parser.add_argument("--repl", action="store_true", help="交互式 REPL 模式：保持 BLE 连接，stdin/stdout 双向透传")
    parser.add_argument("--connect-check", action="store_true", help="只检查 BLE/NUS 是否可连接，不发送协议命令")
    parser.add_argument("--hello", action="store_true", help="发送 HELLO")
    parser.add_argument("--stop", action="store_true", help="发送 STOP")
    parser.add_argument("--list-files", action="store_true", help="列出指定容器中的文件（JSON）")
    parser.add_argument("--read-file", metavar="FILENAME", help="从蓝牙设备读取文件内容到 stdout")
    parser.add_argument("--write-file", metavar="FILENAME", help="从 stdin 读取内容并写入蓝牙设备")
    parser.add_argument("--delete", metavar="FILENAME", help="删除指定容器中的文件")
    parser.add_argument("--rename", nargs=2, metavar=("OLD", "NEW"), help="在同一容器内重命名文件")
    parser.add_argument("--upload", metavar="FILE", help="通过蓝牙上传文件（不运行）")
    parser.add_argument("--upload-and-run", metavar="FILE", help="通过蓝牙上传文件并在设备上运行")
    parser.add_argument("--run-file", metavar="FILE", help="通过蓝牙上传临时文件后运行")
    parser.add_argument("--container", default="container1", help="目标容器，默认 container1")
    parser.add_argument("--timeout", type=float, default=8.0, help="BLE 操作超时时间")
    parser.add_argument("--log-seconds", type=float, default=5.0, help="运行命令后继续接收日志的秒数")
    args = parser.parse_args()
    return asyncio.run(main_async(args))


if __name__ == "__main__":
    sys.exit(main())
