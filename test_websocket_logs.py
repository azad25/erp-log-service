#!/usr/bin/env python3
"""
WebSocket test script to verify real-time log streaming functionality
"""
import asyncio
import websockets
import json
import sys
from datetime import datetime

async def test_websocket_logs(container_id):
    """Test WebSocket connection for log streaming"""
    uri = f"ws://localhost:8093/ws/logs/{container_id}"
    print(f"Connecting to: {uri}")
    
    try:
        async with websockets.connect(uri) as websocket:
            print(f"✅ Connected to WebSocket for container: {container_id}")
            print("Listening for log messages... (Press Ctrl+C to stop)")
            
            # Send a ping to test bidirectional communication
            await websocket.send(json.dumps({"type": "ping"}))
            print("📤 Sent ping message")
            
            message_count = 0
            async for message in websocket:
                try:
                    data = json.loads(message)
                    message_count += 1
                    timestamp = datetime.now().strftime("%H:%M:%S")
                    
                    if data.get("type") == "pong":
                        print(f"[{timestamp}] 🏓 Received pong response")
                    elif data.get("type") == "connection_established":
                        print(f"[{timestamp}] 🔗 Connection established")
                    elif data.get("type") == "log":
                        payload = data.get("payload", {})
                        log_time = payload.get("timestamp", "")
                        log_level = payload.get("level", "INFO")
                        log_message = payload.get("message", "")
                        print(f"[{timestamp}] 📝 LOG #{message_count}: [{log_level}] {log_message[:100]}...")
                    else:
                        print(f"[{timestamp}] 📨 Received: {data}")
                        
                except json.JSONDecodeError:
                    print(f"[{timestamp}] ❌ Invalid JSON: {message}")
                    
    except websockets.exceptions.ConnectionClosed:
        print("❌ WebSocket connection closed")
    except Exception as e:
        print(f"❌ Error: {e}")

async def test_websocket_stats(container_id):
    """Test WebSocket connection for container stats"""
    uri = f"ws://localhost:8093/ws/stats/{container_id}"
    print(f"Connecting to stats WebSocket: {uri}")
    
    try:
        async with websockets.connect(uri) as websocket:
            print(f"✅ Connected to Stats WebSocket for container: {container_id}")
            print("Listening for stats messages... (Press Ctrl+C to stop)")
            
            message_count = 0
            async for message in websocket:
                try:
                    data = json.loads(message)
                    message_count += 1
                    timestamp = datetime.now().strftime("%H:%M:%S")
                    
                    if data.get("type") == "stats":
                        payload = data.get("payload", {})
                        cpu = payload.get("cpuUsage", 0)
                        memory = payload.get("memoryUsage", 0)
                        memory_limit = payload.get("memoryLimit", 0)
                        print(f"[{timestamp}] 📊 STATS #{message_count}: CPU: {cpu:.1f}%, Memory: {memory:.1f}MB/{memory_limit:.1f}MB")
                    else:
                        print(f"[{timestamp}] 📨 Received: {data}")
                        
                except json.JSONDecodeError:
                    print(f"[{timestamp}] ❌ Invalid JSON: {message}")
                    
    except websockets.exceptions.ConnectionClosed:
        print("❌ WebSocket connection closed")
    except Exception as e:
        print(f"❌ Error: {e}")

async def main():
    if len(sys.argv) < 2:
        print("Usage: python test_websocket_logs.py <container_id> [stats]")
        print("Example: python test_websocket_logs.py 0558f2858793")
        print("Example: python test_websocket_logs.py 0558f2858793 stats")
        sys.exit(1)
    
    container_id = sys.argv[1]
    test_stats = len(sys.argv) > 2 and sys.argv[2] == "stats"
    
    print(f"🚀 Starting WebSocket test for container: {container_id}")
    print("=" * 60)
    
    try:
        if test_stats:
            await test_websocket_stats(container_id)
        else:
            await test_websocket_logs(container_id)
    except KeyboardInterrupt:
        print("\n👋 Test stopped by user")
    except Exception as e:
        print(f"❌ Test failed: {e}")

if __name__ == "__main__":
    asyncio.run(main())
