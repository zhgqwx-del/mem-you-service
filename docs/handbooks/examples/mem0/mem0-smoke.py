"""Manual Mem0 OSS handbook probe; no requests are made when imported.

Default: reachability and authentication only. --write performs synthetic CRUD
and uses the configured embedding provider. It does not verify LLM extraction
or physical erasure. No automatic retries are performed.
"""

import argparse
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import uuid


class ProbeFailure(Exception):
    pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:18888")
    parser.add_argument("--key-file", required=True, type=Path)
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--receipt-file", type=Path)
    args = parser.parse_args()
    if args.write and not args.receipt_file:
        parser.error("--write requires a new --receipt-file")
    base = args.base_url.rstrip("/")
    parsed = urllib.parse.urlsplit(base)
    if parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.query or parsed.fragment:
        parser.error("--base-url must be a trusted HTTP(S) origin without a query or fragment")
    if parsed.username or parsed.password or parsed.path:
        parser.error("--base-url must not contain credentials or a path")
    if stat.S_IMODE(args.key_file.stat().st_mode) & 0o077:
        raise ProbeFailure("API key file must be private: chmod 600 the file")
    key = args.key_file.read_text().strip()
    if not key or "\n" in key or "\r" in key:
        raise ProbeFailure("API key file is empty or malformed")

    def request(method, path, payload=None, *, auth=True, expected=200):
        headers = {"Content-Type": "application/json"}
        if auth:
            headers["X-API-Key"] = key
        data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode()
        req = urllib.request.Request(base + path, data=data, method=method, headers=headers)
        # Disallow redirecting a credential-bearing request to another URL.
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                return None

        opener = urllib.request.build_opener(NoRedirect)
        try:
            with opener.open(req, timeout=30) as response:
                status = response.status
                body = response.read(1_048_577)
        except urllib.error.HTTPError as exc:
            if exc.code == expected:
                return None
            raise ProbeFailure(f"{method} request returned HTTP {exc.code}; response body omitted") from None
        except (urllib.error.URLError, TimeoutError, OSError):
            raise ProbeFailure("Network failure; write outcome may be unknown. Inspect the receipt; do not blindly repeat") from None
        if status != expected or len(body) > 1_048_576:
            raise ProbeFailure("Unexpected status or oversized response")
        try:
            return json.loads(body)
        except (ValueError, UnicodeDecodeError):
            raise ProbeFailure("Response is not valid JSON") from None

    setup = request("GET", "/auth/setup-status", auth=False)
    if not isinstance(setup, dict) or setup.get("needsSetup") is not False:
        raise ProbeFailure("Finish the browser setup wizard before probing")
    request("GET", "/memories?user_id=handbook-auth-probe", auth=False, expected=401)
    probe = request("GET", "/memories?user_id=handbook-auth-probe")
    if not isinstance(probe, dict) or not isinstance(probe.get("results"), list):
        raise ProbeFailure("Unexpected authenticated list response")
    print("PASS: setup complete; anonymous request denied; key accepted")
    if not args.write:
        return

    receipt = {"owner": "handbook:" + uuid.uuid4().hex, "phase": "prepared", "memory_id": None}
    descriptor = os.open(args.receipt_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as handle:
        json.dump(receipt, handle)
        handle.flush()
        os.fsync(handle.fileno())

    def phase(value):
        receipt["phase"] = value
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", dir=args.receipt_file.parent, delete=False) as handle:
                temporary = Path(handle.name)
                json.dump(receipt, handle)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, args.receipt_file)
            temporary = None
            directory = os.open(args.receipt_file.parent, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)

    owner = receipt["owner"]
    original = "Handbook synthetic marker " + owner + ": prefer concise Chinese replies."
    phase("add_dispatched")
    added = request("POST", "/memories", {
        "user_id": owner, "infer": False,
        "messages": [{"role": "user", "content": original}],
        "metadata": {"source": "handbook-synthetic"},
    })
    rows = added.get("results") if isinstance(added, dict) else None
    if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict) or not isinstance(rows[0].get("id"), str):
        raise ProbeFailure("Expected exactly one synthetic raw memory; inspect the owner in the receipt")
    memory_id = rows[0]["id"]
    receipt["memory_id"] = memory_id
    phase("added")
    path = "/memories/" + urllib.parse.quote(memory_id, safe="")
    current = request("GET", path)
    if not isinstance(current, dict) or current.get("memory") != original or current.get("user_id") != owner:
        raise ProbeFailure("Stored synthetic memory does not match")
    found = request("POST", "/search", {"query": original, "filters": {"user_id": owner}, "top_k": 5, "threshold": 0.0})
    found_rows = found.get("results") if isinstance(found, dict) else None
    if not isinstance(found_rows, list) or any(not isinstance(row, dict) for row in found_rows):
        raise ProbeFailure("Malformed search result structure")
    if not any(row.get("id") == memory_id for row in found_rows):
        raise ProbeFailure("Synthetic memory was not retrieved")
    updated = original + " Updated synthetic value."
    phase("update_dispatched")
    request("PUT", path, {"text": updated})
    current = request("GET", path)
    if not isinstance(current, dict) or current.get("memory") != updated or current.get("user_id") != owner:
        raise ProbeFailure("Synthetic update was not observed")
    phase("delete_dispatched")
    request("DELETE", path)
    if request("GET", path) is not None:
        raise ProbeFailure("Deleted synthetic memory still returned by ID")
    remaining = request("GET", "/memories?" + urllib.parse.urlencode({"user_id": owner, "top_k": 10}))
    if not isinstance(remaining, dict) or remaining.get("results") != []:
        raise ProbeFailure("Synthetic owner still has current memories")
    history = request("GET", path + "/history")
    if not isinstance(history, list) or any(not isinstance(row, dict) for row in history):
        raise ProbeFailure("Malformed history result structure")
    if not any(row.get("event") == "DELETE" for row in history):
        raise ProbeFailure("DELETE history was not observed")
    phase("current_memory_deleted_history_retained")
    print("PASS: synthetic add/search/get/update/delete; GET after delete is null")
    print("NOTE: DELETE history retains text. This probe does not prove physical erasure or LLM extraction")


if __name__ == "__main__":
    try:
        main()
    except (ProbeFailure, OSError) as exc:
        # Do not expose request headers, response bodies or credential values.
        print(str(exc) if isinstance(exc, ProbeFailure) else "Local file operation failed", file=sys.stderr)
        sys.exit(1)
