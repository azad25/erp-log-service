#!/usr/bin/env python3
"""
Test WebSocket connections to debug connection issues
"""
import asyncio
import websockets
import json
import sys

async def test_websocket_connection(url, container_id):
    """Test WebSocket connection to a specific endpoint"""
    print(f"Testing WebSocket connection to: {url}")
    
    try:
        async with websockets.connect(url) as websocket:
            print(f"✅ Connected successfully to {url}")
            
            # Wait for initial messages
            try:
                message = await asyncio.wait_for(websocket.recv(), timeout=5.0)
                print(f"📨 Received message: {message}")
                
                # Try to parse as JSON
                try:
                    data = json.loads(message)
                    print(f"📊 Parsed data: {json.dumps(data, indent=2)}")
                except json.JSONDecodeError:
                    print(f"📄 Raw message: {message}")
                
            except asyncio.TimeoutError:
                print("⏰ No message received within 5 seconds")
            
            # Keep connection alive for a bit to see more messages
            print("🔄 Waiting for more messages (10 seconds)...")
            try:
                for i in range(10):
                    message = await asyncio.wait_for(websocket.recv(), timeout=1.0)
                    try:
                        data = json.loads(message)
                        if data.get('type') == 'stats':
                            stats = data.get('payload', {})
                            print(f"📊 Stats update: CPU={stats.get('cpuUsage', 0):.1f}%, Memory={stats.get('memoryUsage', 0):.1f}MB")
                        elif data.get('type') == 'log':
                            log = data.get('payload', {})
                            print(f"📝 Log: {log.get('message', '')[:50]}...")
                        else:
                            print(f"📨 Other: {message[:100]}...")
                    except json.JSONDecodeError:
                        print(f"📄 Raw: {message[:100]}...")
            except asyncio.TimeoutError:
                print("⏰ No more messages received")
                
    except Exception as e:
        print(f"❌ Connection failed: {str(e)}")
        return False
    
    return True

async def main():
    """Main test function"""
    # Get container ID from command line or use default
    container_id = sys.argv[1] if len(sys.argv) > 1 else "test_container"
    
    print(f"Testing WebSocket connections for container: {container_id}")
    print("=" * 60)
    
    # Test different WebSocket endpoints
    endpoints = [
        f"ws://localhost:8093/ws/stats/{container_id}",
        f"ws://localhost:8093/ws/logs/{container_id}",
        f"ws://localhost:3004/ws/stats/{container_id}",
        f"ws://localhost:3004/ws/logs/{container_id}",
    ]
    
    results = {}
    
    for endpoint in endpoints:
        print(f"\n🔍 Testing: {endpoint}")
        print("-" * 40)
        success = await test_websocket_connection(endpoint, container_id)
        results[endpoint] = success
        print()
    
    print("=" * 60)
    print("📋 SUMMARY:")
    for endpoint, success in results.items():
        status = "✅ SUCCESS" if success else "❌ FAILED"
        print(f"{status}: {endpoint}")

if __name__ == "__main__":
    asyncio.run(main())
