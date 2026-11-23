# servidor.py — servidor local sin caché para la app de alquimia.
# El navegador vuelve a pedir siempre los archivos, así nunca mezcla versiones viejas y nuevas de js/.
import http.server, socketserver, sys

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript'}
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Expires', '0')
        super().end_headers()

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('', port), NoCacheHandler) as httpd:
    print(f'Servidor en http://localhost:{port}  (Ctrl+C para cerrar)')
    httpd.serve_forever()
