import os
import json
import time
import hashlib
import requests
import sys
import uuid

import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

class PJASNode:
    def __init__(self, node_id, storage_path, allocated_gb=100, coordinator_url="https://pjas-production.up.railway.app/api"):
        self.node_id = node_id
        self.storage_path = os.path.abspath(storage_path)
        self.allocated_bytes = allocated_gb * 1024 * 1024 * 1024 
        self.coordinator_url = coordinator_url
        self.port = 8420  # pjas port (apparently needs to be 8420 for something)
        self.chunks_dir = os.path.join(self.storage_path, "chunks")
        self.metadata_file = os.path.join(self.storage_path, "node_metadata.json")
        
        os.makedirs(self.chunks_dir, exist_ok=True)
        self.metadata = self.load_metadata()
        
    def load_metadata(self): 
        """Load node metadata or create default"""
        if os.path.exists(self.metadata_file):
            with open(self.metadata_file, 'r') as f:
                return json.load(f)
        else:
            metadata = {
                "node_id": self.node_id,
                "chunks": {},  # either this or chunk_id: {"file_id": str, "size": int, "created": timestamp} i think
                "total_stored": 0
            }
            self.save_metadata(metadata)
            return metadata
            
    def save_metadata(self, metadata=None):
        """Save metadata to disk"""
        if metadata is None:
            metadata = self.metadata
        with open(self.metadata_file, 'w') as f:
            json.dump(metadata, f, indent=2)
    def get_storage_stats(self):
        """Calculate current storage usage"""
        total_size = 0
        chunk_count = 0
        
        for chunk_file in os.listdir(self.chunks_dir):
            if chunk_file.endswith('.chunk'):
                chunk_path = os.path.join(self.chunks_dir, chunk_file)
                total_size += os.path.getsize(chunk_path)
                chunk_count += 1
                
        return {
            "used_bytes": total_size,
            "allocated_bytes": self.allocated_bytes,
            "free_bytes": self.allocated_bytes - total_size,
            "chunk_count": chunk_count,
            "usage_percent": (total_size / self.allocated_bytes) * 100
        }
    
    def store_chunk(self, chunk_id, chunk_data, file_metadata):
        """Store a chunk on this node"""
        stats = self.get_storage_stats()
        
        if len(chunk_data) > stats["free_bytes"]:
            return {"success": False, "error": "Not enough free space"}
            
        chunk_path = os.path.join(self.chunks_dir, f"{chunk_id}.chunk")
        
        try:
            with open(chunk_path, 'wb') as f:
                f.write(chunk_data)
            
            self.metadata["chunks"][chunk_id] = {
                "file_id": file_metadata.get("file_id"),
                "size": len(chunk_data),
                "created": time.time(),
                "checksum": hashlib.sha256(chunk_data).hexdigest()
            }
            self.save_metadata()
            
            return {"success": True, "stored_bytes": len(chunk_data)}
            
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def retrieve_chunk(self, chunk_id):
        """Retrieve a chunk from this node"""
        chunk_path = os.path.join(self.chunks_dir, f"{chunk_id}.chunk")
        
        if not os.path.exists(chunk_path):
            return {"success": False, "error": "Chunk not found"}
            
        try:
            with open(chunk_path, 'rb') as f:
                chunk_data = f.read()
            
            
            if chunk_id in self.metadata["chunks"]:
                stored_checksum = self.metadata["chunks"][chunk_id]["checksum"]
                actual_checksum = hashlib.sha256(chunk_data).hexdigest()
                
                if stored_checksum != actual_checksum:
                    return {"success": False, "error": "Chunk corrupted"}
            
            return {"success": True, "data": chunk_data}
            
        except Exception as e:
            return {"success": False, "error": str(e)}
        
    def register_with_coordinator(self):
        """Register this node with the coordinator"""
        stats = self.get_storage_stats()
        
        registration_data = {
            "node_id": self.node_id,
            "address": f"http://localhost:{self.port}",  # ------------------------------------------------------------------
            "storage_stats": stats,
            "status": "online",
            "version": "1.0.0"
        }
        
        try:
            response = requests.post(
                f"{self.coordinator_url}/nodes/register",
                json=registration_data,
                timeout=10
            )
            return response.json()
        except Exception as e:
            print(f"Failed to register with coordinator: {e}")
            return {"success": False, "error": str(e)}
    
    def send_heartbeat(self):
        """Send periodic heartbeat to coordinator"""
        while True:
            try:
                stats = self.get_storage_stats()
                heartbeat_data = {
                    "node_id": self.node_id,
                    "storage_stats": stats,
                    "timestamp": time.time()
                }
                
                requests.post(
                    f"{self.coordinator_url}/nodes/heartbeat",
                    json=heartbeat_data,
                    timeout=5
                )
                print(f"Heartbeat sent - {stats['usage_percent']:.1f}% used")
                
            except Exception as e:
                print(f"Heartbeat failed: {e}")
                
            time.sleep(30)  
    def start_server(self):
        """Start the node HTTP server"""
        handler = NodeRequestHandler
        handler.node = self
        
        server = HTTPServer(('localhost', self.port), handler)
        print(f"PJAS Node {self.node_id} starting on port {self.port}")
        print(f"Storage: {self.storage_path}")
        
        # Start heartbeat thread
        heartbeat_thread = threading.Thread(target=self.send_heartbeat, daemon=True)
        heartbeat_thread.start()
        
        # Register with coordinator
        self.register_with_coordinator()
        
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down PJAS Node...")
            server.shutdown()


class NodeRequestHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        """Handle GET requests"""
        path = urlparse(self.path).path
        query = parse_qs(urlparse(self.path).query)
        
        if path == '/status':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            
            stats = self.node.get_storage_stats()
            response = {
                "node_id": self.node.node_id,
                "status": "online",
                "storage": stats
            }
            self.wfile.write(json.dumps(response, indent=2).encode())
            
        elif path == '/chunk':
            chunk_id = query.get('id', [None])[0]
            if not chunk_id:
                self.send_error(400, "Missing chunk ID")
                return
                
            result = self.node.retrieve_chunk(chunk_id)
            
            if result["success"]:
                self.send_response(200)
                self.send_header('Content-type', 'application/octet-stream')
                self.send_header('Content-Length', str(len(result["data"])))
                self.end_headers()
                self.wfile.write(result["data"])
            else:
                self.send_error(404, result["error"])
        else:
            self.send_error(404, "Not found")
    
    def do_POST(self):
        """Handle POST requests"""
        path = urlparse(self.path).path
        
        if path == '/chunk':
            content_length = int(self.headers.get('Content-Length', 0))
            
            metadata_length = int(self.headers.get('X-Metadata-Length', 0))
            metadata_json = self.rfile.read(metadata_length).decode()
            metadata = json.loads(metadata_json)
            
            chunk_data = self.rfile.read(content_length - metadata_length)
            result = self.node.store_chunk(
                metadata["chunk_id"],
                chunk_data,
                metadata
            )
            
            self.send_response(200 if result["success"] else 500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(result).encode())
        else:
            self.send_error(404, "Not found")
    
    def log_message(self, format, *args):
        """Suppress default logging"""
        pass

def main():
    
    if len(sys.argv) < 2:
        print("Usage: python pjas_node.py <storage_directory> [allocated_gb]")
        print("Example: python pjas_node.py ./pjas_storage 67")
        sys.exit(1)
    
    storage_dir = sys.argv[1]
    allocated_gb = int(sys.argv[2]) if len(sys.argv) > 2 else 100
    
    node_id = f"pjas-{uuid.uuid4().hex[:8]}"
    
    print(f"Starting PJAS Node: {node_id}")
    print(f"Allocated Storage: {allocated_gb} GB")
    print(f"Storage Directory: {storage_dir}")
    
    node = PJASNode(node_id, storage_dir, allocated_gb)
    node.start_server()


if __name__ == "__main__":
    main()