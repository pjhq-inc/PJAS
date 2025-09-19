const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

const upload = multer({
  limits: {
    fileSize: 1000 * 1024 * 1024 
  },
  storage: multer.memoryStorage()
});

const nodes = new Map();
const files = new Map();
const chunks = new Map(); 
const logs = [];

function logActivity(level, message) {
  const timestamp = new Date().toISOString().replace('T', ' ').substr(0, 19);
  const logEntry = { timestamp, level, message };
  logs.push(logEntry);
  if (logs.length > 100) logs.shift();
  console.log(`[${level}] ${message}`);
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function generateId() {
  return uuidv4().replace(/-/g, '').substr(0, 16);
}

// Routes (same as before until file upload)...
app.get('/', (req, res) => {
  res.json({ 
    status: 'PJAS Coordinator Online',
    nodes: nodes.size,
    files: files.size,
    timestamp: Date.now()
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: Date.now() });
});

app.post('/api/nodes/register', (req, res) => {
  try {
    const nodeData = req.body;
    const nodeId = nodeData.node_id;
    const now = Date.now();
    
    if (!nodeId || !nodeData.storage_stats) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields' 
      });
    }
    
    nodes.set(nodeId, {
      ...nodeData,
      last_seen: now,
      registered_at: now,
      status: 'online',
      chunks_stored: []
    });
    
    logActivity('INFO', `Node ${nodeId} registered - ${formatBytes(nodeData.storage_stats.allocated_bytes)} allocated`);
    
    res.json({ 
      success: true, 
      message: 'Node registered successfully',
      node_id: nodeId
    });
    
  } catch (error) {
    logActivity('ERROR', `Node registration failed: ${error.message}`);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.post('/api/nodes/heartbeat', (req, res) => {
  try {
    const { node_id, storage_stats } = req.body;
    
    if (!node_id) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing node_id' 
      });
    }
    
    if (nodes.has(node_id)) {
      const node = nodes.get(node_id);
      node.last_seen = Date.now();
      node.storage_stats = storage_stats;
      node.status = 'online';
      nodes.set(node_id, node);
    } else {
      logActivity('WARN', `Heartbeat from unregistered node: ${node_id}`);
      return res.status(404).json({ 
        success: false, 
        error: 'Node not registered' 
      });
    }
    
    res.json({ success: true });
    
  } catch (error) {
    logActivity('ERROR', `Heartbeat processing failed: ${error.message}`);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.get('/api/nodes', (req, res) => {
  try {
    const now = Date.now();
    const offlineThreshold = 60000;
    
    for (const [nodeId, node] of nodes.entries()) {
      if (now - node.last_seen > offlineThreshold) {
        node.status = 'offline';
        nodes.set(nodeId, node);
      }
    }
    
    const nodesList = Array.from(nodes.values());
    res.json({
      success: true,
      nodes: nodesList,
      count: nodesList.length
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.get('/api/stats', (req, res) => {
  try {
    const nodesList = Array.from(nodes.values());
    const now = Date.now();
    const offlineThreshold = 60000;
    
    const onlineNodes = nodesList.filter(n => now - n.last_seen <= offlineThreshold);
    const totalStorage = nodesList.reduce((sum, n) => sum + (n.storage_stats?.allocated_bytes || 0), 0);
    const usedStorage = nodesList.reduce((sum, n) => sum + (n.storage_stats?.used_bytes || 0), 0);
    const networkHealth = nodesList.length > 0 ? Math.round((onlineNodes.length / nodesList.length) * 100) : 100;
    
    res.json({
      success: true,
      stats: {
        totalNodes: nodesList.length,
        onlineNodes: onlineNodes.length,
        totalStorage,
        usedStorage,
        networkHealth,
        activeFiles: files.size
      }
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.get('/api/logs', (req, res) => {
  res.json({
    success: true,
    logs: logs.slice(-50)
  });
});

app.get('/api/files', (req, res) => {
  try {
    const filesList = Array.from(files.values()).map(file => ({
      file_id: file.file_id,
      filename: file.filename,
      size: file.size,
      uploaded_at: file.uploaded_at,
      status: file.status,
      chunks_count: file.chunks ? file.chunks.length : 0
    }));
    
    res.json({
      success: true,
      files: filesList,
      count: filesList.length
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.post('/api/files/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        error: 'No file uploaded' 
      });
    }
    
    const fileId = generateId();
    const fileMetadata = {
      file_id: fileId,
      filename: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
      uploaded_at: Date.now(),
      status: 'processing'
    };
    
    const chunksInfo = await distributeFileToNodes(fileMetadata, req.file.buffer);
    
    fileMetadata.chunks = chunksInfo;
    fileMetadata.status = 'completed';
    files.set(fileId, fileMetadata);
    
    logActivity('INFO', `File uploaded: ${req.file.originalname} (${formatBytes(req.file.size)}) - ${chunksInfo.length} chunks`);
    
    res.json({
      success: true,
      file_id: fileId,
      message: 'File uploaded successfully',
      chunks: chunksInfo.length
    });
    
  } catch (error) {
    logActivity('ERROR', `File upload failed: ${error.message}`);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.get('/api/files/download/:file_id', async (req, res) => {
  try {
    const fileId = req.params.file_id;
    const fileMetadata = files.get(fileId);
    
    if (!fileMetadata) {
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }
    
    logActivity('INFO', `Download requested: ${fileMetadata.filename}`);
    
    try {
      const fileBuffer = await retrieveFileFromNodes(fileId, fileMetadata);
      
      res.setHeader('Content-Disposition', `attachment; filename="${fileMetadata.filename}"`);
      res.setHeader('Content-Type', fileMetadata.mimetype || 'application/octet-stream');
      res.setHeader('Content-Length', fileBuffer.length);
      
      res.send(fileBuffer);
      
      logActivity('INFO', `Download completed: ${fileMetadata.filename}`);
      
    } catch (downloadError) {
      logActivity('ERROR', `Download failed: ${fileMetadata.filename} - ${downloadError.message}`);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve file: ' + downloadError.message
      });
    }
    
  } catch (error) {
    logActivity('ERROR', `Download error: ${error.message}`);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

async function distributeFileToNodes(fileMetadata, fileBuffer) {
  const chunkSize = 10 * 1024 * 1024; 
  const numChunks = Math.ceil(fileMetadata.size / chunkSize);
  const onlineNodes = Array.from(nodes.values()).filter(n => n.status === 'online');
  const chunksInfo = [];
  
  if (onlineNodes.length === 0) {
    logActivity('WARN', 'No online nodes available for storage');
  }
  
  for (let i = 0; i < numChunks; i++) {
    const chunkId = generateId();
    const startByte = i * chunkSize;
    const endByte = Math.min(startByte + chunkSize, fileMetadata.size);
    const chunkData = fileBuffer.slice(startByte, endByte);
    
    const selectedNodes = selectNodesForChunk(onlineNodes, 3);
    const storedOnNodes = [];
    
    for (const node of selectedNodes) {
      try {
        const success = await sendChunkToNode(node, chunkId, chunkData, fileMetadata);
        if (success) {
          storedOnNodes.push(node.node_id);
          logActivity('INFO', `Chunk ${chunkId} stored on node ${node.node_id}`);
        }
      } catch (error) {
        logActivity('ERROR', `Failed to store chunk ${chunkId} on node ${node.node_id}: ${error.message}`);
      }
    }
    
    chunksInfo.push({
      chunk_id: chunkId,
      chunk_index: i,
      size: chunkData.length,
      nodes: storedOnNodes,
      status: storedOnNodes.length > 0 ? 'stored' : 'failed'
    });
    
    chunks.set(chunkId, {
      file_id: fileMetadata.file_id,
      chunk_index: i,
      size: chunkData.length,
      nodes: storedOnNodes
    });
  }
  
  return chunksInfo;
}

async function sendChunkToNode(node, chunkId, chunkData, fileMetadata) {
  try {
    const metadata = JSON.stringify({
      chunk_id: chunkId,
      file_id: fileMetadata.file_id,
      filename: fileMetadata.filename,
      chunk_size: chunkData.length
    });
    
    const metadataBuffer = Buffer.from(metadata);
    const fullPayload = Buffer.concat([metadataBuffer, chunkData]);
    
    const response = await fetch(`${node.address}/chunk`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Metadata-Length': metadataBuffer.length.toString()
      },
      body: fullPayload,
      timeout: 30000 
    });
    
    const result = await response.json();
    return result.success;
    
  } catch (error) {
    logActivity('ERROR', `Error sending chunk to ${node.node_id}: ${error.message}`);
    return false;
  }
}

async function retrieveFileFromNodes(fileId, fileMetadata) {
  const chunksInfo = fileMetadata.chunks || [];
  const chunkBuffers = [];
  
  const sortedChunks = chunksInfo.sort((a, b) => a.chunk_index - b.chunk_index);
  
  for (const chunkInfo of sortedChunks) {
    const chunkData = await retrieveChunkFromNodes(chunkInfo.chunk_id, chunkInfo.nodes);
    
    if (!chunkData) {
      throw new Error(`Failed to retrieve chunk ${chunkInfo.chunk_id} from any node`);
    }
    
    chunkBuffers.push(chunkData);
  }
  
  return Buffer.concat(chunkBuffers);
}

async function retrieveChunkFromNodes(chunkId, nodeIds) {
  for (const nodeId of nodeIds) {
    const node = nodes.get(nodeId);
    if (!node || node.status !== 'online') {
      continue;
    }
    
    try {
      const response = await fetch(`${node.address}/chunk?id=${chunkId}`, {
        timeout: 10000
      });
      
      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        logActivity('INFO', `Retrieved chunk ${chunkId} from node ${nodeId}`);
        return buffer;
      }
    } catch (error) {
      logActivity('WARN', `Failed to retrieve chunk ${chunkId} from node ${nodeId}: ${error.message}`);
      continue;
    }
  }
  
  return null;
}

function selectNodesForChunk(availableNodes, count) {
  if (availableNodes.length === 0) return [];
  
  return availableNodes
    .sort((a, b) => (b.storage_stats?.free_bytes || 0) - (a.storage_stats?.free_bytes || 0))
    .slice(0, Math.min(count, availableNodes.length));
}

app.listen(port, () => {
  logActivity('INFO', `PJAS Coordinator started on port ${port}`);
  console.log(`PJAS Network Coordinator running on port ${port}`);
  console.log(`API at http://localhost:${port}/api`);
});

module.exports = app;
