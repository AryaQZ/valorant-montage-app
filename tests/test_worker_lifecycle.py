"""Worker lifetime checks using its real loopback server."""

import os
import socket
import subprocess
import sys
import tempfile
import textwrap
import time
import unittest


class WorkerLifecycleTests(unittest.TestCase):
    def test_worker_exits_when_its_desktop_parent_disappears(self) -> None:
        parent_code = textwrap.dedent("""
            import http.client, json, os, subprocess, sys
            env = {**os.environ, "VMS_WORKER_PARENT_PID": str(os.getpid())}
            worker = subprocess.Popen([sys.executable, "-m", "services.worker"], env=env,
                                      stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                      stderr=subprocess.DEVNULL, text=True)
            ready = json.loads(worker.stdout.readline())
            connection = http.client.HTTPConnection("127.0.0.1", ready["port"], timeout=5)
            connection.request("GET", "/v1/health", headers={"Authorization": "Bearer " + ready["token"]})
            reply = connection.getresponse()
            assert reply.status == 200
            reply.read()
            print(ready["port"])
        """)
        with tempfile.TemporaryDirectory() as data:
            env = {**os.environ, "VMS_DATA_DIR": data}
            output = subprocess.check_output([sys.executable, "-c", parent_code], env=env,
                                             text=True, timeout=10)
            port = int(output.strip())
            for _ in range(40):
                try:
                    with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                        pass
                except OSError:
                    break
                time.sleep(0.1)
            else:
                self.fail("Worker still accepts connections after the desktop parent has exited.")
