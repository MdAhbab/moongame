#!/usr/bin/env python3
import subprocess
import os
import argparse
import http.server
import socketserver

def main():
    parser = argparse.ArgumentParser(description="Run the Moon Game locally")
    parser.add_argument("--prod", action="store_true", help="Serve the production build from the 'dist' directory")
    parser.add_argument("--port", type=int, default=8000, help="Port to serve the production build on")
    args = parser.parse_args()

    project_dir = os.path.dirname(os.path.abspath(__file__))

    if args.prod:
        dist_dir = os.path.join(project_dir, "dist")
        if not os.path.exists(dist_dir):
            print("Error: 'dist' directory not found. Building the project first...")
            subprocess.run(["npm", "run", "build"], cwd=project_dir, check=True)
            
        print(f"Serving production build on http://localhost:{args.port}")
        os.chdir(dist_dir)
        Handler = http.server.SimpleHTTPRequestHandler
        
        # Open the browser automatically
        import webbrowser
        import threading
        import time
        
        def open_browser():
            time.sleep(0.5)
            webbrowser.open(f"http://localhost:{args.port}")
            
        threading.Thread(target=open_browser, daemon=True).start()
        
        # Use ThreadingHTTPServer for concurrent requests and built-in port reuse
        class ReusableServer(http.server.ThreadingHTTPServer):
            allow_reuse_address = True
            daemon_threads = True
            
            def server_bind(self):
                import socket
                # Ensure port reuse is explicitly set for macOS
                self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                if hasattr(socket, 'SO_REUSEPORT'):
                    self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
                super().server_bind()
        
        try:
            with ReusableServer(("", args.port), Handler) as httpd:
                try:
                    httpd.serve_forever()
                except KeyboardInterrupt:
                    print("\nShutting down server.")
        except OSError as e:
            if e.errno == 48:
                print(f"\nError: Port {args.port} is already in use.")
                print("Wait a few seconds for the OS to release the port, or use a different port: ./run.py --prod --port 8080")
            else:
                raise
    else:
        print("Starting development server...")
        try:
            subprocess.run(["npm", "run", "dev"], cwd=project_dir)
        except KeyboardInterrupt:
            print("\nShutting down development server.")

if __name__ == "__main__":
    main()
