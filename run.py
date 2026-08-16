#!/usr/bin/env python3
"""
Mare Noctis - Universal Game Runner
Cross-platform runner script for local development, testing, and production preview.
Handles system prerequisite checks, automatic dependency installation, and server hosting.
"""

import argparse
import errno
import http.server
import os
import platform
import shutil
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path
from typing import List, Optional


def is_color_supported() -> bool:
    """Check if the current terminal supports ANSI colors."""
    if not sys.stdout.isatty():
        return False
    if os.name == "nt":
        try:
            import ctypes
            kernel32 = ctypes.windll.kernel32
            handle = kernel32.GetStdHandle(-11)  # STD_OUTPUT_HANDLE
            mode = ctypes.c_ulong()
            if kernel32.GetConsoleMode(handle, ctypes.byref(mode)):
                kernel32.SetConsoleMode(handle, mode.value | 0x0004)  # ENABLE_VIRTUAL_TERMINAL_PROCESSING
                return True
        except Exception:
            return os.environ.get("ANSICON") is not None or "WT_SESSION" in os.environ
    return True


COLOR_SUPPORT = is_color_supported()


def log(tag: str, color_code: str, message: str) -> None:
    """Print formatted message with ANSI color if supported."""
    if COLOR_SUPPORT:
        print(f"\033[{color_code}m{tag}\033[0m {message}")
    else:
        print(f"{tag} {message}")


def log_info(msg: str) -> None:
    log("[INFO]", "1;34", msg)


def log_success(msg: str) -> None:
    log("[SUCCESS]", "1;32", msg)


def log_warn(msg: str) -> None:
    log("[WARNING]", "1;33", msg)


def log_error(msg: str) -> None:
    log("[ERROR]", "1;31", msg)


def run_command(cmd_args: List[str], cwd: Path, check: bool = True) -> int:
    """
    Run a command cross-platform.
    On Windows, executes with shell=True to properly locate npm.cmd and batch scripts.
    """
    is_windows = (os.name == "nt")
    try:
        process = subprocess.run(
            cmd_args if not is_windows else " ".join(f'"{a}"' if " " in a else a for a in cmd_args),
            cwd=str(cwd),
            shell=is_windows,
            check=check,
        )
        return process.returncode
    except subprocess.CalledProcessError as e:
        if check:
            raise
        return e.returncode
    except FileNotFoundError:
        log_error(f"Command not found: '{cmd_args[0]}'")
        raise


def check_prerequisites() -> bool:
    """Verify that Node.js and npm are installed and accessible."""
    is_windows = (os.name == "nt")

    # Check node
    node_cmd = shutil.which("node")
    if not node_cmd:
        log_error("Node.js is not installed or not found in your system PATH.")
        print("\nPlease install Node.js (version 18+ or 20+ LTS recommended):")
        if is_windows:
            print("  • Download installer: https://nodejs.org/")
            print("  • Or via PowerShell: winget install OpenJS.NodeJS.LTS")
        elif platform.system() == "Darwin":
            print("  • Download installer: https://nodejs.org/")
            print("  • Or via Homebrew: brew install node")
        else:
            print("  • Debian/Ubuntu: sudo apt update && sudo apt install nodejs npm")
            print("  • Fedora: sudo dnf install nodejs npm")
            print("  • Or download: https://nodejs.org/")
        return False

    # Check npm
    npm_cmd = shutil.which("npm") or (shutil.which("npm.cmd") if is_windows else None)
    if not npm_cmd:
        log_error("npm is not installed or not found in your system PATH.")
        print("\nPlease install npm alongside Node.js from https://nodejs.org/")
        return False

    return True


def check_dependencies(project_dir: Path, force_install: bool = False) -> bool:
    """
    Checks if node_modules exists and is up to date.
    Installs packages automatically if missing or requested.
    """
    node_modules = project_dir / "node_modules"
    package_json = project_dir / "package.json"
    package_lock = project_dir / "package-lock.json"

    if not package_json.exists():
        log_error(f"package.json not found in {project_dir}")
        return False

    needs_install = force_install or not node_modules.exists()

    # If node_modules exists, check if package.json or package-lock.json was modified after node_modules
    if not needs_install and node_modules.exists():
        try:
            nm_mtime = node_modules.stat().st_mtime
            if package_json.exists() and package_json.stat().st_mtime > nm_mtime:
                log_info("package.json was modified. Updating dependencies...")
                needs_install = True
            elif package_lock.exists() and package_lock.stat().st_mtime > nm_mtime:
                log_info("package-lock.json was modified. Updating dependencies...")
                needs_install = True
        except Exception:
            pass

    if needs_install:
        if force_install:
            log_info("Force reinstalling dependencies (npm install)...")
        else:
            log_info("Project dependencies not found. Installing now via 'npm install'...")

        try:
            run_command(["npm", "install"], cwd=project_dir, check=True)
            log_success("Dependencies installed successfully!")
        except (subprocess.CalledProcessError, FileNotFoundError) as e:
            log_error(f"Failed to install dependencies: {e}")
            print("\nTroubleshooting tips:")
            print("  1. Verify your internet connection.")
            print("  2. Try running 'npm cache clean --force'.")
            print("  3. Run 'npm install' directly in the project terminal.")
            return False

    return True


def ensure_build(project_dir: Path, force_build: bool = False) -> bool:
    """Ensure the production build in 'dist' directory exists and is ready."""
    dist_dir = project_dir / "dist"
    index_html = dist_dir / "index.html"

    if force_build or not index_html.exists():
        log_info("Building production bundle (npm run build)...")
        try:
            run_command(["npm", "run", "build"], cwd=project_dir, check=True)
            log_success("Production build completed successfully in 'dist/'!")
        except (subprocess.CalledProcessError, FileNotFoundError) as e:
            log_error(f"Production build failed: {e}")
            return False

    return True


def open_browser_delayed(url: str, delay: float = 0.5) -> None:
    """Open the web browser in a background daemon thread after a short delay."""
    def _open():
        time.sleep(delay)
        try:
            webbrowser.open(url)
        except Exception:
            pass

    threading.Thread(target=_open, daemon=True).start()


class MareNoctisRequestHandler(http.server.SimpleHTTPRequestHandler):
    """Custom HTTP request handler with comprehensive MIME mappings for game assets."""

    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".glb": "model/gltf-binary",
        ".gltf": "model/gltf+json",
        ".bin": "application/octet-stream",
        ".hdr": "image/vnd.radiance",
        ".woff": "font/woff",
        ".woff2": "font/woff2",
        ".opus": "audio/ogg",
        ".m4a": "audio/mp4",
        ".wasm": "application/wasm",
        ".webp": "image/webp",
        ".svg": "image/svg+xml",
    }

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()


class CrossPlatformThreadingServer(http.server.ThreadingHTTPServer):
    """Multi-threaded HTTP server with cross-platform socket reuse."""
    allow_reuse_address = True
    daemon_threads = True

    def server_bind(self):
        import socket
        try:
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        except OSError:
            pass
        if hasattr(socket, "SO_REUSEPORT"):
            try:
                self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
            except OSError:
                pass
        super().server_bind()


def serve_production(project_dir: Path, host: str, port: int, auto_browser: bool) -> int:
    """Serve the production build statically via Python HTTP server."""
    dist_dir = project_dir / "dist"
    if not ensure_build(project_dir):
        return 1

    bind_host = host if host not in ("localhost", "127.0.0.1") else ""
    display_host = "localhost" if not host or host in ("", "0.0.0.0", "127.0.0.1") else host
    url = f"http://{display_host}:{port}"

    log_info(f"Serving production build from '{dist_dir}'")
    log_success(f"Production game available at: {url}")
    print("Press Ctrl+C to stop the server.\n")

    if auto_browser:
        open_browser_delayed(url, delay=0.6)

    # Change directory to dist for serving
    original_cwd = os.getcwd()
    os.chdir(str(dist_dir))

    try:
        with CrossPlatformThreadingServer((bind_host, port), MareNoctisRequestHandler) as httpd:
            try:
                httpd.serve_forever()
            except KeyboardInterrupt:
                print("\n")
                log_info("Shutting down production server.")
                return 0
    except OSError as e:
        is_port_in_use = (
            e.errno in (errno.EADDRINUSE, 48, 98, 10048) or
            getattr(e, "winerror", None) == 10048 or
            "address already in use" in str(e).lower()
        )
        if is_port_in_use:
            log_error(f"Port {port} is already in use by another process.")
            print(f"Please use a different port, e.g.:")
            print(f"  python run.py --prod --port {port + 1}")
            return 1
        else:
            log_error(f"Server error: {e}")
            return 1
    finally:
        os.chdir(original_cwd)


def serve_development(project_dir: Path, host: Optional[str], port: Optional[int], auto_browser: bool) -> int:
    """Start Vite development server."""
    log_info("Starting Vite development server...")

    cmd = ["npm", "run", "dev"]
    extra_args = []

    if host:
        extra_args.extend(["--host", host])
    if port:
        extra_args.extend(["--port", str(port)])
    if auto_browser:
        extra_args.append("--open")

    if extra_args:
        cmd.extend(["--", *extra_args])

    try:
        run_command(cmd, cwd=project_dir, check=True)
        return 0
    except KeyboardInterrupt:
        print("\n")
        log_info("Shutting down development server.")
        return 0
    except subprocess.CalledProcessError as e:
        log_error(f"Development server exited with error code {e.returncode}")
        return e.returncode


def clean_project(project_dir: Path) -> int:
    """Remove node_modules, package-lock, and dist folders."""
    log_info("Cleaning build artifacts and dependencies...")
    for folder in ["node_modules", "dist"]:
        target = project_dir / folder
        if target.exists():
            log_info(f"Removing {folder}/...")
            try:
                shutil.rmtree(str(target), ignore_errors=True)
            except Exception as e:
                log_warn(f"Could not cleanly remove {folder}: {e}")
    log_success("Clean complete.")
    return 0


def main():
    parser = argparse.ArgumentParser(
        description="Mare Noctis - Cross-Platform Game Runner",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""Examples:
  python run.py                     # Start Vite dev server (auto-installs if needed)
  python run.py --prod              # Build and serve production bundle on http://localhost:8000
  python run.py --prod --port 8080  # Serve production bundle on custom port
  python run.py --install           # Force install/update npm dependencies
  python run.py --build             # Run production build (npm run build)
  python run.py --test              # Run unit and integration tests (npm test)
  python run.py --verify            # Run full verification (lint + test + build)
  python run.py --clean             # Clean node_modules and dist directories
        """,
    )

    parser.add_argument("--prod", action="store_true", help="Serve the production build from 'dist/' directory")
    parser.add_argument("--port", type=int, default=None, help="Port to bind the server to (default: 5173 for dev, 8000 for prod)")
    parser.add_argument("--host", type=str, default=None, help="Host/IP to bind the server to (default: localhost)")
    parser.add_argument("--no-browser", action="store_true", help="Do not automatically open the web browser")
    parser.add_argument("-i", "--install", action="store_true", help="Force install/update npm dependencies")
    parser.add_argument("-b", "--build", action="store_true", help="Build the project for production and exit")
    parser.add_argument("-t", "--test", action="store_true", help="Run the test suite (Vitest) and exit")
    parser.add_argument("--verify", action="store_true", help="Run lint, test, and build checks, then exit")
    parser.add_argument("--preview", action="store_true", help="Run Vite preview server (npm run preview)")
    parser.add_argument("--clean", action="store_true", help="Remove node_modules and dist directories")

    args = parser.parse_args()
    project_dir = Path(__file__).resolve().parent

    # Action: Clean
    if args.clean:
        sys.exit(clean_project(project_dir))

    # Prerequisite verification
    if not check_prerequisites():
        sys.exit(1)

    # Action: Install dependencies explicitly
    if args.install:
        if check_dependencies(project_dir, force_install=True):
            log_success("Dependencies installed successfully.")
            sys.exit(0)
        sys.exit(1)

    # Automatic dependency verification before running any tool
    if not check_dependencies(project_dir, force_install=False):
        sys.exit(1)

    # Action: Run tests
    if args.test:
        log_info("Running test suite (npm test)...")
        code = run_command(["npm", "test"], cwd=project_dir, check=False)
        sys.exit(code)

    # Action: Run verify
    if args.verify:
        log_info("Running full verification suite (npm run verify)...")
        code = run_command(["npm", "run", "verify"], cwd=project_dir, check=False)
        sys.exit(code)

    # Action: Build only
    if args.build:
        success = ensure_build(project_dir, force_build=True)
        sys.exit(0 if success else 1)

    # Action: Preview with Vite preview
    if args.preview:
        if not ensure_build(project_dir):
            sys.exit(1)
        log_info("Starting Vite preview server...")
        cmd = ["npm", "run", "preview"]
        if args.port or args.host:
            extra = []
            if args.port:
                extra.extend(["--port", str(args.port)])
            if args.host:
                extra.extend(["--host", args.host])
            cmd.extend(["--", *extra])
        code = run_command(cmd, cwd=project_dir, check=False)
        sys.exit(code)

    # Action: Serve Production
    if args.prod:
        port = args.port if args.port is not None else 8000
        host = args.host if args.host is not None else "localhost"
        auto_browser = not args.no_browser
        code = serve_production(project_dir, host=host, port=port, auto_browser=auto_browser)
        sys.exit(code)

    # Action: Serve Development (Default)
    port = args.port
    host = args.host
    auto_browser = not args.no_browser
    code = serve_development(project_dir, host=host, port=port, auto_browser=auto_browser)
    sys.exit(code)


if __name__ == "__main__":
    main()
