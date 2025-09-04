#!/usr/bin/env python3
"""
Test script for ERP Log Service
Tests the API endpoints and WebSocket connections
"""

import asyncio
import json
import requests
import websockets
from datetime import datetime

API_BASE = "http://localhost:8093/api/v1"
WS_BASE = "ws://localhost:8093/api/v1"

def test_api_endpoints():
    """Test REST API endpoints"""
    print("🧪 Testing API Endpoints...")
    
    try:
        # Test health endpoint
        response = requests.get("http://localhost:8093/")
        print(f"✅ Health check: {response.status_code}")
        
        # Test containers endpoint
        response = requests.get(f"{API_BASE}/logs/containers")
        if response.status_code == 200:
            containers = response.json()
            print(f"✅ Containers endpoint: Found {len(containers)} containers")
            for container in containers[:3]:  # Show first 3
                print(f"   - {container['name']} ({container['status']})")
        else:
            print(f"❌ Containers endpoint failed: {response.status_code}")
            
        # Test logs endpoint with first container
        if containers:
            container_id = containers[0]['id']
            response = requests.get(f"{API_BASE}/logs/logs/{container_id}")
            if response.status_code == 200:
                logs_data = response.json()
                print(f"✅ Logs endpoint: Retrieved logs for {container_id}")
            else:
                print(f"❌ Logs endpoint failed: {response.status_code}")
                
    except Exception as e:
        print(f"❌ API test failed: {e}")

async def test_websocket():
    """Test WebSocket connection"""
    print("\n🔌 Testing WebSocket Connection...")
    
    try:
        # Get a container ID first
        response = requests.get(f"{API_BASE}/logs/containers")
        if response.status_code != 200:
            print("❌ Cannot get containers for WebSocket test")
            return
            
        containers = response.json()
        if not containers:
            print("❌ No containers available for WebSocket test")
            return
            
        container_id = containers[0]['id']
        ws_url = f"{WS_BASE}/logs/ws/logs/{container_id}"
        
        print(f"Connecting to: {ws_url}")
        
        async with websockets.connect(ws_url) as websocket:
            print(f"✅ WebSocket connected for container: {container_id}")
            
            # Send heartbeat
            await websocket.send(json.dumps({"type": "heartbeat"}))
            
            # Listen for messages for 5 seconds
            try:
                for i in range(5):
                    message = await asyncio.wait_for(websocket.recv(), timeout=1.0)
                    data = json.loads(message)
                    if data.get('type') == 'heartbeat_ack':
                        print("✅ Heartbeat acknowledged")
                    else:
                        print(f"📝 Log received: {data.get('message', 'No message')[:50]}...")
                        
            except asyncio.TimeoutError:
                print("⏰ No messages received in timeout period")
                
            print("✅ WebSocket test completed")
            
    except Exception as e:
        print(f"❌ WebSocket test failed: {e}")

def test_container_actions():
    """Test container start/stop/restart actions"""
    print("\n⚙️  Testing Container Actions...")
    
    try:
        # Get containers
        response = requests.get(f"{API_BASE}/logs/containers")
        if response.status_code != 200:
            print("❌ Cannot get containers for action test")
            return
            
        containers = response.json()
        if not containers:
            print("❌ No containers available for action test")
            return
            
        # Find a stopped container or use the first one
        test_container = containers[0]
        container_id = test_container['id']
        
        print(f"Testing actions on: {test_container['name']}")
        
        # Test restart (safest action)
        response = requests.post(f"{API_BASE}/logs/containers/{container_id}/restart")
        if response.status_code == 200:
            print("✅ Restart action successful")
        else:
            print(f"❌ Restart action failed: {response.status_code}")
            
    except Exception as e:
        print(f"❌ Container actions test failed: {e}")

def main():
    """Run all tests"""
    print("🚀 Starting ERP Log Service Tests")
    print("=" * 50)
    
    # Test API endpoints
    test_api_endpoints()
    
    # Test WebSocket
    asyncio.run(test_websocket())
    
    # Test container actions
    test_container_actions()
    
    print("\n" + "=" * 50)
    print("✨ Tests completed!")

if __name__ == "__main__":
    main()