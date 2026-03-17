#!/usr/bin/env python3
"""
Allen Atlas Oblique Slice Planner -- Launcher
Usage: python3 launch.py
"""
import subprocess
import sys
import time
import webbrowser
import urllib.request
import urllib.error
import os
import signal

PORT = 8000
APP_URL = f"http://localhost:{PORT}/"
HEALTH_URL = f"http://localhost:{PORT}/health"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def wait_for_server(url: str, timeout: float = 8.0, interval: float = 0.3) -> bool:
    """
    Poll the health endpoint until the server responds or timeout expires.

    Args:
        url: URL to poll (should be the /health endpoint).
        timeout: Maximum seconds to wait.
        interval: Seconds between poll attempts.
    Returns:
        True if server responded with HTTP 200 within timeout, False otherwise.
    """
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1) as r:
                if r.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(interval)
    return False


def main():
    print("Allen Atlas Oblique Slice Planner")
    print("=" * 40)

    # Start the FastAPI server as a subprocess
    print(f"Starting mesh server on port {PORT}...")
    server_proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "mesh_server:app",
         "--host", "localhost", "--port", str(PORT), "--log-level", "warning"],
        cwd=SCRIPT_DIR,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )

    # Wait for server to be ready before opening browser
    if not wait_for_server(HEALTH_URL):
        stderr = server_proc.stderr.read(2000).decode(errors="replace")
        print(f"ERROR: Server did not start in time.")
        print(f"Server stderr:\n{stderr}")
        server_proc.terminate()
        sys.exit(1)

    print(f"Server ready.")
    print(f"Opening browser: {APP_URL}")
    webbrowser.open(APP_URL)
    print()
    print("Press Ctrl+C to stop the server and exit.")

    # Keep running until interrupted
    try:
        server_proc.wait()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server_proc.send_signal(signal.SIGTERM)
        try:
            server_proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            server_proc.kill()
        print("Done.")


if __name__ == "__main__":
    main()
