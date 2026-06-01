import http.server
import socketserver
import json
import os

PORT = 3000
DATA_FILE = 'data.json'
SCHEDULES_FILE = 'schedules.json'

class ReportHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory='public', **kwargs)

    def handle_api_get(self, filename):
        self.send_response(200)
        self.send_header('Content-type', 'application/json; charset=utf-8')
        self.end_headers()
        if os.path.exists(filename):
            with open(filename, 'r', encoding='utf-8') as f:
                self.wfile.write(f.read().encode('utf-8'))
        else:
            self.wfile.write(b'[]')

    def handle_api_post(self, filename):
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length)
        new_data = json.loads(post_data.decode('utf-8'))
        
        items = []
        if os.path.exists(filename):
            with open(filename, 'r', encoding='utf-8') as f:
                try:
                    items = json.load(f)
                except json.JSONDecodeError:
                    pass
                    
        new_data['id'] = len(items) + 1
        items.append(new_data)
        
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(items, f, ensure_ascii=False, indent=2)
            
        self.send_response(200)
        self.send_header('Content-type', 'application/json; charset=utf-8')
        self.end_headers()
        self.wfile.write(json.dumps({'status': 'success', 'id': new_data['id']}).encode('utf-8'))

    def do_GET(self):
        if self.path == '/api/reports':
            self.handle_api_get(DATA_FILE)
        elif self.path == '/api/schedules':
            self.handle_api_get(SCHEDULES_FILE)
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == '/api/reports':
            self.handle_api_post(DATA_FILE)
        elif self.path == '/api/schedules':
            self.handle_api_post(SCHEDULES_FILE)
        else:
            self.send_error(404, "Not Found")

if __name__ == '__main__':
    if not os.path.exists('public'):
        os.makedirs('public')
    with socketserver.TCPServer(("", PORT), ReportHandler) as httpd:
        print(f"サーバー起動: http://localhost:{PORT}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n停止")
