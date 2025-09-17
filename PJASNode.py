import os
import json
import time
import hashlib
import requests
import shutil
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

class PJASNode:
    def __init__(self, node_id, storage_path, allocated_gb=100, coordinator_url="https://pjhq.dev/api"):
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