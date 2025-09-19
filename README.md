# PJAS - Psychological Journey Attached Storage

A distributed peer-to-peer file storage network where community members contribute their own hardware to create a collaborative storage system.

## Overview

PJAS (Psychological Journey Attached Storage) splits uploaded files into chunks and distributes them across multiple storage nodes run by community members. Files are automatically reassembled when downloaded, providing redundancy and decentralized storage.

## Features

- **Distributed Storage** - Files split into 10MB chunks across multiple nodes
- **Automatic Redundancy** - Each chunk stored on 3 different nodes for reliability
- **Web Interface** - Simple drag-and-drop upload with download management
- **Real-time Monitoring** - Track node health and network statistics
- **Failover Support** - Automatic chunk retrieval from alternate nodes if some are offline
- **Community-Driven** - No central storage, powered by member contributions

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│   Website   │────▶│ Railway Backend  │────▶│ Python Node │
│  (Upload)   │     │  (Coordinator)   │     │  (Storage)  │
└─────────────┘     └──────────────────┘     └─────────────┘
       ▲                      │                      │
       │                      ▼                      ▼
       └──────────────── Chunk Retrieval ◀───── .chunk files
```

## Quick Start

### For Storage Node Operators

1. **Install Python & Dependencies:**
```bash
pip install requests
```

2. **Download PJAS:**
```bash
git clone https://github.com/pjhq-inc/PJAS.git
cd PJAS
```

3. **Configure ngrok (required for external access):**
```bash
# Download ngrok from https://ngrok.com/download
# Start tunnel
ngrok http 8420
```

4. **Update Configuration:**
Edit `pjas_config.json` with your ngrok URL:
```json
{
  "ngrok_url": "https://your-url.ngrok-free.app",
  "coordinator_url": "https://pjas-production.up.railway.app/api",
  "port": 8420
}
```

5. **Run the Node:**
```bash
python pjas_node.py ./storage 100  # Allocate 100GB
```

### For Users

Simply visit [pjhq.dev/PJAS](https://pjhq.dev/PJAS/) to upload and download files.
If you want to host it yourself head to [the pjhq website repo](https://github.com/pjhq-inc/website/tree/main/) and copy the PJAS folder, paste it to your website or hosting service and adjust server.js (railway url, POST and GET etc.)   

## Installation

### Prerequisites

- Python 3.7 or higher
- ngrok account (free tier works although static urls are recommended)
- 10GB+ free disk space (1 works too but isnt practical)
- Stable internet connection

### Storage Node Setup

1. **Clone the repository:**
```bash
git clone https://github.com/pjhq-inc/PJAS.git
cd PJAS
```

2. **Create configuration file:**
```bash
cp pjas_config.example.json pjas_config.json
```

Edit `pjas_config.json`:
```json
{
  "ngrok_url": "https://your-ngrok-url.ngrok-free.app",
  "coordinator_url": "https://pjas-production.up.railway.app/api",
  "port": 8420
}
```

3. **Set up ngrok:**
```bash
# Install ngrok from https://ngrok.com/download
ngrok config add-authtoken YOUR_AUTH_TOKEN
ngrok http 8420
```

4. **Start the storage node:**
```bash
python pjas_node.py <storage_path> [allocated_gb]
```

Example:
```bash
# Allocate 200GB in current directory
python pjas_node.py ./pjas_storage 200

# Windows example
python pjas_node.py C:\PJAS\Storage 150
```

## How It Works

### File Upload Process

1. User uploads file through web interface
2. Coordinator splits file into 10MB chunks
3. Each chunk is distributed to 3 different nodes
4. Nodes store chunks locally and confirm storage
5. File metadata stored on coordinator

### File Download Process

1. User requests file download
2. Coordinator identifies which nodes have the chunks
3. Chunks retrieved from available nodes
4. File reassembled from chunks
5. Complete file sent to user

## File Structure

```
storage_directory/
├── chunks/                  # Stored file chunks
│   ├── abc123.chunk
│   ├── def456.chunk
│   └── ...
└── node_metadata.json      # Node state and chunk index
```

## API Endpoints

### Node Management
- `POST /api/nodes/register` - Register storage node
- `POST /api/nodes/heartbeat` - Send node status update
- `GET /api/nodes` - List all registered nodes

### File Operations
- `POST /api/files/upload` - Upload file (multipart/form-data)
- `GET /api/files` - List all stored files
- `GET /api/files/download/:id` - Download file by ID

### Monitoring
- `GET /api/stats` - Network statistics
- `GET /api/logs` - Activity logs
- `GET /health` - Server health check

## Configuration

### pjas_config.json

```json
{
  "ngrok_url": "https://your-url.ngrok-free.app",
  "coordinator_url": "https://pjas-production.up.railway.app/api",
  "port": 8420
}
```

- **ngrok_url**: Your ngrok tunnel URL (changes on free tier)
- **coordinator_url**: Railway backend API endpoint
- **port**: Local port for node server (default 8420)

### Node Settings

Modify allocation when starting:
```bash
python pjas_node.py ./storage 500  # Allocate 500GB
```

## Troubleshooting

### Node won't connect to coordinator

**Problem:** "Failed to register with coordinator"

**Solutions:**
1. Check ngrok is running: `ngrok http 8420`
2. Verify ngrok URL in `pjas_config.json`
3. Ensure coordinator URL is correct
4. Check firewall isn't blocking port 8420

### Upload fails

**Problem:** "Upload failed: No nodes available"

**Solutions:**
1. Ensure at least one node is online
2. Check node has enough free space
3. Check Railway backend logs

### Download fails

**Problem:** "Failed to retrieve file"

**Solutions:**
1. Ensure nodes storing chunks are online
2. Check chunks weren't manually deleted
3. Verify coordinator can reach nodes
4. Try re-uploading the file

### Chunks folder is empty

**Problem:** No .chunk files appearing
If the files still appear on the site this means they're stored in the RAM of railway and will be wiped upon restart 
**Solutions:**
1. Verify you're using updated server.js with distribution
2. Check Railway logs for "stored on node" messages
3. Ensure ngrok tunnel is active
4. Confirm node is receiving POST requests

### ngrok URL keeps changing

**Problem:** Need to update URL every restart

**Solutions:**
1. Use config file to easily update URL
2. Consider ngrok paid plan for static URL
3. Restart node after updating config

## Network Statistics

View real-time stats at the coordinator:

- **Total Nodes**: Registered storage nodes
- **Online Nodes**: Currently active nodes
- **Total Storage**: Combined allocated space
- **Used Storage**: Space consumed by chunks
- **Network Health**: Percentage of online nodes
- **Active Files**: Files stored in network

## Security Considerations

⚠️ **Current Limitations:**

- No end-to-end encryption (files split but not encrypted)
- No user authentication (anyone can upload/download)
- No access control (all files are network-wide public)
- Nodes must expose port 8420 publicly

**For Production Use:**
- Implement file encryption before chunking
- Add user authentication system
- Enable access control for files
- Use VPN or secure tunnels

## Development

### Project Structure

```
PJAS/
├── pjas_node.py           # Storage node software
├── pjas_config.json       # Node configuration
├── server.js              # Railway coordinator
├── package.json           # Node dependencies
├── start.sh               # Startup script
└── README.md              # This file
```

### Running Locally

```bash
# Coordinator server
npm install
npm start

# Storage node
python pjas_node.py ./test_storage 50
```

### Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/psychological-feature`)
3. Commit changes (`git commit -m 'Add psychological feature'`)
4. Push to branch (`git push origin feature/psychological-feature`)
5. Open Pull Request


## FAQ

**Q: How much storage should I allocate?**  
A: Start with 50-100GB. You can always increase later. (obviously depeonds on the usecase)

**Q: Do I need to keep my computer on 24/7?**  
A: No, but files will be unavailable when your node is offline. The network has redundancy (3 copies per chunk) to handle this.

**Q: Is my data secure?**  
A: no

**Q: What happens if I delete chunks manually?**  
A: just dont do that

**Q: Can I change my ngrok URL?**  
A: Yes, update `pjas_config.json` and restart your node.

**Q: Does this cost money?**  
A: about 5 cents per uploaded gb if you use railway 

## Support

- **Issues**: [GitHub Issues](https://github.com/pjhq-inc/PJAS/issues)
- **Website**: [pjhq.dev](https://pjhq.dev)
- **Email**: mennybelk@pjhq.dev

## License

MIT License - see [LICENSE](LICENSE) for details

## Credits

Built by the PJHQ team (aka JUST ME) for the Psychological Journey community.

---

⚠️ **Alpha Software**: This is experimental software. Data loss may occur. Always keep backups of important files.
