import json
import socket
import threading
import unittest
import urllib.error
import urllib.request

from services.worker.server import WorkerServer
from services.worker.schema import new_project


class WorkerApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.token = "test-only-secret"
        self.server = WorkerServer(("127.0.0.1", 0), self.token)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.jobs.close()
        self.server.server_close()
        self.thread.join(timeout=2)

    def request(self, route: str, *, body: dict | None = None, token: str | None = None) -> tuple[int, dict, dict]:
        data = None if body is None else json.dumps(body).encode("utf-8")
        headers = {}
        if token is not None:
            headers["Authorization"] = f"Bearer {token}"
        if body is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(self.base + route, data=data, headers=headers)
        try:
            response = urllib.request.urlopen(request, timeout=3)
        except urllib.error.HTTPError as exc:
            response = exc
        with response:
            raw = response.read()
            return response.status, json.loads(raw.decode("utf-8")), dict(response.headers)

    def test_health_requires_ephemeral_bearer_token_and_has_no_cors(self) -> None:
        status, body, _ = self.request("/v1/health")
        self.assertEqual(status, 401)
        self.assertEqual(body["error"], "Unauthorized.")
        status, body, headers = self.request("/v1/health", token=self.token)
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "ok")
        self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_project_validation_route_uses_same_schema(self) -> None:
        project = new_project("HTTP test")
        status, body, _ = self.request("/v1/project/validate", body={"project": project}, token=self.token)
        self.assertEqual(status, 200)
        self.assertTrue(body["valid"])
        self.assertEqual(body["clip_count"], 0)

    def test_oversized_body_is_rejected(self) -> None:
        with socket.create_connection(("127.0.0.1", self.server.server_port), timeout=3) as client:
            client.settimeout(3)
            client.sendall((f"POST /v1/project/validate HTTP/1.1\r\nHost: 127.0.0.1:{self.server.server_port}\r\n"
                            f"Authorization: Bearer {self.token}\r\nContent-Type: application/json\r\n"
                            "Content-Length: 8388609\r\nConnection: close\r\n\r\n").encode("ascii"))
            response = client.recv(4096)
        self.assertIn(b"HTTP/1.1 400", response)


if __name__ == "__main__":
    unittest.main()
