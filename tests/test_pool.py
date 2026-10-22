"""The season's worker pool starts clean: its workers hold none of the server's sockets. (A
forked worker kept the browser's keep-alive connections open after the server closed them, so
the page's next requests went to a socket nobody read and the page hung on Advance.) Linux
only: elsewhere workers are always spawned. (Run as a file: multiprocessing on Windows.)"""
import os
import socket
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))   # the project root, so `import season` works from here
import season


def socket_inodes(_=None) -> set:
    """The socket inodes this process holds open."""
    out = set()
    for fd in os.listdir("/proc/self/fd"):
        try:
            target = os.readlink(f"/proc/self/fd/{fd}")
        except OSError:
            continue
        if target.startswith("socket:["):
            out.add(target)
    return out


if __name__ == "__main__":
    if not os.path.isdir("/proc/self/fd"):
        print("pool ok (skipped: no /proc)")
        raise SystemExit(0)
    os.environ["SIM_WORKERS"] = "2"
    held = socket.socket()                 # stands in for a browser's keep-alive connection
    held.bind(("127.0.0.1", 0))
    held.listen()
    mine = os.readlink(f"/proc/self/fd/{held.fileno()}")
    pool = season._make_pool()
    try:
        assert pool is not None, "SIM_WORKERS=2 gave no pool"
        theirs = set().union(*pool.map(socket_inodes, range(4)))
        assert mine not in theirs, "a worker inherited the server's socket"
    finally:
        pool.terminate()
        pool.join()
        held.close()
    print("pool ok: workers hold none of the server's sockets")
